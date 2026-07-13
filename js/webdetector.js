/* ============================================================
   webdetector.js — T2b on-device detector seam.

   The browser mirror of the server's pluggable detector: on-device
   detection is behind ONE interface, so an in-browser neural model
   drops straight into the SAME tracking pipeline the colour engine
   uses. No model is bundled here (a real ONNX/TF.js runtime + weights
   is a large, separate download — the external step); this module is
   the seam it clicks into, plus all the model-agnostic glue —
   score-thresholding, class mapping and non-max suppression — that a
   detector needs, fully unit-tested.

   A "model pack" (its own script that pulls a runtime + weights) does:
     WEBDETECTOR.register(async (frame, W, H) => ([
       { x, y, w, h, cls:'white'|'dark'|'keeper'|'ball', conf }, …
     ]), 'my-wp-detector');
   …and from then on the Film Room's Hardened tracking uses the model.
   Call register(null) to fall back to the colour engine.
   ============================================================ */
const WEBDETECTOR = (() => {
  const CLASSES = ['white', 'dark', 'keeper', 'ball'];
  let _infer = null, _name = 'colour';

  function register(infer, name) { _infer = (typeof infer === 'function') ? infer : null; _name = _infer ? (name || 'model') : 'colour'; return status(); }
  function status() { return { detector: _infer ? 'model' : 'colour', name: _name, hasModel: !!_infer }; }

  // IoU on centre-boxes {x,y,w,h}
  function corners(b) { const w = b.w || 8, h = b.h || 8; return { x1: b.x - w / 2, y1: b.y - h / 2, x2: b.x + w / 2, y2: b.y + h / 2 }; }
  function iou(a, b) {
    const A = corners(a), B = corners(b);
    const ix = Math.max(0, Math.min(A.x2, B.x2) - Math.max(A.x1, B.x1));
    const iy = Math.max(0, Math.min(A.y2, B.y2) - Math.max(A.y1, B.y1));
    const inter = ix * iy, areaA = (A.x2 - A.x1) * (A.y2 - A.y1), areaB = (B.x2 - B.x1) * (B.y2 - B.y1);
    return inter / (areaA + areaB - inter || 1);
  }
  // greedy non-max suppression, per class
  function nms(dets, iouT) {
    iouT = iouT != null ? iouT : 0.45;
    const out = [];
    CLASSES.forEach(cls => {
      const g = dets.filter(d => d.cls === cls).sort((a, b) => b.conf - a.conf);
      const kept = [];
      g.forEach(d => { if (kept.every(k => iou(k, d) <= iouT)) kept.push(d); });
      out.push(...kept);
    });
    return out;
  }
  // raw model output → clean detections (drop unknown classes / low scores, then NMS)
  function postprocess(raw, opts) {
    opts = opts || {};
    const st = opts.scoreThresh != null ? opts.scoreThresh : 0.3;
    const it = opts.iouThresh != null ? opts.iouThresh : 0.45;
    const keep = (raw || [])
      .filter(d => CLASSES.indexOf(d.cls) >= 0 && (d.conf == null || d.conf >= st))
      .map(d => ({ x: d.x, y: d.y, w: d.w || 8, h: d.h || 8, cls: d.cls, conf: d.conf != null ? d.conf : 0.9, n: d.n || (d.w && d.h ? d.w * d.h : 16) }));
    return nms(keep, it);
  }

  const colourByClass = (frame, W, H) => (typeof TRACK !== 'undefined')
    ? TRACK.detectCC(frame, W, H, { step: 2, minArea: 3 })
    : { white: [], dark: [], keeper: [], ball: [] };

  // flat detections [{x,y,cls,conf,n}] — model when registered, colour otherwise
  async function detectFlat(frame, W, H) {
    if (_infer) return postprocess(await _infer(frame, W, H), {});
    const byc = colourByClass(frame, W, H); const out = [];
    CLASSES.forEach(cls => (byc[cls] || []).forEach(b => out.push({ x: b.x, y: b.y, cls, n: b.n, conf: b.conf != null ? b.conf : 0.6 })));
    return out;
  }
  // per-class detections (the shape the on-device tracker consumes)
  async function detectByClass(frame, W, H) {
    if (!_infer) return colourByClass(frame, W, H);
    const out = { white: [], dark: [], keeper: [], ball: [] };
    (await detectFlat(frame, W, H)).forEach(d => (out[d.cls] || (out[d.cls] = [])).push({ x: d.x, y: d.y, n: d.n, conf: d.conf }));
    return out;
  }

  return { CLASSES, register, status, iou, nms, postprocess, detectFlat, detectByClass };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = WEBDETECTOR;
