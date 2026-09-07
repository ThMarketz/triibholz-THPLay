/* ============================================================
   tactics.js — Auto-scout: from tracked positions to a playbook,
   with no human in the loop.

   Input: the analysis Result's per-frame board series + events.
   Pipeline (all deterministic, unit-tested):
     segment()   — cut a match into POSSESSIONS (who has the ball,
                   ended by a turnover, a shot/goal, or the ball vanishing)
     distill()   — boil a noisy possession down to ≤6 clean KEYFRAMES
                   (start, every pass, every real drive, the shot) with
                   STABLE player labels (nearest-neighbour matching, since
                   the tracker relabels by height every frame)
     recognize() — score the play against a library of water-polo tactic
                   SIGNATURES (drive & kick, hole entry, pick & roll,
                   perimeter swing, wing iso, counter, man-up 4-2 / 3-3,
                   press / drop defence) → a label + confidence, or
                   'unclassified' (never a guess below threshold)
     profile()   — aggregate a whole video per team: tactic frequency,
                   shot zones, tempo, tendencies with percentages
     summary()   — a scouting report in plain sentences
     buildPlaybook() — the distinct recognised plays as ready-to-save
                   scenarios (frames + notes + description)

   Honest scope: this layer is model-agnostic — its accuracy on real
   footage is bounded by the detector feeding it (colour today, the
   trained model later). It is confidence-gated and never fabricates.
   ============================================================ */
const TACTICS = (() => {
  const CY = 110, GOAL_X = 294, HOLE_X = 265;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const vals = o => Object.keys(o || {}).map(k => o[k]);

  /* ---------- helpers on board frames ---------- */
  const ballOf = f => (f && f.ball && f.ball.x != null) ? { x: f.ball.x, y: f.ball.y } : null;
  function holderAt(f, R) {
    const b = ballOf(f); if (!b) return null;
    let best = null, bd = R || 24;
    ['att', 'def'].forEach(team => Object.keys(f[team] || {}).forEach(k => { const d = dist(f[team][k], b); if (d < bd) { bd = d; best = { team, key: k, p: f[team][k] }; } }));
    if (f.gk) { const d = dist(f.gk, b); if (d < bd) { bd = d; best = { team: 'def', key: 'GK', p: f.gk }; } }
    return best;
  }
  // greedy nearest-neighbour match of positions between two frames → map prevKey→curKey
  function matchSets(prev, cur, gate) {
    const pk = Object.keys(prev || {}), ck = Object.keys(cur || {});
    const pairs = [];
    pk.forEach(a => ck.forEach(b => pairs.push({ a, b, d: dist(prev[a], cur[b]) })));
    pairs.sort((x, y) => x.d - y.d);
    const usedA = new Set(), usedB = new Set(), map = {};
    pairs.forEach(p => { if (usedA.has(p.a) || usedB.has(p.b) || p.d > (gate || 60)) return; usedA.add(p.a); usedB.add(p.b); map[p.a] = p.b; });
    return map;
  }

  /* ---------- 1) possessions ---------- */
  function segment(series, events, opts) {
    opts = opts || {};
    const R = opts.possR || 24, minFrames = opts.minFrames || 3, maxGap = opts.maxGap || 4;
    const shotT = new Set((events || []).filter(e => e.type === 'shot' || e.type === 'goal').map(e => +e.t.toFixed(2)));
    const goalT = new Set((events || []).filter(e => e.type === 'goal').map(e => +e.t.toFixed(2)));
    const out = []; let cur = null, gap = 0;
    const close = (i) => { if (cur && cur.frames.length >= minFrames) { cur.tEnd = series[i - 1].t; out.push(cur); } cur = null; gap = 0; };
    for (let i = 0; i < series.length; i++) {
      const f = series[i].boardFrame, h = holderAt(f, R), t = series[i].t;
      if (shotT.has(+t.toFixed(2))) { if (cur) { cur.frames.push(series[i]); cur.events.push({ t, type: goalT.has(+t.toFixed(2)) ? 'goal' : 'shot' }); close(i + 1); } continue; }
      if (h && h.key === 'GK' && cur && cur.team !== h.team) { cur.frames.push(series[i]); cur.events.push({ t, type: 'shot' }); close(i + 1); continue; }
      const team = h ? h.team : null;
      if (!team) { if (cur && ++gap > maxGap) close(i); else if (cur) cur.frames.push(series[i]); continue; }
      gap = 0;
      if (cur && team !== cur.team) close(i);
      if (!cur) cur = { team, tStart: t, frames: [], events: [] };
      cur.frames.push(series[i]);
    }
    if (cur && cur.frames.length >= minFrames) { cur.tEnd = series[series.length - 1].t; out.push(cur); }
    out.forEach(p => { p.goal = p.events.some(e => e.type === 'goal'); p.endsInShot = p.events.some(e => e.type === 'shot' || e.type === 'goal') || !!(ballOf(p.frames[p.frames.length - 1].boardFrame) && ballOf(p.frames[p.frames.length - 1].boardFrame).x >= GOAL_X - 6); p.duration = +((p.tEnd - p.tStart) || 0).toFixed(2); });
    return out;
  }

  /* ---------- 2) distill a possession into a clean play ---------- */
  function distill(poss, opts) {
    opts = opts || {}; const maxK = opts.maxKeyframes || 6, driveMin = opts.driveMin || 18;
    const fr = poss.frames.map(s => s.boardFrame); if (!fr.length) return null;
    const offense = poss.team;                       // 'att' (white) or 'def' (dark) is attacking
    const O = offense === 'att' ? 'att' : 'def', D = offense === 'att' ? 'def' : 'att';
    // keyframe selection: start, holder changes, real drives, end
    const picks = [0]; let lastK = 0, lastHolder = holderAt(fr[0]) ? holderAt(fr[0]).key : null;
    for (let i = 1; i < fr.length; i++) {
      const h = holderAt(fr[i]); const hk = h && h.team === O ? h.key : null;
      let pick = false, why = '';
      if (hk && lastHolder && hk !== lastHolder) { pick = true; why = 'pass'; }
      else { const m = matchSets(fr[lastK][O], fr[i][O]); if (Object.keys(m).some(a => dist(fr[lastK][O][a], fr[i][O][m[a]]) > driveMin)) { pick = true; why = 'drive'; } }
      if (pick) { picks.push(i); lastK = i; if (hk) lastHolder = hk; }
    }
    if (picks[picks.length - 1] !== fr.length - 1) picks.push(fr.length - 1);
    // cap: keep first, last, and the most-spaced middles
    let idx = picks; while (idx.length > maxK) { let worst = 1, best = Infinity; for (let j = 1; j < idx.length - 1; j++) { const gapv = idx[j + 1] - idx[j - 1]; if (gapv < best) { best = gapv; worst = j; } } idx = idx.filter((_, j) => j !== worst); }
    // stable labels via NN matching from the first keyframe
    const first = fr[idx[0]]; const labels = {};
    Object.keys(first[O]).sort((a, b) => first[O][a].y - first[O][b].y).forEach((k, i) => labels[k] = String(i + 1));
    const frames = []; let prevKey = idx[0], keyMap = Object.assign({}, labels);
    let passes = 0, prevHolderLabel = null; const notes = {}; const steps = [];
    idx.forEach((fi, n) => {
      const f = fr[fi];
      const m = n === 0 ? Object.fromEntries(Object.keys(f[O]).map(k => [k, k])) : matchSets(fr[prevKey][O], f[O]);
      const newMap = {}; Object.keys(m).forEach(a => { if (keyMap[a]) newMap[m[a]] = keyMap[a]; });
      // unmatched new players get the next free label
      const used = new Set(Object.values(newMap)); Object.keys(f[O]).forEach(k => { if (!newMap[k]) { let l = 1; while (used.has(String(l))) l++; newMap[k] = String(l); used.add(String(l)); } });
      keyMap = newMap; prevKey = fi;
      const att = {}; Object.keys(f[O]).forEach(k => att[keyMap[k]] = { x: f[O][k].x, y: f[O][k].y });
      if (n > 0) Object.keys(att).forEach(l => { const a = frames[n - 1].att[l], b = att[l]; if (a && b && dist(a, b) > driveMin) { const dirn = b.x - a.x > 10 ? 'drives in' : Math.abs(b.y - a.y) > 10 ? 'relocates' : 'moves'; steps.push(`${l} ${dirn}`); notes[l] = (notes[l] || '') + `${dirn.charAt(0).toUpperCase() + dirn.slice(1)}. `; } });
      const def = {}; Object.keys(f[D]).forEach((k, i) => def[i + 1] = { x: f[D][k].x, y: f[D][k].y });
      const h = holderAt(f); const hl = h && h.team === O ? keyMap[h.key] : null;
      let ball; const lastKF = n === idx.length - 1;
      if (lastKF && poss.endsInShot) { const b = ballOf(f) || { x: 290, y: CY }; ball = { carrier: null, x: 293, y: Math.max(94, Math.min(126, b.y)) }; steps.push(`${prevHolderLabel || hl || '?'} shoots`); if (prevHolderLabel || hl) notes[prevHolderLabel || hl] = (notes[prevHolderLabel || hl] || '') + 'Finish the shot. '; }
      else if (hl) { ball = { carrier: 'A' + hl }; if (prevHolderLabel && hl !== prevHolderLabel) { passes++; steps.push(`${prevHolderLabel} passes to ${hl}`); notes[prevHolderLabel] = (notes[prevHolderLabel] || '') + `Pass to ${hl}. `; notes[hl] = (notes[hl] || '') + 'Receive. '; } else if (n === 0) steps.push(`${hl} has the ball`); }
      else { const b = ballOf(f) || { x: 250, y: CY }; ball = { carrier: null, x: b.x, y: b.y }; }
      if (hl) prevHolderLabel = hl;
      frames.push({ att, def, gk: f.gk ? { x: f.gk.x, y: f.gk.y } : { x: 292, y: CY }, ball, extra: [] });
    });
    const nAtt = Object.keys(frames[0].att).length, nDef = Object.keys(frames[0].def).length;
    const situation = nAtt >= 6 && nDef >= 6 ? '6v6' : nAtt >= 6 && nDef === 5 ? '6v5' : nAtt === 5 && nDef === 4 ? '5v4' : nAtt === 4 && nDef === 3 ? '4v3' : nAtt === 3 && nDef === 2 ? '3v2' : nAtt === 2 && nDef === 1 ? '2v1' : nAtt >= 6 ? '6v6' : nAtt === 1 ? 'GK' : '6v6';
    return { situation, phase: 'offense', offense, frames, notes, steps, passes, endsInShot: !!poss.endsInShot, goal: !!poss.goal, duration: poss.duration, tStart: poss.tStart, tEnd: poss.tEnd, attackers: nAtt, defenders: nDef };
  }

  /* ---------- 3) tactic signatures ---------- */
  function features(play) {
    const fr = play.frames, first = fr[0], last = fr[fr.length - 1];
    const balls = fr.map(f => f.ball && f.ball.carrier ? (f.att[f.ball.carrier.slice(1)] || null) : (f.ball && f.ball.x != null ? { x: f.ball.x, y: f.ball.y } : null)).filter(Boolean);
    const startX = balls.length ? balls[0].x : 200;
    const holders = fr.map(f => f.ball && f.ball.carrier ? f.ball.carrier.slice(1) : null);
    const receivers = []; for (let i = 1; i < holders.length; i++) if (holders[i] && holders[i - 1] && holders[i] !== holders[i - 1]) receivers.push({ l: holders[i], p: fr[i].att[holders[i]] });
    const deepest = f => { let k = null, mx = -1; Object.keys(f.att).forEach(l => { if (f.att[l].x > mx) { mx = f.att[l].x; k = l; } }); return k; };
    const holeFeed = receivers.some(r => r.p && r.p.x > HOLE_X && Math.abs(r.p.y - CY) < 26);
    const drives = []; for (let n = 1; n < fr.length; n++) Object.keys(fr[n].att).forEach(l => { const a = fr[n - 1].att[l], b = fr[n].att[l]; if (a && b && b.x - a.x > 18) drives.push({ l, from: a, to: b, n }); });
    const driveThenKick = drives.some(d => receivers.some(r => r.l !== d.l) && holders.slice(d.n).some(h => h && h !== d.l));
    const screen = fr.some(f => { const ks = Object.keys(f.att); for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) if (dist(f.att[ks[i]], f.att[ks[j]]) < 12) return true; return false; });
    const rollAfterScreen = screen && drives.length > 0 && play.passes >= 1;
    const wingHold = (() => { let c = 0; holders.forEach((h, i) => { if (h && fr[i].att[h] && Math.abs(fr[i].att[h].y - CY) > 40) c++; }); return c >= 2 && play.passes <= 1; })();
    const ys = receivers.map(r => r.p ? r.p.y : CY); const swing = play.passes >= 3 && ys.length >= 2 && (Math.max(...ys) - Math.min(...ys)) > 70;
    const counter = startX < 150 && play.duration <= 8 && play.passes <= 2 && (last.ball && (last.ball.x != null ? last.ball.x : 0) > 230 || play.endsInShot);
    const manUp = play.attackers > play.defenders && play.attackers >= 5;
    // formation of the attack at the start (6 attackers)
    let formation = 'set';
    const ax = vals(first.att); if (ax.length >= 6) { const top = ax.filter(p => p.y < CY - 12).length, bot = ax.filter(p => p.y > CY + 12).length, deep = ax.filter(p => p.x > HOLE_X).length; if (deep >= 2 && ax.length - deep >= 4) formation = '4-2'; else if (top >= 3 && bot >= 3) formation = '3-3'; else if (deep === 1) formation = 'set'; else formation = 'umbrella'; }
    // defence shape (from the defending side)
    const dv = vals(first.def), av = vals(first.att); let defence = null;
    if (dv.length >= 4 && av.length >= 4) { const near = dv.map(d => Math.min(...av.map(a => dist(a, d)))); const avg = near.reduce((s, v) => s + v, 0) / near.length; const deepD = dv.filter(d => d.x > HOLE_X - 8).length; defence = avg < 22 ? 'press' : (deepD >= dv.length - 1 ? 'drop' : 'zone'); }
    const shotY = play.endsInShot && last.ball ? last.ball.y : null;
    return { startX, passes: play.passes, drives: drives.length, holeFeed, driveThenKick, screen, rollAfterScreen, wingHold, swing, counter, manUp, formation, defence, endsInShot: play.endsInShot, shotZone: shotY == null ? null : (shotY < 101 ? 'T' : shotY > 119 ? 'B' : 'M'), duration: play.duration };
  }
  const SIGNATURES = [
    { id: 'counter-attack',  name: 'Counter-attack',        score: f => f.counter ? 0.9 : 0 },
    { id: 'man-up-4-2',      name: 'Man-up 4-2',            score: f => f.manUp && f.formation === '4-2' ? 0.85 : 0 },
    { id: 'man-up-3-3',      name: 'Man-up 3-3',            score: f => f.manUp && f.formation === '3-3' ? 0.85 : 0 },
    { id: 'pick-and-roll',   name: 'Pick & roll',           score: f => f.rollAfterScreen ? 0.8 : (f.screen ? 0.45 : 0) },
    { id: 'drive-and-kick',  name: 'Drive & kick',          score: f => f.driveThenKick ? 0.8 : 0 },
    { id: 'hole-entry',      name: 'Hole entry (feed 2 m)', score: f => f.holeFeed ? (f.endsInShot ? 0.85 : 0.7) : 0 },
    { id: 'perimeter-swing', name: 'Perimeter swing',       score: f => f.swing ? 0.75 : 0 },
    { id: 'wing-iso',        name: 'Wing isolation',        score: f => f.wingHold ? 0.7 : 0 },
    { id: 'set-offense',     name: 'Set offence',           score: f => (!f.manUp && f.formation === 'set' && f.passes >= 1) ? 0.55 : 0 },
  ];
  function recognize(play, opts) {
    const thr = (opts && opts.threshold) || 0.5;
    const f = features(play);
    const ranked = SIGNATURES.map(s => ({ id: s.id, name: s.name, score: +s.score(f).toFixed(2) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
    const top = ranked[0] && ranked[0].score >= thr ? ranked[0] : { id: 'unclassified', name: 'Unclassified', score: ranked[0] ? ranked[0].score : 0 };
    return { tactic: top.id, name: top.name, confidence: top.score, candidates: ranked.slice(0, 3), features: f };
  }

  /* ---------- 4) team profile + 5) summary ---------- */
  function profile(plays) {
    const P = {};
    (plays || []).forEach(p => {
      const t = P[p.offense] || (P[p.offense] = { possessions: 0, shots: 0, goalsZone: { T: 0, M: 0, B: 0 }, passes: 0, duration: 0, tactics: {}, formations: {}, defences: {}, manUp: 0 });
      t.possessions++; if (p.endsInShot) { t.shots++; if (p.rec.features.shotZone) t.goalsZone[p.rec.features.shotZone]++; }
      t.passes += p.passes; t.duration += p.duration || 0;
      t.tactics[p.rec.tactic] = (t.tactics[p.rec.tactic] || 0) + 1;
      t.formations[p.rec.features.formation] = (t.formations[p.rec.features.formation] || 0) + 1;
      if (p.rec.features.defence) t.defences[p.rec.features.defence] = (t.defences[p.rec.features.defence] || 0) + 1;
      if (p.rec.features.manUp) t.manUp++;
    });
    Object.keys(P).forEach(k => { const t = P[k]; t.shotRate = t.possessions ? +(t.shots / t.possessions).toFixed(2) : 0; t.avgPasses = t.possessions ? +(t.passes / t.possessions).toFixed(1) : 0; t.avgDuration = t.possessions ? +(t.duration / t.possessions).toFixed(1) : 0;
      const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0]; t.topTactic = top(t.tactics) ? { id: top(t.tactics)[0], n: top(t.tactics)[1], pct: Math.round(100 * top(t.tactics)[1] / t.possessions) } : null; t.topFormation = top(t.formations) ? top(t.formations)[0] : null; t.topDefence = top(t.defences) ? top(t.defences)[0] : null;
      t.tendencies = Object.entries(t.tactics).filter(([id]) => id !== 'unclassified').sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ tactic: id, name: (SIGNATURES.find(s => s.id === id) || {}).name || id, n, pct: Math.round(100 * n / t.possessions) })); });
    return P;
  }
  function summary(prof, opts) {
    const who = (opts && opts.names) || { att: 'White caps', def: 'Dark caps' };
    const Z = { T: 'top corner', M: 'centre', B: 'bottom corner' };
    const lines = [];
    Object.keys(prof).forEach(k => {
      const t = prof[k]; const name = who[k] || k;
      lines.push(`${name}: ${t.possessions} possessions, ${t.shots} shots (${Math.round(t.shotRate * 100)}%), avg ${t.avgPasses} passes and ${t.avgDuration}s per possession.`);
      if (t.topTactic && t.topTactic.id !== 'unclassified') lines.push(`${name} favour ${((SIGNATURES.find(s => s.id === t.topTactic.id) || {}).name || t.topTactic.id).toLowerCase()} — ${t.topTactic.pct}% of possessions${t.tendencies[1] ? `, then ${t.tendencies[1].name.toLowerCase()} (${t.tendencies[1].pct}%)` : ''}.`);
      if (t.topFormation && t.topFormation !== 'set') lines.push(`${name} set up mostly in a ${t.topFormation}.`);
      if (t.manUp) lines.push(`${name} had ${t.manUp} man-up possession${t.manUp > 1 ? 's' : ''}.`);
      const z = Object.entries(t.goalsZone).sort((a, b) => b[1] - a[1])[0]; if (z && z[1]) lines.push(`${name} shoot mostly to the ${Z[z[0]]}.`);
      if (t.topDefence) lines.push(`Against them, the defence was mostly a ${t.topDefence}.`);
    });
    return lines;
  }

  /* ---------- 6) playbook from recognised plays ---------- */
  function buildPlaybook(plays, opts) {
    opts = opts || {}; const max = opts.max || 8, minConf = opts.minConf || 0.5;
    const groups = {};
    (plays || []).forEach(p => { if (p.rec.confidence < minConf) return; const key = p.rec.tactic + '|' + p.situation + '|' + (p.rec.features.shotZone || '-'); (groups[key] || (groups[key] = [])).push(p); });
    return Object.values(groups).sort((a, b) => b.length - a.length).slice(0, max).map(g => {
      const p = g.reduce((best, x) => x.rec.confidence > best.rec.confidence ? x : best, g[0]);
      const desc = p.steps.join(' → ');
      return { title: `${p.rec.name} · seen ${g.length}× (auto-scout)`, description: desc || p.rec.name, situation: p.situation, phase: 'offense', frames: p.frames, notes: p.notes, tactic: p.rec.tactic, confidence: p.rec.confidence, seen: g.length, source: 'auto-scout', needsReview: p.rec.confidence < 0.8 };
    });
  }

  /* one-shot: series + events → everything */
  function scout(series, events, opts) {
    const poss = segment(series, events, opts);
    const plays = poss.map(p => { const d = distill(p, opts); if (!d) return null; d.rec = recognize(d, opts); return d; }).filter(Boolean);
    const prof = profile(plays);
    return { possessions: poss.length, plays: plays.map(p => ({ tStart: p.tStart, tEnd: p.tEnd, offense: p.offense, situation: p.situation, tactic: p.rec.tactic, name: p.rec.name, confidence: p.rec.confidence, passes: p.passes, endsInShot: p.endsInShot, goal: !!p.goal, shotZone: p.rec.features.shotZone || null, defence: p.rec.features.defence || null, manUp: !!p.rec.features.manUp, steps: p.steps, frames: p.frames, notes: p.notes })), profile: prof, summary: summary(prof, opts), playbook: buildPlaybook(plays, opts) };
  }

  return { segment, distill, features, recognize, profile, summary, buildPlaybook, scout, SIGNATURES, holderAt, matchSets };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = TACTICS;
