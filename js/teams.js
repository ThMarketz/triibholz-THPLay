/* ============================================================
   teams.js — a coach's teams, rosters, templates and team sheets.

   A coach runs several teams (U10…U18, NLA/NLB, Regionalliga, women's
   leagues, the Swiss-only Swiss Trophy). Each has a roster of licensed
   players, a sheet template and staff; for every match the coach builds
   the official line-up, checks it, and downloads it as Word or PDF.

   WHERE THE DATA LIVES — on this device, in localStorage, and nowhere else
   unless a coach says so. A roster is licence numbers, names, birth years
   and eligibility status, much of it for minors. Nothing is sent anywhere
   automatically, ever.

   When the club runs a server with accounts on (docs/ACCOUNTS.md slice 5)
   a coach can press "Sync with the club" and send their teams to it, so
   they survive a lost phone and follow the coach to a second device. Even
   then the device keeps the parts the club has no use for: birth years and
   eligibility status for a licensed player (wpmatch supplies both here,
   from a public licence), availability, and the sheets themselves. What
   travels is fixed by js/teamsync.js, which the server enforces on the
   same payload. Player data comes from wpmatch.ch, which publishes it;
   `date` (a date of birth) is never fetched — see wpmatch.js.

   The pure parts live elsewhere and are tested there: SHEETDOC draws,
   TEAMSHEET lays out, ELIGIBILITY judges, WPMATCH fetches. This file is
   storage and screens.
   ============================================================ */
const TEAMS = (() => {
  const KEY = 'thplay.teams.v1';
  const T = (k, vars) => (typeof I18N !== 'undefined') ? I18N.t(k, vars) : k;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = p => p + Math.random().toString(36).slice(2, 10);

  /* The categories a coach picks from, in the order a club thinks about them. The id is the
     ELIGIBILITY preset; the label key says what the club calls it ("top division") next to
     the official name, because the two rarely match. */
  const CATEGORY_ORDER = ['U10', 'U12', 'U14', 'U14D', 'U16', 'U16D', 'U18', 'U18D', 'NLA', 'NLB', 'RL', 'NLD', 'PLD', 'ST', 'CUP', 'CUPD', 'CUSTOM'];

  /* ------------------------------------------------------------- storage */
  const blank = () => ({ version: 1, teams: [], players: {}, templates: [], sheets: [] });
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (!d || typeof d !== 'object') return blank();
      return { version: 1, teams: Array.isArray(d.teams) ? d.teams : [], players: d.players && typeof d.players === 'object' ? d.players : {},
               templates: Array.isArray(d.templates) ? d.templates : [], sheets: Array.isArray(d.sheets) ? d.sheets : [] };
    } catch (e) { return blank(); }
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); return true; } catch (e) { return false; } }

  /* ------------------------------------------------------------- pure helpers (tested) */
  const pidOf = p => p.licence ? 'L' + p.licence : p.pid;

  /* Merge players into the store. A licence number is the identity; a player without one
     (a new signing whose licence is pending) gets a local id until it arrives. wpmatch wins
     for what wpmatch knows (status, birth year); what the coach typed (a corrected name split,
     the goalkeeper flag) is kept. Returns the ids, in the order given. */
  function upsertPlayers(d, list, source) {
    const ids = [];
    (list || []).forEach(p => {
      if (!p) return;
      const pid = p.licence ? 'L' + p.licence : (p.pid || uid('m'));
      const prev = d.players[pid] || {};
      const fromWpm = source === 'wpmatch';
      d.players[pid] = {
        pid, licence: p.licence || prev.licence || '',
        name: prev.edited ? prev.name : (p.name || prev.name || ''),
        firstName: prev.edited ? prev.firstName : (p.firstName || prev.firstName || ''),
        nameGuessed: prev.edited ? false : !!p.nameGuessed,
        birthYear: (fromWpm ? p.birthYear : prev.birthYear) || p.birthYear || prev.birthYear || '',
        gender: (fromWpm ? p.gender : prev.gender) || p.gender || prev.gender || '',
        status: fromWpm ? (p.status || '') : (prev.status || p.status || ''),
        cap: p.cap || prev.cap || '',
        gk: prev.gk != null ? prev.gk : !!p.gk,
        wpId: p.wpId || prev.wpId || null,
        edited: !!prev.edited, source: fromWpm ? 'wpmatch' : (prev.source || source || 'manual'),
        checkedAt: fromWpm ? Date.now() : (prev.checkedAt || null),
      };
      ids.push(pid);
    });
    return ids;
  }

  const roster = (d, team) => (team.players || []).map(pid => d.players[pid]).filter(Boolean);

  /* Cap order for a fresh sheet: goalkeepers take the red caps — 1, and 13 for the substitute
     keeper (from 2026 in every category but U10–U14, where only cap 1 is red, so the second
     keeper just goes next) — and everyone else follows by their usual cap number, then name. */
  function autoOrder(players, rows, category) {
    const n = rows || 14;
    const youth = ['U10', 'U12', 'U14', 'U14D'].includes(category);
    const byCap = (a, b) => ((+a.cap || 99) - (+b.cap || 99)) || String(a.name).localeCompare(String(b.name));
    const gks = players.filter(p => p.gk).sort(byCap), field = players.filter(p => !p.gk).sort(byCap);
    const slots = new Array(n).fill(null);
    if (gks[0]) slots[0] = gks[0];
    if (gks[1]) { const i = !youth && n >= 13 ? 12 : 1; if (!slots[i]) slots[i] = gks[1]; else field.unshift(gks[1]); }
    gks.slice(2).forEach(g => field.push(g));
    let f = 0;
    for (let i = 0; i < n && f < field.length; i++) if (!slots[i]) slots[i] = field[f++];
    return slots;
  }

  const allTemplates = d => TEAMSHEET.BUILTIN.map(t => TEAMSHEET.normalizeTemplate(t))
    .concat((d.templates || []).map(t => TEAMSHEET.normalizeTemplate(t)));
  const templateById = (d, id) => allTemplates(d).find(t => t.id === id) || TEAMSHEET.normalizeTemplate(TEAMSHEET.BUILTIN[0]);

  /* ---------- who can play this match ----------
     The coach's own note, on the coach's own device: nobody is asked anything and nothing is sent.
     Asking the players themselves needs accounts (docs/ACCOUNTS.md slice 4) — until then the UI
     says so in plain words rather than implying an answer that was never given. */
  const AVAIL = ['in', 'out'];
  const availOf = (s, pid) => (s.availability && s.availability[pid]) || 'unknown';
  function setAvailability(s, pid, state) {
    s.availability = s.availability || {};
    if (AVAIL.includes(state)) s.availability[pid] = state; else delete s.availability[pid];
  }
  function availabilityCounts(s, players) {
    const c = { in: 0, out: 0, unknown: 0 };
    players.forEach(p => { c[availOf(s, p.pid)]++; });
    return c;
  }
  /* the players a line-up may be built from: those marked in, or — while nobody is marked — everyone
     except those marked out */
  function availablePool(s, players) {
    const marked = players.filter(p => availOf(s, p.pid) === 'in');
    return marked.length ? marked : players.filter(p => availOf(s, p.pid) !== 'out');
  }

  /* ------------------------------------------------------------- the club's copy (slice 5)

     A coach's teams are theirs, on their device. When the club runs a server with accounts on,
     they can also put them THERE — so they survive a lost phone and follow the coach to a second
     device. What that costs is that children's names and licence numbers leave the device, so
     nothing here happens on its own: a coach presses a button, every time.

     Three stores, and each has a reason to be separate:
       · thplay.teams.v1      the coach's own teams — the source, still fully editable offline
       · thplay.teams.mirror  what the club's server says, read-only, for a pool with no signal
       · thplay.teams.sync    which local team reached the server, and when

     The mirror is never merged into the coach's own store. A roster that came back from the server
     is the club's copy of it, and quietly mixing the two would leave nobody able to say which is
     which — least of all a coach at a pool deciding who may play.

     js/teamsync.js is the contract the server enforces on the same payload, so anything refused
     here is refused there too. */
  const MIRROR_KEY = 'thplay.teams.mirror.v1';
  const SYNC_KEY = 'thplay.teams.sync.v1';
  const readJson = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k)); return v && typeof v === 'object' ? v : fallback; } catch (e) { return fallback; } };
  const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const loadMirror = () => readJson(MIRROR_KEY, { clubs: {} });
  const loadSyncLog = () => readJson(SYNC_KEY, {});
  const syncStateOf = (clubId, localId) => (loadSyncLog()[clubId + ':' + localId] || null);

  /* accounts on, signed in, staff of a club — the only state in which any of this is offered */
  function syncClub() {
    if (typeof SESSION === 'undefined' || !SESSION.on || !SESSION.on()) return null;
    const who = SESSION.appUser && SESSION.appUser();
    if (!who || !['coach', 'trainer', 'super-admin'].includes(who.role) || !who.clubId) return null;
    return { id: who.clubId, name: who.clubName, origin: (SESSION.cached() && SESSION.cached().session || {}).origin || 'legacy' };
  }
  /* a session opened by following somebody's link may not upload — the server refuses it too, and
     this is only so the app does not offer a button that would be turned down */
  const maySync = club => !!club && ['login', 'club-admin', 'staff-invite'].includes(club.origin);

  /* one local player as the payload contract allows them. A licensed player's birth year, gender
     and eligibility status are NOT sent: wpmatch supplies all three on this device, from a licence
     that is already public, and the club's server has no use for a nationality note about a child. */
  function forUpload(p) {
    const o = { name: p.name || '', firstName: p.firstName || '', nameEdited: !!p.edited, nameGuessed: !!p.nameGuessed, cap: p.cap || '', gk: !!p.gk };
    o.localId = p.pid;                       // how this device has always known them
    if (p.licence) o.licence = p.licence;
    else {
      if (/^\d{4}$/.test(String(p.birthYear || ''))) o.birthYear = +p.birthYear;
      if (p.gender === 'M' || p.gender === 'F') o.gender = p.gender;
    }
    return o;
  }
  const thisSeason = () => (typeof ELIGIBILITY !== 'undefined' ? ELIGIBILITY.seasonOf(new Date().toISOString()).start : new Date().getFullYear());
  /* The season a team was made for, kept on the team — not "today". A squad belongs to the season
     it plays; stamping the current one on every upload would move last season's team into this one
     on 1 September, taking last season's children with it and inventing a conflict with the real
     squad. Teams made before this existed are read as the season they are first synced in. */
  const seasonOf = t => (Number.isInteger(t.season) ? t.season : thisSeason());
  function payloadFor(d, t, clubId) {
    const st = clubId ? syncStateOf(clubId, t.id) : null;
    return {
      localId: t.id, teamId: (st && st.serverId) || null,
      name: t.name || '', category: t.category, leagueLabel: t.leagueLabel || '',
      season: seasonOf(t),
      players: roster(d, t).map(forUpload),
    };
  }

  /* Send one team. The device writes "sending" before it asks and "confirmed" only after the
     answer accounts for everything it sent (TEAMSYNC.manifestOk) — so a proxy that truncated the
     list, a server that stored half of it, or an answer meant for another team all leave the local
     copy exactly as it was, and the coach is told it did not go. */
  async function syncTeam(clubId, t) {
    const d = load();
    const payload = payloadFor(d, t, clubId);
    const checked = TEAMSYNC.sanitizeTeam(payload);
    if (!checked.ok) return { ok: false, error: checked.error, localId: t.id };
    if (typeof SESSION === 'undefined' || !SESSION.on || !SESSION.on()) return { ok: false, error: 'no-club', localId: t.id };
    const since = stamp();
    const log = loadSyncLog(), was = log[clubId + ':' + t.id] || null;
    log[clubId + ':' + t.id] = Object.assign({}, was, { state: 'sending', at: Date.now() });
    if (!writeJson(SYNC_KEY, log)) return { ok: false, error: 'no-room', localId: t.id };
    /* An attempt that fails puts back what was known before it. Dropping the record instead would
       lose the id the club knows this team by — and then the coach's own team comes back in the
       mirror as a stranger's, and ✕ can no longer reach the club's copy of a child. */
    const give = why => {
      if (stale(since)) return why;                 // signed out meanwhile: leave nothing behind
      const l = loadSyncLog();
      if (was) l[clubId + ':' + t.id] = was; else delete l[clubId + ':' + t.id];
      writeJson(SYNC_KEY, l);
      return why;
    };
    /* Sending a club's children needs the passkey again — the server asks for it, so the app has to
       be able to answer. One prompt covers the whole run: the first team opens the five-minute
       window and the rest of the run rides it. Without this the button could never succeed for a
       coach who signed in an hour ago, which is every coach. */
    const post = () => SESSION.api(`/api/clubs/${clubId}/teams`, { method: 'POST', body: payload });
    let answer;
    try { answer = await post(); }
    catch (e) {
      if (!(e.status === 403 && e.error === 'step-up-required')) return give({ ok: false, error: e.error || 'failed', status: e.status, localId: t.id });
      try { await SESSION.stepUp(); answer = await post(); }
      catch (e2) { return give({ ok: false, error: e2.error || 'failed', status: e2.status, localId: t.id }); }
    }
    if (!TEAMSYNC.manifestOk(checked.value, answer)) return give({ ok: false, error: 'manifest-mismatch', localId: t.id });
    if (stale(since)) return { ok: false, error: 'signed-out', localId: t.id };
    const byPid = {};
    (answer.players || []).forEach(x => { const pid = x.licence ? 'L' + x.licence : x.localId; if (pid && x.id) byPid[pid] = x.id; });
    const log2 = loadSyncLog();
    log2[clubId + ':' + t.id] = { state: 'confirmed', at: answer.at, serverId: answer.team.id, rev: answer.team.rev, players: byPid };
    writeJson(SYNC_KEY, log2);
    return { ok: true, localId: t.id, manifest: answer };
  }

  /* Every team this device holds, then the club's own list back — so the coach sees the teams a
     colleague uploaded as well, read-only, with the moment the server said it was. */
  async function syncAll(clubId, onStep) {
    const since = stamp();
    const d = load();
    const out = { sent: 0, failed: 0, conflicts: [], removedAtClub: [], errors: [] };
    for (const t of d.teams) {
      if (onStep) onStep(t.name);
      const r = await syncTeam(clubId, t);
      if (r.ok) {
        out.sent++;
        const cs = Array.isArray(r.manifest.conflicts) ? r.manifest.conflicts : [];
        cs.forEach(c => { if (c && Array.isArray(c.players)) out.conflicts.push(c); });
        const gone = Array.isArray(r.manifest.removedAtClub) ? r.manifest.removedAtClub : [];
        gone.forEach(x => out.removedAtClub.push(x && (x.licence || x.localId)));
      }
      else { out.failed++; out.errors.push(r); }
    }
    try {
      const list = await SESSION.api(`/api/clubs/${clubId}/teams`);
      if (stale(since)) return out;                 // the coach signed out while this was in the air
      const m = loadMirror();
      m.clubs[clubId] = { syncedAt: list.at, scope: list.scope, teams: list.teams };
      writeJson(MIRROR_KEY, m);
      out.syncedAt = list.at;
    } catch (e) { out.errors.push({ error: e.error || 'failed', status: e.status }); }
    return out;
  }

  /* ---- taking a roster down.

     The club holds it; this device may not. A coach on a new phone, or one an admin has just added
     to a colleague's team, asks for it here. It arrives as an ordinary local team — editable, like
     any other — and the device records which team at the club it came from, so the next sync
     updates that list instead of minting a parallel one under a new local id. Reading a roster is
     an export, so the server asks for the passkey again and this answers it. */
  async function pullTeam(serverId) {
    const club = syncClub();
    if (!club) return { ok: false, error: 'no-club' };
    const get = () => SESSION.api(`/api/clubs/${club.id}/teams/${serverId}`);
    let answer;
    try { answer = await get(); }
    catch (e) {
      if (!(e.status === 403 && e.error === 'step-up-required')) return { ok: false, error: e.error || 'failed', status: e.status };
      try { await SESSION.stepUp(); answer = await get(); }
      catch (e2) { return { ok: false, error: e2.error || 'failed', status: e2.status }; }
    }
    const d = load();
    const already = d.teams.find(t => { const st = syncStateOf(club.id, t.id); return st && st.serverId === serverId; });
    const t = already || { id: uid('t'), templateId: 'sa-2025', staff: {}, rules: {}, wpmatch: null };
    Object.assign(t, { name: answer.team.name, category: answer.team.category, leagueLabel: answer.team.leagueLabel || '', season: answer.team.season });
    const pids = [], byPid = {};
    (answer.players || []).forEach(p => {
      const pid = p.licence ? 'L' + p.licence : (p.id || uid('m'));
      const prev = d.players[pid] || {};
      d.players[pid] = Object.assign({}, prev, {
        pid, licence: p.licence || '', name: p.name || '', firstName: p.firstName || '',
        nameGuessed: !!p.nameGuessed, edited: !!p.nameEdited,
        birthYear: p.birthYear || prev.birthYear || '', gender: p.gender || prev.gender || '',
        // the club never holds these: whatever wpmatch told THIS device is all there is
        status: prev.status || '', cap: p.cap || prev.cap || '', gk: !!p.gk,
        source: prev.source || 'club',
      });
      pids.push(pid); byPid[pid] = p.id;
    });
    t.players = pids;
    if (!already) d.teams.push(t);
    if (!save(d)) return { ok: false, error: 'no-room' };
    db = d;
    const log = loadSyncLog();
    log[club.id + ':' + t.id] = { state: 'confirmed', at: answer.at, serverId, rev: answer.team.rev, players: byPid };
    writeJson(SYNC_KEY, log);
    return { ok: true, localId: t.id, players: pids.length };
  }

  /* ---- taking it back again.

     Uploading a roster without a way to take it back would be the worst thing in this file: the
     club's copy would only ever grow, a child taken off a sheet would stay on the server for good,
     and the retention clock would never start because nothing would ever stamp left_at. So the two
     acts a coach already has — ✕ on a player, and deleting a team — reach the club too, whenever
     that team has been synced. If the club cannot be reached the local change still happens and
     the coach is told the club still has its copy; saying nothing would be a lie by omission. */
  async function removeAtClub(t, serverPid) {
    const club = syncClub();
    const st = club && syncStateOf(club.id, t.id);
    if (!club || !st || st.state !== 'confirmed' || !serverPid) return { ok: true, skipped: true };
    const call = () => SESSION.api(`/api/clubs/${club.id}/teams/${st.serverId}/players/${serverPid}/remove`, { method: 'POST', body: {} });
    try { await call(); return { ok: true }; }
    catch (e) {
      if (e.status === 403 && e.error === 'step-up-required') {
        try { await SESSION.stepUp(); await call(); return { ok: true }; } catch (e2) { return { ok: false, error: e2.error, status: e2.status }; }
      }
      if (e.status === 404) return { ok: true, skipped: true };      // already gone at the club
      return { ok: false, error: e.error, status: e.status };
    }
  }
  async function deleteAtClub(t) {
    const club = syncClub();
    const st = club && syncStateOf(club.id, t.id);
    if (!club || !st || st.state !== 'confirmed') return { ok: true, skipped: true };
    const call = () => SESSION.api(`/api/clubs/${club.id}/teams/${st.serverId}/delete`, { method: 'POST', body: { name: t.name } });
    try { await call(); }
    catch (e) {
      if (e.status === 403 && e.error === 'step-up-required') {
        try { await SESSION.stepUp(); await call(); } catch (e2) { return { ok: false, error: e2.error, status: e2.status }; }
      } else if (e.status !== 404) return { ok: false, error: e.error, status: e.status };
    }
    const log = loadSyncLog(); delete log[club.id + ':' + t.id]; writeJson(SYNC_KEY, log);
    return { ok: true };
  }
  /* which id the club knows a local player by — the manifest is what maps the two */
  const serverIdOf = (clubId, localTeamId, pid) => {
    const st = syncStateOf(clubId, localTeamId);
    return (st && st.players && st.players[pid]) || null;
  };

  /* Sign-out leaves nothing behind. Everything a roster touches, plus the module's own state — a
     shared laptop at a club is the ordinary case, not the exotic one. The server is asked to end
     the session separately; this runs either way, because a wipe that depends on the network is
     not a wipe. */
  let wipedAt = 0;
  /* A sync that was already in the air when the coach signed out must not land afterwards. Every
     write below checks the stamp it started under: a request that comes back late finds the world
     changed and drops its answer instead of putting the club's children back on the device. */
  const stamp = () => wipedAt;
  const stale = since => since !== wipedAt;
  function wipeDevice() {
    wipedAt++;
    [KEY, MIRROR_KEY, SYNC_KEY, CARD_KEY, SCOUT_KEY].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    db = blank();
    ui.teamId = null; ui.sheetId = null; ui.tplId = null; ui.tab = 'teams'; ui.notice = ''; ui.progress = '';
    return true;
  }

  /* A sheet's rows → the shape ELIGIBILITY and TEAMSHEET both read. */
  function lineupOf(d, sheet) {
    return (sheet.rows || []).map(r => {
      if (!r || !r.pid || !d.players[r.pid]) return null;
      const p = d.players[r.pid];
      return { licence: p.licence, name: p.name, firstName: p.firstName, birthYear: p.birthYear, gender: p.gender,
               status: p.status, gk: !!r.gk, captain: !!r.captain, younger: !!r.younger, pid: p.pid };
    });
  }

  /* ------------------------------------------------------------- screens */
  let root = null, ctx = {}, db = blank();
  const ui = { tab: 'teams', teamId: null, sheetId: null, tplId: null, busy: '', progress: '', notice: '', scout: null, ours: null, scoutWho: '' };

  function render(container, context) {
    root = container; ctx = context || {}; db = load();
    draw();
  }
  const persist = () => { if (!save(db)) toast(T('tm.saveFailed')); };
  const toast = m => (ctx.toast ? ctx.toast(m) : null);
  const team = () => db.teams.find(t => t.id === ui.teamId) || null;
  const sheet = () => db.sheets.find(s => s.id === ui.sheetId) || null;

  function draw() {
    if (!root) return;
    if (!ctx.canEdit) { root.innerHTML = `<div class="dash-wrap"><p class="muted">${T('tm.coachesOnly')}</p></div>`; return; }
    const t = team(), s = sheet();
    let body;
    if (s) body = drawSheet(s);
    else if (ui.tplId) body = drawTemplateEditor();
    else if (t) body = drawTeam(t);
    else body = ui.tab === 'templates' ? drawTemplates() : drawTeamList();
    root.innerHTML = `<div class="dash-wrap tm-wrap">${body}</div>`;
    wire();
  }

  const catLabel = id => T('tm.cat.' + id);
  const statusBadge = raw => {
    const s = ELIGIBILITY.statusOf(raw);
    const cls = { swiss: 'ok', ssn: 'ok', sse: 'mid', foreign: 'mid', inactive: 'bad', other: 'mid', unknown: 'none' }[s];
    return `<span class="tm-status tm-${cls}">${esc(T('tm.status.' + s))}</span>`;
  };

  /* A refusal in the coach's words. Never the raw code: "409" tells a coach nothing they can act on. */
  function syncWhy(e) {
    if (!e) return T('tm.whyUnknown');
    if (e.status === 0 || e.error === 'offline') return T('tm.whyOffline');
    if (e.status === 403 && e.error === 'full-sign-in-required') return T('tm.whyNeedsSignIn');
    if (e.status === 403 && e.error === 'club-not-under-contract') return T('tm.whyNoContract');
    if (e.status === 403) return T('tm.whyNeedsPasskey');
    if (e.status === 409 && e.error === 'too-many-teams') return T('tm.whyTooManyTeams');
    if (e.status === 409 && e.error === 'too-many-players') return T('tm.whyClubFull');
    if (e.status === 400 && e.error === 'team-full') return T('tm.whyTeamFull');
    if (e.status === 409) return T('tm.whyChanged');
    if (e.status === 429) return T('tm.whyTooOften');
    if (e.error === 'manifest-mismatch') return T('tm.whyNotConfirmed');
    if (e.error === 'no-room') return T('tm.whyNoRoom');
    if (String(e.error || '').startsWith('bad-') || e.error === 'too-many-players' || e.error === 'duplicate-player') return T('tm.whyRefused', { what: String(e.error) });
    return T('tm.whyUnknown');
  }

  /* ---------- scouting the other team.

     A coach preparing for Saturday can look up what the opposing squad has actually done this
     season — wpmatch publishes it, and every club can read it. SCOUT judges, this renders.

     Nothing here is a prediction. Every number arrives with what it is out of, exclusions are
     labelled as the ones a player conceded, and the limits are on the screen rather than in a
     footnote, because the gaps (who DRAWS exclusions, where they shoot, which hand) are exactly
     the ones a coach would otherwise assume were covered. */
  function scoutLine(p) {
    const rate = p.perMatch === null ? '' : ' ' + T('sc.aMatch', { n: p.perMatch });
    return `<li><strong>${esc(p.name)}</strong> — ${T('sc.nInMatches', { n: p.n, matches: p.played })}${rate}${p.share ? ` <span class="muted">${T('sc.ofSquad', { share: esc(p.share) })}</span>` : ''}</li>`;
  }
  function scoutHtml(sc, opts) {
    const own = !!(opts && opts.own);
    const r = sc.report;
    if (r.empty) {
      return `<div class="film-panel tm-scout"><h3>${T('sc.title', { name: esc(sc.name) })}</h3>
        <p class="muted">${T('sc.noFigures')}</p><p class="fa-note">${T('sc.noFiguresWhy')}</p>
        <div class="tm-actions"><button class="btn-ghost sm" id="tm-scout-x">${T('sc.close')}</button></div></div>`;
    }
    const cols = [['played', 'sc.colPlayed'], ['goals', 'sc.colGoals'], ['goalon', 'sc.colSixOnSix'], ['goalextraplayer', 'sc.colExtra'],
      ['penaltygoals', 'sc.colPenalties'], ['exclusionfoul', 'sc.colExcluded'], ['penaltyfouls', 'sc.colFouls']]
      .concat(r.showMisconduct ? [['misconductfoul', 'sc.colMisconduct']] : [])
      .concat(r.showBrutality ? [['brutalityfoul', 'sc.colViolent']] : []);
    return `<div class="film-panel tm-scout">
      <h3>${T('sc.title', { name: esc(sc.name) })} <span class="rightbar-hint">${T('sc.matchesSoFar', { n: r.matches })} · ${esc(new Date(sc.at).toLocaleDateString())}</span></h3>
      ${r.team.perMatch !== null ? `<p class="tm-scout-band">${T('sc.bandExclusions', { n: r.team.exclusions, matches: r.matches, per: r.team.perMatch })}</p>` : ''}
      ${r.sections.map(x => `<div class="tm-scout-sec"><span class="ef-label">${T('sc.sec.' + x.key)}</span>
        <ul class="tm-scout-list">${x.players.map(scoutLine).join('')}</ul></div>`).join('')}
      ${r.thin.length ? `<div class="tm-scout-sec"><span class="ef-label">${T('sc.tooFew')}</span>
        <ul class="tm-scout-list">${r.thin.map(p => `<li><strong>${esc(p.name)}</strong> — ${T('sc.thinLine', { goals: p.goals, excl: p.exclusionfoul, matches: p.played })}</li>`).join('')}</ul></div>` : ''}
      <details class="tm-scout-all"><summary>${T('sc.everyPlayer', { n: r.table.length })}</summary>
        <div class="dev-table-wrap"><table class="dev-table"><thead><tr><th>${T('sc.colPlayer')}</th>${cols.map(c => `<th>${T(c[1])}</th>`).join('')}</tr></thead>
          <tbody>${r.table.map(p => `<tr><td>${esc(p.name)}</td>${cols.map(c => `<td>${p[c[0]] || 0}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>
      <p class="fa-note">${T('sc.limits')}</p>
      <p class="fa-note">${T('sc.source')} ${sc.url ? `<a href="${esc(sc.url)}" target="_blank" rel="noopener noreferrer">wpmatch.ch</a>` : 'wpmatch.ch'}</p>
      ${own ? '' : `<div class="tm-scout-keep">
        <label class="auth-field"><span>${T('sc.keepAs')}</span>
          <input type="text" id="tm-scout-label" maxlength="60" value="${esc(sc.label || '')}" placeholder="${esc(sc.name)}"></label>
        <button class="btn-primary sm" id="tm-scout-keep">${T('sc.keep')}</button>
        <p class="fa-note">${T('sc.keepNote', { n: SCOUT_MAX })}</p></div>`}
      <div class="tm-actions"><button class="btn-ghost sm" id="tm-scout-x">${T(own ? 'sc.hide' : 'sc.close')}</button></div></div>`;
  }

  /* Our OWN squad's season figures, from the same source and the same judging as an opponent's.
     A coach should not have to scout their own team to see what their players have done, so this
     is a button on the team itself — and it is the only place a player's own card can come from,
     because the join is the wpmatch player id that the roster crawl already stored. */
  async function ourSquad(t) {
    if (!t || !t.wpmatch) return { error: 'not-linked' };
    return scoutSquad({ id: t.wpmatch.id, name: t.wpmatch.name, slug: t.wpmatch.slug || '' });
  }
  /* one player's line, or the reason there is none — four different answers, never one vague
     "wpmatch is down", because "he has no record" and "we could not ask" are different facts */
  function playerLine(squad, p) {
    if (!p) return { why: 'no-player' };
    if (!p.wpId) return { why: 'not-matched' };            // added by hand: nothing to join on
    if (!squad) return { why: 'not-loaded' };
    const line = SCOUT.lineFor(squad, p.wpId);
    return line ? { line } : { why: 'not-in-squad' };
  }

  /* ---- keeping a squad a coach has looked up.

     A scouted squad is NOT a team. It never goes in db.teams and never into the shared db.players
     map, for two reasons: syncAll uploads every team on the device, so an opponent's children would
     land on our own club's server; and a scouted player in db.players could be picked onto an
     official team sheet, where one wrong tap puts another club's child on a Swiss Aquatics form.

     It lives in its own small store with the coach's own name on it, five squads at most, and
     nothing older than a week. That cap is the difference between a lookup before a match and a
     standing file on other clubs' children. */
  const SCOUT_KEY = 'thplay.scout.v1';
  const SCOUT_MAX = 5, SCOUT_KEEP_MS = 7 * 24 * 3600e3;
  const loadScouts = () => {
    const all = readJson(SCOUT_KEY, {});
    const now = Date.now(), out = {};
    // a week is the whole retention policy, applied on every read so it cannot be forgotten
    Object.keys(all).forEach(k => { if (all[k] && now - (all[k].at || 0) < SCOUT_KEEP_MS) out[k] = all[k]; });
    if (Object.keys(out).length !== Object.keys(all).length) writeJson(SCOUT_KEY, out);
    return out;
  };
  const scoutList = () => Object.values(loadScouts()).sort((a, b) => b.at - a.at);
  function saveScout(sc, label) {
    const all = loadScouts();
    const key = String(sc.listId);
    /* strictly increasing, because two squads kept in the same millisecond would tie and then
       "drop the oldest" would drop whichever the sort happened to put last */
    const newest = Object.values(all).reduce((n, x) => Math.max(n, x.at || 0), 0);
    const at = Math.max(Date.now(), newest + 1);
    all[key] = { listId: sc.listId, name: sc.name, url: sc.url, at,
                 label: TEAMSYNC.clean(label || (all[key] && all[key].label) || '', 60), squad: sc.squad };
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
    keys.slice(SCOUT_MAX).forEach(k => { delete all[k]; });     // oldest out, so five is really five
    writeJson(SCOUT_KEY, all);
    return all[key];
  }
  const forgetScout = listId => { const all = loadScouts(); delete all[String(listId)]; writeJson(SCOUT_KEY, all); };

  /* The same control on both screens. On a match sheet the opponent is already named by the
     fixture; on the team page the coach types it, because a sheet cannot be made until the team
     has players and looking an opponent up should not wait for that. */
  function scoutHostHtml(withInput) {
    return `<div class="tm-scout-host">
      ${withInput ? `<label class="auth-field tm-scout-who"><span>${T('tm.opponent')}</span>
        <input type="text" id="tm-scout-who" maxlength="60" placeholder="${T('sc.whoPlaceholder')}" value="${esc(ui.scoutWho || '')}"></label>` : ''}
      <button class="btn-ghost sm" id="tm-scout" ${ui.busy ? 'disabled' : ''}>${T('sc.scoutOpponent')}</button>
      ${scoutList().map(x => `<button class="btn-ghost sm" data-scout-open="${esc(String(x.listId))}">${esc(x.label || x.name)}</button>`).join('')}
      <div id="tm-scout-out">${ui.scout ? scoutHtml(ui.scout) : ''}</div>
    </div>`;
  }

  /* One opponent, on an explicit press. Nothing is fetched by hovering and nothing is crawled:
     the index is cached for the device, so a second opponent costs a single request. */
  async function scoutSquad(team) {
    const INDEX_TTL = 7 * 24 * 3600e3, SQUAD_TTL = 24 * 3600e3;
    let index = (WPMATCH.cacheGet('lists.index', INDEX_TTL) || {}).data;
    if (!index || !index.length) { index = await WPMATCH.fetchListIndex(); WPMATCH.cachePut('lists.index', index); }
    const found = WPMATCH.resolveList(team, index);
    if (!found.list) return { error: found.by === 'ambiguous' ? 'ambiguous' : 'no-list', name: team.name };
    const hit = WPMATCH.cacheGet('scout.' + found.list.id, SQUAD_TTL);
    let squad = hit && !hit.stale ? hit.data : null;
    if (!squad) { squad = await WPMATCH.fetchSquad(found.list.id); WPMATCH.cachePut('scout.' + found.list.id, squad); }
    return { listId: found.list.id, name: squad.name || team.name, url: squad.url,
             at: (hit && hit.at) || Date.now(), squad, report: SCOUT.report(squad) };
  }

  /* ---------- the club's copy: one button, and what it last said.
     Nothing syncs by itself. A roster is children's names, so it leaves this device when a coach
     decides it does and not a moment before. */
  function syncBar() {
    const club = syncClub();
    if (!club) return '';
    const m = loadMirror().clubs[club.id] || null;
    const when = m && m.syncedAt ? new Date(m.syncedAt).toLocaleString() : null;
    if (!maySync(club)) {
      return `<div class="film-panel tm-sync"><p class="muted">${T('tm.syncNeedsSignIn')}</p></div>`;
    }
    return `<div class="film-panel tm-sync">
      <div class="tm-sync-head">
        <div><strong>${T('tm.syncTitle', { club: esc(club.name || '') })}</strong>
          <p class="muted">${when ? T('tm.syncLast', { date: esc(when) }) : T('tm.syncNever')}</p></div>
        <button class="btn-primary sm" id="tm-sync" ${ui.busy ? 'disabled' : ''}>${ui.busy ? esc(ui.busy) : T('tm.syncNow')}</button>
      </div>
      <p class="fa-note">${T('tm.syncWhat')}</p>
      ${ui.notice ? `<p class="tm-sync-said">${esc(ui.notice)}</p>` : ''}</div>`;
  }

  /* Teams the club's server has that this device did not make — a colleague's, or this coach's own
     from another device. Read-only on purpose: the copy that may be edited is the one on the
     device that owns it, and two editable copies of a roster is how a child ends up on the wrong
     sheet at a pool. */
  function mirrorList() {
    const club = syncClub();
    if (!club) return '';
    const m = loadMirror().clubs[club.id];
    if (!m || !m.teams || !m.teams.length) return '';
    const mine = new Set(db.teams.map(t => syncStateOf(club.id, t.id)).filter(Boolean).map(x => x.serverId));
    const others = m.teams.filter(t => !mine.has(t.id));
    if (!others.length) return '';
    return `<details class="film-panel tm-mirror"><summary><h3>${T('tm.mirrorTitle', { n: others.length })}</h3></summary>
      <p class="fa-note">${T('tm.mirrorNote')}</p>
      <ul class="tm-mirror-list">${others.map(t => `<li><strong>${esc(t.name)}</strong> <span class="tag">${esc(catLabel(t.category))}</span>
        <span class="muted">${T('tm.nPlayers', { n: t.players })}${t.mine ? '' : ' · ' + T('tm.mirrorTheirs')}</span>
        ${t.mine ? `<button class="btn-ghost xs" data-pull="${esc(t.id)}">${T('tm.pull')}</button>` : ''}</li>`).join('')}</ul></details>`;
  }

  /* ---------- team list */
  function drawTeamList() {
    const cards = db.teams.map(t => {
      const n = (t.players || []).length, last = db.sheets.filter(x => x.teamId === t.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      return `<button class="tm-card" data-team="${esc(t.id)}">
        <strong>${esc(t.name)}</strong><span class="tag">${esc(catLabel(t.category))}</span>
        <span class="muted">${T('tm.nPlayers', { n })}${last ? ' · ' + T('tm.lastSheet', { date: esc(TEAMSHEET.swissDate(last.match && last.match.date)) }) : ''}</span></button>`;
    }).join('');
    return `<div class="dash-head"><div><h1>${T('tm.title')}</h1><p class="dash-sub">${T('tm.sub')}</p></div></div>
      ${tabs()}
      <div class="tm-actions"><button class="btn-primary sm" id="tm-new-team">${T('tm.newTeam')}</button></div>
      ${syncBar()}
      ${cards ? `<div class="tm-grid">${cards}</div>` : `<div class="film-panel"><p class="muted">${T('tm.noTeams')}</p></div>`}
      ${mirrorList()}`;
  }
  const tabs = () => `<div class="tm-tabs">
      <button class="phase-btn ${ui.tab === 'teams' ? 'active' : ''}" data-tab="teams">${T('tm.tabTeams')}</button>
      <button class="phase-btn ${ui.tab === 'templates' ? 'active' : ''}" data-tab="templates">${T('tm.tabTemplates')}</button></div>`;

  /* ---------- one team: settings, roster, sheets */
  function drawTeam(t) {
    const rules = t.rules || {}, only = !!(rules.foreigners && rules.foreigners.onlySwiss);
    const tplOptions = allTemplates(db).map(x => `<option value="${esc(x.id)}" ${x.id === (t.templateId || 'sa-2025') ? 'selected' : ''}>${esc(x.builtin ? T('tm.tpl.' + x.id) : x.name)}</option>`).join('');
    const players = roster(db, t);
    const rows = players.map(p => `<tr>
        <td><input type="text" class="tm-cap" data-cap="${esc(p.pid)}" value="${esc(p.cap)}" inputmode="numeric" maxlength="2" aria-label="${T('tm.capNo')}"></td>
        <td>${p.licence ? esc(p.licence) : `<span class="tm-status tm-bad">${T('tm.noLicence')}</span>`}
          <button class="btn-ghost xs tm-inf" data-pinfo="${esc(p.pid)}" aria-label="${T('sc.playerFigures')}" title="${T('sc.playerFigures')}">ⓘ</button></td>
        <td><input type="text" data-pname="${esc(p.pid)}" value="${esc(p.name)}" aria-label="${T('tm.surname')}">${p.nameGuessed ? `<span class="tm-guess" title="${T('tm.nameGuessedTip')}">?</span>` : ''}</td>
        <td><input type="text" data-pfirst="${esc(p.pid)}" value="${esc(p.firstName)}" aria-label="${T('tm.firstName')}"></td>
        <td>${esc(p.birthYear) || '—'}</td>
        <td>${statusBadge(p.status)}</td>
        <td><label class="fa-check"><input type="checkbox" data-pgk="${esc(p.pid)}" ${p.gk ? 'checked' : ''}> GK</label></td>
        <td><button class="btn-ghost xs" data-premove="${esc(p.pid)}" title="${T('tm.removeFromTeam')}">✕</button></td></tr>`).join('');
    const sheets = db.sheets.filter(x => x.teamId === t.id).sort((a, b) => (b.match.date || '').localeCompare(a.match.date || ''));
    return `<div class="tm-crumbs"><button class="btn-ghost sm" id="tm-back">◀ ${T('tm.allTeams')}</button></div>
      <div class="dash-head"><div><h1>${esc(t.name)}</h1><p class="dash-sub">${esc(catLabel(t.category))}</p></div></div>

      <details class="film-panel" ${players.length ? '' : 'open'}><summary><h3>${T('tm.settings')}</h3></summary>
        <div class="tm-form">
          <label>${T('tm.teamName')}<input type="text" id="tm-name" value="${esc(t.name)}" maxlength="60"></label>
          <label>${T('tm.category')}<select id="tm-cat">${CATEGORY_ORDER.map(c => `<option value="${c}" ${c === t.category ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('')}</select></label>
          <label>${T('tm.club')}<input type="text" id="tm-club" value="${esc(t.club)}" maxlength="60"></label>
          <label>${T('tm.leagueOnSheet')}<input type="text" id="tm-league" value="${esc(t.leagueLabel)}" maxlength="60" placeholder="${T('tm.leagueOnSheetPh')}"></label>
          <label>${T('tm.template')}<select id="tm-tpl">${tplOptions}</select></label>
          <label>${T('tm.coach')}<input type="text" id="tm-coach" value="${esc((t.staff || {}).coach)}" maxlength="60"></label>
          <label>${T('tm.assistant1')}<input type="text" id="tm-a1" value="${esc((t.staff || {}).assistant1)}" maxlength="60"></label>
          <label>${T('tm.assistant2')}<input type="text" id="tm-a2" value="${esc((t.staff || {}).assistant2)}" maxlength="60"></label>
        </div>
        <div class="tm-special">
          <label class="fa-check"><input type="checkbox" id="tm-onlyswiss" ${only ? 'checked' : ''}> ${T('tm.onlySwiss')}</label>
          <p class="fa-note">${T('tm.onlySwissNote')}</p>
        </div>
        <div class="tm-wpm">${t.wpmatch ? `${T('tm.linkedTo', { name: esc(t.wpmatch.name) })} <button class="btn-ghost xs" id="tm-unlink">${T('tm.unlink')}</button>`
          : `<input type="text" id="tm-wpm-q" placeholder="${T('tm.findOnWpmatchPh')}"> <button class="btn-ghost sm" id="tm-wpm-search">${T('tm.findOnWpmatch')}</button><div id="tm-wpm-hits"></div>`}</div>
        <div class="tm-actions"><button class="btn-primary sm" id="tm-save-team">${T('tm.saveTeam')}</button>
          <button class="btn-ghost sm danger" id="tm-delete-team">${T('tm.deleteTeam')}</button></div>
      </details>

      <div class="film-panel tm-ours">
        <h3>${T('sc.ourFigures')} ${t.wpmatch ? `<span class="rightbar-hint">${esc(t.wpmatch.name)}</span>` : ''}</h3>
        <p class="fa-note">${T('sc.ourFiguresNote')}</p>
        ${t.wpmatch ? `<button class="btn-ghost sm" id="tm-ours" ${ui.busy ? 'disabled' : ''}>${ui.ours ? T('sc.refresh') : T('sc.showFigures')}</button>`
          : `<p class="muted">${T('sc.linkFirst')}</p>`}
        <div id="tm-ours-out">${ui.ours ? scoutHtml(ui.ours, { own: true }) : ''}</div>
      </div>

      <div class="film-panel tm-scout-panel">
        <h3>${T('sc.scoutTitle')}</h3>
        <p class="fa-note">${T('sc.scoutNote')}</p>
        ${scoutHostHtml(true)}
      </div>

      <div class="film-panel">
        <h3>${T('tm.roster')} <span class="rightbar-hint">${T('tm.nPlayers', { n: players.length })}</span></h3>
        <div class="tm-pinfo" id="tm-pinfo-roster"></div>
        <div class="tm-add">
          <label class="tm-lic">${T('tm.addByLicence')}<textarea id="tm-lic" rows="2" placeholder="${T('tm.addByLicencePh')}"></textarea></label>
          <div class="tm-add-btns">
            <button class="btn-primary sm" id="tm-lookup" ${ui.busy ? 'disabled' : ''}>${T('tm.lookup')}</button>
            ${t.wpmatch ? `<button class="btn-ghost sm" id="tm-crawl" ${ui.busy ? 'disabled' : ''}>${T('tm.findTeamPlayers')}</button>` : ''}
            <button class="btn-ghost sm" id="tm-manual">${T('tm.addManually')}</button>
          </div>
        </div>
        ${ui.progress ? `<p class="muted tm-progress">${esc(ui.progress)}</p>` : ''}
        ${ui.notice ? `<p class="fa-note tm-notice">${ui.notice}</p>` : ''}
        ${players.length ? `<div class="dev-table-wrap"><table class="dev-table tm-roster"><thead><tr>
            <th>${T('tm.capNo')}</th><th>${T('tm.licenceNo')}</th><th>${T('tm.surname')}</th><th>${T('tm.firstName')}</th><th>${T('tm.born')}</th><th>${T('tm.eligibility')}</th><th>GK</th><th></th>
          </tr></thead><tbody>${rows}</tbody></table></div>
          <p class="fa-note">${T('tm.rosterNote')}</p>` : `<p class="muted">${T('tm.emptyRoster')}</p>`}
      </div>

      <div class="film-panel">
        <h3>${T('tm.sheets')}</h3>
        <div class="tm-actions"><button class="btn-primary" id="tm-new-sheet" ${players.length ? '' : 'disabled'}>${T('tm.newSheet')}</button></div>
        ${sheets.length ? `<div class="tm-sheet-list">${sheets.map(x => `<div class="tm-sheet-item">
            <button class="btn-ghost sm" data-sheet="${esc(x.id)}"><strong>${esc(TEAMSHEET.swissDate(x.match.date)) || T('tm.noDate')}</strong> ${x.match.opponent ? '· ' + esc(x.match.opponent) : ''}</button>
            <button class="btn-ghost xs" data-copysheet="${esc(x.id)}" title="${T('tm.copyForNextTip')}">${T('tm.copyForNext')}</button>
            <button class="btn-ghost xs" data-delsheet="${esc(x.id)}" title="${T('tm.deleteSheet')}">✕</button></div>`).join('')}</div>`
          : `<p class="muted">${T('tm.noSheets')}</p>`}
      </div>`;
  }

  /* ---------- the sheet builder */
  function drawSheet(s) {
    const t = db.teams.find(x => x.id === s.teamId) || {};
    const tpl = templateById(db, s.templateId);
    while (s.rows.length < tpl.rows) s.rows.push(null);
    const players = roster(db, t);
    const lineup = lineupOf(db, s).slice(0, tpl.rows);
    const filled = lineup.filter(Boolean);
    const staff = Object.assign({}, t.staff || {}, s.staff || {});
    const result = ELIGIBILITY.check(t, filled, { date: s.match.date });
    const used = new Set(s.rows.slice(0, tpl.rows).filter(r => r && r.pid).map(r => r.pid));
    const counts = availabilityCounts(s, players);
    const youth = ELIGIBILITY.CATEGORIES[t.category] && ELIGIBILITY.CATEGORIES[t.category].kind === 'youth';

    const opt = (p, row) => `<option value="${esc(p.pid)}" ${row && row.pid === p.pid ? 'selected' : ''} ${used.has(p.pid) && !(row && row.pid === p.pid) ? 'disabled' : ''}>` +
      `${esc([p.name, p.firstName].filter(Boolean).join(' '))}${p.licence ? ' · ' + esc(p.licence) : ''}${p.birthYear ? ' · ' + esc(p.birthYear) : ''}</option>`;
    const rowHtml = s.rows.slice(0, tpl.rows).map((r, i) => `<tr class="${r && r.pid ? '' : 'tm-empty'}">
        <td class="tm-capcell">${i + 1}</td>
        <td><select data-row="${i}"><option value="">—</option>${players.map(p => opt(p, r)).join('')}</select></td>
        <td><label class="fa-check"><input type="checkbox" data-rowgk="${i}" ${r && r.gk ? 'checked' : ''} ${r && r.pid ? '' : 'disabled'}> GK</label></td>
        <td><label class="fa-check"><input type="radio" name="tm-captain" data-rowcap="${i}" ${r && r.captain ? 'checked' : ''} ${r && r.pid ? '' : 'disabled'}> C</label></td>
        ${youth ? `<td><label class="fa-check" title="${T('tm.youngerTip')}"><input type="checkbox" data-rowyoung="${i}" ${r && r.younger ? 'checked' : ''} ${r && r.pid ? '' : 'disabled'}> ${T('tm.younger')}</label></td>` : ''}
        <td class="tm-move"><button class="btn-ghost xs" data-up="${i}" ${i ? '' : 'disabled'} aria-label="${T('tm.moveUp')}">↑</button><button class="btn-ghost xs" data-down="${i}" ${i < tpl.rows - 1 ? '' : 'disabled'} aria-label="${T('tm.moveDown')}">↓</button></td>
      </tr>`).join('');

    const name = lic => { const p = filled.find(x => x.licence === lic || x.name === lic); return p ? [p.firstName, p.name].filter(Boolean).join(' ') : lic; };
    const findings = result.findings.map(f => `<li class="tm-f tm-f-${f.severity}">
        <span class="tm-f-sev">${T('tm.sev.' + f.severity)}</span> ${T('tm.f.' + f.code, Object.assign({}, f.vars, { names: esc(f.players.map(name).join(', ')) }))}
        ${f.article ? `<span class="tm-f-art">${esc(f.article)}</span>` : ''}</li>`).join('');

    const tplOptions = allTemplates(db).map(x => `<option value="${esc(x.id)}" ${x.id === tpl.id ? 'selected' : ''}>${esc(x.builtin ? T('tm.tpl.' + x.id) : x.name)}</option>`).join('');
    const model = TEAMSHEET.buildModel(tpl, { club: t.club, team: { name: t.leagueLabel || catLabel(t.category), staff }, match: s.match, lineup, staff });

    return `<div class="tm-crumbs"><button class="btn-ghost sm" id="tm-sheet-back">◀ ${esc(t.name || T('tm.allTeams'))}</button></div>
      <div class="dash-head"><div><h1>${T('tm.sheetTitle')}</h1><p class="dash-sub">${esc(t.name)} · ${T('tm.season', { season: esc(result.season.label) })}</p></div></div>

      <div class="film-panel">
        <h3>${T('tm.match')}</h3>
        <div class="tm-form">
          <label>${T('tm.date')}<input type="date" id="tm-m-date" value="${esc(s.match.date)}"></label>
          <label>${T('tm.league')}<input type="text" id="tm-m-league" value="${esc(s.match.league)}" placeholder="${esc(t.leagueLabel || catLabel(t.category))}" maxlength="60"></label>
          <label>${T('tm.opponent')}<input type="text" id="tm-m-opp" value="${esc(s.match.opponent)}" maxlength="60"></label>
          <label>${T('tm.template')}<select id="tm-s-tpl">${tplOptions}</select></label>
          <label>${T('tm.referee')}<input type="text" id="tm-s-ref" value="${esc(staff.referee)}" maxlength="60"></label>
        </div>
        ${t.wpmatch ? `<button class="btn-ghost sm" id="tm-fixtures" ${ui.busy ? 'disabled' : ''}>${T('tm.pickFixture')}</button><div id="tm-fixture-list"></div>` : ''}
        ${scoutHostHtml(false)}
      </div>

      <div class="film-panel tm-avail">
        <h3>${T('tm.availability')} <span class="rightbar-hint">${T('tm.availabilityCounts', counts)}</span></h3>
        <p class="fa-note">${T('tm.availabilityNote')}</p>
        <div class="tm-pinfo" id="tm-pinfo-avail">${ui.pinfo ? '' : ''}</div>
        <div class="tm-avail-grid">${players.map(p => {
          const st = availOf(s, p.pid);
          return `<div class="tm-avail-row ${st}"><span class="tm-avail-name">${esc([p.name, p.firstName].filter(Boolean).join(' '))}</span>
            <button class="btn-ghost xs tm-inf" data-pinfo="${esc(p.pid)}" aria-label="${T('sc.playerFigures')}" title="${T('sc.playerFigures')}">ⓘ</button>
            <span class="tm-avail-btns">${[['in', '✓'], ['out', '✕'], ['unknown', '?']].map(([v, sym]) =>
              `<button class="btn-ghost xs ${st === v ? 'on' : ''}" data-avail="${esc(p.pid)}" data-availstate="${v}" title="${T('tm.avail.' + v)}" aria-pressed="${st === v}">${sym}</button>`).join('')}</span></div>`;
        }).join('') || `<p class="muted">${T('tm.noPlayersYet')}</p>`}</div>
        <div class="tm-actions">
          <button class="btn-ghost sm" id="tm-avail-fill" ${counts.in ? '' : 'disabled'}>${T('tm.buildFromAvailable')}</button>
          <button class="btn-ghost sm" id="tm-avail-clear" ${counts.in || counts.out ? '' : 'disabled'}>${T('tm.availabilityReset')}</button>
          ${ctx.inviteHtml ? `<button class="btn-ghost sm" id="tm-invite">${T('tm.inviteToApp')}</button>` : ''}
        </div>
      </div>

      ${ctx.inviteHtml ? `<div class="modal-backdrop tm-modal" id="tm-invite-modal" hidden><div class="modal modal-sm">
        <div class="modal-head"><h3>${T('tm.inviteToApp')}</h3><span class="spacer"></span><button class="modal-x" id="tm-invite-x">✕</button></div>
        <div class="modal-body">${ctx.inviteHtml()}<p class="fa-note">${T('tm.inviteNote')}</p></div>
      </div></div>` : ''}

      <div class="tm-builder">
        <div class="film-panel">
          <h3>${T('tm.lineup')} <span class="rightbar-hint">${T('tm.lineupHint', { n: filled.length, max: tpl.rows })}</span></h3>
          <div class="tm-actions"><button class="btn-ghost sm" id="tm-auto">${T('tm.autoFill')}</button><button class="btn-ghost sm" id="tm-clear">${T('tm.clear')}</button></div>
          <div class="dev-table-wrap"><table class="dev-table tm-lineup"><tbody>${rowHtml}</tbody></table></div>
          <p class="fa-note">${T('tm.capOrderNote')}</p>
        </div>
        <div class="film-panel tm-check">
          <h3>${T('tm.check')}</h3>
          ${result.findings.length ? `<ul class="tm-findings">${findings}</ul>` : `<p class="tm-f tm-f-ok">${T('tm.allClear')}</p>`}
          <p class="fa-note">${T('tm.checkNote')}</p>
        </div>
      </div>

      <div class="film-panel">
        <h3>${T('tm.preview')}</h3>
        ${model.official ? '' : `<p class="fa-note">${T('tm.unofficialLangs')}</p>`}
        <div class="tm-preview">${SHEETDOC.toHtml(model)}</div>
        <div class="tm-actions tm-downloads">
          <button class="btn-primary" id="tm-dl-docx">${T('tm.downloadWord')}</button>
          <button class="btn-primary" id="tm-dl-pdf">${T('tm.downloadPdf')}</button>
          <button class="btn-ghost" id="tm-print">${T('tm.print')}</button>
        </div>
        <p class="fa-note" id="tm-dl-note"></p>
      </div>`;
  }

  /* ---------- templates */
  function drawTemplates() {
    const list = allTemplates(db).map(x => `<div class="tm-sheet-item">
        <strong>${esc(x.builtin ? T('tm.tpl.' + x.id) : x.name)}</strong>
        <span class="muted">${T('tm.tplSummary', { rows: x.rows, cols: x.columns.length, langs: x.langs.filter(Boolean).join('/').toUpperCase() })}</span>
        <button class="btn-ghost xs" data-tplcopy="${esc(x.id)}">${T('tm.duplicate')}</button>
        ${x.builtin ? '' : `<button class="btn-ghost xs" data-tpledit="${esc(x.id)}">${T('tm.edit')}</button><button class="btn-ghost xs" data-tpldel="${esc(x.id)}" title="${T('tm.deleteTemplate')}">✕</button>`}
      </div>`).join('');
    return `<div class="dash-head"><div><h1>${T('tm.title')}</h1><p class="dash-sub">${T('tm.templatesSub')}</p></div></div>
      ${tabs()}<div class="film-panel">${list}<p class="fa-note">${T('tm.templatesNote')}</p></div>`;
  }

  function drawTemplateEditor() {
    const raw = db.templates.find(x => x.id === ui.tplId);
    if (!raw) { ui.tplId = null; return drawTemplates(); }
    const tpl = TEAMSHEET.normalizeTemplate(raw);
    const langOpt = (sel, allowNone) => (allowNone ? `<option value="" ${!sel ? 'selected' : ''}>—</option>` : '') +
      ['de', 'fr', 'it', 'en'].map(l => `<option value="${l}" ${l === sel ? 'selected' : ''}>${l.toUpperCase()}</option>`).join('');
    const inCols = tpl.columns.map(c => c.key);
    const colRows = TEAMSHEET.COLUMN_KEYS.map(k => {
      const on = inCols.includes(k), c = tpl.columns.find(x => x.key === k);
      return `<tr><td><label class="fa-check"><input type="checkbox" data-tcol="${k}" ${on ? 'checked' : ''} ${k === 'licence' ? 'disabled' : ''}> ${T('tm.col.' + k)}</label></td>
        <td>${on ? `<input type="number" min="3" max="80" data-tcolw="${k}" value="${Math.round(c.w * 100)}" aria-label="${T('tm.width')}"> %` : ''}</td>
        <td>${on ? `<button class="btn-ghost xs" data-tcolup="${k}" aria-label="${T('tm.moveUp')}">↑</button><button class="btn-ghost xs" data-tcoldown="${k}" aria-label="${T('tm.moveDown')}">↓</button>` : ''}</td></tr>`;
    }).join('');
    const sample = { club: T('tm.sampleClub'), team: { name: 'U14', staff: { coach: T('tm.sampleCoach') } }, match: { date: '2026-10-04', league: 'U14' },
      lineup: [{ licence: '50001', name: 'Keller', firstName: 'Nina', birthYear: '2013', gk: true }, { licence: '50002', name: 'Brunner', firstName: 'Jonas', birthYear: '2014', captain: true }] };
    return `<div class="tm-crumbs"><button class="btn-ghost sm" id="tm-tpl-back">◀ ${T('tm.tabTemplates')}</button></div>
      <div class="dash-head"><div><h1>${esc(tpl.name)}</h1></div></div>
      <div class="tm-builder">
        <div class="film-panel">
          <div class="tm-form">
            <label>${T('tm.templateName')}<input type="text" id="tt-name" value="${esc(tpl.name)}" maxlength="80"></label>
            <label>${T('tm.sheetHeading')}<input type="text" id="tt-title" value="${esc(tpl.title == null ? '' : tpl.title)}" maxlength="80" placeholder="${esc(TEAMSHEET.LABELS.title[tpl.langs[0]] || '')}"></label>
            <label>${T('tm.rows')}<input type="number" id="tt-rows" min="1" max="30" value="${tpl.rows}"></label>
            <label>${T('tm.lang1')}<select id="tt-l1">${langOpt(tpl.langs[0])}</select></label>
            <label>${T('tm.lang2')}<select id="tt-l2">${langOpt(tpl.langs[1], true)}</select></label>
          </div>
          <h4>${T('tm.headerFields')}</h4>
          <div class="tm-checks">${TEAMSHEET.HEADER_KEYS.map(k => `<label class="fa-check"><input type="checkbox" data-thead="${k}" ${tpl.header.includes(k) ? 'checked' : ''}> ${T('tm.hdr.' + k)}</label>`).join('')}</div>
          <h4>${T('tm.columns')}</h4>
          <table class="dev-table"><tbody>${colRows}</tbody></table>
          <h4>${T('tm.staffRows')}</h4>
          <div class="tm-checks">${TEAMSHEET.STAFF_KEYS.map(k => `<label class="fa-check"><input type="checkbox" data-tstaff="${k}" ${tpl.staff.includes(k) ? 'checked' : ''}> ${T('tm.staff.' + k)}</label>`).join('')}</div>
          <label class="fa-check"><input type="checkbox" id="tt-note" ${tpl.note ? 'checked' : ''}> ${T('tm.includeNote')}</label>
        </div>
        <div class="film-panel"><h3>${T('tm.preview')}</h3>
          ${TEAMSHEET.buildModel(tpl, sample).official ? '' : `<p class="fa-note">${T('tm.unofficialLangs')}</p>`}
          <div class="tm-preview">${SHEETDOC.toHtml(TEAMSHEET.buildModel(tpl, sample))}</div></div>
      </div>`;
  }

  /* ------------------------------------------------------------- behaviour */
  const $ = sel => root.querySelector(sel);
  const $$ = sel => Array.from(root.querySelectorAll(sel));
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };

  function wire() {
    $$('[data-tab]').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; draw(); });
    $$('[data-pull]').forEach(b => b.onclick = async () => {
      if (ui.busy) return;
      ui.busy = T('tm.pulling'); ui.notice = ''; draw();
      const r = await pullTeam(b.dataset.pull);
      ui.busy = '';
      ui.notice = r.ok ? T('tm.pulled', { n: r.players }) : T('tm.pullFailed', { why: syncWhy(r) });
      draw();
    });
    on('#tm-sync', 'click', async () => {
      const club = syncClub();
      if (!club || ui.busy) return;
      ui.busy = T('tm.syncing'); ui.notice = ''; draw();
      const r = await syncAll(club.id, name => { ui.busy = T('tm.syncingTeam', { name }); draw(); });
      ui.busy = '';
      const said = [];
      if (r.sent) said.push(T('tm.syncSent', { n: r.sent }));
      if (r.failed) said.push(T('tm.syncFailed', { n: r.failed, why: syncWhy(r.errors[0]) }));
      if (r.removedAtClub.length) said.push(T('tm.syncRemoved', { n: r.removedAtClub.length }));
      r.conflicts.forEach(c => said.push(c.team
        ? T('tm.syncConflictNamed', { players: c.players.join(', '), team: c.team })
        : T('tm.syncConflict', { players: c.players.join(', ') })));
      ui.notice = said.join(' · ') || T('tm.syncNothing');
      draw();
    });
    on('#tm-new-team', 'click', () => {
      const t = { id: uid('t'), name: T('tm.newTeamName'), category: 'U14', club: '', leagueLabel: '', templateId: 'sa-2025', staff: {}, rules: {}, players: [], wpmatch: null, season: thisSeason() };
      db.teams.push(t); persist(); ui.teamId = t.id; ui.notice = ''; draw();
    });
    $$('[data-team]').forEach(b => b.onclick = () => { ui.teamId = b.dataset.team; ui.notice = ''; ui.progress = ''; draw(); });
    const t = team(), s = sheet();
    if (s) return wireSheet(s);
    if (ui.tplId) return wireTemplateEditor();
    if (t) return wireTeam(t);
    $$('[data-tplcopy]').forEach(b => b.onclick = () => {
      const src = allTemplates(db).find(x => x.id === b.dataset.tplcopy);
      const copy = TEAMSHEET.cloneTemplate(src, uid('tpl'), T('tm.copyOf', { name: src.builtin ? T('tm.tpl.' + src.id) : src.name }));
      db.templates.push(copy); persist(); ui.tplId = copy.id; draw();
    });
    $$('[data-tpledit]').forEach(b => b.onclick = () => { ui.tplId = b.dataset.tpledit; draw(); });
    $$('[data-tpldel]').forEach(b => b.onclick = () => {
      if (!confirm(T('tm.confirmDeleteTemplate'))) return;
      db.templates = db.templates.filter(x => x.id !== b.dataset.tpldel);
      db.teams.forEach(x => { if (x.templateId === b.dataset.tpldel) x.templateId = 'sa-2025'; });
      persist(); draw();
    });
  }

  function readTeamForm(t) {
    const v = id => ($(id) ? $(id).value.trim() : '');
    t.name = v('#tm-name') || t.name; t.category = v('#tm-cat') || t.category; t.club = v('#tm-club'); t.leagueLabel = v('#tm-league');
    t.templateId = v('#tm-tpl') || 'sa-2025';
    t.staff = Object.assign({}, t.staff, { coach: v('#tm-coach'), assistant1: v('#tm-a1'), assistant2: v('#tm-a2') });
    t.rules = Object.assign({}, t.rules);
    if ($('#tm-onlyswiss') && $('#tm-onlyswiss').checked) t.rules.foreigners = { onlySwiss: true };
    else delete t.rules.foreigners;
  }

  /* The settings form is read back whenever the coach leaves it, not only when they press Save.
     Before this, typing a team name and then pressing "All teams" or "Find team players" threw the
     name away without a word — which made naming a team feel impossible, because it was. */
  const keepTeamForm = t => { if ($('#tm-name')) { readTeamForm(t); persist(); } };

  /* Both screens carry these: the team page has the roster and the figures button, the sheet has
     the availability list. Wiring them in one place is why an ⓘ behaves the same on both. */
  function wireScout(t, s) {
    on('#tm-scout', 'click', async () => {
      const out = $('#tm-scout-out');
      const box = $('#tm-scout-who');
      const who = TEAMSYNC.clean((box && box.value) || (s && s.match && s.match.opponent) || '', 60);
      if (box) ui.scoutWho = who;
      /* Without an opponent this used to search our OWN team's name and hand back our own squad
         list, which looks like a bug in wpmatch rather than a missing field. Say what is needed. */
      if (!who) { out.innerHTML = `<p class="muted">${T('sc.needOpponent')}</p>`; return; }
      out.innerHTML = `<p class="muted">${T('sc.looking')}</p>`;
      try {
        const hits = await WPMATCH.searchTeams(who);
        const them = hits.filter(x => !t.wpmatch || x.id !== t.wpmatch.id);
        if (!them.length) { out.innerHTML = `<p class="muted">${T('sc.noSquad', { name: esc(who) })}</p>`; return; }
        if (them.length > 1) {
          out.innerHTML = `<p class="muted">${T('sc.whichSquad')}</p>` + them.slice(0, 8).map(x => `<button class="btn-ghost sm" data-scout-team="${esc(String(x.id))}">${esc(x.name)}</button>`).join('');
          out.querySelectorAll('[data-scout-team]').forEach(b => b.onclick = () => runScout(them.find(x => String(x.id) === b.dataset.scoutTeam)));
          return;
        }
        await runScout(them[0]);
      } catch (e) { out.innerHTML = `<p class="muted">${T('tm.wpmatchDown')}</p>`; }
    });
    async function runScout(team) {
      const out = $('#tm-scout-out');
      out.innerHTML = `<p class="muted">${T('sc.reading', { name: esc(team.name) })}</p>`;
      try {
        const sc = await scoutSquad(team);
        if (sc.error) { out.innerHTML = `<p class="muted">${T(sc.error === 'ambiguous' ? 'sc.ambiguous' : 'sc.noList', { name: esc(sc.name) })}</p>`; return; }
        ui.scout = sc; draw();
      } catch (e) { out.innerHTML = `<p class="muted">${T('tm.wpmatchDown')}</p>`; }
    }
    on('#tm-scout-x', 'click', () => { ui.scout = null; ui.ours = null; draw(); });
    on('#tm-scout-keep', 'click', () => {
      if (!ui.scout) return;
      const kept = saveScout(ui.scout, ($('#tm-scout-label') && $('#tm-scout-label').value) || '');
      ui.scout = Object.assign({}, ui.scout, { label: kept.label });
      toast(T('sc.kept', { name: kept.label || kept.name }));
      draw();
    });
    $$('[data-scout-open]').forEach(b => b.onclick = () => {
      const kept = loadScouts()[b.dataset.scoutOpen];
      if (!kept) return;
      ui.scout = { listId: kept.listId, name: kept.label || kept.name, url: kept.url, at: kept.at, label: kept.label, squad: kept.squad, report: SCOUT.report(kept.squad) };
      draw();
    });

  }

  function wireOurFigures(t) {
    /* our own squad, from the same source and the same judging as an opponent's */
    on('#tm-ours', 'click', async () => {
      const out = $('#tm-ours-out');
      out.innerHTML = `<p class="muted">${T('sc.looking')}</p>`;
      try {
        const r = await ourSquad(t);
        if (r.error) { out.innerHTML = `<p class="muted">${T(r.error === 'not-linked' ? 'sc.linkFirst' : 'sc.noList', { name: esc(t.name) })}</p>`; return; }
        ui.ours = r; draw();
      } catch (e) { out.innerHTML = `<p class="muted">${T('tm.wpmatchDown')}</p>`; }
    });
    /* a player's own line, in a resting panel under the heading — never a card over the rows,
       and reachable by mouse, by keyboard and by tapping, because this is used on a phone */
    $$('[data-pinfo]').forEach(b => {
      const show = async () => {
        const host = b.closest('.tm-avail') ? $('#tm-pinfo-avail') : $('#tm-pinfo-roster');
        if (!host) return;
        const p2 = db.players[b.dataset.pinfo];
        const squad = (ui.ours && ui.ours.squad) || null;
        const r = playerLine(squad, p2);
        const who = esc([p2 && p2.name, p2 && p2.firstName].filter(Boolean).join(' '));
        if (r.line) {
          const L = r.line;
          host.innerHTML = `<div class="tm-pinfo-card"><strong>${who}</strong> — ${T('sc.playerLine', {
            goals: L.goals, matches: L.played, six: L.goalon, extra: L.goalextraplayer, pen: L.penaltygoals, excl: L.exclusionfoul })}
            ${L.thin ? ` <span class="muted">${T('sc.thinNote')}</span>` : ''}
            <span class="muted">${T('sc.inSquad', { name: esc((ui.ours && ui.ours.name) || '') })}</span></div>`;
        } else {
          host.innerHTML = `<div class="tm-pinfo-card"><strong>${who}</strong> — <span class="muted">${T('sc.why.' + r.why)}</span></div>`;
        }
      };
      b.onmouseenter = show; b.onfocus = show; b.onclick = e => { e.preventDefault(); show(); };
    });
  }

  function wireTeam(t) {
    wireOurFigures(t);
    wireScout(t, null);
    on('#tm-back', 'click', () => { keepTeamForm(t); ui.teamId = null; ui.notice = ''; ui.progress = ''; draw(); });
    // and as soon as a field is left, so a name survives anything else that redraws the screen
    $$('#tm-name, #tm-cat, #tm-club, #tm-league, #tm-tpl, #tm-coach, #tm-a1, #tm-a2').forEach(el => el.addEventListener('change', () => keepTeamForm(t)));
    on('#tm-save-team', 'click', () => { readTeamForm(t); persist(); toast(T('tm.teamSaved')); draw(); });
    on('#tm-delete-team', 'click', async () => {
      if (!confirm(T('tm.confirmDeleteTeam', { name: t.name }))) return;
      const atClub = await deleteAtClub(t);
      if (!atClub.ok) { toast(T('tm.deleteNotAtClub', { why: syncWhy(atClub) })); return; }
      db.teams = db.teams.filter(x => x.id !== t.id); db.sheets = db.sheets.filter(x => x.teamId !== t.id);
      persist(); ui.teamId = null; draw();
    });
    on('#tm-unlink', 'click', () => { t.wpmatch = null; persist(); draw(); });
    on('#tm-wpm-search', 'click', async () => {
      const q = $('#tm-wpm-q').value.trim(), out = $('#tm-wpm-hits');
      if (q.length < 2) return;
      out.innerHTML = `<p class="muted">${T('tm.searching')}</p>`;
      try {
        const hits = await WPMATCH.searchTeams(q);
        out.innerHTML = hits.length ? hits.slice(0, 12).map(h => `<button class="btn-ghost sm" data-wpmteam="${h.id}" data-wpmname="${esc(h.name)}">${esc(h.name)}</button>`).join('')
          : `<p class="muted">${T('tm.noWpmatchTeam')}</p>`;
        out.querySelectorAll('[data-wpmteam]').forEach(b => b.onclick = () => { readTeamForm(t); t.wpmatch = { id: +b.dataset.wpmteam, name: b.dataset.wpmname }; persist(); draw(); });
      } catch (e) { out.innerHTML = `<p class="muted">${T('tm.wpmatchDown')}</p>`; }
    });

    on('#tm-lookup', 'click', async () => {
      const lics = ($('#tm-lic').value.match(/\d{3,6}/g) || []);
      if (!lics.length) { toast(T('tm.enterLicences')); return; }
      ui.busy = 'lookup'; ui.progress = T('tm.lookingUp', { n: lics.length }); ui.notice = ''; draw();
      try {
        const r = await WPMATCH.lookupLicences(lics);
        const found = WPMATCH.dedupePlayers(r.players);
        const ids = upsertPlayers(db, found, 'wpmatch');
        t.players = Array.from(new Set((t.players || []).concat(ids)));
        persist();
        const inactive = found.filter(p => ELIGIBILITY.statusOf(p.status) === 'inactive').length;
        ui.notice = [T('tm.addedN', { n: ids.length }),
          r.missing.length ? T('tm.notFound', { list: esc(r.missing.join(', ')) }) : '',
          inactive ? T('tm.inactiveFound', { n: inactive }) : ''].filter(Boolean).join(' ');
      } catch (e) { ui.notice = T('tm.wpmatchDown'); }
      ui.busy = ''; ui.progress = ''; draw();
    });
    on('#tm-crawl', 'click', async () => {
      keepTeamForm(t);
      ui.busy = 'crawl'; ui.notice = ''; ui.progress = T('tm.crawlStart'); draw();
      try {
        const found = await WPMATCH.fetchTeamPlayers(t.wpmatch.id, { onProgress: (p, n) => { ui.progress = T('tm.crawlProgress', { page: p, pages: n }); const el = $('.tm-progress'); if (el) el.textContent = ui.progress; } });
        const ids = upsertPlayers(db, found, 'wpmatch');
        t.players = Array.from(new Set((t.players || []).concat(ids)));
        persist(); ui.notice = T('tm.crawlDone', { n: found.length, team: esc(t.wpmatch.name) });
      } catch (e) { ui.notice = T('tm.wpmatchDown'); }
      ui.busy = ''; ui.progress = ''; draw();
    });
    on('#tm-manual', 'click', () => {
      const ids = upsertPlayers(db, [{ pid: uid('m'), name: T('tm.newPlayerName'), firstName: '' }], 'manual');
      t.players = (t.players || []).concat(ids); persist(); draw();
    });
    const edit = (attr, field) => $$(`[${attr}]`).forEach(inp => inp.onchange = () => {
      const p = db.players[inp.getAttribute(attr)]; if (!p) return;
      p[field] = field === 'gk' ? inp.checked : inp.value.trim();
      if (field === 'name' || field === 'firstName') { p.edited = true; p.nameGuessed = false; }
      persist();
    });
    edit('data-pname', 'name'); edit('data-pfirst', 'firstName'); edit('data-cap', 'cap'); edit('data-pgk', 'gk');
    $$('[data-premove]').forEach(b => b.onclick = async () => {
      const pid = b.dataset.premove, club = syncClub();
      const serverPid = club ? serverIdOf(club.id, t.id, pid) : null;
      t.players = (t.players || []).filter(x => x !== pid); persist(); draw();
      const r = await removeAtClub(t, serverPid);
      if (!r.ok) toast(T('tm.removeNotAtClub', { why: syncWhy(r) }));
      else if (!r.skipped) toast(T('tm.removedAtClub'));
    });

    on('#tm-new-sheet', 'click', () => {
      const tpl = templateById(db, t.templateId);
      const rows = autoOrder(roster(db, t).slice(0, tpl.rows), tpl.rows, t.category).map(p => (p ? { pid: p.pid, gk: !!p.gk, captain: false, younger: false } : null));
      const s = { id: uid('s'), teamId: t.id, templateId: tpl.id, match: { date: new Date().toISOString().slice(0, 10), league: '', opponent: '' }, staff: {}, rows, createdAt: Date.now(), updatedAt: Date.now() };
      db.sheets.push(s); persist(); ui.sheetId = s.id; draw();
    });
    $$('[data-sheet]').forEach(b => b.onclick = () => { ui.sheetId = b.dataset.sheet; draw(); });
    $$('[data-copysheet]').forEach(b => b.onclick = () => {
      const src = db.sheets.find(x => x.id === b.dataset.copysheet); if (!src) return;
      const s = JSON.parse(JSON.stringify(src));
      Object.assign(s, { id: uid('s'), match: { date: '', league: src.match.league, opponent: '' }, createdAt: Date.now(), updatedAt: Date.now() });
      db.sheets.push(s); persist(); ui.sheetId = s.id; draw();
    });
    $$('[data-delsheet]').forEach(b => b.onclick = () => { if (!confirm(T('tm.confirmDeleteSheet'))) return; db.sheets = db.sheets.filter(x => x.id !== b.dataset.delsheet); persist(); draw(); });
  }

  function wireSheet(s) {
    const t = db.teams.find(x => x.id === s.teamId) || {};
    const touch = () => { s.updatedAt = Date.now(); persist(); draw(); };
    on('#tm-sheet-back', 'click', () => { ui.sheetId = null; draw(); });
    const field = (id, set) => on(id, 'change', e => { set(e.target.value.trim()); touch(); });
    field('#tm-m-date', v => { s.match.date = v; });
    field('#tm-m-league', v => { s.match.league = v; });
    field('#tm-m-opp', v => { s.match.opponent = v; });
    field('#tm-s-ref', v => { s.staff = Object.assign({}, s.staff, { referee: v }); });
    on('#tm-s-tpl', 'change', e => { s.templateId = e.target.value; touch(); });

    $$('[data-row]').forEach(sel => sel.onchange = () => {
      const i = +sel.dataset.row, pid = sel.value;
      s.rows[i] = pid ? { pid, gk: !!(db.players[pid] && db.players[pid].gk), captain: false, younger: false } : null;
      touch();
    });
    const flag = (attr, key) => $$(`[${attr}]`).forEach(inp => inp.onchange = () => {
      const i = +inp.getAttribute(attr); if (!s.rows[i]) return;
      if (key === 'captain') s.rows.forEach(r => { if (r) r.captain = false; });
      s.rows[i][key] = inp.checked; touch();
    });
    flag('data-rowgk', 'gk'); flag('data-rowcap', 'captain'); flag('data-rowyoung', 'younger');
    const swap = (i, j) => { const tmp = s.rows[i]; s.rows[i] = s.rows[j]; s.rows[j] = tmp; touch(); };
    $$('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; if (i > 0) swap(i, i - 1); });
    $$('[data-down]').forEach(b => b.onclick = () => { const i = +b.dataset.down; if (i < s.rows.length - 1) swap(i, i + 1); });
    on('#tm-auto', 'click', () => {
      const tpl = templateById(db, s.templateId);
      const chosen = s.rows.filter(r => r && r.pid).map(r => Object.assign({}, db.players[r.pid], { gk: r.gk, _row: r }));
      const pool = chosen.length ? chosen : availablePool(s, roster(db, t)).map(p => Object.assign({}, p, { _row: null }));
      s.rows = autoOrder(pool, tpl.rows, t.category).map(p => (p ? { pid: p.pid, gk: !!p.gk, captain: !!(p._row && p._row.captain), younger: !!(p._row && p._row.younger) } : null));
      touch();
    });
    on('#tm-clear', 'click', () => { s.rows = s.rows.map(() => null); touch(); });
    $$('[data-avail]').forEach(b => b.onclick = () => { setAvailability(s, b.dataset.avail, b.dataset.availstate); touch(); });
    on('#tm-avail-clear', 'click', () => { s.availability = {}; touch(); });
    on('#tm-avail-fill', 'click', () => {
      const tpl = templateById(db, s.templateId);
      const pool = availablePool(s, roster(db, t)).map(p => Object.assign({}, p, { _row: null }));
      s.rows = autoOrder(pool, tpl.rows, t.category).map(p => (p ? { pid: p.pid, gk: !!p.gk, captain: false, younger: false } : null));
      touch();
    });
    on('#tm-invite', 'click', () => { const m = $('#tm-invite-modal'); if (m) { m.hidden = false; if (ctx.bindInvite) ctx.bindInvite(m); } });
    on('#tm-invite-x', 'click', () => { const m = $('#tm-invite-modal'); if (m) m.hidden = true; });

    wireOurFigures(t);
    wireScout(t, s);
    on('#tm-fixtures', 'click', async () => {
      const out = $('#tm-fixture-list'); out.innerHTML = `<p class="muted">${T('tm.searching')}</p>`;
      try {
        const fx = await WPMATCH.fetchFixtures({ id: t.wpmatch.id, name: t.wpmatch.name }, { maxPages: 2 });
        const soon = fx.filter(f => f.status !== 'ended' && f.localTime).sort((a, b) => a.localTime.localeCompare(b.localTime)).slice(0, 6);
        out.innerHTML = soon.length ? soon.map(f => {
          const opp = WPMATCH.opponentOf(f, t.wpmatch.id);
          const oppName = opp && opp.opponent ? opp.opponent.name : '';
          return `<button class="btn-ghost sm" data-fx-date="${esc(f.localTime.slice(0, 10))}" data-fx-opp="${esc(oppName)}">${esc(TEAMSHEET.swissDate(f.localTime))} · ${esc(oppName)}</button>`;
        }).join('') : `<p class="muted">${T('tm.noFixtures')}</p>`;
        out.querySelectorAll('[data-fx-date]').forEach(b => b.onclick = () => { s.match.date = b.dataset.fxDate; s.match.opponent = b.dataset.fxOpp; touch(); });
      } catch (e) { out.innerHTML = `<p class="muted">${T('tm.wpmatchDown')}</p>`; }
    });

    const build = () => {
      const tpl = templateById(db, s.templateId);
      const staff = Object.assign({}, t.staff || {}, s.staff || {});
      const data = { club: t.club, team: { name: t.leagueLabel || catLabel(t.category), staff }, match: Object.assign({}, s.match, { league: s.match.league || t.leagueLabel || catLabel(t.category) }), lineup: lineupOf(db, s).slice(0, tpl.rows), staff };
      return { tpl, data, model: TEAMSHEET.buildModel(tpl, data) };
    };
    const blocked = () => {
      const r = ELIGIBILITY.check(t, lineupOf(db, s).filter(Boolean), { date: s.match.date });
      return r.errors && !confirm(T('tm.confirmWithErrors', { n: r.errors }));
    };
    const download = (bytes, name, mime) => {
      try {
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
        return true;
      } catch (e) { toast(T('tm.downloadFailed')); return false; }
    };
    on('#tm-dl-docx', 'click', () => {
      if (blocked()) return;
      const { data, model } = build();
      if (download(SHEETDOC.toDocx(model), TEAMSHEET.fileName(data, 'docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')) toast(T('tm.downloaded'));
    });
    on('#tm-dl-pdf', 'click', () => {
      if (blocked()) return;
      const { data, model } = build();
      const pdf = SHEETDOC.toPdf(model);
      const note = $('#tm-dl-note');
      // The PDF font cannot draw every letter. Say exactly which ones changed, and where to go instead.
      if (note) note.innerHTML = pdf.substituted.length
        ? T('tm.pdfSubstituted', { list: esc(pdf.substituted.map(x => `${x.from} → ${x.to}`).join(', ')) })
        : (pdf.truncated.length ? T('tm.pdfTruncated', { list: esc(pdf.truncated.map(x => x.text).join(', ')) }) : '');
      if (download(pdf.bytes, TEAMSHEET.fileName(data, 'pdf'), 'application/pdf')) toast(T('tm.downloaded'));
    });
    on('#tm-print', 'click', () => {
      const { model } = build();
      const w = window.open('', '_blank');
      if (!w) { toast(T('tm.popupBlocked')); return; }
      w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(model.docTitle)}</title><style>${PRINT_CSS}</style>${SHEETDOC.toHtml(model)}<script>setTimeout(function(){window.print()},300)<\/script>`);
      w.document.close();
    });
  }

  function wireTemplateEditor() {
    const raw = db.templates.find(x => x.id === ui.tplId); if (!raw) return;
    on('#tm-tpl-back', 'click', () => { ui.tplId = null; ui.tab = 'templates'; draw(); });
    const apply = mutate => { const tpl = TEAMSHEET.normalizeTemplate(raw); mutate(tpl); Object.assign(raw, tpl, { id: raw.id, builtin: false }); persist(); draw(); };
    on('#tt-name', 'change', e => apply(t => { t.name = e.target.value.trim() || t.name; }));
    on('#tt-title', 'change', e => apply(t => { t.title = e.target.value.trim() || null; }));
    on('#tt-rows', 'change', e => apply(t => { t.rows = +e.target.value; }));
    on('#tt-l1', 'change', e => apply(t => { t.langs = [e.target.value, t.langs[1] === e.target.value ? '' : t.langs[1]]; }));
    on('#tt-l2', 'change', e => apply(t => { t.langs = [t.langs[0], e.target.value === t.langs[0] ? '' : e.target.value]; }));
    on('#tt-note', 'change', e => apply(t => { t.note = e.target.checked; }));
    $$('[data-thead]').forEach(c => c.onchange = () => apply(t => { const k = c.dataset.thead; t.header = c.checked ? TEAMSHEET.HEADER_KEYS.filter(x => x === k || t.header.includes(x)) : t.header.filter(x => x !== k); }));
    $$('[data-tstaff]').forEach(c => c.onchange = () => apply(t => { const k = c.dataset.tstaff; t.staff = c.checked ? TEAMSHEET.STAFF_KEYS.filter(x => x === k || t.staff.includes(x)) : t.staff.filter(x => x !== k); }));
    $$('[data-tcol]').forEach(c => c.onchange = () => apply(t => {
      const k = c.dataset.tcol;
      t.columns = c.checked ? t.columns.concat({ key: k, w: 0.15 }) : t.columns.filter(x => x.key !== k);
    }));
    $$('[data-tcolw]').forEach(inp => inp.onchange = () => apply(t => { const c = t.columns.find(x => x.key === inp.dataset.tcolw); if (c) c.w = Math.max(3, +inp.value || 10) / 100; }));
    const move = (k, d) => apply(t => { const i = t.columns.findIndex(x => x.key === k), j = i + d; if (i < 0 || j < 0 || j >= t.columns.length) return; const c = t.columns.splice(i, 1)[0]; t.columns.splice(j, 0, c); });
    $$('[data-tcolup]').forEach(b => b.onclick = () => move(b.dataset.tcolup, -1));
    $$('[data-tcoldown]').forEach(b => b.onclick = () => move(b.dataset.tcoldown, 1));
  }

  /* ------------------------------------------------------------- the player's own card
     On the PLAYER's device: they enter their licence number once and the card is read live
     from wpmatch.ch, which already publishes it. Stored on that device only — the same
     no-backend rule as the rosters, and the reason this does not wait for real sign-in.

     NOT the official card. Swiss Aquatics issues official player cards to clubs through
     Fairgate, and referees check those before a match. This one says so, plainly, and does
     not borrow its look — a card that could be mistaken for the real thing at a pool is worse
     than no card. */
  const CARD_KEY = 'thplay.mycard.v1';
  const loadCard = () => { try { return JSON.parse(localStorage.getItem(CARD_KEY)) || null; } catch (e) { return null; } };
  const saveCard = c => { try { c ? localStorage.setItem(CARD_KEY, JSON.stringify(c)) : localStorage.removeItem(CARD_KEY); } catch (e) {} };

  function renderPlayerCard(el, context) {
    if (!el) return;
    const c = context || {};
    const say = m => (c.toast ? c.toast(m) : null);
    const card = loadCard();
    const draw = (busy, msg) => {
      const cur = loadCard();
      if (!cur || !cur.player) {
        el.innerHTML = `<div class="dev-card tm-mycard">
          <h3>${T('tm.card.title')}</h3>
          <p class="muted">${T('tm.card.intro')}</p>
          <div class="tm-add"><label class="tm-lic">${T('tm.card.licence')}<input type="text" id="tm-card-lic" inputmode="numeric" maxlength="6" value="${esc(cur && cur.licence)}"></label>
            <div class="tm-add-btns"><button class="btn-primary sm" id="tm-card-go" ${busy ? 'disabled' : ''}>${busy ? T('tm.searching') : T('tm.card.show')}</button></div></div>
          ${msg ? `<p class="fa-note">${msg}</p>` : ''}
        </div>`;
      } else {
        const p = cur.player;
        el.innerHTML = `<div class="dev-card tm-mycard">
          <h3>${T('tm.card.title')}</h3>
          <div class="tm-card-body">
            <div class="tm-card-name">${esc([p.firstName, p.name].filter(Boolean).join(' '))}</div>
            <div class="tm-card-lic"><span class="muted">${T('tm.licenceNo')}</span> <b>${esc(p.licence)}</b></div>
            <div class="tm-card-meta">${p.cap ? `<span class="tag">${T('tm.card.cap', { n: esc(p.cap) })}</span>` : ''}${p.birthYear ? `<span class="tag">${T('tm.born')} ${esc(p.birthYear)}</span>` : ''}${statusBadge(p.status)}</div>
            ${ELIGIBILITY.statusOf(p.status) === 'inactive' ? `<p class="tm-f tm-f-warn">${T('tm.card.inactive')}</p>` : ''}
          </div>
          <p class="fa-note">${T('tm.card.checked', { date: esc(new Date(cur.checkedAt).toLocaleDateString()) })} ${T('tm.card.notOfficial')}</p>
          <div class="tm-actions"><button class="btn-ghost sm" id="tm-card-refresh" ${busy ? 'disabled' : ''}>${busy ? T('tm.searching') : T('tm.card.refresh')}</button>
            <button class="btn-ghost sm" id="tm-card-change">${T('tm.card.change')}</button></div>
          ${msg ? `<p class="fa-note">${msg}</p>` : ''}
        </div>`;
      }
      wireCard();
    };
    const lookup = async lic => {
      if (!/^\d{3,6}$/.test(lic)) { draw(false, T('tm.card.badNumber')); return; }
      saveCard(Object.assign({}, loadCard(), { licence: lic }));
      draw(true);
      try {
        const r = await WPMATCH.lookupLicences([lic]);
        // the active record wins over an old inactive number for the same person
        const p = WPMATCH.dedupePlayers(r.players).find(x => x.licence === lic) || r.players[0];
        if (!p) { saveCard({ licence: lic, player: null }); draw(false, T('tm.card.notFound', { lic: esc(lic) })); return; }
        saveCard({ licence: lic, player: p, checkedAt: Date.now() });
        draw(false); say(T('tm.card.updated'));
      } catch (e) { draw(false, T('tm.wpmatchDown')); }
    };
    function wireCard() {
      const go = el.querySelector('#tm-card-go');
      if (go) go.onclick = () => lookup(el.querySelector('#tm-card-lic').value.trim());
      const inp = el.querySelector('#tm-card-lic');
      if (inp) inp.onkeydown = e => { if (e.key === 'Enter') lookup(inp.value.trim()); };
      const rf = el.querySelector('#tm-card-refresh');
      if (rf) rf.onclick = () => lookup(loadCard().licence);
      const ch = el.querySelector('#tm-card-change');
      if (ch) ch.onclick = () => { const cur = loadCard(); saveCard({ licence: cur && cur.licence, player: null }); draw(false); };
    }
    draw(false);
    return card;
  }

  // printing opens a bare window, so it carries its own copy of the sheet styles
  /* theme:fixed — the official team sheet is a paper form: black on white in every look */
  const PRINT_CSS = `body{font:10pt Verdana,Geneva,sans-serif;color:#000;margin:18mm 16mm}.ts-title{font:700 14pt Arial,Helvetica,sans-serif;margin:0 0 14pt}
    .ts-t{width:100%;border-collapse:collapse;margin:0 0 16pt}.ts-t td,.ts-t th{border:1px solid #000;padding:3pt 5pt;text-align:left;vertical-align:top;font-weight:400}
    .ts-roster td{height:14pt}.ts-sign td{height:30pt}.ts-2nd{color:#555}.ts-note p{margin:2pt 0;font-weight:700}.ts-lead{color:#e4002b}.ts-i{font-style:italic}`;

  return { KEY, CARD_KEY, MIRROR_KEY, SYNC_KEY, CATEGORY_ORDER, render, renderPlayerCard, load, save, upsertPlayers, autoOrder, lineupOf, allTemplates,
           availOf, setAvailability, availabilityCounts, availablePool,
           syncClub, maySync, payloadFor, forUpload, syncTeam, syncAll, loadMirror, syncStateOf, wipeDevice,
           removeAtClub, deleteAtClub, serverIdOf, seasonOf, pullTeam, scoutSquad, scoutHtml,
           SCOUT_KEY, SCOUT_MAX, loadScouts, scoutList, saveScout, forgetScout, ourSquad, playerLine };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = TEAMS;
