/* ============================================================
   scout.js — what an opposing squad's published figures actually tell a coach.

   WPMATCH fetches and normalises; this file judges; teams.js renders. The same split as
   ELIGIBILITY (judges a line-up) and TEAMSHEET (lays one out), and for the same reason: the
   judging is where the mistakes are, so it is pure and tested on its own.

   THE RULE THIS FILE EXISTS TO KEEP: never invent a number.

   A coach asked for "who is likely to get excluded". The honest answer is a count and its
   denominator — "11 exclusions conceded in 11 matches" — and never a probability, a risk score or
   a red/amber/green badge. There is no exclusion-opportunity denominator anywhere in the data, so
   a likelihood cannot be computed; one presented anyway would be believed, and a coach who
   believes it sends a thirteen-year-old to swim at a named child on the strength of it.

   The other rules follow from the same idea:

     · Every figure is shown with what it is out of. A rate never appears alone.
     · Below five matches played, counts only — no rate, no rank, no place in a section. A player
       with 29 goals in two matches would top any rate in the league, and a child with none in two
       would read as "not a scorer". They are listed, plainly, and said to be too few to read.
     · Comparisons stay inside the squad we downloaded ("10 of this squad's 38 extra-player
       goals"). A league-wide claim would need every squad in the league, which this app refuses
       to crawl.
     · Exclusions are the ones a player CONCEDED. Who DRAWS exclusions — the opponent your
       defenders foul out on, which is what a coach instinctively wants — is not in wpmatch at all,
       and the report says so rather than letting the column be misread.
   ============================================================ */
const SCOUT = (() => {
  /* Five is where the rate stops being dominated by one- and two-match rows while still keeping
     most of a league. Below it a player is listed with counts and no rate at all. */
  const MIN_MATCHES = 5;
  const TOP = 3;

  const per = (n, played) => (played >= MIN_MATCHES && played > 0 ? Math.round((n / played) * 10) / 10 : null);
  const sum = (rows, k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
  /* rank on the rate where there is one, and never let a low-sample row into a ranked section */
  const rank = (rows, k) => rows.filter(r => r.played >= MIN_MATCHES && r[k] > 0)
    .sort((a, b) => (b[k] / b.played) - (a[k] / a.played) || b[k] - a[k])
    .slice(0, TOP);

  const line = (r, k, total) => ({
    wpId: r.wpId, name: r.name, played: r.played, goals: r.goals,
    n: r[k] || 0, perMatch: per(r[k] || 0, r.played),
    share: total > 0 ? (r[k] || 0) + ' / ' + total : null,
  });

  /* The report, section by section. Each section answers one question a coach has to decide before
     Saturday, and carries the real column behind it so the wording can never drift from the data. */
  function report(squad) {
    const rows = (squad && squad.players) || [];
    const matches = (squad && squad.matches) || 0;
    const ready = rows.filter(r => r.played >= MIN_MATCHES);
    const thin = rows.filter(r => r.played < MIN_MATCHES);

    const exclusions = sum(rows, 'exclusionfoul');
    const extras = sum(rows, 'goalextraplayer');
    const penalties = sum(rows, 'penaltygoals');

    const sections = [
      // the hardest mark: who scores when it is six against six, which is most of the game
      { key: 'sixOnSix', column: 'goalon', players: rank(ready, 'goalon').map(r => line(r, 'goalon', sum(rows, 'goalon'))) },
      // what the man-down has to cover when your own player is excluded
      { key: 'extraPlayer', column: 'goalextraplayer', players: rank(ready, 'goalextraplayer').map(r => line(r, 'goalextraplayer', extras)) },
      // who takes the penalty, which is the whole of a goalkeeper's preparation for a 5 m
      { key: 'penalties', column: 'penaltygoals',
        players: ready.filter(r => r.penaltygoals > 0).sort((a, b) => b.penaltygoals - a.penaltygoals).slice(0, TOP).map(r => line(r, 'penaltygoals', penalties)) },
      // and who concedes exclusions — a count of what they have been called for, not a forecast
      { key: 'excluded', column: 'exclusionfoul', players: rank(ready, 'exclusionfoul').map(r => line(r, 'exclusionfoul', exclusions)) },
    ].filter(s => s.players.length);

    /* the full table stops after the players who have actually scored: a ranked tail of players
       with nothing beside their name is a judgement about children, not information */
    const scored = rows.filter(r => r.goals > 0).sort((a, b) => b.goals - a.goals || b.played - a.played);
    const rest = rows.filter(r => !(r.goals > 0)).sort((a, b) => b.played - a.played);

    return {
      matches, sections,
      team: { exclusions, perMatch: per(exclusions, matches), matches },
      thin: thin.map(r => ({ wpId: r.wpId, name: r.name, played: r.played, goals: r.goals, exclusionfoul: r.exclusionfoul })),
      table: scored.concat(rest),
      totals: { goals: sum(rows, 'goals'), goalon: sum(rows, 'goalon'), goalextraplayer: extras, penaltygoals: penalties, exclusionfoul: exclusions },
      // these two columns are usually all zeros; a column of nothing is noise on a phone
      showMisconduct: sum(rows, 'misconductfoul') > 0,
      showBrutality: sum(rows, 'brutalityfoul') > 0,
      empty: !rows.length,
    };
  }

  /* One player's own line, for the card behind a name on a team sheet. The join is the wpmatch
     player id and nothing else: a cap number is not unique within a squad (three players can wear
     '1'), and a name match would print the keeper's record under another child's name on a sheet
     that gets printed and handed to the officials' table. */
  function lineFor(squad, wpId) {
    const r = ((squad && squad.players) || []).find(x => +x.wpId === +wpId);
    if (!r) return null;
    return {
      wpId: r.wpId, name: r.name, played: r.played, goals: r.goals,
      goalon: r.goalon, goalextraplayer: r.goalextraplayer, penaltygoals: r.penaltygoals,
      exclusionfoul: r.exclusionfoul,
      perMatch: per(r.goals, r.played),          // null below the floor: a rate on two matches is noise
      thin: r.played < MIN_MATCHES,
    };
  }

  return { MIN_MATCHES, TOP, report, per, rank, sum, lineFor };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = SCOUT;
