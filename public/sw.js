/* WaterWatch service worker: offline shell for the community report page. Never caches API, photos or ingestion. */
var CACHE = 'ww-shell-v1';
var ASSETS = ['/css/tokens.css', '/css/app.css', '/css/console.css', '/js/app.js', '/js/report.js', '/logo.svg', '/manifest.webmanifest'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(ASSETS.map(function (u) { return c.add(u).catch(function () { /* optional */ }); })).then(function () {
      return fetch('/report', { credentials: 'same-origin' }).then(function (r) { if (r.ok && !r.redirected) return c.put('/report', r); }).catch(function () { /* not signed in yet */ });
    });
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request; if (req.method !== 'GET') return;
  var url = new URL(req.url); if (url.origin !== location.origin) return;
  var p = url.pathname;
  if (p === '/report' || p === '/report/') {
    e.respondWith(fetch(req).then(function (r) {
      if (r.ok && !r.redirected) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put('/report', copy); }); }
      return r;
    }).catch(function () { return caches.match('/report', { ignoreSearch: true }); }));
    return;
  }
  if (ASSETS.indexOf(p) >= 0) {
    e.respondWith(caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (r) { if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); } return r; }).catch(function () { return hit; });
      return hit || net;
    }));
  }
});
