/* Accounts foundation — configuration, migrations, transactions, codes, the last-admin rule,
   and the operator CLI. Real SQLite files in a temp dir; the CLI runs as a real child process.
   Run:  node tests/identity.mjs */
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'server');
const { loadConfig, assertConfig } = require('../server/config.js');
const DB = require('../server/db.js');
const ID = require('../server/identity.js');
const LEGACY = require('../server/legacy.js');
const DEMO = require('../server/demo.js');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code || new RegExp(code).test(e.message); } };
// a section that crashes is reported as a failure and the rest still runs
function section(title, fn) {
  console.log('\n' + title);
  try { fn(); } catch (e) { fail++; console.log('  ✗ FAIL: section threw —', e && e.message); }
}
const tmp = () => mkdtempSync(join(tmpdir(), 'thp-id-'));
const T0 = Date.UTC(2026, 8, 15, 8, 0, 0);
const H = 3600e3;

section('[1] Configuration — refuse to start rather than weaken sign-in', () => {
  const off = loadConfig({});
  ok('accounts are off by default, with nothing to complain about', off.accounts === false && off.problems.length === 0);
  const dev = assertConfig({ ACCOUNTS: '1', DEV: '1', RP_ID: 'localhost', APP_ORIGINS: 'http://localhost:8088' });
  ok('local development: http://localhost with DEV=1 → plain "thp" cookie', dev.cookieSecure === false && dev.cookieName === 'thp' && dev.origins[0] === 'http://localhost:8088');
  const prod = assertConfig({ ACCOUNTS: '1', RP_ID: 'triibholz.example.ch', APP_ORIGINS: 'https://triibholz.example.ch, https://app.triibholz.example.ch/' });
  ok('production: https origins on the RP_ID → Secure __Host- cookie', prod.cookieSecure && prod.cookieName === '__Host-thp' && prod.origins.length === 2 && prod.origins[1] === 'https://app.triibholz.example.ch');
  const bad = (env, re, name) => { const c = loadConfig({ ACCOUNTS: '1', ...env }); ok(name, c.problems.some(p => re.test(p))); };
  bad({ APP_ORIGINS: 'https://a.example.ch' }, /RP_ID is required/, 'no RP_ID → refused');
  bad({ RP_ID: 'example.ch' }, /APP_ORIGINS is required/, 'no APP_ORIGINS → refused');
  bad({ RP_ID: 'localhost', APP_ORIGINS: 'http://localhost:8088' }, /DEV=1/, 'http without DEV=1 → refused');
  bad({ RP_ID: 'example.ch', DEV: '1', APP_ORIGINS: 'https://example.ch' }, /DEV=1 is only allowed/, 'DEV=1 on a real domain → refused');
  bad({ RP_ID: 'example.ch', APP_ORIGINS: 'http://example.ch' }, /must use https/, 'http on a real domain → refused');
  bad({ RP_ID: 'example.ch', APP_ORIGINS: 'https://evil.ch' }, /not on RP_ID/, 'an origin outside RP_ID → refused');
  bad({ RP_ID: 'example.ch', APP_ORIGINS: 'https://notexample.ch' }, /not on RP_ID/, 'a look-alike suffix ("notexample.ch") is not under example.ch');
  bad({ RP_ID: 'example.ch', APP_ORIGINS: 'https://example.ch/app' }, /origin only/, 'an origin with a path → refused');
  bad({ RP_ID: '192.168.1.4', APP_ORIGINS: 'https://192.168.1.4' }, /IP address/, 'an IP address as RP_ID → refused');
  bad({ RP_ID: 'https://example.ch', APP_ORIGINS: 'https://example.ch' }, /not a lowercase host name/, 'RP_ID with a scheme → refused');
  bad({ RP_ID: 'ch', APP_ORIGINS: 'https://ch' }, /full domain/, 'a bare TLD as RP_ID → refused');
  bad({ RP_ID: 'localhost', DEV: '1', APP_ORIGINS: 'http://localhost:8088,https://localhost:8443' }, /mixes http and https/, 'http and https in one deployment → refused');
  const many = loadConfig({ ACCOUNTS: '1', RP_ID: 'example.ch', APP_ORIGINS: 'http://example.ch/x,https://evil.ch' });
  ok('every problem is reported at once, not one per restart', many.problems.length >= 2);
  ok('assertConfig throws with code bad-config', throwsCode(() => assertConfig({ ACCOUNTS: '1' }), 'bad-config'));
});

section('[2] Migrations — once, atomically, and never under an older build', () => {
  const dir = tmp(), file = join(dir, 'a.db');
  const db1 = DB.open(file, { now: T0 });
  const tables = db1.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(r => r.name);
  ok('identity tables exist', ['audit', 'challenges', 'club_members', 'clubs', 'credentials', 'link_codes', 'sessions', 'users'].every(t => tables.includes(t)));
  ok('foreign keys are enforced', db1.prepare('PRAGMA foreign_keys').get().foreign_keys === 1);
  ok('WAL journal on a file database', db1.prepare('PRAGMA journal_mode').get().journal_mode === 'wal');
  db1.close();
  const db2 = DB.open(file);
  ok('opening again applies nothing twice', db2.prepare('SELECT count(*) AS n FROM schema_migrations').get().n === DB.MIGRATIONS.length && DB.migrate(db2).length === 0);
  db2.close();

  const NEXT = DB.MIGRATIONS[DB.MIGRATIONS.length - 1].id + 1;
  const broken = [...DB.MIGRATIONS, { id: NEXT, name: 'half-broken', sql: 'CREATE TABLE extra (x INT); CREATE TABLE users (dup INT);' }];
  let threw = false; try { DB.open(file, { migrations: broken }); } catch (e) { threw = true; }
  const db3 = DB.open(file);
  ok('a failing migration rolls back whole: no half-made table, not recorded', threw && !db3.prepare("SELECT 1 FROM sqlite_master WHERE name = 'extra'").get() && !db3.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(NEXT));
  db3.close();

  const newer = [...DB.MIGRATIONS, { id: NEXT, name: 'future', sql: 'CREATE TABLE future (x INT);' }];
  DB.open(file, { migrations: newer }).close();
  ok('a database from a newer build is refused by this one', throwsCode(() => DB.open(file), 'db-newer'));
});

section('[2b] Migration 4 on a database that already has slice-2 members', () => {
  const file = join(tmp(), 'old.db');
  const old = DB.open(file, { migrations: DB.MIGRATIONS.filter(m => m.id <= 3) });
  const u = ID.newId('u'), c = ID.newId('c');
  old.prepare('INSERT INTO users (id, display_name, webauthn_user_handle, created_at) VALUES (?, ?, ?, ?)').run(u, 'Early Admin', Buffer.alloc(32, 1), T0);
  old.prepare("INSERT INTO clubs (id, name, created_by, created_at) VALUES (?, 'Early WPC', 'operator', ?)").run(c, T0);
  old.prepare("INSERT INTO club_members (club_id, user_id, role, status, requested_at, decided_at, decided_by) VALUES (?, ?, 'admin', 'approved', ?, ?, 'operator')").run(c, u, T0, T0);
  old.close();
  const db = DB.open(file);
  const m = db.prepare('SELECT member_ref FROM club_members WHERE user_id = ?').get(u);
  ok('existing members get a random member_ref', /^m_[A-Za-z0-9_-]{22}$/.test(m.member_ref));
  ok('existing approved people are marked ever_approved (so account cleanup can never take them)', db.prepare('SELECT ever_approved FROM users WHERE id = ?').get(u).ever_approved === 1 && ID.purgeAbandonedAccounts(db, T0 + 400 * 24 * H) === 0);
  ok('a new membership row without a member_ref is refused by the database', throwsCode(() => db.prepare("INSERT INTO club_members (club_id, user_id, role, status, requested_at) VALUES (?, ?, 'player', 'pending', ?)").run(c, ID.createUser(db, { displayName: 'X' }, T0).id, T0), 'member-ref-required'));
  db.close();
});

section('[3] tx() — all or nothing, synchronous only', () => {
  const db = DB.open(':memory:');
  let rolled = false;
  try { DB.tx(db, () => { ID.createUser(db, { displayName: 'A' }, T0); throw new Error('boom'); }); } catch (e) { rolled = true; }
  ok('a throw rolls every write back', rolled && db.prepare('SELECT count(*) AS n FROM users').get().n === 0 && !db.isTransaction);
  ok('an async function is refused, and its first writes rolled back', throwsCode(() => DB.tx(db, async () => { ID.createUser(db, { displayName: 'B' }, T0); }), 'tx-async') && db.prepare('SELECT count(*) AS n FROM users').get().n === 0 && !db.isTransaction);
  DB.tx(db, () => {
    ID.createUser(db, { displayName: 'Outer' }, T0);
    try { DB.tx(db, () => { ID.createUser(db, { displayName: 'Inner' }, T0); throw new Error('inner'); }); } catch (e) {}
  });
  const names = db.prepare('SELECT display_name FROM users').all().map(r => r.display_name);
  ok('a failing nested tx rolls back only itself', names.length === 1 && names[0] === 'Outer');
  db.close();
});

section('[4] Users and clubs — random ids, handles, and the schema’s own checks', () => {
  const db = DB.open(':memory:');
  const a = ID.createUser(db, { displayName: 'Sam Beispiel' }, T0), b = ID.createUser(db, { displayName: 'Sam Beispiel' }, T0);
  ok('ids are 128-bit random, not clock-based', /^u_[A-Za-z0-9_-]{22}$/.test(a.id) && a.id !== b.id);
  ok('the WebAuthn user handle is 32 random bytes, distinct per user', a.handle.length === 32 && !a.handle.equals(b.handle));
  ok('…and carries nothing of the user id (authenticators may show or sync it)', ![a, b].some(u => u.handle.includes(Buffer.from(u.id)) || u.handle.includes(Buffer.from(u.id.slice(2, 8)))));
  ok('a handle that is not 32 bytes is rejected by the database', throwsCode(() => db.prepare('INSERT INTO users (id, display_name, webauthn_user_handle, created_at) VALUES (?, ?, ?, ?)').run('u_x', 'X', Buffer.alloc(16), T0), 'CHECK'));
  ok('an empty or 81-character name is refused', throwsCode(() => ID.createUser(db, { displayName: '  ' }, T0), 'bad-name') && throwsCode(() => ID.createUser(db, { displayName: 'x'.repeat(81) }, T0), 'bad-name'));
  const c = ID.createClub(db, { name: 'Test WPC', actor: 'operator' }, T0);
  ok('a club is created with a random id and audited', /^c_/.test(c) && db.prepare("SELECT count(*) AS n FROM audit WHERE action = 'club.create' AND subject = ?").get(c).n === 1);
  ok('an unknown role is refused in code', throwsCode(() => ID.addMember(db, { clubId: c, userId: a.id, role: 'owner', status: 'approved', actor: 'operator' }, T0), 'bad-role'));
  ok('…and by the database', throwsCode(() => db.prepare("INSERT INTO club_members (club_id, user_id, role, status, requested_at, member_ref) VALUES (?, ?, 'owner', 'approved', ?, 'm_x')").run(c, a.id, T0), 'CHECK'));
  ok('a membership needs a real club and user', throwsCode(() => ID.addMember(db, { clubId: 'c_nope', userId: a.id, role: 'player', status: 'pending', actor: 'operator' }, T0), 'no-club'));
  ID.addMember(db, { clubId: c, userId: a.id, role: 'coach', status: 'approved', actor: 'operator' }, T0);
  const c2 = ID.createClub(db, { name: 'Other WPC', actor: 'operator' }, T0);
  ID.addMember(db, { clubId: c2, userId: a.id, role: 'player', status: 'approved', actor: 'operator' }, T0);
  ok('one person can coach in one club and play in another', ID.getMember(db, c, a.id).role === 'coach' && ID.getMember(db, c2, a.id).role === 'player');
  const auditText = JSON.stringify(db.prepare('SELECT * FROM audit').all());
  ok('the audit log holds ids, never names', !/Sam Beispiel|Test WPC|Other WPC/.test(auditText));
  db.close();
});

section('[5] Single-use codes', () => {
  const dir = tmp(), file = join(dir, 'codes.db');
  const db = DB.open(file);
  const c = ID.createClub(db, { name: 'Code WPC', actor: 'operator' }, T0);
  const inv = ID.issueCode(db, { kind: 'club-admin', clubId: c, role: 'admin', actor: 'operator' }, T0);
  ok('26 Crockford base32 characters, grouped in fives', /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}-[0-9A-HJKMNP-TV-Z]$/.test(inv.code));
  ok('expires after 24 h for a club-admin invite', inv.expiresAt === T0 + 24 * H);
  const codes = new Set(Array.from({ length: 200 }, () => ID.makeCode().code));
  ok('200 codes, 200 different', codes.size === 200);
  const raw = inv.code.replace(/-/g, '');
  ok('only a hash is stored — the code is nowhere in the database file', (() => { db.exec('PRAGMA wal_checkpoint(FULL)'); const bytes = readdirSync(dir).map(f => readFileSync(join(dir, f)).toString('latin1')).join(''); return !bytes.includes(raw) && !bytes.includes(inv.code); })());
  ok('the wrong kind does not consume it', ID.consumeCode(db, { code: inv.code, kind: 'recover' }, T0 + 1) === null);
  const typed = raw.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l').match(/.{1,4}/g).join(' ');
  const row = ID.consumeCode(db, { code: typed, kind: 'club-admin', usedBy: 'u_someone' }, T0 + 2);
  ok('typed in lower case, with spaces, O for 0 and l for 1 — still accepted', row && row.club_id === c && row.role === 'admin');
  ok('a second use returns nothing', ID.consumeCode(db, { code: inv.code, kind: 'club-admin' }, T0 + 3) === null);
  const late = ID.issueCode(db, { kind: 'pair', userId: ID.createUser(db, { displayName: 'P' }, T0).id, actor: 'operator' }, T0);
  ok('a pairing code lives 10 minutes', late.expiresAt === T0 + 10 * 60e3);
  ok('an expired code returns nothing', ID.consumeCode(db, { code: late.code, kind: 'pair' }, T0 + 10 * 60e3) === null);
  const rv = ID.issueCode(db, { kind: 'club-admin', clubId: c, role: 'admin', actor: 'operator' }, T0);
  ok('revoking a club’s codes counts them', ID.revokeCodes(db, { clubId: c, actor: 'operator' }, T0 + 5) === 1);
  ok('a revoked code returns nothing', ID.consumeCode(db, { code: rv.code, kind: 'club-admin' }, T0 + 6) === null);
  ok('revoking everything at once is refused', throwsCode(() => ID.revokeCodes(db, { actor: 'operator' }, T0), 'too-broad'));
  ok('garbage and near-misses are simply not codes', ID.consumeCode(db, { code: 'hello', kind: 'club-admin' }, T0) === null && ID.consumeCode(db, { code: raw.slice(0, 25), kind: 'club-admin' }, T0) === null && ID.normalizeCode(raw.slice(0, 25) + 'U') === '');

  // two connections racing for one code: exactly one wins
  const race = ID.issueCode(db, { kind: 'club-admin', clubId: c, role: 'admin', actor: 'operator' }, T0);
  const other = DB.open(file);
  const wins = [ID.consumeCode(db, { code: race.code, kind: 'club-admin', usedBy: 'u_a' }, T0 + 7), ID.consumeCode(other, { code: race.code, kind: 'club-admin', usedBy: 'u_b' }, T0 + 7)].filter(Boolean);
  ok('two connections claiming one code: exactly one wins', wins.length === 1);
  // a claim inside a transaction that later fails gives the code back
  const back = ID.issueCode(db, { kind: 'club-admin', clubId: c, role: 'admin', actor: 'operator' }, T0);
  try { DB.tx(db, () => { if (!ID.consumeCode(db, { code: back.code, kind: 'club-admin' }, T0 + 8)) throw new Error('x'); throw new Error('granting failed'); }); } catch (e) {}
  ok('if what the code grants fails, the code is not used up', !!ID.consumeCode(db, { code: back.code, kind: 'club-admin' }, T0 + 9));
  other.close(); db.close();
});

section('[6] A club always keeps an approved admin', () => {
  const db = DB.open(':memory:');
  const c = ID.createClub(db, { name: 'Admin WPC', actor: 'operator' }, T0);
  const a = ID.createUser(db, { displayName: 'A' }, T0).id, b = ID.createUser(db, { displayName: 'B' }, T0).id, p = ID.createUser(db, { displayName: 'P' }, T0).id;
  ID.addMember(db, { clubId: c, userId: a, role: 'admin', status: 'approved', actor: 'operator' }, T0);
  ok('the only admin cannot be demoted', throwsCode(() => ID.updateMember(db, { clubId: c, userId: a, role: 'coach', actor: a }, T0), 'last-admin'));
  ok('…or removed', throwsCode(() => ID.updateMember(db, { clubId: c, userId: a, status: 'removed', actor: a }, T0), 'last-admin'));
  ok('…or deleted with their account', throwsCode(() => ID.deleteUser(db, { userId: a, actor: a }, T0), 'last-admin') && !!ID.getUser(db, a));
  ok('…not even by raw SQL', throwsCode(() => db.prepare('DELETE FROM club_members WHERE user_id = ?').run(a), 'last-admin'));
  ID.addMember(db, { clubId: c, userId: b, role: 'admin', status: 'pending', actor: a }, T0);
  ok('a pending admin does not count as the second one', throwsCode(() => ID.updateMember(db, { clubId: c, userId: a, role: 'coach', actor: a }, T0), 'last-admin'));
  ID.updateMember(db, { clubId: c, userId: b, status: 'approved', actor: a }, T0);
  ID.updateMember(db, { clubId: c, userId: a, role: 'coach', actor: b }, T0);
  ok('with a second approved admin, the first can step down', ID.getMember(db, c, a).role === 'coach');
  ok('…and now the second is protected in turn', throwsCode(() => ID.updateMember(db, { clubId: c, userId: b, status: 'removed', actor: b }, T0), 'last-admin'));
  ID.addMember(db, { clubId: c, userId: p, role: 'player', status: 'approved', actor: b }, T0);
  ID.deleteUser(db, { userId: p, actor: p }, T0);
  ok('anyone else can delete their account; memberships go with it', !ID.getUser(db, p) && !ID.getMember(db, c, p));
  ok('each change is audited with before and after', JSON.parse(db.prepare("SELECT detail FROM audit WHERE action = 'member.update' AND subject = ? ORDER BY id DESC").get(a).detail).from.role === 'admin');
  db.close();
});

section('[7] Sessions and housekeeping', () => {
  const db = DB.open(':memory:');
  const u = ID.createUser(db, { displayName: 'S' }, T0).id;
  const addSession = (hash, exp, abs) => db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, absolute_expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(hash, u, T0, T0, exp, abs);
  addSession('h1', T0 + H, T0 + 10 * H); addSession('h2', T0 + H, T0 + 10 * H);
  ok('end-sessions signs a person out everywhere', ID.endSessions(db, { userId: u, actor: 'operator' }, T0) === 2 && db.prepare('SELECT count(*) AS n FROM sessions').get().n === 0);
  addSession('h3', T0 + H, T0 + 10 * H); addSession('h4', T0 + 20 * H, T0 + 5 * H);
  db.prepare("INSERT INTO challenges (id, kind, challenge, created_at, expires_at) VALUES ('ch1', 'login', 'x', ?, ?)").run(T0, T0 + 300e3);
  const r = ID.purgeExpired(db, T0 + 6 * H);
  ok('purge removes expired sessions (sliding or absolute) and challenges', r.sessions === 2 && r.challenges === 1);
  db.close();
});

section('[8] Operator CLI — a real process against a real file', () => {
  const dir = tmp();
  const env = { ...process.env, DATA_DIR: dir, ACCOUNTS: '1', RP_ID: 'localhost', DEV: '1', APP_ORIGINS: 'http://localhost:8088', NODE_NO_WARNINGS: '1' };
  const cli = (...args) => { const r = spawnSync(process.execPath, [join(SERVER, 'admin.js'), ...args], { env, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  const help = cli('help');
  ok('help lists the commands', help.code === 0 && /create-club/.test(help.out) && /end-sessions/.test(help.out));
  const created = cli('create-club', 'SC', 'Test', 'Club');
  const clubId = (created.out.match(/club created: (c_[\w-]+)/) || [])[1];
  ok('create-club prints the new id', created.code === 0 && !!clubId);
  const inv = cli('club-admin-invite', clubId);
  const code = (inv.out.match(/\b([0-9A-Z]{5}(?:-[0-9A-Z]{5}){4}-[0-9A-Z])\b/) || [])[1];
  ok('club-admin-invite prints a code and a #fragment link (never a ?query)', inv.code === 0 && !!code && inv.out.includes('http://localhost:8088/#invite=' + code.replace(/-/g, '')));
  ok('an invite for a club that does not exist fails with exit 1', cli('club-admin-invite', 'c_nope').code === 1);
  ok('a missing argument shows usage with exit 2', cli('recover').code === 2);
  ok('an unknown command exits 2', cli('drop-everything').code === 2);
  ok('recover for an unknown person fails', cli('recover', 'u_nope').code === 1);
  const clubs = cli('clubs');
  ok('clubs shows the club has no admin yet', /SC Test Club/.test(clubs.out) && /no admin yet/.test(clubs.out));
  const db = DB.open(join(dir, 'triibholz.db'));
  const row = ID.consumeCode(db, { code, kind: 'club-admin' }, Date.now());
  ok('the printed code is a working single-use club-admin code for that club', row && row.club_id === clubId && row.role === 'admin' && !ID.consumeCode(db, { code, kind: 'club-admin' }, Date.now()));
  ok('every command left an operator audit row', db.prepare("SELECT count(*) AS n FROM audit WHERE actor = 'operator'").get().n >= 2);
  db.close();
  const bad = spawnSync(process.execPath, [join(SERVER, 'admin.js'), 'clubs'], { env: { ...env, DATA_DIR: tmp() }, encoding: 'utf8' });
  ok('a fresh data directory is initialised, not an error', bad.status === 0 && /no clubs yet/.test(bad.stdout));
});

section('[8b] What was on the volume before accounts: see it, adopt it, or delete it', () => {
  const dir = tmp();
  const env = { ...process.env, DATA_DIR: dir, ACCOUNTS: '1', RP_ID: 'localhost', DEV: '1', APP_ORIGINS: 'http://localhost:8088', NODE_NO_WARNINGS: '1' };
  const cli = (...args) => { const r = spawnSync(process.execPath, [join(SERVER, 'admin.js'), ...args], { env, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  const put = (kind, file, body) => { mkdirSync(join(dir, kind), { recursive: true }); writeFileSync(join(dir, kind, file), body); };

  // a season's worth of data written by the old, unauthenticated server
  put('announcements', 'a1.json', JSON.stringify({ id: 'a1', team: 'club', scope: 'player', to: 'nora@icloud.com', title: 'Old note', body: 'x', readBy: [] }));
  put('debriefs', 'd1.json', JSON.stringify({ id: 'd1', team: 'club', title: 'Old review', items: [], comments: [] }));
  put('videos', 'v1.mp4', Buffer.alloc(4096, 1));
  put('clips', 'c1.mp4', Buffer.alloc(512, 2));
  put('jobs', 'j1.json', JSON.stringify({ id: 'j1', state: 'done' }));
  put('calendars', 'TRII2026.json', JSON.stringify({ name: 'Season', events: [] }));
  put('debriefs', 'broken.json', '{ not json');

  const seen = cli('legacy');
  ok('legacy lists every kind that belongs to nobody, with sizes', seen.code === 0 && /announcements/.test(seen.out) && /videos/.test(seen.out) && /4\.0 kB|4096|4 kB/.test(seen.out));
  ok('…including a file it cannot even read', /broken\.json/.test(seen.out) && /unreadable/.test(seen.out));
  ok('…and says a client-made calendar token cannot be adopted', /calendars/.test(seen.out) && /cannot be adopted/.test(seen.out));

  const clubId = (cli('create-club', 'Adopting WPC').out.match(/club created: (c_[\w-]+)/) || [])[1];
  ok('adopting into a club that does not exist fails, and changes nothing', cli('adopt', 'c_nope').code === 1 && !JSON.parse(readFileSync(join(dir, 'announcements', 'a1.json'), 'utf8')).clubId);
  const dry = cli('forget');
  ok('forget without --yes deletes nothing and says so', dry.code === 0 && /nothing was deleted/.test(dry.out) && readdirSync(join(dir, 'videos')).length === 1);

  const done = cli('adopt', clubId);
  ok('adopt gives the club its records and its files', done.code === 0 && /"videos":1/.test(done.out) && /"announcements":1/.test(done.out));
  const db2 = DB.open(join(dir, 'triibholz.db'));
  ok('…records carry the club id now', JSON.parse(readFileSync(join(dir, 'announcements', 'a1.json'), 'utf8')).clubId === clubId);
  ok('…files get an assets row owned by the club and by no person', (() => {
    const a = db2.prepare("SELECT * FROM assets WHERE id = 'v1.mp4'").get();
    return a && a.club_id === clubId && a.owner_user_id === null && a.kind === 'video';
  })());
  ok('…a note addressed to an e-mail keeps it: nobody guesses which member that was', JSON.parse(readFileSync(join(dir, 'announcements', 'a1.json'), 'utf8')).to === 'nora@icloud.com');
  ok('…the calendar was left alone, and the operator is told why', /left alone on purpose/.test(done.out) && existsSync(join(dir, 'calendars', 'TRII2026.json')));
  ok('…and it was written to the audit as the operator', db2.prepare("SELECT count(*) AS n FROM audit WHERE action = 'legacy.adopt'").get().n === 1);
  ok('adopting twice is not a second copy', /"videos":0/.test(cli('adopt', clubId).out) && db2.prepare("SELECT count(*) AS n FROM assets WHERE id = 'v1.mp4'").get().n === 1);
  ok('what was adopted is no longer ownerless', /calendars/.test(cli('legacy').out) && !/videos/.test(cli('legacy').out));
  const noAdopt = cli('adopt', clubId, 'calendars');
  ok('a kind that cannot be adopted is refused by name, not silently skipped', noAdopt.code === 2 && /cannot adopt: calendars/.test(noAdopt.err));

  const gone = cli('forget', '--yes', 'calendars');
  ok('forget --yes deletes only the kind it was given', gone.code === 0 && !existsSync(join(dir, 'calendars', 'TRII2026.json')) && existsSync(join(dir, 'videos', 'v1.mp4')));
  // the unreadable file is the one thing adoption will not touch: it cannot be given a club id,
  // so it stays listed until an operator deletes it on purpose
  const after = cli('legacy');
  ok('…and the file nobody can read is still listed, because adoption would not touch it', /broken\.json/.test(after.out) && !/videos/.test(after.out));
  cli('forget', '--yes', 'debriefs');
  ok('deleting it is the only way it goes, and then the volume is clean', /nothing ownerless/.test(cli('legacy').out) && !existsSync(join(dir, 'debriefs', 'broken.json')) && existsSync(join(dir, 'debriefs', 'd1.json')));
  ok('a made-up kind is refused', cli('forget', '--yes', 'everything').code === 2);
  /* a feed the server itself issued is live: a calendar app is subscribed to it. It is named for
     the hash of its token and has a row, and none of this may touch it. */
  const feedToken = 'aRealServerIssuedFeedToken';
  const feedHash = createHash('sha256').update(feedToken).digest('hex');
  const userId = ID.createUser(db2, { displayName: 'Ada Admin' }, Date.now()).id;
  db2.prepare('INSERT INTO calendar_feeds (token_hash, club_id, label, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(feedHash, clubId, 'Season', userId, Date.now());
  put('calendars', feedHash.slice(0, 32) + '.json', JSON.stringify({ name: 'Season', events: [] }));
  ok('a feed the server issued is not ownerless — it is somebody’s live subscription', !/[0-9a-f]{32}/.test(cli('legacy').out));
  cli('forget', '--yes');
  ok('…so deleting everything ownerless leaves it alone', existsSync(join(dir, 'calendars', feedHash.slice(0, 32) + '.json')));


  // called directly, not through the CLI: adopt must refuse a club that does not exist rather than
  // writing a dangling club id into somebody's records
  put('debriefs', 'd2.json', JSON.stringify({ id: 'd2', team: 'club', items: [] }));
  ok('adopt() itself refuses an unknown club, and writes nothing', (() => {
    let threw = false;
    try { LEGACY.adopt(db2, dir, { clubId: 'c_doesnotexist' }); } catch (e) { threw = e.code === 'not-found'; }
    return threw && !JSON.parse(readFileSync(join(dir, 'debriefs', 'd2.json'), 'utf8')).clubId;
  })());
  db2.close();
});

section('[8c] A sandbox club to look at — with no way in of its own', () => {
  const dir = tmp();
  const env = { ...process.env, DATA_DIR: dir, ACCOUNTS: '1', RP_ID: 'localhost', DEV: '1', APP_ORIGINS: 'http://localhost:8088', NODE_NO_WARNINGS: '1' };
  const cli = (...args) => { const r = spawnSync(process.execPath, [join(SERVER, 'admin.js'), ...args], { env, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };

  const made = cli('demo');
  const clubId = (made.out.match(/sandbox club created: (c_[\w-]+)/) || [])[1];
  const code = (made.out.match(/\b([0-9A-Z]{5}(?:-[0-9A-Z]{5}){4}-[0-9A-Z])\b/) || [])[1];
  ok('demo makes a club, an invented squad and something to read', made.code === 0 && !!clubId && /8 invented members/.test(made.out));
  const db3 = DB.open(join(dir, 'triibholz.db'));
  ok('…everyone in it is marked as invented, so nobody mistakes them for a player', db3.prepare('SELECT display_name FROM users').all().every(u => /\(demo\)$/.test(u.display_name)));
  ok('…and not one of them has a passkey: the squad is not a way in', db3.prepare('SELECT count(*) AS n FROM credentials').get().n === 0);
  ok('…the club is named so it cannot be confused with a real one', /\(demo\)/.test(ID.getClub(db3, clubId).name));
  ok('…a real person becomes its admin with their own passkey, through an ordinary invite', !!code && (() => {
    const row = ID.consumeCode(db3, { code, kind: 'club-admin' }, Date.now());
    return row && row.club_id === clubId && row.role === 'admin';
  })());
  ok('…its note and its review belong to that club, like any other record', (() => {
    const a = JSON.parse(readFileSync(join(dir, 'announcements', readdirSync(join(dir, 'announcements'))[0]), 'utf8'));
    return a.clubId === clubId && a.scope === 'team';
  })());
  ok('…and it is not ownerless data: nothing for the operator to adopt', !/announcements/.test(cli('legacy').out));

  // somebody who signed in for real, and somebody who is also in another club
  const realUser = ID.createUser(db3, { displayName: 'Real Person' }, Date.now()).id;
  ID.addMember(db3, { clubId, userId: realUser, role: 'player', status: 'approved', actor: 'operator', action: 'member.add' }, Date.now());
  db3.prepare("INSERT INTO credentials (id, user_id, public_key_jwk, alg, created_at) VALUES ('cred1', ?, '{}', -7, ?)").run(realUser, Date.now());
  const otherClub = ID.createClub(db3, { name: 'Real WPC', actor: 'operator' }, Date.now());
  const shared = ID.createUser(db3, { displayName: 'Two Clubs' }, Date.now()).id;
  ID.addMember(db3, { clubId, userId: shared, role: 'player', status: 'approved', actor: 'operator', action: 'member.add' }, Date.now());
  ID.addMember(db3, { clubId: otherClub, userId: shared, role: 'player', status: 'approved', actor: 'operator', action: 'member.add' }, Date.now());
  db3.close();

  const gone = cli('demo-remove', clubId);
  ok('demo-remove takes the club and its records with it', gone.code === 0 && !readdirSync(join(dir, 'announcements')).length && !readdirSync(join(dir, 'debriefs')).length);
  const db4 = DB.open(join(dir, 'triibholz.db'));
  ok('…and the invented people', !ID.getClub(db4, clubId) && db4.prepare("SELECT count(*) AS n FROM users WHERE display_name LIKE '%(demo)'").get().n === 0);
  ok('…but never someone who had signed in for real', !!ID.getUser(db4, realUser));
  ok('…nor someone who belongs to another club too', !!ID.getUser(db4, shared) && !!db4.prepare('SELECT 1 FROM club_members WHERE user_id = ? AND club_id = ?').get(shared, otherClub));
  ok('removing a club that is not there fails, rather than deleting something else', cli('demo-remove', 'c_nope').code === 1 && !!ID.getClub(db4, otherClub));
  // called directly, not through the CLI: remove() must refuse an unknown club rather than sweep
  // every record and person that happens to match nothing
  ok('remove() itself refuses an unknown club, and touches nobody', (() => {
    const before = db4.prepare('SELECT count(*) AS n FROM users').get().n;
    let threw = false;
    try { DEMO.remove(db4, dir, { clubId: 'c_doesnotexist' }); } catch (e) { threw = e.code === 'not-found'; }
    return threw && db4.prepare('SELECT count(*) AS n FROM users').get().n === before;
  })());
  db4.close();
});

section('[9] Server startup', () => {
  const run = (env) => spawnSync(process.execPath, ['-e', `require(${JSON.stringify(join(SERVER, 'index.js'))})`], { env: { ...process.env, NODE_NO_WARNINGS: '1', DATA_DIR: tmp(), ...env }, encoding: 'utf8', timeout: 20000 });
  const off = run({ ACCOUNTS: '' });
  ok('accounts off: the server module loads as before', off.status === 0);
  const refused = spawnSync(process.execPath, [join(SERVER, 'index.js')], { env: { ...process.env, NODE_NO_WARNINGS: '1', DATA_DIR: tmp(), PORT: '4399', ACCOUNTS: '1', RP_ID: 'localhost', APP_ORIGINS: 'http://localhost:8088' }, encoding: 'utf8', timeout: 20000 });
  ok('a refused configuration stops the server before it listens, saying why', refused.status === 1 && /not starting/.test(refused.stderr) && /DEV=1/.test(refused.stderr));
});

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
