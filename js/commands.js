/* ============================================================
   commands.js — Tactical Commands ("Audibles"), v2.

   A coach presses a command and the board executes a KNOWN water polo
   movement — the ones taught in coach education (World Aquatics / USA
   Water Polo coaching curricula and the classic club schools), not
   invented moves. Each command is a pure transform on the current board
   frame → one or more movement STEPS (arrows are drawn between them)
   plus per-position assignment notes, a `why` (the principle behind it)
   and `when` (the game situation it answers).

   Board geometry (attack → right goal):
     goal line x≈294 · 2 m line x≈271 · 5 m x≈248 · 6–7 m "point" x≈226
     centre y=110 · left wing y≈50 · right wing y≈170
   Standard 6v6 "umbrella / 3-3" set used by the defaults:
     1 left wing · 2 left flat (driver) · 3 point · 4 right flat (driver)
     5 right wing · 6 centre forward (hole / 2 m set)
   Roles are read from the frame's geometry (deepest = centre forward,
   extremes = wings, shallowest = point), so a command works on any frame.
   Defenders are matched to the attacker they mark (nearest).
   ============================================================ */
const COMMANDS = (() => {

  const GOALX = 290, HOLEX = 271, FIVEX = 248, POINTX = 226, CY = 110, LWY = 50, RWY = 170;
  const clone = o => JSON.parse(JSON.stringify(o));
  const clamp = p => ({ x: Math.max(28, Math.min(292, Math.round(p.x))), y: Math.max(34, Math.min(186, Math.round(p.y))) });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const keys = o => Object.keys(o || {});
  const SOURCE = 'Standard tactic from coach-education curricula (World Aquatics / USA Water Polo) and the classic club schools.';

  function carrierPt(f) {
    const c = f.ball && f.ball.carrier;
    if (!c) return f.ball && f.ball.x != null ? { x: f.ball.x, y: f.ball.y } : null;
    if (c === 'GK') return f.gk;
    const map = c[0] === 'A' ? f.att : f.def;
    return map[c.slice(1)] || null;
  }
  const carrierKey = f => (f.ball && f.ball.carrier && f.ball.carrier[0] === 'A') ? f.ball.carrier.slice(1) : null;
  function nearestKey(map, pt, used) {
    let best = null, bd = 1e9;
    keys(map).forEach(k => { if (used && used.has(k)) return; const d = dist(map[k], pt); if (d < bd) { bd = d; best = k; } });
    return best;
  }
  /* read the umbrella from geometry: hole (deepest), wings (extreme y), point (shallowest), flats (the rest) */
  function roles(f) {
    const ks = keys(f.att); if (!ks.length) return {};
    const used = new Set();
    const pick = (fn) => { let b = null, bv = -Infinity; ks.forEach(k => { if (used.has(k)) return; const v = fn(f.att[k]); if (v > bv) { bv = v; b = k; } }); if (b) used.add(b); return b; };
    const hole = pick(p => p.x);
    const lw = pick(p => -p.y), rw = pick(p => p.y);
    const point = pick(p => -p.x);
    const rest = ks.filter(k => !used.has(k)).sort((a, b) => f.att[a].y - f.att[b].y);
    return { hole, lw, rw, point, lf: rest[0] || null, rf: rest[1] || null, all: ks };
  }
  const marker = (f, atkKey, used) => f.att[atkKey] ? nearestKey(f.def, f.att[atkKey], used) : null;
  const ballSide = f => { const b = carrierPt(f); return b && b.y > CY ? 'right' : 'left'; };   // which wing side the ball is on
  const sideY = side => side === 'right' ? RWY : LWY;
  // notes share ONE namespace (attacker '3', defender '3' and 'GK' all write the same slot),
  // so never overwrite — append.
  const note = (notes, k, txt) => { if (!k || !txt) return; notes[k] = notes[k] ? notes[k] + ' ' + txt : txt; };
  const pickTarget = (base, ctx, fallback) => (ctx.target !== 'team' && base.att[ctx.target]) ? ctx.target : fallback;
  const pickDef = (base, ctx, fallback) => (ctx.target !== 'team' && base.def[ctx.target]) ? ctx.target : fallback;

  /* Every build() gets (base, ctx) and returns { steps:[frame,…], notes:{pos:txt} } — positions AFTER the move. */
  const LIST = [

    /* ================= OFFENSE ================= */
    { id: 'flat-drive', side: 'offense', scope: 'player', icon: '🏊', name: 'Drive from the flat (with rotation)',
      when: 'Even (6v6) against a pressing defence, ball on the point or the far flat.',
      cue: 'The flat (driver) beats their defender inside-water and drives to the goal; the wing behind rotates up to fill the flat so the umbrella keeps its shape.',
      why: 'The drive forces the hole defender or the wing defender to help. If nobody helps, the driver is free at 2 m; if someone helps, a teammate is open — the classic "drive and read".',
      build(base, ctx) {
        const R = roles(base); const side = ballSide(base) === 'right' ? 'left' : 'right';     // drive on the side AWAY from the ball
        const driver = pickTarget(base, ctx, side === 'left' ? R.lf : R.rf) || R.lf || R.rf; if (!driver) return null;
        const wing = base.att[driver].y < CY ? R.lw : R.rw;
        const s1 = clone(base);
        s1.att[driver] = clamp({ x: FIVEX + 8, y: base.att[driver].y < CY ? CY - 26 : CY + 26 });   // beat the defender, inside water
        if (wing && wing !== driver) s1.att[wing] = clamp({ x: base.att[driver].x, y: base.att[driver].y });   // rotation: wing fills the flat
        const s2 = clone(s1);
        s2.att[driver] = clamp({ x: HOLEX - 2, y: base.att[driver].y < CY ? CY - 20 : CY + 20 });   // arrive at 2 m, ball-side of the goal
        s2.ball = { carrier: 'A' + driver };
        const notes = {}; notes[driver] = 'Beat your man inside-water, drive straight to 2 m with your hand up — read the help: if nobody comes, take the ball and shoot.';
        if (wing && wing !== driver) notes[wing] = 'Rotate up to the flat the driver left — keep the umbrella spacing, be the outlet.';
        const carr = carrierKey(base); if (carr && carr !== driver) notes[carr] = 'Hold the ball until the driver is level with their defender, then pass in front of the driver’s hand.';
        return { steps: [s1, s2], notes };
      } },

    { id: 'swing-weakside-drive', side: 'offense', scope: 'team', icon: '🔁', name: 'Swing the ball, drive weak side',
      when: 'Even (6v6), defence shading to the ball side.',
      cue: 'Move the ball point → flat → wing on one side; as the defence shifts, the far flat drives the weak side to the goal.',
      why: 'Ball movement moves the defence; a drive on the side the defence has just left arrives at the goal against a late helper.',
      build(base) {
        const R = roles(base); if (!R.point) return null;
        const side = ballSide(base); const strongWing = side === 'right' ? R.rw : R.lw, weakFlat = side === 'right' ? R.lf : R.rf;
        const s1 = clone(base); if (strongWing) s1.ball = { carrier: 'A' + strongWing };
        const s2 = clone(s1);
        if (weakFlat) { s2.att[weakFlat] = clamp({ x: HOLEX - 4, y: side === 'right' ? CY - 22 : CY + 22 }); s2.ball = { carrier: 'A' + weakFlat }; }
        const notes = {};
        if (R.point) notes[R.point] = 'Swing the ball early to the strong side — don’t hold it.';
        if (strongWing) notes[strongWing] = 'Catch, look inside, then hit the weak-side driver as they arrive.';
        if (weakFlat) notes[weakFlat] = 'Start the drive the moment the ball reaches the wing — your defender is looking at the ball.';
        return { steps: [s1, s2], notes };
      } },

    { id: 'hole-entry', side: 'offense', scope: 'team', icon: '🎯', name: 'Entry pass to the centre forward',
      when: 'Even (6v6), centre forward has position (defender behind).',
      cue: 'Swing the ball to the flat on the side where the centre’s defender is NOT, the centre seals with their back to the goal, the entry pass goes in dry; the other four spread wide to take the help away.',
      why: 'The centre forward at 2 m is the most dangerous attacker: a clean catch means a shot, a turn or an exclusion. Spacing stops the drop.',
      build(base) {
        const R = roles(base); if (!R.hole) return null;
        const hd = marker(base, R.hole, null);
        const entrySide = hd && base.def[hd].y > base.att[R.hole].y ? 'left' : 'right';     // pass from the side away from the defender
        const flat = entrySide === 'left' ? R.lf : R.rf;
        const s1 = clone(base); if (flat) s1.ball = { carrier: 'A' + flat };
        s1.att[R.hole] = clamp({ x: HOLEX + 2, y: CY });
        [R.lw, R.rw].forEach(k => { if (k) s1.att[k] = clamp({ x: HOLEX - 2, y: base.att[k].y < CY ? LWY - 4 : RWY + 4 }); });
        if (R.point) s1.att[R.point] = clamp({ x: POINTX - 6, y: CY });
        const s2 = clone(s1); s2.ball = { carrier: 'A' + R.hole };
        const notes = {}; notes[R.hole] = 'Seal your defender behind you, arm up, show a target hand — catch dry, then turn or draw the foul.';
        if (flat) notes[flat] = 'Entry pass from the 45°, wet or dry as the centre asks — never across the defender’s hands.';
        [R.lw, R.rw].forEach(k => { if (k) notes[k] = 'Go wide to the 2 m line — take your defender away from the centre.'; });
        if (R.point) notes[R.point] = 'Stay high at 7 m as the safety and the outlet.';
        return { steps: [s1, s2], notes };
      } },

    { id: 'point-pick', side: 'offense', scope: 'pair', icon: '🧱', name: 'Pick at the top (point screens the flat)',
      when: 'Even (6v6) vs press; the flat’s defender plays tight.',
      cue: 'The point swims across and screens the flat’s defender; the flat drives off the screen to the goal; the screener pops out for the ball.',
      why: 'A screen (legal without holding) makes the defence switch or lose a man — one of them is late.',
      build(base, ctx) {
        const R = roles(base); if (!R.point) return null;
        const driver = pickTarget(base, ctx, R.lf || R.rf); if (!driver || driver === R.point) return null;
        const dd = marker(base, driver, null);
        const s1 = clone(base);
        const dp = dd ? base.def[dd] : base.att[driver];
        s1.att[R.point] = clamp({ x: dp.x - 8, y: dp.y + (base.att[driver].y < CY ? -8 : 8) });   // screen on the defender's outside shoulder
        const s2 = clone(s1);
        s2.att[driver] = clamp({ x: HOLEX - 4, y: base.att[driver].y < CY ? CY - 18 : CY + 18 });
        s2.att[R.point] = clamp({ x: POINTX + 4, y: CY });   // pop back to the top for the ball
        s2.ball = { carrier: 'A' + driver };
        const notes = {}; notes[R.point] = 'Set the screen on the outside shoulder of the driver’s defender — no holding — then pop back to the top.';
        notes[driver] = 'Wait for the screen, drive shoulder-to-shoulder off it straight to the goal.';
        return { steps: [s1, s2], notes };
      } },

    { id: 'rotation', side: 'offense', scope: 'team', icon: '🔄', name: 'Perimeter rotation (wheel)',
      when: 'Even (6v6) vs a full press, or to reset the shot clock with movement.',
      cue: 'Everyone on the perimeter moves one place: wing → flat → point → flat → wing, ball moving with it; the centre holds 2 m.',
      why: 'Constant movement against a press creates a mismatch or a late defender; the ball never stops in one hand.',
      build(base) {
        const R = roles(base); const ring = [R.lw, R.lf, R.point, R.rf, R.rw].filter(Boolean); if (ring.length < 3) return null;
        const s1 = clone(base);
        ring.forEach((k, i) => { const to = ring[(i + 1) % ring.length]; s1.att[k] = clamp(base.att[to]); });
        const carr = carrierKey(base); const ci = ring.indexOf(carr); if (ci >= 0) s1.ball = { carrier: 'A' + ring[(ci + 1) % ring.length] };
        const notes = {}; ring.forEach(k => notes[k] = 'Move one place round the umbrella as the ball moves — arrive as the pass arrives.');
        if (R.hole) notes[R.hole] = 'Hold 2 m, keep your defender behind you, be ready for the entry when the rotation opens it.';
        return { steps: [s1], notes };
      } },

    { id: 'clear-out', side: 'offense', scope: 'team', icon: '🚪', name: 'Clear out for the centre (draw the exclusion)',
      when: 'Even (6v6), centre forward is strong; shot clock under 10 s.',
      cue: 'Both flats step wide and high, the wings go to the 2 m line — the middle is empty. The centre works inside-water, the entry goes in, the defender has to foul.',
      why: 'With the help removed, the centre’s defender is alone: either the centre scores or the defender fouls from behind — an exclusion.',
      build(base) {
        const R = roles(base); if (!R.hole) return null;
        const s1 = clone(base);
        if (R.lf) s1.att[R.lf] = clamp({ x: POINTX + 2, y: LWY + 20 });
        if (R.rf) s1.att[R.rf] = clamp({ x: POINTX + 2, y: RWY - 20 });
        if (R.lw) s1.att[R.lw] = clamp({ x: HOLEX, y: LWY - 6 });
        if (R.rw) s1.att[R.rw] = clamp({ x: HOLEX, y: RWY + 6 });
        s1.att[R.hole] = clamp({ x: HOLEX + 3, y: CY });
        const s2 = clone(s1); s2.ball = { carrier: 'A' + R.hole };
        const notes = {}; notes[R.hole] = 'Work inside-water, seal, catch — then turn to the goal and make the defender foul.';
        [R.lf, R.rf].forEach(k => { if (k) notes[k] = 'Step wide and high — nobody helps on the centre.'; });
        [R.lw, R.rw].forEach(k => { if (k) notes[k] = 'Sit on the 2 m line at the side, keep your defender with you.'; });
        if (R.point) notes[R.point] = 'Entry pass when the centre’s hand goes up — then be the safety.';
        return { steps: [s1, s2], notes };
      } },

    { id: 'give-go', side: 'offense', scope: 'player', icon: '↩️', name: 'Give & go (pass and cut)',
      when: 'Even or man-up; your defender ball-watches after your pass.',
      cue: 'Pass to the next player and cut immediately to the 2 m line ball-side; the receiver returns it in front of your hand.',
      why: 'Defenders relax the moment the ball leaves their man — the cut arrives while they are turned to the ball.',
      build(base, ctx) {
        const a = pickTarget(base, ctx, carrierKey(base) || roles(base).point); if (!a || !base.att[a]) return null;
        const mate = nearestKey(base.att, base.att[a], new Set([a])); if (!mate) return null;
        const s1 = clone(base); s1.ball = { carrier: 'A' + mate };
        s1.att[a] = clamp({ x: base.att[a].x + 18, y: base.att[a].y + (base.att[a].y < CY ? 8 : -8) });
        const s2 = clone(s1); s2.ball = { carrier: 'A' + a };
        s2.att[a] = clamp({ x: HOLEX - 2, y: base.att[a].y < CY ? CY - 20 : CY + 20 });
        const notes = {}; notes[a] = 'Pass and go immediately — cut to 2 m ball-side, hand up early.';
        notes[mate] = 'Catch, hold one beat, return the ball in front of the cutter’s hand.';
        return { steps: [s1, s2], notes };
      } },

    { id: 'far-post', side: 'offense', scope: 'player', icon: '🎯', name: 'Weak-side wing to the far post',
      when: 'Even vs a drop / zone, or man-up; ball on one wing, defence sunk ball-side.',
      cue: 'The wing on the far side slides along the 2 m line to the far post; the ball is crossed over the zone for the first-time finish.',
      why: 'A dropping defence overloads the ball side; the far post is the one place it cannot cover and the keeper is on the wrong side.',
      build(base, ctx) {
        const R = roles(base); const side = ballSide(base); const wing = pickTarget(base, ctx, side === 'right' ? R.lw : R.rw); if (!wing) return null;
        const s1 = clone(base); s1.att[wing] = clamp({ x: GOALX - 8, y: base.att[wing].y < CY ? CY - 16 : CY + 16 });
        const s2 = clone(s1); s2.ball = { carrier: 'A' + wing };
        const notes = {}; notes[wing] = 'Slide to the far post along the 2 m line, hand up — catch and shoot first-time, no fake.';
        const carr = carrierKey(base); if (carr && carr !== wing) notes[carr] = 'Look at the near side, then cross the ball over the zone to the far post.';
        return { steps: [s1, s2], notes };
      } },

    { id: 'manup-42', side: 'offense', scope: 'team', icon: '4️⃣', name: 'Man-up 4-2 set',
      when: '6v5 (opponent excluded).',
      cue: 'Two players on the posts at 2 m, four on the arc (two at 5–6 m by the sides, two at the top). Ball swings fast around the arc; shoot from the 2 / 5 positions or hit the post player when the zone shifts.',
      why: 'The 4-2 stretches a 5-man zone across the whole width; every swing opens one shooter or one post.',
      build(base) {
        const ak = keys(base.att).slice(0, 6); if (ak.length < 5) return null;
        const spots = [{ x: HOLEX + 6, y: CY - 26 }, { x: HOLEX + 6, y: CY + 26 }, { x: FIVEX - 4, y: LWY + 8 }, { x: FIVEX - 4, y: RWY - 8 }, { x: POINTX - 4, y: CY - 22 }, { x: POINTX - 4, y: CY + 22 }];
        const s1 = clone(base); const used = new Set(); const assign = {};
        spots.forEach((sp, i) => { const k = nearestKey(base.att, sp, used); if (k) { used.add(k); s1.att[k] = clamp(sp); assign[i] = k; } });
        if (assign[4]) s1.ball = { carrier: 'A' + assign[4] };
        const s2 = clone(s1); if (assign[3]) s2.ball = { carrier: 'A' + assign[3] };
        const notes = {};
        if (assign[0]) notes[assign[0]] = 'Left post: sit on the 2 m line at goal width, seal your defender, catch and turn.';
        if (assign[1]) notes[assign[1]] = 'Right post: same — the moment the zone shifts, show your hand.';
        if (assign[2]) notes[assign[2]] = 'Left side (5–6 m): catch the swing on the move, shoot if the lane is open.';
        if (assign[3]) notes[assign[3]] = 'Right side (5–6 m): the finisher — one-time shot before the block sets.';
        if (assign[4]) notes[assign[4]] = 'Top left: swing fast, no more than two seconds with the ball.';
        if (assign[5]) notes[assign[5]] = 'Top right: swing, and be the safety on the counter.';
        return { steps: [s1, s2], notes };
      } },

    { id: 'manup-33', side: 'offense', scope: 'team', icon: '3️⃣', name: 'Man-up 3-3 set',
      when: '6v5 vs a zone that protects the posts.',
      cue: 'Three inside on the 2 m line (both posts and the centre), three outside on the arc. Outside shooters at 6 m; the inside three catch and turn or draw a second exclusion.',
      why: 'The 3-3 pins three defenders deep; the outside three have shooting lanes over a low zone.',
      build(base) {
        const ak = keys(base.att).slice(0, 6); if (ak.length < 5) return null;
        const spots = [{ x: HOLEX + 6, y: CY - 28 }, { x: HOLEX + 6, y: CY }, { x: HOLEX + 6, y: CY + 28 }, { x: POINTX + 4, y: CY - 36 }, { x: POINTX - 6, y: CY }, { x: POINTX + 4, y: CY + 36 }];
        const s1 = clone(base); const used = new Set(); const assign = {};
        spots.forEach((sp, i) => { const k = nearestKey(base.att, sp, used); if (k) { used.add(k); s1.att[k] = clamp(sp); assign[i] = k; } });
        if (assign[4]) s1.ball = { carrier: 'A' + assign[4] };
        const s2 = clone(s1); if (assign[5]) s2.ball = { carrier: 'A' + assign[5] };
        const notes = {};
        [0, 1, 2].forEach(i => { if (assign[i]) notes[assign[i]] = 'Inside line at 2 m: seal, hand up, catch and turn — or make them foul.'; });
        [3, 4, 5].forEach(i => { if (assign[i]) notes[assign[i]] = 'Outside at 6 m: swing fast, shoot when the lane opens over the zone.'; });
        return { steps: [s1, s2], notes };
      } },

    { id: 'penalty', side: 'offense', scope: 'team', icon: '🥅', name: '5 m penalty',
      when: 'Penalty awarded.',
      cue: 'Shooter on the 5 m line with the ball; everyone else outside 5 m and behind the ball; keeper on the goal line. Shoot on the whistle in one motion.',
      why: 'Rule: the shot must be immediate and continuous; teammates behind the ball are ready for a rebound.',
      build(base) {
        const ak = keys(base.att); if (!ak.length) return null;
        const shooter = carrierKey(base) || roles(base).point || ak[0]; const s1 = clone(base);
        s1.att[shooter] = clamp({ x: FIVEX, y: CY }); s1.ball = { carrier: 'A' + shooter };
        ak.filter(k => k !== shooter).forEach((k, i) => s1.att[k] = clamp({ x: POINTX - 12, y: 60 + i * 24 }));
        s1.gk = clamp({ x: GOALX + 3, y: CY });
        const notes = {}; notes[shooter] = 'On the 5 m line — pick your corner before the whistle, one continuous motion.';
        notes.GK = 'On the line until the whistle — read the shooter’s hips, explode to your side.';
        return { steps: [s1], notes };
      } },

    /* ================= DEFENSE ================= */
    { id: 'press', side: 'defense', scope: 'team', icon: '🙌', name: 'Front-court press (man-to-man)',
      when: 'Even (6v6), you want the ball out of their hands and turnovers.',
      cue: 'Each defender on the ball-side / outside shoulder of their man, arm up in the passing lane; the centre’s defender plays behind with a hand on the centre’s hip.',
      why: 'Pressure makes every pass a risk and kills the entry to the centre; it costs legs, so use it in stretches.',
      build(base) {
        const s1 = clone(base); const notes = {}; const used = new Set(); const R = roles(base);
        keys(base.att).forEach(k => { const d = nearestKey(base.def, base.att[k], used); if (!d) return; used.add(d); const a = base.att[k];
          if (k === R.hole) { s1.def[d] = clamp({ x: a.x + 7, y: a.y }); notes[d] = 'Behind the centre, hand on the hip, deny the turn — front only when the ball is far.'; }
          else { s1.def[d] = clamp({ x: a.x - 7, y: a.y + (a.y < CY ? -4 : 4) }); notes[d] = 'Ball-side shoulder, arm up in the lane — make them pass over you.'; } });
        return { steps: [s1], notes };
      } },

    { id: 'drop-m', side: 'defense', scope: 'team', icon: '🛡️', name: 'Drop on the centre (M-zone)',
      when: 'Even (6v6), their centre forward is dangerous or your defenders are tired.',
      cue: 'The two flat defenders drop back between 2 m and 5 m to help on the centre; the point defender stays up on the shooter; the wing defenders hold the 2 m sides — the "M".',
      why: 'Takes the entry pass away and doubles the centre without leaving the best shooter; gives up outside shots from the flats.',
      build(base) {
        const R = roles(base); const s1 = clone(base); const notes = {}; const used = new Set();
        const hp = base.att[R.hole] || { x: HOLEX, y: CY };
        const mk = (atk, to, note) => { if (!atk) return; const d = nearestKey(base.def, base.att[atk], used); if (!d) return; used.add(d); s1.def[d] = clamp(to); notes[d] = note; };
        mk(R.lf, { x: hp.x - 12, y: CY - 16 }, 'Drop to the 2–5 m gap on your side — help on the centre, hands up in the entry lane.');
        mk(R.rf, { x: hp.x - 12, y: CY + 16 }, 'Drop to the 2–5 m gap on your side — help on the centre, hands up in the entry lane.');
        mk(R.point, { x: base.att[R.point] ? base.att[R.point].x - 6 : POINTX - 6, y: CY }, 'Stay up on the point — the shooter is yours, no drop.');
        mk(R.lw, { x: HOLEX - 4, y: LWY + 8 }, 'Hold the 2 m side, half-front your wing, ready to help inside.');
        mk(R.rw, { x: HOLEX - 4, y: RWY - 8 }, 'Hold the 2 m side, half-front your wing, ready to help inside.');
        mk(R.hole, { x: hp.x + 7, y: hp.y }, 'Play behind the centre — with the drop you can be aggressive on the catch.');
        return { steps: [s1], notes };
      } },

    { id: 'front-hole', side: 'defense', scope: 'player', icon: '🚧', name: 'Front the centre forward',
      when: 'Ball on the perimeter far from the centre; keeper covers behind.',
      cue: 'The centre’s defender goes in front, ball-side, between the ball and the centre; the keeper cheats towards the centre to cover the lob.',
      why: 'No entry pass = no centre game. The risk is the lob over the front, which the keeper takes.',
      build(base, ctx) {
        const R = roles(base); if (!R.hole) return null; const hp = base.att[R.hole];
        const d = pickDef(base, ctx, marker(base, R.hole, null)); if (!d) return null;
        const b = carrierPt(base) || { x: FIVEX, y: CY };
        const s1 = clone(base); s1.def[d] = clamp({ x: hp.x - 7, y: hp.y + (b.y < hp.y ? -4 : 4) });
        s1.gk = clamp({ x: GOALX + 2, y: CY + (hp.y - CY) * 0.3 });
        const notes = {}; notes[d] = 'Front the centre ball-side, arm up — refuse the entry; on a lob, let the keeper take it.';
        notes.GK = 'Cheat a metre towards the centre — the lob over the front is yours.';
        return { steps: [s1], notes };
      } },

    { id: 'crash', side: 'defense', scope: 'pair', icon: '💢', name: 'Crash on the centre (double-team)',
      when: 'The ball has just gone in to the centre forward.',
      cue: 'The nearest flat defender crashes down onto the centre the moment the ball is caught, arms up over the ball; their own man is left for one beat; recover as the ball comes out.',
      why: 'Two on the centre stops the turn and the shot; the outlet pass is slow enough to recover to the shooter.',
      build(base) {
        const R = roles(base); if (!R.hole) return null; const hp = base.att[R.hole];
        const d1 = marker(base, R.hole, null); const flat = base.ball && carrierPt(base) && carrierPt(base).y < CY ? R.lf : R.rf;
        const d2 = flat ? marker(base, flat, new Set([d1])) : nearestKey(base.def, hp, new Set([d1]));
        const s1 = clone(base); s1.ball = { carrier: 'A' + R.hole };
        if (d1) s1.def[d1] = clamp({ x: hp.x + 7, y: hp.y });
        if (d2) s1.def[d2] = clamp({ x: hp.x - 8, y: hp.y + (base.def[d2].y < hp.y ? -6 : 6) });
        const notes = {}; if (d1) notes[d1] = 'Stay behind, arms up over the ball — no turn.';
        if (d2) notes[d2] = 'Crash the moment the ball goes in — hands over the ball, then recover to your man as it comes out.';
        return { steps: [s1], notes };
      } },

    { id: 'switch', side: 'defense', scope: 'pair', icon: '🔀', name: 'Switch on the screen',
      when: 'Their point / flat sets a pick on your defender.',
      cue: 'The screened defender calls "switch"; the screener’s defender takes the driver, the screened defender takes the screener — nobody chases through the pick.',
      why: 'Chasing through a screen leaves the driver free at 2 m; switching keeps both attackers marked.',
      build(base) {
        const dk = keys(base.def); if (dk.length < 2) return null;
        let a = dk[0], b = dk[1], bd = 1e9;
        for (let i = 0; i < dk.length; i++) for (let j = i + 1; j < dk.length; j++) { const d = dist(base.def[dk[i]], base.def[dk[j]]); if (d < bd) { bd = d; a = dk[i]; b = dk[j]; } }
        const s1 = clone(base); const pa = base.def[a], pb = base.def[b]; s1.def[a] = clamp(pb); s1.def[b] = clamp(pa);
        const notes = {}; notes[a] = 'Call "switch" early — take the man coming off the pick.'; notes[b] = 'Switch — pick up the screener, deny the pop-out pass.';
        return { steps: [s1], notes };
      } },

    { id: 'foul-reset', side: 'defense', scope: 'player', icon: '✋', name: 'Ordinary foul on the ball-carrier',
      when: 'A SETTLED attack: the centre forward or a driver has the ball with their back to goal, and is not in a shooting action.',
      cue: 'The marking defender impedes the ball-carrier — body on, no hold, no sink. The whistle stops both clocks, the free throw is taken where the ball is, and the defence re-sets its marks while the thrower puts it back in play.',
      why: 'An ordinary foul carries no personal foul and there is no limit on them, so it is the cheap way to break a set attack. Three lines you must not cross: it does NOT reset the shot clock (the possession clock resumes where it froze); holding, sinking or pulling back an opponent is a MAJOR foul and an 18 s exclusion, not a free throw; and fouling to kill the flow of an attack — above all a counter — is a tactical foul, also an exclusion (Art. 9.11). Impeding a shooter from behind inside 6 m is a penalty (Art. 10.11).',
      build(base, ctx) {
        const b = carrierPt(base) || { x: FIVEX, y: CY };
        const d = pickDef(base, ctx, nearestKey(base.def, b, null)); if (!d) return null;
        const s1 = clone(base); s1.def[d] = clamp({ x: b.x - 5, y: b.y + (base.def[d].y < b.y ? -3 : 3) });
        const notes = {}; note(notes, d, 'Body on the ball-carrier from the side — impede, never hold or sink (that is an exclusion), and never from behind on a shooter inside 6 m (that is a penalty). Then re-set your mark.');
        keys(base.def).forEach(k => { if (k !== d) notes[k] = notes[k] || 'Free throw: find your mark and get goal-side while the ball is dead.'; });
        return { steps: [s1], notes };
      } },

    { id: 'zone-mandown', side: 'defense', scope: 'team', icon: '🕸️', name: 'Man-down zone (5 + keeper)',
      when: '5v6 (your player excluded).',
      cue: 'Two defenders in front of the post players, one in the middle in front of the centre, two on the outside shooters at 5–6 m; the whole zone shifts one step towards the ball on every pass; arms up on the shooters.',
      why: 'A 5-man zone cannot mark six — it protects the posts and the middle and forces the outside shot that the keeper is set for.',
      build(base) {
        const dk = keys(base.def); if (dk.length < 4) return null;
        const b = carrierPt(base) || { x: POINTX, y: CY }; const shift = (b.y - CY) * 0.12;
        const spots = [{ x: HOLEX + 2, y: CY - 24 + shift }, { x: HOLEX + 2, y: CY + 24 + shift }, { x: HOLEX - 8, y: CY + shift }, { x: FIVEX - 2, y: LWY + 14 + shift }, { x: FIVEX - 2, y: RWY - 14 + shift }];
        const s1 = clone(base); const used = new Set(); const notes = {};
        spots.forEach((sp, i) => { const k = nearestKey(base.def, sp, used); if (!k) return; used.add(k); s1.def[k] = clamp(sp);
          notes[k] = i < 2 ? 'Post: in front of the post player, arm up, block the near lane.' : i === 2 ? 'Middle: in front of the centre, read the ball, arms up.' : 'Outside: on the shooter’s arm at 5–6 m, shift with every pass.'; });
        s1.gk = clamp({ x: GOALX + 2, y: CY + (b.y - CY) * 0.25 });
        notes.GK = 'Set for the outside shot, one step towards the ball — the zone gives you that shot.';
        return { steps: [s1], notes };
      } },

    { id: 'gk-out', side: 'defense', scope: 'gk', icon: '🧤', name: 'Keeper comes out (close the angle)',
      when: 'A free shooter at 5 m on the counter, or a driver alone at 2 m.',
      cue: 'The keeper leaves the line towards the ball, high in the water, to cut the shooting angle — then sets before the release.',
      why: 'Off the line, the keeper takes away most of the goal; the risk is the lob, so never go out against a shooter who is already set.',
      build(base) {
        const b = carrierPt(base) || { x: FIVEX, y: CY }; const s1 = clone(base);
        const dx = b.x - base.gk.x, dy = b.y - base.gk.y, m = Math.hypot(dx, dy) || 1;
        s1.gk = clamp({ x: base.gk.x + (dx / m) * 12, y: base.gk.y + (dy / m) * 6 });
        return { steps: [s1], notes: { GK: 'Come out towards the ball, high and big, set before the release — watch for the lob.' } };
      } },

    { id: 'help-recover', side: 'defense', scope: 'team', icon: '🤝', name: 'Help and recover (driver beaten you)',
      when: 'A driver has beaten their defender towards the goal.',
      cue: 'The nearest inside defender (usually the centre’s) steps to the driver; the beaten defender recovers to the man left free; the far side rotates one step towards the goal.',
      why: 'Better a late rotation than a free shot from 2 m — help first, then recover.',
      build(base) {
        const R = roles(base); const driver = carrierKey(base) || R.lf || R.rf; if (!driver) return null;
        const dp = base.att[driver]; const beaten = marker(base, driver, null);
        const helper = nearestKey(base.def, { x: dp.x + 10, y: dp.y }, new Set([beaten]));
        const s1 = clone(base); const notes = {};
        if (helper) { s1.def[helper] = clamp({ x: dp.x + 6, y: dp.y }); notes[helper] = 'Help on the driver — body between them and the goal, arms up.'; }
        if (beaten) { const free = helper ? nearestKey(base.att, base.def[helper], new Set([driver])) : null; if (free) { s1.def[beaten] = clamp({ x: base.att[free].x + 6, y: base.att[free].y }); notes[beaten] = 'Recover to the man the helper left — sprint, don’t chase the driver.'; } }
        return { steps: [s1], notes };
      } },

    { id: 'shoot', side: 'offense', scope: 'player', icon: '🎯', name: 'Take the shot (mark the shot step)',
      when: 'The carrier has the cage: green territory, or a gap the keeper cannot cover.',
      cue: 'The player holding the ball shoots. The step is MARKED as the shot — the board draws the shot line and the target ring, the shooter is told "shoot", and the goalkeeper view opens on that step.',
      why: 'A play should say where it finishes. Marking the shot also lets the app judge the chance from that spot: territory, the keeper\u2019s coverage and any defender in the lane.',
      build(base, ctx) {
        const a = pickTarget(base, ctx, carrierKey(base) || roles(base).hole); if (!a || !base.att[a]) return null;
        const p = base.att[a];
        const gk = base.gk || { x: GOALX + 2, y: CY };
        // aim away from where the keeper is standing
        const aim = gk.y >= CY ? Math.max(96, CY - 14) : Math.min(124, CY + 14);
        const s1 = clone(base); s1.ball = { carrier: 'A' + a };
        const s2 = clone(s1); s2.ball = { carrier: null, x: 293, y: aim };
        s2.shot = { by: String(a), kind: 'shot' };
        const notes = {}; notes[a] = 'Shoot — pick the corner the keeper is not covering, and finish in one motion.';
        return { steps: [s1, s2], notes };
      } },

    { id: 'lob', side: 'offense', scope: 'player', icon: '🌈', name: 'Lob over the keeper',
      when: 'The keeper has come off the line towards the ball, and you are at an angle to one side of the goal.',
      cue: 'A high, soft, cross-cage ball over the advanced keeper into the far top corner. Marked as the shot step, drawn as a dotted arc.',
      why: 'Off the line the keeper cannot get back to a slow high ball dropping behind them. Honest caveat: lobs are only 1-7% of elite shots and are, overall, LESS successful than a drive shot — this is the one situation coaching consensus says they belong in.',
      build(base, ctx) {
        const a = pickTarget(base, ctx, carrierKey(base) || roles(base).lw); if (!a || !base.att[a]) return null;
        const p = base.att[a];
        const s1 = clone(base); s1.ball = { carrier: 'A' + a };
        const s2 = clone(s1); s2.ball = { carrier: null, x: 293, y: p.y >= CY ? 96 : 124 };   // cross-cage
        s2.shot = { by: String(a), kind: 'lob' };
        const notes = {}; note(notes, a, 'Lob cross-cage over the keeper — high and soft into the far corner, not hard.');
        note(notes, 'GK', 'This is what an advanced keeper concedes: get set before the release instead of drifting out.');
        return { steps: [s1, s2], notes };
      } },

    { id: 'draw-foul', side: 'offense', scope: 'player', icon: '🫱', name: 'Draw the ordinary foul',
      when: 'The set attack has stalled, or you want uncontested possession to re-set the front court.',
      cue: 'The attacker drives with the ball ON THE WATER (dribbling, not holding it) and turns into the defender. The hold comes, the whistle goes, and the free throw is taken where the ball is.',
      why: 'Know which whistle you are playing for. A defender who IMPEDES you while you are not holding the ball gives away an ordinary foul — a free throw. A defender who HOLDS, SINKS or PULLS YOU BACK gives away a major foul — an 18 s exclusion, and a man-up converts at about 48%. Either way you must be dribbling, because neither foul exists against a player holding the ball. What the free throw buys: both clocks stop at the whistle, the defender must move a metre away before they may block, and you get an uncontested pass to re-set. What it does NOT buy: the possession clock does not reset, it resumes where it froze.',
      build(base, ctx) {
        const R = roles(base);
        const a = pickTarget(base, ctx, carrierKey(base) || R.hole); if (!a || !base.att[a]) return null;
        const d = marker(base, a, null);
        const s1 = clone(base);
        s1.att[a] = clamp({ x: base.att[a].x + 8, y: base.att[a].y });
        if (d) s1.def[d] = clamp({ x: s1.att[a].x + 4, y: s1.att[a].y + (base.def[d].y < base.att[a].y ? -3 : 3) });
        s1.ball = { carrier: 'A' + a };
        const s2 = clone(s1);                                     // the whistle: the defender must give a metre
        if (d) s2.def[d] = clamp({ x: s1.def[d].x + 11, y: s1.def[d].y });
        const notes = {};
        note(notes, a, 'Dribble in and turn into your defender — do NOT pick the ball up. If they only impede you, take the free throw at once; if they hold or sink you, sell it and play the man-up.');
        [R.point, R.lf, R.rf].forEach(k => { if (k && k !== a && !notes[k]) note(notes, k, 'Free throw coming: get to your spot now, the ball moves the moment it is put in play.'); });
        return { steps: [s1, s2], notes };
      } },

    { id: 'free-throw-shot', side: 'offense', scope: 'player', icon: '💥', name: 'Direct shot from the free throw (outside 6 m)',
      when: 'You have just been awarded a free throw and the BALL is outside the 6 m line.',
      cue: 'Shoot straight from the free throw. The defender has to be a metre away before they may raise an arm, so the lane is briefly open.',
      why: 'Rule Art. 7.2(d): a goal may be scored from an immediate shot from a free throw taken by a player outside 6 m — it is the location of the BALL that decides. There is no "continuous motion" clause: you may either shoot immediately, or visibly put the ball into play and then fake, dribble and shoot.',
      build(base, ctx) {
        const R = roles(base);
        const a = pickTarget(base, ctx, carrierKey(base) || R.point); if (!a || !base.att[a]) return null;
        const six = 296 - 6 * 10.88;                                // the real 6 m line (water edge 296, 10.88 units/m)
        const s1 = clone(base);
        // the carried ball is DRAWN offset from the player (ANIM BALL_OFF ≈ +5.5 x), so leave room
        s1.att[a] = clamp({ x: Math.min(base.att[a].x, six - 12), y: base.att[a].y });
        s1.ball = { carrier: 'A' + a };
        const d = marker(base, a, null);
        if (d) s1.def[d] = clamp({ x: s1.att[a].x - 11, y: s1.att[a].y });               // the metre the defender must give
        const gk = base.gk || { x: GOALX + 2, y: CY };
        const s2 = clone(s1); s2.ball = { carrier: null, x: 293, y: gk.y >= CY ? 98 : 122 };
        s2.shot = { by: String(a), kind: 'shot' };
        const notes = {};
        note(notes, a, 'Ball outside 6 m — shoot immediately off the free throw, before the defender can close the metre.');
        note(notes, 'GK', 'Free throw outside 6 m means a direct shot is on: get set square to the ball straight away.');
        return { steps: [s1, s2], notes };
      } },

    /* ================= TRANSITION ================= */
    { id: 'counter', side: 'transition', scope: 'team', icon: '⚡', name: 'Counter-attack (release + lanes)',
      when: 'Turnover, save or a missed shot.',
      cue: 'Both wings release the moment the ball changes hands and sprint the sides; the two flats fill the middle lanes as the second wave; the point stays as the safety; the keeper throws the long outlet to the first free man.',
      why: 'The counter is the highest-percentage attack in the game: numbers up before the defence is back.',
      build(base) {
        const R = roles(base); const s1 = clone(base); const notes = {};
        const lane = (k, y, dx, note) => { if (!k) return; s1.att[k] = clamp({ x: base.att[k].x + dx, y }); notes[k] = note; };
        lane(R.lw, LWY + 4, 30, 'Release first — sprint the left lane, hand up for the long ball.');
        lane(R.rw, RWY - 4, 30, 'Release first — sprint the right lane, hand up for the long ball.');
        lane(R.lf, CY - 20, 22, 'Second wave — fill the middle lane behind the wings.');
        lane(R.rf, CY + 20, 22, 'Second wave — fill the middle lane behind the wings.');
        lane(R.hole, CY, 16, 'Trail into the middle — you are the 2 m target when the counter slows.');
        if (R.point) notes[R.point] = 'Stay as the safety — never let the counter go the other way.';
        s1.ball = { carrier: 'GK' }; notes.GK = 'Outlet pass immediately — long to the free wing, or short to the point if nothing is on.';
        return { steps: [s1], notes };
      } },

    { id: 'get-back', side: 'defense', scope: 'team', icon: '🏊', name: 'Transition defence (get back, protect the middle)',
      when: 'You have just lost the ball.',
      cue: 'First defender back sprints to the centre in front of the goal, the next two take the outside lanes, everyone gets goal-side before picking up a man; the keeper talks.',
      why: 'On the counter the danger is the middle: protect the goal first, then find a man.',
      build(base) {
        const s1 = clone(base); const notes = {}; const dk = keys(base.def).sort((a, b) => base.def[b].x - base.def[a].x);   // deepest first
        const spots = [{ x: HOLEX - 4, y: CY }, { x: HOLEX - 8, y: CY - 30 }, { x: HOLEX - 8, y: CY + 30 }, { x: FIVEX - 4, y: CY - 14 }, { x: FIVEX - 4, y: CY + 14 }, { x: POINTX, y: CY }];
        dk.forEach((k, i) => { const sp = spots[Math.min(i, spots.length - 1)]; s1.def[k] = clamp(sp); notes[k] = i === 0 ? 'First back: sprint to the middle in front of the goal — nothing through the centre.' : i < 3 ? 'Take an outside lane goal-side, then find a man.' : 'Get goal-side first, pick up the nearest free attacker.'; });
        s1.gk = clamp({ x: GOALX + 2, y: CY }); notes.GK = 'On the line, talk — call the free man, take the long ball if it is yours.';
        return { steps: [s1], notes };
      } },
  ];

  const byId = {}; LIST.forEach(c => { c.source = SOURCE; byId[c.id] = c; });

  /* apply(scenario, id, opts) → { steps, notes, cmd } | null — non-mutating: caller splices `steps` into scenario.frames. */
  function apply(scenario, id, opts) {
    const cmd = byId[id]; if (!cmd) return null;
    const base = clone(scenario.frames[scenario.frames.length - 1]);
    delete base.shot;                                   // a shot belongs to ONE step — never inherited
    const out = cmd.build(base, { target: (opts && opts.target) || 'team', situation: scenario.situation });
    if (!out || !out.steps || !out.steps.length) return null;
    return { steps: out.steps, notes: out.notes || {}, cmd };
  }

  return { list: LIST, byId, apply, roles, SIDES: ['offense', 'defense', 'transition'], SOURCE };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = COMMANDS;
