/*
 * Service Worker cổng nhân viên (PWA).
 * - Precache app shell + offline fallback.
 * - Navigation: network-first (luôn lấy HTML mới), offline dùng bản đã cache.
 * - Asset tĩnh: stale-while-revalidate.
 * - Không cache API/auth/socket để tránh dữ liệu cũ.
 */
const VERSION = 'v2';
const CORE_CACHE = `ubm-employee-core-${VERSION}`;
const RUNTIME_CACHE = `ubm-employee-runtime-${VERSION}`;
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
            .filter(key => key.startsWith('ubm-employee-') && key !== CORE_CACHE && key !== RUNTIME_CACHE)
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

  // API, auth, socket: luôn ra mạng, không đụng cache.
  // /admin/: do service worker cổng quản trị (scope /admin/) quản lý. Nếu SW
  // quản trị chưa kích hoạt, bỏ qua để trình duyệt tải trực tiếp — tránh việc
  // SW scope "/" cache nhầm HTML/admin vào app shell của nhân viên.
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/socket.io') ||
    url.pathname.startsWith('/admin')
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
