/* ============================================================
   server/webauthn.js — passkey verification (WebAuthn Level 3), pure.

   No database, no HTTP: given what the browser sent and what the server
   expects, either return the verified facts or throw a VerifyError with
   a short reason. The HTTP layer (auth.js) decides what to do with them.

   Deliberate choices (see docs/ACCOUNTS.md):
   · Any attestation format is accepted and attStmt is never verified or
     kept: we ask for 'none', and nothing here trusts the authenticator's
     make or model. AAGUID and the backup flags are self-reported —
     returned for display only.
   · Algorithms: ES256 (-7) on P-256, Ed25519 (-8), RS256 (-257) with a
     ≥ 2048-bit modulus and e = 65537. Everything else is refused.
   · The assertion signature covers authenticatorData ‖ SHA-256(clientDataJSON),
     hashed once more by the signature algorithm — not a double hash of
     the whole.
   · authenticatorData must end exactly where its declared parts end.

   Tested against real captures from Chrome, Firefox, Safari, Windows
   Hello, Android and security keys (tests/fixtures/webauthn-real.json),
   and against tests/softauthn.mjs for every way a response can be bent.
   ============================================================ */
'use strict';
const crypto = require('node:crypto');
const { decodeOne, decodeAll } = require('./cbor.js');

const FLAGS = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 };
const ALGS = [-8, -7, -257];   // preference order offered to authenticators
const LIMITS = { clientDataJSON: 8192, attestationObject: 65536, authenticatorData: 65536, signature: 1024, credentialId: 1023 };

class VerifyError extends Error {
  constructor(reason) { super('webauthn: ' + reason); this.code = 'webauthn'; this.reason = reason; }
}
const reject = reason => { throw new VerifyError(reason); };

const toB64u = b => Buffer.from(b).toString('base64url');
function fromB64u(s, what, max) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) reject('bad-' + what);
  const b = Buffer.from(s, 'base64url');
  if (max && b.length > max) reject(what + '-too-large');
  return b;
}
const sha256 = b => crypto.createHash('sha256').update(b).digest();
const sameBytes = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

/* ---- client data ---- */
function checkClientData(bytes, { type, challenge, origins }) {
  let cd;
  try { cd = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch (e) { reject('bad-client-data'); }
  if (!cd || typeof cd !== 'object' || Array.isArray(cd)) reject('bad-client-data');
  if (cd.type !== type) reject('wrong-type');
  if (typeof cd.challenge !== 'string' || typeof challenge !== 'string' || !sameBytes(Buffer.from(cd.challenge), Buffer.from(challenge))) reject('wrong-challenge');
  if (typeof cd.origin !== 'string' || !origins.includes(cd.origin)) reject('wrong-origin');
  if (cd.crossOrigin === true) reject('cross-origin');
  if (cd.tokenBinding && cd.tokenBinding.status === 'present') reject('token-binding-unsupported');
  return cd;
}

/* ---- authenticator data ---- */
function parseAuthData(buf, { rpId, attested }) {
  if (buf.length < 37) reject('authdata-too-short');
  if (!sameBytes(buf.subarray(0, 32), sha256(Buffer.from(rpId, 'utf8')))) reject('wrong-rp-id');
  const flags = buf[32];
  const out = {
    flags, signCount: buf.readUInt32BE(33),
    up: !!(flags & FLAGS.UP), uv: !!(flags & FLAGS.UV), be: !!(flags & FLAGS.BE), bs: !!(flags & FLAGS.BS),
  };
  if (!out.up) reject('user-not-present');
  if (out.bs && !out.be) reject('backup-state-without-eligibility');   // §6.1: BS must be 0 when BE is 0
  let pos = 37;
  if (flags & FLAGS.AT) {
    if (!attested) reject('unexpected-attested-data');
    if (buf.length - pos < 18) reject('authdata-too-short');
    out.aaguid = Buffer.from(buf.subarray(pos, pos + 16)); pos += 16;
    const len = buf.readUInt16BE(pos); pos += 2;
    if (len < 1 || len > LIMITS.credentialId) reject('bad-credential-id');
    if (buf.length - pos < len) reject('authdata-too-short');
    out.credentialId = Buffer.from(buf.subarray(pos, pos + len)); pos += len;
    let key;
    try { key = decodeOne(buf, pos); } catch (e) { reject('bad-public-key'); }
    out.cose = key.value;
    out.coseBytes = Buffer.from(buf.subarray(pos, key.end));
    pos = key.end;
  } else if (attested) reject('no-attested-credential');
  if (flags & FLAGS.ED) {
    let ext;
    try { ext = decodeOne(buf, pos); } catch (e) { reject('bad-extensions'); }
    if (!(ext.value instanceof Map)) reject('bad-extensions');
    pos = ext.end;
  }
  if (pos !== buf.length) reject('authdata-trailing-bytes');
  return out;
}

/* ---- COSE public key → JWK ---- */
const isBytes = (v, n) => Buffer.isBuffer(v) && (n === undefined || v.length === n);
function coseToJwk(cose) {
  if (!(cose instanceof Map)) reject('bad-public-key');
  const kty = cose.get(1), alg = cose.get(3);
  if (!ALGS.includes(alg)) reject('unsupported-algorithm');
  let jwk;
  if (alg === -7) {
    if (kty !== 2 || cose.get(-1) !== 1 || !isBytes(cose.get(-2), 32) || !isBytes(cose.get(-3), 32)) reject('bad-public-key');
    jwk = { kty: 'EC', crv: 'P-256', x: toB64u(cose.get(-2)), y: toB64u(cose.get(-3)) };
  } else if (alg === -8) {
    if (kty !== 1 || cose.get(-1) !== 6 || !isBytes(cose.get(-2), 32)) reject('bad-public-key');
    jwk = { kty: 'OKP', crv: 'Ed25519', x: toB64u(cose.get(-2)) };
  } else {
    const n = cose.get(-1), e = cose.get(-2);
    if (kty !== 3 || !isBytes(n) || !isBytes(e)) reject('bad-public-key');
    let i = 0; while (i < n.length && n[i] === 0) i++;
    const mod = n.subarray(i);
    const bits = mod.length ? (mod.length - 1) * 8 + (32 - Math.clz32(mod[0])) : 0;
    if (bits < 2048) reject('rsa-key-too-small');
    if (bits > 4096) reject('rsa-key-too-large');   // no authenticator makes larger ones; keeps signatures within LIMITS.signature
    let j = 0; while (j < e.length && e[j] === 0) j++;
    if (!e.subarray(j).equals(Buffer.from([1, 0, 1]))) reject('rsa-exponent-not-65537');
    jwk = { kty: 'RSA', n: toB64u(mod), e: 'AQAB' };
  }
  try { crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch (e) { reject('bad-public-key'); }   // e.g. a point not on the curve
  return { alg, jwk };
}

function verifySignature(alg, jwk, data, signature) {
  let key;
  try { key = crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch (e) { return false; }
  try {
    if (alg === -7) return crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, signature);
    if (alg === -8) return crypto.verify(null, data, key, signature);
    if (alg === -257) return crypto.verify('sha256', data, { key, padding: crypto.constants.RSA_PKCS1_PADDING }, signature);
  } catch (e) { return false; }
  return false;
}

function readCredentialId(credential) {
  if (!credential || typeof credential !== 'object' || Array.isArray(credential)) reject('bad-credential');
  if (credential.type !== 'public-key') reject('bad-credential-type');
  const raw = fromB64u(credential.rawId !== undefined ? credential.rawId : credential.id, 'credential-id', LIMITS.credentialId);
  if (!raw.length) reject('bad-credential-id');
  if (credential.id !== undefined && credential.id !== toB64u(raw)) reject('credential-id-mismatch');
  if (!credential.response || typeof credential.response !== 'object') reject('bad-credential');
  return raw;
}

/* ---- navigator.credentials.create() ---- */
function verifyRegistration({ credential, challenge, origins, rpId, requireUV = false }) {
  const rawId = readCredentialId(credential);
  const r = credential.response;
  checkClientData(fromB64u(r.clientDataJSON, 'client-data', LIMITS.clientDataJSON), { type: 'webauthn.create', challenge, origins });
  let att;
  try { att = decodeAll(fromB64u(r.attestationObject, 'attestation-object', LIMITS.attestationObject)); } catch (e) { if (e instanceof VerifyError) throw e; reject('bad-attestation-object'); }
  if (!(att instanceof Map) || typeof att.get('fmt') !== 'string' || !(att.get('attStmt') instanceof Map) || !Buffer.isBuffer(att.get('authData'))) reject('bad-attestation-object');
  const ad = parseAuthData(att.get('authData'), { rpId, attested: true });
  if (!sameBytes(ad.credentialId, rawId)) reject('credential-id-mismatch');
  if (requireUV && !ad.uv) reject('user-not-verified');
  const { alg, jwk } = coseToJwk(ad.cose);
  const transports = Array.isArray(r.transports) ? r.transports.filter(t => typeof t === 'string' && /^[a-z-]{1,16}$/.test(t)).slice(0, 8) : [];
  return {
    credentialId: toB64u(rawId), alg, jwk, publicKeyCose: ad.coseBytes,
    signCount: ad.signCount, uv: ad.uv, backupEligible: ad.be, backedUp: ad.bs,
    fmt: att.get('fmt'), aaguid: ad.aaguid.toString('hex'), transports,
  };
}

/* ---- navigator.credentials.get() ----
   stored = { alg, jwk, signCount, userHandle (Buffer) } from the credential's row. */
function verifyAssertion({ credential, challenge, origins, rpId, stored, requireUV = false, requireUserHandle = true }) {
  const rawId = readCredentialId(credential);
  const r = credential.response;
  const clientData = fromB64u(r.clientDataJSON, 'client-data', LIMITS.clientDataJSON);
  checkClientData(clientData, { type: 'webauthn.get', challenge, origins });
  const authData = fromB64u(r.authenticatorData, 'authenticator-data', LIMITS.authenticatorData);
  const ad = parseAuthData(authData, { rpId, attested: false });

  const handle = r.userHandle === undefined || r.userHandle === null ? Buffer.alloc(0) : fromB64u(r.userHandle, 'user-handle', 64);
  if (!handle.length) { if (requireUserHandle) reject('no-user-handle'); }   // an empty buffer is as good as missing
  else if (!Buffer.isBuffer(stored.userHandle) || !sameBytes(handle, stored.userHandle)) reject('wrong-user-handle');

  const signature = fromB64u(r.signature, 'signature', LIMITS.signature);
  if (!signature.length) reject('bad-signature');
  if (!verifySignature(stored.alg, stored.jwk, Buffer.concat([authData, sha256(clientData)]), signature)) reject('bad-signature');
  // only after the signature: otherwise anyone holding a credential id could learn whether its owner is staff
  if (requireUV && !ad.uv) reject('user-not-verified');

  // counters: 0 and 0 means the authenticator does not count (synced passkeys); otherwise it must grow
  const prev = stored.signCount >>> 0, next = ad.signCount;
  const counterRegressed = (prev > 0 || next > 0) && next <= prev;
  return { credentialId: toB64u(rawId), signCount: next, uv: ad.uv, backedUp: ad.bs, counterRegressed };
}

module.exports = { FLAGS, ALGS, LIMITS, VerifyError, verifyRegistration, verifyAssertion, parseAuthData, coseToJwk, checkClientData };
