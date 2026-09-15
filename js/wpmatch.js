/* ============================================================
   wpmatch.js — fixtures, results, box scores and league tables from
   wpmatch.ch, the official Swiss Aquatics water polo match centre.

   It is WordPress + the SportsPress plugin, and its REST API is public,
   unauthenticated and CORS-open, so the client talks to it directly —
   no backend, no key, no account. It is also UNDOCUMENTED and
   UNSUPPORTED: a plugin default, not an open-data programme. So every
   raw object is normalised here and nothing raw ever reaches a view.

   Hard-won facts, each verified against the live API — change them only
   with evidence:

   · `?team=` / `?teams=` / `?sp_team=` are SILENTLY IGNORED. They return
     the full 2547-event listing, so a naive team filter looks like it
     works while showing another club's matches. `?search=`, `?leagues=`,
     `?seasons=`, `?include=`, `?slug=` and `?_fields=` are real.
   · `teams/{id}.events` is NOT that team's fixtures. It is a global
     2000-id list, byte-identical for every team. Never use it.
   · `main_results` are STRINGS. `"7" > "17"` is true, which reports the
     wrong winner in 43% of played matches. Always Number().
   · The `performance` field makes SportsPress prepend a literal "Array"
     once PER RETURNED ITEM. Hence /^(?:Array)+/, not /^Array/. Asking
     for `_fields` without it both removes the corruption and cuts a
     100-event page from ~1.1 MB to ~29 KB.
   · `date_gmt` has no `Z`. Appending it is the difference between a
     correct calendar entry and one two hours out.
   · A `results` / `performance` / `data` object always carries a "0" key
     that is a LABEL row, not a record.

   Pure and unit-tested apart from the thin fetch layer; storage is
   localStorage under thplay.*, rendering lives in app.js.
   ============================================================ */
const WPMATCH = (() => {
  const BASE_DEFAULT = 'https://wpmatch.ch/wp-json/sportspress/v2';
  const BASE_KEY = 'thplay.wpmatch.base';
  const TEAM_KEY = 'thplay.wpmatch.team';
  const CACHE_PREFIX = 'thplay.wpmatch.cache.';
  const PER_PAGE = 100;          // 200 is an HTTP 400, not a clamp
  const MAX_PAGES = 3;
  const SITE = 'https://wpmatch.ch';

  // asking for these keeps `performance` out of list responses: no "Array" corruption, ~38× smaller
  const LIST_FIELDS = 'id,slug,date,date_gmt,link,title,teams,main_results,day,leagues,venues';
  const BOX_FIELDS = 'id,slug,date,date_gmt,link,title,teams,main_results,day,leagues,venues,results,performance';
  const TEAM_FIELDS = 'id,slug,link,title,leagues,seasons';
  const TABLE_FIELDS = 'id,slug,link,title,leagues,seasons,data';

  const getBase = () => { try { return localStorage.getItem(BASE_KEY) || BASE_DEFAULT; } catch (e) { return BASE_DEFAULT; } };
  const setBase = url => { try { url ? localStorage.setItem(BASE_KEY, String(url).replace(/\/+$/, '')) : localStorage.removeItem(BASE_KEY); } catch (e) {} };

  /* ---------------- 1) parsing: never trust the wire ---------------- */
  const stripArray = text => String(text == null ? '' : text).replace(/^(?:Array)+/, '');
  function parse(text) {
    try { return JSON.parse(stripArray(text)); }
    catch (e) { throw Object.assign(new Error('wpmatch-bad-json'), { code: 'bad-json' }); }
  }

  /* Decode with a regex table, never via innerHTML — that would materialise
     third-party markup, and `<img onerror>` fires even on a detached node.
     Decoding is NOT escaping: every value still goes through escapeHtml at render. */
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };
  /* Named accented letters. wpmatch sends player names as raw UTF-8 today (32 of 300 sampled),
     but WordPress can emit &uuml; — and "M&uuml;ller" printed on an official team sheet is a
     silent failure. Generated from the HTML entity table for U+00C0–U+00FF, not typed by hand. */
  const LATIN1 = { AElig: 'Æ', Aacute: 'Á', Acirc: 'Â', Agrave: 'À', Aring: 'Å', Atilde: 'Ã', Auml: 'Ä', Ccedil: 'Ç', ETH: 'Ð', Eacute: 'É', Ecirc: 'Ê', Egrave: 'È', Euml: 'Ë', Iacute: 'Í', Icirc: 'Î', Igrave: 'Ì', Iuml: 'Ï', Ntilde: 'Ñ', Oacute: 'Ó', Ocirc: 'Ô', Ograve: 'Ò', Oslash: 'Ø', Otilde: 'Õ', Ouml: 'Ö', THORN: 'Þ', Uacute: 'Ú', Ucirc: 'Û', Ugrave: 'Ù', Uuml: 'Ü', Yacute: 'Ý', aacute: 'á', acirc: 'â', aelig: 'æ', agrave: 'à', aring: 'å', atilde: 'ã', auml: 'ä', ccedil: 'ç', divide: '÷', eacute: 'é', ecirc: 'ê', egrave: 'è', eth: 'ð', euml: 'ë', iacute: 'í', icirc: 'î', igrave: 'ì', iuml: 'ï', ntilde: 'ñ', oacute: 'ó', ocirc: 'ô', ograve: 'ò', oslash: 'ø', otilde: 'õ', ouml: 'ö', szlig: 'ß', thorn: 'þ', times: '×', uacute: 'ú', ucirc: 'û', ugrave: 'ù', uuml: 'ü', yacute: 'ý', yuml: 'ÿ' };
  function decodeEntities(s) {
    let out = String(s == null ? '' : s)
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
      .replace(/&(lt|gt|quot|apos|nbsp|ndash|mdash);/g, (_, k) => NAMED[k])
      .replace(/&([A-Za-z]+);/g, (m, k) => LATIN1[k] || m);
    return out.replace(/&amp;/g, '&');   // last, so &amp;#8211; cannot double-decode
  }

  /* "SC Horgen – Lugano Sharks" → {home, away}; null when it isn't that shape,
     in which case the caller falls back to the team-id → name map. */
  function splitTitle(title) {
    const t = decodeEntities(title).trim();
    for (const sep of [' – ', ' — ', ' - ']) {
      const i = t.indexOf(sep);
      if (i > 0) {
        const home = t.slice(0, i).trim(), away = t.slice(i + sep.length).trim();
        if (home && away) return { home, away };
      }
    }
    return null;
  }

  const isLabelKey = k => String(k) === '0';
  /* A player stat is not always a number: exclusion fouls come back as
     `1 (13 <b>1. 0:16</b>')` — the count, then the offence and game clock, with
     real markup inside. Show the count; keep the rest as a plain-text detail. */
  const statNumber = v => { const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(String(v == null ? '' : v)); return m ? m[1] : (v == null || v === '' ? '' : String(v)); };
  const statDetail = v => decodeEntities(String(v == null ? '' : v).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
  const num = v => { const n = Number(v); return isFinite(n) ? n : null; };
  // the public /event/{n}/ number (slug) and the WP post id are different numbers, both carried in the payload
  const gameIdOf = raw => String((raw && raw.slug) || '') || null;
  const postIdOf = raw => (raw && +raw.id) || null;

  /* ---------------- 2) normalised shapes the UI consumes ---------------- */
  const nameOf = raw => decodeEntities((raw && raw.title && raw.title.rendered) || '');   // /teams,/events,/tables,/players
  const normTeam = raw => ({ id: +raw.id, name: nameOf(raw), slug: raw.slug || '', url: raw.link || '', leagueIds: raw.leagues || [], seasonIds: raw.seasons || [] });
  const normTerm = raw => ({ id: +raw.id, name: decodeEntities(raw && raw.name || '') });  // /venues,/leagues,/seasons are taxonomies: `name`

  /* A fixture is "date TBC" when it has no venue and has not been played:
     every 2027 placeholder reads day:PLANNED, 2027-12-31T23:00:00, venues:[]. */
  function normFixture(raw, ctx) {
    ctx = ctx || {};
    const teams = Array.isArray(raw.teams) ? raw.teams : [];
    const split = splitTitle((raw.title && raw.title.rendered) || '');
    const byId = ctx.nameById || {};
    const side = (i) => {
      const id = teams[i];
      const fromTitle = split ? (i === 0 ? split.home : split.away) : '';
      return { id: id == null ? null : +id, tbd: +id === -1, name: fromTitle || byId[id] || (+id === -1 ? 'To be decided' : '') };
    };
    const ended = raw.day === 'ENDED';
    const scores = (Array.isArray(raw.main_results) ? raw.main_results : []).map(num);
    // 72 ENDED events carry ['0','0'] — those are unrecorded, not genuine draws
    const hasScore = ended && scores.length >= 2 && scores[0] != null && scores[1] != null && !(scores[0] === 0 && scores[1] === 0);
    const venues = Array.isArray(raw.venues) ? raw.venues : [];
    return {
      gameId: gameIdOf(raw), postId: postIdOf(raw), url: raw.link || '',
      startsAt: raw.date_gmt ? raw.date_gmt + 'Z' : null,   // no Z on the wire; without this every match is 1-2h out
      localTime: raw.date || '',                            // Europe/Zurich wall clock — display only
      title: decodeEntities((raw.title && raw.title.rendered) || ''),
      home: side(0), away: side(1),
      status: ended ? 'ended' : (raw.day === 'PLANNED' ? 'planned' : 'unknown'),   // `day` is not a two-value enum: some are ''
      homeScore: hasScore ? scores[0] : null, awayScore: hasScore ? scores[1] : null,
      dateTBC: !venues.length && !ended,
      leagueIds: raw.leagues || [], venueId: venues[0] == null ? null : +venues[0],
      venueName: venues[0] != null && ctx.venueById ? (ctx.venueById[venues[0]] || '') : '',
    };
  }

  /* Who are we playing, and are we at home — answerable before a ball is thrown,
     unlike resultFor() which needs a score. */
  function opponentOf(fx, teamId) {
    if (!fx) return null;
    const us = fx.home.id === +teamId ? 'home' : (fx.away.id === +teamId ? 'away' : null);
    if (!us) return null;
    const other = us === 'home' ? fx.away : fx.home;
    return { us, opponent: Object.assign({}, other, { name: other.name || (other.tbd ? 'Opponent to be decided' : 'Opponent TBC') }) };
  }

  /* which side is "us", and did we win — from outcome when present, else a NUMERIC compare */
  function resultFor(fx, teamId) {
    if (!fx || fx.homeScore == null) return null;
    const us = fx.home.id === +teamId ? 'home' : (fx.away.id === +teamId ? 'away' : null);
    if (!us) return null;
    const ours = us === 'home' ? fx.homeScore : fx.awayScore;
    const theirs = us === 'home' ? fx.awayScore : fx.homeScore;
    return { us, ours, theirs, outcome: ours > theirs ? 'win' : ours < theirs ? 'loss' : 'draw', opponent: us === 'home' ? fx.away : fx.home };
  }

  /* box score — `performance` is an object on ENDED events and an ARRAY on PLANNED ones,
     and the real player labels live at performance["0"], not performance[teamId]["0"]
     (that per-team row exists but every value is an empty string). */
  function normBox(raw) {
    const teams = Array.isArray(raw.teams) ? raw.teams : [];
    const res = (raw.results && typeof raw.results === 'object' && !Array.isArray(raw.results)) ? raw.results : {};
    const perf = (raw.performance && typeof raw.performance === 'object' && !Array.isArray(raw.performance)) ? raw.performance : {};
    const scoreLabels = (res['0'] && typeof res['0'] === 'object' && !Array.isArray(res['0'])) ? res['0'] : {};
    const playerLabels = (perf['0'] && typeof perf['0'] === 'object' && !Array.isArray(perf['0'])) ? perf['0'] : {};
    const lineFor = id => {
      const r = res[String(id)];
      if (!r || typeof r !== 'object' || Array.isArray(r)) return null;   // [] for unplayed or a -1 placeholder
      return {
        goals: num(r.goals),
        quarters: ['firstquarter', 'secondquarter', 'thirdquarter', 'fourrdquarter'].map(k => r[k] == null ? null : num(r[k])),  // their typo, matched verbatim
        ps: r.ps == null ? null : num(r.ps), manup: r.manup == null ? null : num(r.manup), pstwo: r.pstwo == null ? null : num(r.pstwo),
        outcome: Array.isArray(r.outcome) ? (r.outcome[0] || '') : (r.outcome || ''),
      };
    };
    const rosterFor = id => {
      const block = perf[String(id)];
      if (!block || typeof block !== 'object' || Array.isArray(block)) return [];
      return Object.keys(block).filter(k => !isLabelKey(k)).map(pid => {
        const p = block[pid] || {};
        return { playerId: +pid, cap: p.number == null ? '' : String(p.number), played: p.played === true || p.played === 'true' || p.played === 1,
          status: p.status || '', stats: p };
      }).sort((a, b) => (parseInt(a.cap, 10) || 99) - (parseInt(b.cap, 10) || 99));
    };
    return {
      gameId: gameIdOf(raw), url: raw.link || '', title: decodeEntities((raw.title && raw.title.rendered) || ''),
      teamIds: teams.map(t => +t),
      scoreLabels, playerLabels,
      lines: teams.reduce((o, t) => { o[+t] = lineFor(t); return o; }, {}),
      rosters: teams.reduce((o, t) => { o[+t] = rosterFor(t); return o; }, {}),
      quarterKeys: ['firstquarter', 'secondquarter', 'thirdquarter', 'fourrdquarter'],
    };
  }

  /* league table — never take [0]: league+season does NOT identify one table, and a
     stale "NLA TEST" sits alongside the real ranking with different numbers. */
  function normTable(raw) {
    const data = (raw.data && typeof raw.data === 'object') ? raw.data : {};
    const labels = (data['0'] && typeof data['0'] === 'object') ? data['0'] : {};
    const rows = Object.keys(data).filter(k => !isLabelKey(k)).map(id => Object.assign({ teamId: +id }, data[id]));
    return { id: +raw.id, name: nameOf(raw), url: raw.link || '', leagueIds: raw.leagues || [], seasonIds: raw.seasons || [], labels, rows,
      looksLikeTest: /\btest\b/i.test(nameOf(raw)) };
  }
  function pickTable(tables, teamId) {
    const mine = (tables || []).filter(t => t.rows.some(r => r.teamId === +teamId));
    if (!mine.length) return null;
    const real = mine.filter(t => !t.looksLikeTest);
    return (real.length ? real : mine)[0];
  }

  /* ---------------- 3) cache: the only offline story ----------------
     The service worker deliberately ignores cross-origin requests, so if a
     lookup misses here the view is simply blank on a train. Always fall
     back to stale data and let the UI stamp how old it is. */
  const cacheKey = k => CACHE_PREFIX + k;
  function cacheGet(k, maxAgeMs) {
    try {
      const raw = localStorage.getItem(cacheKey(k)); if (!raw) return null;
      const box = JSON.parse(raw);
      return { data: box.data, at: box.at, stale: maxAgeMs != null && (Date.now() - box.at) > maxAgeMs };
    } catch (e) { return null; }
  }
  function cachePut(k, data, now) {
    try { localStorage.setItem(cacheKey(k), JSON.stringify({ at: now || Date.now(), data })); } catch (e) {}
  }

  const loadTeam = () => { try { return JSON.parse(localStorage.getItem(TEAM_KEY)) || null; } catch (e) { return null; } };
  const saveTeam = t => { try { t ? localStorage.setItem(TEAM_KEY, JSON.stringify(t)) : localStorage.removeItem(TEAM_KEY); } catch (e) {} };

  /* ---------------- 4) the thin fetch layer ---------------- */
  const qs = o => Object.keys(o).filter(k => o[k] != null && o[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
  async function get(path, params) {
    const url = getBase().replace(/\/+$/, '') + path + (params ? '?' + qs(params) : '');
    let r; try { r = await fetch(url); } catch (e) { throw Object.assign(new Error('wpmatch-unreachable'), { code: 'unreachable' }); }
    // an HTTP error still returns valid JSON — with a GERMAN message. Never surface it in a four-language app.
    if (!r.ok) throw Object.assign(new Error('wpmatch-http-' + r.status), { code: 'http', status: r.status });
    const total = +(r.headers.get('x-wp-total') || 0);
    const pages = +(r.headers.get('x-wp-totalpages') || 0);
    return { items: parse(await r.text()), total, pages };
  }

  async function searchTeams(q) {
    const { items } = await get('/teams', { search: q, per_page: 30, _fields: TEAM_FIELDS });
    return (Array.isArray(items) ? items : []).map(normTeam);
  }

  /* A club's fixtures: `search` is a real server-side filter, so search the club's
     name and then keep only events whose teams[] actually contains our id —
     verified 49/49 recall with zero false positives. */
  async function fetchFixtures(team, opts) {
    opts = opts || {};
    const term = opts.search || (team.name || '').split(/\s+/).filter(w => w.length > 2)[1] || team.name;
    const out = []; let total = 0;
    for (let page = 1; page <= (opts.maxPages || MAX_PAGES); page++) {
      const { items, total: t } = await get('/events', { search: term, per_page: PER_PAGE, page, _fields: LIST_FIELDS, orderby: 'date', order: 'desc' });
      if (page === 1) total = t;
      const list = Array.isArray(items) ? items : [];
      out.push(...list);
      if (list.length < PER_PAGE || out.length >= total) break;
    }
    const ctx = { nameById: opts.nameById || {}, venueById: opts.venueById || {} };
    return out.filter(ev => Array.isArray(ev.teams) && ev.teams.some(id => +id === +team.id)).map(ev => normFixture(ev, ctx));
  }

  /* venue names live on a taxonomy, which uses `name` rather than title.rendered */
  async function fetchVenues() {
    const { items } = await get('/venues', { per_page: PER_PAGE, _fields: 'id,name' });
    const by = {}; (Array.isArray(items) ? items : []).forEach(v => { const t = normTerm(v); by[t.id] = t.name; });
    return by;
  }

  async function fetchBox(gameId) {
    const { items } = await get('/events', { slug: String(gameId), _fields: BOX_FIELDS });
    const raw = Array.isArray(items) ? items[0] : null;
    if (!raw) throw Object.assign(new Error('wpmatch-no-such-match'), { code: 'not-found' });
    return normBox(raw);
  }

  async function fetchTables(team) {
    const params = { per_page: PER_PAGE, _fields: TABLE_FIELDS };
    if ((team.leagueIds || []).length) params.leagues = team.leagueIds.join(',');
    const { items } = await get('/tables', params);
    return (Array.isArray(items) ? items : []).map(normTable);
  }

  /* deep links — always the payload's own `link`, never a URL built from an id */
  const teamUrl = t => (t && t.url) || (t && t.slug ? SITE + '/team/' + t.slug + '/' : SITE);
  const matchUrl = fx => (fx && fx.url) || (fx && fx.gameId ? SITE + '/event/' + fx.gameId + '/' : SITE);

  /* fixtures → the app's own calendar events, with a STABLE id so re-importing
     updates in place instead of duplicating. A date-TBC fixture becomes a harmless
     all-day marker rather than a 23:00 alarm on 30 December. */
  function toCalendarEvents(fixtures, team) {
    return (fixtures || []).filter(f => f.gameId && f.startsAt).map(f => {
      const r = resultFor(f, team && team.id);
      const opp = r ? r.opponent.name : (f.home.name + ' / ' + f.away.name);
      const ev = {
        id: 'wpm-' + f.gameId, type: 'match',
        title: (r ? (r.us === 'home' ? 'vs ' : 'at ') : '') + (opp || f.title),
        start: f.startsAt, end: new Date(new Date(f.startsAt).getTime() + 90 * 60000).toISOString(),
        location: f.venueName || '', opponent: opp,
        notes: 'wpmatch.ch · ' + matchUrl(f) + (f.homeScore != null ? `\nResult: ${f.homeScore}–${f.awayScore}` : ''),
        reminderMin: 120,
      };
      if (f.dateTBC) { ev.allDay = true; ev.reminderMin = 0; ev.title += ' (date TBC)'; }
      return ev;
    });
  }

  /* ---------------- 5) players — licence numbers for the team sheet ----------------
     THE LICENCE NUMBER IS THE PLAYER'S `slug` (wpmatch.ch/player/<licence>/). Not the post
     id — /players/<licence> returns rest_post_invalid_id. Proven against the official Game
     Report PDFs (157 licence↔name matches, 0 contradictions) and against a real club team
     sheet (12 of 13 resolved to the right surname; the 13th has no public record).

     PRIVACY — NEVER request `date`. For every real player record it is the full date of
     birth, public, for ~2560 people, many of them minors. PLAYER_FIELDS leaves it out, and
     normPlayer() does not read it even when a caller passes a record that has it.

     Traps, all silent:
     · every team filter (?teams=, ?current_teams=, ?sp_team=) is IGNORED — x-wp-total stays
       2572 and you get the whole country. The only real roster is a crawl filtered here.
     · `slug=a,b,c` IS honoured: 13 licences come back in one request.
     · ~100 people have TWO records: an old "Inactive License" number and a new active one.
       Take the old one and the sheet carries a stale licence. dedupePlayers() drops it.
     · parallel page requests make wpmatch answer with an HTML "Database Error" page; the
       crawl is sequential with retries, and parse() rejects anything that is not JSON. */
  const PLAYER_FIELDS = 'id,slug,title,number,metrics,current_teams';
  const LICENCE_RE = /^\d{3,6}$/;

  function normPlayer(raw) {
    const r = raw || {};
    const title = decodeEntities((r.title && r.title.rendered) || '').replace(/\s+/g, ' ').trim();
    const temp = /_TEMP$/i.test(title);
    const words = title.replace(/_TEMP$/i, '').trim().split(' ').filter(Boolean);
    const m = r.metrics && typeof r.metrics === 'object' ? r.metrics : {};
    const slug = String(r.slug == null ? '' : r.slug);
    return {
      wpId: r.id ? +r.id : null,
      licence: LICENCE_RE.test(slug) ? slug : '',
      // titles are "First Last" (11 of 12 checked); a third word makes the split a guess
      firstName: words.length > 1 ? words[0] : '',
      name: words.length > 1 ? words.slice(1).join(' ') : words.join(' '),
      nameGuessed: words.length > 2,
      cap: r.number == null || r.number === '' ? '' : String(r.number),
      birthYear: /^\d{4}$/.test(String(m['Year of Birth'] || '')) ? String(m['Year of Birth']) : '',
      gender: m.Gender === 'F' ? 'F' : m.Gender === 'M' ? 'M' : '',
      status: String(m.Eligibility || ''),
      temp,
      teams: Array.isArray(r.current_teams) ? r.current_teams.map(Number) : [],
    };
  }

  const foldName = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  /* One person, two records: keep the active one. Two ACTIVE records with the same name are
     two different people and both stay — guessing there would put the wrong licence on a sheet. */
  function dedupePlayers(list) {
    const groups = new Map();
    (list || []).forEach(p => { const k = foldName(p.firstName + ' ' + p.name); groups.set(k, (groups.get(k) || []).concat(p)); });
    const out = [];
    groups.forEach(g => {
      const live = g.filter(p => p.status !== 'Inactive License' && !p.temp);
      out.push(...(live.length && live.length < g.length ? live : g));
    });
    return out;
  }

  /* The fast path: a coach's licence numbers, 50 to a request. Returns what was found AND
     what was not, so a typo is shown rather than silently dropped from the roster. */
  const LICENCE_BATCH = 50;
  async function lookupLicences(licences) {
    const want = [...new Set((licences || []).map(x => String(x).trim()).filter(x => LICENCE_RE.test(x)))];
    const found = [];
    for (let i = 0; i < want.length; i += LICENCE_BATCH) {
      const { items } = await get('/players', { slug: want.slice(i, i + LICENCE_BATCH).join(','), per_page: 100, _fields: PLAYER_FIELDS });
      (Array.isArray(items) ? items : []).forEach(x => found.push(normPlayer(x)));
    }
    const have = new Set(found.map(p => p.licence));
    return { players: found, missing: want.filter(l => !have.has(l)) };
  }

  const pause = ms => new Promise(res => setTimeout(res, ms));
  /* The slow path: every player page, one at a time, keeping those whose current_teams holds
     this team. ~26 pages at ~2.5 s — about a minute — so the caller shows progress and caches. */
  async function fetchTeamPlayers(teamId, opts) {
    const o = opts || {}, tid = +teamId, keep = [];
    let page = 1, pages = 1;
    do {
      let res;
      for (let tries = 0; ; tries++) {
        try { res = await get('/players', { per_page: 100, page, _fields: PLAYER_FIELDS }); break; }
        catch (e) { if (tries >= 2) throw e; await pause(800 * (tries + 1)); }
      }
      if (!Array.isArray(res.items)) throw Object.assign(new Error('wpmatch-bad-json'), { code: 'bad-json' });
      pages = res.pages || pages;
      res.items.forEach(x => { if ((x.current_teams || []).map(Number).includes(tid)) keep.push(normPlayer(x)); });
      if (o.onProgress) o.onProgress(page, pages);
      page++;
    } while (page <= pages && page <= 60);
    return dedupePlayers(keep);
  }

  return {
    BASE_DEFAULT, LIST_FIELDS, BOX_FIELDS, PER_PAGE, MAX_PAGES, SITE,
    getBase, setBase, loadTeam, saveTeam,
    stripArray, parse, decodeEntities, splitTitle, gameIdOf, postIdOf, statNumber, statDetail,
    normTeam, normTerm, normFixture, normBox, normTable, pickTable, resultFor, opponentOf,
    cacheGet, cachePut,
    searchTeams, fetchFixtures, fetchBox, fetchTables, fetchVenues,
    PLAYER_FIELDS, normPlayer, dedupePlayers, lookupLicences, fetchTeamPlayers,
    teamUrl, matchUrl, toCalendarEvents,
  };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = WPMATCH;
