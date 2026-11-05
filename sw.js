// 설치형 앱용 서비스 워커: 늘 최신을 먼저 받고, 인터넷이 없으면 저장본으로 실행
const CACHE = "rowing-vr-v24";
const SHELL = ["./", "index.html", "yt.html", "three-r128.min.js", "yt-sounds.js", "yt-row.js", "steps.html", "step-detect.js", "yt-hike.js", "yt-hike-sounds.js",
               "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); });
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? caches.match("index.html") : Response.error())));
});
