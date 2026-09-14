/* ============================================================
   gameplan.js — "What did we ask for, and did it happen?"

   A coach declares a GAME PLAN for a match (a handful of instructions
   from the tactic library). After auto-scout has read the video, this
   module compares plan vs reality per instruction:
     attacks in that situation · how many followed the plan · success
     (shots / goals) when followed vs. when not · how many attacks the
     detector could not read (reported, never hidden).
   Pure + unit-tested; no DOM.
   ============================================================ */
const GAMEPLAN = (() => {
  /* INSTRUCTIONS below hold KEY NAMES in `label` — the array is built once at load, so real
     text in it would freeze the boot language. verdict() and summary() return finished,
     already-translated sentences, so their callers need no change. */
  const GT = (k, vars) => (typeof I18N !== 'undefined') ? I18N.t(k, vars) : k;
  const INSTRUCTIONS = [
    // ---- offense (our possessions)
    { id: 'o-drive-kick', side: 'offense', label: 'gp.oDriveKick',                 when: '6v6', tactics: ['drive-and-kick'] },
    { id: 'o-hole-entry', side: 'offense', label: 'gp.oHoleEntry',          when: '6v6', tactics: ['hole-entry'] },
    { id: 'o-pick-roll',  side: 'offense', label: 'gp.oPickRoll',                  when: '6v6', tactics: ['pick-and-roll'] },
    { id: 'o-swing',      side: 'offense', label: 'gp.oSwing', when: '6v6', tactics: ['perimeter-swing'] },
    { id: 'o-wing-iso',   side: 'offense', label: 'gp.oWingIso',               when: '6v6', tactics: ['wing-iso'] },
    { id: 'o-counter',    side: 'offense', label: 'gp.oCounter',          when: 'any', tactics: ['counter-attack'] },
    { id: 'o-manup-42',   side: 'offense', label: 'gp.oManup42',             when: '6v5', tactics: ['man-up-4-2'] },
    { id: 'o-manup-33',   side: 'offense', label: 'gp.oManup33',             when: '6v5', tactics: ['man-up-3-3'] },
    { id: 'o-shoot-high', side: 'offense', label: 'gp.oShootHigh',     when: 'any', shotZone: 'T' },
    { id: 'o-shoot-low',  side: 'offense', label: 'gp.oShootLow',   when: 'any', shotZone: 'B' },
    { id: 'o-quick',      side: 'offense', label: 'gp.oQuick',   when: 'any', maxPasses: 3 },
    { id: 'o-patient',    side: 'offense', label: 'gp.oPatient', when: 'any', minPasses: 4 },
    // ---- defense (their possessions)
    { id: 'd-press',      side: 'defense', label: 'gp.dPress',                        when: 'any', defence: 'press' },
    { id: 'd-drop',       side: 'defense', label: 'gp.dDrop',      when: 'any', defence: 'drop' },
    { id: 'd-zone',       side: 'defense', label: 'gp.dZone',                         when: 'any', defence: 'zone' },
    { id: 'd-deny-hole',  side: 'defense', label: 'gp.dDenyHole',           when: 'any', deny: ['hole-entry'] },
    { id: 'd-stop-drive', side: 'defense', label: 'gp.dStopDrive',        when: 'any', deny: ['drive-and-kick'] },
    { id: 'd-no-counter', side: 'defense', label: 'gp.dNoCounter',   when: 'any', deny: ['counter-attack'] },
  ];
  const byId = id => INSTRUCTIONS.find(i => i.id === id);

  // which board side is "us": white caps are 'att' in the tracked frames, dark caps 'def'
  const usSide = us => (us === 'dark' ? 'def' : 'att');
  const inSituation = (ins, play) => ins.when === 'any' || play.situation === ins.when || (ins.when === '6v5' && play.manUp);

  /* judge ONE play against ONE instruction → { applies, read, followed, shot, goal } */
  function judge(ins, play, us) {
    const ours = play.offense === usSide(us);
    const applies = (ins.side === 'offense' ? ours : !ours) && inSituation(ins, play);
    if (!applies || (ins.shotZone && !play.endsInShot)) return { applies: false };   // shot-placement instructions judge shots only
    const classified = play.tactic && play.tactic !== 'unclassified';
    let read = true, followed = false;
    if (ins.tactics) { read = classified; followed = classified && ins.tactics.includes(play.tactic); }
    else if (ins.shotZone) { read = !!play.shotZone; followed = play.shotZone === ins.shotZone; }
    else if (ins.maxPasses != null) { followed = play.passes <= ins.maxPasses; }
    else if (ins.minPasses != null) { followed = play.passes >= ins.minPasses; }
    else if (ins.defence) { read = !!play.defence; followed = play.defence === ins.defence; }
    else if (ins.deny) { read = classified; followed = classified && !ins.deny.includes(play.tactic); }
    return { applies: true, read, followed, shot: !!play.endsInShot, goal: !!play.goal };
  }

  /* plan (instruction ids) × scouted plays → one row per instruction */
  function compliance(planIds, plays, opts) {
    const us = (opts && opts.us) || 'white';
    return (planIds || []).map(byId).filter(Boolean).map(ins => {
      const row = { id: ins.id, label: ins.label, side: ins.side, attacks: 0, unread: 0, followed: 0, whenFollowed: { n: 0, shots: 0, goals: 0 }, whenNot: { n: 0, shots: 0, goals: 0 } };
      (plays || []).forEach(p => {
        const j = judge(ins, p, us); if (!j.applies) return;
        row.attacks++;
        if (!j.read) { row.unread++; return; }
        const b = j.followed ? row.whenFollowed : row.whenNot;
        if (j.followed) row.followed++;
        b.n++; if (j.shot) b.shots++; if (j.goal) b.goals++;
      });
      const readN = row.attacks - row.unread;
      row.followedPct = readN ? Math.round(100 * row.followed / readN) : null;
      row.verdict = verdict(row);
      return row;
    });
  }
  function verdict(r) {
    if (!r.attacks) return GT('gp.vNothingToJudge');
    if (r.followedPct == null) return GT('gp.vUnreadable');
    const a = r.whenFollowed, b = r.whenNot;
    const rate = x => x.n ? Math.round(100 * (r.side === 'offense' ? x.shots : x.n - x.shots) / x.n) : null;
    const rf = rate(a), rn = rate(b);
    const base = r.followedPct >= 70 ? GT('gp.vLargelyFollowed') : r.followedPct >= 40 ? GT('gp.vHalfFollowed') : GT('gp.vMostlyNot');
    if (rf != null && rn != null && a.n >= 2 && b.n >= 2) {
      return GT(rf > rn ? 'gp.vWorkedBetter' : 'gp.vNotBetter', { base, rf, rn });
    }
    return base;
  }

  /* plain sentences for the report */
  function summary(rows) {
    /* Singular and plural are separate keys rather than an English "s" appended to a
       placeholder: no other language pluralises that way. */
    const word = (n, one, many) => GT(n === 1 ? one : many);
    return rows.map(r => {
      const label = GT(r.label);
      if (!r.attacks) return GT('gp.sumNothingToJudge', { label });
      const f = r.whenFollowed, n = r.whenNot;
      const outcome = GT(r.side === 'offense' ? 'gp.sumOutcomeUs' : 'gp.sumOutcomeThem', {
        fs: f.shots, fg: f.goals, fn: f.n, ns: n.shots, ng: n.goals, nn: n.n,
        shotWord: word(f.shots, 'gp.wShot', 'gp.wShots'), goalWord: word(f.goals, 'gp.wGoal', 'gp.wGoals'),
      });
      const unit = byId(r.id) && byId(r.id).shotZone
        ? word(r.attacks, 'gp.wShot', 'gp.wShots') : word(r.attacks, 'gp.wAttack', 'gp.wAttacks');
      return GT('gp.sumLine', {
        label, n: r.attacks, unit, outcome, verdict: r.verdict,
        pct: r.followedPct == null ? '–' : r.followedPct + '%',
        unread: r.unread ? GT('gp.sumUnread', { n: r.unread }) : '',
      });
    });
  }

  return { INSTRUCTIONS, byId, judge, compliance, summary, usSide };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = GAMEPLAN;
