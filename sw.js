// Service Worker for ICD-9 Lookup
const CACHE_NAME = 'icd9-lookup-v5';

// Files to precache for offline use
const PRECACHE_FILES = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/styles.css',
  './assets/js/fuse.min.js',
  './assets/js/app.js',
  './assets/js/time-calc.js',
  './assets/js/time-calc-widget.js',
  './data/icd9.json',
  './data/billing-codes.json'
];

// Install: precache all static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        PRECACHE_FILES.map(file =>
          cache.add(new Request(file, { cache: 'reload' })).catch(err => {
            console.warn(`SW: Failed to cache ${file}:`, err);
          })
        )
      ))
      .then(() => self.skipWaiting())
  );
});

// Activate: remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first for same-origin requests
self.addEventListener('fetch', event => {
  // Only handle GET requests from same origin
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
