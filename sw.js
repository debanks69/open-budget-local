// Offline support: cache the app shell, serve it cache first.
// Bump VERSION at each release so phones fetch the new files.

const VERSION = "v2";
const CACHE = `open-budget-local-${VERSION}`;
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "icon.svg",
  "icon-180.png",
  "icon-512.png",
  "js/app.js",
  "js/db.js",
  "js/money.js",
  "js/categories.js",
  "js/backup.js",
  "js/bank.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      if (request.mode === "navigate") return caches.match("index.html");
      return fetch(request);
    }),
  );
});
