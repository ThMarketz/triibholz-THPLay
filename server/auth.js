/* ============================================================
   server/auth.js — passkey sign-in over HTTP: challenges, sessions,
   cookies, rate limits (slice 2, behind ACCOUNTS=1).

     POST /api/auth/register/options  { code, displayName }   → WebAuthn creation options
     POST /api/auth/register/verify   { challengeId, credential } → account + passkey + session
     POST /api/auth/login/options     {}                       → WebAuthn request options (discoverable)
     POST /api/auth/login/verify      { challengeId, credential } → session
     POST /api/auth/logout            {}
     GET  /api/auth/me                                          → who is signed in, or 401

   In this slice an account can only be created with an operator's
   club-admin invite (node admin.js club-admin-invite). Slice 3 adds staff
   invites and player join codes.

   Request rules on every POST here: Origin must be one of APP_ORIGINS
   (absent counts as foreign), the body must be application/json, at most
   64 kB, and arrive within 10 s. No CORS headers: other sites cannot read
   these answers. The clock is read after the body has arrived, so holding
   a body back cannot outlive a challenge.

   Two kinds of challenge:
   · Registration challenges are rows, bound to their flow (the endpoint
     fixes the kind; the invite, name and handle are read back from the
     row, never from the second request) and used up BEFORE the response is
     verified, so a failed attempt cannot be retried. Only someone holding
     a valid invite can create one.
   · Sign-in challenges are stateless — random bytes, an expiry and an
     HMAC under a server secret — so an anonymous flood of option requests
     writes nothing. A sign-in challenge is recorded as used only once a
     response with a valid signature arrives; recording it again fails, so
     a successful response cannot be replayed.
   ============================================================ */
'use strict';
const crypto = require('node:crypto');
const net = require('node:net');
const { tx } = require('./db.js');
const ID = require('./identity.js');
const W = require('./webauthn.js');

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const STEPUP_WINDOW = 5 * MIN;
const CHALLENGE_TTL = 5 * MIN;
const SESSION = { staffIdle: 14 * DAY, playerIdle: 30 * DAY, absolute: 180 * DAY, touchEvery: 5 * MIN };
const MAX_BODY = 64 * 1024;
const BODY_TIMEOUT = +(process.env.AUTH_BODY_TIMEOUT_MS || 10000);
const LIMITS = {
  options: { max: 60, windowMs: MIN },          // per client address
  verify: { max: 60, windowMs: MIN },           // per client address
  failureAlert: { max: 10, windowMs: 15 * MIN },   // failed sign-ins on one passkey → audited (never a lock-out)
  accountsFromCodes: { max: 30, windowMs: HOUR },  // accounts made with join codes or staff invites, per address
  openRegistrations: 5000,                      // open registration challenges, everyone together
  openRegistrationsPerClub: 50,                 // … per club, not counting operator club-admin codes
  openStepUpsPerSession: 3,
};
const STAFF_ROLES = ['admin', 'coach', 'trainer'];
const REGISTER_KINDS = ['club-admin', 'staff-invite', 'join'];

const sha256hex = s => crypto.createHash('sha256').update(s).digest('hex');
const b64u = b => Buffer.from(b).toString('base64url');
const httpError = (status, error, extra, headers) => Object.assign(new Error(error), { status, error, extra, headers });
const tooMany = (windowMs = MIN, error = 'too-many-requests') => httpError(429, error, undefined, { 'retry-after': String(Math.ceil(windowMs / 1000)) });
const CLIENT_GONE = 499;

/* The address rate limits are keyed on. X-Real-IP is believed only from a private or loopback peer
   (nginx; port 4200 is bound to loopback). Behind a tunnel nginx must be told to take the visitor's
   address from the tunnel (TRUSTED_PROXY, see docs/ACCOUNTS.md) or every visitor shares one address.
   IPv6 addresses are grouped by /64, the smallest block a single customer normally gets. */
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(ip)) { const l = ip.toLowerCase(); return l === '::1' || l.startsWith('fc') || l.startsWith('fd'); }
  return false;
}
function addressKey(ip) {
  const v4 = String(ip).replace(/^::ffff:/i, '');
  if (net.isIPv4(v4)) return v4;
  if (!net.isIPv6(ip)) return 'unknown';
  // expand, keep the first four groups
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return groups.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}
function clientAddress(req) {
  const peer = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/i, '');
  const real = String(req.headers['x-real-ip'] || '').trim();
  return addressKey(real && net.isIP(real) && isPrivateAddress(peer) ? real : (peer || 'unknown'));
}

function cookieHeader(cfg, token, maxAgeSeconds) {
  const parts = [`${cfg.cookieName}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (cfg.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}
/* the session token, or null. A name sent twice (a planted cookie beside the real one) counts as none. */
function readSessionToken(req, cfg) {
  const header = req.headers.cookie;
  if (!header) return null;
  const values = String(header).split(';').map(s => s.trim()).filter(s => s.startsWith(cfg.cookieName + '=')).map(s => s.slice(cfg.cookieName.length + 1));
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : null;
}

function createAuth({ db, cfg, now = Date.now }) {
  /* the server's own secret for stateless sign-in challenges: made once, shared by every process */
  const loginKey = tx(db, () => {
    db.prepare('INSERT OR IGNORE INTO server_keys (name, secret, created_at) VALUES (?, ?, ?)').run('login-challenge', crypto.randomBytes(32), now());
    return Buffer.from(db.prepare('SELECT secret FROM server_keys WHERE name = ?').get('login-challenge').secret);
  });

  const purge = () => ID.housekeeping(db, now());
  const timer = setInterval(purge, MIN); if (timer.unref) timer.unref();

  function send(res, status, body, cookie, extraHeaders) {
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    };
    if (cfg.cookieSecure) headers['strict-transport-security'] = 'max-age=31536000';
    if (cookie) headers['set-cookie'] = cookie;
    Object.assign(headers, extraHeaders || {});
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  }

  /* fixed-window counter: counts this request and says whether it is over the limit */
  /* `cost` is how much this one request spends: 1 for an attempt, more when a single request does
     the work of many (a roster upload adds a whole team's licences at once — server/teams.js). */
  function overLimit(key, { max, windowMs }, t, cost = 1) {
    const n = Math.max(1, Math.min(10000, Math.floor(cost) || 1));
    return tx(db, () => {
      const row = db.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').get(key);
      if (row && t - row.window_start < windowMs) {
        if (row.count >= max) return true;
        db.prepare('UPDATE rate_limits SET count = count + ? WHERE key = ?').run(n, key);
        return false;
      }
      db.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count').run(key, t, n);
      return false;
    });
  }
  /* counts without limiting; returns the count in the current window */
  function tally(key, { windowMs }, t) {
    return tx(db, () => {
      const row = db.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').get(key);
      if (row && t - row.window_start < windowMs) { db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key); return row.count + 1; }
      db.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1').run(key, t);
      return 1;
    });
  }

  function readJson(req) {
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_BODY) return Promise.reject(httpError(413, 'body-too-large'));
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0, done = false;
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timeout); fn(v); };
      const timeout = setTimeout(() => finish(reject, httpError(408, 'body-too-slow')), BODY_TIMEOUT);
      req.on('data', c => { if (done) return; size += c.length; if (size > MAX_BODY) finish(reject, httpError(413, 'body-too-large')); else chunks.push(c); });
      req.on('end', () => {
        let v; try { v = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return finish(reject, httpError(400, 'bad-json')); }
        if (!v || typeof v !== 'object' || Array.isArray(v)) return finish(reject, httpError(400, 'bad-json'));
        finish(resolve, v);
      });
      // a client that hangs up is not a server fault: nothing to log, nobody to answer
      req.on('aborted', () => finish(reject, httpError(CLIENT_GONE, 'client-gone')));
      req.on('error', () => finish(reject, httpError(CLIENT_GONE, 'client-gone')));
    });
  }

  const isStaff = userId => !!db.prepare(`SELECT 1 FROM club_members WHERE user_id = ? AND status = 'approved' AND role IN ('admin', 'coach', 'trainer') LIMIT 1`).get(userId);

  /* ---- registration challenges: rows ---- */
  function newRegistrationChallenge({ clubId, linkCodeHash, payload }, t) {
    return tx(db, () => {
      const open = db.prepare("SELECT count(*) AS n FROM challenges WHERE kind = 'register' AND used_at IS NULL AND expires_at > ?").get(t).n;
      if (open >= LIMITS.openRegistrations) throw httpError(503, 'busy');
      // a leaked join link cannot crowd out other clubs: registrations open per club are capped too
      if (payload.kind !== 'club-admin' && db.prepare("SELECT count(*) AS n FROM challenges WHERE kind = 'register' AND club_id = ? AND used_at IS NULL AND expires_at > ? AND json_extract(payload, '$.kind') <> 'club-admin'").get(clubId, t).n >= LIMITS.openRegistrationsPerClub) throw tooMany(CHALLENGE_TTL);
      const id = ID.newId('ch'), challenge = b64u(crypto.randomBytes(32));
      db.prepare(`INSERT INTO challenges (id, kind, challenge, club_id, link_code_hash, payload, created_at, expires_at)
                  VALUES (?, 'register', ?, ?, ?, ?, ?, ?)`).run(id, challenge, clubId, linkCodeHash, JSON.stringify(payload), t, t + CHALLENGE_TTL);
      return { id, challenge };
    });
  }
  /* used up by a conditional UPDATE and committed at once — before the response is verified */
  function consumeRegistrationChallenge(id, t) {
    if (typeof id !== 'string' || !/^ch_[A-Za-z0-9_-]{22}$/.test(id)) return null;
    return tx(db, () => {
      const r = db.prepare("UPDATE challenges SET used_at = ? WHERE id = ? AND kind = 'register' AND used_at IS NULL AND expires_at > ?").run(t, id, t);
      return r.changes === 1 ? db.prepare('SELECT * FROM challenges WHERE id = ?').get(id) : null;
    });
  }

  /* ---- sign-in challenges: stateless ----
     challenge = base64url( nonce[16] ‖ expiry ms[8] ‖ HMAC-SHA256(key, "login" ‖ nonce ‖ expiry)[16] ) */
  const loginMac = (nonce, expiry) => crypto.createHmac('sha256', loginKey).update('login').update(nonce).update(expiry).digest().subarray(0, 16);
  function newLoginChallenge(t) {
    const nonce = crypto.randomBytes(16), expiry = Buffer.alloc(8);
    expiry.writeBigUInt64BE(BigInt(t + CHALLENGE_TTL));
    return b64u(Buffer.concat([nonce, expiry, loginMac(nonce, expiry)]));
  }
  /* → { usedId, expiresAt } for a genuine, unexpired sign-in challenge, else null (nothing is written) */
  function checkLoginChallenge(value, t) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{54}$/.test(value)) return null;
    const raw = Buffer.from(value, 'base64url');
    if (raw.length !== 40) return null;
    const nonce = raw.subarray(0, 16), expiry = raw.subarray(16, 24), mac = raw.subarray(24);
    if (!crypto.timingSafeEqual(mac, loginMac(nonce, expiry))) return null;
    const expiresAt = Number(expiry.readBigUInt64BE());
    if (!(expiresAt > t) || expiresAt > t + CHALLENGE_TTL + MIN) return null;
    return { usedId: 'login_' + b64u(nonce), expiresAt };
  }
  const loginChallengeUsed = ch => !!db.prepare('SELECT 1 FROM challenges WHERE id = ?').get(ch.usedId);
  /* record a sign-in challenge as used; false if it already was (a replay) */
  function markLoginChallengeUsed(ch, t) {
    return db.prepare(`INSERT INTO challenges (id, kind, challenge, created_at, expires_at, used_at) VALUES (?, 'login', '-', ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .run(ch.usedId, t, ch.expiresAt, t).changes === 1;
  }

  /* `origin` is how this session began — signed in here, or opened by following a link somebody
     sent. Uploading a club's rosters (server/teams.js) is allowed only from the first kind, so
     slices 6 and 7 must pass 'pair' and 'recover' from their own calls or the rule quietly reopens. */
  function createSession(userId, credentialId, uv, t, origin) {
    const token = b64u(crypto.randomBytes(32));
    const idle = isStaff(userId) ? SESSION.staffIdle : SESSION.playerIdle;
    db.prepare(`INSERT INTO sessions (token_hash, user_id, credential_id, uv, created_at, last_seen_at, expires_at, absolute_expires_at, origin)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sha256hex(token), userId, credentialId, uv ? 1 : 0, t, t, t + idle, t + SESSION.absolute, origin || 'legacy');
    return cookieHeader(cfg, token, Math.floor(SESSION.absolute / 1000));
  }
  const clearCookie = () => cookieHeader(cfg, '', 0);

  /* the signed-in session for a request, or null; slides its expiry at most every 5 minutes */
  function sessionFrom(req) {
    const token = readSessionToken(req, cfg);
    if (!token) return null;
    const hash = sha256hex(token), t = now();
    const s = db.prepare('SELECT s.*, c.status AS credential_status FROM sessions s LEFT JOIN credentials c ON c.id = s.credential_id WHERE s.token_hash = ?').get(hash);
    if (!s) return null;
    if (s.expires_at <= t || s.absolute_expires_at <= t || (s.credential_id && s.credential_status !== 'active')) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      return null;
    }
    if (t - s.last_seen_at >= SESSION.touchEvery) {
      s.expires_at = Math.min(t + (isStaff(s.user_id) ? SESSION.staffIdle : SESSION.playerIdle), s.absolute_expires_at);
      db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(t, s.expires_at, hash);
    }
    return { tokenHash: hash, userId: s.user_id, credentialId: s.credential_id, uv: !!s.uv, stepupAt: s.stepup_at, createdAt: s.created_at, expiresAt: s.expires_at, origin: s.origin };
  }

  function whoami(userId, session) {
    const user = ID.getUser(db, userId);
    const clubs = db.prepare(`SELECT c.id, c.name, m.role, m.status, m.member_ref, m.request_no, m.requested_at FROM club_members m JOIN clubs c ON c.id = m.club_id
                              WHERE m.user_id = ? AND m.status IN ('approved', 'pending') ORDER BY c.name`).all(userId)
      .map(c => Object.assign({ id: c.id, name: c.name, role: c.role, status: c.status, memberRef: c.member_ref },
        c.status === 'pending' ? { requestNo: c.request_no, expiresAt: c.requested_at + ID.MEMBERSHIP.pendingTtl } : {}));
    return { user: { id: user.id, displayName: user.display_name }, clubs, session: session ? { uv: session.uv, expiresAt: session.expiresAt, origin: session.origin || 'legacy' } : undefined };
  }

  /* ---- routes: each reads its body first, then the clock ---- */
  function storeCredential(userId, v, t, clubId) {
    if (db.prepare('SELECT 1 FROM credentials WHERE id = ?').get(v.credentialId)) throw httpError(409, 'credential-exists');
    db.prepare(`INSERT INTO credentials (id, user_id, public_key_jwk, alg, sign_count, uv, backup_eligible, backed_up, transports, status, created_at, last_used_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
      .run(v.credentialId, userId, JSON.stringify(v.jwk), v.alg, v.signCount, v.uv ? 1 : 0, v.backupEligible ? 1 : 0, v.backedUp ? 1 : 0, JSON.stringify(v.transports), t, t);
    ID.audit(db, { actor: userId, action: 'credential.register', subject: userId, clubId, detail: { credential: v.credentialId.slice(0, 12), alg: v.alg, uv: v.uv } }, t);
  }

  /* Registration accepts an operator club-admin code (approved admin), a staff invite (a pending
     request for that role) or a club's join code (a pending player request). */
  async function registerOptions(req, res) {
    const body = await readJson(req);
    const t = now();
    if (sessionFrom(req)) throw httpError(409, 'already-signed-in');
    if (overLimit('options:' + clientAddress(req), LIMITS.options, t)) throw tooMany();
    const displayName = ID.cleanName(body.displayName);
    if (!displayName || displayName.length > 80) throw httpError(400, 'bad-name');
    const code = ID.findCode(db, body.code, t);
    if (!code) throw httpError(400, 'invalid-code');
    const handle = crypto.randomBytes(32);
    const ch = newRegistrationChallenge({ clubId: code.clubId, linkCodeHash: code.hash, payload: { displayName, handle: b64u(handle), kind: code.kind, ref: code.ref } }, t);
    const club = ID.getClub(db, code.clubId);
    send(res, 200, {
      challengeId: ch.id,
      club: club ? { name: club.name, role: code.role } : null,
      publicKey: {
        rp: { id: cfg.rpId, name: cfg.rpName },
        user: { id: b64u(handle), name: displayName, displayName },
        challenge: ch.challenge,
        pubKeyCredParams: W.ALGS.map(alg => ({ type: 'public-key', alg })),
        timeout: CHALLENGE_TTL,
        attestation: 'none',
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: STAFF_ROLES.includes(code.role) ? 'required' : 'preferred' },
        excludeCredentials: [],
      },
    });
  }

  async function registerVerify(req, res) {
    const body = await readJson(req);
    const t = now();
    const address = clientAddress(req);
    if (overLimit('verify:' + address, LIMITS.verify, t)) throw tooMany();
    const ch = consumeRegistrationChallenge(body.challengeId, t);
    if (!ch || !ch.link_code_hash || !ch.payload) throw httpError(400, 'challenge-invalid');
    const payload = JSON.parse(ch.payload);
    if (!REGISTER_KINDS.includes(payload.kind)) throw httpError(400, 'invalid-code');
    const role = payload.kind === 'join' ? 'player' : (db.prepare('SELECT role FROM link_codes WHERE code_hash = ?').get(ch.link_code_hash) || {}).role;
    if (!role) throw httpError(400, 'invalid-code');
    let v;
    try {
      v = W.verifyRegistration({ credential: body.credential, challenge: ch.challenge, origins: cfg.origins, rpId: cfg.rpId, requireUV: STAFF_ROLES.includes(role) });
    } catch (e) {
      if (e instanceof W.VerifyError) throw httpError(400, 'registration-failed', { reason: e.reason });
      throw e;
    }
    // accounts made from codes anyone in a group chat may hold: a looser per-address hourly cap (a
    // parents' evening shares one address), counted only for a verified passkey
    if (payload.kind !== 'club-admin' && overLimit('accounts:' + address, LIMITS.accountsFromCodes, t)) throw tooMany(LIMITS.accountsFromCodes.windowMs);
    const previous = sessionFrom(req);
    const out = tx(db, () => {
      const user = ID.createUser(db, { displayName: payload.displayName, handle: Buffer.from(payload.handle, 'base64url') }, t);
      let membership;
      if (payload.kind === 'join') {
        const code = db.prepare('SELECT max_pending FROM club_join_codes WHERE code_hash = ?').get(ch.link_code_hash);
        if (!code || !ID.claimJoinCodeHash(db, { hash: ch.link_code_hash }, t)) throw httpError(400, 'invalid-code');
        membership = ID.requestMembership(db, { clubId: ch.club_id, userId: user.id, role: 'player', via: 'join:' + payload.ref, maxPendingVia: code.max_pending }, t);
      } else {
        const granted = ID.consumeCodeHash(db, { hash: ch.link_code_hash, kind: payload.kind, usedBy: user.id }, t);
        if (!granted) throw httpError(400, 'invalid-code');   // used or revoked since the options were issued
        membership = payload.kind === 'club-admin'
          ? ID.addMember(db, { clubId: granted.club_id, userId: user.id, role: granted.role, status: 'approved', actor: user.id, via: 'operator' }, t)
          : ID.requestMembership(db, { clubId: granted.club_id, userId: user.id, role: granted.role, via: 'staff-invite:' + payload.ref }, t);
      }
      storeCredential(user.id, v, t, ch.club_id);
      if (previous) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(previous.tokenHash);   // this browser is someone new now
      // payload.kind comes from the challenge row, never from the request body
      return { userId: user.id, uv: !!v.uv, origin: payload.kind, cookie: createSession(user.id, v.credentialId, v.uv, t, payload.kind) };
    });
    // the app is told about the session it now has, not just who it belongs to: how a session began
    // decides what it may do (server/teams.js), and /api/auth/me is not asked again until a reload
    send(res, 200, whoami(out.userId, { uv: out.uv, origin: out.origin }), out.cookie);
  }

  async function loginOptions(req, res) {
    await readJson(req);
    const t = now();
    if (overLimit('options:' + clientAddress(req), LIMITS.options, t)) throw tooMany();
    const challenge = newLoginChallenge(t);
    send(res, 200, { challengeId: challenge, publicKey: { challenge, rpId: cfg.rpId, timeout: CHALLENGE_TTL, userVerification: 'preferred', allowCredentials: [] } });
  }

  async function loginVerify(req, res) {
    const body = await readJson(req);
    const t = now();
    if (overLimit('verify:' + clientAddress(req), LIMITS.verify, t)) throw tooMany();
    const ch = checkLoginChallenge(body.challengeId, t);
    // a replayed response must be refused as a replay before its old counter can look like a clone
    if (!ch || loginChallengeUsed(ch)) throw httpError(400, 'challenge-invalid');
    const rawId = body.credential && typeof body.credential.rawId === 'string' && /^[A-Za-z0-9_-]{1,1400}$/.test(body.credential.rawId) ? body.credential.rawId : null;
    const cred = rawId && db.prepare('SELECT c.*, u.webauthn_user_handle FROM credentials c JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(b64u(Buffer.from(rawId, 'base64url')));
    if (!cred || cred.status !== 'active') throw httpError(401, 'sign-in-failed');
    const staff = isStaff(cred.user_id);
    let v;
    try {
      v = W.verifyAssertion({
        credential: body.credential, challenge: body.challengeId, origins: cfg.origins, rpId: cfg.rpId,
        stored: { alg: cred.alg, jwk: JSON.parse(cred.public_key_jwk), signCount: cred.sign_count, userHandle: Buffer.from(cred.webauthn_user_handle) },
        requireUV: staff, requireUserHandle: true,
      });
    } catch (e) {
      if (!(e instanceof W.VerifyError)) throw e;
      if (e.reason === 'user-not-verified') {
        // the signature was valid, so this is the owner's authenticator skipping verification
        throw httpError(401, 'sign-in-failed', { reason: 'user-verification-required' });
      }
      // failures never lock the owner out (a signature cannot be guessed); many of them are worth an audit row
      if (tally('failures:' + cred.id, LIMITS.failureAlert, t) === LIMITS.failureAlert.max) {
        ID.audit(db, { actor: 'anonymous', action: 'credential.failures', subject: cred.user_id, detail: { credential: cred.id.slice(0, 12), count: LIMITS.failureAlert.max } }, t);
      }
      throw httpError(401, 'sign-in-failed');
    }
    if (v.counterRegressed) {
      // a cloned authenticator, or a replay: stop trusting this passkey
      tx(db, () => {
        if (!markLoginChallengeUsed(ch, t)) throw httpError(400, 'challenge-invalid');   // a replay that raced the check above
        db.prepare("UPDATE credentials SET status = 'suspect' WHERE id = ?").run(cred.id);
        db.prepare('DELETE FROM sessions WHERE credential_id = ?').run(cred.id);
        ID.audit(db, { actor: cred.user_id, action: 'credential.suspect', subject: cred.user_id, detail: { credential: cred.id.slice(0, 12), stored: cred.sign_count, received: v.signCount } }, t);
      });
      throw httpError(401, 'sign-in-failed');
    }
    const previous = sessionFrom(req);
    const cookie = tx(db, () => {
      if (!markLoginChallengeUsed(ch, t)) throw httpError(400, 'challenge-invalid');   // this exact response was already used
      const r = db.prepare(`UPDATE credentials SET sign_count = ?, last_used_at = ?, backed_up = ?
                            WHERE id = ? AND status = 'active' AND (sign_count < ? OR (? = 0 AND sign_count = 0))`)
        .run(v.signCount, t, v.backedUp ? 1 : 0, cred.id, v.signCount, v.signCount);
      if (r.changes !== 1) throw httpError(401, 'sign-in-failed');   // another sign-in with this counter won the race
      if (previous) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(previous.tokenHash);   // a new session id on every sign-in
      ID.audit(db, { actor: cred.user_id, action: 'session.start', subject: cred.user_id, detail: { credential: cred.id.slice(0, 12), uv: v.uv } }, t);
      return createSession(cred.user_id, cred.id, v.uv, t, 'login');
    });
    send(res, 200, whoami(cred.user_id, { uv: !!v.uv, origin: 'login' }), cookie);
  }

  async function logout(req, res) {
    await readJson(req);
    const s = sessionFrom(req);
    if (s) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.tokenHash);
    send(res, 200, { ok: true }, clearCookie());
  }

  function requireSession(req) {
    const s = sessionFrom(req);
    if (!s) throw httpError(401, 'signed-out');
    return s;
  }
  /* inside a transaction: the session's step-up and UV as they are now (a demotion clears step-up) */
  function freshSession(session) {
    const row = db.prepare('SELECT uv, stepup_at FROM sessions WHERE token_hash = ?').get(session.tokenHash);
    if (!row) throw httpError(401, 'signed-out');
    return { uv: !!row.uv, stepupAt: row.stepup_at };
  }
  const steppedUp = (session, t) => { const f = freshSession(session); return !!f.stepupAt && t - f.stepupAt <= STEPUP_WINDOW; };

  /* ---- step-up: a fresh verified passkey assertion for sensitive actions, bound to this session ---- */
  async function stepUpOptions(req, res) {
    await readJson(req);
    const t = now();
    const session = requireSession(req);
    if (overLimit('options:' + clientAddress(req), LIMITS.options, t)) throw tooMany();
    const ch = tx(db, () => {
      const open = db.prepare("SELECT count(*) AS n FROM challenges WHERE kind = 'stepup' AND user_id = ? AND used_at IS NULL AND expires_at > ? AND json_extract(payload, '$.session') = ?").get(session.userId, t, session.tokenHash).n;
      if (open >= LIMITS.openStepUpsPerSession) throw tooMany(CHALLENGE_TTL);
      const id = ID.newId('ch'), challenge = b64u(crypto.randomBytes(32));
      db.prepare(`INSERT INTO challenges (id, kind, challenge, user_id, payload, created_at, expires_at) VALUES (?, 'stepup', ?, ?, ?, ?, ?)`)
        .run(id, challenge, session.userId, JSON.stringify({ session: session.tokenHash }), t, t + CHALLENGE_TTL);
      return { id, challenge };
    });
    const creds = db.prepare("SELECT id, transports FROM credentials WHERE user_id = ? AND status = 'active'").all(session.userId);
    send(res, 200, { challengeId: ch.id, publicKey: { challenge: ch.challenge, rpId: cfg.rpId, timeout: CHALLENGE_TTL, userVerification: 'required',
      allowCredentials: creds.map(c => ({ type: 'public-key', id: c.id, transports: JSON.parse(c.transports || '[]') })) } });
  }

  async function stepUpVerify(req, res) {
    const body = await readJson(req);
    const t = now();
    const session = requireSession(req);
    if (overLimit('verify:' + clientAddress(req), LIMITS.verify, t)) throw tooMany();
    const id = body.challengeId;
    const ch = typeof id === 'string' && /^ch_[A-Za-z0-9_-]{22}$/.test(id) && tx(db, () => {
      const r = db.prepare("UPDATE challenges SET used_at = ? WHERE id = ? AND kind = 'stepup' AND user_id = ? AND json_extract(payload, '$.session') = ? AND used_at IS NULL AND expires_at > ?").run(t, id, session.userId, session.tokenHash, t);
      return r.changes === 1 ? db.prepare('SELECT * FROM challenges WHERE id = ?').get(id) : null;
    });
    if (!ch) throw httpError(400, 'challenge-invalid');
    const rawId = body.credential && typeof body.credential.rawId === 'string' && /^[A-Za-z0-9_-]{1,1400}$/.test(body.credential.rawId) ? body.credential.rawId : null;
    const cred = rawId && db.prepare("SELECT c.*, u.webauthn_user_handle FROM credentials c JOIN users u ON u.id = c.user_id WHERE c.id = ? AND c.user_id = ? AND c.status = 'active'").get(b64u(Buffer.from(rawId, 'base64url')), session.userId);
    if (!cred) throw httpError(401, 'step-up-failed');
    let v;
    try {
      v = W.verifyAssertion({ credential: body.credential, challenge: ch.challenge, origins: cfg.origins, rpId: cfg.rpId,
        stored: { alg: cred.alg, jwk: JSON.parse(cred.public_key_jwk), signCount: cred.sign_count, userHandle: Buffer.from(cred.webauthn_user_handle) },
        requireUV: true, requireUserHandle: true });
    } catch (e) {
      if (!(e instanceof W.VerifyError)) throw e;
      throw httpError(401, 'step-up-failed', e.reason === 'user-not-verified' ? { reason: 'user-verification-required' } : undefined);
    }
    if (v.counterRegressed) {
      tx(db, () => {
        db.prepare("UPDATE credentials SET status = 'suspect' WHERE id = ?").run(cred.id);
        db.prepare('DELETE FROM sessions WHERE credential_id = ?').run(cred.id);
        ID.audit(db, { actor: cred.user_id, action: 'credential.suspect', subject: cred.user_id, detail: { credential: cred.id.slice(0, 12), stored: cred.sign_count, received: v.signCount } }, t);
      });
      return send(res, 401, { error: 'step-up-failed' }, clearCookie());
    }
    tx(db, () => {
      const r = db.prepare(`UPDATE credentials SET sign_count = ?, last_used_at = ?, uv = 1 WHERE id = ? AND status = 'active' AND (sign_count < ? OR (? = 0 AND sign_count = 0))`)
        .run(v.signCount, t, cred.id, v.signCount, v.signCount);
      if (r.changes !== 1) throw httpError(401, 'step-up-failed');
      if (db.prepare('UPDATE sessions SET stepup_at = ?, uv = 1 WHERE token_hash = ?').run(t, session.tokenHash).changes !== 1) throw httpError(401, 'signed-out');
      ID.audit(db, { actor: session.userId, action: 'session.stepup', subject: session.userId, detail: { credential: cred.id.slice(0, 12) } }, t);
    });
    send(res, 200, { ok: true, stepUpUntil: t + STEPUP_WINDOW });
  }

  async function me(req, res) {
    const s = requireSession(req);
    send(res, 200, whoami(s.userId, s));
  }

  const core = { db, cfg, now, send, readJson, httpError, tooMany, sessionFrom, requireSession, freshSession, steppedUp, overLimit, clientAddress, clearCookie, whoami, LIMITS, STEPUP_WINDOW };

  /* [method, path pattern, handler]. POST routes get the Origin/JSON/size/time rules; GETs only no-store. */
  const ROUTES = [
    ['GET', /^\/api\/auth\/me$/, me],
    ['POST', /^\/api\/auth\/register\/options$/, registerOptions],
    ['POST', /^\/api\/auth\/register\/verify$/, registerVerify],
    ['POST', /^\/api\/auth\/login\/options$/, loginOptions],
    ['POST', /^\/api\/auth\/login\/verify$/, loginVerify],
    ['POST', /^\/api\/auth\/logout$/, logout],
    ['POST', /^\/api\/auth\/stepup\/options$/, stepUpOptions],
    ['POST', /^\/api\/auth\/stepup\/verify$/, stepUpVerify],
    ...require('./clubs.js').routes(core),
    ...require('./teams.js').routes(core),
  ];

  /* identity errors → HTTP; a thing that does not exist, or that this person may not see, is one 404 */
  const IDENTITY_ERRORS = {
    'no-member': [404, 'not-found'], 'no-code': [404, 'not-found'], 'no-club': [404, 'not-found'],
    'request-changed': [409], 'last-admin': [409], 'needs-verified-passkey': [409], 'ask-your-admin': [409], 'too-many-join-codes': [409],
    'too-many-pending': [429], 'too-many-requests-for-club': [429], 'bad-name': [400], 'bad-label': [400], 'bad-days': [400], 'bad-max-pending': [400], 'bad-role': [400], busy: [503],
    'no-team': [404, 'not-found'], 'too-many-teams': [409], 'too-many-players': [409],
  };

  async function handle(req, res, pathname) {
    try {
      let params = null, route = null, otherMethod = false;
      for (const [method, re, fn] of ROUTES) {
        const m = re.exec(pathname);
        if (!m) continue;
        if (method !== req.method) { otherMethod = true; continue; }
        route = fn; params = m.slice(1); break;
      }
      if (!route) throw httpError(otherMethod ? 405 : 404, otherMethod ? 'method-not-allowed' : 'no-route');
      if (req.method !== 'GET') {
        const origin = req.headers.origin;
        if (typeof origin !== 'string' || !cfg.origins.includes(origin)) throw httpError(403, 'bad-origin');
        const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (type !== 'application/json') throw httpError(415, 'json-only');
      }
      await route(req, res, ...params);
    } catch (e) {
      if (e.status === CLIENT_GONE || res.headersSent || res.destroyed) return;
      if (!e.status && e.code && IDENTITY_ERRORS[e.code]) {
        const [status, error] = IDENTITY_ERRORS[e.code];
        Object.assign(e, { status, error: error || e.code, headers: status === 429 ? { 'retry-after': '600' } : undefined });
      }
      if (e.status) {
        if (e.status === 413 || e.status === 408) res.setHeader('connection', 'close');
        return send(res, e.status, Object.assign({ error: e.error }, e.extra || {}), undefined, e.headers);
      }
      console.error('[auth]', e && e.stack || e);
      send(res, 500, { error: 'server-error' });
    }
  }

  return { handle, sessionFrom, housekeeping: purge, stop: () => clearInterval(timer) };
}

module.exports = { createAuth, cookieHeader, readSessionToken, clientAddress, addressKey, isPrivateAddress, SESSION, LIMITS, CHALLENGE_TTL, STEPUP_WINDOW };
