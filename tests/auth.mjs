/* Passkey sign-in (slice 2) — the CBOR decoder, the verifier against real browser captures, and
   every ceremony over real HTTP with a software passkey (tests/softauthn.mjs), including each way
   a response can be bent.
   Run:  node tests/auth.mjs */
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import netmod from 'node:net';
import { createHmac, generateKeyPairSync, randomBytes } from 'node:crypto';
import { SoftAuthenticator, cbor, b64u, fromB64u, FLAG } from './softauthn.mjs';

const require = createRequire(import.meta.url);
const PORT = 4291;
const ORIGIN = 'http://localhost:8088';
const DATA = mkdtempSync(join(tmpdir(), 'thp-auth-'));
Object.assign(process.env, { PORT: String(PORT), DATA_DIR: DATA, ACCOUNTS: '1', DEV: '1', RP_ID: 'localhost', APP_ORIGINS: ORIGIN, AUTH_BODY_TIMEOUT_MS: '1500' });

const { decodeOne, decodeAll } = require('../server/cbor.js');
const W = require('../server/webauthn.js');
const ID = require('../server/identity.js');
const AUTH = require('../server/auth.js');
const REAL = JSON.parse(readFileSync(new URL('./fixtures/webauthn-real.json', import.meta.url), 'utf8')).fixtures;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };
const reason = fn => { try { fn(); return 'accepted'; } catch (e) { return e instanceof W.VerifyError ? e.reason : 'CRASH:' + e.message; } };
async function section(title, fn) {
  console.log('\n' + title);
  try { await fn(); } catch (e) { fail++; console.log('  ✗ FAIL: section threw —', e && e.stack || e); }
}
const clone = o => JSON.parse(JSON.stringify(o));
const hex = h => Buffer.from(h.replace(/\s/g, ''), 'hex');

/* ---------------- HTTP ---------------- */
let addr = 0;   // every request gets its own client address unless a test pins one (rate limits are per address)
function call(method, path, { body, origin = ORIGIN, cookie, type = 'application/json', ip, raw } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw !== undefined ? raw : body === undefined ? '' : JSON.stringify(body);
    const headers = { 'x-real-ip': ip || `10.9.${(++addr >> 8) & 255}.${addr & 255}` };
    if (origin) headers.origin = origin;
    if (type && method !== 'GET') headers['content-type'] = type;
    if (cookie) headers.cookie = cookie;
    if (method !== 'GET') headers['content-length'] = Buffer.byteLength(payload);
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(text); } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, json, text }); });
    });
    req.on('error', reject);
    if (method !== 'GET') req.end(payload); else req.end();
  });
}
class Device {
  constructor(flags) { this.key = new SoftAuthenticator(flags === undefined ? {} : { flags }); this.cookie = null; }
  take(r) {
    const sc = [].concat(r.headers['set-cookie'] || [])[0];
    if (!sc) return;
    const m = /^thp=([^;]*)/.exec(sc);
    this.cookie = m && m[1] && !/Max-Age=0/.test(sc) ? `thp=${m[1]}` : null;
  }
  async register(code, displayName, over = {}, { challengeOverride } = {}) {
    const options = await call('POST', '/api/auth/register/options', { body: { code, displayName }, cookie: this.cookie });
    if (options.status !== 200) return { options };
    const pk = options.json.publicKey;
    const credential = this.key.create({ rpId: pk.rp.id, origin: ORIGIN, challenge: pk.challenge, userHandle: pk.user.id, over });
    const verify = await call('POST', '/api/auth/register/verify', { body: { challengeId: challengeOverride || options.json.challengeId, credential }, cookie: this.cookie });
    this.take(verify);
    return { options, verify, credential };
  }
  async login(over = {}, mutate) {
    const options = await call('POST', '/api/auth/login/options', { body: {}, cookie: this.cookie });
    const pk = options.json.publicKey;
    let credential = this.key.get({ rpId: pk.rpId, origin: ORIGIN, challenge: pk.challenge, over });
    if (mutate) credential = mutate(credential) || credential;
    const verify = await call('POST', '/api/auth/login/verify', { body: { challengeId: options.json.challengeId, credential }, cookie: this.cookie });
    this.take(verify);
    return { options, verify, credential };
  }
  me() { return call('GET', '/api/auth/me', { cookie: this.cookie }); }
}

/* ======================================================================== */
await section('[1] CBOR — exactly what authenticators send, nothing else', () => {
  const vectors = [['00', 0], ['17', 23], ['1818', 24], ['1903e8', 1000], ['1a000f4240', 1000000], ['1b000000e8d4a51000', 1000000000000],
    ['20', -1], ['3863', -100], ['3903e7', -1000], ['f4', false], ['f5', true], ['f6', null], ['6449455446', 'IETF'], ['62225c', '"\\'], ['63e6b0b4', '水']];
  ok('RFC 8949 Appendix A integers, simple values and text', vectors.every(([h, v]) => decodeAll(hex(h)) === v));
  ok('byte strings, arrays, maps', decodeAll(hex('4401020304')).equals(Buffer.from([1, 2, 3, 4])) && JSON.stringify(decodeAll(hex('8301820203820405'))) === '[1,[2,3],[4,5]]' && decodeAll(hex('a201020304')).get(3) === 4);
  const round = [0, 23, 24, 255, 256, 65535, 65536, 4294967295, -1, -24, -25, -65537, 'päss', Buffer.alloc(300, 7), [1, [2, [3]]], new Map([[1, 2], [-3, Buffer.from('x')], ['fmt', 'none']])];
  ok('everything the test authenticator encodes decodes back identically', round.every(v => { const d = decodeAll(cbor(v)); return v instanceof Map ? [...v].every(([k, x]) => Buffer.isBuffer(x) ? x.equals(d.get(k)) : d.get(k) === x) : Buffer.isBuffer(v) ? v.equals(d) : JSON.stringify(d) === JSON.stringify(v); }));
  ok('decodeOne says where the item ended (a COSE key followed by more bytes)', decodeOne(hex('a1010200ff'), 0).end === 3);
  const refuse = (h, why) => { try { decodeAll(hex(h)); return false; } catch (e) { return e.code === 'bad-cbor' && (!why || e.message.includes(why)); } };
  ok('trailing bytes refused by decodeAll', refuse('0000', 'trailing'));
  ok('indefinite lengths refused (bytes, array, map)', refuse('5f41ff', 'indefinite') && refuse('9f01ff', 'indefinite') && refuse('bf0102ff', 'indefinite'));
  ok('tags refused', refuse('c11a514b67b0', 'tags'));
  ok('floats and undefined refused', refuse('f93e00', 'floats') && refuse('fb3ff199999999999a', 'floats') && refuse('f7', 'floats'));
  ok('duplicate map keys refused', refuse('a201020103', 'duplicate'));
  ok('map keys other than integer or text refused', refuse('a1f601', 'map keys') && refuse('a1410001', 'map keys'));
  ok('invalid UTF-8 refused', refuse('62c328', 'UTF-8'));
  ok('text is decoded byte-exactly: a leading U+FEFF is kept', decodeAll(hex('66efbbbf666d74')) === '\ufefffmt');
  ok('…so "fmt" and "\ufefffmt" are two different map keys', decodeAll(hex('a263666d7401 66efbbbf666d7402')).size === 2);
  ok('lengths past the end refused before slicing', refuse('4201', 'truncated') && refuse('5affffffff00', 'string too long') && refuse('9a00010000', 'truncated') && refuse('1a0001', 'truncated'));
  ok('integers beyond 2^53 refused', refuse('1bffffffffffffffff', 'too large'));
  ok('reserved additional information refused', refuse('1c', 'reserved'));
  const nest = n => hex('81'.repeat(n) + '00');
  ok('8 levels of nesting accepted, 9 refused', (() => { try { decodeAll(nest(8)); } catch (e) { return false; } return refuse('81'.repeat(9) + '00', 'deep'); })());
});

await section('[2] Real browsers and authenticators (py_webauthn captures)', () => {
  const asSent = f => { const c = clone(f.credential); if (f.transportEncoding === 'base64') for (const k of ['clientDataJSON', 'attestationObject']) c.response[k] = Buffer.from(c.response[k], 'base64').toString('base64url'); return c; };
  const reg = REAL.filter(f => f.ceremony === 'registration');
  for (const f of reg) {
    const r = (() => { try { return W.verifyRegistration({ credential: asSent(f), challenge: f.challenge, origins: [f.origin], rpId: f.rpId }); } catch (e) { return e; } })();
    const good = !(r instanceof Error) && r.credentialId === f.expect.credentialId
      && (!f.expect.credentialPublicKey || r.publicKeyCose.equals(Buffer.from(f.expect.credentialPublicKey, 'base64url')))
      && (f.expect.signCount == null || r.signCount === f.expect.signCount);
    ok(`registration verifies: ${f.name.replace(/^test_verif(y|ies)_/, '')} (${r.fmt || '?'}, alg ${r.alg})`, good);
  }
  const algs = new Set(reg.map(f => { try { return W.verifyRegistration({ credential: asSent(f), challenge: f.challenge, origins: [f.origin], rpId: f.rpId }).alg; } catch (e) { return null; } }));
  ok('the captures cover ES256 and RS256 keys, and none/packed/apple/tpm/android-key/fido-u2f formats', algs.has(-7) && algs.has(-257));

  const auth = REAL.filter(f => f.ceremony === 'authentication');
  const stored = f => ({ ...W.coseToJwk(decodeAll(Buffer.from(f.credentialPublicKey, 'base64url'))), signCount: f.signCount, userHandle: f.credential.response.userHandle ? fromB64u(f.credential.response.userHandle) : undefined });
  const run = (f, opts = {}) => W.verifyAssertion({ credential: opts.credential || f.credential, challenge: f.challenge, origins: [f.origin], rpId: f.rpId, stored: opts.stored || stored(f), requireUV: !!opts.requireUV, requireUserHandle: !!opts.requireUserHandle });
  for (const f of auth.filter(f => f.expect.ok)) {
    const r = (() => { try { return run(f); } catch (e) { return e; } })();
    ok(`sign-in verifies: ${f.name.replace(/^test_verify_authentication_response_with_/, '')} → counter ${f.expect.newSignCount}`, !(r instanceof Error) && r.signCount === f.expect.newSignCount && !r.counterRegressed && (f.expect.uv == null || r.uv === f.expect.uv));
  }
  const wrongKey = auth.find(f => /incorrect_public_key/.test(f.name));
  ok('a real response against the wrong public key → bad-signature', reason(() => run(wrongKey)) === 'bad-signature');
  const noUV = auth.find(f => /uv_required/.test(f.name));
  ok('a real response without user verification, when required → user-not-verified', reason(() => run(noUV, { requireUV: true })) === 'user-not-verified');

  // bend real data
  const none = reg.find(f => /none_attestation/.test(f.name));
  const regWith = o => reason(() => W.verifyRegistration({ credential: asSent(none), challenge: none.challenge, origins: [none.origin], rpId: none.rpId, ...o }));
  ok('another RP ID → wrong-rp-id', regWith({ rpId: 'evil.example' }) === 'wrong-rp-id');
  ok('another origin → wrong-origin', regWith({ origins: ['http://localhost:5001'] }) === 'wrong-origin');
  ok('another challenge → wrong-challenge', regWith({ challenge: b64u(Buffer.alloc(64, 1)) }) === 'wrong-challenge');
  const att = decodeAll(fromB64u(none.credential.response.attestationObject));
  const withAuthData = ad => { const c = clone(none.credential); c.response.attestationObject = b64u(cbor(new Map([['fmt', att.get('fmt')], ['attStmt', att.get('attStmt')], ['authData', ad]]))); return c; };
  const regCred = c => reason(() => W.verifyRegistration({ credential: c, challenge: none.challenge, origins: [none.origin], rpId: none.rpId }));
  ok('one extra byte after the public key → authdata-trailing-bytes', regCred(withAuthData(Buffer.concat([att.get('authData'), Buffer.from([0])]))) === 'authdata-trailing-bytes');
  ok('one byte short → refused', regCred(withAuthData(att.get('authData').subarray(0, att.get('authData').length - 1))) !== 'accepted');
  ok('credential id in authData differing from rawId → credential-id-mismatch', (() => { const c = clone(none.credential); const other = b64u(Buffer.alloc(64, 9)); c.id = other; c.rawId = other; return regCred(c) === 'credential-id-mismatch'; })());
  ok('id and rawId that disagree → credential-id-mismatch', (() => { const c = clone(none.credential); c.id = b64u(Buffer.alloc(8)); return regCred(c) === 'credential-id-mismatch'; })());
  ok('base64 padding is not base64url → refused', (() => { const c = clone(none.credential); c.response.clientDataJSON += '='; return regCred(c) === 'bad-client-data'; })());
  ok('+ and / are not base64url → refused', (() => { const c = clone(none.credential); c.response.attestationObject = c.response.attestationObject.replace(/-/g, '+').replace(/_/g, '/'); return c.response.attestationObject !== none.credential.response.attestationObject && regCred(c) === 'bad-attestation-object'; })());

  const rsa = auth.find(f => /RSA/.test(f.name));
  const flipSig = () => { const c = clone(rsa.credential); const s = fromB64u(c.response.signature); s[s.length - 1] ^= 1; c.response.signature = b64u(s); return c; };
  ok('one flipped signature bit → bad-signature', reason(() => run(rsa, { credential: flipSig() })) === 'bad-signature');
  ok('a user handle that is not the owner’s → wrong-user-handle', reason(() => run(rsa, { stored: { ...stored(rsa), userHandle: Buffer.alloc(32, 1) }, requireUserHandle: true })) === 'wrong-user-handle');
  const ec2 = auth.find(f => /EC2/.test(f.name));
  ok('no user handle when one is required → no-user-handle', reason(() => run(ec2, { requireUserHandle: true })) === 'no-user-handle');
  ok('an empty user handle counts as none', (() => { const c = clone(ec2.credential); c.response.userHandle = ''; return reason(() => run(ec2, { credential: c, requireUserHandle: true })) === 'no-user-handle'; })());
  ok('a stored counter above the new one → counterRegressed', run(ec2, { stored: { ...stored(ec2), signCount: 78 } }).counterRegressed === true && run(ec2).counterRegressed === false);

  // keys
  const cose = m => new Map(m);
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const small = publicKey.export({ format: 'jwk' });
  ok('RSA below 2048 bits → rsa-key-too-small', reason(() => W.coseToJwk(cose([[1, 3], [3, -257], [-1, fromB64u(small.n)], [-2, fromB64u(small.e)]]))) === 'rsa-key-too-small');
  const big = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' });
  ok('RSA 2048 with e = 65537 accepted; e = 3 refused', reason(() => W.coseToJwk(cose([[1, 3], [3, -257], [-1, fromB64u(big.n)], [-2, fromB64u(big.e)]]))) === 'accepted' && reason(() => W.coseToJwk(cose([[1, 3], [3, -257], [-1, fromB64u(big.n)], [-2, Buffer.from([3])]]))) === 'rsa-exponent-not-65537');
  ok('a P-256 point that is not on the curve → bad-public-key', reason(() => W.coseToJwk(cose([[1, 2], [3, -7], [-1, 1], [-2, Buffer.alloc(32, 1)], [-3, Buffer.alloc(32, 2)]]))) === 'bad-public-key');
  ok('an unsupported algorithm (ES384) → unsupported-algorithm', reason(() => W.coseToJwk(cose([[1, 2], [3, -35], [-1, 2]]))) === 'unsupported-algorithm');
  ok('a key type that does not match its algorithm → bad-public-key', reason(() => W.coseToJwk(cose([[1, 3], [3, -7], [-1, 1], [-2, Buffer.alloc(32)], [-3, Buffer.alloc(32)]]))) === 'bad-public-key');
  const fakeRsa = bytes => cose([[1, 3], [3, -257], [-1, Buffer.concat([Buffer.from([0x80]), Buffer.alloc(bytes - 1, 1)])], [-2, Buffer.from([1, 0, 1])]]);
  ok('RSA above 4096 bits → rsa-key-too-large (checked before any key is built)', reason(() => W.coseToJwk(fakeRsa(513))) === 'rsa-key-too-large');
  const soft = new SoftAuthenticator({ flags: FLAG.UP | FLAG.UV | FLAG.BS });
  const bsReg = soft.create({ rpId: 'localhost', origin: ORIGIN, challenge: 'c1', userHandle: b64u(Buffer.alloc(32, 3)) });
  ok('registration: backed up without backup eligibility → backup-state-without-eligibility', reason(() => W.verifyRegistration({ credential: bsReg, challenge: 'c1', origins: [ORIGIN], rpId: 'localhost' })) === 'backup-state-without-eligibility');
  const good = new SoftAuthenticator({ flags: FLAG.UP | FLAG.UV | FLAG.BE | FLAG.BS });
  const gReg = W.verifyRegistration({ credential: good.create({ rpId: 'localhost', origin: ORIGIN, challenge: 'c2', userHandle: b64u(Buffer.alloc(32, 4)) }), challenge: 'c2', origins: [ORIGIN], rpId: 'localhost' });
  const gStored = { alg: gReg.alg, jwk: gReg.jwk, signCount: 0, userHandle: Buffer.alloc(32, 4) };
  ok('eligible and backed up (a synced passkey) is fine', gReg.backupEligible && gReg.backedUp);
  good.flags = FLAG.UP | FLAG.UV | FLAG.BS;
  ok('sign-in: backed up without backup eligibility → backup-state-without-eligibility', reason(() => W.verifyAssertion({ credential: good.get({ rpId: 'localhost', origin: ORIGIN, challenge: 'c3' }), challenge: 'c3', origins: [ORIGIN], rpId: 'localhost', stored: gStored })) === 'backup-state-without-eligibility');
  good.flags = FLAG.UP | FLAG.BE;
  const tampered = good.get({ rpId: 'localhost', origin: ORIGIN, challenge: 'c4', over: { tamper: true } });
  ok('user verification is judged only after the signature: a bad signature says bad-signature, not user-not-verified', reason(() => W.verifyAssertion({ credential: tampered, challenge: 'c4', origins: [ORIGIN], rpId: 'localhost', stored: gStored, requireUV: true })) === 'bad-signature');
  ok('Ed25519 keys accepted', reason(() => W.coseToJwk(cose([[1, 1], [3, -8], [-1, 6], [-2, fromB64u(generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x)]]))) === 'accepted');
});

await section('[3] Fuzz — 3000 mutated real responses: refused or accepted, never a crash', () => {
  const pick = REAL.filter(f => f.ceremony === 'registration' && !f.transportEncoding);
  let crashes = 0, accepted = 0, seed = 12345;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 3000; i++) {
    const f = pick[i % pick.length];
    const c = clone(f.credential);
    const field = rnd(2) ? 'attestationObject' : 'clientDataJSON';
    let b = Buffer.from(fromB64u(c.response[field]));
    const op = rnd(3);
    if (op === 0) b[rnd(b.length)] ^= 1 << rnd(8);
    else if (op === 1) b = b.subarray(0, rnd(b.length));
    else b = Buffer.concat([b.subarray(0, rnd(b.length)), Buffer.from([rnd(256)]), b.subarray(rnd(b.length))]);
    c.response[field] = b64u(b);
    const r = reason(() => W.verifyRegistration({ credential: c, challenge: f.challenge, origins: [f.origin], rpId: f.rpId }));
    if (r.startsWith('CRASH')) { crashes++; if (crashes < 3) console.log('    crash:', r); }
    if (r === 'accepted') accepted++;
  }
  ok('no mutation crashes the verifier', crashes === 0);
  ok(`mutations were overwhelmingly refused (${accepted} accepted — flips in bytes nothing trusts, like attStmt or the AAGUID)`, accepted < 600);
});

/* ---------------- the real server ---------------- */
const mod = require('../server/index.js');
await new Promise(r => mod.server.listen(PORT, '127.0.0.1', r));
const db = mod.accountsDb;
const clubId = ID.createClub(db, { name: 'Test WPC', actor: 'operator' }, Date.now());
const invite = () => ID.issueCode(db, { kind: 'club-admin', clubId, role: 'admin', actor: 'operator' }, Date.now()).code;
const count = (table, where = '1', ...args) => db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get(...args).n;

await section('[4] Request rules on every sign-in route', async () => {
  const body = { code: 'x', displayName: 'X' };
  ok('no Origin header → 403', (await call('POST', '/api/auth/register/options', { body, origin: null })).status === 403);
  ok('a foreign Origin → 403', (await call('POST', '/api/auth/login/options', { body: {}, origin: 'https://evil.example' })).status === 403);
  ok('a look-alike Origin (another port) → 403', (await call('POST', '/api/auth/login/options', { body: {}, origin: 'http://localhost:8089' })).status === 403);
  ok('a form post (text/plain) → 415', (await call('POST', '/api/auth/logout', { raw: '{}', type: 'text/plain' })).status === 415);
  ok('a form post (urlencoded) → 415', (await call('POST', '/api/auth/login/verify', { raw: 'a=b', type: 'application/x-www-form-urlencoded' })).status === 415);
  ok('a body over 64 kB → 413', (await call('POST', '/api/auth/register/options', { body: { code: 'x'.repeat(70000) } })).status === 413);
  ok('broken JSON → 400', (await call('POST', '/api/auth/login/options', { raw: '{oops' })).status === 400);
  ok('GET on a POST route → 405', (await call('GET', '/api/auth/login/options')).status === 405);
  ok('an unknown sign-in route → 404', (await call('POST', '/api/auth/nope', { body: {} })).status === 404);
  const r = await call('POST', '/api/auth/login/options', { body: {} });
  ok('no CORS headers, and no-store', !r.headers['access-control-allow-origin'] && r.headers['cache-control'] === 'no-store');
  const pre = await call('OPTIONS', '/api/auth/login/options', { raw: '' });
  ok('a CORS preflight gets no permission', pre.status >= 400 && !pre.headers['access-control-allow-origin']);
  ok('/api/auth/me without a session → 401 signed-out', (await call('GET', '/api/auth/me')).json.error === 'signed-out');
});

let admin;   // the first account, kept for later sections
await section('[5] Creating an account with an operator invite', async () => {
  const dev = new Device();
  ok('an invalid invite → 400 invalid-code', (await call('POST', '/api/auth/register/options', { body: { code: 'ABCDE-FGHJK-MNPQR-STVWX-YZ012-3', displayName: 'A' } })).json.error === 'invalid-code');
  ok('an empty name → 400 bad-name', (await call('POST', '/api/auth/register/options', { body: { code: invite(), displayName: '  ‮ ' } })).json.error === 'bad-name');
  const code = invite();
  const o = await call('POST', '/api/auth/register/options', { body: { code, displayName: 'Alex Admin' } });
  const pk = o.json.publicKey;
  ok('options: RP localhost, a 32-byte random user handle, a discoverable passkey', pk.rp.id === 'localhost' && fromB64u(pk.user.id).length === 32 && pk.authenticatorSelection.residentKey === 'required');
  ok('options: user verification required for a staff invite, no attestation, Ed25519/ES256/RS256', pk.authenticatorSelection.userVerification === 'required' && pk.attestation === 'none' && JSON.stringify(pk.pubKeyCredParams.map(p => p.alg)) === '[-8,-7,-257]');
  ok('options: name the club and role the invite is for', o.json.club && o.json.club.name === 'Test WPC' && o.json.club.role === 'admin');
  ok('asking for options does not use the invite up', !!ID.peekCode(db, { code, kinds: ['club-admin'] }, Date.now()));
  const credential = dev.key.create({ rpId: pk.rp.id, origin: ORIGIN, challenge: pk.challenge, userHandle: pk.user.id });
  const v = await call('POST', '/api/auth/register/verify', { body: { challengeId: o.json.challengeId, credential } });
  dev.take(v);
  ok('verify → 200: signed in as admin of the club', v.status === 200 && v.json.user.displayName === 'Alex Admin' && v.json.clubs[0].role === 'admin' && v.json.clubs[0].status === 'approved');
  const sc = [].concat(v.headers['set-cookie'])[0];
  ok('cookie: thp, HttpOnly, SameSite=Lax, Path=/, 180-day Max-Age, no Secure on localhost', /^thp=[A-Za-z0-9_-]{43};/.test(sc) && /HttpOnly/.test(sc) && /SameSite=Lax/.test(sc) && /Path=\//.test(sc) && /Max-Age=15552000/.test(sc) && !/Secure/.test(sc));
  const me = await dev.me();
  ok('/api/auth/me knows who this is, with a verified session', me.status === 200 && me.json.user.id === v.json.user.id && me.json.session.uv === true);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(me.json.user.id);
  ok('the stored user handle is the one the authenticator was given', Buffer.from(user.webauthn_user_handle).equals(fromB64u(pk.user.id)));
  ok('the invite is now used up', !ID.peekCode(db, { code, kinds: ['club-admin'] }, Date.now()) && (await call('POST', '/api/auth/register/options', { body: { code, displayName: 'Again' } })).json.error === 'invalid-code');
  const token = dev.cookie.slice(4);
  ok('only a hash of the session token is stored — the token is not in the database files', (() => { db.exec('PRAGMA wal_checkpoint(FULL)'); return !readdirSync(DATA).filter(f => f.startsWith('triibholz.db')).some(f => readFileSync(join(DATA, f)).toString('latin1').includes(token)); })());
  ok('the replayed verification is refused (the challenge is single-use)', (await call('POST', '/api/auth/register/verify', { body: { challengeId: o.json.challengeId, credential } })).json.error === 'challenge-invalid');
  ok('a signed-in device cannot start another registration', (await call('POST', '/api/auth/register/options', { body: { code: invite(), displayName: 'B' }, cookie: dev.cookie })).status === 409);
  ok('an audit row records the passkey, with no name in it', count('audit', "action = 'credential.register' AND subject = ?", me.json.user.id) === 1 && !JSON.stringify(db.prepare('SELECT * FROM audit').all()).includes('Alex Admin'));
  admin = dev;
});

await section('[6] Registration refusals — and a failed attempt never uses up the invite', async () => {
  const code = invite();
  const users = count('users');
  const tries = [
    ['no user verification on a staff invite', { flags: FLAG.UP }, 'user-not-verified'],
    ['no user presence', { flags: FLAG.UV }, 'user-not-present'],
    ['client data from another origin', { origin: 'https://evil.example' }, 'wrong-origin'],
    ['authenticator data for another RP ID', { rpId: 'evil.example' }, 'wrong-rp-id'],
    ['a get() response type', { type: 'webauthn.get' }, 'wrong-type'],
    ['crossOrigin: true', { clientExtra: { crossOrigin: true } }, 'cross-origin'],
    ['a challenge it was not given', { challenge: b64u(Buffer.alloc(32, 5)) }, 'wrong-challenge'],
    ['an unsupported algorithm', { cose: cbor(new Map([[1, 2], [3, -35], [-1, 2], [-2, Buffer.alloc(48)], [-3, Buffer.alloc(48)]])) }, 'unsupported-algorithm'],
  ];
  for (const [name, over, want] of tries) {
    const r = await new Device().register(code, 'Refused Person', over);
    ok(`${name} → ${want}`, r.verify.status === 400 && r.verify.json.reason === want);
  }
  ok('none of them created an account or used the invite', count('users') === users && !!ID.peekCode(db, { code, kinds: ['club-admin'] }, Date.now()));
  const dev = new Device();
  const failed = await dev.register(code, 'Eve', { origin: 'https://evil.example' });
  ok('a failed challenge cannot be retried with a good response', (await call('POST', '/api/auth/register/verify', { body: { challengeId: failed.options.json.challengeId, credential: dev.key.create({ rpId: 'localhost', origin: ORIGIN, challenge: failed.options.json.publicKey.challenge, userHandle: failed.options.json.publicKey.user.id }) } })).json.error === 'challenge-invalid');
  const login = await call('POST', '/api/auth/login/options', { body: {} });
  const cross = await new Device().register(code, 'Kind Mixer', {}, { challengeOverride: login.json.challengeId });
  ok('a sign-in challenge presented to registration → challenge-invalid (flows are bound)', cross.verify.json.error === 'challenge-invalid');
  const o = await call('POST', '/api/auth/register/options', { body: { code, displayName: 'Late' } });
  db.prepare('UPDATE challenges SET expires_at = ? WHERE id = ?').run(Date.now() - 1, o.json.challengeId);
  const late = new Device().key.create({ rpId: 'localhost', origin: ORIGIN, challenge: o.json.publicKey.challenge, userHandle: o.json.publicKey.user.id });
  ok('an expired challenge → challenge-invalid', (await call('POST', '/api/auth/register/verify', { body: { challengeId: o.json.challengeId, credential: late } })).json.error === 'challenge-invalid');
  const ok1 = await new Device().register(code, 'Finally Fine');
  ok('after all that, the same invite still works once', ok1.verify.status === 200);

  // two verifications racing on one challenge
  const race = await call('POST', '/api/auth/register/options', { body: { code: invite(), displayName: 'Racer' } });
  const rd = new Device();
  const rc = rd.key.create({ rpId: 'localhost', origin: ORIGIN, challenge: race.json.publicKey.challenge, userHandle: race.json.publicKey.user.id });
  const both = await Promise.all([1, 2].map(() => call('POST', '/api/auth/register/verify', { body: { challengeId: race.json.challengeId, credential: rc } })));
  ok('two verifications racing for one challenge: exactly one account', both.filter(r => r.status === 200).length === 1 && count('users', "display_name = 'Racer'") === 1);

  // the invite is revoked between options and verify
  const rcode = invite();
  const ro = await call('POST', '/api/auth/register/options', { body: { code: rcode, displayName: 'Revoked' } });
  ID.revokeCodes(db, { clubId, actor: 'operator' }, Date.now());
  const rv = await call('POST', '/api/auth/register/verify', { body: { challengeId: ro.json.challengeId, credential: new Device().key.create({ rpId: 'localhost', origin: ORIGIN, challenge: ro.json.publicKey.challenge, userHandle: ro.json.publicKey.user.id }) } });
  ok('an invite revoked after the options were issued → invalid-code, and no account left behind', rv.json.error === 'invalid-code' && count('users', "display_name = 'Revoked'") === 0);

  const dupId = Buffer.alloc(16, 0x42);
  await new Device().register(invite(), 'First Holder', { credentialId: dupId });
  const dup = await new Device().register(invite(), 'Second Holder', { credentialId: dupId });
  ok('a credential id that already belongs to someone → 409, nothing created', dup.verify.status === 409 && count('users', "display_name = 'Second Holder'") === 0);
});

await section('[7] Signing in, signing out', async () => {
  const dev = admin;
  const out = await call('POST', '/api/auth/logout', { body: {}, cookie: dev.cookie });
  const oldCookie = dev.cookie;
  dev.take(out);
  ok('sign-out clears the cookie', out.status === 200 && /Max-Age=0/.test([].concat(out.headers['set-cookie'])[0]) && dev.cookie === null);
  ok('…and the old cookie no longer works', (await call('GET', '/api/auth/me', { cookie: oldCookie })).status === 401);
  const o = await call('POST', '/api/auth/login/options', { body: {} });
  ok('sign-in options: discoverable (no allowCredentials), UV preferred, this RP', o.json.publicKey.rpId === 'localhost' && o.json.publicKey.allowCredentials.length === 0 && o.json.publicKey.userVerification === 'preferred');
  const before = db.prepare('SELECT sign_count FROM credentials WHERE user_id = (SELECT id FROM users WHERE display_name = ?)').get('Alex Admin').sign_count;
  const l = await dev.login();
  ok('sign-in → 200 and a new session', l.verify.status === 200 && (await dev.me()).status === 200);
  ok('the signature counter moved forward', db.prepare('SELECT sign_count FROM credentials WHERE user_id = (SELECT id FROM users WHERE display_name = ?)').get('Alex Admin').sign_count === before + 1);
  const a = dev.cookie;
  await dev.login();
  ok('signing in again replaces the session: the previous cookie stops working', dev.cookie !== a && (await call('GET', '/api/auth/me', { cookie: a })).status === 401 && (await dev.me()).status === 200);
  ok('a duplicated cookie name (a planted cookie beside the real one) → signed out', (await call('GET', '/api/auth/me', { cookie: `${dev.cookie}; thp=${'A'.repeat(43)}` })).status === 401);
  ok('in secure mode the cookie is __Host-thp with Secure, and a plain thp cookie is ignored', /^__Host-thp=t; Path=\/; HttpOnly; SameSite=Lax; Max-Age=5; Secure$/.test(AUTH.cookieHeader({ cookieName: '__Host-thp', cookieSecure: true }, 't', 5))
    && AUTH.readSessionToken({ headers: { cookie: 'thp=' + 'A'.repeat(43) } }, { cookieName: '__Host-thp' }) === null
    && AUTH.readSessionToken({ headers: { cookie: '__Host-thp=' + 'A'.repeat(43) } }, { cookieName: '__Host-thp' }) === 'A'.repeat(43));
});

await section('[8] Sign-in refusals', async () => {
  const code = invite();
  const alice = new Device(); await alice.register(code, 'Alice');
  const bob = new Device(); await bob.register(invite(), 'Bob');
  const fresh = d => { d.cookie = null; return d; };
  const bad = async (name, dev, over, mutate, extra) => {
    const r = await fresh(dev).login(over, mutate);
    ok(name, r.verify.status === 401 && r.verify.json.error === 'sign-in-failed' && (!extra || extra(r)) && !dev.cookie);
  };
  const stranger = new Device(); stranger.key.create({ rpId: 'localhost', origin: ORIGIN, challenge: 'x', userHandle: b64u(Buffer.alloc(32)) });
  await bad('an unregistered passkey → 401', stranger, {}, null);
  await bad('a tampered signature → 401', alice, { tamper: true });
  await bad('client data from another origin → 401', alice, { origin: 'https://evil.example' });
  await bad('crossOrigin: true → 401', alice, { clientExtra: { crossOrigin: true } });
  await bad('authenticator data for another RP ID → 401', alice, { rpId: 'evil.example' });
  await bad('no user presence → 401', alice, { flags: FLAG.UV });
  await bad('no user handle → 401', alice, { userHandle: null });
  await bad('an empty user handle → 401', alice, { userHandle: '' });
  const bobHandle = db.prepare("SELECT webauthn_user_handle AS h FROM users WHERE display_name = 'Bob'").get().h;
  await bad('Bob’s user handle on Alice’s passkey → 401', alice, { userHandle: b64u(Buffer.from(bobHandle)) });
  await bad('a staff member without user verification → 401, asking for verification', alice, { flags: FLAG.UP }, null, r => r.verify.json.reason === 'user-verification-required');
  await bad('…but with a bad signature the answer is a bare 401: nobody learns the account is staff', alice, { flags: FLAG.UP, tamper: true }, null, r => r.verify.json.reason === undefined);
  await bad('…and with someone else’s user handle, a bare 401 too', alice, { flags: FLAG.UP, userHandle: b64u(Buffer.alloc(32, 7)) }, null, r => r.verify.json.reason === undefined);
  const o = await call('POST', '/api/auth/login/options', { body: {} });
  const reg = await call('POST', '/api/auth/register/options', { body: { code: invite(), displayName: 'Z' } });
  const cred = alice.key.get({ rpId: 'localhost', origin: ORIGIN, challenge: reg.json.publicKey.challenge });
  ok('a registration challenge presented to sign-in → challenge-invalid', (await call('POST', '/api/auth/login/verify', { body: { challengeId: reg.json.challengeId, credential: cred } })).json.error === 'challenge-invalid');
  const good = alice.key.get({ rpId: 'localhost', origin: ORIGIN, challenge: o.json.publicKey.challenge });
  ok('after all those refusals Alice still signs in', (await call('POST', '/api/auth/login/verify', { body: { challengeId: o.json.challengeId, credential: good } })).status === 200);
  ok('…and the replayed response is refused', (await call('POST', '/api/auth/login/verify', { body: { challengeId: o.json.challengeId, credential: good } })).json.error === 'challenge-invalid');
});

await section('[9] A cloned passkey, and too many failures', async () => {
  const dev = new Device(); await dev.register(invite(), 'Clone Victim');
  await dev.login(); await dev.login();
  const cookie = dev.cookie;
  const credId = [...dev.key.creds.keys()][0];
  const stored = db.prepare('SELECT sign_count FROM credentials WHERE id = ?').get(credId).sign_count;
  const clone = await (new Device()).login.call(Object.assign(new Device(), { key: dev.key }), { count: stored });
  ok('a response whose counter did not move (a clone) → 401', clone.verify.status === 401);
  ok('…the passkey is marked suspect and audited', db.prepare('SELECT status FROM credentials WHERE id = ?').get(credId).status === 'suspect' && count('audit', "action = 'credential.suspect'") >= 1);
  ok('…its existing sessions end', (await call('GET', '/api/auth/me', { cookie })).status === 401);
  ok('…and it cannot sign in any more, even with a good counter', (await Object.assign(new Device(), { key: dev.key }).login({ count: stored + 50 })).verify.status === 401);

  const victim = new Device(); await victim.register(invite(), 'Guessed At');
  const victimId = db.prepare("SELECT id FROM users WHERE display_name = 'Guessed At'").get().id;
  for (let i = 0; i < 12; i++) await Object.assign(new Device(), { key: victim.key }).login({ tamper: true });
  ok('12 failed sign-ins on one passkey leave exactly one audit row', count('audit', "action = 'credential.failures' AND subject = ?", victimId) === 1);
  ok('…and never lock the owner out: a correct sign-in still works (nobody can lock someone else out)', (await Object.assign(new Device(), { key: victim.key }).login()).verify.status === 200);

  const ip = '203.0.113.7';
  let last;
  for (let i = 0; i < 61; i++) last = await call('POST', '/api/auth/login/options', { body: {}, ip });
  ok('61 option requests in a minute from one address → 429', last.status === 429);
  ok('…while another address is unaffected', (await call('POST', '/api/auth/login/options', { body: {}, ip: '203.0.113.8' })).status === 200);
  const fake = (peer, real) => ({ socket: { remoteAddress: peer }, headers: { 'x-real-ip': real } });
  ok('IPv6 addresses share a limit per /64; IPv4-mapped addresses count as IPv4', AUTH.addressKey('2001:db8:1:2::5') === AUTH.addressKey('2001:db8:1:2:ffff::9') && AUTH.addressKey('2001:db8:1:3::5') !== AUTH.addressKey('2001:db8:1:2::5') && AUTH.addressKey('::ffff:203.0.113.9') === '203.0.113.9' && AUTH.addressKey('nonsense') === 'unknown');
  ok('X-Real-IP is believed only from a private peer (nginx), never from the internet', AUTH.clientAddress(fake('172.18.0.3', '1.2.3.4')) === '1.2.3.4' && AUTH.clientAddress(fake('::ffff:127.0.0.1', '1.2.3.4')) === '1.2.3.4' && AUTH.clientAddress(fake('8.8.8.8', '1.2.3.4')) === '8.8.8.8' && AUTH.clientAddress(fake('172.32.0.1', '1.2.3.4')) === '172.32.0.1');
});

await section('[10] Session lifetime', async () => {
  const dev = new Device(); await dev.register(invite(), 'Timed');
  const hash = () => db.prepare("SELECT s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.display_name = 'Timed'").get().token_hash;
  const t = Date.now();
  db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(t - 6 * 60000, t + 60000, hash());
  await dev.me();
  const slid = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash()).expires_at;
  ok('an active staff session slides to 14 days from now', Math.abs(slid - (Date.now() + AUTH.SESSION.staffIdle)) < 5000);
  db.prepare('UPDATE sessions SET last_seen_at = ?, absolute_expires_at = ? WHERE token_hash = ?').run(t - 6 * 60000, t + 1000, hash());
  await dev.me();
  ok('…but never past the absolute limit', db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash()).expires_at === t + 1000);
  db.prepare('UPDATE sessions SET absolute_expires_at = ? WHERE token_hash = ?').run(t - 1, hash());
  ok('past the absolute limit → signed out, and the row is gone', (await dev.me()).status === 401 && count('sessions', "user_id = (SELECT id FROM users WHERE display_name = 'Timed')") === 0);
  await dev.login();
  db.prepare("UPDATE credentials SET status = 'revoked' WHERE user_id = (SELECT id FROM users WHERE display_name = 'Timed')").run();
  ok('revoking the passkey ends the sessions made with it', (await dev.me()).status === 401);
});

await section('[11] Hardening from the adversarial review', async () => {
  const before = count('challenges');
  for (let i = 0; i < 40; i++) await call('POST', '/api/auth/login/options', { body: {} });
  ok('40 anonymous sign-in option requests write no challenge rows', count('challenges') === before);

  const key = Buffer.from(db.prepare("SELECT secret FROM server_keys WHERE name = 'login-challenge'").get().secret);
  const mint = (expiresAt, k = key) => { const nonce = randomBytes(16), exp = Buffer.alloc(8); exp.writeBigUInt64BE(BigInt(expiresAt)); const mac = createHmac('sha256', k).update('login').update(nonce).update(exp).digest().subarray(0, 16); return b64u(Buffer.concat([nonce, exp, mac])); };
  const dev = new Device(); await dev.register(invite(), 'Hardened');
  const tryLogin = async (challenge, over = {}) => { const cred = dev.key.get({ rpId: 'localhost', origin: ORIGIN, challenge, over }); return call('POST', '/api/auth/login/verify', { body: { challengeId: challenge, credential: cred } }); };
  ok('a challenge signed with another key → challenge-invalid', (await tryLogin(mint(Date.now() + 60000, randomBytes(32)))).json.error === 'challenge-invalid');
  ok('a genuine but expired challenge → challenge-invalid', (await tryLogin(mint(Date.now() - 1))).json.error === 'challenge-invalid');
  ok('a genuine challenge claiming an expiry far in the future → challenge-invalid', (await tryLogin(mint(Date.now() + 3600e3))).json.error === 'challenge-invalid');
  ok('random bytes of the right length → challenge-invalid', (await tryLogin(b64u(randomBytes(40)))).json.error === 'challenge-invalid');
  const o = await call('POST', '/api/auth/login/options', { body: {} });
  const flipped = (() => { const b = Buffer.from(o.json.challengeId, 'base64url'); b[20] ^= 1; return b64u(b); })();
  ok('a genuine challenge with one expiry bit changed → challenge-invalid', (await tryLogin(flipped)).json.error === 'challenge-invalid');

  const cred = dev.key.get({ rpId: 'localhost', origin: ORIGIN, challenge: o.json.challengeId });
  const first = await call('POST', '/api/auth/login/verify', { body: { challengeId: o.json.challengeId, credential: cred } });
  const credId = db.prepare("SELECT c.id FROM credentials c JOIN users u ON u.id = c.user_id WHERE u.display_name = 'Hardened'").get().id;
  const replay = await call('POST', '/api/auth/login/verify', { body: { challengeId: o.json.challengeId, credential: cred } });
  ok('replaying a successful response from a counting authenticator → challenge-invalid, NOT a clone alarm', first.status === 200 && replay.json.error === 'challenge-invalid' && db.prepare('SELECT status FROM credentials WHERE id = ?').get(credId).status === 'active');
  ID.purgeExpired(db, Date.now());
  ok('…still refused after housekeeping has run (used challenges are kept until they expire)', (await call('POST', '/api/auth/login/verify', { body: { challengeId: o.json.challengeId, credential: cred } })).json.error === 'challenge-invalid');

  // registering from a browser that still carries someone's session ends that session
  const holder = new Device(); await holder.register(invite(), 'Previous Holder');
  const ro = await call('POST', '/api/auth/register/options', { body: { code: invite(), displayName: 'Next Person' } });
  const rc = new Device().key.create({ rpId: 'localhost', origin: ORIGIN, challenge: ro.json.publicKey.challenge, userHandle: ro.json.publicKey.user.id });
  const rv = await call('POST', '/api/auth/register/verify', { body: { challengeId: ro.json.challengeId, credential: rc }, cookie: holder.cookie });
  ok('registering with a leftover session cookie ends that session', rv.status === 200 && (await holder.me()).status === 401);

  // clients that hang up, stall, or hold the body back
  const logged = []; const realError = console.error; console.error = (...a) => { logged.push(a.join(' ')); };
  try {
    for (let i = 0; i < 20; i++) await new Promise(resolve => {
      const s = netmod.connect(PORT, '127.0.0.1', () => { s.write(`POST /api/auth/login/options HTTP/1.1\r\nHost: x\r\nOrigin: ${ORIGIN}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"a":`); setTimeout(() => { s.destroy(); resolve(); }, 15); });
      s.on('error', resolve);
    });
    await new Promise(r => setTimeout(r, 100));
  } finally { console.error = realError; }
  ok('20 clients hanging up mid-body: nothing logged as a server error', !logged.some(l => l.includes('[auth]')));
  ok('…and the server still answers', (await call('POST', '/api/auth/login/options', { body: {} })).status === 200);
  const slow = await new Promise(resolve => {
    const s = netmod.connect(PORT, '127.0.0.1', () => s.write(`POST /api/auth/login/options HTTP/1.1\r\nHost: x\r\nOrigin: ${ORIGIN}\r\nContent-Type: application/json\r\nContent-Length: 10\r\n\r\n{`));
    let buf = ''; s.on('data', d => { buf += d; }); s.on('close', () => resolve(buf)); s.on('error', () => resolve(buf));
    setTimeout(() => { s.destroy(); resolve(buf || 'NO ANSWER within 6 s'); }, 6000);   // the test's own deadline
  });
  ok('a body that stalls is cut off: 408 after the body timeout', /^HTTP\/1\.1 408/.test(slow));

  const late = await call('POST', '/api/auth/register/options', { body: { code: invite(), displayName: 'Held Back' } });
  db.prepare('UPDATE challenges SET expires_at = ? WHERE id = ?').run(Date.now() + 400, late.json.challengeId);
  const lateCred = new Device().key.create({ rpId: 'localhost', origin: ORIGIN, challenge: late.json.publicKey.challenge, userHandle: late.json.publicKey.user.id });
  const held = await new Promise((resolve, reject) => {
    const payload = JSON.stringify({ challengeId: late.json.challengeId, credential: lateCred });
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/api/auth/register/verify', headers: { origin: ORIGIN, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'x-real-ip': '10.77.0.1' } }, res => { let t = ''; res.on('data', d => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(t) })); });
    req.on('error', reject); req.flushHeaders();
    setTimeout(() => req.end(payload), 900);
  });
  ok('headers sent in time, body held back past the challenge’s expiry → challenge-invalid, no account', held.json.error === 'challenge-invalid' && count('users', "display_name = 'Held Back'") === 0);
});

mod.server.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
