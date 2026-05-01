const CACHE_NAME = 'canon-quiz-v7';
const BASE_URL = 'https://canonimpactsales-cpu.github.io';
const URLS_TO_CACHE = [
  BASE_URL + '/',
  BASE_URL + '/index.html'
];

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(URLS_TO_CACHE).catch(function(err) {
        console.log('Cache error:', err);
      });
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.map(function(key) {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  if (url.indexOf('script.google.com') > -1 ||
      url.indexOf('googleapis.com') > -1 ||
      url.indexOf('gstatic.com') > -1 ||
      url.indexOf('fonts.') > -1) {
    return;
  }

  e.respondWith(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        if (cached) {
          fetch(e.request).then(function(resp) {
            if (resp && resp.status === 200) cache.put(e.request, resp.clone());
          }).catch(function() {});
          return cached;
        }
        return fetch(e.request).then(function(resp) {
          if (resp && resp.status === 200) cache.put(e.request, resp.clone());
          return resp;
        }).catch(function() {
          return caches.match(BASE_URL + '/index.html');
        });
      });
    })
  );
});
