/* ============================================================
   server/index.js — Phase 1 backend MVP.

   A dependency-free Node service (built-in http only) that:
     · accepts an analysis job (video bytes, or pre-extracted frames)
     · runs the shared engine server-side (server/engine.js)
     · returns the shared Result schema
     · also exposes an async queue (submit → poll → result) with
       on-disk storage, the shape a real cloud API takes.

   Endpoints:
     GET  /api/health
     POST /api/analyse           sync — returns a Result (or {error})
     POST /api/jobs              enqueue — returns { id }
     GET  /api/jobs/:id          status
     GET  /api/jobs/:id/result   the Result once done
   ============================================================ */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('./engine.js');
const { makeDetector } = require('./detector.js');
const videoadapter = require('./videoadapter.js');
const CALENDAR = require('../js/calendar.js');
const PRIVACY = require('../js/privacy.js');
const INSIGHTS_FILE = () => path.join(DATA_DIR, 'insights.json');
function loadInsights(){ try { return JSON.parse(fs.readFileSync(INSIGHTS_FILE(), 'utf8')); } catch (e) { return PRIVACY.emptyAgg(); } }
const MODEL_ENDPOINT = process.env.MODEL_ENDPOINT || '';
const VIDEO_PROVIDER = process.env.VIDEO_PROVIDER || '';
// photoreal provider config — the KEY is only ever read from the env, never the request.
function videoCfg(body) {
  body = body || {};
  return {
    provider: body.provider || VIDEO_PROVIDER,
    base: body.base || process.env.VIDEO_BASE,
    model: body.model || process.env.VIDEO_MODEL,
    authScheme: process.env.VIDEO_AUTH_SCHEME,
    key: process.env.VIDEO_API_KEY,       // server-side only
  };
}
const videoJobs = new Map();   // jobId → cfg (so an async poll can resume)

const PORT = +(process.env.PORT || 4200);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const VIDEO_DIR = path.join(DATA_DIR, 'videos');
const JOB_DIR = path.join(DATA_DIR, 'jobs');
const CAL_DIR = path.join(DATA_DIR, 'calendars');
const CLIP_DIR = path.join(DATA_DIR, 'clips');
const DEBRIEF_DIR = path.join(DATA_DIR, 'debriefs');
const MAX_BODY = +(process.env.MAX_BODY || 200 * 1024 * 1024);   // 200 MB
const MAX_UPLOAD = +(process.env.MAX_UPLOAD || 4 * 1024 * 1024 * 1024);   // 4 GB — video uploads stream to disk, never into memory
[DATA_DIR, VIDEO_DIR, JOB_DIR, CAL_DIR, CLIP_DIR, DEBRIEF_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
const safeToken = t => String(t || '').replace(/[^\w.\-]/g, '').slice(0, 64);

let hasFfmpeg = false;
try { require('node:child_process').spawnSync(process.env.FFMPEG || 'ffmpeg', ['-version']); hasFfmpeg = true; } catch (e) { hasFfmpeg = false; }

/* ---------------- tiny id + storage ---------------- */
let counter = 0;
const uid = () => 'job_' + Date.now().toString(36) + '_' + (counter++).toString(36);
const jobPath = id => path.join(JOB_DIR, id.replace(/[^\w]/g, '') + '.json');
const saveJob = j => fs.writeFileSync(jobPath(j.id), JSON.stringify(j));
const loadJob = id => { try { return JSON.parse(fs.readFileSync(jobPath(id), 'utf8')); } catch (e) { return null; } };

/* ---------------- in-process FIFO queue ---------------- */
const queue = [];
let running = 0;
const CONCURRENCY = +(process.env.CONCURRENCY || 1);
function enqueue(id) { queue.push(id); pump(); }
function pump() {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift(); running++;
    processJob(id).catch(() => {}).finally(() => { running--; pump(); });
  }
}
async function processJob(id) {
  const job = loadJob(id); if (!job) return;
  job.status = 'processing'; job.startedAt = Date.now(); saveJob(job);
  try {
    const result = await runEngine(job.request);
    if (job.request && job.request.videoRef && result && typeof result === 'object') result.meta = Object.assign({}, result.meta || {}, { videoRef: job.request.videoRef });   // so clips can be cut from the same file later
    job.status = 'done'; job.result = result; job.finishedAt = Date.now(); saveJob(job);
  } catch (e) {
    job.status = 'error'; job.error = e.code || e.message; job.finishedAt = Date.now(); saveJob(job);
  }
}

/* ---------------- the actual analysis ---------------- */
async function runEngine(req) {
  req = req || {};
  const opts = Object.assign({}, req.opts);
  opts.modelEndpoint = opts.modelEndpoint || req.modelEndpoint || MODEL_ENDPOINT || undefined;
  if (req.scout) { opts.scout = true; if (req.us) opts.us = req.us; }
  if (req.mode === 'frames' || Array.isArray(req.frames)) {
    const w = req.w || engine.WORK_W, h = req.h || engine.WORK_H;
    const frames = (req.frames || []).map(f => Array.isArray(f) ? f : (f && f.data) || []);
    return engine.framesToResult(frames, w, h, req.calibration, opts);
  }
  if (req.videoRef) {
    if (!hasFfmpeg) { const e = new Error('ffmpeg-unavailable'); e.code = 'ffmpeg-unavailable'; throw e; }
    const vp = path.join(VIDEO_DIR, req.videoRef.replace(/[^\w.\-]/g, ''));
    if (!fs.existsSync(vp)) { const e = new Error('video-not-found'); e.code = 'video-not-found'; throw e; }
    opts.ffmpeg = process.env.FFMPEG;
    // auto-scout = the WHOLE video (chunked), not a 2.5 s window
    if (req.scout) return engine.videoToScout(vp, req.calibration, opts);
    return engine.videoToResult(vp, req.calibration, opts);
  }
  const e = new Error('no-input'); e.code = 'no-input'; throw e;
}

/* ---------------- http plumbing ---------------- */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-calibration,x-video-ref');
}
function send(res, code, obj) { cors(res); res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('body-too-large'), { code: 'too-large' })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* stream a request body straight to a file (a full-match video can be gigabytes) */
function streamToFile(req, fp, max) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(fp); let size = 0, failed = false;
    req.on('data', c => { size += c.length; if (!failed && size > max) { failed = true; ws.destroy(); try { fs.unlinkSync(fp); } catch (e) {} reject(Object.assign(new Error('body-too-large'), { code: 'too-large' })); req.resume(); } });
    req.pipe(ws);
    ws.on('finish', () => { if (!failed) resolve(size); });
    ws.on('error', e => { if (!failed) { failed = true; reject(e); } });
    req.on('error', e => { if (!failed) { failed = true; reject(e); } });
  });
}

/* cut a short clip out of an uploaded video (h264, 640 px wide, audio kept) */
function cutClip(vp, start, len, outPath) {
  const ff = process.env.FFMPEG || 'ffmpeg';
  const run = args => new Promise((resolve, reject) => {
    const c = require('node:child_process').spawn(ff, args); let err = '';
    c.stderr.on('data', d => err += d.toString());
    c.on('error', e => reject(Object.assign(new Error('ffmpeg-spawn'), { code: 'ffmpeg' })));
    c.on('close', code => code === 0 ? resolve() : reject(Object.assign(new Error('ffmpeg-exit-' + code + ': ' + err.slice(-200)), { code: 'ffmpeg' })));
  });
  const base = ['-y', '-ss', String(start), '-t', String(len), '-i', vp];
  return run(base.concat(['-vf', 'scale=640:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-movflags', '+faststart', outPath]))
    .catch(() => run(base.concat(['-c', 'copy', '-movflags', '+faststart', outPath])));
}
const debriefPath = id => path.join(DEBRIEF_DIR, safeToken(id) + '.json');
const loadDebrief = id => { try { return JSON.parse(fs.readFileSync(debriefPath(id), 'utf8')); } catch (e) { return null; } };
const saveDebrief = d => fs.writeFileSync(debriefPath(d.id), JSON.stringify(d));
const clean = (v, n) => String(v == null ? '' : v).slice(0, n || 400);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

    if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, engine: 'server', detector: makeDetector({ modelEndpoint: MODEL_ENDPOINT }).name, ffmpeg: hasFfmpeg, videoProvider: VIDEO_PROVIDER || null, queued: queue.length, running, maxUploadMB: Math.round(MAX_UPLOAD / 1048576) });

    // photoreal text-to-video: submit a prompt → a normalised video URL (or an async job)
    if (req.method === 'POST' && p === '/api/videogen') {
      const body = await readBody(req);
      let request; try { request = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      if (!request.prompt) return send(res, 400, { error: 'no-prompt' });
      const cfg = videoCfg(request);
      if (!cfg.provider) return send(res, 501, { error: 'no-video-provider' });
      try {
        const out = await videoadapter.generate(cfg, { prompt: request.prompt, seconds: request.seconds || 5 }, {});
        if (out.status === 'pending') { videoJobs.set(out.jobId, cfg); return send(res, 202, { status: 'pending', jobId: out.jobId, provider: cfg.provider }); }
        return send(res, 200, { url: out.url, provider: cfg.provider });
      } catch (e) { return send(res, 502, { error: e.code === 'provider-error' ? e.message : ('provider-failed: ' + (e.message || 'error')) }); }
    }
    // upload a video once → { videoRef }; then enqueue { videoRef, calibration, scout:true } on /api/jobs
    if (req.method === 'POST' && p === '/api/upload') {
      const ref = uid() + '.mp4', fp = path.join(VIDEO_DIR, ref);
      const bytes = await streamToFile(req, fp, MAX_UPLOAD);
      if (!bytes) { try { fs.unlinkSync(fp); } catch (e) {} return send(res, 400, { error: 'empty-body' }); }
      return send(res, 200, { videoRef: ref, bytes });
    }

    // anonymous learning — accepts ONLY identifier-free pattern features, stores counts, reports k-anonymously
    if (req.method === 'POST' && p === '/api/insights') {
      const body = await readBody(req);
      let data; try { data = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      const f = data.features || data;
      if (!PRIVACY.isAnonymous(f) || !f.situation) return send(res, 400, { error: 'not-anonymous' });
      const agg = PRIVACY.contribute(loadInsights(), f);
      fs.writeFileSync(INSIGHTS_FILE(), JSON.stringify(agg));
      return send(res, 200, { ok: true, n: agg.n });
    }
    if (req.method === 'GET' && p === '/api/insights') {
      const agg = loadInsights();
      return send(res, 200, { k: PRIVACY.K_MIN, n: agg.n, report: PRIVACY.report(agg) });
    }

    // subscribable calendar feed — publish events, then any device subscribes to the .ics
    if (req.method === 'POST' && /^\/api\/calendar\/[\w.\-]+$/.test(p)) {
      const token = safeToken(p.split('/').pop());
      const body = await readBody(req);
      let data; try { data = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      if (!Array.isArray(data.events)) return send(res, 400, { error: 'no-events' });
      fs.writeFileSync(path.join(CAL_DIR, token + '.json'), JSON.stringify({ name: data.name || 'Triibholz', events: data.events, updated: Date.now() }));
      return send(res, 200, { ok: true, ics: '/api/calendar/' + token + '.ics', events: data.events.length });
    }
    const cm = p.match(/^\/api\/calendar\/([\w.\-]+)\.ics$/);
    if (req.method === 'GET' && cm) {
      const token = safeToken(cm[1]);
      let data; try { data = JSON.parse(fs.readFileSync(path.join(CAL_DIR, token + '.json'), 'utf8')); } catch (e) { return send(res, 404, { error: 'no-such-calendar' }); }
      const ics = CALENDAR.toICS(data.events, { name: data.name });
      cors(res); res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'inline; filename="' + token + '.ics"' }); return res.end(ics);
    }

    const vm = p.match(/^\/api\/videogen\/([\w.\-]+)$/);
    if (req.method === 'GET' && vm) {
      const cfg = videoJobs.get(vm[1]) || videoCfg({});
      if (!cfg.provider) return send(res, 404, { error: 'unknown-job' });
      try {
        const pr = await videoadapter.makeAdapter(Object.assign({}, cfg, { key: process.env.VIDEO_API_KEY })).poll(vm[1]);
        if (pr.status === 'done') { videoJobs.delete(vm[1]); return send(res, 200, { status: 'done', url: pr.url }); }
        if (pr.status === 'error') { videoJobs.delete(vm[1]); return send(res, 200, { status: 'error', error: pr.error }); }
        return send(res, 200, { status: 'pending' });
      } catch (e) { return send(res, 502, { error: 'poll-failed: ' + (e.message || 'error') }); }
    }

    if (req.method === 'POST' && p === '/api/analyse') {
      const ct = (req.headers['content-type'] || '');
      let request;
      if (ct.includes('application/json')) {
        const body = await readBody(req);
        try { request = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      } else {                                   // raw video upload
        if (!hasFfmpeg) return send(res, 501, { error: 'ffmpeg-unavailable' });
        const body = await readBody(req);
        if (!body.length) return send(res, 400, { error: 'empty-body' });
        const ref = uid() + '.mp4';
        fs.writeFileSync(path.join(VIDEO_DIR, ref), body);
        let calibration = {}; try { calibration = JSON.parse(req.headers['x-calibration'] || '{}'); } catch (e) {}
        let opts = {}; try { opts = JSON.parse(req.headers['x-opts'] || '{}'); } catch (e) {}
        request = { videoRef: ref, calibration, opts };
      }
      try { const result = await runEngine(request); return send(res, 200, result); }
      catch (e) { return send(res, 422, { error: e.code || e.message }); }
    }

    if (req.method === 'POST' && p === '/api/jobs') {
      const body = await readBody(req);
      let request; try { request = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      const job = { id: uid(), status: 'queued', createdAt: Date.now(), request };
      saveJob(job); enqueue(job.id);
      return send(res, 202, { id: job.id, status: job.status });
    }

    // ---- clips: cut a possession out of an uploaded match → a small mp4 served back
    if (req.method === 'POST' && p === '/api/clip') {
      const body = await readBody(req);
      let cr; try { cr = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      if (!hasFfmpeg) return send(res, 503, { error: 'ffmpeg-unavailable' });
      const vp = path.join(VIDEO_DIR, safeToken(cr.videoRef));
      if (!cr.videoRef || !fs.existsSync(vp)) return send(res, 404, { error: 'video-not-found' });
      const start = Math.max(0, +cr.start || 0), end = Math.max(start + 1, Math.min(start + 60, +cr.end || start + 10));
      const id = safeToken(cr.videoRef).replace(/\.mp4$/, '') + '_' + Math.round(start * 10) + '_' + Math.round(end * 10);
      const out = path.join(CLIP_DIR, id + '.mp4');
      if (!fs.existsSync(out)) { try { await cutClip(vp, start, end - start, out); } catch (e) { return send(res, 500, { error: e.code || 'clip-failed' }); } }
      return send(res, 200, { id, clipUrl: '/api/clips/' + id + '.mp4', start, end, bytes: fs.statSync(out).size });
    }
    const clipM = p.match(/^\/api\/clips\/([\w\-]+\.mp4)$/);
    if (req.method === 'GET' && clipM) {
      const fp = path.join(CLIP_DIR, safeToken(clipM[1])); if (!fs.existsSync(fp)) return send(res, 404, { error: 'not-found' });
      const size = fs.statSync(fp).size; const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      cors(res); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Cache-Control', 'private, max-age=86400');
      if (range) { const a = range[1] ? +range[1] : 0, b = range[2] ? Math.min(+range[2], size - 1) : size - 1; res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 }); return fs.createReadStream(fp, { start: a, end: b }).pipe(res); }
      res.writeHead(200, { 'Content-Length': size }); return fs.createReadStream(fp).pipe(res);
    }

    // ---- debriefs: a shared match review (plan vs reality + clips + board plays) with comments
    if (req.method === 'POST' && p === '/api/debriefs') {
      const body = await readBody(req);
      let d; try { d = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      if (!d.title || !Array.isArray(d.items)) return send(res, 400, { error: 'title-and-items-required' });
      const deb = { id: uid(), team: safeToken(d.team || 'club'), title: clean(d.title, 120), matchTitle: clean(d.matchTitle, 120), author: clean(d.author, 80), us: d.us === 'dark' ? 'dark' : 'white', createdAt: Date.now(),
        summary: (Array.isArray(d.summary) ? d.summary : []).slice(0, 12).map(x => clean(x, 300)),
        plan: (Array.isArray(d.plan) ? d.plan : []).slice(0, 12).map(x => ({ id: clean(x.id, 40), label: clean(x.label, 80), side: x.side === 'defense' ? 'defense' : 'offense', attacks: +x.attacks || 0, unread: +x.unread || 0, followed: +x.followed || 0, followedPct: x.followedPct == null ? null : +x.followedPct, whenFollowed: x.whenFollowed || { n: 0, shots: 0, goals: 0 }, whenNot: x.whenNot || { n: 0, shots: 0, goals: 0 }, verdict: clean(x.verdict, 200) })),
        items: d.items.slice(0, 24).map(it => ({ id: uid(), t0: +it.t0 || 0, t1: +it.t1 || 0, title: clean(it.title, 120), note: clean(it.note, 400), result: clean(it.result, 40), asked: clean(it.asked, 120), followed: it.followed == null ? null : !!it.followed, clipUrl: /^\/api\/clips\/[\w\-]+\.mp4$/.test(it.clipUrl || '') ? it.clipUrl : null, frames: Array.isArray(it.frames) ? it.frames.slice(0, 8) : [], notes: it.notes && typeof it.notes === 'object' ? it.notes : {} })),
        comments: [] };
      saveDebrief(deb);
      return send(res, 201, { id: deb.id, createdAt: deb.createdAt });
    }
    if (req.method === 'GET' && p === '/api/debriefs') {
      const team = safeToken(url.searchParams.get('team') || 'club');
      const list = fs.readdirSync(DEBRIEF_DIR).filter(f => f.endsWith('.json')).map(f => loadDebrief(f.replace(/\.json$/, ''))).filter(d => d && d.team === team)
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
        .map(d => ({ id: d.id, title: d.title, matchTitle: d.matchTitle, author: d.author, createdAt: d.createdAt, items: d.items.length, comments: d.comments.length }));
      return send(res, 200, { debriefs: list });
    }
    const dm = p.match(/^\/api\/debriefs\/([\w]+)(\/comments)?$/);
    if (dm) {
      const deb = loadDebrief(dm[1]); if (!deb) return send(res, 404, { error: 'not-found' });
      if (req.method === 'GET' && !dm[2]) return send(res, 200, deb);
      if (req.method === 'POST' && dm[2]) {
        const body = await readBody(req);
        let c; try { c = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
        if (!clean(c.text, 1000).trim()) return send(res, 400, { error: 'empty-comment' });
        const cm2 = { id: uid(), author: clean(c.author, 80) || 'Anonymous', text: clean(c.text, 1000).trim(), itemId: c.itemId ? safeToken(c.itemId) : null, at: Date.now() };
        deb.comments.push(cm2); if (deb.comments.length > 500) deb.comments = deb.comments.slice(-500); saveDebrief(deb);
        return send(res, 201, cm2);
      }
    }

    const jm = p.match(/^\/api\/jobs\/([\w]+)(\/result)?$/);
    if (req.method === 'GET' && jm) {
      const job = loadJob(jm[1]); if (!job) return send(res, 404, { error: 'not-found' });
      if (jm[2]) {
        if (job.status !== 'done') return send(res, 409, { error: 'not-ready', status: job.status });
        return send(res, 200, job.result);
      }
      return send(res, 200, { id: job.id, status: job.status, error: job.error || null });
    }

    return send(res, 404, { error: 'no-route' });
  } catch (e) {
    if (e.code === 'too-large') res.setHeader('Connection', 'close');
    return send(res, e.code === 'too-large' ? 413 : 500, e.code === 'too-large' ? { error: 'too-large', maxUploadMB: Math.round(MAX_UPLOAD / 1048576) } : { error: e.code || 'server-error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`[triibholz-analysis] listening on :${PORT}  ffmpeg=${hasFfmpeg}  data=${DATA_DIR}`));
}
module.exports = { server, runEngine };
