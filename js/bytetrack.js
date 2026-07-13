/* ============================================================
   bytetrack.js — Phase 2 confidence-aware tracker.

   A ByteTrack-style multi-object tracker: it associates in TWO
   stages using each detection's confidence.
     · Stage 1 — match HIGH-confidence detections to tracks.
     · Stage 2 — recover the leftovers by matching LOW-confidence
       detections to the tracks that are still unmatched (this is
       what bridges a player through a blurry / occluded frame).
     · Births — only a HIGH-confidence detection can start a NEW
       track, so isolated low-confidence blobs (splash, glare) never
       become phantom players.

   Same output shape as TRACK.consolidate, so it drops straight into
   VISION.toBoardFrame. Pure and unit-tested; shared by the browser
   and the server. It works with any detector that emits a
   confidence — colour today, a trained model tomorrow.
   ============================================================ */
const BYTETRACK = (() => {
  const CLASSES = ['white', 'dark', 'keeper', 'ball'];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // greedy nearest-neighbour association within class + gate (mutates in place)
  function associate(tracks, dets, gate, alpha) {
    const pairs = [];
    tracks.forEach(t => { if (t._used) return; dets.forEach(d => { if (d._used || d.cls !== t.cls) return; const dd = dist(t, d); if (dd <= gate) pairs.push({ t, d, dd }); }); });
    pairs.sort((a, b) => a.dd - b.dd);
    for (const p of pairs) {
      if (p.t._used || p.d._used) continue;
      p.t._used = true; p.d._used = true;
      const nvx = p.d.x - (p.t.x - p.t.vx), nvy = p.d.y - (p.t.y - p.t.vy);
      p.t.vx = alpha * nvx + (1 - alpha) * p.t.vx;
      p.t.vy = alpha * nvy + (1 - alpha) * p.t.vy;
      p.t.x = p.d.x; p.t.y = p.d.y; p.t.n = p.d.n; p.t.conf = p.d.conf; p.t.hits++; p.t.missed = 0;
    }
  }

  // confirmed tracks grouped by class (drop-in for VISION.toBoardFrame)
  function snapshot(tracks, minHits) {
    const out = { white: [], dark: [], keeper: [], ball: [] };
    tracks.filter(t => t.hits >= minHits && t.missed === 0).forEach(t =>
      (out[t.cls] || (out[t.cls] = [])).push({ x: +t.x.toFixed(1), y: +t.y.toFixed(1), n: t.n, id: t.id, conf: +(t.conf || 0).toFixed(2) }));
    CLASSES.forEach(c => out[c].sort((a, b) => b.n - a.n));
    return out;
  }
  // core two-stage loop; onFrame(tracks) fires after each input frame
  function run(perFrame, opts, onFrame) {
    opts = opts || {};
    const gate = opts.gate || 22, maxAge = opts.maxAge != null ? opts.maxAge : 4,
      alpha = opts.alpha != null ? opts.alpha : 0.5, high = opts.highThresh != null ? opts.highThresh : 0.5;
    let tracks = [], id = 1;
    (perFrame || []).forEach(raw => {
      const dets = (raw || []).map(d => ({ x: d.x, y: d.y, cls: d.cls, conf: d.conf != null ? d.conf : 1, n: d.n || 1, _used: false }));
      tracks.forEach(t => { t.x += t.vx; t.y += t.vy; t.missed++; t._used = false; });   // predict
      const highD = dets.filter(d => d.conf >= high);
      const lowD = dets.filter(d => d.conf < high);
      associate(tracks, highD, gate, alpha);                                   // stage 1
      associate(tracks.filter(t => !t._used), lowD, gate, alpha);              // stage 2 (recover)
      highD.forEach(d => { if (d._used) return; tracks.push({ id: id++, cls: d.cls, x: d.x, y: d.y, vx: 0, vy: 0, n: d.n, conf: d.conf, hits: 1, missed: 0, _used: true }); });
      tracks = tracks.filter(t => t.missed <= maxAge);
      if (onFrame) onFrame(tracks);
    });
    return tracks;
  }

  /* track(perFrame, opts) → final confirmed positions by class */
  function track(perFrame, opts) {
    opts = opts || {};
    return snapshot(run(perFrame, opts), opts.minHits != null ? opts.minHits : 2);
  }
  /* series(perFrame, opts) → one confirmed-position snapshot PER input frame
     (the per-frame trajectories event detection runs on) */
  function series(perFrame, opts) {
    opts = opts || {}; const mh = opts.minHits != null ? opts.minHits : 2;
    const snaps = [];
    run(perFrame, opts, tr => snaps.push(snapshot(tr, mh)));
    return snaps;
  }

  return { CLASSES, track, series };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = BYTETRACK;
