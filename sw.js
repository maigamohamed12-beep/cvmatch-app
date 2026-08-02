const CACHE_VERSION = "cvmatch-v1";

const PRECACHE_URLS = [
  "/manifest.json",
  "/fonts/cvserif-regular.woff2",
  "/fonts/cvserif-italic.woff2",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Never touch API calls or the admin dashboard: payments, unlock codes and
// order data must always hit the network, never a cached response.
function shouldBypass(pathname) {
  return pathname.startsWith("/api/") || pathname.startsWith("/admin");
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || shouldBypass(url.pathname)) {
    return;
  }

  const isAppShell = url.pathname === "/" || url.pathname === "/index.html";

  if (isAppShell) {
    // Network-first: this app ships fixes frequently, so always prefer the
    // latest deployed version. The cache is only a fallback for when the
    // device is offline, not a way to speed up normal loads.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static, effectively-immutable assets (fonts, icons): cache-first for
  // speed, refilling the cache on a miss.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
