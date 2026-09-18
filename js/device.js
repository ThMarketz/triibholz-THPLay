/* ============================================================
   device.js — everything this device holds, in one file, so a coach can move.

   THE PROBLEM THIS EXISTS FOR. A browser keys storage by ORIGIN. The day the app moves from
   localhost:8088 to thplay.ch, every coach's plays, rosters, tagged moments, cut library and
   player test histories stay behind at an address nobody will ever open again. Nothing errors.
   The app simply looks new, and a season is gone.

   `💾 Backup all my plays` is honestly named and does exactly that — plays. It has never covered
   thplay.teams.v1, thplay.film.v1, thplay.testlog.*, home training or the calendar token, so a
   coach who dutifully pressed it before moving would still lose most of their work.

   WHAT TRAVELS, AND WHAT DOES NOT. Every key the app writes begins 'thplay.' — that is checked by
   a test, not assumed — so the sweep is the prefix. Uploaded match VIDEOS do not travel inside the
   file: they are blobs in IndexedDB and a single match is routinely larger than everything else
   put together. They are LISTED instead, by name and size, so the coach is told which videos will
   not follow and can save them one at a time. A file that silently omitted them would be worse
   than one that cannot be moved.

   THIS FILE IS A PRIVACY ARTEFACT. A roster is children's names and licence numbers. It is written
   to the coach's own disk, is never uploaded, and says on its face what it contains so nobody
   mails it around casually.
   ============================================================ */
const DEVICE = (() => {
  const FORMAT = 'thplay.device.v1';
  const PREFIX = 'thplay.';
  const VIDEO_DB = 'thplay-film', VIDEO_STORE = 'videos';
  const MAX_BYTES = 40 * 1024 * 1024;     // a device file is text; past this something is wrong

  /* Keys the app writes that are NOT the coach's work: a language choice, a look, whether the tour
     was seen. They travel anyway (they are tiny and they are still theirs) but they are named so
     "what did I actually move?" has an honest answer. */
  const PREFERENCE = ['thplay.lang', 'thplay.look.v1', 'thplay.glass.v1', 'thplay.sound', 'thplay.speed',
    'thplay.toured', 'thplay.fsbar', 'thplay.show3d', 'thplay.showGk', 'thplay.showSteps',
    'thplay.showZones', 'thplay.3dTarget'];

  /* A token that authorises a calendar feed is not work — it is a credential, and it is reissued
     when accounts come on (docs/LAUNCH_PHASES.md, Phase 6). Carrying it to a new origin would
     move a secret for no benefit and leave a stale one behind. */
  const NEVER = ['thplay.calendar.token', 'thplay.analysis.endpoint'];

  const isOurs = k => typeof k === 'string' && k.indexOf(PREFIX) === 0;
  const kind = k => NEVER.includes(k) ? 'never' : PREFERENCE.includes(k) ? 'preference' : 'work';

  /* ---------------- reading the device ---------------- */
  function collect(storage) {
    const stores = {}, left = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!isOurs(k)) { left.push(k); continue; }
      if (kind(k) === 'never') { left.push(k); continue; }
      stores[k] = storage.getItem(k);
    }
    return { stores, left };
  }

  function pack(storage, videos, meta) {
    const { stores } = collect(storage);
    const keys = Object.keys(stores).sort();
    return {
      format: FORMAT,
      at: (meta && meta.at) || null,          // the caller stamps it; this module invents nothing
      origin: (meta && meta.origin) || '',
      app: (meta && meta.app) || '',
      counts: {
        keys: keys.length,
        work: keys.filter(k => kind(k) === 'work').length,
        preferences: keys.filter(k => kind(k) === 'preference').length,
      },
      /* named, never embedded: one match video outweighs the rest of the file by orders of
         magnitude, and a coach has to know which ones are staying behind */
      videos: (videos || []).map(v => ({ key: String(v.key || ''), name: String(v.name || ''), bytes: +v.bytes || 0 })),
      stores,
    };
  }

  /* ---------------- reading a file back ---------------- */
  function check(file) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) return { ok: false, error: 'not-a-device-file' };
    if (file.format !== FORMAT) return { ok: false, error: 'wrong-format' };
    if (!file.stores || typeof file.stores !== 'object' || Array.isArray(file.stores)) return { ok: false, error: 'no-stores' };
    const keys = Object.keys(file.stores);
    // a file that names a key outside our own prefix is trying to write somebody else's storage
    const foreign = keys.find(k => !isOurs(k) || kind(k) === 'never');
    if (foreign) return { ok: false, error: 'foreign-key', key: foreign };
    if (keys.some(k => typeof file.stores[k] !== 'string')) return { ok: false, error: 'bad-value' };
    const bytes = keys.reduce((n, k) => n + k.length + file.stores[k].length, 0);
    if (bytes > MAX_BYTES) return { ok: false, error: 'too-large', bytes };
    return { ok: true, keys: keys.length, bytes };
  }

  /* Write it back. `replace` decides the one question that matters: a device that already has work
     of its own. The default is to KEEP what is there and report what was left alone — restoring
     onto the wrong device and silently flattening a season would be the same failure this module
     exists to prevent, pointed the other way. */
  function apply(file, storage, opts) {
    const r = check(file);
    if (!r.ok) return r;
    const replace = !!(opts && opts.replace);
    const written = [], kept = [];
    for (const k of Object.keys(file.stores).sort()) {
      const has = storage.getItem(k) !== null;
      if (has && !replace) { kept.push(k); continue; }
      try { storage.setItem(k, file.stores[k]); written.push(k); }
      catch (e) { return { ok: false, error: 'device-full', written, kept }; }
    }
    return { ok: true, written, kept, videos: (file.videos || []).length };
  }

  /* what a coach is about to move, in words, before they press anything */
  function describe(file) {
    const r = check(file);
    if (!r.ok) return r;
    const keys = Object.keys(file.stores);
    return {
      ok: true,
      work: keys.filter(k => kind(k) === 'work'),
      preferences: keys.filter(k => kind(k) === 'preference'),
      videos: file.videos || [],
      videoBytes: (file.videos || []).reduce((n, v) => n + (+v.bytes || 0), 0),
      origin: file.origin || '',
      at: file.at || null,
    };
  }

  return { FORMAT, PREFIX, PREFERENCE, NEVER, VIDEO_DB, VIDEO_STORE, MAX_BYTES,
           isOurs, kind, collect, pack, check, apply, describe };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = DEVICE;
