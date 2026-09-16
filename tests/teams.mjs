/* Server-side teams and rosters (slice 5) over real HTTP with software passkeys: uploading a
   device's team, what may never travel with it, who may read a roster, the two-teams-same-category
   check, team staff and members, the narrowed addressee list, and what a demotion takes away.
   The roster data here is invented — no real player, licence number or club appears in this file.
   Run:  node tests/teams.mjs */
import { createRequire } from 'node:module';
import { startServer, makeCall, Device, ORIGIN } from './accounts-harness.mjs';
const require = createRequire(import.meta.url);
const TEAMSYNC = require('../js/teamsync.js');

const PORT = 4298;
const S = await startServer(PORT);
const { db, ID } = S;
const call = makeCall(PORT);
const dev = () => new Device(call, undefined);

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };
async function section(title, fn) {
  console.log('\n' + title);
  try { await fn(); } catch (e) { fail++; console.log('  ✗ FAIL: section threw —', e && e.stack || e); }
}
const SEASON = 2026;
/* invented players: four licence numbers that belong to nobody, and one signing whose licence is
   still pending, known only by the id the device made for them */
const P = (licence, name, extra = {}) => Object.assign({ licence, name, firstName: name.split(' ')[0] }, extra);
const PENDING = (localId, name, extra = {}) => Object.assign({ localId, name, firstName: name.split(' ')[0] }, extra);
const team = (localId, over = {}) => Object.assign({ localId, name: 'U14 blue', category: 'U14', season: SEASON, leagueLabel: '', players: [] }, over);

/* a club, its admin, a coach and a player — each account made the way that person really would */
async function club(name) {
  const clubId = ID.createClub(db, { name, actor: 'operator' }, Date.now());
  const admin = dev();
  await admin.register(ID.issueCode(db, { kind: 'club-admin', clubId, role: 'admin', actor: 'operator' }, Date.now()).code, `Admin ${name}`);
  await admin.stepUp();
  const base = `/api/clubs/${clubId}`;
  const add = async (role, who) => {
    await admin.stepUp();
    const inv = (await admin.post(`${base}/invites`, { role, label: who })).json;
    const d = dev();
    await d.register(inv.code, who);
    const pending = ((await admin.get(`${base}/members`)).json.members || []).find(m => m.name === who);
    await admin.post(`${base}/members/${pending.memberRef}/approve`, { requestNo: pending.requestNo });
    await d.login();                                   // an approved member signs in for themselves
    await d.stepUp();
    return Object.assign(d, { memberRef: pending.memberRef });
  };
  const coach = await add('coach', `Coach ${name}`);
  const other = await add('coach', `Other Coach ${name}`);
  const player = await (async () => {
    await admin.stepUp();
    const jc = (await admin.post(`${base}/join-codes`, { label: 'parents' })).json;
    const d = dev();
    await d.register(jc.code, `Player ${name}`);
    const pending = ((await admin.get(`${base}/members`)).json.members || []).find(m => m.name === `Player ${name}`);
    await admin.post(`${base}/members/${pending.memberRef}/approve`, { requestNo: pending.requestNo });
    await d.login();
    return Object.assign(d, { memberRef: pending.memberRef });
  })();
  return { clubId, base, admin, coach, other, player };
}

const A = await club('Alpha WPC');
const B = await club('Beta WPC');
const up = (who, c, body) => who.post(`${c.base}/teams`, body);

await section('[1] A coach puts a team on the club’s server', async () => {
  await A.coach.stepUp();
  const r = await up(A.coach, A, team('t1', { players: [P('50101', 'Nora Muster'), P('50102', 'Timo Beispiel', { cap: '7' }), PENDING('m7a', 'Neue Spielerin', { birthYear: 2013, gender: 'F' })] }));
  ok('the upload is accepted', r.status === 200 && !!r.json.team.id);
  ok('…and answers with what it stored, not with what was sent', r.json.team.localId === 't1' && r.json.players.length === 3 && r.json.counts.added === 3);
  ok('…which the device checks before it believes any of it', TEAMSYNC.manifestOk(TEAMSYNC.sanitizeTeam(team('t1', { players: [P('50101', 'Nora Muster'), P('50102', 'Timo Beispiel', { cap: '7' }), PENDING('m7a', 'Neue Spielerin', { birthYear: 2013, gender: 'F' })] })).value, r.json));
  A.teamId = r.json.team.id;
  const again = await up(A.coach, A, team('t1', { players: [P('50101', 'Nora Muster'), P('50102', 'Timo Beispiel', { cap: '7' }), PENDING('m7a', 'Neue Spielerin', { birthYear: 2013, gender: 'F' })] }));
  ok('sending it a second time creates nothing and answers the same team', again.status === 200 && again.json.team.id === A.teamId && again.json.counts.added === 0 && again.json.counts.changed === 0);
  ok('…and the club still has exactly one team and three players', db.prepare('SELECT count(*) AS n FROM club_teams WHERE club_id = ?').get(A.clubId).n === 1 && db.prepare('SELECT count(*) AS n FROM club_players WHERE club_id = ?').get(A.clubId).n === 3);
  const renamed = await up(A.coach, A, team('t1', { name: 'U14 blue (autumn)', players: [P('50101', 'Nora Muster-Beispiel')] }));
  ok('a correction is an update, not a second team', renamed.status === 200 && renamed.json.team.id === A.teamId && renamed.json.counts.changed === 1);
  ok('…and an upload never removes anyone left out of it', db.prepare('SELECT count(*) AS n FROM club_team_players WHERE team_id = ? AND removed_at IS NULL').get(A.teamId).n === 3);
});

await section('[2] The device’s own id is never the key', async () => {
  await A.other.stepUp();
  const mine = await up(A.other, A, team('t1', { name: 'U16 girls', category: 'U16D' }));
  ok('another coach’s colliding local id makes their own team, not a way into someone else’s', mine.status === 200 && mine.json.team.id !== A.teamId);
  ok('…and they cannot read the first coach’s team', (await A.other.get(`${A.base}/teams/${A.teamId}`)).status === 404);
  const stored = JSON.stringify(db.prepare('SELECT * FROM club_teams').all());
  ok('the raw local id is nowhere in the database', !stored.includes('"t1"') && !/[:,]"t1"/.test(stored));
  ok('…and the key is a hash that says nothing about the club or the coach', db.prepare('SELECT sync_key FROM club_teams').all().every(r => /^[A-Za-z0-9_-]{43}$/.test(r.sync_key)));
  A.otherTeamId = mine.json.team.id;
});

await section('[3] A player record belongs to one club and stays there', async () => {
  await B.coach.stepUp();
  const r = await up(B.coach, B, team('b1', { players: [P('50101', 'Nora Muster')] }));
  ok('another club may hold the same licence — adding it says nothing about anyone else', r.status === 200 && r.json.counts.added === 1);
  ok('…as its own row, with its own id', db.prepare('SELECT count(*) AS n FROM club_players WHERE licence = ?').get('50101').n === 2);
  B.teamId = r.json.team.id;
  await B.coach.stepUp();
  await up(B.coach, B, team('b1', { players: [P('50101', 'Nora M.')] }));
  const names = db.prepare('SELECT club_id, name FROM club_players WHERE licence = ?').all('50101');
  ok('…and one club’s correction never reaches the other’s sheet', names.find(x => x.club_id === A.clubId).name === 'Nora Muster-Beispiel' && names.find(x => x.club_id === B.clubId).name === 'Nora M.');
  ok('the same licence twice in ONE club is one player, not two', (() => {
    const r2 = db.prepare('SELECT count(*) AS n FROM club_players WHERE club_id = ? AND licence = ?').get(A.clubId, '50101').n;
    return r2 === 1;
  })());
});

await section('[4] What may never travel with a roster', async () => {
  await A.coach.stepUp();
  const bad = async over => (await up(A.coach, A, team('t9', { players: [Object.assign(P('50109', 'Test Player'), over)] }))).json;
  ok('a date of birth is refused by name', (await bad({ date: '2013-04-17' })).error === 'bad-field');
  ok('…however it is spelled', (await bad({ dob: '2013-04-17' })).error === 'bad-field' && (await bad({ birthDate: '2013-04-17' })).error === 'bad-field');
  ok('a nationality status is refused: it is about a named child and anyone can re-derive it', (await bad({ status: 'Ausländer-Étranger' })).error === 'bad-field');
  ok('a licensed player carries no birth year and no gender at all', (await bad({ birthYear: 2013 })).error === 'licensed-player-needs-no-year');
  ok('availability never leaves the device', (await up(A.coach, A, team('t9', { availability: { L50101: 'in' } }))).json.error === 'bad-field');
  ok('…nor do the coach’s sheets', (await up(A.coach, A, team('t9', { sheets: [{ id: 's1' }] }))).json.error === 'bad-field');
  ok('a field nobody agreed to is refused rather than quietly dropped', (await bad({ shoeSize: 41 })).error === 'bad-field');
  ok('no stored row anywhere looks like a date', !/\d{4}-\d{2}-\d{2}/.test(JSON.stringify(db.prepare('SELECT * FROM club_players').all())));
  ok('the column refuses one even if a route ever forgot to', (() => {
    try { db.prepare("INSERT INTO club_players (id, club_id, licence, sync_key, birth_year, created_at, updated_at) VALUES ('cp_x', ?, NULL, 'k', '2013-04-17', 1, 1)").run(A.clubId); return false; }
    catch (e) { return /CHECK constraint failed/.test(e.message); }
  })());
  ok('a licence is one string, not four: 050101 is the same child as 50101', (await up(A.coach, A, team('t1', { players: [P('050101', 'Nora'), P('50101', 'Nora')] }))).json.error === 'duplicate-player');
  ok('…and a licence that is not a licence is refused', (await bad({ licence: '5010a' })).error === 'bad-licence');
});

await section('[5] Reading a roster is an export, and asks for the passkey again', async () => {
  const cold = dev();
  await cold.register(ID.issueCode(db, { kind: 'club-admin', clubId: A.clubId, role: 'admin', actor: 'operator' }, Date.now()).code, 'Second Admin Alpha');
  ok('a staff session that has not just proved itself cannot open a roster', (await cold.get(`${A.base}/teams/${A.teamId}`)).status === 403);
  await cold.stepUp();
  const r = await cold.get(`${A.base}/teams/${A.teamId}`);
  ok('…and can once it has', r.status === 200 && r.json.players.length === 3);
  ok('the list of teams needs no step-up: it is names, not children', (await cold.get(`${A.base}/teams`)).status === 200);
  ok('a licensed player comes back with no birth year and no gender', r.json.players.filter(p => p.licence).every(p => p.birthYear === null && p.gender === ''));
  ok('…and the one whose licence is pending keeps the year only the device could supply', r.json.players.find(p => !p.licence).birthYear === 2013);
});

await section('[6] Who may see a team', async () => {
  await A.coach.stepUp();
  ok('the coach who made it may', (await A.coach.get(`${A.base}/teams/${A.teamId}`)).status === 200);
  await A.other.stepUp();
  ok('a coach of the same club who is not staff of it may not', (await A.other.get(`${A.base}/teams/${A.teamId}`)).status === 404);
  ok('a player of the club may not, and is not told the team exists', (await A.player.get(`${A.base}/teams/${A.teamId}`)).status === 404 && (await A.player.get(`${A.base}/teams`)).status === 404);
  await B.coach.stepUp();
  ok('another club gets the same 404 as a stranger', (await B.coach.get(`${A.base}/teams/${A.teamId}`)).status === 404);
  ok('…and a team id that never existed is the same 404 again', (await A.coach.get(`${A.base}/teams/ct_AAAAAAAAAAAAAAAAAAAAAA`)).status === 404);
  const admins = await A.admin.get(`${A.base}/teams`);
  ok('a club admin sees every team of their club', admins.status === 200 && admins.json.scope === 'club' && admins.json.teams.length === 2);
  const own = await A.coach.get(`${A.base}/teams`);
  ok('a coach sees only their own, and is told that is what they are seeing', own.json.scope === 'teams' && own.json.teams.length === 1 && own.json.teams[0].id === A.teamId);
});

await section('[7] The same player on two lists of one category', async () => {
  await A.coach.stepUp();
  const second = await up(A.coach, A, team('t2', { name: 'U14 white', players: [P('50101', 'Nora Muster-Beispiel')] }));
  ok('a second team of the same category and season flags the player already on one', second.json.conflicts.length === 1 && second.json.conflicts[0].players.includes('50101'));
  ok('…and names the other team, because this coach is staff of it too', second.json.conflicts[0].code === 'team-conflict-named' && second.json.conflicts[0].team === 'U14 blue (autumn)');
  await A.other.stepUp();
  const theirs = await up(A.other, A, team('t3', { name: 'U14 red', players: [P('50101', 'Nora') ] }));
  ok('a coach who is not staff of the other list is told the fact without the team', theirs.json.conflicts[0].code === 'team-conflict' && theirs.json.conflicts[0].team === null);
  await A.coach.stepUp();
  const nextSeason = await up(A.coach, A, team('t4', { name: 'U14 blue', season: SEASON + 1, players: [P('50101', 'Nora')] }));
  ok('last season’s team is not a conflict with this season’s', nextSeason.json.conflicts.length === 0);
  const otherCat = await up(A.coach, A, team('t5', { name: 'U16 blue', category: 'U16', players: [P('50101', 'Nora')] }));
  ok('…nor is another category', otherCat.json.conflicts.length === 0);
  ok('there is no route that answers "is this licence in this club"', (await A.other.get(`${A.base}/players?licence=50101`)).status === 404 && (await A.other.post(`${A.base}/players/lookup`, { licence: '50101' })).status === 404);
});

await section('[8] Taking a player off a list', async () => {
  const r = await A.coach.get(`${A.base}/teams/${A.teamId}`);
  const nora = r.json.players.find(p => p.licence === '50101');
  const gone = await A.coach.post(`${A.base}/teams/${A.teamId}/players/${nora.id}/remove`, {});
  ok('a coach can take a player off their team', gone.status === 200 && gone.json.removed === true);
  ok('…and the row stays, so "was she on this list in March" still has an answer', db.prepare('SELECT removed_at FROM club_team_players WHERE team_id = ? AND club_player_id = ?').get(A.teamId, nora.id).removed_at > 0);
  ok('…she is still in the club, because another list still has her', gone.json.leftClub === false && !db.prepare('SELECT left_at FROM club_players WHERE id = ?').get(nora.id).left_at);
  ok('another club’s player id is not a player here', (await A.coach.post(`${A.base}/teams/${A.teamId}/players/cp_AAAAAAAAAAAAAAAAAAAAAA/remove`, {})).status === 404);
  const back = await A.coach.post(`${A.base}/teams/${A.teamId}/players`, P('50101', 'Nora Muster-Beispiel'));
  ok('putting her back is an ordinary add', back.status === 200 && back.json.player.licence === '50101');
});

await section('[9] Team staff, team members, and who a coach may write to', async () => {
  await A.admin.stepUp();
  const s1 = await A.admin.post(`${A.base}/teams/${A.teamId}/staff`, { memberRef: A.other.memberRef });
  ok('an admin can make another coach staff of a team', s1.status === 200 && s1.json.staff.some(x => x.name === 'Other Coach Alpha WPC'));
  await A.coach.stepUp();
  ok('a coach cannot make themselves staff of a team they do not have', (await A.coach.post(`${A.base}/teams/${A.otherTeamId}/staff`, { memberRef: A.coach.memberRef })).status === 404);
  ok('a club player cannot be made staff of a team', (await A.admin.post(`${A.base}/teams/${A.teamId}/staff`, { memberRef: A.player.memberRef })).status === 400);
  await A.coach.stepUp();
  const m1 = await A.coach.post(`${A.base}/teams/${A.teamId}/members`, { memberRef: A.player.memberRef });
  ok('a coach can put a club member on their team', m1.status === 200 && m1.json.members.some(x => x.name === 'Player Alpha WPC'));
  ok('…but not somebody from another club', (await A.coach.post(`${A.base}/teams/${A.teamId}/members`, { memberRef: B.player.memberRef })).status === 404);

  const coachSees = await A.coach.get(`${A.base}/addressees`);
  ok('a coach may now write to their own team, and is told that is the scope', coachSees.json.scope === 'teams' && coachSees.json.addressees.some(x => x.name === 'Player Alpha WPC'));
  ok('…never to themselves', !coachSees.json.addressees.some(x => x.name === 'Coach Alpha WPC'));
  const lonely = await B.other.get(`${B.base}/addressees`);
  ok('a coach who is staff of no team gets an empty list, not everybody', lonely.json.scope === 'teams' && lonely.json.addressees.length === 0);
  const adminSees = await A.admin.get(`${A.base}/addressees`);
  ok('a club admin still writes to the whole club', adminSees.json.scope === 'club' && adminSees.json.addressees.length >= 4);
  ok('a player still may not ask who is in the club', (await A.player.get(`${A.base}/addressees`)).status === 404);
});

await section('[10] What a demotion and a removal take away', async () => {
  const before = db.prepare('SELECT count(*) AS n FROM club_team_staff WHERE club_id = ? AND user_id = ?').get(A.clubId, (db.prepare('SELECT id FROM users WHERE display_name = ?').get('Other Coach Alpha WPC') || {}).id).n;
  await A.admin.stepUp();
  await A.admin.post(`${A.base}/members/${A.other.memberRef}/role`, { role: 'player' });
  const after = db.prepare('SELECT count(*) AS n FROM club_team_staff WHERE club_id = ? AND user_id = ?').get(A.clubId, db.prepare('SELECT id FROM users WHERE display_name = ?').get('Other Coach Alpha WPC').id).n;
  ok('a coach demoted to player stops being staff of every team', before > 0 && after === 0);
  await A.other.login();
  ok('…and can no longer read the team they ran', (await A.other.get(`${A.base}/teams/${A.otherTeamId}`)).status === 404);
  const playerUser = db.prepare('SELECT id FROM users WHERE display_name = ?').get('Player Alpha WPC').id;
  ok('but a demotion leaves them on the teams a coach may write to', db.prepare('SELECT count(*) AS n FROM club_team_members WHERE club_id = ? AND user_id = ?').get(A.clubId, playerUser).n === 1);
  await A.admin.stepUp();
  await A.admin.post(`${A.base}/members/${A.player.memberRef}/remove`, {});
  ok('leaving the club takes the team membership too', db.prepare('SELECT count(*) AS n FROM club_team_members WHERE club_id = ? AND user_id = ?').get(A.clubId, playerUser).n === 0);
  ok('…and the audit says how many, never who was on which list', (() => {
    const row = db.prepare("SELECT detail FROM audit WHERE action = 'team.lose-roles' ORDER BY at DESC LIMIT 1").get();
    return row && /"staff":|"member":/.test(row.detail) && !/5010/.test(row.detail);
  })());
});

await section('[11] Deleting a team', async () => {
  await A.coach.stepUp();
  const wrong = await A.coach.post(`${A.base}/teams/${A.teamId}/delete`, { name: 'U14 blue' });
  ok('the name has to match, so a mis-tap cannot take a season’s roster', wrong.status === 400 && wrong.json.error === 'bad-team');
  await B.coach.stepUp();
  ok('another club cannot delete it', (await B.coach.post(`${A.base}/teams/${A.teamId}/delete`, { name: 'U14 blue (autumn)' })).status === 404);
  await A.coach.stepUp();
  const r = await A.coach.post(`${A.base}/teams/${A.teamId}/delete`, { name: 'U14 blue (autumn)' });
  ok('its own coach can, by retyping the name', r.status === 200 && r.json.deleted === true);
  ok('…and it is gone, with its roster links and its staff', !db.prepare('SELECT 1 FROM club_teams WHERE id = ?').get(A.teamId) && !db.prepare('SELECT 1 FROM club_team_players WHERE team_id = ?').get(A.teamId) && !db.prepare('SELECT 1 FROM club_team_staff WHERE team_id = ?').get(A.teamId));
  ok('a player another list still holds keeps their row', !!db.prepare('SELECT 1 FROM club_players WHERE club_id = ? AND licence = ?').get(A.clubId, '50101'));
  ok('…and one who was only ever on this list does not linger in the club', !db.prepare('SELECT 1 FROM club_players WHERE club_id = ? AND licence = ?').get(A.clubId, '50102'));
});

await section('[12] A session opened by following somebody’s link may not upload', async () => {
  const c = await club('Gamma WPC');
  await c.admin.stepUp();
  const inv = (await c.admin.post(`${c.base}/invites`, { role: 'coach', label: 'new coach' })).json;
  const joined = dev();
  await joined.register(inv.code, 'Invited Coach');           // origin 'staff-invite' — their own act
  const pending = ((await c.admin.get(`${c.base}/members`)).json.members || []).find(m => m.name === 'Invited Coach');
  await c.admin.post(`${c.base}/members/${pending.memberRef}/approve`, { requestNo: pending.requestNo });
  await joined.stepUp();
  ok('a coach who accepted a staff invite may upload', (await up(joined, c, team('g1', { players: [P('50201', 'Erste Spielerin')] }))).status === 200);

  await c.admin.stepUp();
  const jc = (await c.admin.post(`${c.base}/join-codes`, { label: 'parents' })).json;
  const viaLink = dev();
  await viaLink.register(jc.code, 'Joined By Link');           // origin 'join'
  const p2 = ((await c.admin.get(`${c.base}/members`)).json.members || []).find(m => m.name === 'Joined By Link');
  await c.admin.post(`${c.base}/members/${p2.memberRef}/approve`, { requestNo: p2.requestNo });
  await c.admin.stepUp();
  await c.admin.post(`${c.base}/members/${p2.memberRef}/role`, { role: 'coach' });
  await viaLink.stepUp();
  const refused = await up(viaLink, c, team('g2', { players: [P('50202', 'Zweite Spielerin')] }));
  ok('a coach still in the session they got from a link cannot', refused.status === 403 && refused.json.error === 'full-sign-in-required');
  await viaLink.login();
  await viaLink.stepUp();
  ok('…and can as soon as they sign in as themselves', (await up(viaLink, c, team('g2', { players: [P('50202', 'Zweite Spielerin')] }))).status === 200);
  db.prepare("UPDATE sessions SET origin = 'legacy' WHERE user_id = ?").run(db.prepare('SELECT id FROM users WHERE display_name = ?').get('Invited Coach').id);
  ok('a session from before this existed is treated as unknown, and fails closed', (await up(joined, c, team('g3', { players: [] }))).status === 403);
});

await section('[13] Caps, and a flood', async () => {
  const c = await club('Delta WPC');
  await c.coach.stepUp();
  const big = team('d1', { players: Array.from({ length: TEAMSYNC.LIMITS.playersPerTeam + 1 }, (_, i) => P(String(51000 + i), 'Player ' + i)) });
  ok('a team larger than any real squad is refused before it is stored', (await up(c.coach, c, big)).json.error === 'too-many-players');
  ok('…by the shared module, so the app can say so before it sends them', TEAMSYNC.sanitizeTeam(big).error === 'too-many-players');
  const many = [];
  for (let i = 0; i < 8; i++) many.push(await up(c.coach, c, team('d' + i, { name: 'Team ' + i, players: [] })));
  ok('ordinary repeated syncing is not a flood', many.every(r => r.status === 200));
  db.prepare("UPDATE rate_limits SET count = ? WHERE key LIKE ?").run(TEAMSYNC.LIMITS.syncsPerHour, `teams-sync:${c.clubId}:%`);
  const flooded = await up(c.coach, c, team('dz', { name: 'One more', players: [] }));
  ok('a device stuck in a retry loop is told to wait, not served', flooded.status === 429 && !!flooded.headers['retry-after']);
});

await section('[14] Accounts off, and the shape of the module', async () => {
  ok('the categories the two sides agree on are the ones a coach can pick', TEAMSYNC.CATEGORIES.includes('U14') && TEAMSYNC.CATEGORIES.includes('CUSTOM') && TEAMSYNC.CATEGORIES.length === 17);
  ok('a category nobody has heard of is refused', TEAMSYNC.sanitizeTeam(team('x', { category: 'U13' })).error === 'bad-category');
  ok('a season outside a lifetime is refused', TEAMSYNC.sanitizeTeam(team('x', { season: 1899 })).error === 'bad-season');
  ok('a name of control characters is not a name', TEAMSYNC.sanitizeTeam(team('x', { name: '\u0000\u202e' })).error === 'bad-team');
  ok('…and a bidi override inside one is stripped rather than printed', TEAMSYNC.sanitizePlayer(P('50301', 'Nora\u202eMuster')).value.name === 'NoraMuster');
  ok('a manifest for a different team is not a confirmation', !TEAMSYNC.manifestOk({ localId: 't1', players: [] }, { team: { localId: 't2', id: 'ct_x' }, players: [] }));
  ok('…nor is one that quietly dropped a player', !TEAMSYNC.manifestOk({ localId: 't1', players: [{ licence: '50101' }, { licence: '50102' }] }, { team: { localId: 't1', id: 'ct_x' }, players: [{ licence: '50101', id: 'cp_1' }] }));
});

S.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
