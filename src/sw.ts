// Service worker: lets Android Chrome install the page as an app, and keeps the last
// data on screen when offline. Network first, falling back to the cached copy, and
// only for this site's own files (the live relay, photos and fonts pass straight by).

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = 'draft-v1';

sw.addEventListener('install', () => sw.skipWaiting());
sw.addEventListener('activate', (event) => event.waitUntil(sw.clients.claim()));

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== sw.location.origin) return;
  const key = url.origin + url.pathname; // one copy of data.json, not one per ?v= timestamp
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(key, copy)));
        }
        return response;
      })
      .catch(() => caches.match(key).then((cached) => cached ?? Response.error())),
  );
});
