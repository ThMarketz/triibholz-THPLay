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
const VISION = global.VISION, TRACK = global.TRACK, ANALYSIS = global.ANALYSIS;

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
function framesToResult(frames, w, h, cal, opts) {
  opts = opts || {};
  const H = homographyOf(cal);
  if (!H) { const e = new Error('bad-calibration'); e.code = 'bad-calibration'; throw e; }
  if (!frames || !frames.length) { const e = new Error('no-frames'); e.code = 'no-frames'; throw e; }
  const perFrame = frames.map(f => TRACK.detectCC(f, w, h, { step: opts.step || 2, minArea: opts.minArea || 3 }));
  const con = TRACK.consolidate(perFrame, { minHits: 2, maxAge: 4, gate: Math.max(w, h) / 8 });
  const board = VISION.toBoardFrame(con, H).frame;
  const t = opts.start || 0;
  return ANALYSIS.normalizeResult({
    engine: 'server', version: ANALYSIS.VERSION,
    tracks: tracksFrom(con),
    frames: [{ t, boardFrame: board }],
    events: [{ t, type: 'formation', conf: 0.72, frame: board }],
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
