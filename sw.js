/* 旅行足跡地圖 Service Worker：讓 App 可安裝、離線也能開啟 */
const VERSION = 'v6';
const SHELL_CACHE = `shell-${VERSION}`;
const TILE_CACHE = 'tiles-v1';
const MAX_TILES = 3000; // 最多快取的地圖圖磚數（約 50–100 MB）
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/jspdf.umd.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  // 地圖圖磚：只快取跨網域（cors）請求；一般模式的請求交給瀏覽器自己處理
  else if (/(tile\.openstreetmap\.org|tile\.openstreetmap\.fr|server\.arcgisonline\.com)$/.test(url.hostname) && req.mode === 'cors') e.respondWith(tileCacheFirst(req));
  // 其他（站名查詢等）不攔截，直接走網路
});

// App 本體：有網路就拿最新版並更新快取，沒網路（或 3 秒沒回應）就用快取
async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await Promise.race([
      fetch(req, { cache: 'no-cache' }), // 不用瀏覽器的舊快取，確保更新立刻生效
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true }))
      || (req.mode === 'navigate' && (await cache.match('index.html')))
      || Response.error();
  }
}

// 地圖圖磚：看過的區域會留在手機裡，沒網路時也能顯示
async function tileCacheFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    trimTiles(cache);
  }
  return res;
}

let trimming = false;
async function trimTiles(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES + 200).map((k) => cache.delete(k)));
  } finally { trimming = false; }
}
