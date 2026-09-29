const CACHE_NAME = "recipes-v1";
const STATIC_CDN_HOSTS = ["unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"];
const ASSETS = [
  // Production serves the page at the extensionless path, so cache both.
  "./recipes",
  "./recipes.html",
  "./recipes-app.js",
  "./recipes/manifest.json",
  "./recipes/icon.png",
  "./recipes/icon-192.png",
  "./recipes/icon-maskable.png",
  "./recipes/icon-maskable-192.png",
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700&display=swap",
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("recipes-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin) {
    // Network-first for the app's own files so a new deploy shows up at once.
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

  // Supabase (data, photos, AI calls) is never cached here: lists and
  // recipes already live in localStorage, and photo URLs are signed.
  if (!STATIC_CDN_HOSTS.includes(url.hostname)) return;

  // Stale-while-revalidate for the pinned CDN scripts and the font files.
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
