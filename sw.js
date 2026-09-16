/* Triibholz (THPLAY) service worker — offline app shell + fresh rule books. */
const CACHE = 'triibholz-v80';
const ASSETS = [
  './', './index.html',
  './css/styles.css',
  './js/theme.js', './js/i18n.js', './js/help.js', './js/draft.js', './js/commands.js', './js/solver.js', './js/qr.js', './js/fx.js', './js/pool.js', './js/data.js', './js/animate.js', './js/vision.js', './js/field.js', './js/shot.js', './js/testlog.js', './js/chart.js', './js/manikin.js', './js/track.js', './js/bytetrack.js', './js/events.js', './js/webdetector.js', './js/videogen.js', './js/calendar.js', './js/planner.js', './js/privacy.js', './js/tactics.js',
  './js/gameplan.js', './js/share.js', './js/announce.js', './js/wpmatch.js', './js/sheetdoc.js', './js/eligibility.js', './js/teamsheet.js', './js/teamsync.js', './js/teams.js', './js/api.js', './js/session.js', './js/analysis.js', './js/film.js', './js/app.js',
  './data/rules.json',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
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

  // everything else: cache-first, then network, with the shell as offline fallback
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => keep(req, r))
      .catch(() => caches.match('./index.html')))
  );
});
