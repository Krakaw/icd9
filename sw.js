// Self-unregistering stub. Replaces the previous offline-caching service
// worker — existing installs clear themselves out on the next update check.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.registration.unregister(),
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))),
    ]).then(() => self.clients.matchAll())
      .then(clients => clients.forEach(c => c.navigate(c.url)))
  );
});
