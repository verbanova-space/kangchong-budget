// 오프라인에서도 열리도록 앱 파일을 캐시한다. 앱을 고치면 VERSION을 올릴 것.
const VERSION = 'budget-v25';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  // 로그인이 필요한 곳에서는 미리 담기가 실패할 수 있어요 → 그래도 설치는 계속
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 네트워크 우선, 실패하면 캐시 (인터넷이 되면 항상 최신 버전)
// 서버 저장(api)·로그인 화면은 캐시하지 않아요
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || url.pathname.includes('/api/') || url.pathname.endsWith('/login.html')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && !res.redirected && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
