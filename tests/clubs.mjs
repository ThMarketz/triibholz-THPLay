/* Clubs and memberships (slice 3) over real HTTP with software passkeys: join codes, staff invites,
   request numbers, approvals, roles, removal and leaving, step-up, floods, housekeeping, the audit.
   Run:  node tests/clubs.mjs */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startServer, makeCall, Device, FLAG, ORIGIN } from './accounts-harness.mjs';
const require = createRequire(import.meta.url);

const PORT = 4293;
const S = await startServer(PORT);
const { db, ID } = S;
const call = makeCall(PORT);
const dev = flags => new Device(call, flags);

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };
async function section(title, fn) {
  console.log('\n' + title);
  try { await fn(); } catch (e) { fail++; console.log('  ✗ FAIL: section threw —', e && e.stack || e); }
}
const count = (table, where = '1', ...args) => db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get(...args).n;
const userId = name => (db.prepare('SELECT id FROM users WHERE display_name = ?').get(name) || {}).id;
const DAY = 24 * 3600e3;

/* a club with its first admin (operator invite, verified passkey) */
async function newClub(name) {
  const clubId = ID.createClub(db, { name, actor: 'operator' }, Date.now());
  const admin = dev();
  const code = ID.issueCode(db, { kind: 'club-admin', clubId, role: 'admin', actor: 'operator' }, Date.now()).code;
  await admin.register(code, `Admin of ${name}`);
  return { clubId, admin, base: `/api/clubs/${clubId}` };
}
async function joinCode(c, body = {}) {
  await c.admin.stepUp();
  const r = await c.admin.post(`${c.base}/join-codes`, body);
  return r.json;
}
async function invite(c, role, label) {
  await c.admin.stepUp();
  return (await c.admin.post(`${c.base}/invites`, { role, label })).json;
}
const pendingOf = async (c, name) => ((await c.admin.get(`${c.base}/members`)).json.members || []).find(m => m.name === name && m.status === 'pending');
const memberOf = async (c, name) => ((await c.admin.get(`${c.base}/members`)).json.members || []).find(m => m.name === name);

const A = await newClub('Test WPC');
const B = await newClub('Other WPC');

await section('[1] Join codes — the link for a team’s parents group', async () => {
  ok('creating one needs a fresh step-up', (await A.admin.post(`${A.base}/join-codes`, { label: 'U12 parents' })).json.error === 'step-up-required');
  const su = await A.admin.stepUp();
  ok('step-up with a verified passkey → ok, for 5 minutes', su.status === 200 && su.json.stepUpUntil > Date.now());
  const jc = (await A.admin.post(`${A.base}/join-codes`, { label: '  U12 ‮ parents ', days: 30 })).json;
  ok('→ a code shown once, a short ref, 30 days, 60 open requests at most', /^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}-[0-9A-Z]$/.test(jc.code) && /^[0-9a-f]{8}$/.test(jc.ref) && Math.abs(jc.expiresAt - (Date.now() + 30 * DAY)) < 5000 && jc.maxPending === 60);
  const list = (await A.admin.get(`${A.base}/join-codes`)).json.joinCodes;
  ok('the list shows label (cleaned), uses and open requests — never the code', list[0].label === 'U12 parents' && list[0].uses === 0 && list[0].pendingCount === 0 && !JSON.stringify(list).includes(jc.code.replace(/-/g, '')));
  ok('1–90 days only', (await A.admin.post(`${A.base}/join-codes`, { days: 0 })).status === 400 && (await A.admin.post(`${A.base}/join-codes`, { days: 91 })).status === 400);
  const peek = await call('POST', '/api/join/peek', { body: { code: jc.code } });
  ok('peek without signing in: club name and role only', peek.status === 200 && peek.json.kind === 'join' && peek.json.club.name === 'Test WPC' && peek.json.role === 'player' && !('label' in peek.json) && !('signedInAs' in peek.json));
  const bad = await call('POST', '/api/join/peek', { body: { code: 'ABCDE-FGHJK-MNPQR-STVWX-YZ012-3' } });
  ok('an unknown code → 400 invalid-code', bad.status === 400 && bad.json.error === 'invalid-code');

  const parent = dev();
  const r = await parent.register(jc.code, 'Petra Parent');
  const club = r.verify.json.clubs.find(c => c.id === A.clubId);
  ok('a parent registers with it → a pending player request with a 4-digit number and an expiry', r.verify.status === 200 && club.status === 'pending' && club.role === 'player' && /^\d{4}$/.test(club.requestNo) && club.expiresAt > Date.now() + 13 * DAY);
  ok('…counted on the code', (await A.admin.get(`${A.base}/join-codes`)).json.joinCodes[0].uses === 1);
  ok('a pending member sees nothing of the club (the same 404 as a club that does not exist)', (await parent.get(A.base)).text === (await parent.get('/api/clubs/c_AAAAAAAAAAAAAAAAAAAAAA')).text && (await parent.get(A.base)).status === 404);
  ok('peek while signed in says who is joining', (await call('POST', '/api/join/peek', { body: { code: jc.code }, cookie: parent.cookie })).json.signedInAs === 'Petra Parent');

  // an existing account (a coach elsewhere) joins with the link
  const again = await parent.post('/api/join', { code: jc.code });
  ok('using the same link again changes nothing: already, same number, no extra use', again.status === 200 && again.json.already === true && again.json.requestNo === club.requestNo && (await A.admin.get(`${A.base}/join-codes`)).json.joinCodes[0].uses === 1);
  const bCoachInvite = await invite(B, 'coach', 'for Carla');
  const carla = dev(); await carla.register(bCoachInvite.code, 'Carla Coach');
  const cj = await carla.post('/api/join', { code: jc.code });
  ok('someone who already has an account (pending elsewhere) joins with the link: a pending player here', cj.status === 200 && cj.json.status === 'pending' && cj.json.role === 'player' && cj.json.club.name === 'Test WPC');
  ok('/api/join needs a session', (await call('POST', '/api/join', { body: { code: jc.code } })).status === 401);
});

await section('[2] Staff invites — per person, and still an admin’s decision', async () => {
  ok('an invite for a player role is refused (players use the join link)', (await (async () => { await A.admin.stepUp(); return A.admin.post(`${A.base}/invites`, { role: 'player' }); })()).status === 400);
  const inv = await invite(A, 'coach', 'Anna – U14 coach');
  ok('an invite: code, ref, 72 hours', /^[0-9a-f]{8}$/.test(inv.ref) && Math.abs(inv.expiresAt - (Date.now() + 72 * 3600e3)) < 5000);
  ok('peek shows the role it offers', (await call('POST', '/api/join/peek', { body: { code: inv.code } })).json.role === 'coach');
  const noUV = dev(FLAG.UP);
  const refused = await noUV.register(inv.code, 'Anna Coach');
  ok('registering with it needs user verification', refused.verify.status === 400 && refused.verify.json.reason === 'user-not-verified');
  const anna = dev();
  const r = await anna.register(inv.code, 'Anna Coach');
  const mine = r.verify.json.clubs.find(c => c.id === A.clubId);
  ok('with a verified passkey → a PENDING coach request, not a coach yet', mine.status === 'pending' && mine.role === 'coach');
  const invites = (await A.admin.get(`${A.base}/invites`)).json.invites;
  ok('the invite list shows who used it (the tripwire for a forwarded invite)', invites.some(i => i.ref === inv.ref && i.status === 'pending' && i.usedBy.name === 'Anna Coach'));
  ok('the invite is used up', (await call('POST', '/api/join/peek', { body: { code: inv.code } })).status === 400);
  const unused = await invite(A, 'trainer', 'spare');
  ok('an unused invite is listed as unused, with its label', (await A.admin.get(`${A.base}/invites`)).json.invites.some(i => i.ref === unused.ref && i.status === 'unused' && i.label === 'spare'));
  ok('revoking it works once, then 404', (await A.admin.post(`${A.base}/invites/${unused.ref}/revoke`)).status === 200 && (await A.admin.post(`${A.base}/invites/${unused.ref}/revoke`)).status === 404);
  const inv2 = await invite(A, 'coach');
  ok('an invite used by someone already in the club → 409 already-a-member, and it is not used up', (await anna.post('/api/join', { code: inv2.code })).json.error === 'already-a-member' && (await call('POST', '/api/join/peek', { body: { code: inv2.code } })).status === 200);
  const player = dev(FLAG.UP);
  await player.register((await joinCode(B)).code, 'Paul Player');
  ok('an existing account without user verification cannot take a staff invite', (await player.post('/api/join', { code: inv2.code })).json.error === 'user-verification-required');
});

await section('[3] Approving — the request number, compared in person', async () => {
  const petra = await pendingOf(A, 'Petra Parent');
  ok('the admin list shows the request number, the link it came through and its label', /^\d{4}$/.test(petra.requestNo) && petra.via.kind === 'join' && petra.via.label === 'U12 parents');
  ok('a member ref, never an account id', /^m_[A-Za-z0-9_-]{22}$/.test(petra.memberRef) && !JSON.stringify((await A.admin.get(`${A.base}/members`)).json).includes('u_'));
  const url = `${A.base}/members/${petra.memberRef}`;
  ok('approving without the number → 400', (await A.admin.post(`${url}/approve`)).status === 400);
  const wrong = String((Number(petra.requestNo) + 1) % 10000).padStart(4, '0');
  ok('with a wrong number → 409 request-changed', (await A.admin.post(`${url}/approve`, { requestNo: wrong })).json.error === 'request-changed');
  ok('a role in the body is ignored: approve grants what was asked for', (await A.admin.post(`${url}/approve`, { requestNo: petra.requestNo, role: 'admin' })).json.role === 'player');
  ok('approved once; a second approval → 404 (no longer pending)', (await A.admin.post(`${url}/approve`, { requestNo: petra.requestNo })).status === 404);
  ok('the parent now sees the club', (await (async () => { const p = await memberOf(A, 'Petra Parent'); return p.status === 'approved'; })()));

  const anna = await pendingOf(A, 'Anna Coach');
  const annaUrl = `${A.base}/members/${anna.memberRef}`;
  db.prepare("UPDATE sessions SET stepup_at = NULL WHERE user_id = (SELECT id FROM users WHERE display_name = 'Admin of Test WPC')").run();
  ok('approving a staff request needs a fresh step-up', (await A.admin.post(`${annaUrl}/approve`, { requestNo: anna.requestNo })).json.error === 'step-up-required');
  await A.admin.stepUp();
  db.prepare('UPDATE credentials SET uv = 0 WHERE user_id = ?').run(userId('Anna Coach'));
  ok('…and the person must own a verified passkey', (await A.admin.post(`${annaUrl}/approve`, { requestNo: anna.requestNo })).json.error === 'needs-verified-passkey');
  db.prepare('UPDATE credentials SET uv = 1 WHERE user_id = ?').run(userId('Anna Coach'));
  ok('then → coach', (await A.admin.post(`${annaUrl}/approve`, { requestNo: anna.requestNo })).json.role === 'coach');

  // names that look alike
  const jc = await joinCode(A, { label: 'look-alikes' });
  await dev().register(jc.code, 'Lena Müller'); await dev().register(jc.code, 'lena muller'); await dev().register(jc.code, 'Lеna Müller');   // the last with a Cyrillic е
  const list = (await A.admin.get(`${A.base}/members`)).json.members.filter(m => /l[eе]na m[uü]ller/i.test(m.name));
  ok('two requests whose names read the same are flagged sameName', list.filter(m => m.sameName).length === 2);
  ok('a name mixing Latin and Cyrillic letters is flagged mixedScript', list.some(m => m.mixedScript && m.name.includes('е')) && list.filter(m => m.mixedScript).length === 1);

  // racing approvals
  const racer = await pendingOf(A, 'lena muller');
  const both = await Promise.all([1, 2].map(() => A.admin.post(`${A.base}/members/${racer.memberRef}/approve`, { requestNo: racer.requestNo })));
  ok('two approvals racing for one request: exactly one succeeds', both.filter(r => r.status === 200).length === 1);
});

await section('[4] Refusals, asking again, and the 30-day wait', async () => {
  const jc = await joinCode(A, { label: 'retry' });
  const r = dev(); await r.register(jc.code, 'Rita Retry');
  let p = await pendingOf(A, 'Rita Retry');
  ok('deny with the request number', (await A.admin.post(`${A.base}/members/${p.memberRef}/deny`, { requestNo: p.requestNo })).json.status === 'denied');
  ok('a denied person sees nothing', (await r.get(A.base)).status === 404);
  const again = await r.post('/api/join', { code: jc.code });
  p = await pendingOf(A, 'Rita Retry');
  ok('asking again once is allowed: the same row, a new number, "previously denied" shown to the admin', again.json.status === 'pending' && p.previously && p.previously.status === 'denied' && count('club_members', 'user_id = ?', userId('Rita Retry')) === 1);
  await A.admin.post(`${A.base}/members/${p.memberRef}/deny`, { requestNo: p.requestNo });
  ok('after a second refusal → 409 ask-your-admin', (await r.post('/api/join', { code: jc.code })).json.error === 'ask-your-admin');
  db.prepare('UPDATE club_members SET decided_at = ? WHERE user_id = ?').run(Date.now() - 31 * DAY, userId('Rita Retry'));
  ok('…and once 30 days have passed, one more request', (await r.post('/api/join', { code: jc.code })).json.status === 'pending');
  const before = await pendingOf(A, 'Rita Retry');
  const w = await r.post(`${A.base}/leave`);
  const row = db.prepare('SELECT status, member_ref FROM club_members WHERE user_id = ? AND club_id = ?').get(userId('Rita Retry'), A.clubId);
  ok('taking back a request made after a refusal puts the refusal back — same row, same ref (it neither counts as a refusal nor erases one)', w.json.withdrawn === true && row.status === 'denied' && row.member_ref === before.memberRef);
  const fresh = dev(); await fresh.register((await joinCode(A, { label: 'first' })).code, 'First Timer');
  ok('taking back a first-ever request: the row simply goes', (await fresh.post(`${A.base}/leave`)).json.withdrawn === true && count('club_members', 'user_id = ? AND club_id = ?', userId('First Timer'), A.clubId) === 0);
});

await section('[5] Roles, removal, leaving — and what they take with them', async () => {
  const coach = await memberOf(A, 'Anna Coach');
  const url = `${A.base}/members/${coach.memberRef}`;
  db.prepare("UPDATE sessions SET stepup_at = NULL WHERE user_id = (SELECT id FROM users WHERE display_name = 'Admin of Test WPC')").run();
  ok('changing a role needs step-up', (await A.admin.post(`${url}/role`, { role: 'admin' })).json.error === 'step-up-required');
  await A.admin.stepUp();
  ok('coach → admin', (await A.admin.post(`${url}/role`, { role: 'admin' })).json.role === 'admin');
  const petra = await memberOf(A, 'Petra Parent');
  const petraUv = db.prepare('SELECT uv FROM credentials WHERE user_id = ?').get(userId('Petra Parent')).uv;
  db.prepare('UPDATE credentials SET uv = 0 WHERE user_id = ?').run(userId('Petra Parent'));
  ok('raising someone without a verified passkey to staff → 409 needs-verified-passkey', (await A.admin.post(`${A.base}/members/${petra.memberRef}/role`, { role: 'trainer' })).json.error === 'needs-verified-passkey');
  db.prepare('UPDATE credentials SET uv = ? WHERE user_id = ?').run(petraUv, userId('Petra Parent'));
  ok('admin → coach again (a second admin can step down)', (await A.admin.post(`${url}/role`, { role: 'coach' })).json.role === 'coach');
  ok('an unknown role → 400', (await A.admin.post(`${url}/role`, { role: 'owner' })).status === 400);
});

await section('[5b] An admin who loses admin loses the invites they sent', async () => {
  // a fresh second admin with a device we hold
  const inv = await invite(A, 'admin', 'second admin');
  const bea = dev(); await bea.register(inv.code, 'Bea Admin');
  let p = await pendingOf(A, 'Bea Admin');
  await A.admin.stepUp();
  await A.admin.post(`${A.base}/members/${p.memberRef}/approve`, { requestNo: p.requestNo });
  await bea.stepUp();
  const beaUnused = (await bea.post(`${A.base}/invites`, { role: 'coach', label: 'unused by Bea' })).json;
  await bea.stepUp();
  const beaUsed = (await bea.post(`${A.base}/invites`, { role: 'trainer', label: 'used' })).json;
  const tom = dev(); await tom.register(beaUsed.code, 'Tom Trainer');
  await bea.stepUp();
  const beaJoin = (await bea.post(`${A.base}/join-codes`, { label: 'Bea’s link' })).json;
  const beaMember = await memberOf(A, 'Bea Admin');
  await A.admin.stepUp();
  ok('demote Bea to coach', (await A.admin.post(`${A.base}/members/${beaMember.memberRef}/role`, { role: 'coach' })).json.role === 'coach');
  ok('her unused invite is revoked', (await call('POST', '/api/join/peek', { body: { code: beaUnused.code } })).status === 400);
  ok('the request that came through her used invite is denied', !(await pendingOf(A, 'Tom Trainer')) && db.prepare('SELECT status FROM club_members WHERE user_id = ?').get(userId('Tom Trainer')).status === 'denied');
  ok('her join link stays (it belongs to the club)', (await call('POST', '/api/join/peek', { body: { code: beaJoin.code } })).status === 200);
  ok('her step-up no longer counts', db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ? AND stepup_at IS NOT NULL').get(userId('Bea Admin')).n === 0);
  ok('as a coach she gets 404 on admin routes', (await bea.get(`${A.base}/members`)).json.error === 'not-found');

  // removal
  await A.admin.stepUp();
  const rm = await A.admin.post(`${A.base}/members/${beaMember.memberRef}/remove`, { revokeJoinCodes: true });
  ok('remove → a bare ok (nothing about sessions or other clubs)', rm.status === 200 && JSON.stringify(rm.json) === '{"ok":true}');
  ok('with revokeJoinCodes her links go too', (await call('POST', '/api/join/peek', { body: { code: beaJoin.code } })).status === 400);
  ok('no approved membership left anywhere → her sessions end', (await bea.me()).status === 401);


  // someone approved in two clubs keeps their session when removed from one
  const both = dev();
  await both.register((await joinCode(A, { label: 'two clubs' })).code, 'Two Clubs');
  let pa = await pendingOf(A, 'Two Clubs'); await A.admin.post(`${A.base}/members/${pa.memberRef}/approve`, { requestNo: pa.requestNo });
  await both.post('/api/join', { code: (await joinCode(B)).code });
  let pb = await pendingOf(B, 'Two Clubs'); await B.admin.post(`${B.base}/members/${pb.memberRef}/approve`, { requestNo: pb.requestNo });
  const refA = (await memberOf(A, 'Two Clubs')).memberRef, refB = (await memberOf(B, 'Two Clubs')).memberRef;
  ok('the same person has a different member ref in each club', refA !== refB);
  await A.admin.stepUp();
  await A.admin.post(`${A.base}/members/${refA}/remove`);
  ok('removed from one club, still approved in the other: stays signed in', (await both.me()).status === 200 && (await both.get(B.base)).status === 200);

  // leaving
  const leaver = dev(); await leaver.register((await joinCode(B)).code, 'Leo Leaver');
  const pl = await pendingOf(B, 'Leo Leaver'); await B.admin.post(`${B.base}/members/${pl.memberRef}/approve`, { requestNo: pl.requestNo });
  const out = await leaver.post(`${B.base}/leave`);
  ok('a player leaves → removed, and (no other club) signed out with the cookie cleared', out.status === 200 && leaver.cookie !== null && /Max-Age=0/.test([].concat(out.headers['set-cookie'])[0] || '') && db.prepare('SELECT status FROM club_members WHERE user_id = ?').get(userId('Leo Leaver')).status === 'removed');
  db.prepare("UPDATE sessions SET stepup_at = NULL WHERE user_id = (SELECT id FROM users WHERE display_name = 'Admin of Other WPC')").run();
  ok('the only admin cannot leave without step-up…', (await B.admin.post(`${B.base}/leave`)).json.error === 'step-up-required');
  await B.admin.stepUp();
  ok('…and with it, still not: 409 last-admin', (await B.admin.post(`${B.base}/leave`)).json.error === 'last-admin');
  const me = (await B.admin.get(B.base)).json;
  await B.admin.stepUp();
  ok('nor demote themselves', (await B.admin.post(`${B.base}/members/${me.memberRef}/role`, { role: 'coach' })).json.error === 'last-admin');
  ok('the single-admin club is visible to its admin (adminCount 1)', me.adminCount === 1);
});

await section('[6] Floods from a leaked link', async () => {
  await A.admin.stepUp();
  const small = (await A.admin.post(`${A.base}/join-codes`, { label: 'leaked', maxPending: 3 })).json;
  for (let i = 0; i < 3; i++) await dev().register(small.code, `Flood ${i}`);
  const fourth = await dev().register(small.code, 'Flood 3');
  ok('a link with maxPending 3: the 4th open request → 429 too-many-pending, with Retry-After', fourth.verify.status === 429 && fourth.verify.json.error === 'too-many-pending' && !!fourth.verify.headers['retry-after']);
  ok('…and no account was left behind for it', !userId('Flood 3'));
  db.prepare("UPDATE sessions SET stepup_at = NULL WHERE user_id = (SELECT id FROM users WHERE display_name = 'Admin of Test WPC')").run();
  ok('revoking with denyPending needs step-up', (await A.admin.post(`${A.base}/join-codes/${small.ref}/revoke`, { denyPending: true })).json.error === 'step-up-required');
  await A.admin.stepUp();
  const rv = await A.admin.post(`${A.base}/join-codes/${small.ref}/revoke`, { denyPending: true });
  ok('revoke + deny everything that came through it, in one action', rv.json.deniedRequests === 3 && !(await pendingOf(A, 'Flood 0')));
  ok('the link is dead', (await call('POST', '/api/join/peek', { body: { code: small.code } })).status === 400);
  ok('a code ref from another club → 404', (await A.admin.post(`${A.base}/join-codes/${(await joinCode(B)).ref}/revoke`)).status === 404);

  const wide = await joinCode(A, { label: 'wide', maxPending: 200 });
  let last;
  for (let i = 0; i < 51; i++) last = await call('POST', '/api/auth/register/options', { body: { code: wide.code, displayName: `Open ${i}` } });
  ok('51 open registrations for one club → 429 (a leaked link cannot crowd out other clubs)', last.status === 429);
  ok('…while an operator club-admin code for that club still works', (await call('POST', '/api/auth/register/options', { body: { code: ID.issueCode(db, { kind: 'club-admin', clubId: A.clubId, role: 'admin', actor: 'operator' }, Date.now()).code, displayName: 'Break Glass' } })).status === 200);
  ok('…and other clubs are unaffected', (await call('POST', '/api/auth/register/options', { body: { code: (await joinCode(B)).code, displayName: 'Elsewhere' } })).status === 200);
  db.prepare("DELETE FROM challenges WHERE kind = 'register'").run();

  const ip = '203.0.113.50';
  const addr = await joinCode(B, { label: 'shared wifi', maxPending: 200 });
  let made = 0, blocked = null;
  for (let i = 0; i < 31; i++) {
    const o = await call('POST', '/api/auth/register/options', { body: { code: addr.code, displayName: `Wifi ${i}` }, ip });
    const d = dev(); const pk = o.json.publicKey;
    const cred = d.key.create({ rpId: 'localhost', origin: ORIGIN, challenge: pk.challenge, userHandle: pk.user.id });
    const v = await call('POST', '/api/auth/register/verify', { body: { challengeId: o.json.challengeId, credential: cred }, ip });
    if (v.status === 200) made++; else blocked = v;
  }
  ok('30 accounts from join codes per address per hour (a parents’ evening), the 31st → 429', made === 30 && blocked && blocked.status === 429);

  // club-wide cap
  const now = Date.now();
  const insUser = db.prepare('INSERT INTO users (id, display_name, webauthn_user_handle, created_at) VALUES (?, ?, randomblob(32), ?)');
  const insMember = db.prepare("INSERT INTO club_members (club_id, user_id, role, status, requested_at, member_ref, request_no, via) VALUES (?, ?, 'player', 'pending', ?, ?, ?, 'join:00000000')");
  const pendingNow = count('club_members', "club_id = ? AND status = 'pending'", B.clubId);
  const used = new Set(db.prepare("SELECT request_no FROM club_members WHERE club_id = ? AND status = 'pending'").all(B.clubId).map(r => r.request_no));
  let no = 0;
  for (let i = pendingNow; i < 200; i++) { const id = ID.newId('u'); insUser.run(id, 'Filler ' + i, now); while (used.has(String(no).padStart(4, '0'))) no++; used.add(String(no).padStart(4, '0')); insMember.run(B.clubId, id, now, ID.newId('m'), String(no).padStart(4, '0')); }
  const late = dev(); await late.register(ID.issueCode(db, { kind: 'club-admin', clubId: A.clubId, role: 'admin', actor: 'operator' }, Date.now()).code, 'Late Admin');
  ok('200 open requests in a club → the next join → 429 too-many-pending', (await late.post('/api/join', { code: (await joinCode(B, { maxPending: 200 })).code })).json.error === 'too-many-pending');
  db.prepare("DELETE FROM users WHERE display_name LIKE 'Filler %'").run();   // their requests go with them
});

await section('[7] Step-up belongs to one session', async () => {
  const d = dev(); const code = ID.issueCode(db, { kind: 'club-admin', clubId: B.clubId, role: 'admin', actor: 'operator' }, Date.now()).code;
  await d.register(code, 'Two Sessions');
  const other = new Device(call); other.key = d.key; await other.login();
  const o = await d.post('/api/auth/stepup/options');
  ok('step-up options list the person’s own passkeys and require verification', o.json.publicKey.userVerification === 'required' && o.json.publicKey.allowCredentials.length === 1);
  const cred = d.key.get({ rpId: 'localhost', origin: ORIGIN, challenge: o.json.publicKey.challenge });
  ok('a step-up started in one session cannot be finished in another session of the same person', (await call('POST', '/api/auth/stepup/verify', { body: { challengeId: o.json.challengeId, credential: cred }, cookie: other.cookie })).json.error === 'challenge-invalid');
  await d.post('/api/auth/stepup/options'); await d.post('/api/auth/stepup/options');
  ok('at most 3 open step-ups per session → 429', (await d.post('/api/auth/stepup/options')).status === 429);
  db.prepare("DELETE FROM challenges WHERE kind = 'stepup'").run();
  ok('a step-up without user verification → 401, asking for it', (await d.stepUp({ flags: FLAG.UP })).json.reason === 'user-verification-required');
  ok('another person’s passkey cannot step up my session', (await (async () => { const o2 = await d.post('/api/auth/stepup/options'); const c2 = B.admin.key.get({ rpId: 'localhost', origin: ORIGIN, challenge: o2.json.publicKey.challenge }); return call('POST', '/api/auth/stepup/verify', { body: { challengeId: o2.json.challengeId, credential: c2 }, cookie: d.cookie }); })()).json.error === 'step-up-failed');
  await d.stepUp();
  db.prepare('UPDATE sessions SET stepup_at = ? WHERE stepup_at IS NOT NULL AND user_id = ?').run(Date.now() - 6 * 60e3, userId('Two Sessions'));
  ok('a step-up older than 5 minutes no longer counts', (await d.post(`${B.base}/join-codes`, {})).json.error === 'step-up-required');
  ok('stepping up needs a session', (await call('POST', '/api/auth/stepup/options')).status === 401);
  // a session made without user verification (e.g. signed in as a player, promoted since) cannot act as staff…
  db.prepare('UPDATE sessions SET uv = 0 WHERE user_id = ?').run(userId('Two Sessions'));
  ok('staff acting from an unverified session → 403 user-verification-required', (await d.get(`${B.base}/members`)).json.error === 'user-verification-required');
  await d.stepUp();
  ok('…until a verified step-up upgrades that session', (await d.get(`${B.base}/members`)).status === 200);
});

await section('[8] An operator code for someone who already has an account', async () => {
  const coachInv = await invite(B, 'coach');
  const c = dev(); await c.register(coachInv.code, 'Existing Coach');
  const p = await pendingOf(B, 'Existing Coach'); await B.admin.stepUp(); await B.admin.post(`${B.base}/members/${p.memberRef}/approve`, { requestNo: p.requestNo });
  const breakGlass = ID.issueCode(db, { kind: 'club-admin', clubId: B.clubId, role: 'admin', actor: 'operator' }, Date.now()).code;
  ok('without step-up → 403 (a child tapping a link on a parent’s tablet makes nobody admin)', (await c.post('/api/join', { code: breakGlass })).json.error === 'step-up-required');
  await c.stepUp();
  const j = await c.post('/api/join', { code: breakGlass });
  ok('with step-up → admin at once, same account, same member ref', j.json.role === 'admin' && j.json.status === 'approved' && j.json.memberRef === p.memberRef);
  ok('the code is used up', (await call('POST', '/api/join/peek', { body: { code: breakGlass } })).status === 400);
});

await section('[9] Housekeeping', async () => {
  const jc = await joinCode(A, { label: 'old' });
  const old = dev(); await old.register(jc.code, 'Olga Old');
  db.prepare('UPDATE club_members SET requested_at = ? WHERE user_id = ?').run(Date.now() - 15 * DAY, userId('Olga Old'));
  ID.purgeExpired(db, Date.now());
  ok('a request unanswered for 14 days expires (audited)', count('club_members', 'user_id = ?', userId('Olga Old')) === 0 && count('audit', "action = 'member.expired' AND subject = ?", userId('Olga Old')) === 1);
  ok('…the account stays for now (someone back from holiday can ask again)', !!userId('Olga Old') && ID.purgeAbandonedAccounts(db, Date.now()) === 0);
  db.prepare('UPDATE users SET last_request_at = ?, created_at = ? WHERE display_name = ?').run(Date.now() - 46 * DAY, Date.now() - 46 * DAY, 'Olga Old');
  const olgaId = userId('Olga Old');
  const n = ID.purgeAbandonedAccounts(db, Date.now());
  ok('never approved, nothing pending, 45 days quiet → the account, its passkeys and sessions are deleted', n >= 1 && !userId('Olga Old') && count('credentials', 'user_id = ?', olgaId) === 0 && count('audit', "action = 'user.expired' AND subject = ?", olgaId) === 1);
  db.prepare("UPDATE users SET last_request_at = ?, created_at = ? WHERE display_name = 'Leo Leaver'").run(Date.now() - 400 * DAY, Date.now() - 400 * DAY);
  ID.purgeAbandonedAccounts(db, Date.now());
  ok('someone who was approved once and left is not collected here', !!userId('Leo Leaver'));
  ok('approval marks an account ever_approved', db.prepare("SELECT ever_approved FROM users WHERE display_name = 'Petra Parent'").get().ever_approved === 1);
});

await section('[10] The audit log and the club page', async () => {
  const staff = (await A.admin.get(`${A.base}/audit?category=staff`)).json.entries;   // before the filler below
  const ins = db.prepare("INSERT INTO audit (at, actor, action, subject, club_id, detail) VALUES (?, 'operator', 'code.issue', NULL, ?, '{\"kind\":\"join\"}')");
  for (let i = 0; i < 120; i++) ins.run(Date.now() - 3600e3, A.clubId);
  const log = (await A.admin.get(`${A.base}/audit`)).json;
  ok('the admin reads the club’s log, newest first, 100 a page', Array.isArray(log.entries) && log.entries.length === 100 && log.next && log.entries[0].id > log.entries[1].id);
  const page2 = (await A.admin.get(`${A.base}/audit?before=${log.next}`)).json;
  ok('…with a cursor for the next page', page2.entries.length > 0 && page2.entries[0].id < log.next);
  ok('category=staff: role changes, removals, codes — no ordinary requests', staff.length > 0 && staff.every(e => !['member.request', 'member.deny', 'member.expired'].includes(e.action)) && staff.some(e => e.action === 'member.role'));
  const text = JSON.stringify(log) + JSON.stringify(page2);
  ok('names only for people pending or approved here; removed people are "former-member"; no account ids', text.includes('"name":"Petra Parent"') && !text.includes('Bea Admin') && text.includes('former-member') && !/"u_[A-Za-z0-9_-]{22}"/.test(text));
  ok('a bad category → 400', (await A.admin.get(`${A.base}/audit?category=everything`)).status === 400);
  const petra = await memberOf(A, 'Petra Parent');
  db.prepare("INSERT INTO audit (at, actor, action, subject, detail) VALUES (?, ?, 'credential.suspect', ?, '{}')").run(Date.now(), userId('Petra Parent'), userId('Petra Parent'));
  const page = (await A.admin.get(A.base)).json;
  ok('the club page tells admins about a cloned-passkey alarm for one of their members', page.alerts.some(a => a.kind === 'passkey-suspect' && a.memberRef === petra.memberRef) && page.pendingCount >= 0 && page.adminCount >= 1);
  ok('signed out → 401', (await call('GET', A.base)).status === 401);
  const player = dev(); await player.register((await joinCode(A, { label: 'late player' })).code, 'Late Player');
  const lp = await pendingOf(A, 'Late Player'); await A.admin.post(`${A.base}/members/${lp.memberRef}/approve`, { requestNo: lp.requestNo });
  const pv = (await player.get(A.base)).json;
  ok('an approved player sees the club, but no admin counts, alerts or member list', pv.myRole === 'player' && !('alerts' in pv) && !('adminCount' in pv) && (await player.get(`${A.base}/members`)).status === 404 && (await player.get(`${A.base}/audit`)).status === 404);
});

await section('[11] Request rules and accounts off', async () => {
  const r = await A.admin.get(`${A.base}/members`);
  ok('club answers: no CORS headers, no-store', !r.headers['access-control-allow-origin'] && r.headers['cache-control'] === 'no-store');
  ok('a POST without Origin → 403', (await call('POST', '/api/join', { body: { code: 'x' }, origin: null, cookie: A.admin.cookie })).status === 403);
  ok('a malformed club id → 404 before anything else', (await A.admin.get('/api/clubs/not-a-club/members')).status === 404);
  ok('GET on a POST route → 405', (await A.admin.get(`${A.base}/leave`)).status === 405);
  const HERE = dirname(fileURLToPath(import.meta.url));
  const off = await new Promise(resolve => {
    const p = spawn(process.execPath, ['-e', `process.env.PORT='4294'; process.env.ACCOUNTS=''; process.env.DATA_DIR=require('os').tmpdir()+'/thp-off-'+process.pid; const m=require(${JSON.stringify(join(HERE, '..', 'server', 'index.js'))}); m.server.listen(4294, async () => { const a = await fetch('http://127.0.0.1:4294/api/clubs/c_AAAAAAAAAAAAAAAAAAAAAA'); const b = await fetch('http://127.0.0.1:4294/api/join', { method: 'POST' }); console.log(JSON.stringify([a.status, await a.json(), b.status])); process.exit(0); });`], { env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    let out = ''; p.stdout.on('data', d => { out += d; }); p.on('close', () => resolve(out.trim()));
  });
  ok('accounts off: /api/clubs and /api/join answer 404 accounts-off', off === '[404,{"error":"accounts-off"},404]');
});

await section('[12] Fixes from the adversarial review', async () => {
  // earlier sections used up the 10 active join links per club; start clean
  ID.revokeCodes(db, { clubId: A.clubId, kind: 'join', actor: 'operator' }, Date.now());
  ID.revokeCodes(db, { clubId: B.clubId, kind: 'join', actor: 'operator' }, Date.now());
  const allEntries = async (c, q = '') => { const out = []; let next = null; do { const r = (await c.admin.get(`${c.base}/audit?${q}${next ? `${q ? '&' : ''}before=${next}` : ''}`)).json; out.push(...r.entries); next = r.next; } while (next); return out; };
  // (a) withdrawing cannot dodge the 30-day wait or hide "previously"
  const jc = await joinCode(A, { label: 'dodger', maxPending: 200 });
  const d = dev(); await d.register(jc.code, 'Dodo Dodger');
  const deny = async () => { const p = await pendingOf(A, 'Dodo Dodger'); return A.admin.post(`${A.base}/members/${p.memberRef}/deny`, { requestNo: p.requestNo }); };
  await deny();
  await d.post('/api/join', { code: jc.code });
  await d.post(`${A.base}/leave`);
  await d.post('/api/join', { code: jc.code });
  ok('deny → ask → take back → ask: the admin still sees "previously denied"', (await pendingOf(A, 'Dodo Dodger')).previously.status === 'denied');
  await deny();
  ok('…and the next refusal starts the 30-day wait', (await d.post('/api/join', { code: jc.code })).json.error === 'ask-your-admin');
  // removed variant
  const rm = dev(); await rm.register(jc.code, 'Remy Removed');
  let p = await pendingOf(A, 'Remy Removed'); await A.admin.post(`${A.base}/members/${p.memberRef}/approve`, { requestNo: p.requestNo });
  await A.admin.stepUp(); await A.admin.post(`${A.base}/members/${p.memberRef}/remove`);
  await rm.login();
  await rm.post('/api/join', { code: jc.code }); await rm.post(`${A.base}/leave`); await rm.post('/api/join', { code: jc.code });
  ok('removed → ask → take back → ask: still "previously removed", same member ref', (await pendingOf(A, 'Remy Removed')).previously.status === 'removed' && (await pendingOf(A, 'Remy Removed')).memberRef === p.memberRef);
  // (d) expiry of a retry restores the refusal too
  const ex = dev(); await ex.register(jc.code, 'Exa Expired');
  p = await pendingOf(A, 'Exa Expired'); await A.admin.post(`${A.base}/members/${p.memberRef}/deny`, { requestNo: p.requestNo });
  await ex.post('/api/join', { code: jc.code });
  db.prepare('UPDATE club_members SET requested_at = ? WHERE user_id = ?').run(Date.now() - 15 * DAY, userId('Exa Expired'));
  S.mod.auth.housekeeping();
  ok('a retry that expires puts the earlier refusal back instead of deleting it', db.prepare('SELECT status FROM club_members WHERE user_id = ?').get(userId('Exa Expired')).status === 'denied');

  // (e) join → take back → join … is capped per person per club per day
  const cyc = dev(); await cyc.register((await joinCode(B, { label: 'cycle' })).code, 'Cy Cycler');
  const bj = (await joinCode(B, { label: 'cycle2' })).code;
  let lastJoin;
  for (let i = 0; i < 5; i++) { await cyc.post(`${B.base}/leave`); lastJoin = await cyc.post('/api/join', { code: bj }); }
  ok('the 6th request to one club within a day → 429 with Retry-After', lastJoin.status === 429 && lastJoin.json.error === 'too-many-requests-for-club' && !!lastJoin.headers['retry-after']);

  // (f) account cleanup really runs: the server's own housekeeping, and the operator's purge
  const ghost = dev(); await ghost.register((await joinCode(B, { label: 'ghost' })).code, 'Gus Ghost');
  await ghost.post(`${B.base}/leave`);
  db.prepare('UPDATE users SET created_at = ?, last_request_at = ? WHERE display_name = ?').run(Date.now() - 50 * DAY, Date.now() - 50 * DAY, 'Gus Ghost');
  S.mod.auth.housekeeping();
  ok('the housekeeping timer deletes an abandoned account', !userId('Gus Ghost'));
  const ghost2 = dev(); await ghost2.register((await joinCode(B, { label: 'ghost2' })).code, 'Gil Ghost');
  await ghost2.post(`${B.base}/leave`);
  const lines = [];
  const { main } = require('../server/admin.js');
  db.prepare('UPDATE users SET created_at = ?, last_request_at = ? WHERE display_name = ?').run(Date.now() - 50 * DAY, Date.now() - 50 * DAY, 'Gil Ghost');
  main(['purge'], { now: Date.now(), out: l => lines.push(l), env: { ...process.env, DATA_DIR: S.DATA } });
  ok('…and so does `admin.js purge` (reporting the count)', !userId('Gil Ghost') && JSON.parse(lines[0]).accounts >= 1);

  // (g) a former member's audit ref does not change when their account is deleted
  const fm = dev(); await fm.register(jc.code, 'Fern Former');
  p = await pendingOf(A, 'Fern Former'); await A.admin.post(`${A.base}/members/${p.memberRef}/deny`, { requestNo: p.requestNo });
  const fernId = userId('Fern Former');
  const entry = (await A.admin.get(`${A.base}/audit?category=requests`)).json.entries.find(e => e.action === 'member.deny' && e.subject.kind === 'former-member');
  const refBefore = entry.subject.ref;
  db.prepare('UPDATE users SET created_at = ?, last_request_at = ? WHERE id = ?').run(Date.now() - 50 * DAY, Date.now() - 50 * DAY, fernId);
  S.mod.auth.housekeeping();
  const after = (await A.admin.get(`${A.base}/audit?category=requests`)).json.entries.find(e => e.id === entry.id);
  ok('a denied person’s audit ref is the same before and after their account is deleted', !userId('Fern Former') && after.subject.kind === 'former-member' && after.subject.ref === refBefore && /^[A-Za-z0-9_-]{6}$/.test(refBefore));

  // (h) bulk deny after a plain revoke, and after expiry
  await A.admin.stepUp();
  const leak = (await A.admin.post(`${A.base}/join-codes`, { label: 'leak2', maxPending: 10 })).json;
  for (let i = 0; i < 2; i++) await dev().register(leak.code, `Leak ${i}`);
  await A.admin.post(`${A.base}/join-codes/${leak.ref}/revoke`);
  await A.admin.stepUp();
  const late = await A.admin.post(`${A.base}/join-codes/${leak.ref}/revoke`, { denyPending: true });
  ok('a link already revoked: denyPending still clears its requests', late.status === 200 && late.json.deniedRequests === 2 && late.json.revoked === false);
  ok('…but a plain revoke of an already-revoked link is still 404', (await A.admin.post(`${A.base}/join-codes/${leak.ref}/revoke`)).status === 404);
  await A.admin.stepUp();
  const leak3 = (await A.admin.post(`${A.base}/join-codes`, { label: 'expiring', maxPending: 10 })).json;
  await dev().register(leak3.code, 'Leak expired');
  db.prepare('UPDATE club_join_codes SET expires_at = ? WHERE club_id = ? AND substr(code_hash, 1, 8) = ?').run(Date.now() - 1, A.clubId, leak3.ref);
  await A.admin.stepUp();
  ok('an expired link: denyPending still clears its requests', (await A.admin.post(`${A.base}/join-codes/${leak3.ref}/revoke`, { denyPending: true })).json.deniedRequests === 1);

  // (i) cloned-passkey alarms in the staff log, only in clubs where the person is approved, without fragments
  const staffLog = await allEntries(A, 'category=staff');
  ok('the staff log shows the cloned-passkey alarm for an approved member', staffLog.some(e => e.action === 'credential.suspect' && e.subject.name === 'Petra Parent' && e.detail === null));
  ok('…and club B’s log does not', !(await allEntries(B)).some(e => e.action === 'credential.suspect'));
  const allText = JSON.stringify(await allEntries(A)) + JSON.stringify(await allEntries(B));
  ok('no audit detail carries a passkey id fragment', !allText.includes('"credential"'));

  // (j) look-alike names are marked in the log
  const twins = (await allEntries(A)).filter(e => e.subject && e.subject.kind === 'member' && /lena m[uü]ller/i.test(e.subject.name));   // the two Latin spellings (the Cyrillic one folds differently)
  ok('names that read the same are marked sameName in the log, a unique name is not', twins.length > 0 && twins.every(e => e.subject.sameName === true) && (await allEntries(A)).some(e => e.subject && e.subject.name === 'Petra Parent' && !e.subject.sameName));

  // (k) categories
  const staffAll = await allEntries(A, 'category=staff');
  ok('staff log: no player leaving, but code use (a redeemed invite) is there', !staffAll.some(e => e.action === 'member.leave' && (!e.detail || e.detail.role === 'player')) && staffAll.some(e => e.action === 'code.use'));

  // (l) an admin demoted while their approval is on its way → 404, nothing changes (checked inside the write)
  const inv = await invite(A, 'admin', 'racing admin');
  const zed = dev(); await zed.register(inv.code, 'Zed Admin');
  p = await pendingOf(A, 'Zed Admin'); await A.admin.stepUp(); await A.admin.post(`${A.base}/members/${p.memberRef}/approve`, { requestNo: p.requestNo });
  const victim = dev(); await victim.register((await joinCode(A, { label: 'race' })).code, 'Vic Waiting');
  const vp = await pendingOf(A, 'Vic Waiting');
  const http = await import('node:http');
  const payload = JSON.stringify({ requestNo: vp.requestNo });
  const slow = new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: `${A.base}/members/${vp.memberRef}/approve`, headers: { origin: ORIGIN, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), cookie: zed.cookie, 'x-real-ip': '10.66.0.1' } },
      res => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(t) })); });
    req.write(payload.slice(0, 5));
    setTimeout(() => req.end(payload.slice(5)), 700);
  });
  await new Promise(r => setTimeout(r, 150));
  await A.admin.stepUp();
  const zedRef = (await memberOf(A, 'Zed Admin')).memberRef;
  await A.admin.post(`${A.base}/members/${zedRef}/role`, { role: 'coach' });
  const raced = await slow;
  ok('an admin demoted while their approval was in flight → 404, and the request stays pending', raced.status === 404 && (await pendingOf(A, 'Vic Waiting')).requestNo === vp.requestNo);

  // (m) two connections: an expiry or a denial committed elsewhere wins over a stale approval
  const DB = require('../server/db.js');
  const other = DB.open(join(S.DATA, 'triibholz.db'));
  const w2 = dev(); await w2.register((await joinCode(A, { label: 'two conns' })).code, 'Wen Twice');
  const wp = await pendingOf(A, 'Wen Twice');
  ID.decideRequest(other, { clubId: A.clubId, memberRef: wp.memberRef, requestNo: wp.requestNo, approve: false, actor: 'x' }, Date.now());
  let changed = false; try { ID.decideRequest(db, { clubId: A.clubId, memberRef: wp.memberRef, requestNo: wp.requestNo, approve: true, actor: 'y' }, Date.now()); } catch (e) { changed = e.code === 'request-changed'; }
  ok('a denial committed on another connection: the approval with the same number → request-changed', changed && db.prepare('SELECT status FROM club_members WHERE member_ref = ?').get(wp.memberRef).status === 'denied');
  const w3 = dev(); await w3.register((await joinCode(A, { label: 'expire race' })).code, 'Ivo Expiring');
  const ip3 = await pendingOf(A, 'Ivo Expiring');
  other.prepare('UPDATE club_members SET requested_at = ? WHERE member_ref = ?').run(Date.now() - 15 * DAY, ip3.memberRef);
  ID.expireRequests(other, Date.now());
  changed = false; try { ID.decideRequest(db, { clubId: A.clubId, memberRef: ip3.memberRef, requestNo: ip3.requestNo, approve: true, actor: 'y' }, Date.now()); } catch (e) { changed = e.code === 'request-changed'; }
  ok('a request expired on another connection cannot be approved afterwards', changed && count('club_members', 'member_ref = ?', ip3.memberRef) === 0);
  other.close();

  // (n) the same 404 body however something is missing
  const outsider = B.admin;
  const a1 = await outsider.get(`${A.base}/members`);
  const a2 = await outsider.get('/api/clubs/c_AAAAAAAAAAAAAAAAAAAAAA/members');
  const a3 = await outsider.post(`${A.base}/members/m_AAAAAAAAAAAAAAAAAAAAAA/approve`, { requestNo: '0000' });
  const a4 = await outsider.post(`${A.base}/members/${(await memberOf(A, 'Petra Parent')).memberRef}/approve`, { requestNo: '0000' });
  ok('an admin of another club gets byte-identical 404s: real club, no club, no member, real member', [a1, a2, a3, a4].every(r => r.status === 404 && r.text === a1.text));
});

await section('[13] What was agreed to, and proving which text that was', async () => {
  const LEGAL = require('../js/legal.js');
  const C = await newClub('Agreement FC');

  const idx = await C.admin.get('/api/legal');
  ok('the deployment publishes its documents with a version each', idx.status === 200 && idx.json.docs.length >= 3
    && idx.json.docs.every(d => LEGAL.VERSION_RE.test(d.version)));
  ok('…and says which bind the club and which are personal',
    idx.json.docs.find(d => d.id === 'terms').scope === 'club' && idx.json.docs.find(d => d.id === 'privacy').scope === 'personal');
  ok('…and that they are still drafts, rather than implying a lawyer has read them',
    idx.json.docs.every(d => d.status === 'draft'));

  const terms = await C.admin.get('/api/legal/terms?lang=en');
  ok('a document can be read, with the version and the hash of the exact text', terms.status === 200
    && terms.json.text.includes('Terms of Service') && /^[0-9a-f]{64}$/.test(terms.json.sha256));

  /* The app may ask for German. It gets German only while a German text of the CURRENT English
     exists; otherwise English appears on screen, so English is what the record must say — "she
     accepted the German version" has to be true or not said. */
  const LS = require('../server/legal.js');
  const man = LS.load();
  const deServed = LEGAL.pickLang(man.docs.privacy, 'de');
  const de = await C.admin.get('/api/legal/privacy?lang=de');
  ok('asking for German returns the language really served, and says what was asked for',
    de.status === 200 && de.json.lang === deServed && de.json.askedFor === 'de' && de.json.sha256 === man.docs.privacy.langs[deServed].sha256);
  const behindMan = JSON.parse(JSON.stringify(man));
  behindMan.docs.privacy.langs.de = Object.assign({ sha256: '0'.repeat(64), bytes: 1, date: '2020-01-01' }, behindMan.docs.privacy.langs.de || {}, { translates: '2020-01-01+00000000' });
  const late = LS.textOf('privacy', 'de', behindMan);
  ok('a German text of an OLDER English is not served: English is, and it says the translation is behind',
    late.lang === 'en' && late.behind === true && late.version === man.docs.privacy.version);

  const v = idx.json.docs.find(d => d.id === 'terms').version;
  const shaOf = (doc, lang = 'en') => man.docs[doc].langs[LEGAL.pickLang(man.docs[doc], lang)].sha256;
  /* THE TEXT, NOT ONLY THE VERSION. A translation can be corrected without the English version
     moving, so the app sends the hash of the text it showed, and anything else is refused. */
  const noHash = await C.admin.post('/api/legal/accept', { doc: 'terms', version: v, lang: 'en', clubId: C.clubId });
  ok('an acceptance that does not name the exact text shown is refused, and nothing is recorded',
    noHash.status === 409 && noHash.json.error === 'stale-text' && count('acceptances', "doc = 'terms'") === 0);
  ok('…and so is one naming a text this server is not serving',
    (await C.admin.post('/api/legal/accept', { doc: 'terms', version: v, lang: 'en', sha256: 'a'.repeat(64), clubId: C.clubId })).status === 409);
  const acc = await C.admin.post('/api/legal/accept', { doc: 'terms', version: v, lang: 'en', sha256: shaOf('terms'), clubId: C.clubId });
  ok('an admin can accept for the club', acc.status === 200 && acc.json.accepted.doc === 'terms');
  const row = db.prepare("SELECT * FROM acceptances WHERE doc = 'terms'").get();
  ok('…and the row carries the version, the hash and the language actually shown',
    row.version === v && /^[0-9a-f]{64}$/.test(row.sha256) && row.lang === 'en' && row.scope === 'club');
  ok('…and it is bound to the club, not only to the person who clicked', row.club_id === C.clubId);

  ok('accepting the same version twice is the same fact, not a second one',
    (await C.admin.post('/api/legal/accept', { doc: 'terms', version: v, lang: 'en', sha256: shaOf('terms'), clubId: C.clubId })).status === 200
    && count('acceptances', "doc = 'terms'") === 1);

  /* The refusal that keeps the record worth having: a version this server does not serve means
     the person read something else — an old tab, a cached page, a replayed request. */
  const stale = await C.admin.post('/api/legal/accept', { doc: 'terms', version: '2020-01-01+deadbeef', lang: 'en', clubId: C.clubId });
  ok('a version this deployment does not serve is refused, not recorded', stale.status === 409);
  ok('…and a document nobody publishes is refused too',
    (await C.admin.post('/api/legal/accept', { doc: 'invented', version: v, lang: 'en', clubId: C.clubId })).status === 400);
  ok('…and a language nobody could have read it in', 
    (await C.admin.post('/api/legal/accept', { doc: 'terms', version: v, lang: 'zz', clubId: C.clubId })).status === 400);

  /* "She accepted the German version" has to be true or not said at all. The row says the language
     the server really served for that request — German with the German text's hash while a current
     German text exists, English otherwise — never simply the language that was asked for. */
  const pv = idx.json.docs.find(d => d.id === 'privacy').version;
  const deAcc = await C.admin.post('/api/legal/accept', { doc: 'privacy', version: pv, lang: 'de', sha256: shaOf('privacy', 'de'), clubId: C.clubId });
  const deRow = db.prepare("SELECT lang, sha256 FROM acceptances WHERE doc = 'privacy'").get();
  ok('accepting "in German" records the language that was really served, with that text’s hash',
    deAcc.status === 200 && deAcc.json.accepted.lang === deServed && deRow.lang === deServed && deRow.sha256 === man.docs.privacy.langs[deServed].sha256);

  const outstanding = acc.json.outstanding;
  ok('an admin is told what is still owed, by name, not "you must accept something"',
    outstanding.some(x => x.doc === 'dpa' && !x.accepted) && outstanding.find(x => x.doc === 'terms').accepted === true);

  /* A coach is bound personally, not on the club's behalf. A club document is the club's to bind. */
  const inv = await invite(C, 'coach', 'Coach');
  const coach = dev(); await coach.register(inv.code, 'A Coach');
  const cp = await pendingOf(C, 'A Coach');
  ID.decideRequest(db, { clubId: C.clubId, memberRef: cp.memberRef, requestNo: cp.requestNo, approve: true, actor: 'test' }, Date.now());
  const cOut = (await coach.get(`/api/legal/mine?club=${C.clubId}`)).json;
  ok('a coach owes the privacy notice and no club document', cOut.outstanding.length === 1 && cOut.outstanding[0].doc === 'privacy');
  /* The privacy notice is the coach's own: stored with no club, and it must still count when the
     app asks about the coach's club — which it always does. It used to be invisible there, so the
     banner came back at every sign-in and every "I have read it" added another row. */
  const pAcc = () => coach.post('/api/legal/accept', { doc: 'privacy', version: pv, lang: 'en', sha256: shaOf('privacy'), clubId: C.clubId });
  ok('a coach can say they have read the privacy notice', (await pAcc()).status === 200);
  ok('…and asked about their club afterwards, the server says they have',
    (await coach.get(`/api/legal/mine?club=${C.clubId}`)).json.outstanding.find(x => x.doc === 'privacy').accepted === true);
  await pAcc(); await pAcc();
  ok('…and saying it three times is one fact, not three rows',
    count('acceptances', "doc = 'privacy' AND user_id = ?", userId('A Coach')) === 1);
  ok('a coach cannot bind the club to its terms',
    (await coach.post('/api/legal/accept', { doc: 'terms', version: v, lang: 'en', clubId: C.clubId })).status === 404);

  /* A player is often a CHILD, and a child's tick is not consent. The app records nothing from
     them; the club warrants a parent agreed, which is what the club's acceptance is for. */
  const jc = await joinCode(C);
  const player = dev(); await player.register(jc.code, 'A Player');
  const pp = await pendingOf(C, 'A Player');
  ID.decideRequest(db, { clubId: C.clubId, memberRef: pp.memberRef, requestNo: pp.requestNo, approve: true, actor: 'test' }, Date.now());
  const pOut = (await player.get(`/api/legal/mine?club=${C.clubId}`)).json;
  ok('a player is asked to accept nothing at all — a child’s tick is not consent', pOut.outstanding.length === 0);

  /* A sub-processor list is a DISCLOSURE, not an agreement. Asking a club to "accept" who the
     hosting provider is would be theatre, and it has to be able to change without dragging every
     club through a re-acceptance they could not refuse anyway. Its own document, its own version. */
  const pub = (await C.admin.get('/api/legal')).json.docs.filter(d => d.scope === 'published');
  ok('disclosures and templates are published, not agreements',
    pub.length >= 3 && ['subprocessors', 'impressum', 'consent'].every(id => pub.some(d => d.id === id))
    && pub.every(d => d.blocking === false));
  ok('…so nobody is ever asked to accept them',
    !(await C.admin.get(`/api/legal/mine?club=${C.clubId}`)).json.outstanding.some(x => x.scope === 'published'));
  ok('…and accepting one is refused outright, rather than quietly recorded',
    (await C.admin.post('/api/legal/accept', { doc: 'subprocessors', version: pub[0].version, lang: 'en', clubId: C.clubId })).status === 400);
  ok('…while still being readable, because the point of a disclosure is that people read it',
    (await C.admin.get('/api/legal/subprocessors?lang=en')).json.text.includes('Who else is involved'));
  ok('changing who is involved moves only that list’s version',
    pub.find(d => d.id === 'subprocessors').version !== (await C.admin.get('/api/legal')).json.docs.find(d => d.id === 'terms').version);

  /* THE POINT OF VERSIONING, end to end. The first lawyer to read these will change them, and an
     acceptance of last month's text is not an acceptance of this month's. */
  db.prepare(`INSERT INTO acceptances (id, user_id, club_id, doc, version, sha256, lang, scope, accepted_at)
              VALUES ('ac_old', ?, ?, 'dpa', '2026-01-01+00000000', ?, 'en', 'club', ?)`)
    .run(userId('Admin of Agreement FC'), C.clubId, 'f'.repeat(64), Date.now() - 90 * DAY);
  const after = (await C.admin.get(`/api/legal/mine?club=${C.clubId}`)).json.outstanding;
  const dpa = after.find(x => x.doc === 'dpa');
  ok('a document that changed since it was accepted is STALE, not simply unaccepted',
    dpa.accepted === true && dpa.stale === true && dpa.acceptedVersion === '2026-01-01+00000000');
  ok('…and the older acceptance is kept, because it is evidence of what was agreed then',
    count('acceptances', "doc = 'dpa' AND version = '2026-01-01+00000000'") === 1);
  const nowV = (await C.admin.get('/api/legal')).json.docs.find(d => d.id === 'dpa').version;
  const re = await C.admin.post('/api/legal/accept', { doc: 'dpa', version: nowV, lang: 'en', sha256: shaOf('dpa'), clubId: C.clubId });
  ok('re-accepting the current text clears it', re.status === 200 && !re.json.outstanding.find(x => x.doc === 'dpa').stale);
  ok('…and both versions are on the record, so "what did they agree to, and when" has two answers',
    count('acceptances', "doc = 'dpa'") === 2);

  /* An erasure must not destroy the club's contract record: the row survives, naming nobody.
     A club must keep an admin, so a second one exists before the first is erased. */
  const inv2 = await invite(C, 'admin', 'Second admin');
  const admin2 = dev(); await admin2.register(inv2.code, 'Second Admin');
  const a2p = await pendingOf(C, 'Second Admin');
  if (a2p) ID.decideRequest(db, { clubId: C.clubId, memberRef: a2p.memberRef, requestNo: a2p.requestNo, approve: true, actor: 'test' }, Date.now());
  const adminId = userId('Admin of Agreement FC');
  db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
  ok('erasing the person who clicked leaves the club’s agreement standing, with no name on it',
    count('acceptances', "doc = 'dpa' AND club_id = ?", C.clubId) === 2
    && db.prepare("SELECT user_id FROM acceptances WHERE doc = 'dpa' LIMIT 1").get().user_id === null);

  ok('the manifest is built from the documents, so a text cannot change without its version moving',
    (() => {
      const man = require('../server/legal.js').load();
      const crypto = require('node:crypto'), fs2 = require('node:fs');
      return Object.entries(man.docs).every(([id, d]) =>
        d.version.endsWith(crypto.createHash('sha256')
          .update(fs2.readFileSync(new URL(`../legal/${id}.en.md`, import.meta.url), 'utf8')).digest('hex').slice(0, 8)));
    })());
});

S.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
