// BLAMUNE Service Worker - offline cache + notifications push
const CACHE = 'blamune-v15';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/ia-secours.js',
  '/manifest.json',
  '/logo.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Requetes vers un autre domaine (le service de repli text.pollinations.ai
  // travaille en direct depuis la page, pas par le service worker) : on ne
  // touche pas, et surtout on ne recopie PAS ces reponses dans notre cache.
  if (url.origin !== self.location.origin) return;
  // Ne pas cacher les requetes API ni les appels dynamiques
  if (
    url.pathname.startsWith('/send') ||
    url.pathname.startsWith('/historique') ||
    url.pathname.startsWith('/mode') ||
    url.pathname.startsWith('/register') ||
    url.pathname.startsWith('/login') ||
    url.pathname.startsWith('/invite') ||
    url.pathname.startsWith('/logout') ||
    url.pathname.startsWith('/profil') ||
    url.pathname.startsWith('/stats') ||
    url.pathname.startsWith('/push') ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/ping') ||
    url.pathname.startsWith('/health') ||
    url.pathname.startsWith('/proactif') ||
    url.pathname.startsWith('/connexions') ||
    url.pathname.startsWith('/config-api') ||
    url.pathname.startsWith('/tous-les-messages')
  ) {
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
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(e.request);
      const reval = fetch(e.request)
        .then((r) => {
          if (r && r.ok) cache.put(e.request, r.clone());
          return r;
        })
        .catch(() => null);
      return cached || (await reval) || new Response('', { status: 504 });
    })()
  );
});

// ---------------- WEB PUSH (sprint E) ----------------
// La notification est dechiffree par le navigateur (aes128gcm) : le
// payload est notre JSON { titre, corps, url }. Clic : la page est ouverte,
// on la focus ; sinon on l'ouvre. Aucun appel reseau ici.
self.addEventListener('push', (e) => {
  let contenu = {};
  try {
    contenu = e.data ? e.data.json() : {};
  } catch (err) {}
  e.waitUntil(
    self.registration.showNotification(contenu.titre || 'BLAMUNE', {
      body: contenu.corps || 'BLAMUNE a quelque chose a te dire.',
      // icon-192 (192 px de vrai) et non logo.png (512 x 512 reels) : moins
      // de pixels a decoder a CHAQUE notification ; le badge, lui, ne garde
      // lui, ne garde que la silhouette alpha.
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'blamune',
      data: { url: contenu.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const cible = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    (async () => {
      const liste = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Une fenetre DEJA sur la cible : on la focus, point. L'ancienne
      // version focusait la premiere venue, meme si elle etait sur une
      // tout autre page (ex. /admin) : la notification envoyait vers
      // /discuter sans que rien ne change a l'ecran.
      let cheminCible = null;
      try {
        cheminCible = new URL(cible, self.location.origin).pathname;
      } catch (errUrl) {
        cheminCible = null;
      }
      if (cheminCible) {
        for (const fenetre of liste) {
          try {
            if (new URL(fenetre.url, self.location.origin).pathname === cheminCible) {
              if ('focus' in fenetre) return fenetre.focus();
            }
          } catch (errFen) {
            /* url non parseable : fenetre suivante */
          }
        }
      }
      // Sinon on navigue une fenetre existante (pas de doublon d'onglet),
      // et seulement a defaut on en ouvre une.
      for (const fenetre of liste) {
        if ('navigate' in fenetre && fenetre.url.startsWith(self.location.origin)) {
          try {
            return await fenetre.navigate(cible);
          } catch (errNav) {
            break; // navigation hors-scope : tenter openWindow
          }
        }
      }
      return self.clients.openWindow(cible);
    })()
  );
});
