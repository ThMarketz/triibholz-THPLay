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
const ANNOUNCE = require('../js/announce.js');
const INSIGHTS_FILE = () => path.join(DATA_DIR, 'insights.json');
function loadInsights(){ try { return JSON.parse(fs.readFileSync(INSIGHTS_FILE(), 'utf8')); } catch (e) { return PRIVACY.emptyAgg(); } }
const MODEL_ENDPOINT = process.env.MODEL_ENDPOINT || '';
const VIDEO_PROVIDER = process.env.VIDEO_PROVIDER || '';
const RET = require('./retention.js');
/* One season. Match video is of children, and "for ever" is not an answer a club accepts —
   docs/LAUNCH_PHASES.md. Overridable so it can be tested in seconds instead of months. */
const RETENTION_DAYS = RET.daysFrom(process.env);
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
const ANNOUNCE_DIR = path.join(DATA_DIR, 'announcements');
const MAX_BODY = +(process.env.MAX_BODY || 200 * 1024 * 1024);   // 200 MB
const MAX_UPLOAD = +(process.env.MAX_UPLOAD || 4 * 1024 * 1024 * 1024);   // 4 GB — video uploads stream to disk, never into memory
[DATA_DIR, VIDEO_DIR, JOB_DIR, CAL_DIR, CLIP_DIR, DEBRIEF_DIR, ANNOUNCE_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
const safeToken = t => String(t || '').replace(/[^\w.\-]/g, '').slice(0, 64);
/* A feed's events are stored under the hash of its token, never the token itself (it is a password).
   Feeds published before accounts keep their old file name so a calendar already subscribed to one
   does not break on upgrade. */
const calFile = token => access.on
  ? require('node:crypto').createHash('sha256').update(String(token)).digest('hex').slice(0, 32) + '.json'
  : safeToken(token) + '.json';

/* ---- accounts: off unless ACCOUNTS=1. When on, a wrong configuration or a database written by a
   newer build stops the server here, before it listens. No route uses accounts yet (slice 1). */
let ACCOUNTS, accountsDb = null, auth = null, access = require('./access.js').openAccess();
try {
  ACCOUNTS = require('./config.js').assertConfig();
  /* Turning accounts back off is not a rollback — it is an exposure. With ACCOUNTS unset every
     route falls back to openAccess(): no session is required, every club's debriefs, videos, clips
     and announcements are readable by anyone who can reach the server, and the app offers one-tap
     demo personas to the public. A restart that loses the environment (a reboot, launchd, a
     different shell, a `docker compose up` without the .env) would do exactly that, silently.
     So: once a database has been used with accounts on, it refuses to start without them. */
  if (!ACCOUNTS.accounts) require('./db.js').refuseSilentReopen(path.join(DATA_DIR, 'triibholz.db'));
  if (ACCOUNTS.accounts) accountsDb = require('./db.js').open(path.join(DATA_DIR, 'triibholz.db'));
  if (accountsDb) require('./db.js').lockDomain(accountsDb, ACCOUNTS.rpId);
  if (accountsDb) auth = require('./auth.js').createAuth({ db: accountsDb, cfg: ACCOUNTS });
  access = accountsDb
    ? require('./access.js').createAccess({ db: accountsDb, auth, cfg: ACCOUNTS, clipShownTo })
    : require('./access.js').openAccess();
} catch (e) {
  if (require.main !== module) throw e;
  console.error('[triibholz-analysis] not starting — ' + e.message);
  process.exit(1);
}

let hasFfmpeg = false;
// spawnSync never throws for a missing binary — it returns { error: ENOENT } — so check the result
try { const r = require('node:child_process').spawnSync(process.env.FFMPEG || 'ffmpeg', ['-version']); hasFfmpeg = !r.error && r.status === 0; } catch (e) { hasFfmpeg = false; }

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
  // ffmpeg's own words about a damaged or unreadable video: kept in the job FILE for whoever debugs it,
  // never in an API answer (they name server paths and mean nothing to a coach)
  let issues = null;
  try {
    const result = await runEngine(job.request, { onIssues: list => { issues = list; } });
    if (job.request && job.request.videoRef && result && typeof result === 'object') result.meta = Object.assign({}, result.meta || {}, { videoRef: job.request.videoRef });   // so clips can be cut from the same file later
    job.status = 'done'; job.result = result; job.finishedAt = Date.now();
    if (issues) { job.decodeIssues = issues; console.warn(`[triibholz-analysis] ${id}: ${issues.length} damaged part(s) of the video — see the job file`); }
    saveJob(job);
  } catch (e) {
    job.status = 'error'; job.error = e.code || e.message; job.finishedAt = Date.now();
    if (e.detail) job.detail = e.detail;
    if (issues) job.decodeIssues = issues;
    saveJob(job);
  }
}

/* ---------------- the actual analysis ---------------- */
async function runEngine(req, hooks) {
  req = req || {};
  const opts = Object.assign({}, req.opts, hooks);   // hooks (callbacks) last: a request can't carry or override them
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
  // API answers carry personal data (announcements, debriefs, soon rosters): no browser, proxy or
  // service worker may keep a copy
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // with accounts on the app is same-origin and nothing else may read these answers: no CORS at all
  if (access.on) return;
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
/* what the session knows about a person, for records that show a name or address one member */
const displayNameOf = userId => { try { const u = accountsDb.prepare('SELECT display_name FROM users WHERE id = ?').get(userId); return u ? u.display_name : null; } catch (e) { return null; } };
const memberRefOf = (clubId, userId) => { try { const m = accountsDb.prepare("SELECT member_ref FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'approved'").get(clubId, userId); return m ? m.member_ref : null; } catch (e) { return null; } };
const staffIn = (who, clubId) => ['admin', 'coach', 'trainer'].includes(who.clubs.get(clubId));
/* a note is for the whole club, for one member, or — either way — for the staff of that club */
const announcementFor = (a, who) => access.visibleRecord(a, who) && (a.scope === 'team' || a.to === memberRefOf(a.clubId, who.userId) || staffIn(who, a.clubId));
const memberOfClub = (clubId, memberRef) => { try { return !!accountsDb.prepare("SELECT 1 FROM club_members WHERE club_id = ? AND member_ref = ? AND status = 'approved'").get(clubId, String(memberRef || '')); } catch (e) { return false; } };

/* A clip a player may watch: one their club's debrief shows, or one that came with a note sent to
   them or to the whole club. Anything else is theirs only if they made it or they are staff. */
function clipShownTo(clipId, clubId, userId) {
  const ref = memberRefOf(clubId, userId);
  try {
    const inDebrief = fs.readdirSync(DEBRIEF_DIR).filter(f => f.endsWith('.json')).some(f => {
      const d = loadDebrief(f.replace(/\.json$/, ''));
      return d && d.clubId === clubId && (d.items || []).some(it => it && it.clipUrl && it.clipUrl.includes(clipId));
    });
    if (inDebrief) return true;
    return listAnnounces().some(a => a && a.clubId === clubId && a.clip && a.clip.url && a.clip.url.includes(clipId)
      && (a.scope === 'team' || a.to === ref));
  } catch (e) { return false; }
}
const announcePath = id => path.join(ANNOUNCE_DIR, safeToken(id) + '.json');
const loadAnnounce = id => { try { return JSON.parse(fs.readFileSync(announcePath(id), 'utf8')); } catch (e) { return null; } };
const saveAnnounce = a => fs.writeFileSync(announcePath(a.id), JSON.stringify(a));
const listAnnounces = () => fs.readdirSync(ANNOUNCE_DIR).filter(f => f.endsWith('.json')).map(f => loadAnnounce(f.replace(/\.json$/, ''))).filter(Boolean);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    // accounts, clubs and joining: their own request rules and no CORS, so handled before everything else
    if (/^\/api\/(auth|clubs|join)(\/|$)/.test(p)) {
      if (!auth) { res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify({ error: 'accounts-off' })); }
      return auth.handle(req, res, p);
    }
    if (req.method === 'OPTIONS') { if (access.on) return send(res, 405, { error: 'method-not-allowed' }); cors(res); res.writeHead(204); return res.end(); }
    // one gate for every route below: a current client, an allowed Origin, the right content type
    if (access.on && p !== '/api/health' && !/^\/api\/calendar\/[\w.\-]+\.ics$/.test(p)) access.gate(req, p);

    if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, accounts: !!accountsDb, engine: 'server', detector: makeDetector({ modelEndpoint: MODEL_ENDPOINT }).name, ffmpeg: hasFfmpeg, videoProvider: VIDEO_PROVIDER || null, queued: queue.length, running, maxUploadMB: Math.round(MAX_UPLOAD / 1048576), retentionDays: RETENTION_DAYS });

    // photoreal text-to-video: submit a prompt → a normalised video URL (or an async job)
    if (req.method === 'POST' && p === '/api/videogen') {
      access.requireStaff(access.requireActor(req));
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
      const who = access.requireActor(req), club = access.requireStaff(who);
      const ref = (access.on ? access.newId('vid') : uid()) + '.mp4', fp = path.join(VIDEO_DIR, ref);
      const bytes = await streamToFile(req, fp, MAX_UPLOAD);
      if (!bytes) { try { fs.unlinkSync(fp); } catch (e) {} return send(res, 400, { error: 'empty-body' }); }
      access.recordAsset({ id: ref, kind: 'video', clubId: club.clubId, ownerUserId: who.userId, meta: { bytes } });
      return send(res, 200, { videoRef: ref, bytes });
    }

    // anonymous learning — accepts ONLY identifier-free pattern features, stores counts, reports k-anonymously
    if (req.method === 'POST' && p === '/api/insights') {
      access.requireStaff(access.requireActor(req));
      const body = await readBody(req);
      let data; try { data = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      const f = data.features || data;
      if (!PRIVACY.isAnonymous(f) || !f.situation) return send(res, 400, { error: 'not-anonymous' });
      const agg = PRIVACY.contribute(loadInsights(), f);
      fs.writeFileSync(INSIGHTS_FILE(), JSON.stringify(agg));
      return send(res, 200, { ok: true, n: agg.n });
    }
    if (req.method === 'GET' && p === '/api/insights') {
      access.requireStaff(access.requireActor(req));
      const agg = loadInsights();
      return send(res, 200, { k: PRIVACY.K_MIN, n: agg.n, report: PRIVACY.report(agg) });
    }

    // subscribable calendar feed — publish events, then any device subscribes to the .ics
    if (req.method === 'POST' && (p === '/api/calendar' || /^\/api\/calendar\/[\w.\-]+$/.test(p))) {
      const who = access.requireActor(req);
      const body = await readBody(req);
      let data; try { data = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      if (!Array.isArray(data.events)) return send(res, 400, { error: 'no-events' });
      let token;
      if (access.on) {
        // the token IS the permission (a calendar app sends no cookie), so only the server makes one
        if (p !== '/api/calendar') return send(res, 410, { error: 'client-made-feed-tokens-are-gone' });
        token = access.issueFeed(who, safeToken(req.headers['x-club'] || '') || null, data.name).token;
      } else token = safeToken(p.split('/').pop());
      fs.writeFileSync(path.join(CAL_DIR, calFile(token)), JSON.stringify({ name: data.name || 'Triibholz', events: data.events, updated: Date.now() }));
      return send(res, 200, { ok: true, token, ics: '/api/calendar/' + token + '.ics', events: data.events.length });
    }
    const cm = p.match(/^\/api\/calendar\/([\w.\-]+)\.ics$/);
    if (req.method === 'GET' && cm) {
      const token = cm[1];
      if (access.on && !access.feedFor(token)) return send(res, 404, { error: 'no-such-calendar' });
      let data; try { data = JSON.parse(fs.readFileSync(path.join(CAL_DIR, calFile(token)), 'utf8')); } catch (e) { return send(res, 404, { error: 'no-such-calendar' }); }
      const ics = CALENDAR.toICS(data.events, { name: data.name });
      cors(res); res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'inline; filename="' + token + '.ics"' }); return res.end(ics);
    }

    const vm = p.match(/^\/api\/videogen\/([\w.\-]+)$/);
    if (req.method === 'GET' && vm) {
      access.requireStaff(access.requireActor(req));
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
      const rawWho = access.requireActor(req), rawClub = access.requireStaff(rawWho);
      const ct = (req.headers['content-type'] || '');
      let request;
      if (ct.includes('application/json')) {
        const body = await readBody(req);
        try { request = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      } else {                                   // raw video upload
        if (!hasFfmpeg) return send(res, 501, { error: 'ffmpeg-unavailable' });
        const body = await readBody(req);
        if (!body.length) return send(res, 400, { error: 'empty-body' });
        const ref = (access.on ? access.newId('vid') : uid()) + '.mp4';
        fs.writeFileSync(path.join(VIDEO_DIR, ref), body);
        access.recordAsset({ id: ref, kind: 'video', clubId: rawClub.clubId, ownerUserId: rawWho.userId, meta: { bytes: body.length } });
        let calibration = {}; try { calibration = JSON.parse(req.headers['x-calibration'] || '{}'); } catch (e) {}
        let opts = {}; try { opts = JSON.parse(req.headers['x-opts'] || '{}'); } catch (e) {}
        request = { videoRef: ref, calibration, opts };
      }
      try { const result = await runEngine(request); return send(res, 200, result); }
      catch (e) { return send(res, 422, { error: e.code || e.message }); }
    }

    if (req.method === 'POST' && p === '/api/jobs') {
      const who = access.requireActor(req), club = access.requireStaff(who);
      const body = await readBody(req);
      let request; try { request = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      if (access.on && request.videoRef) access.ownedVideo(who, safeToken(request.videoRef));
      const job = { id: access.on ? access.newId('job') : uid(), status: 'queued', createdAt: Date.now(), request };
      access.recordAsset({ id: job.id, kind: 'job', clubId: club.clubId, ownerUserId: who.userId });
      saveJob(job); enqueue(job.id);
      return send(res, 202, { id: job.id, status: job.status });
    }

    /* ---- keep: this one is a teaching clip, do not reap it ----
       Recorded beside the data rather than in the database, because recordAsset is a no-op with
       accounts off and a keep list that only worked in one mode would quietly lose clips in the
       other. The id is the clip's own name; its hard-linked twin inherits the decision. */
    if (req.method === 'POST' && p === '/api/keep') {
      const who = access.requireActor(req); access.requireStaff(who);
      const body = await readBody(req);
      let kr; try { kr = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      const id = safeToken(kr.id);
      if (!id) return send(res, 400, { error: 'no-id' });
      // only something that is really here: a keep list of names that do not exist is a slow leak
      const here = fs.existsSync(path.join(CLIP_DIR, id)) || fs.existsSync(path.join(VIDEO_DIR, id)) || fs.existsSync(path.join(JOB_DIR, id));
      if (!here) return send(res, 404, { error: 'not-found' });
      const keep = RET.setKeep(DATA_DIR, id, !!kr.keep, Date.now());
      return send(res, 200, { id, keep: !!keep[id], retentionDays: RETENTION_DAYS });
    }

    // ---- clips: cut a possession out of an uploaded match → a small mp4 served back
    if (req.method === 'POST' && p === '/api/clip') {
      const who = access.requireActor(req), club = access.requireStaff(who);
      const body = await readBody(req);
      let cr; try { cr = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      /* Never cut a cut. It is allowed by nothing and degrades badly: crf-28 re-encoded from
         crf-28 (below), an offset on an offset, and an id that grows ~8 characters a generation
         until safeToken's 64-char cap truncates it — after which the ref names no file and the
         coach gets a bare 'video-not-found'. Measured: one cut of a cut already reads
         cut_cut_job_..._0_80_0_40.mp4. Cut from the match instead. */
      if (/^cut_/.test(safeToken(cr.videoRef))) return send(res, 400, { error: 'cut-of-a-cut' });
      if (access.on) access.ownedVideo(who, safeToken(cr.videoRef));
      const vp = path.join(VIDEO_DIR, safeToken(cr.videoRef));
      if (!cr.videoRef || !fs.existsSync(vp)) return send(res, 404, { error: 'video-not-found' });   // an unknown video is 404 with or without ffmpeg
      if (!hasFfmpeg) return send(res, 503, { error: 'ffmpeg-unavailable' });
      const start = Math.max(0, +cr.start || 0), end = Math.max(start + 1, Math.min(start + 60, +cr.end || start + 10));
      const id = safeToken(cr.videoRef).replace(/\.mp4$/, '') + '_' + Math.round(start * 10) + '_' + Math.round(end * 10);
      const out = path.join(CLIP_DIR, id + '.mp4');
      if (!fs.existsSync(out)) {
        try { await cutClip(vp, start, end - start, out); }
        catch (e) { try { fs.unlinkSync(out); } catch (_) {} return send(res, 500, { error: e.code || 'clip-failed' }); }   // no half-written file left to be served as "cached"
        // ffmpeg exits 0 and writes an empty ~260-byte mp4 for a range past the end of the video, or inside a part a
        // cut-off file doesn't have: never cache or serve that as a clip (the coach would get a player that never plays)
        if (!(await engine.probeDuration(out, process.env.FFMPEG) > 0)) { try { fs.unlinkSync(out); } catch (_) {} return send(res, 422, { error: 'clip-empty' }); }
      }
      access.recordAsset({ id: id + '.mp4', kind: 'clip', clubId: club.clubId, ownerUserId: who.userId, meta: { videoRef: safeToken(cr.videoRef), start, end } });

      /* A cut is also a video in its own right, so the coach can scout ONE SITUATION instead of a
         whole match. The bytes are already here: hard-link the same file into the video store
         (one filesystem — both live under DATA_DIR) and copy only if the link is refused, so a
         library of cuts costs disk once, not twice.
         The id MUST differ from the clip's. recordAsset is INSERT OR REPLACE on id, so reusing it
         would rewrite the clip's own row as kind 'video' — and requireAssetRead(..., ['clip']) is
         what lets a player watch a clip that was sent to them. That would have taken their video
         away to gain ours.
         Failing here is not fatal: an un-analysable cut is still a cut. */
      let analysisRef = null;
      try {
        const ref = 'cut_' + id + '.mp4', vcopy = path.join(VIDEO_DIR, ref);
        /* A hard link is atomic; a COPY is not. An interrupted copyFileSync (out of disk, container
           killed) leaves a truncated mp4 that existsSync then treats as done for ever, and it would
           be registered as an analysable video. Copy to a .part and rename, which is atomic on one
           filesystem — the same shape the clip itself uses a screen above. */
        if (!fs.existsSync(vcopy)) {
          try { fs.linkSync(out, vcopy); }
          catch (e) {
            const part = vcopy + '.part';
            try { fs.copyFileSync(out, part); fs.renameSync(part, vcopy); }
            catch (e2) { try { fs.unlinkSync(part); } catch (_) {} throw e2; }
          }
        }
        access.recordAsset({ id: ref, kind: 'video', clubId: club.clubId, ownerUserId: who.userId, meta: { cutOf: safeToken(cr.videoRef), start, end } });
        analysisRef = ref;
      } catch (e) { analysisRef = null; }

      return send(res, 200, { id, clipUrl: '/api/clips/' + id + '.mp4', videoRef: analysisRef, start, end, bytes: fs.statSync(out).size });
    }
    const clipM = p.match(/^\/api\/clips\/([\w\-]+\.mp4)$/);
    if (req.method === 'GET' && clipM) {
      if (access.on) access.requireAssetRead(access.requireActor(req), safeToken(clipM[1]), ['clip']);
      const fp = path.join(CLIP_DIR, safeToken(clipM[1])); if (!fs.existsSync(fp)) return send(res, 404, { error: 'not-found' });
      const size = fs.statSync(fp).size; const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      cors(res); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Type', 'video/mp4');
      if (range) { const a = range[1] ? +range[1] : 0, b = range[2] ? Math.min(+range[2], size - 1) : size - 1; res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 }); return fs.createReadStream(fp, { start: a, end: b }).pipe(res); }
      res.writeHead(200, { 'Content-Length': size }); return fs.createReadStream(fp).pipe(res);
    }

    // ---- debriefs: a shared match review (plan vs reality + clips + board plays) with comments
    if (req.method === 'POST' && p === '/api/debriefs') {
      const who = access.requireActor(req), club = access.requireStaff(who, safeToken(req.headers['x-club'] || '') || null);
      const body = await readBody(req);
      let d; try { d = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      if (!d.title || !Array.isArray(d.items)) return send(res, 400, { error: 'title-and-items-required' });
      const deb = { id: access.on ? access.newId('deb') : uid(), clubId: club.clubId, authorUserId: who.userId, team: safeToken(d.team || 'club'), title: clean(d.title, 120), matchTitle: clean(d.matchTitle, 120), author: clean(d.author, 80), us: d.us === 'dark' ? 'dark' : 'white', createdAt: Date.now(),
        summary: (Array.isArray(d.summary) ? d.summary : []).slice(0, 12).map(x => clean(x, 300)),
        plan: (Array.isArray(d.plan) ? d.plan : []).slice(0, 12).map(x => ({ id: clean(x.id, 40), label: clean(x.label, 80), side: x.side === 'defense' ? 'defense' : 'offense', attacks: +x.attacks || 0, unread: +x.unread || 0, followed: +x.followed || 0, followedPct: x.followedPct == null ? null : +x.followedPct, whenFollowed: x.whenFollowed || { n: 0, shots: 0, goals: 0 }, whenNot: x.whenNot || { n: 0, shots: 0, goals: 0 }, verdict: clean(x.verdict, 200) })),
        items: d.items.slice(0, 24).map(it => ({ id: uid(), t0: +it.t0 || 0, t1: +it.t1 || 0, title: clean(it.title, 120), note: clean(it.note, 400), result: clean(it.result, 40), asked: clean(it.asked, 120), followed: it.followed == null ? null : !!it.followed, clipUrl: /^\/api\/clips\/[\w\-]+\.mp4$/.test(it.clipUrl || '') ? it.clipUrl : null, frames: Array.isArray(it.frames) ? it.frames.slice(0, 8) : [], notes: it.notes && typeof it.notes === 'object' ? it.notes : {} })),
        comments: [] };
      if (access.on) deb.author = displayNameOf(who.userId) || deb.author;   // never the name the request claimed
      saveDebrief(deb);
      return send(res, 201, { id: deb.id, createdAt: deb.createdAt });
    }
    if (req.method === 'GET' && p === '/api/debriefs') {
      const who = access.on ? access.requireActor(req) : null;
      const team = safeToken(url.searchParams.get('team') || 'club');
      const list = fs.readdirSync(DEBRIEF_DIR).filter(f => f.endsWith('.json')).map(f => loadDebrief(f.replace(/\.json$/, '')))
        .filter(d => access.on ? access.visibleRecord(d, who) : (d && d.team === team))
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
        .map(d => ({ id: d.id, title: d.title, matchTitle: d.matchTitle, author: d.author, createdAt: d.createdAt, items: d.items.length, comments: d.comments.length }));
      return send(res, 200, { debriefs: list });
    }
    const dm = p.match(/^\/api\/debriefs\/([\w-]+)(\/comments)?$/);
    if (dm) {
      const deb = loadDebrief(dm[1]); if (!deb) return send(res, 404, { error: 'not-found' });
      const dwho = access.on ? access.requireActor(req) : null;
      if (access.on && !access.visibleRecord(deb, dwho)) return send(res, 404, { error: 'not-found' });
      if (req.method === 'GET' && !dm[2]) return send(res, 200, deb);
      if (req.method === 'POST' && dm[2]) {
        const body = await readBody(req);
        let c; try { c = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
        if (!clean(c.text, 1000).trim()) return send(res, 400, { error: 'empty-comment' });
        const cm2 = { id: access.on ? access.newId('cmt') : uid(), author: access.on ? (displayNameOf(dwho.userId) || 'Member') : (clean(c.author, 80) || 'Anonymous'),
          authorUserId: access.on ? dwho.userId : null, text: clean(c.text, 1000).trim(), itemId: c.itemId ? safeToken(c.itemId) : null, at: Date.now() };
        deb.comments.push(cm2); if (deb.comments.length > 500) deb.comments = deb.comments.slice(-500); saveDebrief(deb);
        return send(res, 201, cm2);
      }
    }

    // ---- announcements: a coach's note to one player, or a broadcast to the whole team
    if (req.method === 'POST' && p === '/api/announcements') {
      const who = access.requireActor(req), club = access.requireStaff(who, safeToken(req.headers['x-club'] || '') || null);
      const body = await readBody(req);
      let raw; try { raw = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
      const r = ANNOUNCE.sanitize(raw);
      if (!r.ok) return send(res, 400, { error: r.error });
      const a = Object.assign({ id: access.on ? access.newId('ann') : uid(), createdAt: Date.now(), readBy: [] }, r.value);
      if (access.on) {
        // the club, the author and who it is for come from the session and this club's own members
        if (a.scope === 'player' && !memberOfClub(club.clubId, a.to)) return send(res, 404, { error: 'not-found' });
        // a clip may only travel with a note if it was cut from this club's own video
        if (a.clip) {
          const asset = access.assetOf(a.clip.url.replace('/api/clips/', ''));
          if (!asset || asset.kind !== 'clip' || asset.club_id !== club.clubId) return send(res, 404, { error: 'not-found' });
        }
        Object.assign(a, { clubId: club.clubId, authorUserId: who.userId, from: { name: displayNameOf(who.userId) || '', email: '' } });
      }
      saveAnnounce(a);
      return send(res, 201, { id: a.id, createdAt: a.createdAt });
    }
    if (req.method === 'GET' && p === '/api/announcements') {
      const who = access.on ? access.requireActor(req) : null;
      const team = safeToken(url.searchParams.get('team') || 'club');
      const forEmail = access.on ? '' : String(url.searchParams.get('for') || '').trim().toLowerCase();
      const list = listAnnounces()
        .filter(a => access.on ? announcementFor(a, who) : ANNOUNCE.visibleTo(a, { team, email: forEmail }))
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, 100)
        .map(a => ANNOUNCE.summarize(a, { for: access.on ? who.userId : forEmail }));
      return send(res, 200, { announcements: list, unread: list.filter(s => !s.read).length });
    }
    const anm = p.match(/^\/api\/announcements\/([\w-]+)(\/read)?$/);
    if (anm) {
      const a = loadAnnounce(anm[1]); if (!a) return send(res, 404, { error: 'not-found' });
      const awho = access.on ? access.requireActor(req) : null;
      if (access.on && !announcementFor(a, awho)) return send(res, 404, { error: 'not-found' });
      if (req.method === 'GET' && !anm[2]) return send(res, 200, a);
      if (req.method === 'POST' && anm[2]) {
        const body = await readBody(req);
        let rb; try { rb = JSON.parse(body.toString() || '{}'); } catch (e) { return send(res, 400, { error: 'bad-json' }); }
        const by = access.on ? awho.userId : String(rb.by || '').trim().toLowerCase();   // who read it comes from the session
        if (!by) return send(res, 400, { error: 'by-required' });
        if (!a.readBy.includes(by)) { a.readBy.push(by); saveAnnounce(a); }
        return send(res, 200, { ok: true });
      }
    }

    const jm = p.match(/^\/api\/jobs\/([\w-]+)(\/result)?$/);
    if (req.method === 'GET' && jm) {
      if (access.on) access.requireAssetRead(access.requireActor(req), jm[1], ['job']);
      const job = loadJob(jm[1]); if (!job) return send(res, 404, { error: 'not-found' });
      if (jm[2]) {
        if (job.status !== 'done') return send(res, 409, { error: 'not-ready', status: job.status });
        return send(res, 200, job.result);
      }
      return send(res, 200, { id: job.id, status: job.status, error: job.error || null });
    }

    return send(res, 404, { error: 'no-route' });
  } catch (e) {
    if (e.status) return send(res, e.status, Object.assign({ error: e.error }, e.extra || {}));
    if (e.code === 'too-large') res.setHeader('Connection', 'close');
    return send(res, e.code === 'too-large' ? 413 : 500, e.code === 'too-large' ? { error: 'too-large', maxUploadMB: Math.round(MAX_UPLOAD / 1048576) } : { error: e.code || 'server-error' });
  }
});

if (require.main === module) {
  /* Sweep at start and once a day. At start because a server that has been off for a month has a
     month of expiries waiting, and a timer alone would not notice until tomorrow. */
  const dirs = { videos: VIDEO_DIR, clips: CLIP_DIR, jobs: JOB_DIR };
  function reap() {
    try {
      const r = RET.sweep({ dirs, dataDir: DATA_DIR, now: Date.now(), days: RETENTION_DAYS });
      if (r.removed.length || r.failed.length) {
        console.log(`[triibholz-analysis] retention: removed ${r.removed.length} file(s) past ${r.days} days, kept ${r.kept.length}` +
                    (r.failed.length ? `, FAILED ${r.failed.length}: ${r.failed.slice(0, 4).join(', ')}` : ''));
      }
    } catch (e) { console.error('[triibholz-analysis] retention sweep failed:', e && e.message); }
  }
  reap();
  setInterval(reap, RET.DAY).unref();

  server.listen(PORT, () => console.log(`[triibholz-analysis] listening on :${PORT}  ffmpeg=${hasFfmpeg}  data=${DATA_DIR}  keeping video ${RETENTION_DAYS} days`));
}
module.exports = { server, runEngine, accountsDb, auth };
