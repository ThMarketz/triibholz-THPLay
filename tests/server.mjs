/* Backend regression suite — starts the Phase 1 service and drives its
   HTTP API with the frames-mode path (no ffmpeg needed, runs anywhere).
   Run:  node tests/server.mjs */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 4278;
process.env.PORT = String(PORT);
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'thplay-srv-'));

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };
const base = `http://localhost:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));

// a synthetic RGBA frame (blue water + white/dark/keeper/ball squares)
function frame(w, h) {
  const d = new Array(w * h * 4).fill(0);
  const put = (x0, y0, x1, y1, r, g, b) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } };
  put(0, 0, w, h, 30, 90, 140);                 // water
  put(4, 4, 10, 10, 245, 248, 250);             // white cap
  put(28, 5, 34, 11, 245, 248, 250);            // white cap
  put(10, 14, 16, 20, 22, 26, 30);              // dark cap
  put(32, 15, 38, 21, 220, 40, 40);             // keeper
  put(18, 9, 24, 15, 255, 130, 30);             // ball
  return d;
}

(async () => {
  try {
    const mod = await import('../server/index.js');
    const server = (mod.default && mod.default.server) || mod.server;
    await new Promise(r => server.listen(PORT, r));

    console.log('\n[1] Health');
    const h = await (await fetch(base + '/api/health')).json();
    ok('health ok + reports engine', h.ok === true && h.engine === 'server');
    ok('health reports ffmpeg availability (boolean)', typeof h.ffmpeg === 'boolean');
    ok('health reports the detector in use (colour by default)', h.detector === 'colour');

    console.log('\n[2] Sync /api/analyse — frames mode (server runs the real engine)');
    const w = 40, hh = 24;
    const corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: hh }, { x: 0, y: hh }];
    const frames = Array.from({ length: 6 }, () => frame(w, hh));
    const body = { mode: 'frames', w, h: hh, frames, calibration: { corners }, opts: { start: 3 } };
    const r = await fetch(base + '/api/analyse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    ok('analyse responds 200', r.status === 200);
    const result = await r.json();
    ok('returns the shared Result schema (engine=server)', result.engine === 'server' && Array.isArray(result.tracks) && Array.isArray(result.events) && Array.isArray(result.frames));
    ok('detected a board frame with players', result.frames.length === 1 && Object.keys(result.frames[0].boardFrame.att).length >= 1);
    ok('carried the timestamp through (start=3)', result.frames[0].t === 3 && result.events[0].t === 3);
    ok('CORS is open for the PWA origin', r.headers.get('access-control-allow-origin') === '*');

    console.log('\n[3] Async queue — submit → poll → result');
    const sub = await (await fetch(base + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    ok('job enqueued with an id', !!sub.id && sub.status === 'queued');
    let status = 'queued', tries = 0, jr;
    while (status !== 'done' && status !== 'error' && tries++ < 50) { await wait(40); jr = await (await fetch(base + '/api/jobs/' + sub.id)).json(); status = jr.status; }
    ok('job reaches done', status === 'done');
    const jres = await fetch(base + '/api/jobs/' + sub.id + '/result');
    ok('result retrievable + valid', jres.status === 200 && (await jres.json()).engine === 'server');

    console.log('\n[3b] Phase 2 — pluggable served-model detector (via a stand-in model server)');
    // a mock model endpoint implementing the detector contract:
    // POST { w,h,frame } -> { detections:[{x,y,cls,conf}] }
    const MODEL_PORT = 4279;
    const model = http.createServer((rq, rs) => {
      let n = 0; rq.on('data', () => n++); rq.on('end', () => {
        rs.writeHead(200, { 'content-type': 'application/json' });
        rs.end(JSON.stringify({ detections: [
          { x: 8, y: 6, cls: 'white', conf: 0.95 }, { x: 30, y: 7, cls: 'white', conf: 0.95 },
          { x: 12, y: 17, cls: 'dark', conf: 0.9 }, { x: 34, y: 18, cls: 'keeper', conf: 0.92 },
          { x: 20, y: 12, cls: 'ball', conf: 0.8 },
        ] }));
      });
    });
    await new Promise(r => model.listen(MODEL_PORT, r));
    const modelUrl = `http://localhost:${MODEL_PORT}/`;
    const mbody = { mode: 'frames', w, h: hh, frames, calibration: { corners }, opts: { start: 0, modelEndpoint: modelUrl } };
    const mr = await fetch(base + '/api/analyse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mbody) });
    const mres = await mr.json();
    ok('served model is used → engine=server, result valid', mr.status === 200 && mres.engine === 'server' && Array.isArray(mres.frames));
    ok('model detections drive the board (2 white → 2 attackers)', Object.keys(mres.frames[0].boardFrame.att).length === 2 && Object.keys(mres.frames[0].boardFrame.def).length === 1);
    ok('model tracks carried through', mres.tracks.length >= 4);
    // a dead model endpoint surfaces a clean error, not a crash
    const deadBody = { mode: 'frames', w, h: hh, frames, calibration: { corners }, opts: { modelEndpoint: 'http://127.0.0.1:4111/nope' } };
    const dead = await fetch(base + '/api/analyse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(deadBody) });
    ok('unreachable model → 422 {error}, no crash', dead.status === 422 && !!(await dead.json()).error);
    model.close();

    console.log('\n[4] Error handling');
    ok('bad JSON → 400', (await fetch(base + '/api/analyse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })).status === 400);
    const noInput = await fetch(base + '/api/analyse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    ok('no input → 422 {error}', noInput.status === 422 && (await noInput.json()).error === 'no-input');
    const noFrames = await fetch(base + '/api/analyse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'frames', frames: [], calibration: { corners } }) });
    ok('empty frames → 422 no-frames', noFrames.status === 422 && (await noFrames.json()).error === 'no-frames');
    ok('unknown job → 404', (await fetch(base + '/api/jobs/nope')).status === 404);
    ok('unknown route → 404', (await fetch(base + '/api/nope')).status === 404);

    server.close();
    console.log(`\n==== ${pass} passed, ${fail} failed ====`);
    process.exit(fail ? 1 : 0);
  } catch (e) { console.error('THREW:', e && e.stack || e); process.exit(2); }
})();
