const CACHE_NAME = 'nassau-v1';
const urlsToCache = ['/', '/index.html', '/css/main.css', '/js/api.js', '/js/auth.js', '/js/app.js', '/js/modules/propietarios.js', '/js/modules/pagos.js', '/js/modules/estados.js', '/js/modules/documentos.js', '/js/modules/configuracion.js', '/js/modules/superadmin.js'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api')) return;
  event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});