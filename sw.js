const CACHE_NAME = 'canon-focus-v3.2.3';
const IMG_CACHE = 'canon-focus-images-v1'; // jamais purgé aux montées de version
const URLS_TO_CACHE = [
  '/canon-quiz/',
  '/canon-quiz/index.html',
  '/canon-quiz/beta.html'
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

// ── Activate : supprime les anciens caches (sauf le cache images) ────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key !== CACHE_NAME && key !== IMG_CACHE) return caches.delete(key);
      }));
    }).then(function() { return self.clients.claim(); })
  );
});

// ── Message : préchargement des images de formation ──────────────────────────
self.addEventListener('message', function(e) {
  if (!e.data || e.data.type !== 'PRECACHE_IMAGES' || !Array.isArray(e.data.urls)) return;
  e.waitUntil(caches.open(IMG_CACHE).then(function(cache) {
        var done = 0, added = 0;
    return Promise.all(e.data.urls.map(function(u) {
      return cache.match(u).then(function(hit) {
        if (hit) { done++; return; }
        return fetch(u, { mode: 'no-cors' }).then(function(r) {
          // status 0 = réponse opaque (cross-origin) : il FAUT la garder quand même
          if (r && (r.status === 200 || r.type === 'opaque')) { done++; added++; return cache.put(u, r); }
        }).catch(function() {});
      });
    })).then(function() {
      // Purge des images qui n'appartiennent plus à aucune formation
      return cache.keys().then(function(keys) {
        return Promise.all(keys.map(function(req) {
          if (req.url.indexOf('lh3.googleusercontent.com') > -1 && e.data.urls.indexOf(req.url) === -1) {
            return cache.delete(req);
          }
        }));
      });
    }).then(function() {
      return self.clients.matchAll().then(function(cs) {
        cs.forEach(function(c) {
          c.postMessage({ type: 'IMAGES_CACHED', ok: done, total: e.data.urls.length, added: added });
        });
      });
    });
  }));
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Laisser passer les appels Apps Script / Google fonts
  if (url.indexOf('script.google.com') > -1 ||
      url.indexOf('googleapis.com') > -1 ||
      url.indexOf('gstatic.com') > -1 ||
      url.indexOf('fonts.') > -1) return;

  // Images de formation hébergées sur Drive : cache permanent, cache-first
  if (url.indexOf('lh3.googleusercontent.com') > -1 || url.indexOf('drive.google.com/thumbnail') > -1) {
    e.respondWith(
      caches.open(IMG_CACHE).then(function(cache) {
        return cache.match(e.request).then(function(cached) {
          if (cached) return cached;
          return fetch(e.request).then(function(r) {
            if (r && (r.status === 200 || r.type === 'opaque')) cache.put(e.request, r.clone());
            return r;
          }).catch(function() { return cached; });
        });
      })
    );
    return;
  }

  var isHTML = url.indexOf('/canon-quiz/index.html') > -1 ||
               url.indexOf('/canon-quiz/beta.html') > -1 ||
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
