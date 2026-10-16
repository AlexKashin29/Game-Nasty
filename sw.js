/* Offline support after one successful visit. Keep old caches until installation succeeds. */
const CACHE = "nastya-letter-v2-1";
const FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./script.js",
  "./data.json",
  "./manifest.webmanifest",
  "./assets/heart.svg",
  "./assets/couple_art.webp",
  "./assets/nastya_art.webp",
  "./assets/alex_art.webp",
  "./assets/final_couple.webp",
  "./assets/cat.webp",
  "./assets/nastya1.webp",
  "./assets/nastya2.webp",
];
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("nastya-letter-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  // Network-first keeps published content fresh; offline uses the completed snapshot.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (
          response.ok &&
          new URL(event.request.url).pathname.startsWith(
            new URL(self.registration.scope).pathname,
          )
        ) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put(event.request, copy)),
          );
        }
        return response;
      })
      .catch(
        async () =>
          (await caches.match(event.request)) ||
          (event.request.mode === "navigate"
            ? await caches.match("./index.html")
            : null) ||
          Response.error(),
      ),
  );
});
