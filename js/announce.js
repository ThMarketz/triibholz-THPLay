/* ============================================================
   announce.js — coach → player(s) announcements: a personal note to
   one player, or a team-wide "here's the plan for Saturday" broadcast
   that can carry one or more attached plays from the playbook.

   Unlike the rest of the app's per-device localStorage data, an
   announcement has to reach a DIFFERENT device (the coach writes it,
   a player reads it) — so it is stored server-side (server/index.js,
   one JSON file per announcement, mirroring the existing debriefs
   store) and scoped by the team's own invite code, not by browser.

   Pure and unit-tested: the shape, validation and visibility/read
   rules are shared verbatim by the server (which requires this file
   directly, exactly like it already does for calendar.js/privacy.js)
   and the client. Storage/network/DOM live in server/index.js and
   app.js respectively.
   ============================================================ */
const ANNOUNCE = (() => {
  const MAX_TITLE = 120, MAX_BODY = 1500, MAX_MATCH_LABEL = 160, MAX_PLAYS = 6, MAX_NAME = 80;
  const SCOPES = ['team', 'player'];

  const clean = (v, n) => String(v == null ? '' : v).slice(0, n);
  const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));

  /* sanitize(input) → { ok:true, value } | { ok:false, error }
     `input` is a raw parsed JSON body from the client; nothing here trusts
     it beyond shape/length — ids and timestamps are assigned by the caller. */
  function sanitize(input) {
    input = input || {};
    const scope = input.scope === 'player' ? 'player' : (input.scope === 'team' ? 'team' : null);
    if (!scope) return { ok: false, error: 'bad-scope' };
    const title = clean(input.title, MAX_TITLE).trim();
    const body = clean(input.body, MAX_BODY).trim();
    if (!title || !body) return { ok: false, error: 'title-and-body-required' };
    if (scope === 'player' && !isEmail(input.to)) return { ok: false, error: 'player-scope-needs-a-valid-to-email' };
    const plays = (Array.isArray(input.plays) ? input.plays : []).slice(0, MAX_PLAYS).filter(p => p && typeof p === 'object');
    return {
      ok: true,
      value: {
        scope,
        to: scope === 'player' ? String(input.to).trim().toLowerCase() : null,
        team: clean(input.team, 60) || 'club',
        from: { name: clean(input.fromName, MAX_NAME), email: clean(input.fromEmail, MAX_NAME).toLowerCase() },
        title, body,
        matchLabel: input.matchLabel ? clean(input.matchLabel, MAX_MATCH_LABEL) : null,
        matchEventId: input.matchEventId ? clean(input.matchEventId, 60) : null,
        plays,
      },
    };
  }

  /* visibleTo(a, {team,email}) — true if this reader should ever see this announcement */
  function visibleTo(a, reader) {
    reader = reader || {};
    if (!a || a.team !== reader.team) return false;
    if (a.scope === 'team') return true;
    return a.scope === 'player' && a.to === String(reader.email || '').toLowerCase();
  }

  /* summarize(a, {for}) — the list-view shape (no body/plays payload) */
  function summarize(a, opts) {
    const forEmail = (opts && opts.for) || null;
    return {
      id: a.id, scope: a.scope, title: a.title,
      from: a.from && a.from.name, matchLabel: a.matchLabel || null,
      createdAt: a.createdAt, playCount: (a.plays || []).length,
      read: forEmail ? (a.readBy || []).includes(forEmail) : null,
    };
  }

  /* unreadCount(list, email) — list already filtered to what this reader can see */
  function unreadCount(list, email) {
    return (list || []).filter(a => !(a.readBy || []).includes(email)).length;
  }

  return { MAX_TITLE, MAX_BODY, MAX_MATCH_LABEL, MAX_PLAYS, SCOPES, sanitize, visibleTo, summarize, unreadCount };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = ANNOUNCE;
