const cacheName = 'xiamu-offline-v19';
const assets = [
  './',
  './index.html',
  './夏暮工作室预约App-双击打开.html',
  './styles.css',
  './styles.css?v=19',
  './app.js',
  './app.js?v=19',
  './lucide.min.js',
  './guide.html',
  './guide.md',
  './文字版使用说明.html',
  './manual.html',
  './图文使用说明书.html',
  './one-page-guide.svg',
  './一图流使用介绍.svg',
  './manifest.webmanifest',
  './logo.jpg',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))))
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const acceptsHtml = request.headers.get('accept')?.includes('text/html');

  if (request.mode === 'navigate' || acceptsHtml) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./夏暮工作室预约App-双击打开.html')))
    );
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
