const CACHE_NAME = "marsova-opravila-v1";
const STATIC_CDN_HOSTS = ["unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"];
const ASSETS = [
  // The site serves this page at the extensionless path in production
  // (Cloudflare's asset serving redirects the .html path away from it), so
  // cache both forms - the extensionless one matches what start_url/scope
  // and real navigations actually request.
  "./marsova-opravila",
  "./marsova-opravila.html",
  "./marsova-opravila-app.js",
  "./marsova-opravila/manifest.json",
  "./marsova-opravila/icon.png",
  "./marsova-opravila/icon-maskable.png",
  "./marsova-opravila/mars-idle.jpg",
  "./marsova-opravila/mars-sleepy.jpg",
  "./marsova-opravila/mars-celebrate.jpg",
  "./marsova-opravila/mars-excited.jpg",
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
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin) {
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

  if (!STATIC_CDN_HOSTS.includes(url.hostname)) {
    // Everything else - notably the Supabase API and realtime sockets - is
    // never cached and never served from cache. Points only ever change on
    // a real network round trip; a service worker standing in for that
    // would let the app claim something saved while offline.
    return;
  }

  // Stale-while-revalidate for the pinned CDN scripts/fonts, which are
  // effectively immutable - no need to wait on the network for those.
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
