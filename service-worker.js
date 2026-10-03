const CACHE_NAME = 'maiden-v7';
const APP_FILES = [
  './',
  './index.html',
  './styles.css?v=maiden7',
  './engine.js?v=maiden2',
  './store.js?v=maiden2',
  './tournament.js?v=maiden2',
  './stats.js?v=maiden2',
  './app.js?v=maiden2',
  './hub.js?v=maiden2',
  './fonts/mona-sans-latin-wght.woff2',
  './manifest.webmanifest?v=maiden2',
  './app-icon.svg?v=maiden2',
  './icon-192.png?v=maiden2',
  './icon-512.png?v=maiden2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
