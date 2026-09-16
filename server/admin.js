#!/usr/bin/env node
/* ============================================================
   server/admin.js — the operator's command line.

   The only way to create a club, to give a new club its first admin, and
   the break-glass when a club is stuck (its only admin lost their passkey,
   a person must be signed out everywhere). There is no web bootstrap: a
   person who can run this already controls the server.

     docker exec triibholz-analysis node admin.js <command> [args]

   Every command writes an audit row with actor "operator". Codes are
   printed once and stored only as a hash — lost means issue a new one.
   ============================================================ */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const DB = require('./db.js');
const ID = require('./identity.js');
const { loadConfig } = require('./config.js');
const LEGACY = require('./legacy.js');

const mb = n => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

const HELP = `Triibholz operator commands

  create-club "<name>"             create a club; prints its id
  club-admin-invite <club-id>      single-use code (24 h) that makes its redeemer an admin of the club
  recover <user-id>                single-use recovery code (24 h) for one person
  end-sessions <user-id>           sign a person out on every device
  revoke-codes <user-id|club-id>   cancel every unused code for a person or a club
  clubs                            list clubs with member and admin counts
  members <club-id>                list a club's members (id, role, status)
  purge                            expire old requests; delete expired challenges, sessions, old codes and abandoned accounts

  legacy                           what was on the volume before accounts and now belongs to nobody
  adopt <club-id> [kind…]          give that to one club (default: everything but calendars)
  forget --yes [kind…]             delete it, permanently

  Database: $DATA_DIR/triibholz.db (DATA_DIR=${process.env.DATA_DIR || '(unset → server/data)'})`;

function main(argv, { now = Date.now(), out = console.log, err = console.error, env = process.env } = {}) {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { out(HELP); return cmd ? 0 : 1; }
  const dataDir = env.DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = DB.open(path.join(dataDir, 'triibholz.db'));
  const cfg = loadConfig(env);
  const link = (fragment, code) => cfg.origins[0] ? `${cfg.origins[0]}/#${fragment}=${code.replace(/-/g, '')}` : null;
  const need = (v, what) => { if (!v) throw Object.assign(new Error(`missing ${what}`), { code: 'usage' }); return v; };
  try {
    switch (cmd) {
      case 'create-club': {
        const id = ID.createClub(db, { name: need(args.join(' ').trim(), 'club name'), actor: 'operator' }, now);
        out(`club created: ${id}\nnext: node admin.js club-admin-invite ${id}`);
        return 0;
      }
      case 'club-admin-invite': {
        const clubId = need(args[0], 'club id');
        const club = ID.getClub(db, clubId); if (!club) throw Object.assign(new Error(`no club ${clubId}`), { code: 'not-found' });
        const { code, expiresAt } = ID.issueCode(db, { kind: 'club-admin', clubId, role: 'admin', actor: 'operator' }, now);
        out(`admin invite for "${club.name}" — single use, valid until ${new Date(expiresAt).toISOString()}\n\n  ${code}\n`);
        const url = link('invite', code); if (url) out(`  ${url}\n`);
        out('Give it to that person only, in person or over a channel you trust.');
        return 0;
      }
      case 'recover': {
        const userId = need(args[0], 'user id');
        if (!ID.getUser(db, userId)) throw Object.assign(new Error(`no user ${userId}`), { code: 'not-found' });
        const { code, expiresAt } = ID.issueCode(db, { kind: 'recover', userId, actor: 'operator' }, now);
        out(`recovery code — single use, valid until ${new Date(expiresAt).toISOString()}\n\n  ${code}\n`);
        const url = link('recover', code); if (url) out(`  ${url}\n`);
        out('Check who you are talking to before handing this over: it adds a passkey to their account.');
        return 0;
      }
      case 'end-sessions': {
        const n = ID.endSessions(db, { userId: need(args[0], 'user id'), actor: 'operator' }, now);
        out(`ended ${n} session(s)`);
        return 0;
      }
      case 'revoke-codes': {
        const id = need(args[0], 'user or club id');
        const n = ID.revokeCodes(db, { [id.startsWith('c_') ? 'clubId' : 'userId']: id, actor: 'operator' }, now);
        out(`revoked ${n} code(s)`);
        return 0;
      }
      case 'clubs': {
        const rows = ID.listClubs(db);
        if (!rows.length) out('no clubs yet — node admin.js create-club "<name>"');
        for (const c of rows) out(`${c.id}  ${c.name}  members=${c.members} admins=${c.admins}${c.admins === 0 ? '  ← no admin yet' : c.admins === 1 ? '  ← only one admin' : ''}`);
        return 0;
      }
      case 'members': {
        const clubId = need(args[0], 'club id');
        if (!ID.getClub(db, clubId)) throw Object.assign(new Error(`no club ${clubId}`), { code: 'not-found' });
        const rows = db.prepare('SELECT m.user_id, u.display_name, m.role, m.status FROM club_members m JOIN users u ON u.id = m.user_id WHERE m.club_id = ? ORDER BY m.status, m.role').all(clubId);
        if (!rows.length) out('no members');
        for (const m of rows) out(`${m.user_id}  ${m.role.padEnd(7)} ${m.status.padEnd(8)} ${m.display_name}`);
        return 0;
      }
      case 'purge': {
        out(JSON.stringify(ID.housekeeping(db, now)));
        return 0;
      }
      /* ---- what was here before accounts (server/legacy.js) ---- */
      case 'legacy': {
        const found = LEGACY.scan(db, dataDir), t = LEGACY.totals(found);
        if (!t.count) { out('nothing ownerless on this volume — everything belongs to a club'); return 0; }
        for (const kind of LEGACY.KINDS) {
          if (!t[kind].count) continue;
          out(`${String(t[kind].count).padStart(5)}  ${kind.padEnd(14)} ${mb(t[kind].bytes).padStart(9)}${LEGACY.ADOPTABLE.includes(kind) ? '' : '   (cannot be adopted — the token was made by a client)'}`);
          for (const r of found[kind].slice(0, 3)) out(`       ${r.file}${r.unreadable ? '  ← unreadable' : ''}`);
          if (found[kind].length > 3) out(`       …and ${found[kind].length - 3} more`);
        }
        out(`\n${t.count} item(s), ${mb(t.bytes)}. Served to nobody until a club adopts them.\n  node admin.js adopt <club-id>      give them to one club\n  node admin.js forget --yes        delete them`);
        return 0;
      }
      case 'adopt': {
        const clubId = need(args[0], 'club id');
        const kinds = args.slice(1).filter(a => !a.startsWith('-'));
        const club = ID.getClub(db, clubId); if (!club) throw Object.assign(new Error(`no club ${clubId}`), { code: 'not-found' });
        const done = LEGACY.adopt(db, dataDir, { clubId, kinds: kinds.length ? kinds : undefined, now });
        const n = Object.values(done).reduce((a, b) => a + b, 0);
        out(`${n} item(s) now belong to "${club.name}": ${JSON.stringify(done)}`);
        if (!kinds.length && LEGACY.scan(db, dataDir).calendars.length) out('\nCalendars were left alone on purpose: a pre-accounts feed link is a bearer URL made by a\nclient. Publish the calendar again from the app and hand out the new link, then: forget --yes calendars');
        return 0;
      }
      case 'forget': {
        const kinds = args.filter(a => !a.startsWith('-'));
        const found = LEGACY.scan(db, dataDir), t = LEGACY.totals(found);
        const chosen = kinds.length ? kinds : LEGACY.KINDS;
        const bad = chosen.filter(k => !LEGACY.KINDS.includes(k));
        if (bad.length) throw Object.assign(new Error(`not a kind: ${bad.join(', ')}`), { code: 'usage' });
        const n = chosen.reduce((a, k) => a + t[k].count, 0);
        if (!args.includes('--yes')) {
          out(`this would delete ${n} item(s) (${mb(chosen.reduce((a, k) => a + t[k].bytes, 0))}) for good: ${chosen.join(', ')}`);
          out('nothing was deleted. Add --yes if that is what you mean.');
          return 0;
        }
        const done = LEGACY.forget(db, dataDir, { kinds: chosen, now });
        out(`deleted ${Object.values(done).reduce((a, b) => a + b, 0)} item(s): ${JSON.stringify(done)}`);
        return 0;
      }
      default:
        err(`unknown command "${cmd}"\n\n${HELP}`);
        return 2;
    }
  } catch (e) {
    err(`error: ${e.message}${e.code === 'usage' ? `\n\n${HELP}` : ''}`);
    return e.code === 'usage' ? 2 : 1;
  } finally {
    db.close();
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main };
