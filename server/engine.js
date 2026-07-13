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
const VISION = global.VISION, ANALYSIS = global.ANALYSIS, BYTETRACK = global.BYTETRACK, EVENTS = global.EVENTS;
const { makeDetector } = require('./detector.js');

const WORK_W = 320, WORK_H = 180;   // analysis resolution

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
  if (!H) { const e = new Error('bad-calibration'); e.code = 'bad-calibration'; throw e; }
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
  const seriesFrames = snaps.map((s, i) => ({ t: +(start + i / fps).toFixed(2), boardFrame: VISION.toBoardFrame(s, H).frame }));
  const detected = EVENTS.detect(seriesFrames, {});
  // a representative frame (most players on it) for the formation overview
  let rep = seriesFrames[0] || { t: start, boardFrame: VISION.toBoardFrame({}, H).frame }, best = -1;
  seriesFrames.forEach(sf => { const c = Object.keys(sf.boardFrame.att).length + Object.keys(sf.boardFrame.def).length; if (c > best) { best = c; rep = sf; } });
  const final = snaps.length ? snaps[snaps.length - 1] : { white: [], dark: [], keeper: [], ball: [] };
  return ANALYSIS.normalizeResult({
    engine: 'server', version: ANALYSIS.VERSION,
    tracks: tracksFrom(final),
    frames: seriesFrames.length ? seriesFrames : [{ t: start, boardFrame: rep.boardFrame }],
    events: [{ t: rep.t, type: 'formation', conf: 0.72, frame: rep.boardFrame }].concat(detected),
  });
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

module.exports = { framesToResult, videoToResult, homographyOf, WORK_W, WORK_H };
