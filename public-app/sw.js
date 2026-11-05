const cacheName = 'studio-public-v1.0.2';
const assets = ['./', './index.html', './styles.css', './app.js', './config.js',
  './config-ui.js', './lucide.min.js', './manifest.webmanifest', './icon.png',
  './one-page-guide.svg', './一图流.html', './使用说明.html', './contact.js', './author-contact.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('studio-public-') && key !== cacheName)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(cacheName);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(event.request, { ignoreSearch: true });
      return cached || (event.request.mode === 'navigate'
        ? await caches.match('./index.html')
        : Response.error());
    }
  })());
});
