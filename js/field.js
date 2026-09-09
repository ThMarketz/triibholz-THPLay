/* ============================================================
   field.js — find the pool in a frame, no clicking, moving camera OK.

   A water polo pool is one big blue region. We
     1. mask the water (HSV blue),
     2. fit straight edges to the mask's left / right / top / bottom
        boundaries (trimmed least squares — gutters, splash and
        people on the edge are ignored),
     3. intersect the edges → the four corners → a homography onto the
        board (VISION.solveHomography),
     4. score it (coverage, straightness, size) → confidence 0..1.
   `timeline()` then turns per-second detections into a track for a
   MOVING camera: good detections are smoothed, weak ones hold the last
   good field with decaying confidence, and below `minConf` the frames
   are UNREAD (reported, never guessed).
   Lane-line anchors (red 2 m / yellow 5 m lines) are a documented seam:
   `refineWithLines()` returns its input today.
   Pure; browser + server. Depends on VISION for hsv + homography.
   ============================================================ */
const FIELD = (() => {
  const V = () => (typeof VISION !== 'undefined' ? VISION : (typeof require === 'function' ? require('./vision.js') : null));
  const isWater = (r, g, b) => { const { h, s, v } = V().rgb2hsv(r, g, b); return v > 0.12 && s > 0.25 && h >= 165 && h <= 250; };

  /* water mask on a step-sampled grid → { mask(Uint8Array gw*gh), gw, gh, step, coverage } */
  function waterMask(data, W, H, opts) {
    const step = (opts && opts.step) || 2;
    const gw = Math.floor(W / step), gh = Math.floor(H / step);
    const mask = new Uint8Array(gw * gh); let n = 0;
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const i = ((gy * step) * W + gx * step) * 4;
      if (isWater(data[i], data[i + 1], data[i + 2])) { mask[gy * gw + gx] = 1; n++; }
    }
    return { mask, gw, gh, step, coverage: n / (gw * gh) };
  }
  // trimmed least-squares line x = a*y + b (for left/right edges) or y = a*x + b (top/bottom)
  function fitLine(pts, trim) {
    if (pts.length < 4) return null;
    const fit = P => { const n = P.length; let sx = 0, sy = 0, sxy = 0, sxx = 0; P.forEach(([x, y]) => { sx += x; sy += y; sxy += x * y; sxx += x * x; }); const d = n * sxx - sx * sx || 1e-9; const a = (n * sxy - sx * sy) / d; return { a, b: (sy - a * sx) / n }; };
    let l = fit(pts);
    // drop the worst residuals (gutters, arms, splash) and refit
    const res = pts.map(([x, y]) => Math.abs(y - (l.a * x + l.b))).sort((p, q) => p - q);
    const cut = res[Math.floor(res.length * (1 - (trim || 0.25)))] || Infinity;
    const keep = pts.filter(([x, y]) => Math.abs(y - (l.a * x + l.b)) <= cut);
    if (keep.length >= 4) l = fit(keep);
    const rms = Math.sqrt(keep.reduce((s, [x, y]) => s + Math.pow(y - (l.a * x + l.b), 2), 0) / Math.max(1, keep.length));
    return { a: l.a, b: l.b, rms, n: keep.length };
  }
  /* edges of the mask → 4 lines → corners (in video pixels) */
  function quadFromMask(m) {
    const { mask, gw, gh, step } = m;
    const L = [], R = [], T = [], B = [];
    for (let y = 0; y < gh; y++) { let l = -1, r = -1; for (let x = 0; x < gw; x++) if (mask[y * gw + x]) { if (l < 0) l = x; r = x; } if (l >= 0 && r - l >= gw * 0.15) { L.push([y, l]); R.push([y, r]); } }
    for (let x = 0; x < gw; x++) { let t = -1, b = -1; for (let y = 0; y < gh; y++) if (mask[y * gw + x]) { if (t < 0) t = y; b = y; } if (t >= 0 && b - t >= gh * 0.15) { T.push([x, t]); B.push([x, b]); } }
    if (L.length < 6 || T.length < 6) return null;
    const lL = fitLine(L), lR = fitLine(R), lT = fitLine(T), lB = fitLine(B);   // L/R: x = a*y + b ; T/B: y = a*x + b
    if (!lL || !lR || !lT || !lB) return null;
    // intersect x = a1*y + b1 with y = a2*x + b2  →  x = a1*(a2*x + b2) + b1
    const X = (lv, lh) => { const x = (lv.a * lh.b + lv.b) / (1 - lv.a * lh.a || 1e-9); return { x: x * step, y: (lh.a * x + lh.b) * step }; };
    const corners = [X(lL, lT), X(lR, lT), X(lR, lB), X(lL, lB)];   // TL, TR, BR, BL
    const straight = 1 - Math.min(1, (lL.rms + lR.rms + lT.rms + lB.rms) / 4 / Math.max(4, gh * 0.08));
    return { corners: corners.map(c => ({ x: +c.x.toFixed(1), y: +c.y.toFixed(1) })), straight, support: Math.min(L.length / gh, T.length / gw) };
  }
  const area = c => Math.abs((c[0].x * c[1].y - c[1].x * c[0].y) + (c[1].x * c[2].y - c[2].x * c[1].y) + (c[2].x * c[3].y - c[3].x * c[2].y) + (c[3].x * c[0].y - c[0].x * c[3].y)) / 2;
  const sane = (c, W, H) => c.every(p => isFinite(p.x) && isFinite(p.y) && p.x > -W * 0.5 && p.x < W * 1.5 && p.y > -H * 0.5 && p.y < H * 1.5) && c[1].x > c[0].x + W * 0.2 && c[2].x > c[3].x + W * 0.2 && c[3].y > c[0].y + H * 0.2 && c[2].y > c[1].y + H * 0.2;

  /* detect(rgba, W, H, opts) → { found, corners, H, confidence, coverage, why } */
  function detect(data, W, H, opts) {
    opts = opts || {};
    const m = waterMask(data, W, H, opts);
    if (m.coverage < (opts.minCoverage || 0.12)) return { found: false, confidence: 0, coverage: +m.coverage.toFixed(2), why: 'not enough water in view' };
    const q = quadFromMask(m);
    if (!q || !sane(q.corners, W, H)) return { found: false, confidence: 0, coverage: +m.coverage.toFixed(2), why: 'pool edges not clear' };
    const sizeScore = Math.min(1, area(q.corners) / (W * H) / 0.35);
    const confidence = +Math.max(0, Math.min(1, 0.45 * q.straight + 0.35 * sizeScore + 0.2 * Math.min(1, q.support / 0.6))).toFixed(2);
    const Hm = V().solveHomography(q.corners, V().boardCorners());
    if (!Hm) return { found: false, confidence: 0, coverage: +m.coverage.toFixed(2), why: 'degenerate corners' };
    return { found: true, corners: q.corners, H: Hm, confidence, coverage: +m.coverage.toFixed(2), why: null };
  }
  /* seam: lane-line anchors (red 2 m / yellow 5 m lines) would refine the corners here */
  function refineWithLines(det) { return det; }

  /* moving camera: per-sample detections → a track with hold/decay + smoothing.
     samples = [{ t, det }] (sorted); returns [{ t, H, corners, confidence, held }] */
  function timeline(samples, opts) {
    opts = opts || {}; const minConf = opts.minConf || 0.4, decay = opts.decay || 0.85, alpha = opts.alpha || 0.5;
    const out = []; let last = null, lastConf = 0;
    samples.forEach(({ t, det }) => {
      if (det && det.found && det.confidence >= minConf) {
        let corners = det.corners;
        if (last && last.corners) { // smooth small moves (a panning camera), jump on big ones (a cut)
          const jump = Math.max(...corners.map((c, i) => Math.hypot(c.x - last.corners[i].x, c.y - last.corners[i].y)));
          if (jump < (opts.jumpPx || 60)) corners = corners.map((c, i) => ({ x: +(last.corners[i].x + alpha * (c.x - last.corners[i].x)).toFixed(1), y: +(last.corners[i].y + alpha * (c.y - last.corners[i].y)).toFixed(1) }));
        }
        const Hm = V().solveHomography(corners, V().boardCorners()) || det.H;
        last = { corners, H: Hm }; lastConf = det.confidence;
        out.push({ t, H: Hm, corners, confidence: det.confidence, held: false });
      } else if (last) {
        lastConf = +(lastConf * decay).toFixed(3);
        out.push({ t, H: lastConf >= minConf ? last.H : null, corners: last.corners, confidence: lastConf, held: true });
      } else out.push({ t, H: null, corners: null, confidence: 0, held: false });
    });
    return out;
  }
  const at = (track, t) => { let best = null; for (const s of track) { if (s.t <= t + 1e-6) best = s; else break; } return best || track[0] || null; };
  function stats(track) { const n = track.length || 1, read = track.filter(s => s.H).length; return { samples: track.length, readPct: Math.round(100 * read / n), avgConfidence: +(track.reduce((s, x) => s + (x.H ? x.confidence : 0), 0) / n).toFixed(2), held: track.filter(s => s.held && s.H).length }; }

  return { detect, waterMask, quadFromMask, fitLine, refineWithLines, timeline, at, stats, isWater };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = FIELD;
