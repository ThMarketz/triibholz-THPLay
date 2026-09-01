/* ============================================================
   planner.js — goal → periodised training plan.

   Set a goal (what, and the date to peak for) and this builds a
   classic periodised plan: a macrocycle split into mesocycles
   (General Prep → Specific Prep → Competition → Taper), each made of
   weekly microcycles with a load wave (volume builds then tapers,
   intensity rises toward the goal, a deload every 4th week), and each
   week broken into water-polo sessions.

   Pure and unit-tested. The sessions convert straight into calendar
   events (planToEvents), so the plan lands on the schedule.
   ============================================================ */
const PLANNER = (() => {
  const DAY = 86400000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // water-polo session library, keyed by focus
  const LIB = {
    endurance: { title: 'Aerobic conditioning', drills: ['Warm-up 400m mixed', '8×100m swim on 1:40', 'Eggbeater intervals 6×1min', 'Cool-down 200m'] },
    strength:  { title: 'Dryland strength', drills: ['Mobility + activation', 'Squat / hinge / press 4×6', 'Core anti-rotation 3×', 'Med-ball throws 4×5'] },
    power:     { title: 'Speed & power', drills: ['Explosive eggbeater 8×15s', 'Sprint swims 10×25m max', 'Shot-power from 6m', 'Full recovery between reps'] },
    shooting:  { title: 'Shooting', drills: ['Dry technique + wrist', 'Quick release off the pass', 'Corners & lobs vs keeper', 'Penalty routine ×10'] },
    skills:    { title: 'Ball skills & passing', drills: ['Dry passing ladder', 'Wet passing on the move', 'One-hand control', 'Fakes & pump'] },
    tactics:   { title: 'Tactics & game', drills: ['6-on-5 sets', 'Drop / press defense', 'Counter-attack lanes', 'Small-sided game'] },
    recovery:  { title: 'Recovery', drills: ['Easy 800m swim', 'Mobility & stretch', 'Breathing / down-regulate'] },
    match:     { title: 'Match', drills: ['Match day — warm-up & compete'] },
  };
  const FOCI = ['endurance', 'strength', 'power', 'shooting', 'skills', 'tactics'];

  // emphasis (session-mix weighting) per mesocycle phase
  const EMPHASIS = {
    'General Prep':  { endurance: 3, strength: 2, skills: 2, tactics: 1, shooting: 1, power: 0 },
    'Specific Prep': { endurance: 2, strength: 1, power: 2, shooting: 2, tactics: 2, skills: 1 },
    'Competition':   { tactics: 3, shooting: 2, power: 2, endurance: 1, skills: 1, strength: 1 },
    'Taper':         { tactics: 2, shooting: 2, power: 1, recovery: 2, skills: 1, endurance: 1 },
  };

  function phaseSplit(weeks) {
    if (weeks <= 2) return [{ name: 'Competition', weeks }];
    if (weeks <= 4) return [{ name: 'Specific Prep', weeks: weeks - 1 }, { name: 'Taper', weeks: 1 }];
    // proportional, taper 1–2 wks, at least 1 wk each phase
    const taper = weeks >= 12 ? 2 : 1;
    let comp = Math.max(1, Math.round(weeks * 0.20));
    let spec = Math.max(1, Math.round(weeks * 0.30));
    let gen = weeks - taper - comp - spec;
    while (gen < 1) { if (spec > 1) spec--; else if (comp > 1) comp--; gen = weeks - taper - comp - spec; }
    return [{ name: 'General Prep', weeks: gen }, { name: 'Specific Prep', weeks: spec }, { name: 'Competition', weeks: comp }, { name: 'Taper', weeks: taper }];
  }

  // volume/intensity (0-100) for a given phase + week-in-phase + deload
  function load(phase, wk, phaseWeeks, deload) {
    const p = phaseWeeks > 1 ? wk / (phaseWeeks - 1) : 1;   // 0..1 progress in phase
    let vol, int;
    if (phase === 'General Prep') { vol = 60 + 30 * p; int = 40 + 20 * p; }
    else if (phase === 'Specific Prep') { vol = 75 - 10 * p; int = 60 + 25 * p; }
    else if (phase === 'Competition') { vol = 55 - 10 * p; int = 85 + 10 * p; }
    else { vol = 45 - 30 * p; int = 80 - 5 * p; }           // Taper: cut volume, keep intensity
    if (deload) vol *= 0.6;
    return { volume: Math.round(clamp(vol, 15, 100)), intensity: Math.round(clamp(int, 30, 100)) };
  }

  // choose the session focus for slot i, weighted by phase emphasis + the goal's focus
  function pickFocus(phase, i, goalFocus) {
    const w = Object.assign({}, EMPHASIS[phase] || EMPHASIS['Specific Prep']);
    (goalFocus || []).forEach(f => { if (w[f] != null) w[f] += 2; });
    const bag = [];
    Object.keys(w).forEach(f => { for (let k = 0; k < w[f]; k++) bag.push(f); });
    if (!bag.length) return FOCI[i % FOCI.length];
    return bag[(i * 7 + 3) % bag.length];                  // deterministic spread
  }

  function weekSessions(phase, loadv, daysPerWeek, weekStart, goal, deload) {
    const n = clamp(daysPerWeek || 4, 1, 7);
    // spread session days across the week (e.g. Mon/Tue/Thu/Sat)
    const dayIdx = [1, 2, 4, 6, 3, 5, 0].slice(0, n).sort((a, b) => a - b);
    const sessions = [];
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      let focus = deload && last ? 'recovery' : pickFocus(phase, i, goal.focus);
      if (phase === 'Taper' && last) focus = 'recovery';
      const lib = LIB[focus] || LIB.skills;
      const rpe = clamp(Math.round((loadv.intensity / 10) + (focus === 'recovery' ? -3 : 0)), 2, 10);
      const dur = focus === 'recovery' ? 40 : Math.round(50 + loadv.volume * 0.5);
      sessions.push({
        day: dayIdx[i], date: CALDATE(weekStart, dayIdx[i]),
        focus, title: lib.title, drills: lib.drills.slice(),
        durationMin: dur, rpe,
      });
    }
    return sessions;
  }
  // date of a weekday within a week that starts on `weekStart` (Mon-based day index 0=Sun)
  function CALDATE(weekStart, dow) { const d = new Date(weekStart); d.setDate(weekStart.getDate() + ((dow - weekStart.getDay() + 7) % 7)); return d; }

  /* generatePlan(goal) → { goal, weeks, mesocycles, microcycles } */
  function generatePlan(goal) {
    goal = goal || {};
    const start = goal.startDate ? new Date(goal.startDate) : new Date();
    start.setHours(0, 0, 0, 0);
    const target = goal.targetDate ? new Date(goal.targetDate) : new Date(start.getTime() + 56 * DAY);
    const weeks = clamp(Math.ceil((target - start) / (7 * DAY)), 1, 52);
    const phases = phaseSplit(weeks);

    const meso = []; const micro = [];
    let wkAbs = 0;
    phases.forEach(ph => {
      const from = new Date(start.getTime() + wkAbs * 7 * DAY);
      const to = new Date(start.getTime() + (wkAbs + ph.weeks) * 7 * DAY);
      meso.push({ name: ph.name, weeks: ph.weeks, from: from.toISOString(), to: to.toISOString(), emphasis: EMPHASIS[ph.name] || {} });
      for (let w = 0; w < ph.weeks; w++) {
        const weekStart = new Date(start.getTime() + wkAbs * 7 * DAY);
        const deload = ((wkAbs + 1) % 4 === 0) && ph.name !== 'Taper' && ph.name !== 'Competition';
        const lv = load(ph.name, w, ph.weeks, deload);
        micro.push({
          week: wkAbs + 1, phase: ph.name, deload,
          from: weekStart.toISOString(), to: new Date(weekStart.getTime() + 7 * DAY).toISOString(),
          load: lv, sessions: weekSessions(ph.name, lv, goal.daysPerWeek, weekStart, goal, deload),
        });
        wkAbs++;
      }
    });
    return { goal: { title: goal.title || 'Season goal', targetDate: target.toISOString(), startDate: start.toISOString(), daysPerWeek: goal.daysPerWeek || 4, focus: goal.focus || [] }, weeks, mesocycles: meso, microcycles: micro };
  }

  // plan sessions → calendar events (training type)
  function planToEvents(plan) {
    const out = [];
    (plan.microcycles || []).forEach(mc => (mc.sessions || []).forEach(s => {
      const start = new Date(s.date); start.setHours(18, 0, 0, 0);   // default 18:00 local
      out.push({
        id: 'plan_' + plan.goal.title.replace(/\W+/g, '').slice(0, 8) + '_w' + mc.week + '_' + s.day + '_' + s.focus,
        type: 'training', title: `${s.title} · wk${mc.week} (${mc.phase})`,
        start: start.toISOString(), end: new Date(start.getTime() + s.durationMin * 60000).toISOString(),
        focus: s.focus, notes: `RPE ${s.rpe} · ${s.durationMin} min\n` + s.drills.join('; '),
        planWeek: mc.week,
      });
    }));
    return out;
  }

  return { LIB, FOCI, generatePlan, planToEvents, phaseSplit, load };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = PLANNER;
