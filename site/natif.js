// BLAMUNE - adaptation a l'application native (Capacitor Android/iOS).
//
// Charge AVANT app.js (voir index.html, journal.html et push.html). Dans un
// navigateur, ce fichier ne fait strictement rien : le site continue de
// parler a son propre serveur avec des chemins relatifs.
//
// Dans l'application, la page est servie depuis le stockage local de la
// WebView (https://localhost sur Android, capacitor://localhost sur iOS).
// Les assets (HTML/CSS/JS) sont donc locaux, mais l'API reste distante :
// on prefixe les fetch relatifs par l'adresse du serveur.
(function () {
  'use strict';

  var protocole = window.location.protocol;
  var hote = window.location.hostname;
  // Capacitor n'utilise jamais de port : exiger l'absence de port evite de
  // prendre un serveur de developpement https://localhost:8443 pour l'app.
  var natif =
    protocole === 'capacitor:' ||
    (protocole === 'https:' && hote === 'localhost' && !window.location.port);
  if (!natif) return;

  // Adresse du serveur de production. La changer ici ET dans la fiche du
  // store si le deploiement Render est renomme.
  var API = 'https://blamune.onrender.com';

  window.BLAMUNE_NATIF = true;
  window.BLAMUNE_API = API;

  // fetch relatif -> absolu. Les URLs deja absolues (IA de secours
  // text.pollinations.ai) ne sont pas touchees.
  var fetchOriginal = window.fetch ? window.fetch.bind(window) : null;
  if (fetchOriginal) {
    window.fetch = function (entree, init) {
      if (typeof entree === 'string' && entree.charAt(0) === '/') {
        entree = API + entree;
      }
      return fetchOriginal(entree, init);
    };
  }
})();
