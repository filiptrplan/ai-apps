const CACHE_NAME = "german-app-v2";
const STATIC_CDN_HOSTS = ["unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"];
const ASSETS = [
  // Production serves the page at the extensionless path, so cache both.
  "./german",
  "./german.html",
  "./german-app.js",
  "./german/manifest.json",
  "./german/icon.svg",
  "./german/icon.png",
  "./german/icon-192.png",
  "./german/icon-maskable.png",
  "./german/icon-maskable-192.png",
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("german-app-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
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

  // Supabase (data, AI calls) is never cached here: cards and the rest
  // already live in localStorage, and played audio has its own cache
  // ("german-audio", see german/audio.js).
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
