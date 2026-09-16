/* ============================================================
   server/access.js — who may touch what, for the endpoints that existed before accounts.

   Slice 4 of docs/ACCOUNTS.md: uploads, jobs, clips, debriefs, announcements, calendar feeds and
   insights stop being open to anyone who knows a URL. One helper decides it all, so a route cannot
   quietly invent its own rule:

     · the session says who is asking (auth.js), and their APPROVED memberships say which clubs;
     · anything a person may not see answers 404 — never 403 — so a stranger cannot learn that a
       club, a video or a debrief exists;
     · a club's staff (admin, coach, trainer) act only from a session that was user-verified;
     · files carry an owner and a club in `assets`; a file with no row is from before accounts and
       is readable by nobody over HTTP;
     · ids are 128 random bits, so nothing is guessable by counting.

   With accounts off (ACCOUNTS unset) `openAccess()` is used instead: every check passes and the
   server behaves exactly as it did before. That is what makes turning ACCOUNTS on the single
   switch the design asks for, rather than a half-authorized in-between.
   ============================================================ */
'use strict';
const crypto = require('node:crypto');
const ID = require('./identity.js');

const STAFF = ID.STAFF_ROLES;
const CLIENT_HEADER = 'x-thp-client';
const MIN_CLIENT = 4;                 // an app older than this cannot speak the authorized API
const JSON_ONLY = ['/api/jobs', '/api/debriefs', '/api/insights', '/api/videogen', '/api/calendar'];
const RAW_BODY = ['/api/upload', '/api/analyse'];   // video bytes, not JSON
const MAX_BODY_JSON = 2 * 1024 * 1024;

const httpError = (status, error, extra) => Object.assign(new Error(error), { status, error, extra });
const newId = prefix => prefix + '_' + crypto.randomBytes(16).toString('base64url').replace(/[^\w-]/g, '');
const sha256hex = s => crypto.createHash('sha256').update(String(s)).digest('hex');

/* accounts off: the server as it was */
function openAccess() {
  const open = { userId: null, uv: true, open: true, clubs: new Map() };
  const club = { clubId: null, role: 'admin', open: true };
  return {
    on: false, newId, CLIENT_HEADER, MIN_CLIENT,
    gate() {}, actorOf: () => open, requireActor: () => open, requireClub: () => club, requireStaff: () => club,
    recordAsset() {}, assetOf: () => null, requireAssetRead: () => null, ownedVideo: () => true,
    issueFeed: () => null, feedFor: () => ({ open: true }), listFeeds: () => [],
    scopeOf: () => null, visibleRecord: () => true, stampRecord: r => r,
  };
}

function createAccess({ db, auth, cfg, now = Date.now, clipInDebrief }) {
  /* ---- who is asking ---- */
  function actorOf(req) {
    const s = auth.sessionFrom(req);
    if (!s) return null;
    const rows = db.prepare("SELECT club_id, role FROM club_members WHERE user_id = ? AND status = 'approved'").all(s.userId);
    return { userId: s.userId, uv: !!s.uv, session: s, clubs: new Map(rows.map(r => [r.club_id, r.role])) };
  }
  function requireActor(req) {
    const a = actorOf(req);
    if (!a) throw httpError(401, 'signed-out');
    return a;
  }
  /* the club a request is about: the one asked for, or the person's only one */
  function requireClub(actor, clubId) {
    const id = clubId || (actor.clubs.size === 1 ? [...actor.clubs.keys()][0] : null);
    if (!id || !actor.clubs.has(id)) throw httpError(404, 'not-found');
    return { clubId: id, role: actor.clubs.get(id) };
  }
  function requireStaff(actor, clubId) {
    const c = requireClub(actor, clubId);
    if (!STAFF.includes(c.role)) throw httpError(404, 'not-found');
    if (!actor.uv) throw httpError(403, 'user-verification-required');
    return c;
  }

  /* ---- request hygiene, before any route runs ---- */
  function gate(req, pathname) {
    const version = Number(req.headers[CLIENT_HEADER]);
    if (!(version >= MIN_CLIENT)) throw httpError(426, 'update-the-app', { minClient: MIN_CLIENT });
    if (req.method === 'GET' || req.method === 'HEAD') return;
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !cfg.origins.includes(origin)) throw httpError(403, 'bad-origin');
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const raw = RAW_BODY.some(r => pathname === r);
    if (raw) {
      if (!(type === 'application/octet-stream' || type.startsWith('video/') || type === 'application/json')) throw httpError(415, 'bad-content-type');
      return;
    }
    if (type !== 'application/json') throw httpError(415, 'json-only');
    if (Number(req.headers['content-length']) > MAX_BODY_JSON) throw httpError(413, 'body-too-large');
  }

  /* ---- files: videos, clips, jobs ---- */
  const recordAsset = ({ id, kind, clubId, ownerUserId, meta }) =>
    db.prepare('INSERT OR REPLACE INTO assets (id, kind, club_id, owner_user_id, created_at, meta) VALUES (?, ?, ?, ?, ?, ?)')
      .run(String(id), kind, clubId, ownerUserId || null, now(), meta ? JSON.stringify(meta) : null);
  const assetOf = id => db.prepare('SELECT * FROM assets WHERE id = ?').get(String(id || '')) || null;

  /* An asset this person may read: their own, or their club's if they are staff, or a clip that a
     debrief of their club shows (a player may watch the clip in their own team's review). */
  function requireAssetRead(actor, id, kinds) {
    const a = assetOf(id);
    if (!a || (kinds && !kinds.includes(a.kind))) throw httpError(404, 'not-found');
    const role = actor.clubs.get(a.club_id);
    if (!role) throw httpError(404, 'not-found');
    if (a.owner_user_id === actor.userId || STAFF.includes(role)) return a;
    if (a.kind === 'clip' && clipInDebrief && clipInDebrief(a.id, a.club_id)) return a;
    throw httpError(404, 'not-found');
  }
  /* may this person cut a clip out of this video? */
  function ownedVideo(actor, videoRef) {
    const a = assetOf(videoRef);
    if (!a || a.kind !== 'video') throw httpError(404, 'video-not-found');
    const role = actor.clubs.get(a.club_id);
    if (!role || !(a.owner_user_id === actor.userId || STAFF.includes(role))) throw httpError(404, 'video-not-found');
    return a;
  }

  /* ---- calendar feeds ---- */
  function issueFeed(actor, clubId, label) {
    const c = requireStaff(actor, clubId);
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO calendar_feeds (token_hash, club_id, label, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(sha256hex(token), c.clubId, label ? String(label).slice(0, 60) : null, actor.userId, now());
    ID.audit(db, { actor: actor.userId, action: 'feed.issue', clubId: c.clubId, detail: { label: !!label } }, now());
    return { token, clubId: c.clubId };
  }
  /* a feed token as a calendar app presents it: no cookie, so the token is the whole permission */
  const feedFor = token => db.prepare('SELECT * FROM calendar_feeds WHERE token_hash = ? AND revoked_at IS NULL').get(sha256hex(String(token || ''))) || null;
  const listFeeds = clubId => db.prepare('SELECT token_hash, label, created_at, revoked_at FROM calendar_feeds WHERE club_id = ? ORDER BY created_at DESC').all(clubId);

  /* ---- records that live in files (debriefs, announcements): the club and author come from the
     session, and a record from before accounts (no clubId) is visible to nobody ---- */
  const stampRecord = (record, actor, clubId) => Object.assign(record, { clubId, authorUserId: actor.userId });
  const visibleRecord = (record, actor) => !!(record && record.clubId && actor.clubs.has(record.clubId));

  return {
    on: true, newId, CLIENT_HEADER, MIN_CLIENT,
    gate, actorOf, requireActor, requireClub, requireStaff,
    recordAsset, assetOf, requireAssetRead, ownedVideo,
    issueFeed, feedFor, listFeeds, stampRecord, visibleRecord,
  };
}

module.exports = { createAccess, openAccess, httpError, MIN_CLIENT, CLIENT_HEADER, STAFF };
