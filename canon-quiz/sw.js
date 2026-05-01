const CACHE_NAME = 'canon-quiz-v3';

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.add('/index.html').catch(function(){});
    })
  );
});

self.addEventListener('activate', function(e) {
  self.clients.claim();
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Pass through external requests
  if (url.indexOf('script.google.com') > -1 ||
      url.indexOf('googleapis.com') > -1 ||
      url.indexOf('gstatic.com') > -1 ||
      url.indexOf('forms.cloud.microsoft') > -1) {
    return;
  }

  // Cache-first for app shell
  e.respondWith(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        var networkFetch = fetch(e.request).then(function(resp) {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            cache.put(e.request, resp.clone());
          }
          return resp;
        }).catch(function() { return cached; });
        return cached || networkFetch;
      });
    })
  );
});
