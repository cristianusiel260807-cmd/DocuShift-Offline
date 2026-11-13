/* DocuShift Offline - Service Worker */
const CACHE_VERSION = "docushift-v1";
const APP_CACHE = `${CACHE_VERSION}-app`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg"
];

const CDN_FILES = [
  "https://cdn.tailwindcss.com",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/docx/8.5.0/docx.umd.js",
  "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.7.1/mammoth.browser.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const appCache = await caches.open(APP_CACHE);
    await appCache.addAll(APP_FILES);
    const runtimeCache = await caches.open(RUNTIME_CACHE);
    // Algunas CDN entregan respuestas opacas; se pueden almacenar y reutilizar,
    // aunque el navegador no permita inspeccionar su contenido.
    await Promise.allSettled(CDN_FILES.map(async url => {
      const response = await fetch(url, { mode: "no-cors", cache: "reload" });
      if (response && (response.ok || response.type === "opaque")) {
        await runtimeCache.put(url, response);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key =>
      key.startsWith("docushift-") && key !== APP_CACHE && key !== RUNTIME_CACHE
    ).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Navegación: intentar red y mostrar la app guardada si no hay conexión.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(APP_CACHE);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch {
        return (await caches.match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  // Recursos propios: caché primero y actualización en segundo plano.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const network = fetch(request).then(async response => {
        if (response && response.ok) {
          const cache = await caches.open(APP_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })());
    return;
  }

  // Bibliotecas externas: caché primero; la primera visita requiere conexión.
  if (CDN_FILES.includes(request.url) || url.hostname === "cdnjs.cloudflare.com" || url.hostname === "cdn.tailwindcss.com") {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(request, { ignoreSearch: false });
      const network = fetch(request).then(response => {
        if (response && (response.ok || response.type === "opaque")) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(() => cached);
      return cached || network || Response.error();
    })());
  }
});
