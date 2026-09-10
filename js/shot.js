/* ============================================================
   shot.js — where a shot is worth taking, and what the keeper sees.

   Two things live here, both pure and unit-tested:

   1. SHOT ZONES — the coach's green / yellow / red territory, drawn on
      the board on demand. Geometry (attack → RIGHT goal):
        green  ≤ 4 m out AND within 1 m outside each post   ("~70%")
        yellow ≤ 7 m out AND within 2 m outside each post    ("~30%")
        red    everything else                               ("<10%")
      The percentages are a COACHING GUIDE, not a measurement — see
      docs/SHOT_ZONES.md. Published elite data has no spot-level
      probability; what it does have is situation-level rates
      (penalty ~80-87%, man-up ~48%, even play ~24%) and one solid
      modifier: a defender in the shooting lane costs ~10 percentage
      points (Lupo et al. 2020, 886 World-Championship shots).

   2. THE GOALKEEPER'S VIEW — project the keeper and any defender in
      the lane onto the 3 m goal mouth as seen from the shooter, so a
      player can see how much cage is actually open, where the biggest
      gap is, and what a shot vs a lob is worth from there.

   Board note: the board is drawn anisotropically (10.88 units per metre
   across, 8 per metre down) and the goal mouth is drawn on the ACROSS
   scale. Everything here therefore measures in `pxPerM` on both axes so
   that zones, distances and the goal stay in proportion with each other.
   ============================================================ */
const SHOT = (() => {
  const FALLBACK = { WATER: { x0: 24, y0: 30, x1: 296, y1: 190 }, METERS: 25 };

  /* board geometry, read from POOL when it is loaded (browser + smoke), else derived */
  function geo() {
    const P = (typeof POOL !== 'undefined' && POOL && POOL.WATER) ? POOL : null;
    const W = P ? P.WATER : FALLBACK.WATER;
    const m = P && P.pxPerM ? P.pxPerM : (W.x1 - W.x0) / FALLBACK.METERS;
    const cy = W.y0 + (W.y1 - W.y0) / 2;
    // the board is anisotropic: `m` across (25 m over 272 units) but `mY` down (20 m over 160)
    return { W, m, mY: (W.y1 - W.y0) / 20, cy, goalX: W.x1, half: 1.5 * m };
  }
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------------- 1) zones ---------------- */
  const ZONE_DEF = [
    { id: 'green',  pct: 0.70, label: 'Green — take it', outM: 4, wideM: 1, note: 'In front of goal, inside 4 m and no wider than a metre outside the posts.' },
    { id: 'yellow', pct: 0.30, label: 'Yellow — only if it is open', outM: 7, wideM: 2, note: 'Out to 7 m and up to two metres outside the posts.' },
    { id: 'red',    pct: 0.08, label: 'Red — pass, don’t shoot', outM: null, wideM: null, note: 'Long range or a wide angle: the keeper has time and the cage is short.' },
  ];
  const zoneById = id => ZONE_DEF.find(z => z.id === id) || ZONE_DEF[2];

  /* the rectangle a zone occupies on the board (already clipped to the water) */
  function band(id) {
    const g = geo(), z = zoneById(id);
    if (!z.outM) return null;
    const x = Math.max(g.W.x0, g.goalX - z.outM * g.m);
    const yHalf = g.half + z.wideM * g.m;
    const y0 = Math.max(g.W.y0, g.cy - yHalf), y1 = Math.min(g.W.y1, g.cy + yHalf);
    return { id: z.id, pct: z.pct, label: z.label, x, y: y0, w: g.goalX - x, h: y1 - y0 };
  }
  const bands = () => ['yellow', 'green'].map(band).filter(Boolean);   // draw yellow first, green over it

  function zoneAt(pt) {
    if (!pt || pt.x == null) return zoneById('red');
    const g = geo();
    for (const id of ['green', 'yellow']) {
      const b = band(id);
      if (pt.x >= b.x && pt.y >= g.cy - (b.h / 2) && pt.y <= g.cy + (b.h / 2)) return zoneById(id);
    }
    return zoneById('red');
  }

  /* ---------------- 2) the goalkeeper's view ---------------- */
  const ballPointOf = f => {
    if (!f || !f.ball) return null;
    const c = f.ball.carrier;
    if (!c) return (f.ball.x == null) ? null : { x: f.ball.x, y: f.ball.y };
    if (c === 'GK') return f.gk || null;
    const map = c[0] === 'A' ? f.att : f.def;
    return (map && map[c.slice(1)]) || null;
  };
  const shooterOf = (f, opts) => {
    const key = opts && opts.shooter;
    if (key && f.att && f.att[key]) return { key, at: f.att[key] };
    const c = f && f.ball && f.ball.carrier;
    if (c && c[0] === 'A' && f.att[c.slice(1)]) return { key: c.slice(1), at: f.att[c.slice(1)] };
    if (f && f.shot && f.shot.by && f.att && f.att[f.shot.by]) return { key: f.shot.by, at: f.att[f.shot.by] };
    const p = ballPointOf(f);
    // a loose ball on the goal line is the END of a shot, not a shooting position
    return (p && p.x < geo().goalX - geo().m) ? { key: null, at: p } : null;
  };

  /* Shadow a body of radius r (metres) casts on the goal mouth, seen from `from`.
     Returns a [y0,y1] interval in board units, or null when it covers nothing. */
  function shadow(from, body, radiusM) {
    const g = geo();
    if (!from || !body) return null;
    const dx = g.goalX - from.x;
    if (dx <= 0.5) return null;                       // shooter is on or behind the goal line
    const vx = body.x - from.x, vy = body.y - from.y;
    const r = radiusM * g.m, d = Math.hypot(vx, vy);
    if (d <= r) return [g.cy - g.half, g.cy + g.half]; // body is right on top of the shooter
    if (vx <= r) return null;                          // body is BESIDE or behind the shooter — not in the lane
    if (body.x >= g.goalX) return null;                // body is past the goal line
    // tangent rays either side of the body, in angle space, so no edge can fall behind the shooter
    const base = Math.atan2(vy, vx), half = Math.asin(Math.max(-1, Math.min(1, r / d)));
    const ys = [base - half, base + half].map(th => (Math.cos(th) <= 1e-6) ? null : from.y + dx * Math.tan(th));
    if (ys[0] == null || ys[1] == null) return null;
    const lo = Math.min(ys[0], ys[1]), hi = Math.max(ys[0], ys[1]);
    const y0 = Math.max(lo, g.cy - g.half), y1 = Math.min(hi, g.cy + g.half);
    return (y1 - y0 > 0.5) ? [y0, y1] : null;
  }
  const merge = (iv) => {
    const s = iv.slice().sort((a, b) => a[0] - b[0]), out = [];
    s.forEach(i => { const last = out[out.length - 1]; if (last && i[0] <= last[1]) last[1] = Math.max(last[1], i[1]); else out.push(i.slice()); });
    return out;
  };
  const covered = (iv) => merge(iv).reduce((s, i) => s + (i[1] - i[0]), 0);

  /* goalView(frame, opts) → everything a "what does the keeper see" panel needs.
     All mouth coordinates are normalised 0..1 across the 3 m goal. */
  function goalView(frame, opts) {
    opts = opts || {};
    const g = geo();
    const sh = shooterOf(frame, opts);
    if (!sh) return null;
    const from = sh.at;
    const top = g.cy - g.half, mouth = 2 * g.half;
    const norm = iv => ({ a: clampN((iv[0] - top) / mouth, 0, 1), b: clampN((iv[1] - top) / mouth, 0, 1) });

    const gk = frame.gk || null;                       // a frame with no keeper really has no keeper
    const gkShadow = gk ? shadow(from, gk, opts.keeperReachM || 1.0) : null;
    const keeper = gkShadow ? norm(gkShadow) : null;
    const keeperOutM = gk ? Math.max(0, (g.goalX - gk.x) / g.m) : null;

    const blockers = [];
    Object.keys(frame.def || {}).forEach(k => {
      const s = shadow(from, frame.def[k], opts.blockerReachM || 0.55);
      if (s) blockers.push(Object.assign({ pos: k }, norm(s)));
    });

    const all = (gkShadow ? [gkShadow] : []).concat(blockers.map(b => [top + b.a * mouth, top + b.b * mouth]));
    const coverPct = clampN(covered(all) / mouth, 0, 1);

    // open gaps across the mouth, largest first
    const gaps = []; let cur = 0;
    merge(all).forEach(i => { const a = clampN((i[0] - top) / mouth, 0, 1); if (a - cur > 0.02) gaps.push({ a: cur, b: a }); cur = Math.max(cur, clampN((i[1] - top) / mouth, 0, 1)); });
    if (1 - cur > 0.02) gaps.push({ a: cur, b: 1 });
    // label the gap by the cage, not by "near/far" — which post is near depends on the shooter
    gaps.forEach(x => { x.size = x.b - x.a; x.side = x.b <= 0.45 ? 'the top of the cage' : x.a >= 0.55 ? 'the bottom of the cage' : 'the middle'; });
    gaps.sort((a, b) => b.size - a.size);

    // metres per axis — the board is 10.88 units/m across but 8 units/m down
    const dxM = (g.goalX - from.x) / g.m, dyM = (from.y - g.cy) / g.mY;
    return {
      shooter: sh.key, from: { x: from.x, y: from.y },
      distanceM: +Math.hypot(dxM, dyM).toFixed(1),
      angleDeg: Math.round(Math.abs(Math.atan2(dyM, Math.max(dxM, 0.001)) * 180 / Math.PI)),
      keeper, keeperOutM: keeperOutM == null ? null : +keeperOutM.toFixed(1), keeperMissing: !gk,
      blockers, blockerCount: blockers.length,
      coverPct: +coverPct.toFixed(2), openPct: +(1 - coverPct).toFixed(2),
      gaps, bestGap: gaps[0] || null,
      zone: zoneAt(from).id,
    };
  }

  /* chance(frame, opts) → an honest coach's estimate, rounded to 5%.
       zone base (coaching guide)
       × 0.78 for a blocked lane, × 0.66 with a crowd  (Lupo et al. 2020: 0.432 → 0.335)
       × the keeper's coverage of the sight line, weighted down (the cage is 0.9 m tall)
       situation overrides: penalty ~80%, man-up leans to ~48% */
  function chance(frame, opts) {
    opts = opts || {};
    const view = goalView(frame, opts);
    if (!view) return null;
    const z = zoneById(view.zone);
    const round5 = v => Math.round(clampN(v, 0.03, 0.92) * 20) / 20;

    // Lupo et al. 2020: a blocked lane took shots from 0.432 to 0.335 — a 22% RELATIVE drop.
    // Applied as a factor (not a flat subtraction) it reproduces their result at their own base
    // and can never drive a small base negative.
    let p = z.pct;
    if (view.blockerCount >= 2) p *= 0.66; else if (view.blockerCount === 1) p *= 0.78;
    // the keeper's plan-view coverage overstates the real block (the cage is only 0.9 m tall,
    // and shooters beat a set keeper high, low and into the corners) — weight it accordingly
    const keeperCover = view.keeper ? (view.keeper.b - view.keeper.a) : 0;
    p *= (1 - 0.35 * keeperCover);
    if (opts.situation === 'penalty') p = 0.80;
    else if (opts.manUp) p = p * 0.5 + 0.48 * 0.5;

    // a lob only lives when the keeper has left the line; long lobs get read.
    // NOTE: no study has measured the lob against an advanced keeper — this is a coaching shape.
    let lob = 0.05 + 0.20 * clampN((view.keeperOutM || 0) - 0.4, 0, 2);
    lob *= clampN(1.25 - view.distanceM / 12, 0.25, 1);
    if (view.zone === 'red') lob *= 0.6;
    lob = Math.min(lob, p + 0.15);

    const shootPct = round5(p), lobPct = round5(lob);
    const best = view.bestGap;
    const advice = shootPct >= 0.5
      ? `Shoot${best ? ' — biggest gap is ' + best.side : ''}.`
      : (view.keeperOutM || 0) >= 1.2 && lobPct >= shootPct
        ? 'Keeper is off the line — the lob is the better ball.'
        : view.blockerCount >= 1
          ? 'Blocked lane — move the ball, don’t shoot into the block.'
          : z.id === 'red' ? 'Too far and too wide — work it inside first.' : 'Low percentage — one more pass.';
    return Object.assign({}, view, {
      base: z.pct, shootPct, lobPct, advice,
      basis: view.blockerCount
        ? 'Coach’s guide. The zone band is a coaching convention; the blocked-lane effect is the one published modifier (Lupo 2020).'
        : 'Coach’s guide, not a measurement — the zone bands are a coaching convention, and no study gives a chance for a spot on the pool.',
      lobBasis: 'The lob figure is a coaching shape, not a measured rate: no study has tested the lob against an advanced keeper.',
    });
  }

  /* the frame-level shot marker: { by:'3', kind:'shot'|'lob' } */
  const markShot = (frame, by, kind) => { frame.shot = { by: String(by), kind: kind === 'lob' ? 'lob' : 'shot' }; return frame; };
  const shotOf = f => (f && f.shot && f.shot.by) ? { by: String(f.shot.by), kind: f.shot.kind === 'lob' ? 'lob' : 'shot' } : null;
  /* legacy plays have no marker — a loose ball at the goal line still counts */
  const isShotFrame = f => !!shotOf(f) || !!(f && f.ball && !f.ball.carrier && f.ball.x != null && f.ball.x >= 285);

  return { ZONE_DEF, zoneById, zoneAt, band, bands, geo, goalView, chance, shadow, markShot, shotOf, isShotFrame, ballPointOf, shooterOf };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = SHOT;
