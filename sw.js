// Canon Focus — Service Worker
// ⚠️ À chaque déploiement : changer CACHE_NAME (ex : v3.3.0 → v3.3.1)
const CACHE_NAME = 'canon-focus-v3.7.1';
const IMG_CACHE = 'canon-focus-images-v1'; // jamais purgé aux montées de version
const HTML_TIMEOUT_MS = 4000;              // au-delà, on sert la copie locale (réseau faible)
const URLS_TO_CACHE = [
  '/canon-quiz/index.html',
  '/canon-quiz/beta.html'
];

// Une seule clé de cache par page (sans paramètres, "/canon-quiz/" = index.html)
function htmlKey(url) {
  var u = new URL(url);
  var p = u.pathname;
  if (p === '/canon-quiz' || p === '/canon-quiz/') p = '/canon-quiz/index.html';
  return u.origin + p;
}

function isHTMLRequest(req) {
  if (req.mode === 'navigate') return true;
  var p = new URL(req.url).pathname;
  return p === '/canon-quiz' || p === '/canon-quiz/' ||
         p === '/canon-quiz/index.html' || p === '/canon-quiz/beta.html';
}

// Contourne le cache du navigateur ET celui du CDN GitHub Pages
function freshFetch(url) {
  var u = new URL(url);
  u.searchParams.set('_sw', Date.now());
  return fetch(u.toString(), { cache: 'no-store', credentials: 'same-origin' });
}

// Réponse HTML "propre" (sans URL ni redirection d'origine) : évite les erreurs Safari
function htmlResponse(text) {
  return new Response(text, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function notifyClients(msg) {
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(function(cs) {
    cs.forEach(function(c) { c.postMessage(msg); });
  });
}

// ── Install : télécharge les pages en contournant tous les caches ─────────────
self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.all(URLS_TO_CACHE.map(function(path) {
        return freshFetch(self.location.origin + path).then(function(r) {
          if (!r || !r.ok) return;
          return r.text().then(function(t) { return cache.put(self.location.origin + path, htmlResponse(t)); });
        }).catch(function() {});
      }));
    })
  );
});

// ── Activate : supprime les anciens caches et prend la main immédiatement ────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key !== CACHE_NAME && key !== IMG_CACHE) return caches.delete(key);
      }));
    }).then(function() { return self.clients.claim(); })
  );
});

// ── Messages de l'application ───────────────────────────────────────────────
self.addEventListener('message', function(e) {
  if (!e.data) return;

  if (e.data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
    if (e.data.type === 'GET_VERSION') {
    if (e.ports && e.ports[0]) {
      e.ports[0].postMessage({ version: CACHE_NAME });
    }
    return;
  }

  if (e.data.type !== 'PRECACHE_IMAGES' || !Array.isArray(e.data.urls)) return;
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
      return notifyClients({ type: 'IMAGES_CACHED', ok: done, total: e.data.urls.length, added: added });
    });
  }));
});

// ── HTML : RÉSEAU D'ABORD (version la plus récente dès qu'on est en ligne) ────
// Renvoie { response, background } : background garde le SW en vie
// le temps de mettre à jour le cache, même si la page a été servie depuis le cache.
function handleHTML(req) {
  var key = htmlKey(req.url);
  var isNavigate = req.mode === 'navigate';
  var resolveBg;
  var background = new Promise(function(r) { resolveBg = r; });

  var response = caches.open(CACHE_NAME).then(function(cache) {
    return cache.match(key).then(function(cached) {
      var servedFromCache = false;
      // Lu tout de suite : la copie locale pourra ensuite être envoyée à la page
      var oldTextP = cached ? cached.clone().text().catch(function() { return null; }) : Promise.resolve(null);

      var network = freshFetch(req.url).then(function(r) {
        if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status));
        return r.text();
      }).then(function(newText) {
        oldTextP.then(function(oldText) {
          var changed = oldText !== null && oldText !== newText;
          return cache.put(key, htmlResponse(newText)).then(function() {
            // On prévient l'app seulement si elle affiche une ancienne version :
            // - vérification lancée par l'app (pas une navigation)
            // - ou page servie depuis le cache car le réseau était trop lent
            if (changed && (!isNavigate || servedFromCache)) return notifyClients({ type: 'UPDATE_AVAILABLE' });
          });
        }).catch(function() {}).then(function() { resolveBg(); });
        return htmlResponse(newText);
      });
      network.catch(function() { resolveBg(); });

      if (!cached) {
        // Pas de copie locale : on attend le réseau, sinon index.html en secours
        return network.catch(function() {
          return cache.match(self.location.origin + '/canon-quiz/index.html').then(function(fb) {
            return fb || new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
          });
        });
      }

      // Copie locale disponible : réseau prioritaire, mais pas plus de HTML_TIMEOUT_MS
      var timeout = new Promise(function(resolve) {
        setTimeout(function() { resolve('timeout'); }, HTML_TIMEOUT_MS);
      });
      return Promise.race([network.catch(function() { return 'error'; }), timeout]).then(function(res) {
        if (res === 'timeout' || res === 'error') {
          servedFromCache = true;
          return cached;
        }
        return res;
      });
    });
  }).catch(function(err) {
    resolveBg();
    return fetch(req);
  });

  return { response: response, background: background };
}

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  var url = e.request.url;

  // Laisser passer les appels Apps Script / Google
  if (url.indexOf('script.google.com') > -1 ||
      url.indexOf('script.googleusercontent.com') > -1 ||
      url.indexOf('googleapis.com') > -1 ||
      url.indexOf('gstatic.com') > -1 ||
      url.indexOf('fonts.') > -1) return;

  // Le sw.js lui-même n'est jamais servi depuis le cache
  if (url.indexOf('/canon-quiz/sw.js') > -1) return;

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

  // Pages de l'application : réseau d'abord
  if (isHTMLRequest(e.request) && url.indexOf(self.location.origin) === 0) {
    var h = handleHTML(e.request);
    e.respondWith(h.response);
    e.waitUntil(h.background);
    return;
  }

  // Autres ressources du site : cache + rafraîchissement en arrière-plan
  if (url.indexOf(self.location.origin) !== 0) return;
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
