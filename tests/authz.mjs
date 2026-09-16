/* Slice 4 — with accounts ON, every endpoint that existed before accounts is authorized: a session,
   a club, a role, and one 404 for everything a person may not see.
   Run:  node tests/authz.mjs */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, makeCall, Device, ORIGIN } from './accounts-harness.mjs';

const PORT = 4296;
const S = await startServer(PORT);
const { db, ID } = S;
const rawCall = makeCall(PORT);
const CLIENT = { 'x-thp-client': '4' };
/* every call from "the app" carries the client version the server requires */
const call = (method, path, opts = {}) => rawCall(method, path, Object.assign({}, opts, { headers: Object.assign({}, CLIENT, opts.headers || {}) }));

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };
async function section(title, fn) {
  console.log('\n' + title);
  try { await fn(); } catch (e) { fail++; console.log('  ✗ FAIL: section threw —', e && e.stack || e); }
}
const dev = () => new Device(call, undefined);

/* a club, its admin, and an approved player */
async function club(name) {
  const clubId = ID.createClub(db, { name, actor: 'operator' }, Date.now());
  const admin = dev();
  await admin.register(ID.issueCode(db, { kind: 'club-admin', clubId, role: 'admin', actor: 'operator' }, Date.now()).code, `Admin ${name}`);
  await admin.stepUp();
  const join = (await admin.post(`/api/clubs/${clubId}/join-codes`, { label: 'players' })).json;
  const player = dev();
  await player.register(join.code, `Player ${name}`);
  const pending = (await admin.get(`/api/clubs/${clubId}/members`)).json.members.find(m => m.status === 'pending');
  await admin.post(`/api/clubs/${clubId}/members/${pending.memberRef}/approve`, { requestNo: pending.requestNo });
  await player.login();
  return { clubId, admin, player, playerRef: pending.memberRef };
}
const A = await club('Alpha WPC');
const B = await club('Beta WPC');
const post = (dev2, path, body, opts = {}) => call('POST', path, Object.assign({ body, cookie: dev2 && dev2.cookie }, opts));
const get = (dev2, path, opts = {}) => call('GET', path, Object.assign({ cookie: dev2 && dev2.cookie }, opts));

await section('[1] The gate in front of every old endpoint', async () => {
  ok('an app older than the switch is told to update (426), not quietly refused', (await rawCall('GET', '/api/debriefs', { cookie: A.admin.cookie })).status === 426);
  ok('…and an older version number too', (await rawCall('GET', '/api/debriefs', { cookie: A.admin.cookie, headers: { 'x-thp-client': '3' } })).status === 426);
  ok('health stays open, and says accounts are on', (await rawCall('GET', '/api/health')).json.accounts === true);
  ok('a POST without an Origin → 403', (await call('POST', '/api/debriefs', { body: {}, cookie: A.admin.cookie, origin: null })).status === 403);
  ok('…from a foreign Origin → 403', (await call('POST', '/api/debriefs', { body: {}, cookie: A.admin.cookie, origin: 'https://evil.example' })).status === 403);
  ok('…as a form post → 415', (await call('POST', '/api/debriefs', { raw: 'x=1', type: 'text/plain', cookie: A.admin.cookie })).status === 415);
  ok('a CORS preflight gets nothing', (await call('OPTIONS', '/api/debriefs', { raw: '' })).status === 405);
  const r = await get(A.admin, '/api/debriefs');
  ok('no answer carries a CORS header any more', !r.headers['access-control-allow-origin'] && r.headers['cache-control'] === 'no-store');
});

await section('[2] Signed out: nothing but health', async () => {
  const routes = [['GET', '/api/debriefs'], ['POST', '/api/debriefs'], ['GET', '/api/announcements'], ['POST', '/api/announcements'],
    ['POST', '/api/clip'], ['POST', '/api/jobs'], ['POST', '/api/insights'], ['GET', '/api/insights'], ['POST', '/api/calendar'], ['POST', '/api/videogen']];
  const out = [];
  for (const [m, path] of routes) out.push((await call(m, path, { body: {} })).status);
  ok('every old route answers 401 signed-out without a session', out.every(s => s === 401));
  ok('an upload without a session is refused before a byte is written', (await call('POST', '/api/upload', { raw: 'not-a-video', type: 'application/octet-stream' })).status === 401);
});

await section('[3] A player is not staff', async () => {
  ok('a player cannot upload a match video', (await call('POST', '/api/upload', { raw: 'bytes', type: 'application/octet-stream', cookie: A.player.cookie })).status === 404);
  ok('…cannot write a debrief', (await post(A.player, '/api/debriefs', { title: 'x', items: [] })).status === 404);
  ok('…cannot publish a calendar feed', (await post(A.player, '/api/calendar', { events: [], name: 'x' })).status === 404);
  ok('…cannot read the k-anonymous insights report', (await get(A.player, '/api/insights')).status === 404);
  ok('…but can read their club’s debriefs and announcements', (await get(A.player, '/api/debriefs')).status === 200 && (await get(A.player, '/api/announcements')).status === 200);
  // a staff session that was never user-verified (signed in as a player, promoted since)
  db.prepare("UPDATE sessions SET uv = 0 WHERE user_id = (SELECT id FROM users WHERE display_name = 'Admin Alpha WPC')").run();
  ok('staff acting from an unverified session → 403, asking for verification', (await call('POST', '/api/upload', { raw: 'bytes', type: 'application/octet-stream', cookie: A.admin.cookie })).json.error === 'user-verification-required');
  await A.admin.stepUp();
  ok('…and it works again once they verify', (await call('POST', '/api/upload', { raw: 'bytes', type: 'application/octet-stream', cookie: A.admin.cookie })).status === 200);
});

let video, job, deb;
await section('[4] What staff make belongs to their club, with ids nobody can count', async () => {
  const up = await call('POST', '/api/upload', { raw: 'pretend-video-bytes', type: 'application/octet-stream', cookie: A.admin.cookie });
  video = up.json.videoRef;
  ok('a video upload is accepted and named at random', up.status === 200 && /^vid_[A-Za-z0-9_-]{22}\.mp4$/.test(video));
  const j = await post(A.admin, '/api/jobs', { videoRef: video, calibration: { corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, opts: { fps: 2 } });
  job = j.json.id;
  ok('a job on that video is queued, with a random id', j.status === 202 && /^job_[A-Za-z0-9_-]{22}$/.test(job));
  const d = await post(A.admin, '/api/debriefs', { title: 'Vs Beta', items: [{ t0: 1, t1: 4, title: 'Drive' }], author: 'Somebody Else' });
  deb = d.json.id;
  ok('a debrief gets a random id', d.status === 201 && /^deb_[A-Za-z0-9_-]{22}$/.test(deb));
  ok('…and its author is who the session says, not what the request claimed', (await get(A.admin, '/api/debriefs/' + deb)).json.author === 'Admin Alpha WPC');
  ok('the club’s own people can read it', (await get(A.player, '/api/debriefs/' + deb)).status === 200);
});

await section('[5] Another club gets the same 404 for everything', async () => {
  const answers = await Promise.all([
    get(B.admin, '/api/jobs/' + job), get(B.admin, '/api/debriefs/' + deb),
    post(B.admin, '/api/clip', { videoRef: video, start: 0, end: 2 }),
    post(B.admin, `/api/debriefs/${deb}/comments`, { text: 'hello' }),
  ]);
  ok('a job, a debrief, a comment on it: all 404 for another club', answers.slice(0, 2).concat(answers[3]).every(r => r.status === 404));
  ok('…and another club cannot cut a clip out of their video', answers[2].status === 404 && answers[2].json.error === 'video-not-found');
  ok('a video that was never uploaded gives that same answer', (await post(A.admin, '/api/clip', { videoRef: 'vid_madeup.mp4', start: 0, end: 2 })).json.error === 'video-not-found');
  ok('the other club’s debrief list is empty, not forbidden', (await get(B.admin, '/api/debriefs')).json.debriefs.length === 0);
  ok('a player of the club cannot read a job (not theirs, and not staff)', (await get(A.player, '/api/jobs/' + job)).status === 404);
});

await section('[6] A clip: the owner, the club’s staff, and whoever may read the debrief that shows it', async () => {
  // the cut itself needs ffmpeg; the authorization runs before it, and that is what is tested here
  const cut = await post(A.admin, '/api/clip', { videoRef: video, start: 0, end: 2 });
  ok('the club’s own staff get past authorization (ffmpeg then decides)', [200, 422, 500, 503].includes(cut.status));
  // a clip that exists, with no debrief showing it
  const clipId = 'clip_test_0_20.mp4';
  mkdirSync(join(S.DATA, 'clips'), { recursive: true });
  writeFileSync(join(S.DATA, 'clips', clipId), Buffer.alloc(32, 3));
  db.prepare("INSERT INTO assets (id, kind, club_id, owner_user_id, created_at) VALUES (?, 'clip', ?, ?, ?)").run(clipId, A.clubId, null, Date.now());
  ok('staff of the club may watch it', (await get(A.admin, '/api/clips/' + clipId)).status === 200);
  ok('a player of the club may not — no debrief shows it', (await get(A.player, '/api/clips/' + clipId)).status === 404);
  ok('another club may not either', (await get(B.admin, '/api/clips/' + clipId)).status === 404);
  await post(A.admin, '/api/debriefs', { title: 'With a clip', items: [{ t0: 0, t1: 2, title: 'Counter', clipUrl: '/api/clips/' + clipId }] });
  ok('once a debrief of their club shows it, the player may watch it', (await get(A.player, '/api/clips/' + clipId)).status === 200);
  ok('…but a player of the other club still may not', (await get(B.player, '/api/clips/' + clipId)).status === 404);
});

await section('[7] Announcements are addressed by a club’s own member ref', async () => {
  const team = await post(A.admin, '/api/announcements', { scope: 'team', title: 'Training moved', body: 'Pool closed on Friday.' });
  ok('a team note is accepted', team.status === 201);
  const toPlayer = await post(A.admin, '/api/announcements', { scope: 'player', to: A.playerRef, title: 'Your shot', body: 'Take the near post.' });
  ok('a note to one player, addressed by their member ref', toPlayer.status === 201);
  ok('a member ref from another club is not an address here', (await post(A.admin, '/api/announcements', { scope: 'player', to: B.playerRef, title: 'x', body: 'y' })).status === 404);
  const mine = (await get(A.player, '/api/announcements')).json;
  ok('the player sees the team note and their own', mine.announcements.length === 2 && mine.unread === 2);
  const others = (await get(B.player, '/api/announcements')).json;
  ok('the other club’s player sees nothing of it', others.announcements.length === 0);
  const one = await get(A.player, '/api/announcements/' + toPlayer.json.id);
  ok('…and can open their own', one.status === 200);
  ok('a player it is not addressed to cannot open it', (await get(B.player, '/api/announcements/' + toPlayer.json.id)).status === 404);
  await post(A.player, `/api/announcements/${toPlayer.json.id}/read`, { by: 'someone-else@example.com' });
  const stored = (await get(A.admin, '/api/announcements/' + toPlayer.json.id)).json;
  ok('“read” is recorded for the session, never for whoever the body names', stored.readBy.length === 1 && stored.readBy[0] !== 'someone-else@example.com' && stored.readBy[0].startsWith('u_'));
  ok('the author shown is the session’s name', stored.from.name === 'Admin Alpha WPC');
});

await section('[8] Calendar feeds are issued by the server and can be revoked', async () => {
  ok('a token a client invented is gone for good', (await post(A.admin, '/api/calendar/calmadeup', { events: [{ id: 'e1', title: 'x', start: '2026-10-01T18:00' }] })).status === 410);
  const pub = await post(A.admin, '/api/calendar', { name: 'Alpha season', events: [{ id: 'e1', title: 'Match', start: '2026-10-01T18:00', end: '2026-10-01T19:30' }] });
  ok('staff publish and get a token back', pub.status === 200 && typeof pub.json.token === 'string' && pub.json.token.length >= 40);
  const ics = await rawCall('GET', pub.json.ics);
  ok('a calendar app fetches the .ics with no cookie and no app version', ics.status === 200 && ics.text.startsWith('BEGIN:VCALENDAR') && /Match/.test(ics.text));
  ok('the token is stored only as a hash', !JSON.stringify(db.prepare('SELECT * FROM calendar_feeds').all()).includes(pub.json.token));
  db.prepare('UPDATE calendar_feeds SET revoked_at = ?').run(Date.now());
  ok('revoking it stops the feed', (await rawCall('GET', pub.json.ics)).status === 404);
  ok('an invented token is not a feed', (await rawCall('GET', '/api/calendar/nonsense.ics')).status === 404);
});

await section('[9b] A moment from the Film Room, sent to the club or to one player', async () => {
  const clipId = 'clip_sent_30_40.mp4';
  writeFileSync(join(S.DATA, 'clips', clipId), Buffer.alloc(48, 5));
  db.prepare("INSERT INTO assets (id, kind, club_id, owner_user_id, created_at) VALUES (?, 'clip', ?, ?, ?)").run(clipId, A.clubId, null, Date.now());
  const clip = { url: '/api/clips/' + clipId, title: '0:34 · Our shot saved', start: 30, end: 40, marks: ['6 on 5', 'near post', 'shoot earlier'] };
  const sent = await post(A.admin, '/api/announcements', { scope: 'player', to: A.playerRef, title: 'Look at this', body: 'Next time, shoot earlier.', clip });
  ok('a coach sends a cut moment to one player', sent.status === 201);
  const seen = await get(A.player, '/api/announcements/' + sent.json.id);
  ok('…the player gets the clip and what was marked on it', seen.status === 200 && seen.json.clip.url === clip.url && seen.json.clip.marks.length === 3);
  ok('…and may now watch that clip, which was not theirs before', (await get(A.player, '/api/clips/' + clipId)).status === 200);
  ok('another club’s player still may not', (await get(B.player, '/api/clips/' + clipId)).status === 404);
  const other = await post(B.admin, '/api/announcements', { scope: 'team', title: 'Stolen clip', body: 'x', clip });
  ok('a club cannot attach a clip cut from another club’s video', other.status === 404);
  ok('a made-up clip url is not a clip', (await post(A.admin, '/api/announcements', { scope: 'team', title: 'x', body: 'y', clip: { url: 'https://evil.example/x.mp4' } })).status === 400);
  // a second player of the same club, who was not written to
  const addr = await get(A.admin, `/api/clubs/${A.clubId}/addressees`);
  ok('staff can see who they may write to — names and refs, nothing else', addr.status === 200 && addr.json.addressees.some(x => x.name === 'Player Alpha WPC') && !JSON.stringify(addr.json).includes('requestNo'));
  ok('a player cannot', (await get(A.player, `/api/clubs/${A.clubId}/addressees`)).status === 404);
  await A.admin.stepUp();
  const jc = (await A.admin.post(`/api/clubs/${A.clubId}/join-codes`, { label: 'more players' })).json;
  const mate = dev(); await mate.register(jc.code, 'Second Alpha');
  const pend = (await A.admin.get(`/api/clubs/${A.clubId}/members`)).json.members.find(m => m.name === 'Second Alpha');
  await A.admin.post(`/api/clubs/${A.clubId}/members/${pend.memberRef}/approve`, { requestNo: pend.requestNo });
  await mate.login();
  ok('a club-mate the note was not sent to cannot watch that clip', (await get(mate, '/api/clips/' + clipId)).status === 404);
  const teamClip = await post(A.admin, '/api/announcements', { scope: 'team', title: 'For everyone', body: 'watch', clip });
  ok('a club-wide note carries it to every member', teamClip.status === 201 && (await get(A.player, '/api/clips/' + clipId)).status === 200 && (await get(mate, '/api/clips/' + clipId)).status === 200);
});

await section('[9] What was there before accounts belongs to nobody', async () => {
  // a debrief and a video written by the old, unauthenticated server
  writeFileSync(join(S.DATA, 'debriefs', 'legacy1.json'), JSON.stringify({ id: 'legacy1', team: 'club', title: 'Old review', items: [], comments: [], createdAt: Date.now() }));
  writeFileSync(join(S.DATA, 'videos', 'legacyvideo.mp4'), Buffer.alloc(16, 1));
  ok('a legacy debrief is in nobody’s list', !(await get(A.admin, '/api/debriefs')).json.debriefs.some(d => d.id === 'legacy1') && !(await get(B.admin, '/api/debriefs')).json.debriefs.some(d => d.id === 'legacy1'));
  ok('…and cannot be opened by id', (await get(A.admin, '/api/debriefs/legacy1')).status === 404);
  ok('a legacy video cannot be cut into a clip', (await post(A.admin, '/api/clip', { videoRef: 'legacyvideo.mp4', start: 0, end: 2 })).json.error === 'video-not-found');
  writeFileSync(join(S.DATA, 'clips', 'legacyclip.mp4'), Buffer.alloc(16, 2));
  const legacyClip = await Promise.all([get(A.admin, '/api/clips/legacyclip.mp4'), get(A.player, '/api/clips/legacyclip.mp4'), get(B.admin, '/api/clips/legacyclip.mp4')]);
  ok('a legacy clip belongs to nobody: staff, player and another club all get 404', legacyClip.every(r => r.status === 404));
});

S.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
