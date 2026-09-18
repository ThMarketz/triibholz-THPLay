/* Triibholz (THPLAY) service worker — offline app shell + fresh rule books. */
/* The cache name carries a digest of everything ASSETS lists (scripts/sw-stamp.mjs). A service
   worker only refills its cache when this string changes, so tying it to the bytes means a changed
   asset can never ship behind an unchanged cache name — which is how new icons nearly went out
   while every installed app kept the old ones. The vNN in front is for reading in devtools. */
const ASSET_STAMP = '3b480fac69bd';
const CACHE = 'triibholz-v87-' + ASSET_STAMP;
const ASSETS = [
  './', './index.html',
  './css/styles.css',
  './js/theme.js', './js/i18n.js', './js/help.js', './js/draft.js', './js/commands.js', './js/solver.js', './js/qr.js', './js/fx.js', './js/pool.js', './js/data.js', './js/animate.js', './js/vision.js', './js/field.js', './js/shot.js', './js/testlog.js', './js/chart.js', './js/manikin.js', './js/track.js', './js/bytetrack.js', './js/events.js', './js/webdetector.js', './js/videogen.js', './js/calendar.js', './js/planner.js', './js/privacy.js', './js/tactics.js',
  './js/gameplan.js', './js/share.js', './js/announce.js', './js/wpmatch.js', './js/sheetdoc.js', './js/eligibility.js', './js/teamsheet.js', './js/scout.js', './js/teamsync.js', './js/teams.js', './js/api.js', './js/session.js', './js/analysis.js', './js/film.js', './js/app.js',
  './data/rules.json',
  './manifest.webmanifest',
  './icons/favicon-64.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

/* `cache: 'reload'` is load-bearing. A plain addAll() is allowed to satisfy itself from the
   browser's own HTTP cache, so a new service worker can install a new cache name filled with the
   OLD bytes — the app then looks updated and is not, and no amount of bumping CACHE fixes it.
   This is the trap docs/ROLLOUT_ROADMAP.md warns about, and it bit this project during testing. */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      // the page that is open right now was rendered from the PREVIOUS cache: cache-first means a
      // returning visitor always sees the old build once. Tell it, so it can offer a reload rather
      // than leaving a coach on last week's app with no way to know.
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(cs => cs.forEach(c => { try { c.postMessage({ type: 'sw-updated', cache: CACHE }); } catch (err) {} }))
  );
});

/* Only a complete, successful answer from our own origin may be kept. An error page, a
   redirect or a partial (206 video range) stored here would be served forever after. */
const cacheable = r => !!r && r.ok && r.status === 200 && r.type === 'basic';
const keep = (req, r) => { if (cacheable(r)) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // never intercept third-party requests (YouTube embeds, CDNs, …)
  if (url.origin !== location.origin) return;
  // the club server: always the network, never the cache — rosters, sessions and personal
  // data must not outlive a sign-out on a shared device, or be served stale to someone else
  if (url.pathname.startsWith('/api/')) return;

  // rule books: network-first so they stay current, fall back to cache offline
  if (url.pathname.endsWith('/data/rules.json')) {
    e.respondWith(
      fetch(req).then(r => cacheable(r) ? keep(req, r) : caches.match(req).then(hit => hit || r))
        .catch(() => caches.match(req))
    );
    return;
  }

  // everything else: cache-first, then network. The shell is the offline fallback for a NAVIGATION
  // only — handing index.html back for a failed image, JSON or video range makes the app look like
  // it loaded when it did not, and the caller gets HTML where it expected bytes.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => keep(req, r))
      .catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
