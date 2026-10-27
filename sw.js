/* Service Worker: hält die App-Dateien offline bereit.
 * Wetterdaten werden NICHT hier, sondern in app.js (localStorage) zwischengespeichert.
 * Strategie: erst Netzwerk (damit Updates sofort ankommen), bei Offline oder langsamer
 * Verbindung (> 2,5 s) die zuletzt gespeicherte Version.
 */
const CACHE = 'wetter-v4';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'radarmap.js', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (res) => { if (!done && res) { done = true; resolve(res); } };
    const timer = setTimeout(() => caches.match(req, { ignoreSearch: true }).then(finish), 2500);
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) // GitHub Pages cached sonst ~10 min im Browser
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        finish(res);
      })
      .catch(() => {
        clearTimeout(timer);
        caches.match(req, { ignoreSearch: true }).then((r) => finish(r || Response.error()));
      });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // API-Aufrufe nie abfangen
  e.respondWith(networkFirst(req));
});
