const CACHE_NAME = 'cricnova-v7';
const APP_FILES = [
  './',
  './index.html',
  './styles.css?v=cricnova7',
  './portal.js?v=cricnova7',
  './supabase-config.js?v=cricnova7',
  './app.js?v=cricnova7',
  './manifest.webmanifest?v=cricnova7',
  './app-icon.svg?v=cricnova7',
  './icon-192.png?v=cricnova7',
  './icon-512.png?v=cricnova7',
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
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});