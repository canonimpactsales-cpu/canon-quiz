const CACHE_NAME = 'canon-quiz-v12';
const URLS_TO_CACHE = [
  '/canon-quiz/',
  '/canon-quiz/index.html'
];

// ── Install : mise en cache initiale ────────────────────────────────────────
self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(URLS_TO_CACHE).catch(function() {});
    })
  );
});

// ── Activate : supprime les anciens caches ───────────────────────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function() { return self.clients.claim(); })
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Laisser passer les appels Apps Script / Google fonts
  if (url.indexOf('script.google.com') > -1 ||
      url.indexOf('googleapis.com') > -1 ||
      url.indexOf('gstatic.com') > -1 ||
      url.indexOf('fonts.') > -1) return;

  var isHTML = url.indexOf('/canon-quiz/index.html') > -1 ||
               url.endsWith('/canon-quiz/') ||
               url.endsWith('/canon-quiz');

  if (isHTML) {
    // Stale-while-revalidate pour index.html :
    // 1. Sert le cache immédiatement (app fonctionne offline)
    // 2. Télécharge la nouvelle version en arrière-plan
    // 3. Si différente → notifie l'app pour afficher la bannière
    e.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.match(e.request).then(function(cached) {
          var networkFetch = fetch(e.request).then(function(networkResponse) {
            if (networkResponse && networkResponse.status === 200) {
              // Comparer avec la version en cache
              var responseToCache = networkResponse.clone();
              cache.match(e.request).then(function(oldCached) {
                if (oldCached) {
                  // Lire les deux pour comparer
                  Promise.all([
                    oldCached.text(),
                    responseToCache.clone().text()
                  ]).then(function(texts) {
                    if (texts[0] !== texts[1]) {
                      // Nouvelle version détectée — mettre en cache et notifier
                      cache.put(e.request, responseToCache);
                      self.clients.matchAll().then(function(clients) {
                        clients.forEach(function(client) {
                          client.postMessage({ type: 'UPDATE_AVAILABLE' });
                        });
                      });
                    }
                  }).catch(function() {
                    cache.put(e.request, responseToCache);
                  });
                } else {
                  cache.put(e.request, responseToCache);
                }
              });
            }
            return networkResponse;
          }).catch(function() {
            // Offline : retourner le cache
            return cached;
          });

          // Retourner le cache immédiatement si disponible
          return cached || networkFetch;
        });
      })
    );
    return;
  }

  // Cache-first pour les autres ressources (fonts, etc.)
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
