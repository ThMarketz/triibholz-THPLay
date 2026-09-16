/* ============================================================
   server/identity.js — people, clubs, memberships, single-use codes.

   The storage rules every later slice builds on. No HTTP here: the
   passkey ceremonies (slice 2) and the club API (slice 3) call these.

   · Ids are 128 random bits. Nothing is derived from the clock.
   · A person is one user; memberships are per club, so one person can
     coach in one club and play in another.
   · Codes (invites, pairing, recovery) are 128 random bits shown as 26
     Crockford base32 characters. Only a SHA-256 hash is stored, and a
     code is consumed by a conditional UPDATE — two claims racing for
     the same code get exactly one winner.
   · The audit log records ids and actions, never names or codes.
   · Every function takes `now` (ms) so tests control time.
   ============================================================ */
'use strict';
const { randomBytes, randomInt, createHash } = require('node:crypto');
const { tx } = require('./db.js');

const HOUR = 3600e3, DAY = 24 * HOUR;
const ROLES = ['admin', 'coach', 'trainer', 'player'];
const STAFF_ROLES = ['admin', 'coach', 'trainer'];
const MEMBERSHIP = {
  pendingTtl: 14 * DAY,          // an unanswered request expires
  clubPendingMax: 200,           // open requests per club
  rejoinCooldown: 30 * DAY,      // after a second refusal in a row, one request per 30 days
  abandonedAccount: 45 * DAY,    // never-approved accounts with nothing pending are deleted after this
  joinCodesActiveMax: 10,
  requestsPerClubPerDay: 5,      // join → withdraw → join … cannot cycle without end
};
const STATUSES = ['pending', 'approved', 'denied', 'removed'];
const CODE_TTL = { 'club-admin': 24 * HOUR, 'staff-invite': 72 * HOUR, pair: HOUR / 6, recover: 24 * HOUR, 'player-link': HOUR / 6 };

const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newId = prefix => `${prefix}_${b64u(randomBytes(16))}`;
const sha256hex = s => createHash('sha256').update(s).digest('hex');
const fail = (code, message) => Object.assign(new Error(message || code), { code });

/* ---- codes: 128 bits → 26 chars of Crockford base32 (no I, L, O, U), grouped for reading aloud ---- */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function toBase32(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += CROCKFORD[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}
/* what a person types → the canonical 26 characters, or '' if it cannot be a code */
function normalizeCode(input) {
  const s = String(input || '').toUpperCase().replace(/[\s\-_.]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s) ? s : '';
}
const hashCode = normalized => sha256hex('thp-code:' + normalized);
function makeCode() {
  const raw = toBase32(randomBytes(17)).slice(0, 26);   // 26 × 5 = 130 bits drawn, 128+ kept
  return { code: raw.match(/.{1,5}/g).join('-'), hash: hashCode(raw) };
}

/* ---- audit ---- */
function audit(db, { actor, action, subject = null, clubId = null, detail = null }, now) {
  if (!actor || !action) throw fail('bad-audit', 'audit needs an actor and an action');
  db.prepare('INSERT INTO audit (at, actor, action, subject, club_id, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(now, String(actor), String(action), subject, clubId, detail == null ? null : JSON.stringify(detail));
}

/* ---- users ---- */
function cleanName(displayName) {
  // no control or bidi-override characters: names are shown to other people
  return String(displayName || '').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
}
function createUser(db, { displayName, handle: given }, now) {
  const name = cleanName(displayName);
  if (!name || name.length > 80) throw fail('bad-name', 'a display name of 1–80 characters is required');
  const id = newId('u');
  // the WebAuthn user.id: random, not the db id, no personal data. Registration hands it to the
  // authenticator before the account exists, so it may be passed in.
  const handle = given === undefined ? randomBytes(32) : given;
  if (!Buffer.isBuffer(handle) || handle.length !== 32) throw fail('bad-handle');
  db.prepare('INSERT INTO users (id, display_name, webauthn_user_handle, created_at) VALUES (?, ?, ?, ?)').run(id, name, handle, now);
  return { id, handle };
}
const getUser = (db, id) => db.prepare('SELECT id, display_name, created_at FROM users WHERE id = ?').get(String(id || '')) || null;

/* ---- clubs ---- */
function createClub(db, { name, actor }, now) {
  const n = cleanName(name);
  if (!n || n.length > 120) throw fail('bad-name', 'a club name of 1–120 characters is required');
  return tx(db, () => {
    const id = newId('c');
    db.prepare('INSERT INTO clubs (id, name, created_by, created_at) VALUES (?, ?, ?, ?)').run(id, n, actor, now);
    audit(db, { actor, action: 'club.create', subject: id, clubId: id }, now);
    return id;
  });
}
function renameClub(db, { clubId, name, actor }, now) {
  const n = cleanName(name);
  if (!n || n.length > 120) throw fail('bad-name', 'a club name of 1–120 characters is required');
  return tx(db, () => {
    if (db.prepare('UPDATE clubs SET name = ? WHERE id = ?').run(n, clubId).changes !== 1) throw fail('no-club');
    audit(db, { actor, action: 'club.rename', subject: clubId, clubId }, now);
    return n;
  });
}
const getClub = (db, id) => db.prepare('SELECT id, name, created_by, created_at FROM clubs WHERE id = ?').get(String(id || '')) || null;
const listClubs = db => db.prepare(`SELECT c.id, c.name, c.created_at,
    (SELECT count(*) FROM club_members m WHERE m.club_id = c.id AND m.status = 'approved') AS members,
    (SELECT count(*) FROM club_members m WHERE m.club_id = c.id AND m.status = 'approved' AND m.role = 'admin') AS admins
  FROM clubs c ORDER BY c.created_at`).all();

/* ---- memberships ---- */
function lastAdmin(e) { return e && /last-admin/.test(e.message) ? fail('last-admin', 'a club must keep at least one approved admin') : e; }

/* 4 random digits, unique among the club's open requests (the admin compares them in person) */
function drawRequestNo(db, clubId) {
  const taken = db.prepare("SELECT 1 FROM club_members WHERE club_id = ? AND status = 'pending' AND request_no = ?");
  for (let i = 0; i < 80; i++) { const n = String(randomInt(0, 10000)).padStart(4, '0'); if (!taken.get(clubId, n)) return n; }
  throw fail('too-many-pending');
}
const viaRef = via => (via && via.includes(':') ? via : via || null);

function addMember(db, { clubId, userId, role, status, actor, via = null, action }, now) {
  if (!ROLES.includes(role)) throw fail('bad-role');
  if (!STATUSES.includes(status)) throw fail('bad-status');
  return tx(db, () => {
    if (!getClub(db, clubId)) throw fail('no-club');
    if (!getUser(db, userId)) throw fail('no-user');
    const memberRef = newId('m');
    const requestNo = status === 'pending' ? drawRequestNo(db, clubId) : null;
    db.prepare(`INSERT INTO club_members (club_id, user_id, role, status, requested_at, decided_at, decided_by, member_ref, request_no, via)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(clubId, userId, role, status, now, status === 'pending' ? null : now, status === 'pending' ? null : actor, memberRef, requestNo, via);
    if (status === 'approved') db.prepare('UPDATE users SET ever_approved = 1 WHERE id = ?').run(userId);
    if (status === 'pending') db.prepare('UPDATE users SET last_request_at = ? WHERE id = ?').run(now, userId);
    audit(db, { actor, action: action || (status === 'pending' ? 'member.request' : status === 'approved' ? 'member.approve' : 'member.add'), subject: userId, clubId, detail: { role, status, via: viaRef(via) } }, now);
    return { memberRef, requestNo };
  });
}
const getMember = (db, clubId, userId) => db.prepare('SELECT * FROM club_members WHERE club_id = ? AND user_id = ?').get(String(clubId || ''), String(userId || '')) || null;
const getMemberByRef = (db, clubId, memberRef) => db.prepare('SELECT * FROM club_members WHERE club_id = ? AND member_ref = ?').get(String(clubId || ''), String(memberRef || '')) || null;
const hasVerifiedPasskey = (db, userId) => !!db.prepare("SELECT 1 FROM credentials WHERE user_id = ? AND status = 'active' AND uv = 1 LIMIT 1").get(userId);
const approvedElsewhere = (db, userId) => !!db.prepare("SELECT 1 FROM club_members WHERE user_id = ? AND status = 'approved' LIMIT 1").get(userId);

/* Low-level change (operator tools and tests). The HTTP routes use the specific operations below. */
function updateMember(db, { clubId, userId, role, status, actor, action = 'member.update' }, now) {
  if (role !== undefined && !ROLES.includes(role)) throw fail('bad-role');
  if (status !== undefined && !STATUSES.includes(status)) throw fail('bad-status');
  return tx(db, () => {
    const m = getMember(db, clubId, userId);
    if (!m) throw fail('no-member');
    const next = { role: role === undefined ? m.role : role, status: status === undefined ? m.status : status };
    try {
      db.prepare('UPDATE club_members SET role = ?, status = ?, decided_at = ?, decided_by = ?, request_no = CASE WHEN ? = \'pending\' THEN request_no ELSE NULL END WHERE club_id = ? AND user_id = ?')
        .run(next.role, next.status, now, actor, next.status, clubId, userId);
    } catch (e) { throw lastAdmin(e); }
    if (next.status === 'approved') db.prepare('UPDATE users SET ever_approved = 1 WHERE id = ?').run(userId);
    if (m.role === 'admin' && (next.role !== 'admin' || next.status !== 'approved')) loseAdmin(db, { clubId, userId, actor }, now);
    audit(db, { actor, action, subject: userId, clubId, detail: { from: { role: m.role, status: m.status }, to: next } }, now);
    return next;
  });
}

/* Ask to join (or ask again). A denied or removed row is reset, never duplicated; it keeps what
   happened last time in prev_*. With `cooldown`, a second refusal in a row means one request per
   30 days. Counts are checked here, inside the caller's transaction, so racing requests cannot
   pass a cap together. → { already } for someone already pending or approved, else the new request. */
function requestMembership(db, { clubId, userId, role, via, cooldown = false, maxPendingVia = null }, now) {
  return tx(db, () => {
    const m = getMember(db, clubId, userId);
    if (m && (m.status === 'pending' || m.status === 'approved')) return { already: m };
    if (cooldown && m && ['denied', 'removed'].includes(m.prev_status) && now - (m.decided_at || 0) < MEMBERSHIP.rejoinCooldown) throw fail('ask-your-admin');
    if (db.prepare("SELECT count(*) AS n FROM audit WHERE action = 'member.request' AND subject = ? AND club_id = ? AND at > ?").get(userId, clubId, now - DAY).n >= MEMBERSHIP.requestsPerClubPerDay) throw fail('too-many-requests-for-club');
    const pending = db.prepare("SELECT count(*) AS n FROM club_members WHERE club_id = ? AND status = 'pending'").get(clubId).n;
    if (pending >= MEMBERSHIP.clubPendingMax) throw fail('too-many-pending');
    if (maxPendingVia !== null && db.prepare("SELECT count(*) AS n FROM club_members WHERE club_id = ? AND status = 'pending' AND via = ?").get(clubId, via).n >= maxPendingVia) throw fail('too-many-pending');
    const requestNo = drawRequestNo(db, clubId);
    let memberRef;
    if (m) {
      const r = db.prepare(`UPDATE club_members SET role = ?, status = 'pending', requested_at = ?, decided_at = NULL, decided_by = NULL,
                              request_no = ?, via = ?, prev_status = status, prev_decided_at = decided_at, prev_decided_by = decided_by
                            WHERE club_id = ? AND user_id = ? AND status = ?`).run(role, now, requestNo, via, clubId, userId, m.status);
      if (r.changes !== 1) throw fail('request-changed');
      memberRef = m.member_ref;
    } else {
      memberRef = newId('m');
      db.prepare(`INSERT INTO club_members (club_id, user_id, role, status, requested_at, member_ref, request_no, via)
                  VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`).run(clubId, userId, role, now, memberRef, requestNo, via);
    }
    db.prepare('UPDATE users SET last_request_at = ? WHERE id = ?').run(now, userId);
    audit(db, { actor: userId, action: 'member.request', subject: userId, clubId, detail: { role, via: viaRef(via), again: !!m } }, now);
    return { memberRef, requestNo, role, status: 'pending', expiresAt: now + MEMBERSHIP.pendingTtl };
  });
}

/* Approve or deny an open request. The admin must give the request number: the row is changed only
   if it is still that request (not decided, expired or re-requested meanwhile). */
function decideRequest(db, { clubId, memberRef, requestNo, approve, actor }, now) {
  return tx(db, () => {
    const m = getMemberByRef(db, clubId, memberRef);
    if (!m || m.status !== 'pending') throw fail('request-changed');
    const r = db.prepare(`UPDATE club_members SET status = ?, decided_at = ?, decided_by = ?, request_no = NULL
                            ${approve ? ', prev_status = NULL, prev_decided_at = NULL, prev_decided_by = NULL' : ''}
                          WHERE club_id = ? AND member_ref = ? AND status = 'pending' AND request_no = ?`)
      .run(approve ? 'approved' : 'denied', now, actor, clubId, memberRef, String(requestNo || ''));
    if (r.changes !== 1) throw fail('request-changed');
    if (approve) db.prepare('UPDATE users SET ever_approved = 1 WHERE id = ?').run(m.user_id);
    audit(db, { actor, action: approve ? 'member.approve' : 'member.deny', subject: m.user_id, clubId, detail: { role: m.role, via: viaRef(m.via) } }, now);
    return { ...m, status: approve ? 'approved' : 'denied' };
  });
}

/* Someone stops being an admin: the staff invites they sent die with it (unused ones revoked, open
   requests that came through any of them denied), and their step-up no longer counts. Join codes
   belong to the club and stay. Runs inside the caller's transaction. */
function loseAdmin(db, { clubId, userId, actor }, now) {
  const refs = db.prepare("SELECT substr(code_hash, 1, 8) AS ref FROM link_codes WHERE club_id = ? AND created_by = ? AND kind = 'staff-invite'").all(clubId, userId).map(r => r.ref);
  const revoked = db.prepare("UPDATE link_codes SET revoked_at = ? WHERE club_id = ? AND created_by = ? AND kind = 'staff-invite' AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?").run(now, clubId, userId, now).changes;
  if (revoked) audit(db, { actor, action: 'code.revoke', subject: userId, clubId, detail: { kind: 'staff-invite', count: revoked, reason: 'issuer-no-longer-admin' } }, now);
  let denied = 0;
  for (const ref of refs) {
    for (const p of db.prepare("SELECT user_id, role FROM club_members WHERE club_id = ? AND status = 'pending' AND via = ?").all(clubId, 'staff-invite:' + ref)) {
      db.prepare("UPDATE club_members SET status = 'denied', decided_at = ?, decided_by = ?, request_no = NULL WHERE club_id = ? AND user_id = ? AND status = 'pending'").run(now, actor, clubId, p.user_id);
      audit(db, { actor, action: 'member.deny', subject: p.user_id, clubId, detail: { role: p.role, via: 'staff-invite:' + ref, reason: 'issuer-no-longer-admin' } }, now);
      denied++;
    }
  }
  db.prepare('UPDATE sessions SET stepup_at = NULL WHERE user_id = ?').run(userId);
  return { revoked, denied };
}

/* A person who stops being staff of a club stops being staff of its teams: the club_team_staff row
   is not deleted by any cascade, because a demotion or a removal only CHANGES the club_members row
   rather than deleting it. Leaving the club takes the team memberships too; a demotion does not —
   a coach who becomes a player is still on the team a coach may write to.
   Called inside the caller's transaction, and audits counts only. */
function loseTeamRoles(db, { clubId, userId, actor, staffOnly = false }, now) {
  const staff = db.prepare('DELETE FROM club_team_staff WHERE club_id = ? AND user_id = ?').run(clubId, userId).changes;
  const member = staffOnly ? 0 : db.prepare('DELETE FROM club_team_members WHERE club_id = ? AND user_id = ?').run(clubId, userId).changes;
  if (staff || member) audit(db, { actor, action: 'team.lose-roles', subject: userId, clubId, detail: { staff, member } }, now);
  return { staff, member };
}

function changeRole(db, { clubId, memberRef, role, actor }, now) {
  if (!ROLES.includes(role)) throw fail('bad-role');
  return tx(db, () => {
    const m = getMemberByRef(db, clubId, memberRef);
    if (!m || m.status !== 'approved') throw fail('no-member');
    if (m.role === role) return m;
    if (STAFF_ROLES.includes(role) && !hasVerifiedPasskey(db, m.user_id)) throw fail('needs-verified-passkey');
    try {
      const r = db.prepare("UPDATE club_members SET role = ?, decided_at = ?, decided_by = ? WHERE club_id = ? AND member_ref = ? AND status = 'approved' AND role = ?").run(role, now, actor, clubId, memberRef, m.role);
      if (r.changes !== 1) throw fail('request-changed');
    } catch (e) { throw lastAdmin(e); }
    if (m.role === 'admin') loseAdmin(db, { clubId, userId: m.user_id, actor }, now);
    if (!STAFF_ROLES.includes(role)) loseTeamRoles(db, { clubId, userId: m.user_id, actor, staffOnly: true }, now);
    audit(db, { actor, action: 'member.role', subject: m.user_id, clubId, detail: { from: m.role, to: role } }, now);
    return { ...m, role };
  });
}

/* Removal by an admin, or leaving. Ends the approved membership, runs the lose-admin cascade, and —
   if the person has no approved membership left anywhere — ends all their sessions. */
function endMembership(db, { clubId, memberRef, actor, action = 'member.remove', revokeJoinCodes = false }, now) {
  return tx(db, () => {
    const m = getMemberByRef(db, clubId, memberRef);
    if (!m || m.status !== 'approved') throw fail('no-member');
    try {
      const r = db.prepare("UPDATE club_members SET status = 'removed', decided_at = ?, decided_by = ?, request_no = NULL WHERE club_id = ? AND member_ref = ? AND status = 'approved'").run(now, actor, clubId, memberRef);
      if (r.changes !== 1) throw fail('request-changed');
    } catch (e) { throw lastAdmin(e); }
    loseAdmin(db, { clubId, userId: m.user_id, actor }, now);
    loseTeamRoles(db, { clubId, userId: m.user_id, actor }, now);
    if (revokeJoinCodes) {
      const n = db.prepare('UPDATE club_join_codes SET revoked_at = ? WHERE club_id = ? AND created_by = ? AND revoked_at IS NULL AND expires_at > ?').run(now, clubId, m.user_id, now).changes;
      if (n) audit(db, { actor, action: 'code.revoke', subject: m.user_id, clubId, detail: { kind: 'join', count: n } }, now);
    }
    audit(db, { actor, action, subject: m.user_id, clubId, detail: { role: m.role } }, now);
    let signedOut = false;
    if (!approvedElsewhere(db, m.user_id)) {
      const n = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(m.user_id).changes;
      audit(db, { actor, action: 'session.end-all', subject: m.user_id, detail: { count: n } }, now);   // no club_id: says nothing to the club about elsewhere
      signedOut = true;
    }
    return { userId: m.user_id, signedOut };
  });
}

/* An open request that ends without a decision (taken back, or expired). It never counts as a refusal
   — and never erases one: a request made after a refusal or removal puts that earlier decision back
   (same row, same member_ref, the 30-day clock untouched); a first-ever request simply goes. */
function closeOpenRequest(db, m, extraWhere = '', extraArgs = []) {
  const r = m.prev_status
    ? db.prepare(`UPDATE club_members SET status = prev_status, decided_at = prev_decided_at, decided_by = prev_decided_by, request_no = NULL,
                    prev_status = NULL, prev_decided_at = NULL, prev_decided_by = NULL
                  WHERE club_id = ? AND user_id = ? AND status = 'pending' AND prev_status IS NOT NULL ${extraWhere}`).run(m.club_id, m.user_id, ...extraArgs)
    : db.prepare(`DELETE FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'pending' AND prev_status IS NULL ${extraWhere}`).run(m.club_id, m.user_id, ...extraArgs);
  return r.changes === 1;
}
function withdrawRequest(db, { clubId, userId }, now) {
  return tx(db, () => {
    const m = getMember(db, clubId, userId);
    if (!m || m.status !== 'pending') throw fail('no-member');
    if (!closeOpenRequest(db, m)) throw fail('request-changed');
    audit(db, { actor: userId, action: 'member.withdraw', subject: userId, clubId, detail: { role: m.role, via: viaRef(m.via) } }, now);
  });
}

/* An operator club-admin code redeemed by an existing account: admin at once (new row, a reset row,
   or a raised role). */
function grantAdmin(db, { clubId, userId, actor }, now) {
  return tx(db, () => {
    const m = getMember(db, clubId, userId);
    if (m && m.status === 'approved' && m.role === 'admin') return { already: m };
    let memberRef;
    if (m) {
      db.prepare(`UPDATE club_members SET role = 'admin', status = 'approved', decided_at = ?, decided_by = ?, request_no = NULL, via = 'operator',
                    prev_status = NULL, prev_decided_at = NULL, prev_decided_by = NULL WHERE club_id = ? AND user_id = ?`).run(now, actor, clubId, userId);
      memberRef = m.member_ref;
    } else {
      memberRef = addMember(db, { clubId, userId, role: 'admin', status: 'approved', actor, via: 'operator' }, now).memberRef;
      return { memberRef, role: 'admin', status: 'approved' };
    }
    db.prepare('UPDATE users SET ever_approved = 1 WHERE id = ?').run(userId);
    audit(db, { actor, action: 'member.approve', subject: userId, clubId, detail: { role: 'admin', via: 'operator', from: { role: m.role, status: m.status } } }, now);
    return { memberRef, role: 'admin', status: 'approved' };
  });
}

function deleteUser(db, { userId, actor }, now) {
  return tx(db, () => {
    if (!getUser(db, userId)) throw fail('no-user');
    try { db.prepare('DELETE FROM users WHERE id = ?').run(userId); } catch (e) { throw lastAdmin(e); }
    audit(db, { actor, action: 'user.delete', subject: userId }, now);
  });
}

/* ---- single-use codes ---- */
/* a new code whose short ref (first 8 hex of the hash) is unique within its club, across both tables */
function makeClubCode(db, clubId) {
  for (let i = 0; i < 8; i++) {
    const c = makeCode(), ref = c.hash.slice(0, 8);
    if (clubId === null) return c;
    const clash = db.prepare('SELECT 1 FROM link_codes WHERE club_id = ? AND substr(code_hash, 1, 8) = ? UNION SELECT 1 FROM club_join_codes WHERE club_id = ? AND substr(code_hash, 1, 8) = ?').get(clubId, ref, clubId, ref);
    if (!clash) return c;
  }
  throw fail('busy');
}
function cleanLabel(label) {
  const l = cleanName(label);
  if (l.length > 60) throw fail('bad-label', 'a label is at most 60 characters');
  return l || null;
}

function issueCode(db, { kind, clubId = null, userId = null, role = null, actor, ttlMs, label = null }, now) {
  if (!CODE_TTL[kind]) throw fail('bad-kind');
  if (role !== null && !ROLES.includes(role)) throw fail('bad-role');
  const cleanedLabel = label === null ? null : cleanLabel(label);
  return tx(db, () => {
    if (clubId !== null && !getClub(db, clubId)) throw fail('no-club');
    if (userId !== null && !getUser(db, userId)) throw fail('no-user');
    const { code, hash } = makeClubCode(db, clubId);
    const expiresAt = now + (ttlMs || CODE_TTL[kind]);
    db.prepare(`INSERT INTO link_codes (code_hash, kind, user_id, club_id, role, created_by, created_at, expires_at, label)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(hash, kind, userId, clubId, role, actor, now, expiresAt, cleanedLabel);
    audit(db, { actor, action: 'code.issue', subject: userId, clubId, detail: { kind, role, expiresAt, ref: hash.slice(0, 8) } }, now);
    return { code, expiresAt, ref: hash.slice(0, 8) };
  });
}

/* Claim a code for `kind`. Returns its row, or null for anything wrong (unknown, other kind,
   used, revoked, expired) — the caller cannot tell which, and neither can an attacker.
   Runs in the caller's transaction when there is one, so the claim and whatever it grants
   commit or roll back together. */
function consumeCode(db, { code, kind, usedBy = null }, now) {
  const n = normalizeCode(code);
  if (!n) return null;
  return consumeCodeHash(db, { hash: hashCode(n), kind, usedBy }, now);
}
/* the same, for a code already reduced to its hash (kept on a challenge between two requests) */
function consumeCodeHash(db, { hash, kind, usedBy = null }, now) {
  if (!CODE_TTL[kind] || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return null;
  return tx(db, () => {
    const r = db.prepare(`UPDATE link_codes SET used_at = ?, used_by = ?
                          WHERE code_hash = ? AND kind = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`)
      .run(now, usedBy, hash, kind, now);
    if (r.changes !== 1) return null;
    const row = db.prepare('SELECT code_hash, kind, user_id, club_id, role, created_by, created_at, expires_at FROM link_codes WHERE code_hash = ?').get(hash);
    audit(db, { actor: usedBy || 'anonymous', action: 'code.use', subject: row.user_id, clubId: row.club_id, detail: { kind, ref: hash.slice(0, 8) } }, now);
    return row;
  });
}

function revokeCodes(db, { userId = null, clubId = null, kind = null, actor }, now) {
  return tx(db, () => {
    const where = ['used_at IS NULL', 'revoked_at IS NULL', 'expires_at > ?']; const args = [now];
    if (userId) { where.push('user_id = ?'); args.push(userId); }
    if (clubId) { where.push('club_id = ?'); args.push(clubId); }
    if (kind) { where.push('kind = ?'); args.push(kind); }
    if (args.length === 1) throw fail('too-broad', 'say whose codes to revoke');
    let n = db.prepare(`UPDATE link_codes SET revoked_at = ? WHERE ${where.join(' AND ')}`).run(now, ...args).changes;
    // a club's join codes too, when revoking by club (they are not anyone's personal code)
    if (clubId && !userId && (!kind || kind === 'join')) n += db.prepare('UPDATE club_join_codes SET revoked_at = ? WHERE club_id = ? AND revoked_at IS NULL AND expires_at > ?').run(now, clubId, now).changes;
    if (n) audit(db, { actor, action: 'code.revoke', subject: userId, clubId, detail: { kind, count: n } }, now);
    return n;
  });
}

/* A code that could still be claimed — for showing a form, never for granting anything. */
function peekCode(db, { code, kinds }, now) {
  const n = normalizeCode(code);
  if (!n) return null;
  const hash = hashCode(n);
  const row = db.prepare('SELECT code_hash, kind, user_id, club_id, role, expires_at FROM link_codes WHERE code_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?').get(hash, now);
  return row && kinds.includes(row.kind) ? row : null;
}

/* ---- join codes: multi-use, player role only ---- */
function issueJoinCode(db, { clubId, label = null, days = 30, maxPending = 60, actor }, now) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw fail('bad-days', 'a join code lasts 1–90 days');
  if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 200) throw fail('bad-max-pending', 'maxPending is 1–200');
  const cleanedLabel = label === null ? null : cleanLabel(label);
  return tx(db, () => {
    if (!getClub(db, clubId)) throw fail('no-club');
    if (db.prepare('SELECT count(*) AS n FROM club_join_codes WHERE club_id = ? AND revoked_at IS NULL AND expires_at > ?').get(clubId, now).n >= MEMBERSHIP.joinCodesActiveMax) throw fail('too-many-join-codes');
    const { code, hash } = makeClubCode(db, clubId);
    const expiresAt = now + days * DAY;
    db.prepare(`INSERT INTO club_join_codes (code_hash, club_id, label, max_pending, created_by, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(hash, clubId, cleanedLabel, maxPending, actor, now, expiresAt);
    audit(db, { actor, action: 'code.issue', clubId, detail: { kind: 'join', ref: hash.slice(0, 8), expiresAt, maxPending } }, now);
    return { code, ref: hash.slice(0, 8), expiresAt, maxPending };
  });
}

/* Any code a person may type to get into a club, still usable: an operator club-admin code, a staff
   invite, or a join code. Never for granting anything by itself. */
function findCode(db, code, now) {
  const n = normalizeCode(code);
  if (!n) return null;
  const hash = hashCode(n);
  const link = db.prepare("SELECT kind, club_id, role, created_by FROM link_codes WHERE code_hash = ? AND kind IN ('club-admin', 'staff-invite') AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?").get(hash, now);
  if (link && link.club_id) return { table: 'link', kind: link.kind, clubId: link.club_id, role: link.role, hash, ref: hash.slice(0, 8), createdBy: link.created_by };
  const join = db.prepare('SELECT club_id, max_pending, created_by FROM club_join_codes WHERE code_hash = ? AND revoked_at IS NULL AND expires_at > ?').get(hash, now);
  if (join) return { table: 'join', kind: 'join', clubId: join.club_id, role: 'player', hash, ref: hash.slice(0, 8), maxPending: join.max_pending, createdBy: join.created_by };
  return null;
}
/* count one use of a join code, if it is still usable (in the caller's transaction) */
function claimJoinCodeHash(db, { hash }, now) {
  return db.prepare('UPDATE club_join_codes SET uses = uses + 1 WHERE code_hash = ? AND revoked_at IS NULL AND expires_at > ?').run(hash, now).changes === 1;
}

/* Revoke one of a club's codes by its short ref. A join code may also take every open request that
   came through it down with it. → { denied } or throws no-code. */
function revokeClubCode(db, { clubId, table, ref, actor, denyPending = false }, now) {
  if (!/^[0-9a-f]{8}$/.test(String(ref))) throw fail('no-code');
  return tx(db, () => {
    const r = table === 'join'
      ? db.prepare('UPDATE club_join_codes SET revoked_at = ? WHERE club_id = ? AND substr(code_hash, 1, 8) = ? AND revoked_at IS NULL AND expires_at > ?').run(now, clubId, ref, now)
      : db.prepare("UPDATE link_codes SET revoked_at = ? WHERE club_id = ? AND kind = 'staff-invite' AND substr(code_hash, 1, 8) = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?").run(now, clubId, ref, now);
    // clearing a flood still works after the link was revoked plainly, or ran out on its own
    const exists = table === 'join' && denyPending && db.prepare('SELECT 1 FROM club_join_codes WHERE club_id = ? AND substr(code_hash, 1, 8) = ?').get(clubId, ref);
    if (r.changes !== 1 && !exists) throw fail('no-code');
    let denied = 0;
    if (denyPending && table === 'join') {
      denied = db.prepare("UPDATE club_members SET status = 'denied', decided_at = ?, decided_by = ?, request_no = NULL WHERE club_id = ? AND status = 'pending' AND via = ?").run(now, actor, clubId, 'join:' + ref).changes;
    }
    audit(db, { actor, action: 'code.revoke', clubId, detail: { kind: table === 'join' ? 'join' : 'staff-invite', ref, deniedRequests: denied, alreadyInactive: r.changes !== 1 } }, now);
    return { denied, revoked: r.changes === 1 };
  });
}

/* ---- sessions (created in slice 2; ended here so the operator can always do it) ---- */
function endSessions(db, { userId, actor }, now) {
  return tx(db, () => {
    if (!getUser(db, userId)) throw fail('no-user');
    const r = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    audit(db, { actor, action: 'session.end-all', subject: userId, detail: { count: r.changes } }, now);
    return r.changes;
  });
}

/* Housekeeping: expired challenges and sessions go at once; codes stay 30 days after they stop
   being usable (the audit log keeps the history either way). */
function purgeExpired(db, now) {
  return tx(db, () => ({
    requests: expireRequests(db, now),
    challenges: db.prepare('DELETE FROM challenges WHERE expires_at <= ?').run(now).changes,   // a used one stays until expiry: it blocks replays
    sessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR absolute_expires_at <= ?').run(now, now).changes,
    codes: db.prepare('DELETE FROM link_codes WHERE coalesce(used_at, revoked_at, expires_at) <= ?').run(now - 30 * 24 * HOUR).changes,
    limits: db.prepare('DELETE FROM rate_limits WHERE window_start <= ?').run(now - 24 * HOUR).changes,
  }));
}
/* everything the minute timer and `admin.js purge` run; the account sweep outside the big transaction */
function housekeeping(db, now) {
  const out = {};
  try { Object.assign(out, purgeExpired(db, now)); } catch (e) { console.error('[identity] housekeeping', e.message); }
  try { out.accounts = purgeAbandonedAccounts(db, now); } catch (e) { console.error('[identity] housekeeping accounts', e.message); }
  return out;
}
function expireRequests(db, now) {
  const cutoff = now - MEMBERSHIP.pendingTtl;
  const old = db.prepare("SELECT * FROM club_members WHERE status = 'pending' AND requested_at <= ?").all(cutoff);
  for (const m of old) {
    if (closeOpenRequest(db, m, 'AND requested_at <= ?', [cutoff])) {
      audit(db, { actor: 'system', action: 'member.expired', subject: m.user_id, clubId: m.club_id, detail: { role: m.role, via: viaRef(m.via) } }, now);
    }
  }
  return old.length;
}
/* Accounts that never had an approved membership, have nothing pending, and have not asked for
   anything in 45 days (a flood's leftovers, or someone who never came back). One transaction per
   account, each re-checking the conditions; a failure is skipped, never blocks the rest. */
function purgeAbandonedAccounts(db, now) {
  const cutoff = now - MEMBERSHIP.abandonedAccount;
  const gone = `ever_approved = 0 AND coalesce(last_request_at, created_at) <= ?
                AND NOT EXISTS (SELECT 1 FROM club_members m WHERE m.user_id = users.id AND m.status IN ('pending', 'approved'))`;
  let n = 0;
  for (const u of db.prepare(`SELECT id FROM users WHERE ${gone}`).all(cutoff)) {
    try {
      tx(db, () => {
        if (db.prepare(`DELETE FROM users WHERE id = ? AND ${gone}`).run(u.id, cutoff).changes) {
          audit(db, { actor: 'system', action: 'user.expired', subject: u.id }, now);
          n++;
        }
      });
    } catch (e) { console.error('[identity] could not delete abandoned account', u.id, e.message); }
  }
  return n;
}

module.exports = {
  ROLES, STATUSES, STAFF_ROLES, CODE_TTL, MEMBERSHIP,
  newId, b64u, normalizeCode, hashCode, makeCode,
  audit, createUser, getUser, deleteUser,
  createClub, getClub, listClubs, renameClub,
  addMember, getMember, getMemberByRef, updateMember, hasVerifiedPasskey, approvedElsewhere,
  requestMembership, decideRequest, changeRole, loseTeamRoles, endMembership, withdrawRequest, grantAdmin, loseAdmin,
  issueCode, consumeCode, consumeCodeHash, peekCode, revokeCodes, cleanName,
  issueJoinCode, findCode, claimJoinCodeHash, revokeClubCode,
  endSessions, purgeExpired, expireRequests, purgeAbandonedAccounts, housekeeping,
};
