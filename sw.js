const cacheName = "pwa-todo-v1"; // キャッシュの名前（バージョン）
const contentToCache = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icon/icon-192x192.png",
  "/icon/icon-512x512.png",
]; // キャッシュするファイルの一覧

async function cacheAppShell() {
  // cacheNameという名前の箱を開ける
  const cache = await caches.open(cacheName);
  // 各 URL を取りに行って保存する
  await cache.addAll(contentToCache);
}

async function cacheFirst(request) {
  // 1. 今の cacheName のキャッシュから一致するものを探す（古いキャッシュは見ない）
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  // 2. あればそれを返す
  if (cached) return cached;
  // 3. 無ければネットワークへ取りに行く（保存はしない）
  return fetch(request);
}

async function deleteOldCaches() {
  // 1. 今ある全キャッシュの名前一覧を取る
  const keys = await caches.keys();
  // 2. 「今の cacheName 以外」を消す
  await Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)));
}

// install: アプリシェルをキャッシュに入れる
self.addEventListener("install", (e) => e.waitUntil(cacheAppShell()));
// fetch: リクエストを横取りして cache-first で返す
self.addEventListener("fetch", (e) => e.respondWith(cacheFirst(e.request)));
// activate: 今のバージョン以外の古いキャッシュを掃除
self.addEventListener("activate", (e) => e.waitUntil(deleteOldCaches()));
