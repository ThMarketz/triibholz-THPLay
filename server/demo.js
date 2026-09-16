/* ============================================================
   server/demo.js — a sandbox club to look at, with nobody's real data in it.

   docs/ACCOUNTS.md asked for "a DEMO=1 sandbox club with fictional users for tests". Fictional
   users a test can *sign in as* is a sign-in backdoor by another name: a second way past the
   passkey, living in the same binary as the first, one environment variable away from production.
   So this is the other half of that idea and none of the dangerous half:

     · it is an operator command (`node admin.js demo`), never a startup path and never an
       environment flag — nothing can bring a demo club into being by being misconfigured;
     · the fictional squad has NO credentials. Those people cannot sign in, here or anywhere.
       They exist so the member list, the addressee list and a team note have someone in them;
     · a real person becomes the demo club's admin the same way as any other: with the invite the
       command prints, and their own passkey.

   Everything it writes is obviously invented — the club is named "(demo)" and the squad are
   Alpha…Hotel. No real person's name, licence number or date of birth goes anywhere near it.
   ============================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ID = require('./identity.js');

const CLUB_NAME = 'Sandbox WPC (demo)';
/* deliberately not name-shaped: nobody should ever wonder whether one of these is a real player */
const SQUAD = [
  { name: 'Player Alpha (demo)', role: 'player' },
  { name: 'Player Bravo (demo)', role: 'player' },
  { name: 'Player Charlie (demo)', role: 'player' },
  { name: 'Player Delta (demo)', role: 'player' },
  { name: 'Player Echo (demo)', role: 'player' },
  { name: 'Player Foxtrot (demo)', role: 'player' },
  { name: 'Keeper Golf (demo)', role: 'player' },
  { name: 'Coach Hotel (demo)', role: 'coach' },
];

const write = (dir, file, obj) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, file), JSON.stringify(obj)); };

/* Makes the club, its squad and enough content that the app is not an empty shell. Returns the
   club id and the admin invite code — the only way in, and it needs a real passkey. */
function seed(db, dataDir, { now = Date.now(), name = CLUB_NAME } = {}) {
  const clubId = ID.createClub(db, { name, actor: 'operator' }, now);
  const members = SQUAD.map(p => {
    const { id } = ID.createUser(db, { displayName: p.name }, now);
    const { memberRef } = ID.addMember(db, { clubId, userId: id, role: p.role, status: 'approved', actor: 'operator', action: 'member.add' }, now);
    return { userId: id, memberRef, name: p.name, role: p.role };
  });

  const annId = 'ann_demo_' + now.toString(36);
  write(path.join(dataDir, 'announcements'), annId + '.json', {
    id: annId, clubId, authorUserId: null, scope: 'team', to: null,
    from: { name: 'Coach Hotel (demo)', email: '' },
    title: 'Saturday: press high from the whistle',
    body: 'Their centre forward is left-handed — force him to turn onto his right. Full pressure for the first four minutes, then drop to the 3-3.',
    matchLabel: null, matchEventId: null, plays: [], clip: null, readBy: [], createdAt: now,
  });
  const debId = 'deb_demo_' + now.toString(36);
  write(path.join(dataDir, 'debriefs'), debId + '.json', {
    id: debId, clubId, authorUserId: null, team: 'club', title: 'Demo match review',
    items: [
      { id: 'i1', t0: 61, t1: 74, title: '6 on 5 — near post', note: 'Ball moved twice, shot came from the top.', result: 'goal', asked: 'Overload the near post', followed: true, clipUrl: null, frames: [], notes: {} },
      { id: 'i2', t0: 212, t1: 226, title: 'Counter conceded', note: 'Nobody dropped back after the shot.', result: 'conceded', asked: 'One player holds the middle', followed: false, clipUrl: null, frames: [], notes: {} },
    ],
    comments: [], createdAt: now,
  });

  const { code, expiresAt } = ID.issueCode(db, { kind: 'club-admin', clubId, role: 'admin', actor: 'operator' }, now);
  ID.audit(db, { actor: 'operator', action: 'demo.seed', clubId, detail: { members: members.length } }, now);
  return { clubId, name, members, code, expiresAt, announcementId: annId, debriefId: debId };
}

/* Everything the demo made, gone: the club (members cascade), its records, its codes. */
function remove(db, dataDir, { clubId } = {}) {
  const club = ID.getClub(db, clubId);
  if (!club) throw Object.assign(new Error(`no club ${clubId}`), { code: 'not-found' });
  const users = db.prepare('SELECT user_id FROM club_members WHERE club_id = ?').all(clubId).map(r => r.user_id);
  let files = 0;
  for (const kind of ['announcements', 'debriefs']) {
    const dir = path.join(dataDir, kind);
    for (const f of (() => { try { return fs.readdirSync(dir); } catch (e) { return []; } })()) {
      let j = null; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) {}
      if (j && j.clubId === clubId) { try { fs.unlinkSync(path.join(dir, f)); files++; } catch (e) {} }
    }
  }
  // a demo person belongs to the demo club and nothing else; anyone who joined for real is left alone
  let people = 0;
  for (const userId of users) {
    const elsewhere = db.prepare('SELECT count(*) AS n FROM club_members WHERE user_id = ? AND club_id != ?').get(userId, clubId).n;
    const hasKey = db.prepare('SELECT count(*) AS n FROM credentials WHERE user_id = ?').get(userId).n;
    if (!elsewhere && !hasKey) { db.prepare('DELETE FROM users WHERE id = ?').run(userId); people++; }
  }
  db.prepare('DELETE FROM clubs WHERE id = ?').run(clubId);
  ID.audit(db, { actor: 'operator', action: 'demo.remove', clubId: null, detail: { club: club.name, files, people } }, Date.now());
  return { files, people };
}

module.exports = { CLUB_NAME, SQUAD, seed, remove };
