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
  const INSTRUCTIONS = [
    // ---- offense (our possessions)
    { id: 'o-drive-kick', side: 'offense', label: 'Drive & kick',                 when: '6v6', tactics: ['drive-and-kick'] },
    { id: 'o-hole-entry', side: 'offense', label: 'Feed the hole (2 m)',          when: '6v6', tactics: ['hole-entry'] },
    { id: 'o-pick-roll',  side: 'offense', label: 'Pick & roll',                  when: '6v6', tactics: ['pick-and-roll'] },
    { id: 'o-swing',      side: 'offense', label: 'Swing the ball on the perimeter', when: '6v6', tactics: ['perimeter-swing'] },
    { id: 'o-wing-iso',   side: 'offense', label: 'Wing isolation',               when: '6v6', tactics: ['wing-iso'] },
    { id: 'o-counter',    side: 'offense', label: 'Counter-attack fast',          when: 'any', tactics: ['counter-attack'] },
    { id: 'o-manup-42',   side: 'offense', label: 'Man-up: play 4-2',             when: '6v5', tactics: ['man-up-4-2'] },
    { id: 'o-manup-33',   side: 'offense', label: 'Man-up: play 3-3',             when: '6v5', tactics: ['man-up-3-3'] },
    { id: 'o-shoot-high', side: 'offense', label: 'Shoot high (top corners)',     when: 'any', shotZone: 'T' },
    { id: 'o-shoot-low',  side: 'offense', label: 'Shoot low (bottom corners)',   when: 'any', shotZone: 'B' },
    { id: 'o-quick',      side: 'offense', label: 'Quick attacks (≤ 3 passes)',   when: 'any', maxPasses: 3 },
    { id: 'o-patient',    side: 'offense', label: 'Patient attacks (≥ 4 passes)', when: 'any', minPasses: 4 },
    // ---- defense (their possessions)
    { id: 'd-press',      side: 'defense', label: 'Press',                        when: 'any', defence: 'press' },
    { id: 'd-drop',       side: 'defense', label: 'Drop (protect the hole)',      when: 'any', defence: 'drop' },
    { id: 'd-zone',       side: 'defense', label: 'Zone',                         when: 'any', defence: 'zone' },
    { id: 'd-deny-hole',  side: 'defense', label: 'Deny the hole feed',           when: 'any', deny: ['hole-entry'] },
    { id: 'd-stop-drive', side: 'defense', label: 'Stop the drive & kick',        when: 'any', deny: ['drive-and-kick'] },
    { id: 'd-no-counter', side: 'defense', label: 'Concede no counter-attacks',   when: 'any', deny: ['counter-attack'] },
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
    if (!r.attacks) return 'nothing to judge in this situation';
    if (r.followedPct == null) return 'could not be read from the video';
    const a = r.whenFollowed, b = r.whenNot;
    const rate = x => x.n ? Math.round(100 * (r.side === 'offense' ? x.shots : x.n - x.shots) / x.n) : null;
    const rf = rate(a), rn = rate(b);
    const base = r.followedPct >= 70 ? 'largely followed' : r.followedPct >= 40 ? 'followed about half the time' : 'mostly not followed';
    if (rf != null && rn != null && a.n >= 2 && b.n >= 2) {
      const better = r.side === 'offense' ? (rf > rn) : (rf > rn);
      return `${base} — ${better ? 'and it worked better' : 'but it did not work better'} (${rf}% vs ${rn}%)`;
    }
    return base;
  }

  /* plain sentences for the report */
  function summary(rows) {
    return rows.map(r => {
      if (!r.attacks) return `${r.label}: nothing to judge in this situation.`;
      const f = r.whenFollowed, n = r.whenNot;
      const outcome = r.side === 'offense'
        ? `when followed ${f.shots} shot${f.shots === 1 ? '' : 's'} / ${f.goals} goal${f.goals === 1 ? '' : 's'} in ${f.n}; when not ${n.shots} / ${n.goals} in ${n.n}`
        : `when followed they got ${f.shots} shot${f.shots === 1 ? '' : 's'} / ${f.goals} goal${f.goals === 1 ? '' : 's'} in ${f.n}; when not ${n.shots} / ${n.goals} in ${n.n}`;
      const unit = byId(r.id) && byId(r.id).shotZone ? 'shot' : 'attack';
      return `${r.label}: ${r.attacks} ${unit}${r.attacks === 1 ? '' : 's'}, followed ${r.followedPct == null ? '–' : r.followedPct + '%'}${r.unread ? ` (${r.unread} unread)` : ''}; ${outcome}. ${r.verdict}.`;
    });
  }

  return { INSTRUCTIONS, byId, judge, compliance, summary, usSide };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = GAMEPLAN;
