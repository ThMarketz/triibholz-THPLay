/* ============================================================
   testlog.js — a player's own development record.

   Modelled directly on a real club's paper/Excel process (SC Horgen —
   Damen Dolphins, "Project 30" individual test logbook): a player's own
   profile + self-set goal, a dated test-result log measured against
   age-band season targets, a weekly swim log that counts CLUB and
   HOME/self training side by side, and — new here — a weekly home
   programme with a "keep the streak alive" companion (the mascot) so
   home training gets the same visible feedback loop as a pool session.

   Everything here is pure and unit-tested. It knows nothing about the
   DOM or localStorage — js/app.js owns storage and rendering.
   ============================================================ */
const TESTLOG = (() => {
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------------- 1) the test catalogue + season targets ----------------
     Four progression tiers, as in the source logbook (their own club's
     season labels — editable text, not load-bearing). Values are the
     exact targets from that logbook. lower=true → a smaller number is
     the better result (times); lower=false → bigger is better (counts,
     distances, percentages). Four field tests and two goalkeeper tests
     are shared with the official Swiss Aquatics PISTE test. */
  const TIERS = ['U14', 'U16', 'U18-A', 'U18-B'];   // generic tier labels; a club can relabel in its own season names
  const FIELD_TESTS = [
    { id: 'free25', label: '25 m freestyle', unit: 's', lower: true, piste: true, targets: [16.0, 15.0, 14.5, 14.0] },
    { id: 'free50', label: '50 m freestyle', unit: 's', lower: true, piste: true, targets: [36.0, 34.0, 32.5, 31.0] },
    { id: 'free100', label: '100 m freestyle', unit: 'min:s', lower: true, piste: true, targets: [82, 76, 72, 69] },   // stored as seconds
    { id: 'swim200', label: '200 m', unit: 'min:s', lower: true, piste: false, targets: [170, 160, 152, 145] },
    { id: 'dropoff8x25', label: '8×25 m drop-off', unit: 's drop', lower: true, piste: false, targets: [2.0, 1.5, 1.2, 1.0] },
    { id: 'passDist', label: 'Passing distance', unit: 'm', lower: false, piste: false, targets: [20, 25, 28, 30] },
    { id: 'ballOverhead', label: 'Ball overhead hold (3 kg)', unit: 's', lower: false, piste: true, targets: [90, 120, 150, 150] },
    { id: 'jumpsCrossbar', label: 'Jumps to the crossbar / 30 s', unit: 'reps', lower: false, piste: false, targets: [14, 20, 24, 30] },
    { id: 'swimPerWeek', label: 'Swimming per week', unit: 'km', lower: false, piste: false, targets: [3.75, 4.25, 4.75, 5] },
  ];
  const GK_TESTS = [
    { id: 'eggbeaterPush', label: 'Push-up height from eggbeater', unit: 'cm vs baseline', lower: false, piste: false, targets: [null, 5, 10, 15] },
    { id: 'sideShuttle', label: 'Side shuttle 4×5 m', unit: 's', lower: true, piste: false, targets: [22, 19, 17, 16] },
    { id: 'lungeSteps', label: 'Lunge steps / 30 s', unit: 'reps', lower: false, piste: false, targets: [12, 16, 20, 24] },
    { id: 'ballOverheadGk', label: 'Ball overhead hold (3 kg)', unit: 's', lower: false, piste: true, targets: [105, 135, 165, 165] },
    { id: 'throwHalfway', label: 'Throw over the halfway line', unit: 'm', lower: false, piste: false, targets: [18, 22, 26, 28] },
    { id: 'catchRate', label: 'Catch / save rate', unit: '% vs baseline', lower: false, piste: false, targets: [null, 10, 15, 20] },
    { id: 'penalty5m', label: 'Penalty 5 m (out of 20)', unit: '/ 20', lower: false, piste: true, targets: [3, 5, 6, 7] },
  ];
  const testsFor = isGK => isGK ? GK_TESTS : FIELD_TESTS;
  const testById = (id, isGK) => testsFor(isGK).find(t => t.id === id) || testsFor(!isGK).find(t => t.id === id);

  /* accepts "37.4", "1:22", "1:22.5" → seconds; passes plain numbers through */
  function parseResultValue(raw) {
    if (typeof raw === 'number') return raw;
    const s = String(raw == null ? '' : raw).trim().replace(',', '.');
    if (!s) return null;
    const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
    if (m) return (+m[1]) * 60 + (+m[2]);
    const n = parseFloat(s.replace(/[^\d.\-]/g, ''));
    return isFinite(n) ? n : null;
  }
  function fmtSeconds(v) {
    if (v == null) return '';
    if (v < 60) return (+v.toFixed(2)).toString();
    const m = Math.floor(v / 60), sec = +(v - m * 60).toFixed(1);
    return `${m}:${sec < 10 ? '0' + sec : sec}`;
  }

  /* evaluate(test, resultRaw, tierIndex) → { value, target, met, deltaText } — null-safe throughout */
  function evaluate(test, resultRaw, tierIndex) {
    if (!test) return null;
    const value = parseResultValue(resultRaw);
    const target = test.targets[Math.max(0, Math.min(test.targets.length - 1, tierIndex || 0))];
    if (value == null) return { value: null, target, met: null, deltaText: 'no result yet' };
    if (target == null) return { value, target: null, met: null, deltaText: 'baseline — no fixed target yet' };
    const met = test.lower ? value <= target : value >= target;
    const diff = test.lower ? (value - target) : (target - value);
    // whole-unit match: 'reps' ends in 's' too, and "6.0s to go" for a rep count is simply wrong
    const unitTxt = (test.unit === 's' || test.unit === 'min:s') ? 's' : (test.unit.split(' ')[0] === '%' ? '%' : '');
    const deltaText = met
      ? `at target${diff !== 0 ? ` (by ${Math.abs(diff).toFixed(1)}${unitTxt})` : ''}`
      : `${Math.abs(diff).toFixed(1)}${unitTxt} to go`;
    return { value, target, met, deltaText };
  }

  /* ---------------- 1b) who vouches for a result ----------------
     A player may log anything on their own record — self-tracking is the point.
     But a number only counts towards a target once a coach has confirmed it.
     Same vocabulary as the app's existing login-approval queue (pending/approved/
     denied) so the mental model — and the status-chip styling — already exist.

     A stored entry with NO status is legacy: it was written under the old rules,
     mostly by a coach's own import, so it is grandfathered as `approved`. What
     marks it as never-coach-signed is the EMPTY verifiedBy, not a downgrade —
     defaulting old data to `pending` would silently un-green every existing card. */
  const TEST_STATUSES = ['pending', 'approved', 'denied'];
  const APPROVED_WORDS = ['approved', 'verified', 'confirmed', 'ok', 'yes', 'true', '1', 'ja', 'bestätigt', 'bestaetigt'];
  const PENDING_WORDS = ['pending', 'open', 'offen', 'self', 'selbst', 'self-reported'];
  const DENIED_WORDS = ['denied', 'rejected', 'no', 'false', 'nein', 'abgelehnt'];
  function normalizeTestStatus(s) {
    const v = String(s == null ? '' : s).trim().toLowerCase();
    if (!v) return 'approved';                       // legacy / a workbook with no such column
    if (APPROVED_WORDS.includes(v)) return 'approved';
    if (PENDING_WORDS.includes(v)) return 'pending';
    if (DENIED_WORDS.includes(v)) return 'denied';
    return 'pending';                                // never grant authority to a token we don't understand
  }
  const isOfficialResult = entry => normalizeTestStatus(entry && entry.status) === 'approved';

  /* latestResults(tests) → { official, pending } — newest entry per test name in each.
     A denied entry lands in neither: it is neither authoritative nor awaiting anything. */
  function latestResults(tests) {
    const official = {}, pending = {};
    (tests || []).forEach(t => {
      if (!t || !t.test) return;
      const st = normalizeTestStatus(t.status);
      if (st === 'denied') return;
      const into = st === 'approved' ? official : pending;
      if (!into[t.test] || String(t.date || '') > String(into[t.test].date || '')) into[t.test] = t;
    });
    return { official, pending };
  }

  /* ---------------- 1c) one player's row, for the squad table ----------------
     Built only from the functions above so the squad view and the player's own
     stat strip can never disagree — they are the same arithmetic. */
  function squadRow(dev, home, weekKey, opts) {
    dev = dev || {}; const info = dev.info || {};
    const cat = testsFor(!!info.isGK);
    const latest = latestResults(dev.tests || []);
    const at = (map, t) => map[t.label] || map[t.id];   // imports store the workbook's own label
    const isMet = (map, t) => { const l = at(map, t); return !!l && evaluate(t, l.result, info.tier || 0).met === true; };
    const met = cat.filter(t => isMet(latest.official, t) || isMet(latest.pending, t)).length;
    const metVerified = cat.filter(t => isMet(latest.official, t)).length;
    const dates = (dev.tests || []).map(t => t.date || '').filter(Boolean).sort();
    const lastDate = dates.length ? dates[dates.length - 1] : null;
    const newest = lastDate ? (dev.tests || []).filter(t => t.date === lastDate)[0] : null;
    const m = mascotState((home && home.log) || [], weekKey);
    const week = (dev.swimWeeks || []).find(r => r.week === weekKey);
    return {
      total: cat.length, met, metVerified, metUnverified: met - metVerified,
      pendingCount: (dev.tests || []).filter(t => normalizeTestStatus(t.status) === 'pending').length,
      lastDate, lastVerified: isOfficialResult(newest),
      compliance: m.compliance, mood: m.mood, streak: m.streak,
      metres: week ? (+week.total || 0) : 0,
      hasTests: (dev.tests || []).length > 0, hasSwim: (dev.swimWeeks || []).length > 0,
      training: attendanceSummary(dev.attendance, opts || {}),   // imported from the club's Spond export
      hasTraining: (dev.attendance || []).length > 0,
    };
  }

  /* ---------------- 1e) the squad, as numbers a chart can draw ----------------
     Everything here is built from evaluate() / latestResults() / focusGaps(), the same
     functions the squad table and a player's own card use, so a chart can never tell a
     different story from the table above it.

     `players` is [{ id, name, tier, isGK, tests }] — no storage, no DOM.

     Results in this catalogue are measured in seconds, metres, reps and percentages, and
     every player is measured against the target for THEIR tier. A dot strip therefore plots
     `ratio`: 1 means "at my own target", below 1 means short of it — the only scale on which
     a U14 and a U18 keeper can sit in the same row honestly. The raw value travels with it
     so the coach reads real numbers, never a normalised one. */
  const RATIO_CAP = 1.5;
  function progressRatio(test, value, target) {
    if (value == null || target == null || !isFinite(value) || !isFinite(target) || value <= 0 || target <= 0) return null;
    const r = test.lower ? target / value : value / target;
    return +Math.min(RATIO_CAP, Math.max(0, r)).toFixed(3);
  }
  function median(values) {
    const v = values.filter(x => x != null && isFinite(x)).slice().sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = v.length >> 1;
    return v.length % 2 ? v[mid] : +((v[mid - 1] + v[mid]) / 2).toFixed(3);
  }
  /* the newest result per test for one player, denied dropped, optionally only recent ones */
  function newestByTest(tests, cat, opts) {
    const out = {};
    (tests || []).forEach(r => {
      if (!r || !r.test) return;
      if (normalizeTestStatus(r.status) === 'denied') return;
      const t = cat.find(x => x.label === r.test) || cat.find(x => x.id === r.test);
      if (!t) return;
      if (opts && opts.today && r.date && opts.maxAgeDays) {
        const ageDays = (Date.parse(opts.today + 'T00:00:00Z') - Date.parse(r.date + 'T00:00:00Z')) / 86400000;
        if (isFinite(ageDays) && ageDays > opts.maxAgeDays) return;
      }
      if (!out[t.id] || String(r.date || '') > String(out[t.id].r.date || '')) out[t.id] = { t, r };
    });
    return out;
  }

  /* squadByTest(players, opts) → one row per test of the catalogue, worst-covered first is the
     caller's business; the order here is the catalogue's own. opts.gk picks the keeper catalogue. */
  function squadByTest(players, opts) {
    opts = opts || {};
    const gk = !!opts.gk;
    const cat = testsFor(gk);
    const mine = (players || []).filter(p => !!(p && p.isGK) === gk);
    return cat.map(test => {
      const rows = [];
      mine.forEach(p => {
        const hit = newestByTest(p.tests, cat, opts)[test.id];
        if (!hit) return;
        const ev = evaluate(test, hit.r.result, p.tier || 0);
        if (!ev || ev.value == null) return;
        rows.push({
          playerId: p.id, name: p.name, value: ev.value, target: ev.target, met: ev.met,
          ratio: progressRatio(test, ev.value, ev.target), deltaText: ev.deltaText,
          verified: isOfficialResult(hit.r), date: hit.r.date || '',
        });
      });
      const values = rows.map(r => r.value);
      return {
        testId: test.id, label: test.label, unit: test.unit, lower: !!test.lower, piste: !!test.piste,
        rows, n: rows.length, missing: mine.length - rows.length,
        metCount: rows.filter(r => r.met === true).length,
        verifiedCount: rows.filter(r => r.verified).length,
        median: median(values), best: values.length ? (test.lower ? Math.min(...values) : Math.max(...values)) : null,
      };
    });
  }

  /* playerSeries(tests, testRef, tier) → that test over time, oldest first: the first view in the
     app that shows a result as anything but a row in a table. */
  function playerSeries(tests, testRef, tier, isGK) {
    const test = testById(testRef, !!isGK);
    if (!test) return [];
    return (tests || [])
      .filter(r => r && (r.test === test.label || r.test === test.id) && normalizeTestStatus(r.status) !== 'denied')
      .map(r => { const ev = evaluate(test, r.result, tier || 0); return ev && ev.value != null ? { date: r.date || '', value: ev.value, target: ev.target, met: ev.met, verified: isOfficialResult(r), ratio: progressRatio(test, ev.value, ev.target) } : null; })
      .filter(Boolean)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  /* squadFocus(players, opts) → where the squad is furthest behind, worst first. Each player
     contributes their own worst gap per focus, so a focus with three tests cannot outweigh one
     with a single test simply by being measured more often. */
  function squadFocus(players, opts) {
    const per = {};
    (players || []).forEach(p => {
      const gaps = focusGaps(p.tests, { tier: p.tier || 0, isGK: !!p.isGK, today: opts && opts.today, maxAgeDays: opts && opts.maxAgeDays });
      const worst = {};
      gaps.forEach(g => { if (!worst[g.focus] || g.gap > worst[g.focus].gap) worst[g.focus] = g; });
      Object.keys(worst).forEach(f => {
        per[f] = per[f] || { focus: f, total: 0, players: 0, worstLabel: null, worstGap: 0 };
        per[f].total += worst[f].gap; per[f].players += 1;
        if (worst[f].gap > per[f].worstGap) { per[f].worstGap = worst[f].gap; per[f].worstLabel = worst[f].label; }
      });
    });
    return Object.values(per).map(x => ({ focus: x.focus, gap: +(x.total / x.players).toFixed(3), players: x.players, worstLabel: x.worstLabel }))
      .sort((a, b) => b.gap - a.gap);
  }

  /* squadCoverage(players, opts) → how much of the squad this view can actually speak for.
     A chart drawn from device-local records must say what it does NOT know. */
  function squadCoverage(players, opts) {
    const list = players || [];
    let withAny = 0, withRecent = 0, verified = 0, self = 0;
    list.forEach(p => {
      const live = (p.tests || []).filter(r => normalizeTestStatus(r.status) !== 'denied');
      if (live.length) withAny++;
      const cat = testsFor(!!p.isGK);
      if (Object.keys(newestByTest(p.tests, cat, opts)).length) withRecent++;
      live.forEach(r => { if (isOfficialResult(r)) verified++; else self++; });
    });
    return { total: list.length, withAny, withRecent, missing: list.length - withAny, verified, self,
      verifiedShare: verified + self ? +(verified / (verified + self)).toFixed(3) : null };
  }

  /* ---------------- 1d) which training focus a test speaks to ----------------
     Maps the catalogue onto the six focus areas the season planner knows. This is
     a coaching judgement, not arithmetic — each line says why. NOTE what is NOT
     here: no field test maps to 'shooting' or 'tactics', because this catalogue
     measures physical qualities. A field player's test log can therefore never
     pull a plan toward shooting or tactics, and the UI says so rather than
     implying the plan is fully data-driven. */
  const TEST_FOCUS = {
    // field
    free25: 'power',          // the 25 m sprint IS the counter-attack break
    free50: 'power',          // top-end swim speed; there is no 50 m swim in a game
    free100: 'endurance',     // speed-endurance — the 8×100 set is what moves it
    swim200: 'endurance',     // aerobic base under four quarters
    dropoff8x25: 'endurance', // fade across 8 sprints = repeat-sprint ability
    passDist: 'skills',       // the only ball-in-hand measure in the catalogue
    ballOverhead: 'strength', // 3 kg isometric hold = shoulder/trunk strength-endurance
    jumpsCrossbar: 'power',   // repeated maximal eggbeater lift
    swimPerWeek: 'endurance', // a weekly kilometre shortfall is an aerobic-volume shortfall
    // goalkeeper
    eggbeaterPush: 'power',   // explosive rise — the keeper's defining power quality
    sideShuttle: 'power',     // 4×5 m lateral = repeated maximal accelerations
    lungeSteps: 'strength',   // 30 s rep count = dryland leg strength-endurance
    ballOverheadGk: 'strength',
    throwHalfway: 'skills',   // the outlet throw starts the counter
    penalty5m: 'shooting',    // the only session where a keeper faces shots
    catchRate: null,          // outcome confounded by who shot at you; no session to route it to
  };

  /* how far apart the easiest and hardest tier targets are — one "step of development" */
  function testSpan(test) {
    const ts = (test && test.targets || []).filter(v => v != null);
    return ts.length > 1 ? Math.abs(ts[ts.length - 1] - ts[0]) : 0;
  }

  /* focusGaps(tests, info) → [{focus, gap, …}] worst first.
     Gaps are normalised against the catalogue's own tier ladder, so a gap means the
     same amount of work whatever the unit: 1.4 s off a 50 m free (span 5 s) = 0.28,
     6 m off a passing target (span 10 m) = 0.60 — correctly the bigger gap, which a
     raw delta (6 vs 1.4) or a fraction-of-target would both rank differently.
     Self-reported results still count, at a discount: this output only nudges a
     training plan, and excluding them would make the feature inert for exactly the
     players it exists for. */
  function focusGaps(tests, info) {
    info = info || {};
    const cat = testsFor(!!info.isGK);
    const newest = {};
    (tests || []).forEach(r => {
      if (!r || !r.test) return;
      const t = cat.find(x => x.label === r.test) || cat.find(x => x.id === r.test);
      if (!t || !TEST_FOCUS[t.id]) return;
      if (normalizeTestStatus(r.status) === 'denied') return;
      if (info.today && r.date) {
        const ageDays = (Date.parse(info.today + 'T00:00:00Z') - Date.parse(r.date + 'T00:00:00Z')) / 86400000;
        if (isFinite(ageDays) && ageDays > (info.maxAgeDays || 365)) return;
      }
      if (!newest[t.id] || String(r.date || '') > String(newest[t.id].r.date || '')) newest[t.id] = { t, r };
    });
    const out = [];
    Object.keys(newest).forEach(id => {
      const { t, r } = newest[id];
      const ev = evaluate(t, r.result, info.tier || 0);
      if (!ev || ev.met !== false) return;            // met, or no comparable target
      const span = testSpan(t);
      let gap = span > 0 ? Math.abs(ev.value - ev.target) / span
        : (ev.target ? Math.abs(ev.value - ev.target) / Math.abs(ev.target) : 0);
      const official = isOfficialResult(r);
      gap = Math.min(1.5, gap) * (official ? 1 : 0.7);   // cap first so one typo can't swamp a plan
      out.push({ focus: TEST_FOCUS[t.id], gap: +gap.toFixed(3), testId: t.id, label: t.label,
        deltaText: ev.deltaText, value: ev.value, target: ev.target, date: r.date || '', verified: official });
    });
    return out.sort((a, b) => b.gap - a.gap);
  }

  /* ---------------- 2) home training — the weekly programme + the mascot ---------------- */
  const HOME_ACTIVITIES = [
    { id: 'wallPassing', label: 'Wall passing', perWeek: 3, minutes: 15, note: 'Right hand, left hand, catch and release in one motion. Beat last week’s count.', showsUpIn: 'Catching under pressure, weak-hand passing, reaction time.' },
    { id: 'mobility', label: 'Stretching / mobility', perWeek: 7, minutes: 10, note: 'Shoulders, hips, ankles, lats — most important the day after a hard session.', showsUpIn: 'Recovery between sessions; reach and rotation in the stroke.' },
    { id: 'shoulderBand', label: 'Shoulder band routine', perWeek: 3, minutes: 10, note: 'External/internal rotation, pull-aparts, Y-T-W.', showsUpIn: 'Staying healthy enough to train every week — the invisible one.' },
    { id: 'bodyweight', label: 'Bodyweight strength', perWeek: 2.5, minutes: 20, note: 'Squats, push-ups, plank, glute bridge, lunges — no equipment.', showsUpIn: 'Eggbeater height, shot power, holding position against a defender.' },
    { id: 'ballFeel', label: 'Ball feel', perWeek: 7, minutes: 5, note: 'One-hand lifts, wrist rolls, ball on fingertips.', showsUpIn: 'One-hand control, fakes, catching a bad pass cleanly.' },
    { id: 'watchPolo', label: 'Watch water polo', perWeek: 1.5, minutes: 25, note: 'Follow one player in your position for a whole quarter — what do they do without the ball?', showsUpIn: 'Knowing where to be before the ball arrives.' },
  ];
  const mondayOf = (d) => { const x = new Date(d); const day = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - day); return x.toISOString().slice(0, 10); };
  const weekKeyOf = (isoDateStr) => mondayOf(new Date(isoDateStr + 'T00:00:00Z'));

  /* weekCompliance(log, weekKey) → 0..1 across all activities that week */
  function weekCompliance(log, weekKey) {
    const inWeek = (log || []).filter(e => e.week === weekKey);
    let got = 0, want = 0;
    HOME_ACTIVITIES.forEach(a => {
      const n = inWeek.filter(e => e.activityId === a.id).length;
      got += Math.min(n, a.perWeek); want += a.perWeek;
    });
    return want ? got / want : 0;
  }
  /* streak: consecutive PAST weeks (most recent first, excluding the current in-progress one) at ≥0.6 compliance */
  function streakWeeks(log, uptoWeekKeyExclusive) {
    let n = 0, wk = uptoWeekKeyExclusive;
    for (let i = 0; i < 52; i++) {
      const prev = mondayOf(new Date(new Date(wk + 'T00:00:00Z').getTime() - 7 * 86400000));
      if (weekCompliance(log, prev) >= 0.6) { n++; wk = prev; } else break;
    }
    return n;
  }
  const MOODS = [
    { id: 'thriving', min: 0.85, label: 'Thriving', line: 'Every session logged — this is what consistency looks like.' },
    { id: 'happy', min: 0.6, label: 'Doing well', line: 'On track this week — keep the small pieces going.' },
    { id: 'okay', min: 0.35, label: 'A bit hungry', line: 'A few sessions missed — pick one today, it doesn’t need to be much.' },
    { id: 'neglected', min: 0, label: 'Neglected', line: 'It’s been quiet. Twenty minutes of wall passing gets it started again.' },
  ];
  function mascotState(log, weekKey) {
    const compliance = weekCompliance(log, weekKey);
    const mood = MOODS.find(m => compliance >= m.min) || MOODS[MOODS.length - 1];
    const streak = streakWeeks(log, weekKey);
    return { compliance: +compliance.toFixed(2), mood: mood.id, moodLabel: mood.label, line: mood.line, streak };
  }

  /* ---------------- 3) CSV — the round-trip format for the club's own workflow ---------------- */
  function toCSV(rows, cols) {
    const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.map(c => esc(c.label || c.key)).join(',')].concat(rows.map(r => cols.map(c => esc(r[c.key])).join(','))).join('\r\n');
  }
  function parseCSV(text) {
    const rows = []; let row = [], field = '', inQ = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) { if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
      else if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(f => String(f).trim() !== ''));
  }
  // English labels are the app's own; the `syn` lists are what real club workbooks already use
  // (this reader was built and verified against a real German test-logbook) — matching either
  // means a coach's existing spreadsheet imports with no relabelling.
  const TEST_COLS = [
    { key: 'date', label: 'Date', syn: ['datum'] }, { key: 'name', label: 'Name', syn: ['name', 'spielerin'] },
    { key: 'test', label: 'Test', syn: ['test'] }, { key: 'result', label: 'Result', syn: ['resultat', 'ergebnis'] },
    { key: 'unit', label: 'Unit', syn: ['einheit'] }, { key: 'testedBy', label: 'Tested by', syn: ['getestet von', 'getestet'] },
    { key: 'remark', label: 'Remark', syn: ['bemerkung', 'notiz'] },
    // appended AFTER remark so a club's familiar column order is unchanged; all syn entries lowercase (headerMatches compares lowercased)
    { key: 'status', label: 'Status', syn: ['freigabe', 'bestaetigt', 'bestätigt'] },
    { key: 'verifiedBy', label: 'Verified by', syn: ['bestätigt von', 'bestaetigt von', 'freigegeben von'] },
    { key: 'verifiedAt', label: 'Verified on', syn: ['bestätigt am', 'bestaetigt am', 'freigegeben am'] },
  ];
  const SWIM_COLS = [
    { key: 'week', label: 'Week (Monday)', syn: ['woche (datum montag)', 'woche'] }, { key: 'name', label: 'Name', syn: ['name', 'spielerin'] },
    { key: 'metersClub', label: 'Metres club', syn: ['meter verein'] }, { key: 'metersSelf', label: 'Metres self / home', syn: ['meter schwimmclub / selbst', 'meter selbst'] },
    { key: 'total', label: 'Total', syn: ['total'] }, { key: 'attended', label: 'Sessions attended', syn: ['trainings besucht'] },
    { key: 'possible', label: 'Sessions possible', syn: ['von möglich', 'moeglich', 'möglich'] },
  ];
  /* Spond's own admin export (.xlsx): one row per person per event. Spond has no API — no public
     one, no partner programme, no calendar feed — so attendance arrives as a file a club officer
     exports and the coach imports here. The synonyms cover Spond's English and German exports;
     the column names are pinned to a real export from the club before this is called finished. */
  const SPOND_COLS = [
    { key: 'name', label: 'Name', syn: ['name', 'member', 'mitglied', 'teilnehmer', 'teilnehmerin', 'spieler', 'spielerin'] },
    { key: 'event', label: 'Event', syn: ['event', 'veranstaltung', 'termin', 'training', 'aktivität', 'aktivitaet'] },
    { key: 'date', label: 'Date', syn: ['date', 'datum', 'start', 'startdatum', 'start time', 'startzeit'] },
    { key: 'state', label: 'Attendance', syn: ['attendance', 'attended', 'anwesenheit', 'anwesend', 'status', 'response', 'antwort', 'teilnahme', 'zusage', 'rückmeldung', 'rueckmeldung'] },
  ];
  /* Spond's words (and a club's own) → the five states this app counts */
  const ATTEND_WORDS = {
    attended: ['attended', 'present', 'yes', 'accepted', 'going', 'anwesend', 'teilgenommen', 'ja', 'zugesagt', 'da'],
    late: ['late', 'verspätet', 'verspaetet', 'zu spät', 'zu spaet'],
    excused: ['valid absence', 'excused', 'absent (valid)', 'entschuldigt', 'abgemeldet', 'krank', 'ferien'],
    declined: ['declined', 'no', 'not going', 'abgesagt', 'nein', 'absent'],
    invited: ['invited', 'no response', 'unanswered', 'pending', 'waiting list', 'eingeladen', 'keine antwort', 'offen', 'warteliste'],
  };
  function normalizeAttendance(raw) {
    const v = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!v) return 'invited';
    for (const state of Object.keys(ATTEND_WORDS)) if (ATTEND_WORDS[state].includes(v)) return state;
    if (/^(1|true|x|✓)$/.test(v)) return 'attended';
    if (/^(0|false|-)$/.test(v)) return 'declined';
    return 'unknown';                                  // never guess: an unknown word counts for nothing
  }
  const ATTENDED_STATES = ['attended', 'late'];        // late is training attended, and says so separately
  const attendanceDate = raw => {
    const s = String(raw == null ? '' : raw).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/.exec(s);   // 06.09.2026 and 06/09/2026 are both day-first here
    return m ? `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` : '';
  };

  /* attendanceFrom(rows) → what each person attended, and the sessions themselves.
     A person counts as invited to a session for every row that names them; `rate` is training
     attended out of sessions they were invited to, excused absences included in the denominator
     (a coach asking "who is at training" wants the truth, and the excused count is reported beside it). */
  function attendanceFrom(rows) {
    const people = new Map(), events = new Map();
    (rows || []).forEach(r => {
      const name = String((r && r.name) || '').trim();
      const date = attendanceDate(r && r.date);
      if (!name || !date) return;
      const state = normalizeAttendance(r.state);
      if (state === 'unknown') return;
      const event = String((r && r.event) || '').trim();
      const key = name.toLowerCase();
      if (!people.has(key)) people.set(key, { name, key, events: [], attended: 0, late: 0, excused: 0, invited: 0 });
      const p = people.get(key);
      if (p.events.some(e => e.date === date && e.event === event)) return;   // the same session twice in one file
      p.events.push({ date, event, state });
      p.invited += 1;
      if (state === 'attended' || state === 'late') p.attended += 1;
      if (state === 'late') p.late += 1;
      if (state === 'excused') p.excused += 1;
      const ek = date + '|' + event;
      if (!events.has(ek)) events.set(ek, { date, event, attended: 0, invited: 0 });
      const e = events.get(ek); e.invited += 1; if (state === 'attended' || state === 'late') e.attended += 1;
    });
    const list = [...people.values()].map(p => {
      p.events.sort((a, b) => a.date.localeCompare(b.date));
      return Object.assign(p, { rate: p.invited ? +(p.attended / p.invited).toFixed(3) : null, lastDate: p.events.length ? p.events[p.events.length - 1].date : null });
    }).sort((a, b) => a.name.localeCompare(b.name));
    const all = [...events.values()].sort((a, b) => a.date.localeCompare(b.date));
    return { players: list, events: all, from: all.length ? all[0].date : null, to: all.length ? all[all.length - 1].date : null };
  }
  /* one player's attendance over a window, for the squad table and the charts */
  function attendanceSummary(events, opts) {
    const o = opts || {};
    const since = o.today && o.days ? new Date(Date.parse(o.today + 'T00:00:00Z') - o.days * 86400000).toISOString().slice(0, 10) : null;
    const live = (events || []).filter(e => e && e.date && (!since || e.date >= since));
    const attended = live.filter(e => ATTENDED_STATES.includes(e.state)).length;
    const excused = live.filter(e => e.state === 'excused').length;
    return { attended, invited: live.length, excused, rate: live.length ? +(attended / live.length).toFixed(3) : null,
      lastDate: live.length ? live[live.length - 1].date : null };
  }

  const headerMatches = (h, c) => h === c.label.toLowerCase() || h === c.key.toLowerCase() || (c.syn || []).includes(h);
  function rowsFromCSV(rows, cols) {
    if (!rows.length) return [];
    const header = rows[0].map(h => String(h).trim().toLowerCase());
    const idx = cols.map(c => header.findIndex(h => headerMatches(h, c)));
    return rows.slice(1).map(r => { const o = {}; cols.forEach((c, i) => { if (idx[i] >= 0) o[c.key] = r[idx[i]]; }); return o; }).filter(o => Object.values(o).some(v => v != null && v !== ''));
  }

  /* ---------------- 4) a minimal, honest XLSX reader ----------------
     Reads the sheets a real Excel workbook exports: a ZIP central
     directory (no external library — this file format is documented
     and small enough to parse by hand), DEFLATE via the platform's own
     DecompressionStream, and the handful of OOXML tags a data sheet
     actually uses. It reads; it does not write — exporting stays CSV,
     which every spreadsheet app already opens and saves natively. */
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  function readUint32LE(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000); }
  function readUint16LE(b, o) { return b[o] | (b[o + 1] << 8); }
  /* the ZIP entries, by walking the End Of Central Directory backward from the file's tail */
  function zipEntries(bytes) {
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65557); i--) { if (readUint32LE(bytes, i) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw Object.assign(new Error('not-a-zip'), { code: 'not-a-zip' });
    const count = readUint16LE(bytes, eocd + 10), cdOff = readUint32LE(bytes, eocd + 16);
    const entries = []; let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (readUint32LE(bytes, p) !== 0x02014b50) break;
      const method = readUint16LE(bytes, p + 10), compSize = readUint32LE(bytes, p + 20), nameLen = readUint16LE(bytes, p + 28), extraLen = readUint16LE(bytes, p + 30), commentLen = readUint16LE(bytes, p + 32), lho = readUint32LE(bytes, p + 42);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name, method, compSize, lho });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }
  async function zipRead(bytes, entry) {
    const p = entry.lho, nameLen = readUint16LE(bytes, p + 26), extraLen = readUint16LE(bytes, p + 28);
    const dataStart = p + 30 + nameLen + extraLen, data = bytes.subarray(dataStart, dataStart + entry.compSize);
    if (entry.method === 0) return data;               // stored, no compression
    if (entry.method === 8) return inflateRaw(data);    // deflate
    throw Object.assign(new Error('unsupported-compression'), { code: 'xlsx-unsupported' });
  }
  function xmlUnescape(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&'); }
  function parseSharedStrings(xml) {
    if (!xml) return [];
    const out = [];
    const items = xml.split(/<si[ >]/).slice(1);
    items.forEach(chunk => { const texts = [...chunk.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => xmlUnescape(m[1])); out.push(texts.join('')); });
    return out;
  }
  const colToIndex = (ref) => { const m = /^([A-Z]+)/.exec(ref); if (!m) return 0; let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  function parseSheet(xml, shared) {
    const rows = [];
    const rowChunks = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
    rowChunks.forEach(rc => {
      const cells = [...rc.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)];
      const row = [];
      cells.forEach(m => {
        const attrs = m[1] || m[3] || '', body = m[2] || '';
        const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [])[1]; const ci = ref ? colToIndex(ref) : row.length;
        const type = (/t="([^"]+)"/.exec(attrs) || [])[1];
        let v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
        if (type === 's' && v != null) v = shared[+v];
        else if (type === 'inlineStr') v = xmlUnescape((/<t[^>]*>([\s\S]*?)<\/t>/.exec(body) || [, ''])[1]);
        else if (v != null) v = xmlUnescape(v);
        while (row.length < ci) row.push(null);
        row[ci] = v == null ? null : v;
      });
      rows.push(row);
    });
    return rows;
  }
  /* readXLSX(bytes) → { sheets: { 'Sheet Name': rows[][] } } — never throws on a well-formed workbook;
     throws a tagged error (code) on anything this reader genuinely can't handle. */
  async function readXLSX(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const entries = zipEntries(bytes);
    const byName = {}; entries.forEach(e => byName[e.name] = e);
    if (!byName['xl/workbook.xml']) throw Object.assign(new Error('not-an-xlsx'), { code: 'not-an-xlsx' });
    const dec = new TextDecoder();
    const workbookXml = dec.decode(await zipRead(bytes, byName['xl/workbook.xml']));
    const sheetDefs = [...workbookXml.matchAll(/<sheet [^>]*name="([^"]*)"[^>]*sheetId="(\d+)"[^>]*r:id="(rId\d+)"/g)];
    const relsXml = byName['xl/_rels/workbook.xml.rels'] ? dec.decode(await zipRead(bytes, byName['xl/_rels/workbook.xml.rels'])) : '';
    const relById = {}; [...relsXml.matchAll(/<Relationship [^>]*Id="(rId\d+)"[^>]*Target="([^"]*)"/g)].forEach(m => relById[m[1]] = m[2]);
    let shared = [];
    if (byName['xl/sharedStrings.xml']) shared = parseSharedStrings(dec.decode(await zipRead(bytes, byName['xl/sharedStrings.xml'])));
    const sheets = {};
    for (const m of sheetDefs) {
      const name = xmlUnescape(m[1]), rid = m[3];
      const target = (relById[rid] || '').replace(/^\//, '');
      const path = 'xl/' + target.replace(/^xl\//, '');
      const entry = byName[path] || byName['xl/worksheets/' + (target.split('/').pop() || '')];
      if (!entry) continue;
      sheets[name] = parseSheet(dec.decode(await zipRead(bytes, entry)), shared);
    }
    return { sheets };
  }
  /* map raw sheet rows (as read from THIS club's exact template) into our row objects, tolerant of a
     header row in any position and of extra/missing trailing columns. */
  function rowsFromSheetTable(rows, cols) {
    if (!rows || !rows.length) return [];
    let headerAt = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const line = (rows[i] || []).map(v => String(v || '').trim().toLowerCase());
      if (cols.some(c => line.some(h => headerMatches(h, c)))) { headerAt = i; break; }
    }
    if (headerAt < 0) return [];
    const header = rows[headerAt].map(v => String(v || '').trim().toLowerCase());
    const idx = cols.map(c => header.findIndex(h => headerMatches(h, c)));
    return rows.slice(headerAt + 1).map(r => { const o = {}; cols.forEach((c, i) => { if (idx[i] >= 0 && r) o[c.key] = r[idx[i]]; }); return o; })
      .filter(o => Object.values(o).some(v => v != null && String(v).trim() !== ''));
  }

  return {
    TIERS, FIELD_TESTS, GK_TESTS, testsFor, testById, parseResultValue, fmtSeconds, evaluate,
    TEST_STATUSES, normalizeTestStatus, isOfficialResult, latestResults, squadRow,
    TEST_FOCUS, testSpan, focusGaps,
    squadByTest, playerSeries, squadFocus, squadCoverage, progressRatio, median, RATIO_CAP,
    HOME_ACTIVITIES, mondayOf, weekKeyOf, weekCompliance, streakWeeks, MOODS, mascotState,
    toCSV, parseCSV, TEST_COLS, SWIM_COLS, SPOND_COLS, rowsFromCSV, rowsFromSheetTable,
    normalizeAttendance, attendanceFrom, attendanceSummary, ATTENDED_STATES,
    readXLSX, zipEntries,
  };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = TESTLOG;
