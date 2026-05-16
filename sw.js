const CACHE_NAME = "auralis-cache-v1";

const urlsToCache = [
  "/",
  "/app.html",
  "/auth.html",
  "/style.css",
  "/app.js",
  "/auth.js",
  "/firebase.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/countries.js",
  "/gender.js",
  "/index.html"
];

// ================= INSTALL =================
self.addEventListener("install", event => {

  console.log("Service Worker Installed");

  event.waitUntil(

    caches.open(CACHE_NAME).then(cache => {

      return cache.addAll(urlsToCache);
    })
  );

  self.skipWaiting();
});

// ================= ACTIVATE =================
self.addEventListener("activate", event => {

  console.log("Service Worker Activated");

  event.waitUntil(

    caches.keys().then(keys => {

      return Promise.all(

        keys.map(key => {

          if (key !== CACHE_NAME) {

            return caches.delete(key);
          }
        })
      );
    })
  );

  self.clients.claim();
});

// ================= FETCH =================
self.addEventListener("fetch", event => {

  event.respondWith(

    caches.match(event.request).then(response => {

      // cache first
      if (response) {
        return response;
      }

      // fallback to network
      return fetch(event.request)
        .then(networkResponse => {

          return caches.open(CACHE_NAME)
            .then(cache => {

              cache.put(
                event.request,
                networkResponse.clone()
              );

              return networkResponse;
            });
        })
        .catch(() => {

          // offline fallback
          if (
            event.request.destination === "document"
          ) {

            return caches.match("/app.html");
          }
        });
    })
  );
});