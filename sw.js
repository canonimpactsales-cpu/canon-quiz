const CACHE_NAME = 'canon-quiz-v9';
const BASE = '/canon-quiz';
const URLS_TO_CACHE = [
  '/canon-quiz/',
  '/canon-quiz/index.html'
];

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(URLS_TO_CACHE).catch(function() {});
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  if (url.indexOf('script.google.com') > -1 ||
      url.indexOf('googleapis.com') > -1 ||
      url.indexOf('gstatic.com') > -1 ||
      url.indexOf('fonts.') > -1) return;

  e.respondWith(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        var networkFetch = fetch(e.request).then(function(r) {
          if (r && r.status === 200) cache.put(e.request, r.clone());
          return r;
        }).catch(function() { return cached; });
        return cached || networkFetch;
      });
    })
  );
});
