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
const asked = { get: 0 };
window.navigator.credentials = {
  async create({ publicKey }) {
    const c = authenticator.create({ rpId: publicKey.rp.id, origin: ORIGIN, challenge: fromBuf(publicKey.challenge), userHandle: fromBuf(publicKey.user.id) });
    return { id: c.id, rawId: toBuf(c.rawId), type: 'public-key',
      response: { clientDataJSON: toBuf(c.response.clientDataJSON), attestationObject: toBuf(c.response.attestationObject), getTransports: () => ['internal'] } };
  },
  async get({ publicKey }) {
    asked.get++;
    const c = authenticator.get({ rpId: publicKey.rpId, origin: ORIGIN, challenge: fromBuf(publicKey.challenge) });
    return { id: c.id, rawId: toBuf(c.rawId), type: 'public-key',
      response: { clientDataJSON: toBuf(c.response.clientDataJSON), authenticatorData: toBuf(c.response.authenticatorData), signature: toBuf(c.response.signature),
        userHandle: c.response.userHandle ? toBuf(c.response.userHandle) : null } };
  },
};

const files = ['js/theme.js', 'js/i18n.js', 'js/help.js', 'js/draft.js', 'js/commands.js', 'js/solver.js', 'js/qr.js', 'js/fx.js', 'js/pool.js', 'js/data.js', 'js/animate.js',
  'js/vision.js', 'js/field.js', 'js/shot.js', 'js/testlog.js', 'js/chart.js', 'js/sheetdoc.js', 'js/eligibility.js', 'js/teamsheet.js', 'js/teamsync.js', 'js/teams.js', 'js/manikin.js', 'js/track.js',
  'js/bytetrack.js', 'js/events.js', 'js/webdetector.js', 'js/videogen.js', 'js/calendar.js', 'js/planner.js', 'js/privacy.js', 'js/tactics.js', 'js/gameplan.js', 'js/share.js',
  'js/announce.js', 'js/wpmatch.js', 'js/api.js', 'js/session.js', 'js/analysis.js', 'js/film.js', 'js/app.js'];
window.eval(files.map(f => readFileSync(join(APP, f), 'utf8')).join('\n;\n') + '\n;\nwindow.__T = { SESSION, API, DATA, TEAMS, TEAMSYNC };');

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

await section('[3b] A clip sent from the Film Room arrives in the app, with its marks', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const clipId = 'clip_app_10_20.mp4';
  mkdirSync(join(S.DATA, 'clips'), { recursive: true });
  writeFileSync(join(S.DATA, 'clips', clipId), Buffer.alloc(24, 7));
  db.prepare("INSERT INTO assets (id, kind, club_id, owner_user_id, created_at) VALUES (?, 'clip', ?, ?, ?)").run(clipId, clubId, null, Date.now());
  const r = await window.fetch('/api/announcements', { method: 'POST', headers: { 'x-thp-client': '4' }, body: JSON.stringify({
    scope: 'team', title: '0:12 · Drive & kick', body: 'Watch the near post.',
    clip: { url: '/api/clips/' + clipId, title: '0:12 · Drive & kick', start: 8, end: 18, marks: ['6 on 6', 'near post'] } }) });
  ok('the club server accepts a moment with its marks', r.status === 201);
  q('#announce-btn').click();
  await settle(20);
  ok('it shows up in the bell', /Drive & kick/.test(q('#announce-panel').textContent));
  q('#announce-panel .announce-item').click();
  await settle(20);
  const open = q('#announce-detail');
  ok('opening it plays the clip, not a link to somewhere else', !!open.querySelector('video') && open.querySelector('video').getAttribute('src').includes(clipId));
  ok('…with what the coach marked on the moment', /6 on 6/.test(open.textContent) && /near post/.test(open.textContent));
});

await section('[3c] Writing to one player, picked by name from the club', async () => {
  q('#announce-btn').click();
  await settle(20);
  q('#announce-new').click();
  await settle(40);                                   // the list of who a coach may write to is fetched
  const modal = document.getElementById('announce-compose-modal');
  const to = modal.querySelector('#ann-to');
  ok('the composer offers the club’s approved members, by name', [...to.options].some(o => o.textContent === 'Pia Player'));
  ok('…as member refs, never as e-mail addresses or u_ ids', [...to.options].every(o => /^m_[A-Za-z0-9_-]{22}$/.test(o.value)));
  ok('…and never the coach writing the note', ![...to.options].some(o => o.textContent === 'Ada Admin'));
  modal.querySelector('[name="ann-scope"][value="player"]').click();
  await settle(10);
  ok('picking “one player” reveals the list', to.hidden === false);
  to.value = [...to.options].find(o => o.textContent === 'Pia Player').value;
  modal.querySelector('#ann-title').value = 'Your 2-metre position';
  modal.querySelector('#ann-body').value = 'Half a metre further out and you are free.';
  modal.querySelector('#ann-send').click();
  await settle(60);
  ok('the note is sent and the composer closes', !document.getElementById('announce-compose-modal'));
  const asApp = (d, path) => call('GET', path, { cookie: d.cookie, headers: { 'x-thp-client': '4' } });
  const mine = (await asApp(player, '/api/announcements')).json.announcements;
  ok('the player it was written to has it', mine.some(a => a.title === 'Your 2-metre position' && a.scope === 'player'));
  const stored = JSON.parse(readFileSync(join(S.DATA, 'announcements', mine.find(a => a.title === 'Your 2-metre position').id + '.json'), 'utf8'));
  ok('the server stamped who wrote it from the session, not from the app', stored.from.name === 'Ada Admin' && stored.from.email === '' && stored.to === playerRef);
  const outsider = new Device(call, undefined, ORIGIN);
  await outsider.register(ID.issueCode(db, { kind: 'club-admin', clubId: ID.createClub(db, { name: 'Elsewhere WPC', actor: 'operator' }, Date.now()), role: 'admin', actor: 'operator' }, Date.now()).code, 'Other Club');
  ok('another club sees nothing of it', !((await asApp(outsider, '/api/announcements')).json.announcements || []).some(a => a.title === 'Your 2-metre position'));
});

await section('[3d] The coach sends a team to the club, and the club has it', async () => {
  const { TEAMS: TM } = window.__T;
  // a team as this device would hold it: one licensed player, one signing whose licence is pending
  TM.save({ version: 1, templates: [], sheets: [], teams: [{ id: 'tlocal1', name: 'U14 blue', category: 'U14', club: '', leagueLabel: '', templateId: 'sa-2025', staff: {}, rules: {}, players: ['L50401', 'mq8'], wpmatch: null }],
    players: {
      L50401: { pid: 'L50401', licence: '50401', name: 'Beispiel', firstName: 'Nora', birthYear: '2013', gender: 'F', status: 'Inactive License', cap: '4', gk: false, edited: true },
      mq8: { pid: 'mq8', licence: '', name: 'Neue', firstName: 'Spielerin', birthYear: '2014', gender: 'F', status: '', cap: '', gk: true },
    } });
  q('.nav-btn[data-view="teams"]').click();
  await settle(30);
  ok('a coach is offered the club’s copy, and told what it does and does not send', !!q('#tm-sync') && /licence numbers/i.test(q('.tm-sync').textContent) && /stay on this device/i.test(q('.tm-sync').textContent));
  ok('…and that nothing has gone yet', /yet/i.test(q('.tm-sync').textContent));
  q('#tm-sync').click();
  await settle(80);
  ok('the club’s server now has the team', db.prepare('SELECT count(*) AS n FROM club_teams WHERE club_id = ?').get(clubId).n === 1);
  const rows = db.prepare('SELECT * FROM club_players WHERE club_id = ? ORDER BY name').all(clubId);
  ok('…with both players', rows.length === 2 && rows.some(r => r.licence === '50401'));
  ok('the licensed player’s birth year and nationality status never arrived', (() => {
    const lic = rows.find(r => r.licence === '50401');
    return lic.birth_year === null && lic.gender === '' && !JSON.stringify(rows).includes('Inactive');
  })());
  ok('…while the signing with no licence kept the year only the device could supply', rows.find(r => !r.licence).birth_year === 2014);
  ok('the device remembers it reached the club, and which team it is there', (() => {
    const st = TM.syncStateOf(clubId, 'tlocal1');
    return st && st.state === 'confirmed' && /^ct_/.test(st.serverId);
  })());
  await settle(20);
  ok('and the screen now says when it last synced', /last synced/i.test(q('.tm-sync').textContent.toLowerCase()) || /synced/i.test(q('.tm-sync').textContent.toLowerCase()));
  const again = db.prepare('SELECT count(*) AS n FROM club_teams WHERE club_id = ?').get(clubId).n;
  q('#tm-sync').click();
  await settle(80);
  ok('pressing it again changes nothing at the club', db.prepare('SELECT count(*) AS n FROM club_teams WHERE club_id = ?').get(clubId).n === again);

  /* A coach who signed in this morning has no fresh assertion by the afternoon. The server asks for
     the passkey again before it takes a club's children — so the app has to be able to answer, or
     the button can never work for anybody. */
  db.prepare('UPDATE sessions SET stepup_at = NULL').run();
  TM.save(Object.assign(TM.load(), { teams: TM.load().teams.map(t => Object.assign(t, { name: 'U14 blue (afternoon)' })) }));
  const before = asked.get;
  q('#tm-sync').click();
  await settle(100);
  ok('a coach whose sign-in has gone cold is asked for the passkey, once', asked.get === before + 1);
  ok('…and the team reaches the club anyway', db.prepare('SELECT name FROM club_teams WHERE club_id = ?').get(clubId).name === 'U14 blue (afternoon)');
});

await section('[3e] Taking a player back off the club’s copy', async () => {
  const { TEAMS: TM } = window.__T;
  const teamRow = db.prepare('SELECT id FROM club_teams WHERE club_id = ?').get(clubId);
  const live = () => db.prepare('SELECT count(*) AS n FROM club_team_players WHERE team_id = ? AND removed_at IS NULL').get(teamRow.id).n;
  ok('the club holds both players to start with', live() === 2);
  q('.nav-btn[data-view="teams"]').click();
  await settle(30);
  q('#view-teams .tm-card').click();
  await settle(40);
  const x = q('#view-teams [data-premove="L50401"]');
  ok('the coach has a ✕ against the player', !!x);
  x.click();
  await settle(90);
  ok('…and pressing it takes her off the club’s list too, not only this device', live() === 1);
  const row = db.prepare("SELECT cp.left_at FROM club_players cp WHERE cp.club_id = ? AND cp.licence = '50401'").get(clubId);
  ok('…and starts the clock that says when her record may be forgotten', row.left_at > 0);
  ok('…while she is gone from the device as well', !(TM.load().teams[0].players || []).includes('L50401'));
});

await section('[4] Signing out and back in with the passkey alone', async () => {
  q('#logout-btn').click();
  await settle(30);
  ok('signing out returns to the sign-in screen', q('#auth-screen').classList.contains('active'));
  ok('…and takes the club’s children off this device with it', !window.localStorage.getItem(window.__T.TEAMS.KEY) && !window.localStorage.getItem(window.__T.TEAMS.MIRROR_KEY));
  ok('…and every other sign-out button does exactly the same, not less', (() => {
    // the "waiting to be approved" and "not approved" screens have their own sign-out buttons;
    // a second button that quietly did less is how a roster survives a sign-out on a shared laptop
    const src = readFileSync(join(APP, 'js/app.js'), 'utf8');
    const buttons = src.match(/\$\('[a-z-]*signout[a-z-]*'\)\.onclick|\$\('logout-btn'\)\.onclick/g) || [];
    const viaOne = (src.match(/signOutEverything\(\)/g) || []).length;
    return buttons.length >= 3 && viaOne >= buttons.length;
  })());
  ok('…while the club still has its own copy', db.prepare('SELECT count(*) AS n FROM club_players WHERE club_id = ?').get(clubId).n === 2);
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
