// Service worker: precache the whole app so it works fully offline.
// Bump VERSION whenever any file changes so phones pick up the update.
const VERSION = 'piste-v1.2.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/state.js',
  './js/store.js',
  './js/sync.js',
  './js/config.js',
  './js/core/share.js',
  './js/core/bout.js',
  './js/core/poule.js',
  './js/core/timer.js',
  './js/ui/boutView.js',
  './js/ui/device.js',
  './js/ui/dom.js',
  './js/ui/icons.js',
  './js/ui/exportPoule.js',
  './js/ui/pouleView.js',
  './js/ui/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' bypasses the browser's HTTP cache, so a new version never
  // stores stale copies of files. Then take over straight away rather than
  // waiting for every Piste window to be closed (the page decides when to reload).
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Cache first (instant, offline-proof); fall back to the network, and to the
// app shell for navigations.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok && res.type === 'basic') {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())),
    ),
  );
});
