// ⚠️ 每次发布新版本（index.html/manifest.json等有改动）时，必须把这里的版本号
// 也同步递增，否则用户设备上缓存的旧版本页面不会被清理更新——activate事件里
// "清理旧缓存"的逻辑，只有在CACHE这个名字真的变化时才会生效，名字不变的话浏览器
// 会认为"缓存没变"，旧内容会一直被cache-first策略提供给用户，不会自动刷新到最新
// 代码。建议跟CHANGELOG.md的版本号保持一致，方便一眼对应。
const CACHE = 'gold-assistant-v1813';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Mono:wght@300;400;500&family=Noto+Serif+SC:wght@300;400;500&display=swap'
];

// Install: cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Activate: clear old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for assets, network-first for exchange rate API
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Exchange rate API — always try network, fall back to cache
  if (url.includes('open.er-api.com')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Google Fonts — cache first
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  // Everything else — cache first, network fallback
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
