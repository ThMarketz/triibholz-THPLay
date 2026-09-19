/* ============================================================
   server/teams.js — a club's teams and rosters (slice 5).

   Until now a coach's rosters lived only on their own device, because the backend had no way to
   tell one person from another and a roster is licence numbers and names, most of them children's.
   Slices 0–4 built that missing half; this is the first thing to use it. The rules the design
   settled on, and why each one is here rather than in a route's head:

     · PER CLUB, ALWAYS. club_players is keyed by (club_id, licence). Adding a licence is an insert
       that cannot fail because of another club, so it says nothing about whether another club has
       that child, and no correction ever crosses a club boundary.
     · THE DEVICE'S ID IS NEVER THE KEY. It is `Math.random` (js/teams.js) and it travels between
       devices inside exported .thplay.json files, so two coaches can hold the same one. The server
       keys on HMAC(server key, club:uploader:localId): a retried upload by the same coach is a
       no-op, and another coach's colliding id makes their own team instead of landing in someone
       else's. The raw id is never stored, audited or logged — it comes back in the manifest only.
     · READING A ROSTER IS AN EXPORT. Filling a device with children's names is the act worth
       gating, so the roster read and the upload both need a fresh passkey assertion (step-up), and
       the upload additionally needs a session the person opened themselves — not one minted by
       following a link somebody sent them.
     · NO ORACLE. The two-teams-same-category conflict is only ever computed as a side effect of a
       write the caller was already allowed to make, it names no team the caller is not staff of,
       and there is no lookup route. "Is this licence in this club" is a question this server does
       not answer to anyone.
     · NOTHING IS DELETED BY A SYNC. An upload adds and updates; removal is its own route, and
       deleting a team makes the coach retype its name.

   Route order is clubs.js's: body → clock → session → ONE synchronous transaction that checks the
   membership (404), the team (404), the body (400) and the rules (409/429), then writes with a
   conditional UPDATE and audits. Audit details carry counts and server ids only — never a licence,
   a name or a device id.
   ============================================================ */
'use strict';
const { createHmac, randomBytes } = require('node:crypto');
const { tx } = require('./db.js');
const ID = require('./identity.js');
const { makeGuard } = require('./clubs.js');
const TEAMSYNC = require('../js/teamsync.js');
const LEGALSRV = require('./legal.js');

const CLUB = '(c_[A-Za-z0-9_-]{22})', TEAM = '(ct_[A-Za-z0-9_-]{22})', PLAYER = '(cp_[A-Za-z0-9_-]{22})';
const STAFF = ID.STAFF_ROLES;
const HOUR = 3600e3, DAY = 24 * HOUR;
/* a session that was opened by the person themselves, rather than by following a link they were sent */
const OWN_SIGN_IN = ['login', 'club-admin', 'staff-invite'];

function routes(core) {
  const { db, now, send, readJson, httpError, tooMany, requireSession, overLimit } = core;
  const guard = makeGuard(core);

  /* The upload key. Same shape as clubs.js's formerRef: a server secret, so nothing derived from a
     device id can be guessed, replayed from an exported file, or matched across clubs. */
  const syncSecret = tx(db, () => {
    db.prepare('INSERT OR IGNORE INTO server_keys (name, secret, created_at) VALUES (?, ?, ?)').run('team-sync', randomBytes(32), now());
    return Buffer.from(db.prepare('SELECT secret FROM server_keys WHERE name = ?').get('team-sync').secret);
  });
  const syncKey = (clubId, userId, localId) =>
    createHmac('sha256', syncSecret).update(`${clubId}:${userId}:${localId}`).digest('base64url');

  /* ---- who may touch a team ---------------------------------------------------------------- */

  /* Inside a transaction: the caller's membership, and the team, or the one 404 for all of
     "no such club", "not your club", "no such team", "another club's team" and "not your team".
     A club admin reaches every team of their club; a coach or trainer reaches the teams they have
     a staff row for. Staff rows are integrity, not permission: the membership is re-checked here
     because a person can be demoted or removed while their row still exists. */
  function guardTeam(session, clubId, teamId, { stepUp = false } = {}, t) {
    const m = guard(session, clubId, { roles: STAFF, stepUp }, t);
    const team = db.prepare('SELECT * FROM club_teams WHERE id = ? AND club_id = ?').get(teamId, clubId);
    if (!team) throw httpError(404, 'not-found');
    if (m.role !== 'admin' && !staffRow(teamId, session.userId)) throw httpError(404, 'not-found');
    return { member: m, team };
  }
  const staffRow = (teamId, userId) => db.prepare('SELECT 1 FROM club_team_staff WHERE team_id = ? AND user_id = ?').get(teamId, userId);
  const teamsOf = (clubId, userId) => db.prepare(
    'SELECT t.* FROM club_teams t JOIN club_team_staff s ON s.team_id = t.id WHERE t.club_id = ? AND s.user_id = ? ORDER BY t.season DESC, t.category, t.name').all(clubId, userId);
  const allTeams = clubId => db.prepare('SELECT * FROM club_teams WHERE club_id = ? ORDER BY season DESC, category, name').all(clubId);
  const liveCount = (teamId) => db.prepare('SELECT count(*) AS n FROM club_team_players WHERE team_id = ? AND removed_at IS NULL').get(teamId).n;

  const teamOut = (t, isStaff) => ({
    id: t.id, name: t.name, category: t.category, season: t.season, leagueLabel: t.league_label,
    rev: t.rev, players: liveCount(t.id), archivedAt: t.archived_at, mine: !!isStaff,
  });
  /* a roster row as it goes back to a device. birthYear and gender exist only for a player with no
     licence yet; for anyone else the coach's own device reads them from wpmatch. */
  const playerOut = p => ({
    id: p.id, licence: p.licence, name: p.name, firstName: p.first_name,
    nameEdited: !!p.name_edited, nameGuessed: !!p.name_guessed,
    birthYear: p.birth_year, gender: p.gender, cap: p.cap, gk: !!p.gk, rev: p.rev,
  });
  const peopleOut = (table, clubId, teamId) => db.prepare(
    `SELECT m.member_ref, u.display_name, m.role FROM ${table} x
     JOIN club_members m ON m.club_id = x.club_id AND m.user_id = x.user_id AND m.status = 'approved'
     JOIN users u ON u.id = x.user_id WHERE x.team_id = ? AND x.club_id = ? ORDER BY u.display_name`).all(teamId, clubId)
    .map(r => ({ memberRef: r.member_ref, name: r.display_name, role: r.role }));

  /* ---- the two-teams-same-category check ---------------------------------------------------
     A player may not be on two team lists of the same category in the same season. The check runs
     within this club only — the server has no way to look into another club and would not answer
     if it had. What comes back names a team only when the caller is staff of that team too;
     otherwise it is the bare fact, which is all a coach needs to go and ask. */
  function conflictsFor(clubId, teamId, season, category, playerIds, userId, isAdmin) {
    if (!playerIds.length) return [];
    const marks = playerIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT p.id, p.licence, p.name, t.id AS team_id, t.name AS team_name
       FROM club_team_players tp
       JOIN club_teams t ON t.id = tp.team_id
       JOIN club_players p ON p.id = tp.club_player_id
       WHERE t.club_id = ? AND t.id != ? AND t.season = ? AND t.category = ? AND t.archived_at IS NULL
         AND tp.removed_at IS NULL AND tp.club_player_id IN (${marks})`).all(clubId, teamId, season, category, ...playerIds);
    const seen = new Map();
    for (const r of rows) {
      const named = isAdmin || !!staffRow(r.team_id, userId);
      const key = named ? r.team_id : '·';
      const c = seen.get(key) || { code: named ? 'team-conflict-named' : 'team-conflict', team: named ? r.team_name : null, players: [] };
      c.players.push(r.licence || r.name);
      seen.set(key, c);
    }
    return [...seen.values()];
  }

  /* ---- writing a player -------------------------------------------------------------------- */

  /* Insert or update one club_players row and return its id. A licensed player is found by licence,
     a licence-pending one by the hash of the device id that made them. Nothing is ever matched by
     name: two children in one club share a name often enough that clubs.js already warns about it. */
  function upsertPlayer(clubId, userId, p, t) {
    const key = p.localId ? syncKey(clubId, userId, p.localId) : null;
    let row = p.licence
      ? db.prepare('SELECT * FROM club_players WHERE club_id = ? AND licence = ?').get(clubId, p.licence)
      : (key ? db.prepare('SELECT * FROM club_players WHERE club_id = ? AND sync_key = ?').get(clubId, key) : null);
    /* Her licence has come through. She is already here as a signing with no licence yet, known by
       the id this device gave her — so she is the SAME child, not a new one. Storing a second row
       would leave the first behind for ever with the birth year only the device could supply, on
       every roster twice, and invisible to the two-teams check. The licence takes over as her
       identity, and the year and gender go with the change: nothing may hold both. */
    if (!row && p.licence && key) {
      const pending = db.prepare('SELECT * FROM club_players WHERE club_id = ? AND sync_key = ? AND licence IS NULL').get(clubId, key);
      if (pending) {
        db.prepare('UPDATE club_players SET licence = ?, birth_year = NULL, gender = \'\', updated_at = ?, rev = rev + 1 WHERE id = ? AND club_id = ?')
          .run(p.licence, t, pending.id, clubId);
        ID.audit(db, { actor: userId, action: 'player.licence', clubId, detail: { player: pending.id } }, t);
        row = db.prepare('SELECT * FROM club_players WHERE id = ?').get(pending.id);
      }
    }
    if (!row) {
      const total = db.prepare('SELECT count(*) AS n FROM club_players WHERE club_id = ?').get(clubId).n;
      if (total >= TEAMSYNC.LIMITS.playersPerClub) throw httpError(409, 'too-many-players');
      const id = ID.newId('cp');
      db.prepare(`INSERT INTO club_players (id, club_id, licence, sync_key, name, first_name, name_edited, name_guessed, birth_year, gender, added_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, clubId, p.licence, key, p.name, p.firstName, p.nameEdited ? 1 : 0, p.nameGuessed ? 1 : 0, p.birthYear, p.gender, userId, t, t);
      return { id, created: true, changed: false };
    }
    // the name is the only thing an upload may change about a player who is already here
    if (p.rev && p.rev !== row.rev) throw httpError(409, 'request-changed');
    const same = row.name === p.name && row.first_name === p.firstName && !!row.name_edited === !!p.nameEdited;
    if (same) return { id: row.id, created: false, changed: false };
    const r = db.prepare('UPDATE club_players SET name = ?, first_name = ?, name_edited = ?, name_guessed = ?, updated_at = ?, rev = rev + 1 WHERE id = ? AND club_id = ? AND rev = ?')
      .run(p.name, p.firstName, p.nameEdited ? 1 : 0, p.nameGuessed ? 1 : 0, t, row.id, clubId, row.rev);
    if (r.changes !== 1) throw httpError(409, 'request-changed');
    return { id: row.id, created: false, changed: true };
  }

  /* A player is on a team, with the cap and the keeper flag that team gives them.

     `revive` is the difference between the two ways a player arrives. Adding one by hand is a
     decision, so it may put back somebody who was taken off. A ROUTINE UPLOAD is not a decision:
     the coach's device still holds everyone it held last week, including whoever the club removed
     in the meantime, so an upload that cleared removed_at would undo every removal on the next
     sync — and clearing left_at with it would restart the retention clock, so the record would
     never be swept either. The club's removal stands, and the upload is told so. */
  function putOnTeam(teamId, playerId, p, userId, t, { revive = true } = {}) {
    const row = db.prepare('SELECT * FROM club_team_players WHERE team_id = ? AND club_player_id = ?').get(teamId, playerId);
    if (row && row.removed_at && !revive) return { removed: true };
    if (!row) {
      if (liveCount(teamId) >= TEAMSYNC.LIMITS.playersPerTeam) throw httpError(400, 'team-full');
      db.prepare('INSERT INTO club_team_players (team_id, club_player_id, cap, gk, added_at, added_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(teamId, playerId, p.cap, p.gk ? 1 : 0, t, userId);
    } else {
      db.prepare('UPDATE club_team_players SET cap = ?, gk = ?, removed_at = NULL, removed_by = NULL WHERE team_id = ? AND club_player_id = ?')
        .run(p.cap, p.gk ? 1 : 0, teamId, playerId);
    }
    // back on a list somewhere: the retention clock stops
    db.prepare('UPDATE club_players SET left_at = NULL WHERE id = ? AND left_at IS NOT NULL').run(playerId);
    return { removed: false };
  }
  /* off every live list in this club → the clock that slice 8's retention sweep will read starts now */
  function stampLeft(playerId, t) {
    const live = db.prepare('SELECT count(*) AS n FROM club_team_players WHERE club_player_id = ? AND removed_at IS NULL').get(playerId).n;
    if (!live) db.prepare('UPDATE club_players SET left_at = ? WHERE id = ? AND left_at IS NULL').run(t, playerId);
    return !live;
  }

  /* ---- routes ------------------------------------------------------------------------------- */

  /* the teams this person may work on: every team of the club for an admin, their own otherwise */
  async function list(req, res, clubId) {
    const t = now(), s = requireSession(req);
    const out = tx(db, () => {
      const m = guard(s, clubId, { roles: STAFF }, t);
      const mine = new Set(teamsOf(clubId, s.userId).map(x => x.id));
      const rows = m.role === 'admin' ? allTeams(clubId) : [...mine].map(id => db.prepare('SELECT * FROM club_teams WHERE id = ?').get(id));
      return { scope: m.role === 'admin' ? 'club' : 'teams', at: t, teams: rows.filter(Boolean).map(x => teamOut(x, mine.has(x.id))) };
    });
    send(res, 200, out);
  }

  /* One team with its roster — the read that fills a device with children's names, so it asks for
     the passkey again. Everything else about it is ordinary. */
  async function read(req, res, clubId, teamId) {
    const t = now(), s = requireSession(req);
    const out = tx(db, () => {
      const { team } = guardTeam(s, clubId, teamId, { stepUp: true }, t);
      const players = db.prepare(
        `SELECT p.*, tp.cap, tp.gk FROM club_team_players tp JOIN club_players p ON p.id = tp.club_player_id
         WHERE tp.team_id = ? AND tp.removed_at IS NULL ORDER BY p.name`).all(teamId);
      return { at: t, team: teamOut(team, true), players: players.map(playerOut),
               staff: peopleOut('club_team_staff', clubId, teamId), members: peopleOut('club_team_members', clubId, teamId) };
    });
    send(res, 200, out);
  }

  /* ONE team per request: a whole device would not fit the router's 64 kB body, and a team at a
     time means a sync that dies half-way leaves whole teams behind rather than half of one.
     Idempotent — the same team sent twice writes nothing the second time and answers the same
     manifest — and it never deletes anything. */
  async function upload(req, res, clubId) {
    const body = await readJson(req);
    const t = now(), s = requireSession(req);
    if (!OWN_SIGN_IN.includes(s.origin || 'legacy')) throw httpError(403, 'full-sign-in-required');
    const clean = TEAMSYNC.sanitizeTeam(body);
    if (!clean.ok) throw httpError(400, clean.error);
    const v = clean.value;
    const allowed = tx(db, () => guard(s, clubId, { roles: STAFF, stepUp: true }, t));
    // a roster is children's data: none of it on the server before the club has a contract with us.
    // After the membership check, so somebody outside the club still gets the one 404, not this.
    LEGALSRV.requireContract(db, clubId, httpError);
    /* Charged after the membership check and outside the write, so: a club id somebody invented
       never writes a row into the shared table, and a sync that is then refused for a reason of
       its own (a stale rev, a full club) does not get its budget back by rolling the counter up
       with it. A coach who presses Sync twenty times in a minute is the case this is for. */
    if (overLimit(`teams-sync:${clubId}:${s.userId}`, { max: TEAMSYNC.LIMITS.syncsPerHour, windowMs: HOUR }, t)) throw tooMany(HOUR);
    const newLicences = v.players.filter(p => p.licence).length;
    if (newLicences && overLimit(`players:${clubId}:${s.userId}`, { max: TEAMSYNC.LIMITS.newLicencesPerDay, windowMs: DAY }, t, newLicences)) throw tooMany(DAY);
    const out = tx(db, () => {
      const m = guard(s, clubId, { roles: STAFF, stepUp: true }, t);
      /* the key carries the season, so when a season turns the same local team syncs into a NEW
         server team: last season's row keeps last season's children instead of being rewritten
         under them. TEAMSYNC's local ids cannot contain ':', so this can never collide with the
         licence-pending player key below. */
      const key = syncKey(clubId, s.userId, `${v.season}:${v.localId}`);
      /* A device that took this roster down from the club names the team it means. That is how a
         coach's second device, or a colleague an admin added to the team, updates the SAME list
         instead of minting a parallel one — but it is only a claim, so it is checked like any
         other: staff of that team, in this club, or the ordinary 404. */
      let team = v.teamId
        ? (db.prepare('SELECT * FROM club_teams WHERE id = ? AND club_id = ?').get(v.teamId, clubId) || null)
        : db.prepare('SELECT * FROM club_teams WHERE club_id = ? AND sync_key = ?').get(clubId, key);
      if (v.teamId && (!team || (m.role !== 'admin' && !staffRow(team.id, s.userId)))) throw httpError(404, 'not-found');
      let created = false;
      if (!team) {
        const teams = db.prepare('SELECT count(*) AS n FROM club_teams WHERE club_id = ? AND archived_at IS NULL').get(clubId).n;
        if (teams >= TEAMSYNC.LIMITS.teamsPerClub) throw httpError(409, 'too-many-teams');
        const id = ID.newId('ct');
        db.prepare(`INSERT INTO club_teams (id, club_id, sync_key, name, category, season, league_label, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, clubId, key, v.name, v.category, v.season, v.leagueLabel, s.userId, t, t);
        // whoever creates a team is staff of it; every other staff row is an admin's deliberate grant
        db.prepare('INSERT INTO club_team_staff (team_id, club_id, user_id, added_at, added_by) VALUES (?, ?, ?, ?, ?)')
          .run(id, clubId, s.userId, t, s.userId);
        team = db.prepare('SELECT * FROM club_teams WHERE id = ?').get(id);
        created = true;
      } else {
        if (m.role !== 'admin' && !staffRow(team.id, s.userId)) throw httpError(404, 'not-found');
        const same = team.name === v.name && team.category === v.category && team.season === v.season && team.league_label === v.leagueLabel;
        if (!same) {
          if (v.rev && v.rev !== team.rev) throw httpError(409, 'request-changed');
          const r = db.prepare('UPDATE club_teams SET name = ?, category = ?, season = ?, league_label = ?, updated_at = ?, rev = rev + 1 WHERE id = ? AND club_id = ? AND rev = ?')
            .run(v.name, v.category, v.season, v.leagueLabel, t, team.id, clubId, team.rev);
          if (r.changes !== 1) throw httpError(409, 'request-changed');
          team = db.prepare('SELECT * FROM club_teams WHERE id = ?').get(team.id);
        }
      }
      let added = 0, changed = 0;
      const manifest = [], removedAtClub = [];
      for (const p of v.players) {
        const r = upsertPlayer(clubId, s.userId, p, t);
        const put = putOnTeam(team.id, r.id, p, s.userId, t, { revive: false });
        if (put.removed) removedAtClub.push({ localId: p.localId, licence: p.licence });
        else if (r.created) added++; else if (r.changed) changed++;
        manifest.push({ localId: p.localId, licence: p.licence, id: r.id });
      }
      const conflicts = conflictsFor(clubId, team.id, team.season, team.category, manifest.map(x => x.id), s.userId, m.role === 'admin');
      ID.audit(db, { actor: s.userId, action: created ? 'team.create' : 'team.update', clubId,
                     detail: { team: team.id, category: team.category, season: team.season, playersAdded: added, playersChanged: changed, playersLeftRemoved: removedAtClub.length, players: v.players.length } }, t);
      // read back what is actually stored, so the device is told the truth rather than its own hopes
      const stored = db.prepare('SELECT p.id, p.rev FROM club_team_players tp JOIN club_players p ON p.id = tp.club_player_id WHERE tp.team_id = ?').all(team.id);
      const byId = new Map(stored.map(r => [r.id, r]));
      return {
        at: t,
        team: { localId: v.localId, id: team.id, rev: team.rev },
        players: manifest.filter(x => byId.has(x.id)).map(x => ({ localId: x.localId, licence: x.licence, id: x.id, rev: byId.get(x.id).rev })),
        conflicts, removedAtClub,
        counts: { added, changed, removed: removedAtClub.length, unchanged: v.players.length - added - changed - removedAtClub.length },
      };
    });
    send(res, 200, out);
  }

  /* one player onto a team a coach already runs — the conflict comes back as a side effect of it */
  async function addPlayer(req, res, clubId, teamId) {
    const body = await readJson(req);
    const t = now(), s = requireSession(req);
    const clean = TEAMSYNC.sanitizePlayer(body);
    if (!clean.ok) throw httpError(400, clean.error);
    const p = clean.value;
    const out = tx(db, () => {
      const { member, team } = guardTeam(s, clubId, teamId, { stepUp: true }, t);
      LEGALSRV.requireContract(db, clubId, httpError);
      if (p.licence && overLimit(`players:${clubId}:${s.userId}`, { max: TEAMSYNC.LIMITS.newLicencesPerDay, windowMs: DAY }, t)) throw tooMany(DAY);
      // a caller has no legitimate rev for a player they have never read, and honouring one would
      // let them ask "is this child already here?" by watching which revs are refused
      const r = upsertPlayer(clubId, s.userId, Object.assign({}, p, { rev: null }), t);
      putOnTeam(team.id, r.id, p, s.userId, t);
      ID.audit(db, { actor: s.userId, action: 'player.add', clubId, detail: { team: team.id, player: r.id, created: r.created } }, t);
      // what the caller sent, not what is stored: a rev of 1 versus 2 would say whether the row existed
      return { player: { id: r.id, licence: p.licence, name: p.name, firstName: p.firstName, nameEdited: p.nameEdited,
                         nameGuessed: p.nameGuessed, birthYear: p.birthYear, gender: p.gender, cap: p.cap, gk: p.gk },
               conflicts: conflictsFor(clubId, team.id, team.season, team.category, [r.id], s.userId, member.role === 'admin') };
    });
    send(res, 200, out);
  }

  /* off the list, but not out of the club's records: the row stays with removed_at so "was she on
     this list in March" still has an answer and deleting a team cannot silence a conflict warning */
  async function removePlayer(req, res, clubId, teamId, playerId) {
    const body = await readJson(req);
    const t = now(), s = requireSession(req);
    const out = tx(db, () => {
      guardTeam(s, clubId, teamId, {}, t);
      const row = db.prepare(
        `SELECT tp.* FROM club_team_players tp JOIN club_players p ON p.id = tp.club_player_id
         WHERE tp.team_id = ? AND tp.club_player_id = ? AND p.club_id = ? AND tp.removed_at IS NULL`).get(teamId, playerId, clubId);
      if (!row) throw httpError(404, 'not-found');
      db.prepare('UPDATE club_team_players SET removed_at = ?, removed_by = ? WHERE team_id = ? AND club_player_id = ?').run(t, s.userId, teamId, playerId);
      const leftClub = stampLeft(playerId, t);
      ID.audit(db, { actor: s.userId, action: 'player.remove', clubId, detail: { team: teamId, player: playerId, leftClub } }, t);
      return { removed: true, leftClub };
    });
    send(res, 200, out);
  }

  /* ---- forget a player: erasure, not removal ----
     Removing a player from a team keeps the row with removed_at set, which is right for a child who
     changed club and whose history the coach still needs. It is NOT what a parent asking for their
     daughter's data to be deleted is entitled to, and both the revised FADP and the GDPR give them
     that. Until now the app could not do it at all: a rostered child is not a user, so deleteUser
     does not reach them, and club_players only cascades from the CLUB.

     This deletes the child outright — every team row, then the player. Admin only, and a step-up,
     because it is irreversible and there is no undo anywhere.

     WHAT IT HONESTLY CANNOT DO is reach inside a match video. Nobody can erase one child from
     footage of a match, and the app does not know which videos a given child appears in — no such
     index exists, and building one would mean face-matching children, which would be far worse than
     the problem. So the answer given back says plainly that video is deleted on the season schedule
     (server/retention.js) and that a specific match can be deleted early on request. Saying that is
     the honest position; implying the video went too would not be. */
  async function forgetPlayer(req, res, clubId, playerId) {
    const t = now(), s = requireSession(req);
    const out = tx(db, () => {
      guard(s, clubId, { roles: ['admin'], stepUp: true }, t);
      const p = db.prepare('SELECT id FROM club_players WHERE id = ? AND club_id = ?').get(playerId, clubId);
      if (!p) throw httpError(404, 'not-found');
      const teams = db.prepare('DELETE FROM club_team_players WHERE club_player_id = ?').run(playerId).changes;
      const gone = db.prepare('DELETE FROM club_players WHERE id = ? AND club_id = ?').run(playerId, clubId).changes;
      if (gone !== 1) throw httpError(409, 'not-forgotten');
      // ids only, like every other audit line: an erasure record must not re-record the name
      ID.audit(db, { actor: s.userId, action: 'player.forget', clubId, detail: { player: playerId, teams } }, t);
      return { forgotten: true, teamRows: teams };
    });
    send(res, 200, Object.assign(out, { video: 'season-schedule' }));
  }

  /* Who else may work on this team. An admin's decision and a step-up, because it hands someone a
     club's children's names — the same weight as changing a role. */
  async function staff(req, res, clubId, teamId) {
    const body = await readJson(req);
    const t = now(), s = requireSession(req);
    const out = tx(db, () => {
      guard(s, clubId, { roles: ['admin'], stepUp: true }, t);
      LEGALSRV.requireContract(db, clubId, httpError);
      const team = db.prepare('SELECT * FROM club_teams WHERE id = ? AND club_id = ?').get(teamId, clubId);
      if (!team) throw httpError(404, 'not-found');
      const target = ID.getMemberByRef(db, clubId, body.memberRef);
      if (!target || target.status !== 'approved') throw httpError(404, 'not-found');
      if (!STAFF.includes(target.role)) throw httpError(400, 'bad-role');
      if (body.remove) db.prepare('DELETE FROM club_team_staff WHERE team_id = ? AND user_id = ?').run(teamId, target.user_id);
      else db.prepare('INSERT OR IGNORE INTO club_team_staff (team_id, club_id, user_id, added_at, added_by) VALUES (?, ?, ?, ?, ?)').run(teamId, clubId, target.user_id, t, s.userId);
      ID.audit(db, { actor: s.userId, action: 'team.staff', clubId, subject: target.user_id, detail: { team: teamId, removed: !!body.remove } }, t);
      return { staff: peopleOut('club_team_staff', clubId, teamId) };
    });
    send(res, 200, out);
  }

  /* The club's MEMBERS on this team — accounts, so a coach knows who they may write to. This says
     nothing about whether a member is the same person as a roster row: that claim needs a code
     handed over in person (slice 7), and a name match is a guess. */
  async function members(req, res, clubId, teamId) {
    const body = await readJson(req);
    const t = now(), s = requireSession(req);
    const out = tx(db, () => {
      guardTeam(s, clubId, teamId, { stepUp: true }, t);
      LEGALSRV.requireContract(db, clubId, httpError);
      const target = ID.getMemberByRef(db, clubId, body.memberRef);
      if (!target || target.status !== 'approved') throw httpError(404, 'not-found');
      if (body.remove) db.prepare('DELETE FROM club_team_members WHERE team_id = ? AND user_id = ?').run(teamId, target.user_id);
      else db.prepare('INSERT OR IGNORE INTO club_team_members (team_id, club_id, user_id, added_at, added_by) VALUES (?, ?, ?, ?, ?)').run(teamId, clubId, target.user_id, t, s.userId);
      ID.audit(db, { actor: s.userId, action: 'team.member', clubId, subject: target.user_id, detail: { team: teamId, removed: !!body.remove } }, t);
      return { members: peopleOut('club_team_members', clubId, teamId) };
    });
    send(res, 200, out);
  }

  /* The undo for a team uploaded into the wrong club. The name has to be retyped, so a mis-tap
     cannot take a season's roster with it. Players another team ever held keep their rows. */
  async function remove(req, res, clubId, teamId) {
    const body = await readJson(req);
    const t = now(), s = requireSession(req);
    const out = tx(db, () => {
      // a live staff row is needed to delete a team exactly as it is to read one: revoking the row
      // has to revoke everything, or an admin cannot actually take a team away from a coach
      const { member: m, team } = guardTeam(s, clubId, teamId, { stepUp: true }, t);
      if (m.role !== 'admin' && team.created_by !== s.userId) throw httpError(404, 'not-found');
      if (TEAMSYNC.clean(body.name, TEAMSYNC.MAX_TEAM_NAME) !== team.name) throw httpError(400, 'bad-team');
      const held = db.prepare('SELECT club_player_id FROM club_team_players WHERE team_id = ?').all(teamId).map(r => r.club_player_id);
      db.prepare('DELETE FROM club_teams WHERE id = ? AND club_id = ?').run(teamId, clubId);
      let orphaned = 0;
      for (const pid of held) {
        const anywhere = db.prepare('SELECT count(*) AS n FROM club_team_players WHERE club_player_id = ?').get(pid).n;
        if (!anywhere) { db.prepare('DELETE FROM club_players WHERE id = ? AND club_id = ?').run(pid, clubId); orphaned++; }
        else stampLeft(pid, t);
      }
      ID.audit(db, { actor: s.userId, action: 'team.delete', clubId, detail: { team: teamId, playersRemoved: orphaned, rostersKept: held.length - orphaned } }, t);
      return { deleted: true, playersRemoved: orphaned };
    });
    send(res, 200, out);
  }

  return [
    ['GET', new RegExp(`^/api/clubs/${CLUB}/teams$`), list],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/teams$`), upload],
    ['GET', new RegExp(`^/api/clubs/${CLUB}/teams/${TEAM}$`), read],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/teams/${TEAM}/players$`), addPlayer],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/teams/${TEAM}/players/${PLAYER}/remove$`), removePlayer],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/teams/${TEAM}/staff$`), staff],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/teams/${TEAM}/members$`), members],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/teams/${TEAM}/delete$`), remove],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/players/${PLAYER}/forget$`), forgetPlayer],
  ];
}

module.exports = { routes, OWN_SIGN_IN };
