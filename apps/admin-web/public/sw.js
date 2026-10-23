/*
 * Service Worker cổng quản trị (PWA).
 * Scope mặc định là /admin/ nên không can thiệp API/socket ngoài scope.
 * - Precache app shell + offline fallback.
 * - Navigation: network-first; asset tĩnh: stale-while-revalidate.
 */
const VERSION = 'v1';
const CORE_CACHE = `ubm-admin-core-${VERSION}`;
const RUNTIME_CACHE = `ubm-admin-runtime-${VERSION}`;
const PRECACHE_URLS = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

const scopeUrl = new URL(self.registration.scope);
const INDEX_URL = new URL('index.html', scopeUrl).href;
const OFFLINE_URL = new URL('offline.html', scopeUrl).href;

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CORE_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[sw] precache failed:', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key.startsWith('ubm-admin-') && key !== CORE_CACHE && key !== RUNTIME_CACHE)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(scopeUrl.pathname)) return;

  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/socket.io')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (['script', 'style', 'font', 'image'].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirstNavigation(request) {
  const core = await caches.open(CORE_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      core.put(INDEX_URL, response.clone()).catch(() => null);
    }
    return response;
  } catch {
    const cached = (await core.match(request)) || (await core.match(INDEX_URL));
    if (cached) return cached;
    const offline = await core.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('Không có kết nối mạng.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const runtime = await caches.open(RUNTIME_CACHE);
  const cached = await runtime.match(request);
  const network = fetch(request)
    .then(response => {
      if (response && response.ok && response.type === 'basic') {
        runtime.put(request, response.clone()).then(() => trimRuntimeCache(runtime)).catch(() => null);
      }
      return response;
    })
    .catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

async function trimRuntimeCache(cache) {
  const maxEntries = 120;
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map(key => cache.delete(key)));
}
