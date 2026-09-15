/* ============================================================
   server/clubs.js — clubs and memberships over HTTP (slice 3).

   Routes are mounted by auth.js, so they share its request rules (POST:
   Origin allow-list, JSON, 64 kB, 10 s; everything no-store, no CORS)
   and its sessions. docs/ACCOUNTS.md "Clubs and membership" has the rules
   and why.

   Every route follows one order: body → clock → session → ONE synchronous
   transaction that checks, in this order, an approved role in the club
   (404 otherwise — the same 404 whether the club, the person or the right
   is missing), a verified session for staff (403), a fresh step-up where
   needed (403), the target (404), the body (400), the rules (409/429) —
   then writes with a conditional UPDATE and audits. Nothing is checked
   outside the transaction that writes.

   A club sees people by member_ref (per club), never by their account id,
   so two clubs cannot match their lists.
   ============================================================ */
'use strict';
const { createHmac, randomBytes } = require('node:crypto');
const { tx } = require('./db.js');
const ID = require('./identity.js');

const CLUB = '(c_[A-Za-z0-9_-]{22})', MEMBER = '(m_[A-Za-z0-9_-]{22})', REF = '([0-9a-f]{8})';
const STAFF = ID.STAFF_ROLES;
const DAY = 24 * 3600e3;

/* names compared the way a person reads them: NFKC, case-folded, accents stripped */
const fold = s => String(s || '').normalize('NFKC').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const mixedScript = s => /\p{Script=Latin}/u.test(s) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(s);

function routes(core) {
  const { db, now, send, readJson, httpError, tooMany, requireSession, freshSession, steppedUp, overLimit, clientAddress, clearCookie, LIMITS } = core;

  /* A former member's short ref in the audit: derived from the ids alone (keyed hash, per club), so it
     never changes when their row or account is deleted — a vanishing ref would tell the club
     something about the person's activity elsewhere. */
  const auditKey = tx(db, () => {
    db.prepare('INSERT OR IGNORE INTO server_keys (name, secret, created_at) VALUES (?, ?, ?)').run('audit-ref', randomBytes(32), now());
    return Buffer.from(db.prepare('SELECT secret FROM server_keys WHERE name = ?').get('audit-ref').secret);
  });
  const formerRef = (clubId, id) => createHmac('sha256', auditKey).update(clubId + ':' + id).digest('base64url').slice(0, 6);

  /* inside a transaction: the caller's approved membership with one of `roles`, or the one 404 */
  function guard(session, clubId, { roles, stepUp = false }, t) {
    const m = db.prepare("SELECT * FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'approved'").get(clubId, session.userId);
    if (!m || !roles.includes(m.role)) throw httpError(404, 'not-found');
    if (STAFF.includes(m.role) && !freshSession(session).uv) throw httpError(403, 'user-verification-required');
    if (stepUp && !steppedUp(session, t)) throw httpError(403, 'step-up-required');
    return m;
  }
  const target = (clubId, memberRef, status) => {
    const m = ID.getMemberByRef(db, clubId, memberRef);
    if (!m || (status && ![].concat(status).includes(m.status))) throw httpError(404, 'not-found');
    return m;
  };
  const nameOf = userId => (db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) || {}).display_name || null;
  const viaLabel = (clubId, via) => {
    if (!via) return null;
    if (via === 'operator') return { kind: 'operator' };
    const [kind, ref] = via.split(':');
    const row = kind === 'join'
      ? db.prepare('SELECT label FROM club_join_codes WHERE club_id = ? AND substr(code_hash, 1, 8) = ?').get(clubId, ref)
      : db.prepare("SELECT label FROM link_codes WHERE club_id = ? AND kind = 'staff-invite' AND substr(code_hash, 1, 8) = ?").get(clubId, ref);
    return { kind, ref, label: row ? row.label : null };
  };

  /* ---- the club ---- */
  async function club(req, res, clubId) {
    const s = requireSession(req), t = now();
    const out = tx(db, () => {
      const me = guard(s, clubId, { roles: ID.ROLES }, t);
      const c = ID.getClub(db, clubId);
      const body = { id: c.id, name: c.name, myRole: me.role, memberRef: me.member_ref };
      if (me.role === 'admin') {
        body.adminCount = db.prepare("SELECT count(*) AS n FROM club_members WHERE club_id = ? AND status = 'approved' AND role = 'admin'").get(clubId).n;
        body.pendingCount = db.prepare("SELECT count(*) AS n FROM club_members WHERE club_id = ? AND status = 'pending'").get(clubId).n;
        // cloned-passkey alarms for people approved here (the alarm itself carries no club)
        body.alerts = db.prepare(`SELECT a.at, m.member_ref, u.display_name FROM audit a
                                    JOIN club_members m ON m.user_id = a.subject AND m.club_id = ? AND m.status = 'approved'
                                    JOIN users u ON u.id = m.user_id
                                  WHERE a.action = 'credential.suspect' AND a.at > ? ORDER BY a.at DESC LIMIT 20`).all(clubId, t - 30 * DAY)
          .map(r => ({ kind: 'passkey-suspect', at: r.at, memberRef: r.member_ref, name: r.display_name }));
      }
      return body;
    });
    send(res, 200, out);
  }

  async function rename(req, res, clubId) {
    const body = await readJson(req); const t = now(); const s = requireSession(req);
    const name = tx(db, () => { guard(s, clubId, { roles: ['admin'], stepUp: true }, t); return ID.renameClub(db, { clubId, name: body.name, actor: s.userId }, t); });
    send(res, 200, { name });
  }

  /* ---- members ---- */
  async function members(req, res, clubId) {
    const s = requireSession(req), t = now();
    const out = tx(db, () => {
      guard(s, clubId, { roles: ['admin'] }, t);
      const rows = db.prepare(`SELECT m.*, u.display_name FROM club_members m JOIN users u ON u.id = m.user_id
                               WHERE m.club_id = ? AND m.status IN ('pending', 'approved') ORDER BY m.status DESC, m.requested_at`).all(clubId);
      const counts = new Map();
      rows.forEach(r => counts.set(fold(r.display_name), (counts.get(fold(r.display_name)) || 0) + 1));
      return rows.map(r => r.status === 'pending'
        ? { memberRef: r.member_ref, name: r.display_name, role: r.role, status: 'pending', requestNo: r.request_no, requestedAt: r.requested_at,
            expiresAt: r.requested_at + ID.MEMBERSHIP.pendingTtl, via: viaLabel(clubId, r.via),
            previously: r.prev_status ? { status: r.prev_status, at: r.prev_decided_at } : null,
            sameName: counts.get(fold(r.display_name)) > 1, mixedScript: mixedScript(r.display_name) }
        : { memberRef: r.member_ref, name: r.display_name, role: r.role, status: 'approved', sameName: counts.get(fold(r.display_name)) > 1 });
    });
    send(res, 200, { members: out });
  }

  const decide = approve => async (req, res, clubId, memberRef) => {
    const body = await readJson(req); const t = now(); const s = requireSession(req);
    const out = tx(db, () => {
      guard(s, clubId, { roles: ['admin'] }, t);
      const m = target(clubId, memberRef, 'pending');
      if (typeof body.requestNo !== 'string' || !/^\d{4}$/.test(body.requestNo)) throw httpError(400, 'bad-request-no');
      if (approve && STAFF.includes(m.role)) {
        if (!steppedUp(s, t)) throw httpError(403, 'step-up-required');
        if (!ID.hasVerifiedPasskey(db, m.user_id)) throw httpError(409, 'needs-verified-passkey');
      }
      const d = ID.decideRequest(db, { clubId, memberRef, requestNo: body.requestNo, approve, actor: s.userId }, t);
      return { memberRef, role: d.role, status: d.status };
    });
    send(res, 200, out);
  };

  async function role(req, res, clubId, memberRef) {
    const body = await readJson(req); const t = now(); const s = requireSession(req);
    const out = tx(db, () => {
      guard(s, clubId, { roles: ['admin'], stepUp: true }, t);
      target(clubId, memberRef, 'approved');
      if (!ID.ROLES.includes(body.role)) throw httpError(400, 'bad-role');
      const m = ID.changeRole(db, { clubId, memberRef, role: body.role, actor: s.userId }, t);
      return { memberRef, role: m.role };
    });
    send(res, 200, out);
  }

  async function remove(req, res, clubId, memberRef) {
    const body = await readJson(req); const t = now(); const s = requireSession(req);
    const out = tx(db, () => {
      guard(s, clubId, { roles: ['admin'], stepUp: true }, t);
      target(clubId, memberRef, 'approved');
      return ID.endMembership(db, { clubId, memberRef, actor: s.userId, action: 'member.remove', revokeJoinCodes: body.revokeJoinCodes === true }, t);
    });
    // nothing about sessions or other clubs in the answer
    send(res, 200, { ok: true }, out.userId === s.userId && out.signedOut ? clearCookie() : undefined);
  }

  async function leave(req, res, clubId) {
    await readJson(req); const t = now(); const s = requireSession(req);
    const out = tx(db, () => {
      const m = ID.getMember(db, clubId, s.userId);
      if (!m || !['pending', 'approved'].includes(m.status)) throw httpError(404, 'not-found');
      if (m.status === 'pending') { ID.withdrawRequest(db, { clubId, userId: s.userId }, t); return { withdrawn: true }; }
      if (STAFF.includes(m.role)) guard(s, clubId, { roles: STAFF, stepUp: true }, t);
      return ID.endMembership(db, { clubId, memberRef: m.member_ref, actor: s.userId, action: 'member.leave' }, t);
    });
    send(res, 200, { ok: true, withdrawn: !!out.withdrawn }, out.signedOut ? clearCookie() : undefined);
  }

  /* ---- codes ---- */
  async function createJoinCode(req, res, clubId) {
    const body = await readJson(req); const t = now(); const s = requireSession(req);
    const out = tx(db, () => {
      guard(s, clubId, { roles: ['admin'], stepUp: true }, t);
      const days = body.days === undefined ? 30 : body.days, maxPending = body.maxPending === undefined ? 60 : body.maxPending;
      return ID.issueJoinCode(db, { clubId, label: body.label === undefined ? null : body.label, days, maxPending, actor: s.userId }, t);
    });
    send(res, 200, out);   // the code is shown this once
  }

  async function listJoinCodes(req, res, clubId) {
    const s = requireSession(req), t = now();
    const out = tx(db, () => {
      guard(s, clubId, { roles: ['admin'] }, t);
      return db.prepare(`SELECT code_hash, label, uses, max_pending, created_at, expires_at, revoked_at FROM club_join_codes
                         WHERE club_id = ? AND coalesce(revoked_at, expires_at) > ? ORDER BY created_at DESC`).all(clubId, t - 30 * DAY)
        .map(c => { const ref = c.code_hash.slice(0, 8); return {
          ref, label: c.label, uses: c.uses, maxPending: c.max_pending, createdAt: c.created_at, expiresAt: c.expires_at, revokedAt: c.revoked_at,
          active: !c.revoked_at && c.expires_at > t,
          pendingCount: db.prepare("SELECT count(*) AS n FROM club_members WHERE club_id = ? AND status = 'pending' AND via = ?").get(clubId, 'join:' + ref).n,
        }; });
    });
    send(res, 200, { joinCodes: out });
  }

  async function revokeJoinCode(req, res, clubId, ref) {
    const body = await readJson(req); const t = now(); const s = requireSession(req);
    const out = tx(db, () => {
      guard(s, clubId, { roles: ['admin'], stepUp: body.denyPending === true }, t);
      return ID.revokeClubCode(db, { clubId, table: 'join', ref, actor: s.userId, denyPending: body.denyPending === true }, t);
    });
    send(res, 200, { revoked: out.revoked, deniedRequests: out.denied });
  }

  async function createInvite(req, res, clubId) {
    const body = await readJson(req); const t = now(); const s = requireSession(req);
    const out = tx(db, () => {
      guard(s, clubId, { roles: ['admin'], stepUp: true }, t);
      if (!STAFF.includes(body.role)) throw httpError(400, 'bad-role');   // players join with the club's join code
      return ID.issueCode(db, { kind: 'staff-invite', clubId, role: body.role, label: body.label === undefined ? null : body.label, actor: s.userId }, t);
    });
    send(res, 200, { code: out.code, ref: out.ref, expiresAt: out.expiresAt });
  }

  async function listInvites(req, res, clubId) {
    const s = requireSession(req), t = now();
    const out = tx(db, () => {
      guard(s, clubId, { roles: ['admin'] }, t);
      const rows = db.prepare("SELECT code_hash, role, label, created_at, expires_at, used_at, revoked_at FROM link_codes WHERE club_id = ? AND kind = 'staff-invite' ORDER BY created_at DESC").all(clubId);
      const list = [];
      for (const r of rows) {
        const ref = r.code_hash.slice(0, 8);
        if (!r.used_at && !r.revoked_at && r.expires_at > t) { list.push({ ref, role: r.role, label: r.label, createdAt: r.created_at, expiresAt: r.expires_at, status: 'unused' }); continue; }
        if (r.used_at) {
          // the tripwire: the real invitee says "my link doesn't work" — here is who used it
          const p = db.prepare("SELECT m.member_ref, u.display_name FROM club_members m JOIN users u ON u.id = m.user_id WHERE m.club_id = ? AND m.status = 'pending' AND m.via = ?").get(clubId, 'staff-invite:' + ref);
          if (p) list.push({ ref, role: r.role, label: r.label, createdAt: r.created_at, status: 'pending', usedBy: { memberRef: p.member_ref, name: p.display_name } });
        }
      }
      return list;
    });
    send(res, 200, { invites: out });
  }

  async function revokeInvite(req, res, clubId, ref) {
    await readJson(req); const t = now(); const s = requireSession(req);
    tx(db, () => { guard(s, clubId, { roles: ['admin'] }, t); ID.revokeClubCode(db, { clubId, table: 'link', ref, actor: s.userId }, t); });
    send(res, 200, { revoked: true });
  }

  /* ---- audit ---- */
  const STAFF_ACTIONS = `(a.action IN ('member.role', 'member.remove', 'club.rename') OR a.action LIKE 'code.%'
      OR (a.action IN ('member.approve', 'member.leave') AND coalesce(json_extract(a.detail, '$.role'), 'player') <> 'player'))`;
  const CATEGORY = {
    staff: STAFF_ACTIONS,
    requests: `a.action IN ('member.request', 'member.approve', 'member.deny', 'member.withdraw', 'member.expired')`,
  };
  async function auditLog(req, res, clubId) {
    const s = requireSession(req), t = now();
    const q = new URL(req.url, 'http://x').searchParams;
    const before = Number(q.get('before')) || Number.MAX_SAFE_INTEGER;
    const category = q.get('category');
    if (category && !CATEGORY[category]) throw httpError(400, 'bad-category');
    const out = tx(db, () => {
      guard(s, clubId, { roles: ['admin'] }, t);
      // the club's own rows, plus cloned-passkey alarms (they carry no club) for people approved here
      const withAlarms = !category || category === 'staff';
      const rows = db.prepare(`SELECT a.id, a.at, a.actor, a.action, a.subject, a.detail FROM audit a WHERE a.id < ? AND (
          (a.club_id = ? ${category ? 'AND ' + CATEGORY[category] : ''})
          ${withAlarms ? `OR (a.action = 'credential.suspect' AND a.club_id IS NULL AND EXISTS (SELECT 1 FROM club_members m WHERE m.user_id = a.subject AND m.club_id = ? AND m.status = 'approved'))` : ''}
        ) ORDER BY a.id DESC LIMIT 100`).all(...(withAlarms ? [before, clubId, clubId] : [before, clubId]));
      const current = new Map(db.prepare("SELECT m.user_id, m.member_ref, u.display_name FROM club_members m JOIN users u ON u.id = m.user_id WHERE m.club_id = ? AND m.status IN ('pending', 'approved')").all(clubId).map(r => [r.user_id, r]));
      const counts = new Map();
      for (const r of current.values()) counts.set(fold(r.display_name), (counts.get(fold(r.display_name)) || 0) + 1);
      // by name only while pending or approved HERE; everyone else is a former member with a stable ref
      const who = id => {
        if (id === 'operator' || id === 'system' || id === 'anonymous') return { kind: id };
        if (String(id).startsWith('c_')) return { kind: 'club' };
        const m = current.get(id);
        if (m) return Object.assign({ kind: 'member', name: m.display_name, ref: m.member_ref.slice(2, 8) }, counts.get(fold(m.display_name)) > 1 ? { sameName: true } : {});
        return { kind: 'former-member', ref: formerRef(clubId, id) };
      };
      return rows.map(r => {
        let detail = null; try { detail = JSON.parse(r.detail); } catch (e) {}
        // nothing that is the same in every club (a passkey id fragment would let two clubs match a person)
        if (detail && typeof detail === 'object') { delete detail.credential; if (r.action === 'credential.suspect') detail = null; }
        return { id: r.id, at: r.at, action: r.action, actor: who(r.actor), subject: r.subject ? who(r.subject) : null, detail };
      });
    });
    send(res, 200, { entries: out, next: out.length === 100 ? out[out.length - 1].id : null });
  }

  /* ---- joining ---- */
  async function peek(req, res) {
    const body = await readJson(req); const t = now();
    if (overLimit('options:' + clientAddress(req), LIMITS.options, t)) throw tooMany();
    const code = ID.findCode(db, body.code, t);   // the lookup always runs; every failure is the same answer
    if (!code) throw httpError(400, 'invalid-code');
    const c = ID.getClub(db, code.clubId);
    const s = core.sessionFrom(req);
    send(res, 200, Object.assign({ kind: code.kind, club: { name: c.name }, role: code.role }, s ? { signedInAs: nameOf(s.userId) } : {}));
  }

  async function join(req, res) {
    const body = await readJson(req); const t = now(); const s = requireSession(req);
    if (overLimit('verify:' + clientAddress(req), LIMITS.verify, t)) throw tooMany();
    const out = tx(db, () => {
      const code = ID.findCode(db, body.code, t);
      if (!code) throw httpError(400, 'invalid-code');
      const c = ID.getClub(db, code.clubId);
      const existing = ID.getMember(db, code.clubId, s.userId);
      const live = existing && ['pending', 'approved'].includes(existing.status);
      const answer = (m, extra = {}) => Object.assign({ club: { id: c.id, name: c.name }, role: m.role, status: m.status, memberRef: m.member_ref || m.memberRef },
        m.status === 'pending' ? { requestNo: m.request_no || m.requestNo, expiresAt: (m.requested_at || t) + ID.MEMBERSHIP.pendingTtl } : {}, extra);

      if (code.kind === 'club-admin') {
        // an operator's code: admin at once — so only from a verified, freshly stepped-up session
        if (!freshSession(s).uv) throw httpError(403, 'user-verification-required');
        if (!steppedUp(s, t)) throw httpError(403, 'step-up-required');
        if (live && existing.status === 'approved' && existing.role === 'admin') return answer(existing, { already: true });
        if (!ID.consumeCodeHash(db, { hash: code.hash, kind: 'club-admin', usedBy: s.userId }, t)) throw httpError(400, 'invalid-code');
        const g = ID.grantAdmin(db, { clubId: code.clubId, userId: s.userId, actor: s.userId }, t);
        return answer({ role: 'admin', status: 'approved', memberRef: g.memberRef });
      }
      if (code.kind === 'staff-invite') {
        if (live) throw httpError(409, 'already-a-member');   // not claimed: the admin changes their role instead
        if (!freshSession(s).uv) throw httpError(403, 'user-verification-required');
        if (!ID.hasVerifiedPasskey(db, s.userId)) throw httpError(409, 'needs-verified-passkey');
        if (!ID.consumeCodeHash(db, { hash: code.hash, kind: 'staff-invite', usedBy: s.userId }, t)) throw httpError(400, 'invalid-code');
        const r = ID.requestMembership(db, { clubId: code.clubId, userId: s.userId, role: code.role, via: 'staff-invite:' + code.ref }, t);
        return answer({ role: r.role, status: r.status, memberRef: r.memberRef, requestNo: r.requestNo });
      }
      // a club's join code: a player request; asking twice changes nothing
      if (live) return answer(existing, { already: true });
      const r = ID.requestMembership(db, { clubId: code.clubId, userId: s.userId, role: 'player', via: 'join:' + code.ref, cooldown: true, maxPendingVia: code.maxPending }, t);
      if (!ID.claimJoinCodeHash(db, { hash: code.hash }, t)) throw httpError(400, 'invalid-code');
      return answer({ role: r.role, status: r.status, memberRef: r.memberRef, requestNo: r.requestNo });
    });
    send(res, 200, out);
  }

  return [
    ['POST', /^\/api\/join\/peek$/, peek],
    ['POST', /^\/api\/join$/, join],
    ['GET', new RegExp(`^/api/clubs/${CLUB}$`), club],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/name$`), rename],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/leave$`), leave],
    ['GET', new RegExp(`^/api/clubs/${CLUB}/members$`), members],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/members/${MEMBER}/approve$`), decide(true)],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/members/${MEMBER}/deny$`), decide(false)],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/members/${MEMBER}/role$`), role],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/members/${MEMBER}/remove$`), remove],
    ['GET', new RegExp(`^/api/clubs/${CLUB}/join-codes$`), listJoinCodes],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/join-codes$`), createJoinCode],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/join-codes/${REF}/revoke$`), revokeJoinCode],
    ['GET', new RegExp(`^/api/clubs/${CLUB}/invites$`), listInvites],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/invites$`), createInvite],
    ['POST', new RegExp(`^/api/clubs/${CLUB}/invites/${REF}/revoke$`), revokeInvite],
    ['GET', new RegExp(`^/api/clubs/${CLUB}/audit$`), auditLog],
  ];
}

module.exports = { routes, fold, mixedScript };
