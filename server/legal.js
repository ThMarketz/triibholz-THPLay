/* ============================================================
   legal.js (server) — serving the documents, and recording what was agreed to.

   The contract lives in js/legal.js and is shared with the app, the way js/teamsync.js is, so a
   rule cannot hold on one side and not the other. This file is the part that touches disk and
   database: read the documents, say which version is current, and write down an acceptance in a
   form somebody could later stand behind.

   TWO THINGS IT REFUSES, both of which would make the record worthless:

     · ACCEPTING A VERSION THIS SERVER DOES NOT SERVE. If the app sends a version that is not the
       current one, the person read something else — an old tab, a cached page, a replayed request.
       Recording it would produce evidence of agreement to a text nobody can produce.
     · RECORDING A LANGUAGE THAT WAS NOT SHOWN. The app may ask for German; until a German
       translation exists, English is what appears on screen. The row says what was actually
       served, because "she accepted the German version" has to be true or not said at all.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const LEGAL = require('../js/legal.js');

const DIR = path.join(__dirname, '..', 'legal');
const MANIFEST = path.join(DIR, 'manifest.json');

function load() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) { return { docs: {} }; }
}

/* doc id → the version this deployment serves. The shape js/legal.js expects. */
function current(man) {
  const out = {};
  for (const [id, d] of Object.entries((man || load()).docs || {})) if (d.version) out[id] = d.version;
  return out;
}

/* The text, and the language it is REALLY in. A request for a language with no translation gets
   English and is told so, rather than being handed English under a German label. */
function textOf(doc, lang, man) {
  man = man || load();
  const d = (man.docs || {})[doc];
  if (!d) return null;
  const use = d.langs[lang] ? lang : (d.langs.en ? 'en' : Object.keys(d.langs)[0]);
  if (!use) return null;
  let text;
  try { text = fs.readFileSync(path.join(DIR, `${doc}.${use}.md`), 'utf8'); } catch (e) { return null; }
  return { doc, lang: use, askedFor: lang, version: d.version, status: d.status, sha256: d.langs[use].sha256, text };
}

function routes(core) {
  const { db, now, send, readJson, httpError, requireSession } = core;
  const uid = () => 'ac_' + require('crypto').randomBytes(16).toString('base64url');

  /* what a person has accepted, newest first — club rows and their own */
  function acceptedBy(userId, clubId) {
    return db.prepare(`SELECT doc, version, lang, scope, accepted_at FROM acceptances
                       WHERE (user_id = ? AND club_id IS ?) OR (club_id = ? AND scope = 'club')
                       ORDER BY accepted_at DESC`).all(userId, clubId || null, clubId || null);
  }

  async function index(req, res) {
    const man = load();
    const docs = Object.entries(man.docs || {}).map(([id, d]) => ({
      id, version: d.version, status: d.status, langs: Object.keys(d.langs || {}),
      scope: (LEGAL.BY_ID[id] || {}).scope || 'personal',
      blocking: !!(LEGAL.BY_ID[id] || {}).blocking,
    }));
    send(res, 200, { docs });
  }

  async function read(req, res, doc) {
    const url = new URL(req.url, 'http://x');
    const lang = String(url.searchParams.get('lang') || 'en').slice(0, 2).toLowerCase();
    const t = textOf(doc, LEGAL.LANGS.includes(lang) ? lang : 'en');
    if (!t) throw httpError(404, 'not-found');
    send(res, 200, t);
  }

  async function accept(req, res) {
    const body = await readJson(req);
    const t = now(), s = requireSession(req);
    const man = load(), cur = current(man);
    const check = LEGAL.checkAcceptance(body, cur);
    if (!check.ok) throw httpError(check.error === 'stale-version' ? 409 : 400, check.error);

    const doc = LEGAL.BY_ID[check.value.doc];
    const clubId = doc.scope === 'club' ? String(body.clubId || '') : null;
    if (doc.scope === 'club') {
      // accepting FOR a club binds that club, so it takes the role that can bind it
      const m = db.prepare("SELECT role FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'approved'").get(clubId, s.userId);
      if (!m || m.role !== 'admin') throw httpError(404, 'not-found');
    }
    // the row says what was really on screen, not what was asked for
    const served = textOf(check.value.doc, check.value.lang, man);
    if (!served) throw httpError(404, 'not-found');

    db.prepare(`INSERT INTO acceptances (id, user_id, club_id, doc, version, sha256, lang, scope, accepted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, club_id, doc, version) DO NOTHING`)
      .run(uid(), s.userId, clubId, check.value.doc, check.value.version, served.sha256, served.lang, doc.scope, t);

    const role = clubId ? 'admin' : (db.prepare("SELECT role FROM club_members WHERE user_id = ? AND status = 'approved' ORDER BY role LIMIT 1").get(s.userId) || {}).role || 'coach';
    send(res, 200, {
      accepted: { doc: check.value.doc, version: check.value.version, lang: served.lang, at: t },
      outstanding: LEGAL.outstanding(role, cur, acceptedBy(s.userId, clubId)),
    });
  }

  /* what this person still owes, for the app to act on */
  async function mine(req, res) {
    const s = requireSession(req);
    const url = new URL(req.url, 'http://x');
    const clubId = String(url.searchParams.get('club') || '') || null;
    const role = clubId
      ? ((db.prepare("SELECT role FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'approved'").get(clubId, s.userId) || {}).role || null)
      : ((db.prepare("SELECT role FROM club_members WHERE user_id = ? AND status = 'approved' ORDER BY role LIMIT 1").get(s.userId) || {}).role || null);
    if (clubId && !role) throw httpError(404, 'not-found');
    send(res, 200, { role, outstanding: LEGAL.outstanding(role || 'player', current(), acceptedBy(s.userId, clubId)) });
  }

  return [
    ['GET', /^\/api\/legal$/, index],
    ['GET', /^\/api\/legal\/mine$/, mine],
    ['GET', /^\/api\/legal\/([a-z][a-z0-9-]{1,20})$/, read],
    ['POST', /^\/api\/legal\/accept$/, accept],
  ];
}

module.exports = { routes, load, current, textOf };
