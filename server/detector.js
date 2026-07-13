/* ============================================================
   server/detector.js — Phase 2 pluggable detector.

   Detection is now behind an interface, so the pipeline doesn't
   care WHAT finds the players:
     · colourDetector — the classical cap/ball colour + connected-
       component detector (default, offline, no model).
     · remoteDetector — POSTs each frame to a MODEL-SERVING endpoint
       and reads back detections. This is the seam a trained model
       drops into: stand up a server that implements the contract,
       set MODEL_ENDPOINT (or pass modelEndpoint per request), done.

   Model-serving contract:
     POST <endpoint>  { w, h, frame:[r,g,b,a,…] }
       → { detections: [ { x, y, w?, h?, cls:'white'|'dark'|'keeper'|'ball', conf } ] }
     (x,y in the same pixel space as the frame; the pipeline maps
      them to the board with the calibration homography.)
   ============================================================ */
'use strict';
global.VISION = global.VISION || require('../js/vision.js');
global.TRACK = global.TRACK || require('../js/track.js');
const TRACK = global.TRACK;

function flattenColour(byClass) {
  const out = [];
  ['white', 'dark', 'keeper', 'ball'].forEach(cls =>
    (byClass[cls] || []).forEach(b => out.push({ x: b.x, y: b.y, cls, n: b.n, conf: b.conf != null ? b.conf : 0.6 })));
  return out;
}
function colourDetector(opts) {
  opts = opts || {};
  return {
    name: 'colour',
    async detect(frame, W, H) { return flattenColour(TRACK.detectCC(frame, W, H, { step: opts.step || 2, minArea: opts.minArea || 3 })); },
  };
}
function remoteDetector(endpoint) {
  return {
    name: 'model:' + endpoint,
    async detect(frame, W, H) {
      const arr = Array.isArray(frame) ? frame : Array.from(frame);
      const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ w: W, h: H, frame: arr }) });
      if (!r.ok) throw Object.assign(new Error('model-http-' + r.status), { code: 'model' });
      const j = await r.json();
      return (j.detections || []).map(d => ({
        x: d.x, y: d.y, cls: d.cls,
        conf: d.conf != null ? d.conf : 0.9,
        n: d.n != null ? d.n : (d.w && d.h ? d.w * d.h : 20),
      }));
    },
  };
}
function makeDetector(cfg) {
  cfg = cfg || {};
  return cfg.modelEndpoint ? remoteDetector(cfg.modelEndpoint) : colourDetector(cfg);
}

module.exports = { makeDetector, colourDetector, remoteDetector, flattenColour };
