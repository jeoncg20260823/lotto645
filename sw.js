// 앱 뼈대를 캐시해 인터넷이 없어도 열리게 하는 서비스 워커
// 파일을 바꾸면 CACHE 이름의 숫자를 올려 주세요.
const CACHE = 'lotto-app-v7';
const FILES = ['./', './index.html', './style.css', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
