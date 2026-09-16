/* The app itself, signing in for real: jsdom loads index.html and every module, a software passkey
   stands in for the device's authenticator, and it all talks to the real server with accounts on.
   Run:  node tests/signin.mjs   (deps: npm i inside tests/) */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { TextEncoder as TE, TextDecoder as TD } from 'node:util';
import { startServer, makeCall, Device } from './accounts-harness.mjs';
import { SoftAuthenticator, b64u, fromB64u } from './softauthn.mjs';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4297, ORIGIN = `http://localhost:${PORT}`;
const S = await startServer(PORT, { APP_ORIGINS: ORIGIN });
const { db, ID } = S;
const call = makeCall(PORT, ORIGIN);

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };
async function section(title, fn) {
  console.log('\n' + title);
  try { await fn(); } catch (e) { fail++; console.log('  ✗ FAIL: section threw —', e && e.stack || e); }
}

/* ---- the page ---- */
const html = readFileSync(join(APP, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: ORIGIN + '/' });
const { window } = dom; const { document } = window;
window.TextEncoder = window.TextEncoder || TE;
window.TextDecoder = window.TextDecoder || TD;
window.DecompressionStream = window.DecompressionStream || globalThis.DecompressionStream;
window.Response = window.Response || globalThis.Response;
if (!window.Blob.prototype.text) window.Blob.prototype.text = function () { return new Promise(r => { const fr = new window.FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsText(this); }); };

/* fetch, with the cookie jar a browser would keep (jsdom has neither) */
let cookie = null;
window.fetch = (input, init = {}) => new Promise((resolve, reject) => {
  const u = new URL(String(input), ORIGIN);
  const headers = Object.assign({}, init.headers || {});
  if (init.body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (!headers.origin && (init.method || 'GET') !== 'GET') headers.origin = ORIGIN;
  const req = http.request({ host: '127.0.0.1', port: PORT, method: init.method || 'GET', path: u.pathname + u.search, headers }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      const set = [].concat(res.headers['set-cookie'] || [])[0];
      if (set) { const m = /^thp=([^;]*)/.exec(set); cookie = m && m[1] && !/Max-Age=0/.test(set) ? `thp=${m[1]}` : null; }
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
        headers: { get: k => res.headers[String(k).toLowerCase()] || null },
        json: async () => JSON.parse(text), text: async () => text });
    });
  });
  req.on('error', reject);
  req.end(init.body === undefined ? undefined : init.body);
});

/* the device's authenticator: a real P-256 key, real CBOR, real signatures */
const authenticator = new SoftAuthenticator();
const toBuf = b => { const u = fromB64u(b); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); };
const fromBuf = b => b64u(Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b));
window.PublicKeyCredential = function () {};
window.navigator.credentials = {
  async create({ publicKey }) {
    const c = authenticator.create({ rpId: publicKey.rp.id, origin: ORIGIN, challenge: fromBuf(publicKey.challenge), userHandle: fromBuf(publicKey.user.id) });
    return { id: c.id, rawId: toBuf(c.rawId), type: 'public-key',
      response: { clientDataJSON: toBuf(c.response.clientDataJSON), attestationObject: toBuf(c.response.attestationObject), getTransports: () => ['internal'] } };
  },
  async get({ publicKey }) {
    const c = authenticator.get({ rpId: publicKey.rpId, origin: ORIGIN, challenge: fromBuf(publicKey.challenge) });
    return { id: c.id, rawId: toBuf(c.rawId), type: 'public-key',
      response: { clientDataJSON: toBuf(c.response.clientDataJSON), authenticatorData: toBuf(c.response.authenticatorData), signature: toBuf(c.response.signature),
        userHandle: c.response.userHandle ? toBuf(c.response.userHandle) : null } };
  },
};

const files = ['js/theme.js', 'js/i18n.js', 'js/help.js', 'js/draft.js', 'js/commands.js', 'js/solver.js', 'js/qr.js', 'js/fx.js', 'js/pool.js', 'js/data.js', 'js/animate.js',
  'js/vision.js', 'js/field.js', 'js/shot.js', 'js/testlog.js', 'js/chart.js', 'js/sheetdoc.js', 'js/eligibility.js', 'js/teamsheet.js', 'js/teams.js', 'js/manikin.js', 'js/track.js',
  'js/bytetrack.js', 'js/events.js', 'js/webdetector.js', 'js/videogen.js', 'js/calendar.js', 'js/planner.js', 'js/privacy.js', 'js/tactics.js', 'js/gameplan.js', 'js/share.js',
  'js/announce.js', 'js/wpmatch.js', 'js/api.js', 'js/session.js', 'js/analysis.js', 'js/film.js', 'js/app.js'];
window.eval(files.map(f => readFileSync(join(APP, f), 'utf8')).join('\n;\n') + '\n;\nwindow.__T = { SESSION, API, DATA };');

const q = s => document.querySelector(s);
const wait = ms => new Promise(r => window.setTimeout(r, ms));
const settle = async (n = 24) => { for (let i = 0; i < n; i++) await wait(25); };

const clubId = ID.createClub(db, { name: 'Signin WPC', actor: 'operator' }, Date.now());
const invite = ID.issueCode(db, { kind: 'club-admin', clubId, role: 'admin', actor: 'operator' }, Date.now()).code;

await section('[1] The app asks the server whether accounts exist', async () => {
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await settle();
  ok('the simulated sign-in and the demo personas are not offered at all', q('#auth-simulated').hidden === true && q('#auth-real').hidden === false);
  ok('what is offered is a passkey, and a place for an invite code', !!q('#signin-passkey') && !!q('#auth-code'));
  ok('…and it says there is no password to remember', /No password/.test(q('#auth-real-note').textContent));
});

await section('[2] An operator invite becomes a real account, with a real passkey', async () => {
  q('#auth-code').value = invite;
  q('#auth-code-go').click();
  await settle();
  ok('the code says which club and which role, before any name is typed', /Signin WPC/.test(q('#auth-join-note').textContent) && q('#auth-join-note').hidden === false);
  ok('…and only then asks for a name', q('#auth-name-wrap').hidden === false && q('#auth-create').hidden === false);
  q('#auth-name').value = 'Ada Admin';
  q('#auth-create').click();
  await settle(40);
  ok('the app is entered, signed in as that person', q('#app-screen').classList.contains('active') && /Ada Admin/.test(q('#user-pill').textContent));
  ok('the server agrees who it is', (await (await window.fetch('/api/auth/me')).json()).user.displayName === 'Ada Admin');
  ok('a passkey now exists for that account', db.prepare("SELECT count(*) AS n FROM credentials WHERE user_id = (SELECT id FROM users WHERE display_name = 'Ada Admin')").get().n === 1);
  ok('nothing about the person is kept in this browser’s storage', !JSON.stringify(window.localStorage).includes('Ada Admin'));
});

let player, playerRef;
await section('[3] A player asks to join, and the admin approves by the number', async () => {
  const joinCode = await (async () => {
    const res = await window.fetch(`/api/clubs/${clubId}/join-codes`, { method: 'POST', headers: { 'x-thp-client': '4' }, body: JSON.stringify({ label: 'U16 parents' }) });
    if (res.status === 403) {   // the app asks for the passkey again before it hands out a way in
      const o = await (await window.fetch('/api/auth/stepup/options', { method: 'POST', headers: { 'x-thp-client': '4' }, body: '{}' })).json();
      const cred = authenticator.get({ rpId: 'localhost', origin: ORIGIN, challenge: o.publicKey.challenge });
      await window.fetch('/api/auth/stepup/verify', { method: 'POST', headers: { 'x-thp-client': '4' }, body: JSON.stringify({ challengeId: o.challengeId, credential: cred }) });
      return (await (await window.fetch(`/api/clubs/${clubId}/join-codes`, { method: 'POST', headers: { 'x-thp-client': '4' }, body: JSON.stringify({ label: 'U16 parents' }) })).json()).code;
    }
    return (await res.json()).code;
  })();
  ok('an admin can make a join link (after proving it is still them)', /^[0-9A-Z]{5}-/.test(joinCode));
  player = new Device(call, undefined, ORIGIN);
  await player.register(joinCode, 'Pia Player');
  const me = (await player.me()).json;
  playerRef = me.clubs[0].memberRef;
  ok('the player’s app shows a request number to read out', /^\d{4}$/.test(me.clubs[0].requestNo) && me.clubs[0].status === 'pending');

  q('.nav-btn[data-view="admin"]').click();
  await settle(30);
  ok('the club console lists the request, with what it came through', /Pia Player/.test(q('#club-requests').textContent) && /U16 parents/.test(q('#club-requests').textContent));
  const row = q(`[data-member="${playerRef}"]`);
  row.querySelector(`[data-no="${playerRef}"]`).value = '0000';
  row.querySelector(`[data-approve-member="${playerRef}"]`).click();
  await settle(30);
  ok('the wrong number does not approve anybody', db.prepare('SELECT status FROM club_members WHERE member_ref = ?').get(playerRef).status === 'pending');
  const right = (await player.me()).json.clubs[0].requestNo;
  const row2 = q(`[data-member="${playerRef}"]`);
  row2.querySelector(`[data-no="${playerRef}"]`).value = right;
  row2.querySelector(`[data-approve-member="${playerRef}"]`).click();
  await settle(40);
  ok('the number they read out does', db.prepare('SELECT status FROM club_members WHERE member_ref = ?').get(playerRef).status === 'approved');
  ok('…and the console now shows them as a member', /Pia Player/.test(q('#view-admin').textContent));
});

await section('[4] Signing out and back in with the passkey alone', async () => {
  q('#logout-btn').click();
  await settle(30);
  ok('signing out returns to the sign-in screen', q('#auth-screen').classList.contains('active'));
  ok('…and the server has ended the session', (await window.fetch('/api/auth/me')).status === 401);
  q('#signin-passkey').click();
  await settle(40);
  ok('the passkey alone signs back in — no name, no e-mail, no password', q('#app-screen').classList.contains('active') && /Ada Admin/.test(q('#user-pill').textContent));
});

await section('[5] An app the server has moved past is told to update', async () => {
  const real = window.__T.SESSION.CLIENT_VERSION;
  const r = await window.fetch('/api/debriefs', { headers: { 'x-thp-client': String(real - 1) } });
  ok('an older app version is refused with 426, not a puzzle', r.status === 426 && (await r.json()).error === 'update-the-app');
  ok('…and the app it ships with is current', real >= 4);
});

S.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
