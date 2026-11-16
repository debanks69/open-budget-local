// Offline support: cache the app shell, serve it cache first.
// Bump VERSION at each release so phones fetch the new files.

const VERSION = "v7";
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
  "js/ledger.js",
  "js/ui.js",
  "js/screens-ops.js",
  "js/screens-more.js",
  "js/feedback.js",
];

// "reload" skips the HTTP cache: GitHub Pages lets browsers keep files for
// 10 minutes, so a plain fetch could mix old and new files in one version.
self.addEventListener("install", (event) => {
  const requests = SHELL.map((url) => new Request(url, { cache: "reload" }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(requests)).then(() => self.skipWaiting()));
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
