/* ============================================================
   server/engine.js — Phase 1 backend engine.

   The whole point of the Tier 3 contract is proven here: the SAME
   pure browser modules (vision.js / track.js / analysis.js) run
   unchanged on the server, with more compute — full-res frames,
   more of them — and emit the identical Result schema.

   Two frame sources:
     · framesToResult(frames,…)  — pre-extracted RGBA frames (used by
       the /api/analyse "frames" mode; needs no ffmpeg, so it runs and
       is tested anywhere).
     · videoToResult(path,…)     — decode a real video with ffmpeg
       (bundled in the container) at full resolution.
   ============================================================ */
'use strict';
const { spawn } = require('node:child_process');

// the browser engine, unchanged — globals so track.js can see VISION
global.VISION = require('../js/vision.js');
global.TRACK = require('../js/track.js');
global.ANALYSIS = require('../js/analysis.js');
global.BYTETRACK = require('../js/bytetrack.js');
global.EVENTS = require('../js/events.js');
global.TACTICS = require('../js/tactics.js');
global.FIELD = require('../js/field.js');
const VISION = global.VISION, ANALYSIS = global.ANALYSIS, BYTETRACK = global.BYTETRACK, EVENTS = global.EVENTS, TACTICS = global.TACTICS, FIELD = global.FIELD;
const { makeDetector } = require('./detector.js');

const WORK_W = 320, WORK_H = 180;   // analysis resolution

const isAuto = cal => !!(cal && cal.mode === 'auto');
function homographyOf(cal) {
  if (cal && Array.isArray(cal.H) && cal.H.length === 9) return cal.H;
  if (cal && Array.isArray(cal.corners) && cal.corners.length === 4) return VISION.solveHomography(cal.corners, VISION.boardCorners());
  return null;
}
function tracksFrom(con) {
  const out = [];
  ['white', 'dark', 'keeper', 'ball'].forEach(cls =>
    (con[cls] || []).forEach(b => out.push({ id: b.id || out.length + 1, cls, path: [{ t: 0, x: b.x, y: b.y, conf: 0.7 }] })));
  return out;
}

/* frames: array of Uint8ClampedArray|Buffer|number[] (RGBA, w*h*4 each) */
async function framesToResult(frames, w, h, cal, opts) {
  opts = opts || {};
  const H = homographyOf(cal);
  if (!H && !isAuto(cal)) { const e = new Error('bad-calibration'); e.code = 'bad-calibration'; throw e; }
  if (!frames || !frames.length) { const e = new Error('no-frames'); e.code = 'no-frames'; throw e; }
  // Phase 2: detection is pluggable (colour now, a served model when configured);
  // ByteTrack fuses the per-frame detections into stable, occlusion-bridged tracks.
  const detector = opts.detector || makeDetector({ modelEndpoint: opts.modelEndpoint, step: opts.step, minArea: opts.minArea });
  const perFrame = [];
  for (const f of frames) perFrame.push(await detector.detect(f, w, h));
  const tOpts = { minHits: 2, maxAge: 4, gate: Math.max(w, h) / 8 };
  // Phase 3: keep the per-frame trajectories, project each to the board,
  // then read events off the sequence.
  const snaps = BYTETRACK.series(perFrame, tOpts);
  const fps = opts.fps || 10, start = opts.start || 0;
  // auto field: detect the pool on every frame (frames mode is small), fall back to the manual H
  let track = null;
  if (isAuto(cal)) { track = FIELD.timeline(frames.map((f, i) => ({ t: +(start + i / fps).toFixed(2), det: FIELD.detect(f, w, h, { step: 2 }) })), { minConf: cal.minConf || 0.4 }); }
  const Hat = t => { if (track) { const s = FIELD.at(track, t); if (s && s.H) return s.H; } return H; };
  const seriesFrames = snaps.map((s, i) => { const t = +(start + i / fps).toFixed(2), Hi = Hat(t); return Hi ? { t, boardFrame: VISION.toBoardFrame(s, Hi).frame } : null; }).filter(Boolean);
  if (!seriesFrames.length) { const e = new Error('field-not-found'); e.code = 'field-not-found'; throw e; }
  const detected = EVENTS.detect(seriesFrames, {});
  // a representative frame (most players on it) for the formation overview
  let rep = seriesFrames[0] || { t: start, boardFrame: VISION.toBoardFrame({}, H).frame }, best = -1;
  seriesFrames.forEach(sf => { const c = Object.keys(sf.boardFrame.att).length + Object.keys(sf.boardFrame.def).length; if (c > best) { best = c; rep = sf; } });
  const final = snaps.length ? snaps[snaps.length - 1] : { white: [], dark: [], keeper: [], ball: [] };
  const out = {
    engine: 'server', version: ANALYSIS.VERSION,
    tracks: tracksFrom(final),
    frames: seriesFrames.length ? seriesFrames : [{ t: start, boardFrame: rep.boardFrame }],
    events: [{ t: rep.t, type: 'formation', conf: 0.72, frame: rep.boardFrame }].concat(detected),
  };
  if (opts.scout) out.scout = scoutSeries(seriesFrames, detected, opts);
  if (track) out.meta = { field: Object.assign({ mode: 'auto' }, FIELD.stats(track)) };
  return ANALYSIS.normalizeResult(out);
}

/* decode a video with ffmpeg → raw RGBA frames, then framesToResult */
function videoToResult(path, cal, opts) {
  opts = opts || {};
  const w = opts.w || WORK_W, h = opts.h || WORK_H, fps = opts.fps || 10;
  const args = [];
  if (opts.start) args.push('-ss', String(opts.start));
  if (opts.winSec) args.push('-t', String(opts.winSec));
  args.push('-i', path, '-vf', `fps=${fps},scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-');
  return new Promise((resolve, reject) => {
    const ff = spawn(opts.ffmpeg || 'ffmpeg', args);
    const chunks = []; let errBuf = '';
    ff.stdout.on('data', d => chunks.push(d));
    ff.stderr.on('data', d => { errBuf += d.toString(); });
    ff.on('error', e => reject(Object.assign(new Error('ffmpeg-spawn: ' + e.message), { code: 'ffmpeg' })));
    ff.on('close', code => {
      if (code !== 0) return reject(Object.assign(new Error('ffmpeg-exit-' + code + ': ' + errBuf.slice(-300)), { code: 'ffmpeg' }));
      const buf = Buffer.concat(chunks); const frameBytes = w * h * 4;
      const n = Math.floor(buf.length / frameBytes);
      if (!n) return reject(Object.assign(new Error('no-frames-decoded'), { code: 'no-frames' }));
      const frames = [];
      for (let i = 0; i < n; i++) frames.push(buf.subarray(i * frameBytes, (i + 1) * frameBytes));
      try { resolve(framesToResult(frames, w, h, cal, opts)); }
      catch (e) { reject(e); }
    });
  });
}

/* Auto-scout: possessions → distilled plays → recognised tactics → team
   profile → summary → playbook. Pure (TACTICS) — accuracy is bounded by
   the detector feeding it. */
function scoutSeries(seriesFrames, events, opts) {
  opts = opts || {};
  const names = opts.us === 'dark' ? { att: 'Opponent (white caps)', def: 'Us (blue caps)' }
              : opts.us === 'white' ? { att: 'Us (white caps)', def: 'Opponent (blue caps)' } : undefined;
  return TACTICS.scout(seriesFrames, events, { names, maxKeyframes: 6, minConf: 0.5 });
}

/* decode a WHOLE video in chunks (bounded memory), keep timestamps continuous,
   detect+track per chunk, run events on the joined series, then scout it.
   A 1-minute clip or a 1-hour match both go through here (as a background job). */
async function videoToScout(path, cal, opts) {
  opts = opts || {};
  const w = opts.w || WORK_W, h = opts.h || WORK_H, fps = opts.fps || 6, chunkSec = opts.chunkSec || 20;
  const H = homographyOf(cal);
  if (!H && !isAuto(cal)) { const e = new Error('bad-calibration'); e.code = 'bad-calibration'; throw e; }
  const durSec = await probeDuration(path, opts.ffmpeg);
  const total = Math.max(0.5, (opts.winSec ? Math.min(opts.winSec, durSec - (opts.start || 0)) : durSec - (opts.start || 0)));
  const detector = opts.detector || makeDetector({ modelEndpoint: opts.modelEndpoint, step: opts.step, minArea: opts.minArea });
  const series = []; const start = opts.start || 0;
  const auto = isAuto(cal); const samples = []; const every = Math.max(1, Math.round(fps * (opts.fieldEverySec || 1)));   // detect the field about once a second
  let unread = 0;
  for (let t0 = 0; t0 < total; t0 += chunkSec) {
    const frames = await decodeChunk(path, start + t0, Math.min(chunkSec, total - t0), w, h, fps, opts.ffmpeg);
    if (!frames.length) continue;
    const perFrame = []; for (const f of frames) perFrame.push(await detector.detect(f, w, h));
    const snaps = BYTETRACK.series(perFrame, { minHits: 2, maxAge: 4, gate: Math.max(w, h) / 8 });
    let track = null;
    if (auto) {
      frames.forEach((f, i) => { if (i % every === 0) samples.push({ t: +(start + t0 + i / fps).toFixed(2), det: FIELD.detect(f, w, h, { step: 2 }) }); });
      track = FIELD.timeline(samples, { minConf: cal.minConf || 0.4 });   // the whole track so far → hold/decay carries across chunks
    }
    snaps.forEach((snap, i) => {
      const t = +(start + t0 + i / fps).toFixed(2);
      let Hi = H;
      if (track) { const sm = FIELD.at(track, t); Hi = (sm && sm.H) || H; }
      if (!Hi) { unread++; return; }
      series.push({ t, boardFrame: VISION.toBoardFrame(snap, Hi).frame });
    });
    if (typeof opts.onProgress === 'function') opts.onProgress(Math.min(1, (t0 + chunkSec) / total));
  }
  if (!series.length) { const e = new Error('field-not-found'); e.code = 'field-not-found'; throw e; }
  const events = EVENTS.detect(series, {});
  const scout = scoutSeries(series, events, opts);
  const meta = { seconds: total, fps, chunks: Math.ceil(total / chunkSec) };
  if (auto) { const tr = FIELD.timeline(samples, { minConf: cal.minConf || 0.4 }); meta.field = Object.assign({ mode: 'auto', unreadSeconds: +(unread / fps).toFixed(1) }, FIELD.stats(tr), { corners: (tr.find(x => x.corners) || {}).corners || null }); }
  else meta.field = { mode: 'fixed' };
  return ANALYSIS.normalizeResult({ engine: 'server', version: ANALYSIS.VERSION, tracks: [], frames: series.filter((_, i) => i % Math.max(1, Math.round(fps)) === 0), events, scout, meta });
}
function probeDuration(path, ffmpegBin) {
  return new Promise((resolve) => {
    const ff = spawn(ffmpegBin || 'ffmpeg', ['-i', path]); let err = '';
    ff.stderr.on('data', d => err += d.toString());
    ff.on('close', () => { const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/); resolve(m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0); });
    ff.on('error', () => resolve(0));
  });
}
function decodeChunk(path, startSec, lenSec, w, h, fps, ffmpegBin) {
  return new Promise((resolve, reject) => {
    const args = ['-ss', String(startSec), '-t', String(lenSec), '-i', path, '-vf', `fps=${fps},scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'];
    const ff = spawn(ffmpegBin || 'ffmpeg', args); const chunks = [];
    ff.stdout.on('data', d => chunks.push(d)); ff.stderr.on('data', () => {});
    ff.on('error', e => reject(Object.assign(new Error('ffmpeg-spawn: ' + e.message), { code: 'ffmpeg' })));
    ff.on('close', () => { const buf = Buffer.concat(chunks), fb = w * h * 4, n = Math.floor(buf.length / fb); const out = []; for (let i = 0; i < n; i++) out.push(buf.subarray(i * fb, (i + 1) * fb)); resolve(out); });
  });
}

module.exports = { framesToResult, videoToResult, videoToScout, scoutSeries, homographyOf, WORK_W, WORK_H };
