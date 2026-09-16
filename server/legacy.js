/* ============================================================
   server/legacy.js — the data that was already on the volume when accounts were switched on.

   Before accounts, anyone who could reach the backend could read anything on it. Slice 4 closes
   that: a file with no owner is served to nobody, and a record with no club is in nobody's list.
   That is the safe default, but it is not an answer — a club that has been using this for a season
   would find its debriefs and videos gone, with no way to say "these are ours".

   So the operator gets three commands and nothing automatic:

     · `legacy`              what is on the volume that belongs to nobody, by kind, with sizes
     · `adopt <club-id>`     give it to one club — the only thing that can undo the quarantine
     · `forget --yes`        delete it, permanently

   Nothing here runs by itself and nothing is guessed. Adoption is an operator's assertion that a
   volume belongs to a club, which is true of every deployment this app has had (one club per
   server) and must never be inferred from the data.

   Calendars are the exception: a pre-accounts feed token was invented by a *client*, so its .ics
   is a bearer URL sitting in somebody's calendar app, subscribed to by whoever was given the link.
   Adopting it would put an unauthenticated capability URL back into service, which is exactly what
   slice 4 removed. They can be listed and forgotten, never adopted; a club re-publishes its
   calendar from the app and hands out the new link.
   ============================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ID = require('./identity.js');

const KINDS = ['announcements', 'debriefs', 'videos', 'clips', 'jobs', 'calendars'];
const ADOPTABLE = ['announcements', 'debriefs', 'videos', 'clips', 'jobs'];
const ASSET_KIND = { videos: 'video', clips: 'clip', jobs: 'job' };
const HASHED_FEED = /^[0-9a-f]{32}$/;                 // what the server names a feed file it issued

const list = dir => { try { return fs.readdirSync(dir).sort(); } catch (e) { return []; } };
const sizeOf = fp => { try { return fs.statSync(fp).size; } catch (e) { return 0; } };
const readJson = fp => { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { return null; } };

/* What belongs to nobody, kind by kind. A record is ownerless when it carries no club; a file is
   ownerless when the assets table has never heard of it. Unreadable files count as ownerless —
   they are unreachable over HTTP either way, and an operator should see them. */
function scan(db, dataDir) {
  const out = {};
  const hasAsset = id => !!db.prepare('SELECT 1 FROM assets WHERE id = ?').get(String(id));

  for (const kind of ['announcements', 'debriefs']) {
    const dir = path.join(dataDir, kind);
    out[kind] = list(dir).filter(f => f.endsWith('.json')).map(f => {
      const fp = path.join(dir, f), j = readJson(fp);
      return { file: f, id: f.replace(/\.json$/, ''), bytes: sizeOf(fp), clubId: j && j.clubId ? j.clubId : null, unreadable: !j };
    }).filter(r => !r.clubId);
  }
  for (const kind of ['videos', 'clips']) {
    const dir = path.join(dataDir, kind);
    out[kind] = list(dir).filter(f => !f.startsWith('.')).map(f => ({ file: f, id: f, bytes: sizeOf(path.join(dir, f)) }))
      .filter(r => !hasAsset(r.id));
  }
  const jobDir = path.join(dataDir, 'jobs');
  out.jobs = list(jobDir).filter(f => f.endsWith('.json')).map(f => ({ file: f, id: f.replace(/\.json$/, ''), bytes: sizeOf(path.join(jobDir, f)) }))
    .filter(r => !hasAsset(r.id));
  /* a feed file the server issued is named for the hash of its token and has a row; anything else
     is a client-made token from before accounts, or an orphan whose row is gone */
  const calDir = path.join(dataDir, 'calendars');
  const known = new Set(db.prepare('SELECT token_hash FROM calendar_feeds').all().map(r => String(r.token_hash).slice(0, 32)));
  out.calendars = list(calDir).filter(f => f.endsWith('.json')).map(f => {
    const base = f.replace(/\.json$/, '');
    return { file: f, id: base, bytes: sizeOf(path.join(calDir, f)), clientMade: !HASHED_FEED.test(base) };
  }).filter(r => r.clientMade || !known.has(r.id));
  return out;
}

const totals = found => KINDS.reduce((acc, k) => {
  acc[k] = { count: (found[k] || []).length, bytes: (found[k] || []).reduce((n, r) => n + r.bytes, 0) };
  acc.count += acc[k].count; acc.bytes += acc[k].bytes;
  return acc;
}, { count: 0, bytes: 0 });

/* Give it all to one club. Records get the club id written into the file; files get an assets row
   with no owner — the club's staff can reach them, nobody claims to have made them. Announcements
   and debriefs keep whatever `to` or team label they had: a pre-accounts "to" was an e-mail
   address, which is not a member ref, so a note addressed to one person becomes readable by that
   club's staff and by nobody else. That is deliberate — guessing which member an old e-mail meant
   is exactly the kind of inference this file refuses to make. */
function adopt(db, dataDir, { clubId, kinds = ADOPTABLE, now = Date.now() } = {}) {
  if (!ID.getClub(db, clubId)) throw Object.assign(new Error(`no club ${clubId}`), { code: 'not-found' });
  const bad = kinds.filter(k => !ADOPTABLE.includes(k));
  if (bad.length) throw Object.assign(new Error(`cannot adopt: ${bad.join(', ')}`), { code: 'usage' });
  const found = scan(db, dataDir), done = {};
  const stamp = db.prepare('INSERT OR IGNORE INTO assets (id, kind, club_id, owner_user_id, created_at, meta) VALUES (?, ?, ?, NULL, ?, ?)');

  for (const kind of kinds) {
    done[kind] = 0;
    for (const r of found[kind] || []) {
      if (ASSET_KIND[kind]) {
        stamp.run(r.id, ASSET_KIND[kind], clubId, now, JSON.stringify({ adopted: true }));
        done[kind]++;
      } else {
        const fp = path.join(dataDir, kind, r.file), j = readJson(fp);
        if (!j) continue;                               // unreadable: left alone, and still listed
        j.clubId = clubId;
        fs.writeFileSync(fp, JSON.stringify(j));
        done[kind]++;
      }
    }
  }
  ID.audit(db, { actor: 'operator', action: 'legacy.adopt', clubId, detail: done }, now);
  return done;
}

/* Delete it. There is no undo and no trash: this is for a volume whose club is gone, or for a
   deployment that decided the old material should not survive the switch. */
function forget(db, dataDir, { kinds = KINDS, now = Date.now() } = {}) {
  const found = scan(db, dataDir), done = {};
  for (const kind of kinds) {
    done[kind] = 0;
    for (const r of found[kind] || []) {
      try { fs.unlinkSync(path.join(dataDir, kind, r.file)); done[kind]++; } catch (e) {}
    }
  }
  ID.audit(db, { actor: 'operator', action: 'legacy.forget', clubId: null, detail: done }, now);
  return done;
}

module.exports = { KINDS, ADOPTABLE, scan, totals, adopt, forget };
