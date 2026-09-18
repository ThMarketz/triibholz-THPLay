/* ============================================================
   retention.js — match video does not live for ever.

   THE PROMISE THIS KEEPS. The app holds video of children. Until now nothing deleted any of it,
   anywhere: not on the device, and not here — no reaper, no TTL, no delete path. The honest answer
   to a parent asking "how long do you keep video of my son" was "for ever", which is not an answer
   a club accepts. The answer is now one season, and this is the code that makes it true.

   WHY THE FILESYSTEM IS THE SOURCE OF TRUTH, not the assets table. `access.recordAsset` is a no-op
   when ACCOUNTS is off (server/access.js openAccess), so with accounts off there are files on disk
   and no rows at all. A reaper that trusted the table would quietly keep everything in exactly the
   configuration the app ships in. The disk is what fills up, so the disk is what is walked.

   THE HARD LINK IS THE TRAP. /api/clip hard-links every cut into the video store under `cut_<id>`
   so one situation can be scouted on its own. Two names, one inode: unlink the clip alone and the
   bytes stay alive under the other name. A reaper that deleted `clips/x.mp4` and left
   `videos/cut_x.mp4` would report success, free nothing, and make the retention promise false.
   Both names go together, in both directions.

   KEEPING SOMETHING is a coach saying "this one is a teaching clip". It is recorded beside the
   data rather than in the database, for the same reason as above: it has to work with accounts off
   as well as on, and one source of truth beats two that can disagree.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const DAY = 86400000;

/* A season. Long enough that a coach still has last month's match, short enough that a parent can
   be told a number. Overridable so it can be tested in seconds rather than months. */
const DEFAULT_DAYS = 365;

function daysFrom(env) {
  const n = Number((env || {}).RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAYS;
}

/* ---------------- what a coach chose to keep ---------------- */
function keepPath(dataDir) { return path.join(dataDir, 'keep.json'); }

function readKeep(dataDir) {
  try { const o = JSON.parse(fs.readFileSync(keepPath(dataDir), 'utf8')); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
  catch (e) { return {}; }
}
function writeKeep(dataDir, keep) {
  const p = keepPath(dataDir), tmp = p + '.part';
  fs.writeFileSync(tmp, JSON.stringify(keep, null, 1));
  fs.renameSync(tmp, p);      // never leave a half-written keep list: it decides what survives
}
function setKeep(dataDir, id, on, now) {
  const keep = readKeep(dataDir);
  if (on) keep[id] = now; else delete keep[id];
  writeKeep(dataDir, keep);
  return keep;
}

/* ---------------- the pair ----------------
   clips/<id>.mp4 and videos/cut_<id>.mp4 are one inode under two names. Either name reaching the
   end of its life ends both, because keeping one alive frees nothing and hides the other. */
function twinOf(dir, name, dirs) {
  if (dir === dirs.clips && /\.mp4$/.test(name)) return { dir: dirs.videos, name: 'cut_' + name };
  if (dir === dirs.videos && /^cut_/.test(name)) return { dir: dirs.clips, name: name.replace(/^cut_/, '') };
  return null;
}

/* the id a keep decision is recorded against — a cut and its twin share one */
function keepIdFor(dir, name, dirs) {
  if (dir === dirs.videos && /^cut_/.test(name)) return name.replace(/^cut_/, '');
  return name;
}

function listFiles(dir) {
  try { return fs.readdirSync(dir).filter(n => n[0] !== '.' && !n.endsWith('.part')); }
  catch (e) { return []; }
}

/* ---------------- the sweep ----------------
   `now` and `days` are arguments, never read from the clock in here, so a test can age a file by a
   year without waiting for one. Returns what it did rather than logging into the void. */
function sweep({ dirs, dataDir, now, days, dryRun }) {
  const cutoff = now - daysFrom({ RETENTION_DAYS: days }) * DAY;
  const keep = readKeep(dataDir);
  const removed = [], kept = [], failed = [];
  const seen = new Set();

  for (const dir of [dirs.videos, dirs.clips, dirs.jobs]) {
    for (const name of listFiles(dir)) {
      const full = path.join(dir, name);
      if (seen.has(full)) continue;
      let st; try { st = fs.statSync(full); } catch (e) { continue; }
      if (!st.isFile()) continue;
      if (st.mtimeMs > cutoff) continue;

      const id = keepIdFor(dir, name, dirs);
      if (keep[id] || keep[name]) { kept.push(name); continue; }

      const targets = [{ dir, name }];
      const t = twinOf(dir, name, dirs);
      if (t) targets.push(t);
      for (const tg of targets) {
        const p = path.join(tg.dir, tg.name);
        seen.add(p);
        try { if (fs.existsSync(p)) { if (!dryRun) fs.unlinkSync(p); removed.push(tg.name); } }
        catch (e) { failed.push(tg.name); }
      }
    }
  }
  return { cutoff, removed, kept, failed, days: daysFrom({ RETENTION_DAYS: days }) };
}

/* how long a thing has left, for telling a coach BEFORE it goes rather than after */
function expiresAt(mtimeMs, now, days) { return mtimeMs + daysFrom({ RETENTION_DAYS: days }) * DAY; }
function daysLeft(mtimeMs, now, days) { return Math.ceil((expiresAt(mtimeMs, now, days) - now) / DAY); }

module.exports = { DAY, DEFAULT_DAYS, daysFrom, readKeep, writeKeep, setKeep, keepPath,
                   twinOf, keepIdFor, sweep, expiresAt, daysLeft };
