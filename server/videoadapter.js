/* ============================================================
   server/videoadapter.js — photoreal text-to-video providers,
   normalised to the app's contract.

   The app posts { prompt, seconds }; each provider has its own API
   shape and is asynchronous (submit → poll a job → get a URL). This
   adapter hides all of that behind one flow and — crucially — keeps
   the API KEY on the server (env only, never in the browser).

   Drivers implement:
     submit(req, cfg) → { jobId }              (or { url } if instant)
     poll(jobId, cfg) → { status:'pending'|'done'|'error', url?, error? }

   `mock` and `generic` are fully exercised by the test suite. The
   real providers (fal / replicate / luma / runway) map to their
   documented endpoints — verify them against a live key; the plumbing
   (submit, poll loop, normalisation) is what's proven here.
   ============================================================ */
'use strict';

async function httpJson(url, opts) {
  const r = await fetch(url, opts);
  const txt = await r.text();
  let j; try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = { _raw: txt }; }
  if (!r.ok) { const e = new Error('provider-http-' + r.status); e.status = r.status; e.body = j; throw e; }
  return j;
}
function authHeaders(cfg) {
  const h = { 'content-type': 'application/json' };
  if (cfg.key) h.authorization = (cfg.authScheme || 'Bearer') + ' ' + cfg.key;
  return h;
}
const pickUrl = j => j.url || (j.video && j.video.url) || (j.assets && j.assets.video) ||
  (Array.isArray(j.output) ? j.output[0] : j.output) || (j.data && j.data.video && j.data.video.url) || null;
const stateOf = s => (s || '').toString().toLowerCase();

const DRIVERS = {
  // deterministic, no network — for the default/testing
  mock: {
    async submit(req) { return { jobId: 'mock-' + ((req.prompt || '').length || 0) }; },
    async poll(jobId) { return { status: 'done', url: 'https://mock.local/' + jobId + '.mp4' }; },
  },

  // a simple documented contract you can put in front of any model:
  //   POST <base> { prompt, seconds, model } → { jobId | id }
  //   GET  <base>/<jobId>                    → { status|state, url|video|assets }
  generic: {
    async submit(req, cfg) {
      const j = await httpJson(cfg.base, { method: 'POST', headers: authHeaders(cfg), body: JSON.stringify({ prompt: req.prompt, seconds: req.seconds, model: cfg.model }) });
      const id = j.jobId || j.id; if (!id && pickUrl(j)) return { url: pickUrl(j) };
      return { jobId: id };
    },
    async poll(jobId, cfg) {
      const j = await httpJson(cfg.base.replace(/\/$/, '') + '/' + jobId, { headers: authHeaders(cfg) });
      const st = stateOf(j.status || j.state);
      if (/done|complete|succeed|success/.test(st)) return { status: 'done', url: pickUrl(j) };
      if (/error|fail|cancel/.test(st)) return { status: 'error', error: j.error || 'provider-failed' };
      return { status: 'pending' };
    },
  },

  // fal.ai queue API (model e.g. "fal-ai/kling-video/v1/standard/text-to-video")
  fal: {
    async submit(req, cfg) {
      const j = await httpJson('https://queue.fal.run/' + cfg.model, { method: 'POST', headers: authHeaders(Object.assign({}, cfg, { authScheme: 'Key' })), body: JSON.stringify({ prompt: req.prompt, duration: req.seconds }) });
      return { jobId: j.request_id || j.requestId };
    },
    async poll(jobId, cfg) {
      const base = 'https://queue.fal.run/' + cfg.model + '/requests/' + jobId;
      const s = await httpJson(base + '/status', { headers: authHeaders(Object.assign({}, cfg, { authScheme: 'Key' })) });
      const st = stateOf(s.status);
      if (/completed/.test(st)) { const r = await httpJson(base, { headers: authHeaders(Object.assign({}, cfg, { authScheme: 'Key' })) }); return { status: 'done', url: pickUrl(r) }; }
      if (/error|failed/.test(st)) return { status: 'error', error: 'fal-failed' };
      return { status: 'pending' };
    },
  },

  // Replicate (model = a version hash in cfg.model)
  replicate: {
    async submit(req, cfg) {
      const j = await httpJson('https://api.replicate.com/v1/predictions', { method: 'POST', headers: authHeaders(Object.assign({}, cfg, { authScheme: 'Bearer' })), body: JSON.stringify({ version: cfg.model, input: { prompt: req.prompt } }) });
      return { jobId: j.id };
    },
    async poll(jobId, cfg) {
      const j = await httpJson('https://api.replicate.com/v1/predictions/' + jobId, { headers: authHeaders(Object.assign({}, cfg, { authScheme: 'Bearer' })) });
      const st = stateOf(j.status);
      if (/succeeded/.test(st)) return { status: 'done', url: pickUrl(j) };
      if (/failed|canceled/.test(st)) return { status: 'error', error: j.error || 'replicate-failed' };
      return { status: 'pending' };
    },
  },

  // Luma Dream Machine
  luma: {
    async submit(req, cfg) {
      const j = await httpJson('https://api.lumalabs.ai/dream-machine/v1/generations', { method: 'POST', headers: authHeaders(cfg), body: JSON.stringify({ prompt: req.prompt, model: cfg.model || 'ray-2' }) });
      return { jobId: j.id };
    },
    async poll(jobId, cfg) {
      const j = await httpJson('https://api.lumalabs.ai/dream-machine/v1/generations/' + jobId, { headers: authHeaders(cfg) });
      const st = stateOf(j.state);
      if (/completed/.test(st)) return { status: 'done', url: pickUrl(j) };
      if (/failed/.test(st)) return { status: 'error', error: j.failure_reason || 'luma-failed' };
      return { status: 'pending' };
    },
  },

  // Runway (task API); verify endpoint/model against current docs
  runway: {
    async submit(req, cfg) {
      const j = await httpJson((cfg.base || 'https://api.dev.runwayml.com/v1/text_to_video'), { method: 'POST', headers: Object.assign(authHeaders(cfg), { 'x-runway-version': '2024-11-06' }), body: JSON.stringify({ promptText: req.prompt, duration: req.seconds, model: cfg.model }) });
      return { jobId: j.id };
    },
    async poll(jobId, cfg) {
      const j = await httpJson('https://api.dev.runwayml.com/v1/tasks/' + jobId, { headers: Object.assign(authHeaders(cfg), { 'x-runway-version': '2024-11-06' }) });
      const st = stateOf(j.status);
      if (/succeeded/.test(st)) return { status: 'done', url: pickUrl(j) };
      if (/failed|cancel/.test(st)) return { status: 'error', error: j.failure || 'runway-failed' };
      return { status: 'pending' };
    },
  },
};

function makeAdapter(cfg) {
  const d = DRIVERS[(cfg.provider || '').toLowerCase()];
  if (!d) { const e = new Error('unknown-provider'); e.code = 'unknown-provider'; throw e; }
  return {
    name: cfg.provider,
    submit: (req) => d.submit(req, cfg),
    poll: (jobId) => d.poll(jobId, cfg),
  };
}
// submit then poll until done / error / budget exhausted
async function generate(cfg, req, opts) {
  opts = opts || {};
  const maxWait = opts.maxWaitMs != null ? opts.maxWaitMs : 22000;
  const every = opts.pollMs || 1500;
  const ad = makeAdapter(cfg);
  const s = await ad.submit(req);
  if (s.url) return { status: 'done', url: s.url };
  const jobId = s.jobId;
  const t0 = Date.now();
  while (Date.now() - t0 < maxWait) {
    const p = await ad.poll(jobId);
    if (p.status === 'done') return { status: 'done', url: p.url, jobId };
    if (p.status === 'error') { const e = new Error('provider-error: ' + (p.error || 'failed')); e.code = 'provider-error'; throw e; }
    await new Promise(r => setTimeout(r, every));
  }
  return { status: 'pending', jobId };   // caller polls GET /api/videogen/:jobId
}

module.exports = { DRIVERS, makeAdapter, generate, httpJson };
