/* ============================================================
   eligibility.js — can this line-up go on the official team sheet?

   Pure and language-neutral: it returns FINDINGS (a code, a severity,
   the players concerned, the article it rests on) and app.js turns them
   into words. Every rule below cites where it comes from, because a
   coach who is told "no" on match day will ask why.

   The one design rule, taken straight from reading the regulations:
   WARN, DON'T BLOCK. The texts contradict themselves in places (the
   Swiss Sport Nationality age cut-off is worded three different ways;
   the U12 2026 annex looks copy-pasted), licences get issued late, and
   an app that stops a legal player from playing is worse than one that
   raises a doubt. So only the things the FORM ITSELF makes unambiguous
   are errors — more than 14 players, no goalkeeper, a missing or
   duplicated licence number. Everything read out of a regulation is a
   warning the coach can acknowledge.

   Sources (swiss-aquatics.ch, read in full):
   · Reglement 5.1.1 Wettkampfbestimmungen Water Polo, 01.09.2025 and
     01.09.2026 editions (Art. 4.1, 6.1, 6.4, 6.5, 6.6, Anhänge)
   · Reglement 5.1 WR-WB, Art. 4 and 17; World Aquatics rule 2.1
   · NW-Meisterschaften Regl.-Abweichungen 25/26 (youth handout)

   Player eligibility status comes from wpmatch.ch (metrics.Eligibility),
   which has exactly five values across all 2572 player records.
   ============================================================ */
const ELIGIBILITY = (() => {

  /* ---- the five wpmatch statuses, and whether each counts as Swiss for foreigner limits */
  const STATUS = {
    'Swiss': 'swiss',
    'Swiss Sport Nationality': 'ssn',       // foreign national treated as Swiss for sport
    'Swiss Sport Experience': 'sse',        // older status; from 2026/27 limited and phasing out
    'Ausländer/Étranger': 'foreign',
    'Inactive License': 'inactive',         // no licence valid now: lapsed, or superseded by a new number
  };
  const statusOf = raw => STATUS[String(raw || '').trim()] || (raw ? 'other' : 'unknown');

  /* ---- season: runs 1 September → 31 August. Age rules count the year the season ENDS. */
  function seasonOf(dateISO) {
    const d = new Date(dateISO);
    const y = isNaN(d) ? new Date().getFullYear() : d.getFullYear();
    const m = isNaN(d) ? new Date().getMonth() : d.getMonth();          // 0-based; September = 8
    const start = m >= 8 ? y : y - 1;
    return { start, end: start + 1, label: `${start}/${String(start + 1).slice(2)}`, edition: start >= 2026 ? 2026 : 2025 };
  }

  /* ---- categories.
     age window = [minAge, maxAge] where age = seasonEndYear − birthYear.
     younger    = how many players BELOW minAge may be added (reported to the league)
     girlsOver  = girls may be this many years ABOVE maxAge
     foreigners = null (no limit) | { max, sse, onlySwiss }                                   */
  const CATEGORIES = {
    U10:  { kind: 'youth', gender: 'mixed', minAge: null, maxAge: 10, younger: 0, girlsOver: 1, foreigners: null, art: 'Art. 6.6 h, Anhang 15/15A' },
    U12:  { kind: 'youth', gender: 'mixed', minAge: 10, maxAge: 12, younger: 3, girlsOver: 1, foreigners: null, art: 'Art. 6.6 g, Anhang 14' },
    U14:  { kind: 'youth', gender: 'mixed', minAge: 12, maxAge: 14, younger: 3, girlsOver: 1, girlsMaxShare2026: 0.5, foreigners: null, art: 'Art. 6.6 f, Anhang 13/13A' },
    U14D: { kind: 'youth', gender: 'women', minAge: 12, maxAge: 14, younger: 3, girlsOver: 0, foreigners: null, art: 'Anhang 13B', ageUnstated: true },
    U16:  { kind: 'youth', gender: 'mixed', minAge: 14, maxAge: 16, younger: 3, girlsOver: 1, foreigners: null, art: 'Art. 6.6 e, Anhang 12B' },
    U16D: { kind: 'youth', gender: 'women', minAge: null, maxAge: 16, younger: 0, girlsOver: 0, foreigners: null, art: 'Art. 6.6 d, Anhang 12A' },
    U18:  { kind: 'youth', gender: 'mixed', minAge: 16, maxAge: 18, younger: 3, girlsOver: 0, foreigners: null, art: 'Art. 6.6 c, Anhang 11' },
    U18D: { kind: 'youth', gender: 'women', minAge: null, maxAge: 18, younger: 0, girlsOver: 0, foreigners: null, art: 'Art. 6.6 b' },
    NLA:  { kind: 'senior', gender: 'men',   foreigners: { max: 2, sse: 1 }, art: 'Anhang 1' },
    NLB:  { kind: 'senior', gender: 'men',   foreigners: { max: 2, sse: 1 }, art: 'Anhang 3' },
    RL:   { kind: 'senior', gender: 'mixed', foreigners: null, art: 'Anhang 4; WR-WB Art. 17' },
    NLD:  { kind: 'senior', gender: 'women', foreigners: { max: 1, sse: 0 }, art: 'Anhang 7' },
    PLD:  { kind: 'senior', gender: 'women', foreigners: null, art: 'Anhang 8' },
    ST:   { kind: 'senior', gender: 'men',   foreigners: { onlySwiss: true }, art: 'Anhang 2' },
    CUP:  { kind: 'senior', gender: 'men',   foreigners: { max: 2, sse: 1 }, art: 'Anhang 16' },
    CUPD: { kind: 'senior', gender: 'women', foreigners: { max: 1, sse: 0 }, art: 'Anhang 16' },
    CUSTOM: { kind: 'custom', gender: 'mixed', foreigners: null, art: '' },
  };
  const MAX_ON_SHEET = 14;     // WR-WB Art. 4; the official form has 14 rows
  const MAX_GK = 2;            // World Aquatics 2.1

  const isGirl = p => /^f/i.test(String(p.gender || ''));
  const isBoy = p => /^m/i.test(String(p.gender || ''));

  /* A team's effective rules: its category preset, then anything the coach set on the team
     ("specials" — e.g. a friendly tournament that only allows Swiss players). */
  function rulesFor(team, season) {
    const base = CATEGORIES[team && team.category] || CATEGORIES.CUSTOM;
    const r = Object.assign({}, base, (team && team.rules) || {});
    // 2025/26 → 2026/27 changes that matter to a line-up
    if (base === CATEGORIES.ST && season.edition === 2025) r.foreigners = { onlySwiss: true, allowSse: true };
    if (base === CATEGORIES.NLA || base === CATEGORIES.NLB || base === CATEGORIES.CUP) {
      if (season.edition === 2025 && !(team.rules && team.rules.foreigners)) r.foreigners = { max: 2, sse: Infinity, sseCountsAsSwiss: true };
    }
    return r;
  }

  /* check(team, lineup, { date })
     lineup: [{ licence, name, firstName, birthYear, gender, status (wpmatch Eligibility text),
               gk: bool, captain: bool, younger: bool (reported to the league) }]
     Row order IS cap order (Anhang 35: passes shown in cap-number order), so index 0 = cap 1. */
  function check(team, lineup, opts) {
    const season = seasonOf(opts && opts.date);
    const rules = rulesFor(team || {}, season);
    const out = [];
    const add = (severity, code, players, vars, article) =>
      out.push({ severity, code, players: (players || []).map(p => p.licence || p.name || ''), vars: vars || {}, article: article || '' });
    const L = (lineup || []).filter(Boolean);

    // ---------- the form itself: unambiguous, so these are errors
    if (L.length > (rules.maxOnSheet || MAX_ON_SHEET))
      add('error', 'too-many-players', [], { n: L.length, max: rules.maxOnSheet || MAX_ON_SHEET }, 'WR-WB Art. 4');
    const gks = L.filter(p => p.gk);
    if (L.length && !gks.length) add('error', 'no-goalkeeper', [], {}, 'World Aquatics 2.1');
    if (gks.length > MAX_GK) add('error', 'too-many-goalkeepers', gks, { n: gks.length, max: MAX_GK }, 'World Aquatics 2.1');
    const noLicence = L.filter(p => !String(p.licence || '').trim());
    if (noLicence.length) add('error', 'missing-licence', noLicence, { n: noLicence.length }, 'Art. 6.4');
    const seen = new Map();
    L.forEach(p => { const k = String(p.licence || '').trim(); if (k) seen.set(k, (seen.get(k) || []).concat(p)); });
    seen.forEach(ps => { if (ps.length > 1) add('error', 'duplicate-licence', ps, { licence: ps[0].licence }, 'Art. 6.1'); });
    const captains = L.filter(p => p.captain);
    if (L.length && captains.length !== 1) add('warn', captains.length ? 'several-captains' : 'no-captain', captains, { n: captains.length }, '');

    // ---------- goalkeeper caps: 1 and 13 are red. 2026: the substitute keeper wears 13,
    // except U10–U14, where only cap 1 must be red (Art. 4.1 2026; youth handout)
    const youngCaps = ['U10', 'U12', 'U14', 'U14D'].includes(team && team.category);
    if (youngCaps) {
      if (L.length && !L[0].gk) add('warn', 'cap1-not-goalkeeper', [L[0]], {}, 'Art. 4.1');
    } else {
      // 2025: the substitute keeper may wear any number or red 14; 2026: red cap 13
      const redCaps = season.edition >= 2026 ? [1, 13] : [1, 13, 14];
      gks.forEach(p => {
        const cap = L.indexOf(p) + 1;
        if (!redCaps.includes(cap)) add('warn', 'goalkeeper-cap', [p], { cap, caps: redCaps.join(' / ') }, 'Art. 4.1');
      });
    }

    // ---------- licence validity: required (Art. 6.4) — but licences are issued late, so warn
    const inactive = L.filter(p => statusOf(p.status) === 'inactive');
    if (inactive.length) add('warn', 'inactive-licence', inactive, { n: inactive.length }, 'Art. 6.4');
    const unknown = L.filter(p => statusOf(p.status) === 'unknown');
    if (unknown.length && rules.foreigners) add('info', 'status-unknown', unknown, { n: unknown.length }, '');

    // ---------- gender
    if (rules.gender === 'women') { const m = L.filter(isBoy); if (m.length) add('warn', 'men-in-women-team', m, { n: m.length }, rules.art); }
    if (rules.gender === 'men') { const f = L.filter(isGirl); if (f.length) add('warn', 'women-in-men-team', f, { n: f.length }, rules.art); }

    // ---------- age (youth): age = season end year − birth year
    if (rules.kind === 'youth') {
      const noYear = L.filter(p => !/^\d{4}$/.test(String(p.birthYear || '')));
      if (noYear.length) add('info', 'birth-year-unknown', noYear, { n: noYear.length }, rules.art);
      const aged = L.filter(p => /^\d{4}$/.test(String(p.birthYear || ''))).map(p => ({ p, age: season.end - +p.birthYear }));
      const tooOld = aged.filter(({ p, age }) => age > rules.maxAge + (isGirl(p) ? (rules.girlsOver || 0) : 0));
      if (tooOld.length) add('warn', 'too-old', tooOld.map(x => x.p),
        { n: tooOld.length, born: season.end - rules.maxAge, season: season.label, girlsBorn: rules.girlsOver ? season.end - rules.maxAge - rules.girlsOver : null }, rules.art);
      if (rules.minAge != null) {
        const young = aged.filter(({ age }) => age < rules.minAge);
        if (young.length > rules.younger) add('warn', 'too-many-younger', young.map(x => x.p),
          { n: young.length, max: rules.younger, bornAfter: season.end - rules.minAge }, rules.art);
        const unreported = young.filter(({ p }) => !p.younger);
        if (young.length && young.length <= rules.younger && unreported.length)
          add('info', 'younger-must-be-reported', unreported.map(x => x.p), { n: unreported.length }, rules.art);
      }
      if (rules.girlsMaxShare2026 && season.edition >= 2026 && L.length) {
        const g = L.filter(isGirl);
        if (g.length / L.length > rules.girlsMaxShare2026) add('warn', 'girls-share', g, { n: g.length, total: L.length, pct: 50 }, 'Anhang 13A');
      }
      if (rules.ageUnstated) add('info', 'age-rule-unstated', [], {}, rules.art);
    }

    // ---------- nationality
    const f = rules.foreigners;
    if (f) {
      const s = p => statusOf(p.status);
      if (f.onlySwiss) {
        const bad = L.filter(p => s(p) === 'foreign' || (s(p) === 'sse' && !f.allowSse) || s(p) === 'other');
        if (bad.length) add('warn', 'only-swiss', bad, { n: bad.length, sse: !!f.allowSse, season: season.label }, rules.art);
      } else {
        const foreign = L.filter(p => s(p) === 'foreign');
        const sse = L.filter(p => s(p) === 'sse');
        const sseAsForeign = f.sseCountsAsSwiss ? 0 : Math.max(0, sse.length - (f.sse || 0));
        const counted = foreign.length + sseAsForeign;
        if (counted > f.max) add('warn', 'too-many-foreigners', foreign.concat(f.sseCountsAsSwiss ? [] : sse),
          { n: counted, max: f.max, sse: f.sse || 0, season: season.label }, rules.art);
        if (!f.sseCountsAsSwiss && f.sse === 0 && sse.length) add('warn', 'sse-not-allowed', sse, { n: sse.length }, rules.art);
      }
    }

    // errors first, then warnings, then notes — the order a coach needs to read them in
    const rank = { error: 0, warn: 1, info: 2 };
    out.sort((a, b) => rank[a.severity] - rank[b.severity]);
    return { season, rules, findings: out,
             errors: out.filter(x => x.severity === 'error').length,
             warnings: out.filter(x => x.severity === 'warn').length };
  }

  return { STATUS, CATEGORIES, MAX_ON_SHEET, MAX_GK, statusOf, seasonOf, rulesFor, check };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = ELIGIBILITY;
