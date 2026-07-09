/* ============================================================
   commands.js — Tactical Commands ("Audibles").

   A coach presses a command button and the board executes a
   known move — like calling a play from the bench. Each command
   is a pure transform on the current board frame that returns one
   or more movement STEPS (so drawTactics renders the arrows) plus
   per-position assignment notes.

   Commands can target the WHOLE TEAM or an INDIVIDUAL player
   (target = 'team' | '1'..'6' | 'GK'). Offense commands move the
   white attackers, defense commands move the black defenders and
   the keeper; both are numbered 1..6 so the assignment grid reads
   straight across.

   Attack always attacks the RIGHT goal (high x).
   ============================================================ */
const COMMANDS = (() => {

  const GOALX = 290, HOLEX = 271, FIVEX = 248, POINTX = 228, CY = 110;
  const clone = o => JSON.parse(JSON.stringify(o));
  const clamp = p => ({ x: Math.max(28, Math.min(292, Math.round(p.x))),
                        y: Math.max(34, Math.min(186, Math.round(p.y))) });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const keys = o => Object.keys(o || {});

  // side helpers -------------------------------------------------
  const unit  = (f, side) => side === 'defense' ? f.def : f.att;      // the coaching team's discs
  const prefix = side => side === 'defense' ? 'D' : 'A';
  function carrierPt(f) {
    const c = f.ball && f.ball.carrier;
    if (!c) return f.ball && f.ball.x != null ? { x: f.ball.x, y: f.ball.y } : null;
    if (c === 'GK') return f.gk;
    const map = c[0] === 'A' ? f.att : f.def;
    return map[c.slice(1)] || null;
  }
  const holeKey = f => keys(f.att).sort((a, b) => f.att[b].x - f.att[a].x)[0]; // deepest attacker = 2m set
  function nearestKey(map, pt, used) {
    let best = null, bd = 1e9;
    keys(map).forEach(k => { if (used && used.has(k)) return;
      const d = dist(map[k], pt); if (d < bd) { bd = d; best = k; } });
    return best;
  }

  /* Every build() gets (base, ctx) and returns { steps:[frame,…], notes:{pos:txt} }.
     `base` is the current frame; steps are the positions AFTER the move. */
  const LIST = [

    /* ---------------- OFFENSE ---------------- */
    { id:'pick-roll', side:'offense', scope:'pair', icon:'🏀', name:'Pick & Roll',
      cue:'Screen the hole’s defender, then the set rolls ball-side to the front of the goal for the catch-and-shoot.',
      build(base) {
        const roller = holeKey(base); if (!roller) return null;
        const screener = nearestKey(base.att, base.att[roller], new Set([roller]));
        const dPt = carrierPt(base) || { x: FIVEX, y: CY };
        const s1 = clone(base);
        if (screener) s1.att[screener] = clamp({ x: base.att[roller].x - 12, y: base.att[roller].y - 12 });
        const s2 = clone(s1);
        s2.att[roller] = clamp({ x: GOALX - 16, y: base.att[roller].y > CY ? 128 : 92 });
        s2.ball = { carrier: 'A' + roller };
        const notes = {};
        if (screener) notes[screener] = 'Set a hard screen on the set-defender, hold, then seal to the ball.';
        notes[roller] = 'Wait for the pick — roll ball-side to the goal front, catch and finish.';
        return { steps:[s1, s2], notes };
      } },

    { id:'give-go', side:'offense', scope:'player', icon:'↩️', name:'Give & Go',
      cue:'Pass to a teammate and cut hard to the goal — get the ball straight back in front.',
      build(base, ctx) {
        const a = ctx.target !== 'team' && base.att[ctx.target] ? ctx.target
                : (base.ball.carrier && base.ball.carrier[0]==='A' ? base.ball.carrier.slice(1) : holeKey(base));
        if (!a || !base.att[a]) return null;
        const mate = nearestKey(base.att, base.att[a], new Set([a])); if (!mate) return null;
        const s1 = clone(base); s1.ball = { carrier:'A'+mate };
        s1.att[a] = clamp({ x: base.att[a].x + 20, y: base.att[a].y > CY ? base.att[a].y+6 : base.att[a].y-6 });
        const s2 = clone(s1); s2.ball = { carrier:'A'+a };
        s2.att[a] = clamp({ x: GOALX - 18, y: s1.att[a].y });
        const notes = {}; notes[a] = 'Give the ball, cut hard to the goal front, catch it back.';
        notes[mate] = 'Receive, hold, and return the ball to the cutter.';
        return { steps:[s1, s2], notes };
      } },

    { id:'drive-kick', side:'offense', scope:'team', icon:'💥', name:'Drive & Kick',
      cue:'Drive the middle to pull two defenders, then kick to the open weak-side shooter.',
      build(base) {
        const carr = base.ball.carrier && base.ball.carrier[0]==='A' ? base.ball.carrier.slice(1) : holeKey(base);
        if (!carr || !base.att[carr]) return null;
        const wing = keys(base.att).filter(k=>k!==carr)
          .sort((a,b)=> Math.abs(base.att[b].y-CY) - Math.abs(base.att[a].y-CY))[0];
        const s1 = clone(base); s1.att[carr] = clamp({ x: FIVEX+6, y: CY });
        const s2 = clone(s1); if (wing) { s2.ball = { carrier:'A'+wing };
          s2.att[wing] = clamp({ x: base.att[wing].x + 8, y: base.att[wing].y }); }
        const notes = {}; notes[carr] = 'Drive the middle, commit two defenders, then kick out.';
        if (wing) notes[wing] = 'Spot up weak-side, catch the kick, shoot early.';
        return { steps:[s1, s2], notes };
      } },

    { id:'set-hole', side:'offense', scope:'team', icon:'🎯', name:'Feed the Hole',
      cue:'Swing the ball to the 2m set, who posts up strong and seals for the shot.',
      build(base) {
        const hole = holeKey(base); if (!hole) return null;
        const s1 = clone(base); s1.att[hole] = clamp({ x: HOLEX+2, y: CY });
        s1.ball = { carrier:'A'+hole };
        const notes = {}; notes[hole] = 'Post up at 2m, win the seal, sweep to the shot.';
        return { steps:[s1], notes };
      } },

    { id:'weakside-post', side:'offense', scope:'player', icon:'🔙', name:'Weak-side Post-up',
      cue:'Sneak backdoor to the far post on the blind side for the easy finish.',
      build(base, ctx) {
        const a = ctx.target!=='team' && base.att[ctx.target] ? ctx.target
                : keys(base.att).sort((x,y)=>base.att[x].y-base.att[y].y).pop();
        if (!a || !base.att[a]) return null;
        const s1 = clone(base); s1.att[a] = clamp({ x: GOALX-14, y: base.att[a].y>CY ? 132 : 88 });
        const notes = {}; notes[a] = 'Drift to the blind far post, present a target, finish first-time.';
        return { steps:[s1], notes };
      } },

    { id:'wing-iso', side:'offense', scope:'player', icon:'🕺', name:'Wing Isolation',
      cue:'Clear the strong side and let the wing go one-on-one.',
      build(base, ctx) {
        const a = ctx.target!=='team' && base.att[ctx.target] ? ctx.target
                : (base.ball.carrier && base.ball.carrier[0]==='A' ? base.ball.carrier.slice(1) : holeKey(base));
        if (!a || !base.att[a]) return null;
        const s1 = clone(base);
        keys(s1.att).forEach(k => { if (k!==a && Math.sign(base.att[k].y-CY)===Math.sign(base.att[a].y-CY))
          s1.att[k] = clamp({ x: base.att[k].x - 10, y: base.att[k].y - Math.sign(base.att[a].y-CY)*14 }); });
        s1.att[a] = clamp({ x: base.att[a].x + 6, y: base.att[a].y });
        s1.ball = { carrier:'A'+a };
        const notes = {}; notes[a] = 'Isolate on the wing — attack your defender off the dribble.';
        return { steps:[s1], notes };
      } },

    { id:'cross-face', side:'offense', scope:'player', icon:'↪️', name:'Cross-face Drive',
      cue:'Drive the baseline, then cross-face back to the open side to beat the keeper.',
      build(base, ctx) {
        const a = ctx.target!=='team' && base.att[ctx.target] ? ctx.target
                : (base.ball.carrier && base.ball.carrier[0]==='A' ? base.ball.carrier.slice(1) : holeKey(base));
        if (!a || !base.att[a]) return null;
        const s1 = clone(base); s1.att[a] = clamp({ x: GOALX-20, y: base.att[a].y>CY ? 150 : 70 });
        s1.ball = { carrier:'A'+a };
        const notes = {}; notes[a] = 'Attack the baseline, then cross-face to the far side for the shot.';
        return { steps:[s1], notes };
      } },

    { id:'overload', side:'offense', scope:'team', icon:'🔄', name:'Overload Rotation',
      cue:'Rotate three attackers to one side to overload the defense, then swing the ball.',
      build(base) {
        const top = keys(base.att).sort((a,b)=>base.att[a].y-base.att[b].y);
        const s1 = clone(base);
        top.slice(0,3).forEach((k,i)=> s1.att[k] = clamp({ x: base.att[k].x+6, y: 70 + i*22 }));
        const notes = {}; top.slice(0,3).forEach(k=> notes[k]='Rotate strong-side to overload — keep the ball moving.');
        return { steps:[s1], notes };
      } },

    /* ---------------- DEFENSE ---------------- */
    { id:'double-hole', side:'defense', scope:'pair', icon:'👥', name:'Double-team the Hole',
      cue:'Two defenders sandwich the 2m set so the ball can’t get in clean.',
      build(base) {
        const hole = holeKey(base); if (!hole) return null;
        const hp = base.att[hole];
        const d1 = nearestKey(base.def, hp, null);
        const d2 = nearestKey(base.def, hp, new Set([d1]));
        const s1 = clone(base);
        if (d1) s1.def[d1] = clamp({ x: hp.x-6, y: hp.y-9 });
        if (d2) s1.def[d2] = clamp({ x: hp.x-6, y: hp.y+9 });
        const notes = {}; if (d1) notes[d1]='Front the set ball-side — deny the entry pass.';
        if (d2) notes[d2]='Sink behind the set — sandwich, no clean catch.';
        return { steps:[s1], notes };
      } },

    { id:'front-hole', side:'defense', scope:'player', icon:'🚧', name:'Front the Hole',
      cue:'The set-defender fronts the 2m player ball-side to kill the entry pass.',
      build(base, ctx) {
        const hole = holeKey(base); if (!hole) return null; const hp = base.att[hole];
        const d = ctx.target!=='team' && base.def[ctx.target] ? ctx.target : nearestKey(base.def, hp, null);
        if (!d) return null;
        const s1 = clone(base); s1.def[d] = clamp({ x: hp.x-7, y: hp.y });
        const notes = {}; notes[d] = 'Front the set ball-side, hands up, refuse the entry pass.';
        return { steps:[s1], notes };
      } },

    { id:'goalie-out', side:'defense', scope:'gk', icon:'🧤', name:'Goalie Out Front',
      cue:'Keeper comes off the line to cut down the shooter’s angle.',
      build(base) {
        const ball = carrierPt(base) || { x: FIVEX, y: CY };
        const s1 = clone(base);
        const dx = ball.x - base.gk.x, dy = ball.y - base.gk.y, m = Math.hypot(dx,dy)||1;
        s1.gk = clamp({ x: base.gk.x + (dx/m)*10, y: base.gk.y + (dy/m)*5 });
        return { steps:[s1], notes:{ GK:'Come off the line, close the angle, big and set before the shot.' } };
      } },

    { id:'collapse', side:'defense', scope:'team', icon:'🕸️', name:'Collapse / Help',
      cue:'Everyone sinks between the two ball-side attackers to wall off the goal.',
      build(base) {
        const ball = carrierPt(base) || { x: FIVEX, y: CY };
        const hp = base.att[holeKey(base)] || { x: HOLEX, y: CY };
        const mid = { x:(ball.x+hp.x)/2 - 6, y:(ball.y+hp.y)/2 };
        const s1 = clone(base); const notes = {};
        keys(base.def).forEach(k => { const p=base.def[k];
          s1.def[k] = clamp({ x: p.x + (mid.x-p.x)*0.45, y: p.y + (mid.y-p.y)*0.45 });
          notes[k] = 'Collapse to the middle — protect the goal, help ball-side.'; });
        return { steps:[s1], notes };
      } },

    { id:'tactical-foul', side:'defense', scope:'player', icon:'✋', name:'Ordinary Foul (stop the attack)',
      cue:'Nearest defender puts an ordinary foul on the ball to break the rhythm and reset the defense.',
      build(base, ctx) {
        const ball = carrierPt(base) || { x: FIVEX, y: CY };
        const d = ctx.target!=='team' && base.def[ctx.target] ? ctx.target : nearestKey(base.def, ball, null);
        if (!d) return null;
        const s1 = clone(base);
        s1.def[d] = clamp({ x: ball.x - 5, y: ball.y });
        const notes = {}; notes[d] = 'Ordinary foul on the ball (no advantage) — stop the drive, no free path, reset marks.';
        return { steps:[s1], notes };
      } },

    { id:'press-deny', side:'defense', scope:'team', icon:'🙌', name:'Full Press / Deny',
      cue:'Get up in the passing lanes and pressure the ball high.',
      build(base) {
        const s1 = clone(base); const notes = {};
        keys(base.def).forEach(k => { const mate = base.att[k]; const p = base.def[k];
          const tgt = mate ? { x: mate.x-8, y: mate.y } : { x: p.x-8, y: p.y };
          s1.def[k] = clamp(tgt); notes[k] = 'Press your man, deny the lane, hands in the passing line.'; });
        return { steps:[s1], notes };
      } },

    { id:'drop-zone', side:'defense', scope:'team', icon:'🛡️', name:'Drop into Zone',
      cue:'Sink into a tight zone around the 2m and protect the centre.',
      build(base) {
        const s1 = clone(base); const notes = {}; const dk = keys(base.def);
        dk.forEach((k,i)=>{ const spread = (i-(dk.length-1)/2);
          s1.def[k] = clamp({ x: HOLEX-14 + Math.abs(spread)*4, y: CY + spread*24 });
          notes[k] = 'Sink into the zone — guard your area, hands up, funnel outside.'; });
        return { steps:[s1], notes };
      } },

    { id:'switch', side:'defense', scope:'pair', icon:'🔀', name:'Switch on the Screen',
      cue:'Two defenders swap marks through the screen so no one gets a free man.',
      build(base) {
        const dk = keys(base.def); if (dk.length<2) return null;
        let a=dk[0], b=dk[1], bd=1e9;
        for (let i=0;i<dk.length;i++) for (let j=i+1;j<dk.length;j++){
          const d=dist(base.def[dk[i]],base.def[dk[j]]); if(d<bd){bd=d;a=dk[i];b=dk[j];} }
        const s1 = clone(base); const pa=base.def[a], pb=base.def[b];
        s1.def[a] = clamp(pb); s1.def[b] = clamp(pa);
        const notes = {}; notes[a]='Call the switch — take their man through the screen.';
        notes[b]='Switch — pick up the screener, no free release.';
        return { steps:[s1], notes };
      } },

    { id:'recover', side:'defense', scope:'team', icon:'🏊', name:'Sprint Back / Recover',
      cue:'Everyone sprints back goal-side to stop the counter.',
      build(base) {
        const s1 = clone(base); const notes = {}; const dk = keys(base.def);
        dk.forEach((k,i)=>{ s1.def[k] = clamp({ x: HOLEX-6, y: 70 + i*(120/Math.max(1,dk.length-1)) });
          notes[k]='Sprint back goal-side, find a man, no easy centre.'; });
        s1.gk = clamp({ x: GOALX+2, y: CY });
        notes.GK='Recover to the line, organise the wall, talk them back.';
        return { steps:[s1], notes };
      } },

    /* ---------------- TRANSITION ---------------- */
    { id:'counter', side:'transition', scope:'team', icon:'⚡', name:'Counter-attack',
      cue:'On the turnover, sprint out wide and get numbers up the pool.',
      build(base) {
        const s1 = clone(base); const ak = keys(base.att); const notes = {};
        ak.forEach((k,i)=>{ const lane = i/(Math.max(1,ak.length-1));
          s1.att[k] = clamp({ x: base.att[k].x + 18, y: 55 + lane*110 });
          notes[k]='Release early, sprint your lane, get ahead of the ball.'; });
        return { steps:[s1], notes };
      } },

    { id:'man-up-swing', side:'offense', scope:'team', icon:'🔁', name:'Man-up Quick Swing',
      cue:'Extra-man: swing the ball fast side-to-side and hit the open shooter.',
      build(base) {
        const ak = keys(base.att); if (!ak.length) return null;
        const shooter = ak.sort((a,b)=>base.att[b].x-base.att[a].x)
          .find(k=>base.att[k].x<GOALX-20) || ak[0];
        const s1 = clone(base); s1.ball = { carrier:'A'+shooter };
        s1.att[shooter] = clamp({ x: base.att[shooter].x+4, y: base.att[shooter].y });
        const notes = {}; notes[shooter]='Catch the swing on the move — one-time shot before the block sets.';
        ak.forEach(k=>{ if(!notes[k]) notes[k]='Move the ball first-time, force the box to shift.'; });
        return { steps:[s1], notes };
      } },

    { id:'penalty-set', side:'offense', scope:'team', icon:'🥅', name:'5m Penalty Set',
      cue:'Line up for the 5m penalty — shooter on the line, everyone behind the ball.',
      build(base) {
        const ak = keys(base.att); if (!ak.length) return null;
        const shooter = ak[0]; const s1 = clone(base);
        s1.att[shooter] = clamp({ x: FIVEX, y: CY }); s1.ball = { carrier:'A'+shooter };
        ak.slice(1).forEach((k,i)=> s1.att[k] = clamp({ x: POINTX-14, y: 70+i*22 }));
        s1.gk = clamp({ x: GOALX+3, y: CY });
        const notes = {}; notes[shooter]='On the 5m line, pick your corner, shoot on the whistle.';
        notes.GK='On the line until the shot — read the shooter, explode to your side.';
        return { steps:[s1], notes };
      } },
  ];

  const byId = {};
  LIST.forEach(c => byId[c.id] = c);

  /* apply(scenario, id, opts) → { steps, notes, cmd } | null
     Non-mutating: caller splices `steps` into scenario.frames. */
  function apply(scenario, id, opts) {
    const cmd = byId[id]; if (!cmd) return null;
    const base = scenario.frames[scenario.frames.length - 1];
    const out = cmd.build(clone(base), { target: (opts && opts.target) || 'team',
                                         situation: scenario.situation });
    if (!out || !out.steps || !out.steps.length) return null;
    return { steps: out.steps, notes: out.notes || {}, cmd };
  }

  return { list: LIST, byId, apply, SIDES: ['offense','defense','transition'] };
})();
