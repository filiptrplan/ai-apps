const CACHE_NAME = "climbing-tracker-v1";
const ASSETS = [
  // The site serves this page at the extensionless path in production
  // (Cloudflare's asset serving redirects the .html path away from it), so
  // cache both forms - the extensionless one matches what start_url/scope
  // and real navigations actually request.
  "./climbing-tracker",
  "./climbing-tracker.html",
  "./climbing-tracker-app.js",
  "./climbing-tracker/manifest.json",
  "./climbing-tracker/icon.svg",
  "./climbing-tracker/icon-maskable.svg",
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
];

// Cache each asset independently (not cache.addAll, which is all-or-nothing)
// so one failed fetch - e.g. a transient CDN hiccup - can't block the rest of
// the app's own files from being cached and the worker from activating.
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (event.request.url.startsWith(self.location.origin)) {
    // Network-first for the app's own files: always try to get the latest
    // deploy, and only fall back to the cache when there's no network at
    // all. Stale-while-revalidate here would show last visit's version
    // instead of what was just shipped.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Stale-while-revalidate for the cross-origin CDN scripts, which are
  // pinned by version and effectively immutable - no need to wait on the
  // network for those.
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
