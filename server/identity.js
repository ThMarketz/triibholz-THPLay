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
const { randomBytes, createHash } = require('node:crypto');
const { tx } = require('./db.js');

const HOUR = 3600e3;
const ROLES = ['admin', 'coach', 'trainer', 'player'];
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
function createUser(db, { displayName }, now) {
  const name = String(displayName || '').trim();
  if (!name || name.length > 80) throw fail('bad-name', 'a display name of 1–80 characters is required');
  const id = newId('u');
  const handle = randomBytes(32);   // the WebAuthn user.id: random, not the db id, no personal data
  db.prepare('INSERT INTO users (id, display_name, webauthn_user_handle, created_at) VALUES (?, ?, ?, ?)').run(id, name, handle, now);
  return { id, handle };
}
const getUser = (db, id) => db.prepare('SELECT id, display_name, created_at FROM users WHERE id = ?').get(String(id || '')) || null;

/* ---- clubs ---- */
function createClub(db, { name, actor }, now) {
  const n = String(name || '').trim();
  if (!n || n.length > 120) throw fail('bad-name', 'a club name of 1–120 characters is required');
  return tx(db, () => {
    const id = newId('c');
    db.prepare('INSERT INTO clubs (id, name, created_by, created_at) VALUES (?, ?, ?, ?)').run(id, n, actor, now);
    audit(db, { actor, action: 'club.create', subject: id, clubId: id }, now);
    return id;
  });
}
const getClub = (db, id) => db.prepare('SELECT id, name, created_by, created_at FROM clubs WHERE id = ?').get(String(id || '')) || null;
const listClubs = db => db.prepare(`SELECT c.id, c.name, c.created_at,
    (SELECT count(*) FROM club_members m WHERE m.club_id = c.id AND m.status = 'approved') AS members,
    (SELECT count(*) FROM club_members m WHERE m.club_id = c.id AND m.status = 'approved' AND m.role = 'admin') AS admins
  FROM clubs c ORDER BY c.created_at`).all();

/* ---- memberships ---- */
function lastAdmin(e) { return e && /last-admin/.test(e.message) ? fail('last-admin', 'a club must keep at least one approved admin') : e; }

function addMember(db, { clubId, userId, role, status, actor }, now) {
  if (!ROLES.includes(role)) throw fail('bad-role');
  if (!STATUSES.includes(status)) throw fail('bad-status');
  return tx(db, () => {
    if (!getClub(db, clubId)) throw fail('no-club');
    if (!getUser(db, userId)) throw fail('no-user');
    db.prepare(`INSERT INTO club_members (club_id, user_id, role, status, requested_at, decided_at, decided_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(clubId, userId, role, status, now, status === 'pending' ? null : now, status === 'pending' ? null : actor);
    audit(db, { actor, action: 'member.add', subject: userId, clubId, detail: { role, status } }, now);
  });
}
const getMember = (db, clubId, userId) => db.prepare('SELECT * FROM club_members WHERE club_id = ? AND user_id = ?').get(String(clubId || ''), String(userId || '')) || null;

function updateMember(db, { clubId, userId, role, status, actor }, now) {
  if (role !== undefined && !ROLES.includes(role)) throw fail('bad-role');
  if (status !== undefined && !STATUSES.includes(status)) throw fail('bad-status');
  return tx(db, () => {
    const m = getMember(db, clubId, userId);
    if (!m) throw fail('no-member');
    const next = { role: role === undefined ? m.role : role, status: status === undefined ? m.status : status };
    try {
      db.prepare('UPDATE club_members SET role = ?, status = ?, decided_at = ?, decided_by = ? WHERE club_id = ? AND user_id = ?')
        .run(next.role, next.status, now, actor, clubId, userId);
    } catch (e) { throw lastAdmin(e); }
    audit(db, { actor, action: 'member.update', subject: userId, clubId, detail: { from: { role: m.role, status: m.status }, to: next } }, now);
    return next;
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
function issueCode(db, { kind, clubId = null, userId = null, role = null, actor, ttlMs }, now) {
  if (!CODE_TTL[kind]) throw fail('bad-kind');
  if (role !== null && !ROLES.includes(role)) throw fail('bad-role');
  return tx(db, () => {
    if (clubId !== null && !getClub(db, clubId)) throw fail('no-club');
    if (userId !== null && !getUser(db, userId)) throw fail('no-user');
    const { code, hash } = makeCode();
    const expiresAt = now + (ttlMs || CODE_TTL[kind]);
    db.prepare(`INSERT INTO link_codes (code_hash, kind, user_id, club_id, role, created_by, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(hash, kind, userId, clubId, role, actor, now, expiresAt);
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
  if (!n || !CODE_TTL[kind]) return null;
  const hash = hashCode(n);
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
    const r = db.prepare(`UPDATE link_codes SET revoked_at = ? WHERE ${where.join(' AND ')}`).run(now, ...args);
    if (r.changes) audit(db, { actor, action: 'code.revoke', subject: userId, clubId, detail: { kind, count: r.changes } }, now);
    return r.changes;
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
    challenges: db.prepare('DELETE FROM challenges WHERE expires_at <= ? OR used_at IS NOT NULL').run(now).changes,
    sessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR absolute_expires_at <= ?').run(now, now).changes,
    codes: db.prepare('DELETE FROM link_codes WHERE coalesce(used_at, revoked_at, expires_at) <= ?').run(now - 30 * 24 * HOUR).changes,
  }));
}

module.exports = {
  ROLES, STATUSES, CODE_TTL,
  newId, b64u, normalizeCode, hashCode, makeCode,
  audit, createUser, getUser, deleteUser,
  createClub, getClub, listClubs,
  addMember, getMember, updateMember,
  issueCode, consumeCode, revokeCodes,
  endSessions, purgeExpired,
};
