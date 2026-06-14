const CACHE_NAME = 'device-scanner-test-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.png',
  './icon-512.png',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Noto+Sans+TC:wght@300;400;500;700&display=swap',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.3/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.3/dist/worker.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.3/tesseract-core-simd.wasm.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.3/tesseract-core-simd.wasm',
  'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.3/tesseract-core.wasm.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.3/tesseract-core.wasm',
  'https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz'
];

// Install and cache assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching assets...');
      return cache.addAll(ASSETS).catch(err => {
        console.error('Service Worker: Caching failed during install:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate and clean up old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Service Worker: Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Cache-first falling back to network strategy
self.addEventListener('fetch', (e) => {
  // Only handle HTTP/HTTPS requests (avoid chrome-extension or file scheme errors)
  if (!(e.request.url.startsWith('http:') || e.request.url.startsWith('https:'))) {
    return;
  }
  
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((networkResponse) => {
        // Cache new successful GET requests dynamically
        if (networkResponse && networkResponse.status === 200 && e.request.method === 'GET') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      // Fallback in case of offline and asset not in cache
      console.log('Service Worker: Fetch failed, offline fallback.');
    })
  );
});
