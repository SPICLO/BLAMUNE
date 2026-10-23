// BLAMUNE Service Worker - offline cache + notifications push
const CACHE = 'blamune-v11';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/ia-navigateur.js',
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
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Requetes vers un autre domaine (Hugging Face : config et poids du
  // modele IA hors-ligne) : on ne touche pas, et surtout on ne recopie PAS
  // ces reponses dans notre cache (WebLLM possede le sien ; une copie ici
  // ferait ~1 Go de perdu). Le bundle ia-webllm.mjs, lui, reste chez nous.
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
      icon: '/logo.png',
      badge: '/logo.png',
      tag: 'blamune',
      data: { url: contenu.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const cible = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((liste) => {
      for (const fenetre of liste) {
        if ('focus' in fenetre) return fenetre.focus();
      }
      return self.clients.openWindow(cible);
    })
  );
});
