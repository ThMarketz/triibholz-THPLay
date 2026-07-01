/* Triibholz (THPLAY) service worker — offline app shell + fresh rule books. */
const CACHE = 'triibholz-v5';
const ASSETS = [
  './', './index.html',
  './css/styles.css',
  './js/i18n.js', './js/qr.js', './js/fx.js', './js/pool.js', './js/data.js', './js/animate.js', './js/app.js',
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

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // rule books: network-first so they stay current, fall back to cache offline
  if (url.pathname.endsWith('/data/rules.json')) {
    e.respondWith(
      fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // everything else: cache-first, then network, with the shell as offline fallback
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r;
    }).catch(() => caches.match('./index.html')))
  );
});
