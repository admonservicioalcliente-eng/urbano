const CACHE_NAME = 'nassau-v10';
const urlsToCache = ['/', '/css/main.css', '/js/api.js', '/js/auth.js', '/js/app.js', '/js/modules/propietarios.js', '/js/modules/pagos.js', '/js/modules/estados.js', '/js/modules/documentos.js', '/js/modules/configuracion.js', '/js/modules/superadmin.js'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api')) return;
  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
