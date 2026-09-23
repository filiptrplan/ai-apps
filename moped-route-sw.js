const CACHE_NAME = "moped-route-v2";
const STATIC_CDN_HOSTS = ["unpkg.com", "cdnjs.cloudflare.com"];
const ASSETS = [
  // Production serves the page at the extensionless path, so cache both.
  "./moped-route",
  "./moped-route.html",
  "./moped-route-app.js",
  "./moped-route/manifest.json",
  "./moped-route/icon.png",
  "./moped-route/icon-192.png",
  "./moped-route/icon-maskable.png",
  "./moped-route/icon-maskable-192.png",
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
];

// Cache each asset on its own so one failed fetch can't block the rest.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("moped-route-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin) {
    // The link resolver and anything else dynamic always goes to the network.
    if (url.pathname.startsWith("/api/")) return;
    // Network-first for the app's own files so a new deploy shows up at once.
    // Shared links arrive as /moped-route?text=..., which falls back to the
    // cached page when offline.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && !url.search) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }

  // Google, Overpass and map tiles are never cached here: routes and road
  // data have their own handling, and tiles are cached by the browser.
  if (!STATIC_CDN_HOSTS.includes(url.hostname)) return;

  // Stale-while-revalidate for the pinned CDN scripts.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
