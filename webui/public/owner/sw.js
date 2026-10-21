// خدمة مخزّن قشرة التطبيق فقط (HTML/CSS/JS/الأيقونات) للتثبيت والفتح السريع — لا تُخزَّن استجابات /api أبداً فتبقى البيانات حيّة دوماً.
const CACHE = 'erp-owner-v1';
const SHELL = ['/owner/', '/owner/index.html', '/owner/app.js', '/owner/app.css', '/owner/manifest.json', '/owner/icon-192.png', '/owner/icon-512.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (url.pathname.startsWith('/api/')) return;   // بيانات حية دائماً: لا تدخّل من الخدمة
  if (ev.request.method !== 'GET') return;
  ev.respondWith(
    fetch(ev.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(ev.request, copy)); return res; })
      .catch(() => caches.match(ev.request).then((r) => r || caches.match('/owner/')))
  );
});
