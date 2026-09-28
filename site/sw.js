// BLAMUNE Service Worker - offline cache
const CACHE = 'blamune-v9';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/logo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Ne pas cacher les requetes API ni les appels dynamiques
  if (url.pathname.startsWith('/send') || url.pathname.startsWith('/historique') ||
      url.pathname.startsWith('/mode') || url.pathname.startsWith('/register') ||
      url.pathname.startsWith('/login') || url.pathname.startsWith('/invite') ||
      url.pathname.startsWith('/logout') || url.pathname.startsWith('/profil') ||
      url.pathname.startsWith('/stats') || url.pathname.startsWith('/admin') ||
      url.pathname.startsWith('/ping') || url.pathname.startsWith('/health') ||
      url.pathname.startsWith('/proactif') ||
      url.pathname.startsWith('/connexions') || url.pathname.startsWith('/config-api') ||
      url.pathname.startsWith('/tous-les-messages')) {
    return;
  }
  // Page (HTML) : network d'abord pour avoir toujours la derniere version,
  // cache en secours si le reseau tombe.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const clone = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // Assets (css/js/logo) : cache d'abord -> chargement instantane a chaque
  // visite, revalidation en arriere-plan pour recuperer une nouvelle version.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);
    const reval = fetch(e.request).then((r) => {
      if (r && r.ok) cache.put(e.request, r.clone());
      return r;
    }).catch(() => null);
    return cached || (await reval) || new Response('', { status: 504 });
  })());
});
