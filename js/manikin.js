/* ============================================================
   manikin.js — a stylized 3D replay camera over the same tactics data.

   No motion capture and no underwater biomechanics exist for this game,
   so this is NOT a recreation of real swimming. It is an honest, stylized
   "broadcast camera" over the same 2D positions the flat board already
   uses: a gender-neutral capped mannequin per player, a pool floor and
   goals built from the same board geometry, and an orbit/zoom camera you
   can point at the whole pool, the ball, or one player.

   Poses (the coach's own spec):
     · a defender in the GREEN zone (the coach's shot-chance territory,
       reused from js/shot.js) raises one arm to block
     · a defender OUTSIDE it takes a wider guarding stance, shadowing the
       passing lane to their own goal
     · the attacker holding the ball always shows the ball raised in hand
     · other attackers face the goal, arms out, ready to receive
     · anyone moving more than a few tenths of a metre between keyframes
       swims — a forward-reaching stroke pose, oriented along the move
   Zone and "who has the ball" are read straight from the tactics data;
   nothing here invents a new source of truth.

   Pure math + pose tables — no DOM, no canvas. The renderer is in app.js.
   Runs standalone (Node tests) with graceful fallbacks when POOL / ANIM /
   SHOT are not loaded.
   ============================================================ */
const MANIKIN = (() => {
  const TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // matches ANIM's easeInOutQuad
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------------- board → world (metres), pool-centred ---------------- */
  function geo() {
    const P = (typeof POOL !== 'undefined' && POOL && POOL.WATER) ? POOL : null;
    const W = P ? P.WATER : { x0: 24, y0: 30, x1: 296, y1: 190 };
    const lenM = 25, widM = 20;                    // 2025 World Aquatics field, matches js/shot.js
    const midX = (W.x0 + W.x1) / 2, midY = (W.y0 + W.y1) / 2;
    return { W, midX, midY, sx: lenM / (W.x1 - W.x0), sy: widM / (W.y1 - W.y0), lenM, widM, goalHalf: 1.5 };
  }
  const toWorld = (pt) => { const g = geo(); return { x: (pt.x - g.midX) * g.sx, z: (pt.y - g.midY) * g.sy }; };

  /* ---------------- the mannequin: a plain capped figure, no gender ---------------- */
  // local body-space joints in metres; origin = water surface at the player's centre; +Y up, +Z = facing direction
  const NEUTRAL = {
    head: [0, 0.55, 0], neck: [0, 0.35, 0], lShoulder: [-0.22, 0.32, 0], rShoulder: [0.22, 0.32, 0],
    lElbow: [-0.30, 0.05, 0.05], rElbow: [0.30, 0.05, 0.05], lHand: [-0.30, -0.15, 0.15], rHand: [0.30, -0.15, 0.15],
    hip: [0, -0.05, 0], lKnee: [-0.12, -0.45, 0], rKnee: [0.12, -0.45, 0], lFoot: [-0.12, -0.85, 0.05], rFoot: [0.12, -0.85, 0.05],
  };
  const pose = (over) => Object.assign({}, NEUTRAL, over);
  const POSES = {
    // outside the green zone: wide guarding stance, shadowing the lane to their own goal
    defGuard: pose({ lHand: [-0.55, 0.05, 0.10], rHand: [0.55, 0.05, 0.10], lElbow: [-0.38, 0.12, 0.08], rElbow: [0.38, 0.12, 0.08], hip: [0, -0.10, 0.05], head: [0, 0.50, 0.05] }),
    // in the green zone: one hand straight up to block
    defBlock: pose({ rHand: [0.15, 0.85, -0.05], rElbow: [0.20, 0.55, -0.02], lHand: [-0.35, -0.05, 0.20], lElbow: [-0.32, 0.10, 0.10] }),
    // the ball is always visibly in hand
    attHold: pose({ rHand: [0.20, 0.75, 0.10], rElbow: [0.25, 0.45, 0.08], lHand: [-0.30, -0.10, 0.15] }),
    // facing goal, arms out, ready to receive
    attReady: pose({ lHand: [-0.42, 0.30, 0.25], rHand: [0.42, 0.30, 0.25], lElbow: [-0.34, 0.28, 0.15], rElbow: [0.34, 0.28, 0.15] }),
    // movement is swimming — a forward stroke, oriented along the travel direction
    swim: pose({ rHand: [0.15, 0.15, 0.65], rElbow: [0.18, 0.20, 0.35], lHand: [-0.45, -0.15, -0.35], lElbow: [-0.35, 0.0, -0.15],
      head: [0.05, 0.40, 0.30], hip: [0, -0.05, 0.10], lFoot: [-0.12, -0.85, -0.15], rFoot: [0.12, -0.85, -0.15] }),
    gk: pose({ lHand: [-0.60, 0.30, 0.05], rHand: [0.60, 0.30, 0.05], lElbow: [-0.42, 0.30, 0.03], rElbow: [0.42, 0.30, 0.03], lFoot: [-0.30, -0.85, 0.05], rFoot: [0.30, -0.85, 0.05] }),
  };
  const BONES = [
    ['head', 'neck'], ['neck', 'lShoulder'], ['neck', 'rShoulder'],
    ['lShoulder', 'lElbow'], ['lElbow', 'lHand'], ['rShoulder', 'rElbow'], ['rElbow', 'rHand'],
    ['neck', 'hip'], ['hip', 'lKnee'], ['lKnee', 'lFoot'], ['hip', 'rKnee'], ['rKnee', 'rFoot'],
  ];
  const CAP = { A: { fill: '#f5f8fa', stroke: '#0b1f2c' }, D: { fill: '#11151c', stroke: '#000' }, GK: { fill: '#e23b3b', stroke: '#7a0f0f' } };

  /* rotate a pose's local joints by facingYaw (around the vertical axis) and place it at a world origin */
  function jointsWorld(poseId, facingYaw, origin) {
    const p = POSES[poseId] || POSES.attReady, c = Math.cos(facingYaw), s = Math.sin(facingYaw);
    const out = {};
    Object.keys(p).forEach(k => { const [lx, ly, lz] = p[k]; out[k] = { x: origin.x + lx * c + lz * s, y: (origin.y || 0) + ly, z: origin.z - lx * s + lz * c }; });
    return out;
  }

  /* ---------------- pose selection — the coach's rules, nothing invented ---------------- */
  const ATTACK_YAW = Math.atan2(1, 0);   // facing +X: the attacked goal
  function poseFor(role, hasBall, zoneId, moving, movementYaw, faceYaw) {
    if (moving) return { poseId: 'swim', facingYaw: movementYaw };
    if (role === 'GK') return { poseId: 'gk', facingYaw: faceYaw };
    if (role === 'A') return { poseId: hasBall ? 'attHold' : 'attReady', facingYaw: ATTACK_YAW };
    return { poseId: zoneId === 'green' ? 'defBlock' : 'defGuard', facingYaw: faceYaw };
  }

  /* ---------------- one interpolated scene: mannequins + the ball, in world space ---------------- */
  function sceneAt(scenario, tGlobal, opts) {
    opts = opts || {};
    const frames = scenario.frames || [];
    if (!frames.length) return { mannequins: [], ball: null };
    const nSeg = Math.max(1, frames.length - 1);
    let g = clampN(tGlobal, 0, 0.99999) * nSeg, idx = Math.floor(g), local = frames.length === 1 ? 0 : g - idx;
    const A = frames[idx], B = frames[Math.min(idx + 1, frames.length - 1)];
    const el = ease(local);
    const moveThreshM = opts.moveThreshM != null ? opts.moveThreshM : 0.35;
    const carrierA = (A.ball && A.ball.carrier) || null, carrierB = (B.ball && B.ball.carrier) || null;
    const carrierNow = local < 0.5 ? carrierA : carrierB;

    const list = [];
    const add = (team, key, ptA, ptB) => {
      if (!ptA) return;
      const pb = ptB || ptA, wa = toWorld(ptA), wb = toWorld(pb);
      const pos = { x: lerp(wa.x, wb.x, el), z: lerp(wa.z, wb.z, el) };
      const distM = Math.hypot(wb.x - wa.x, wb.z - wa.z);
      const moving = distM > moveThreshM;
      const movementYaw = moving ? Math.atan2(wb.x - wa.x, wb.z - wa.z) : 0;
      const fullKey = team === 'GK' ? 'GK' : team + key;
      list.push({ key: fullKey, team, pos, moving, movementYaw, hasBall: fullKey === carrierNow, zone: team === 'D' ? (typeof SHOT !== 'undefined' ? SHOT.zoneAt(ptA).id : 'red') : null });
    };
    Object.keys(A.att || {}).forEach(k => add('A', k, A.att[k], B.att && B.att[k]));
    Object.keys(A.def || {}).forEach(k => add('D', k, A.def[k], B.def && B.def[k]));
    if (A.gk) add('GK', 'GK', A.gk, B.gk);

    // the ball: reuse ANIM.ballPoint (carrier-in-hand offset already correct there) at each keyframe, then lerp in world space
    const ballPointOf = (typeof ANIM !== 'undefined' && ANIM.ballPoint) ? ANIM.ballPoint : (f) => {
      const c = f.ball && f.ball.carrier;
      if (!c) return { x: (f.ball && f.ball.x) || 250, y: (f.ball && f.ball.y) || 110 };
      if (c === 'GK') return f.gk || { x: 292, y: 110 };
      const m = c[0] === 'A' ? f.att : f.def; return (m && m[c.slice(1)]) || { x: 250, y: 110 };
    };
    const ba = toWorld(ballPointOf(A)), bb = toWorld(ballPointOf(B));
    const ballPos = { x: lerp(ba.x, bb.x, el), z: lerp(ba.z, bb.z, el) };

    list.forEach(m => {
      const faceYaw = Math.atan2(ballPos.x - m.pos.x, ballPos.z - m.pos.z);
      const p = poseFor(m.team, m.hasBall, m.zone, m.moving, m.movementYaw, faceYaw);
      m.poseId = p.poseId; m.facingYaw = p.facingYaw;
      m.joints = jointsWorld(p.poseId, p.facingYaw, { x: m.pos.x, y: 0, z: m.pos.z });
    });
    return { mannequins: list, ball: { x: ballPos.x, y: 0.45, z: ballPos.z, held: !!carrierNow } };
  }

  /* ---------------- the pool floor + goals, in world space, for the renderer ---------------- */
  function worldPool() { const g = geo(); return { halfLen: g.lenM / 2, halfWid: g.widM / 2, goalHalf: g.goalHalf }; }
  function goalPosts() {
    const g = geo(), h = 0.9;                 // World Aquatics goal: 3 m wide, 0.9 m tall
    return [g.lenM / 2, -g.lenM / 2].map(x => ({
      x, segs: [[{ x, y: 0, z: -g.goalHalf }, { x, y: h, z: -g.goalHalf }], [{ x, y: h, z: -g.goalHalf }, { x, y: h, z: g.goalHalf }], [{ x, y: h, z: g.goalHalf }, { x, y: 0, z: g.goalHalf }]],
    }));
  }
  /* the same green/yellow bands the 2D "Zones" toggle draws, as floor quads (attacked goal only) */
  function zoneFloorQuads() {
    if (typeof SHOT === 'undefined') return [];
    const COLOR = { green: '#2ecc71', yellow: '#ffd166' };
    return SHOT.bands().map(b => {
      const c1 = toWorld({ x: b.x, y: b.y }), c2 = toWorld({ x: b.x + b.w, y: b.y + b.h });
      return { color: COLOR[b.id], x0: Math.min(c1.x, c2.x), x1: Math.max(c1.x, c2.x), z0: Math.min(c1.z, c2.z), z1: Math.max(c1.z, c2.z) };
    });
  }

  /* ---------------- orbit camera + perspective projection ---------------- */
  function makeCamera(overrides) { return Object.assign({ yaw: -0.6, pitch: 0.5, dist: 14, target: { x: 0, y: 0.3, z: 0 }, fov: 0.85 }, overrides || {}); }
  function orbit(cam, dyaw, dpitch, ddist) {
    return Object.assign({}, cam, {
      yaw: (cam.yaw + dyaw) % TAU,
      pitch: clampN(cam.pitch + dpitch, 0.08, 1.45),
      dist: clampN(cam.dist + ddist, 1.5, 32),
    });
  }
  function eyeOf(cam) {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    return { x: cam.target.x + cam.dist * cp * Math.sin(cam.yaw), y: cam.target.y + cam.dist * sp, z: cam.target.z + cam.dist * cp * Math.cos(cam.yaw) };
  }
  function project(cam, p, viewport) {
    const eye = eyeOf(cam);
    let fx = cam.target.x - eye.x, fy = cam.target.y - eye.y, fz = cam.target.z - eye.z;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let rx = fy * 0 - fz * 1, ry = fz * 0 - fx * 0, rz = fx * 1 - fy * 0;         // right = forward × worldUp(0,1,0)
    const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx; // true up = right × forward
    const px = p.x - eye.x, py = (p.y || 0) - eye.y, pz = p.z - eye.z;
    const vx = px * rx + py * ry + pz * rz, vy = px * ux + py * uy + pz * uz, vz = px * fx + py * fy + pz * fz;
    if (vz <= 0.05) return null;
    const scale = (viewport.h / 2) / Math.tan((cam.fov || 0.85) / 2);
    return { x: viewport.w / 2 + (vx / vz) * scale, y: viewport.h / 2 - (vy / vz) * scale, depth: vz, scale: scale / vz };
  }

  return { geo, toWorld, POSES, BONES, CAP, jointsWorld, poseFor, sceneAt, worldPool, goalPosts, zoneFloorQuads, makeCamera, orbit, eyeOf, project };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = MANIKIN;
