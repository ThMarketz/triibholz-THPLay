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
const MAX_BODY = +(process.env.MAX_BODY || 200 * 1024 * 1024);   // 200 MB
[DATA_DIR, VIDEO_DIR, JOB_DIR, CAL_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

    if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, engine: 'server', detector: makeDetector({ modelEndpoint: MODEL_ENDPOINT }).name, ffmpeg: hasFfmpeg, videoProvider: VIDEO_PROVIDER || null, queued: queue.length, running });

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
    return send(res, e.code === 'too-large' ? 413 : 500, { error: e.code || 'server-error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`[triibholz-analysis] listening on :${PORT}  ffmpeg=${hasFfmpeg}  data=${DATA_DIR}`));
}
module.exports = { server, runEngine };
