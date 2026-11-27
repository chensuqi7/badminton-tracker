const PREFIX = 'badminton:' + self.registration.scope + ':';
const CACHE = PREFIX + '3.1.0-life.9';
const FILES = ['./', './index.html', './manifest.json','./prototype.css','./prototype-ui.js','./life.js','./life-ui.js','./ledger.js','./app.js','./cloud.js','./cloud-config.js', './icon-192.png', './icon-512.png'];
const urls = FILES.map(file => new URL(file, self.registration.scope).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(urls.map(url => new Request(url, {cache: 'reload'}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
      if (name === 'badminton-v2') {
        const legacy = await caches.open(name);
        for (const url of urls) await legacy.delete(url);
        if (!(await legacy.keys()).length) await caches.delete(name);
      }
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  if (request.mode !== 'navigate' && !urls.includes(request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(request)
      || (request.mode === 'navigate' && await cache.match(urls[1]))
      || fetch(request);
  })());
});
