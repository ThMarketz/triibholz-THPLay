/* ============================================================
   track.js — Tier 2 hardened detection.

   Tier 1 reads colours frame-by-frame, so it flickers, mistakes
   splash sparkle for a cap, and loses a player the instant an arm
   covers the head. Tier 2 fixes that with classical computer
   vision — no model download, still 100% offline:

     · ccLabels / detectCC — proper connected-component blobs with
       an area filter, so splash speckle and reflections are rejected
       and a fragmented cap is merged into one region.
     · Tracker          — a lightweight multi-object tracker
       (greedy assignment + constant-velocity prediction + track
       birth/death). It BRIDGES occluded frames and keeps a stable
       identity per player.
     · consolidate      — runs frames through the tracker and returns
       only confirmed, occlusion-bridged positions, killing the
       one-frame flicker Tier 1 suffers from.

   Deterministic and unit-tested; the browser glue lives in film.js.
   A bundled neural detector (ONNX/TF.js) is a separate future step.
   ============================================================ */
const TRACK = (() => {

  const CLASSES = ['white', 'dark', 'keeper', 'ball'];

  /* ---- connected components on a binary mask (8-connectivity) ---- */
  function ccLabels(mask, W, H, minArea) {
    minArea = minArea || 1;
    const seen = new Uint8Array(W * H);
    const comps = [];
    const stack = [];
    for (let s = 0; s < W * H; s++) {
      if (!mask[s] || seen[s]) continue;
      let sx = 0, sy = 0, area = 0, minx = W, miny = H, maxx = 0, maxy = 0;
      stack.length = 0; stack.push(s); seen[s] = 1;
      while (stack.length) {
        const p = stack.pop(); const x = p % W, y = (p / W) | 0;
        sx += x; sy += y; area++;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const np = ny * W + nx;
          if (mask[np] && !seen[np]) { seen[np] = 1; stack.push(np); }
        }
      }
      if (area >= minArea) comps.push({ cx: sx / area, cy: sy / area, area, minx, miny, maxx, maxy });
    }
    return comps;
  }

  /* ---- per-class blob detection at a reduced resolution ---- */
  function detectCC(data, W, H, opts) {
    opts = opts || {};
    if (typeof VISION === 'undefined') return { white: [], dark: [], keeper: [], ball: [] };
    const step = opts.step || 2;
    const mw = Math.ceil(W / step), mh = Math.ceil(H / step);
    const minArea = opts.minArea != null ? opts.minArea : 2;
    const maxArea = opts.maxArea != null ? opts.maxArea : mw * mh; // reject wall-sized reflections
    const masks = {}; CLASSES.forEach(c => masks[c] = new Uint8Array(mw * mh));
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        const i = (y * W + x) * 4;
        const cls = VISION.classifyCap(data[i], data[i + 1], data[i + 2]);
        if (cls) masks[cls][((y / step) | 0) * mw + ((x / step) | 0)] = 1;
      }
    }
    const out = {};
    CLASSES.forEach(cls => {
      out[cls] = ccLabels(masks[cls], mw, mh, minArea)
        .filter(c => c.area <= maxArea)
        .map(c => ({ x: c.cx * step, y: c.cy * step, n: c.area,
          w: (c.maxx - c.minx + 1) * step, h: (c.maxy - c.miny + 1) * step }))
        .sort((a, b) => b.n - a.n);
    });
    return out;
  }

  /* ---- multi-object tracker ---- */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function Tracker(opts) {
    opts = opts || {};
    this.gate = opts.gate || 22;      // max match distance (video px)
    this.maxAge = opts.maxAge != null ? opts.maxAge : 3;  // frames a track survives unseen
    this.minHits = opts.minHits != null ? opts.minHits : 2; // hits before "confirmed"
    this.alpha = opts.alpha != null ? opts.alpha : 0.5;    // velocity smoothing
    this.tracks = [];
    this._id = 1;
  }
  Tracker.prototype.update = function (dets) {
    // 1) predict every track forward one step (bridges occluded frames)
    this.tracks.forEach(t => { t.x += t.vx; t.y += t.vy; t.missed++; t.matched = false; });
    // 2) greedy nearest-neighbour assignment within class + gate
    const pairs = [];
    this.tracks.forEach((t, ti) => (dets || []).forEach((d, di) => {
      if (d.cls !== t.cls) return;
      const dd = dist(t, d); if (dd <= this.gate) pairs.push({ ti, di, dd });
    }));
    pairs.sort((a, b) => a.dd - b.dd);
    const usedT = new Set(), usedD = new Set();
    for (const p of pairs) {
      if (usedT.has(p.ti) || usedD.has(p.di)) continue;
      usedT.add(p.ti); usedD.add(p.di);
      const t = this.tracks[p.ti], d = dets[p.di];
      const nvx = d.x - (t.x - t.vx), nvy = d.y - (t.y - t.vy);
      t.vx = this.alpha * nvx + (1 - this.alpha) * t.vx;
      t.vy = this.alpha * nvy + (1 - this.alpha) * t.vy;
      t.x = d.x; t.y = d.y; t.n = d.n; t.hits++; t.missed = 0; t.matched = true;
    }
    // 3) unmatched detections → new tracks
    (dets || []).forEach((d, di) => {
      if (usedD.has(di)) return;
      this.tracks.push({ id: this._id++, cls: d.cls, x: d.x, y: d.y, vx: 0, vy: 0, n: d.n || 1, hits: 1, missed: 0, matched: true });
    });
    // 4) retire stale tracks
    this.tracks = this.tracks.filter(t => t.missed <= this.maxAge);
    return this.tracks;
  };
  Tracker.prototype.confirmed = function () {
    return this.tracks.filter(t => t.hits >= this.minHits && t.missed === 0);
  };

  /* ---- temporal fusion: frames of per-class dets → stable positions ---- */
  function consolidate(perFrame, opts) {
    const tr = new Tracker(opts);
    (perFrame || []).forEach(f => {
      const flat = [];
      CLASSES.forEach(cls => (f[cls] || []).forEach(d => flat.push({ x: d.x, y: d.y, n: d.n, cls })));
      tr.update(flat);
    });
    const out = { white: [], dark: [], keeper: [], ball: [] };
    tr.confirmed().forEach(t => out[t.cls].push({ x: +t.x.toFixed(1), y: +t.y.toFixed(1), n: t.n, id: t.id }));
    CLASSES.forEach(c => out[c].sort((a, b) => b.n - a.n));
    return out;
  }

  return { CLASSES, ccLabels, detectCC, Tracker, consolidate };
})();
