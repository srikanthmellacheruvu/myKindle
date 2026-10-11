// Offline support: every file the app needs is saved on the iPad the first time it opens.
// When you upload a new version, change VERSION so iPads pick it up.
const VERSION = 'myreader-v1.0.0';
const FILES = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/util.js',
  './js/db.js',
  './js/importer.js',
  './js/library.js',
  './js/reader.js',
  './js/formats.js',
  './vendor/jszip.min.js',
  './vendor/epub.min.js',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // dictionary lookups go straight to the network
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then(r => r || fetch(req)));
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
