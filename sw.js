// Service Worker for ICD-9 Lookup - Offline First
const CACHE_NAME = 'icd9-lookup-v1';
const STATIC_CACHE = 'icd9-static-v1';
const DATA_CACHE = 'icd9-data-v1';

// Get base path for flexible deployment
function getBasePath() {
  const scope = self.registration.scope;
  const basePath = scope.endsWith('/') ? scope : scope + '/';
  return basePath;
}

// Files to cache for offline use - using relative paths
const STATIC_FILES = [
  './',
  './index.html',
  './data/icd9.json',
  './assets/js/fuse.min.js',
  './manifest.json'
];

// Install event - cache static files
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('Service Worker: Caching static files');
        // Try to cache files, but don't fail if some are missing
        return Promise.allSettled(
          STATIC_FILES.map(file => 
            cache.add(file).catch(err => {
              console.warn(`Service Worker: Failed to cache ${file}:`, err);
              return null;
            })
          )
        );
      })
      .then(() => {
        console.log('Service Worker: Static files cached');
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('Service Worker: Failed to cache static files', err);
        // Don't fail the installation if caching fails
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== STATIC_CACHE && cacheName !== DATA_CACHE) {
              console.log('Service Worker: Deleting old cache', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - implement cache-first strategy
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle different types of requests
  if (request.method === 'GET') {
    // For HTML and main page
    if (request.destination === 'document' || url.pathname === '/' || url.pathname === '/index.html') {
      event.respondWith(handleDocumentRequest(request));
    }
    // For JSON data
    else if (url.pathname.endsWith('.json')) {
      event.respondWith(handleDataRequest(request));
    }
    // For JavaScript libraries
    else if (url.pathname.endsWith('.js')) {
      event.respondWith(handleScriptRequest(request));
    }
    // For other static assets
    else {
      event.respondWith(handleStaticRequest(request));
    }
  }
});

// Handle document requests (HTML)
async function handleDocumentRequest(request) {
  try {
    // Try cache first
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('Service Worker: Serving document from cache');
      return cachedResponse;
    }

    // Fallback to network
    console.log('Service Worker: Fetching document from network');
    const networkResponse = await fetch(request);
    
    // Cache the response for future use
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('Service Worker: Document fetch failed', error);
    // Try to find index.html in cache with different possible paths
    const possiblePaths = ['./index.html', '/index.html', 'index.html'];
    for (const path of possiblePaths) {
      const offlineResponse = await caches.match(path);
      if (offlineResponse) {
        return offlineResponse;
      }
    }
    return new Response('Offline - Please check your connection', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}

// Handle data requests (JSON)
async function handleDataRequest(request) {
  try {
    // Try cache first for data
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('Service Worker: Serving data from cache');
      return cachedResponse;
    }

    // Try network
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Cache the data
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, networkResponse.clone());
      console.log('Service Worker: Data cached from network');
    }
    
    return networkResponse;
  } catch (error) {
    console.error('Service Worker: Data fetch failed', error);
    // Return cached data if available
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('Service Worker: Serving stale data from cache');
      return cachedResponse;
    }
    
    // Return error response
    return new Response(JSON.stringify({ error: 'Data unavailable offline' }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Handle script requests (JavaScript)
async function handleScriptRequest(request) {
  try {
    // Try cache first
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('Service Worker: Serving script from cache');
      return cachedResponse;
    }

    // Try network
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Cache the script
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
      console.log('Service Worker: Script cached from network');
    }
    
    return networkResponse;
  } catch (error) {
    console.error('Service Worker: Script fetch failed', error);
    return new Response('// Script unavailable offline', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/javascript' }
    });
  }
}

// Handle static asset requests
async function handleStaticRequest(request) {
  try {
    // Try cache first
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('Service Worker: Serving static asset from cache');
      return cachedResponse;
    }

    // Try network
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Cache the asset
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
      console.log('Service Worker: Static asset cached from network');
    }
    
    return networkResponse;
  } catch (error) {
    console.error('Service Worker: Static asset fetch failed', error);
    return new Response('Asset unavailable offline', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}

// Handle background sync for data updates
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    console.log('Service Worker: Background sync triggered');
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  try {
    // Try to update data when back online
    const response = await fetch('./data/icd9.json');
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      await cache.put('./data/icd9.json', response);
      console.log('Service Worker: Data updated in background');
    }
  } catch (error) {
    console.error('Service Worker: Background sync failed', error);
  }
}

// Handle push notifications (for future PWA features)
self.addEventListener('push', event => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: '/assets/icons/icon-192.png',
      badge: '/assets/icons/icon-72.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: 1
      }
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});
