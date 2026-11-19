// =====================================================================
//  Pages legales : choix de la langue et du theme
// =====================================================================
//  Deux versions completes (francais, anglais) vivent dans la meme page :
//  sans JavaScript, le francais reste lisible. Ce fichier ne fait que
//  basculer les blocs et reprendre le theme deja choisi sur le site.
// =====================================================================
'use strict';

(function () {
  var CLE_LANGUE = 'blamune_langue';

  function langueInitiale() {
    var choix = '';
    try {
      choix = localStorage.getItem(CLE_LANGUE) || '';
    } catch (e) {}
    if (choix === 'en') return 'en';
    if (choix === 'fr') return 'fr';
    var navigateur = String(navigator.language || '').toLowerCase();
    return navigateur.indexOf('fr') === 0 ? 'fr' : 'en';
  }

  function appliquer(langue) {
    langue = langue === 'en' ? 'en' : 'fr';
    document.documentElement.lang = langue;
    document.documentElement.setAttribute('data-langue', langue);

    var contenus = document.querySelectorAll('[data-langue-contenu]');
    for (var i = 0; i < contenus.length; i++) {
      contenus[i].hidden = contenus[i].getAttribute('data-langue-contenu') !== langue;
    }

    var textes = document.querySelectorAll('[data-langue-texte]');
    for (var j = 0; j < textes.length; j++) {
      textes[j].hidden = textes[j].getAttribute('data-langue-texte') !== langue;
    }

    var boutons = document.querySelectorAll('[data-langue]');
    for (var k = 0; k < boutons.length; k++) {
      if (boutons[k].tagName !== 'BUTTON') continue;
      boutons[k].setAttribute(
        'aria-pressed',
        boutons[k].getAttribute('data-langue') === langue ? 'true' : 'false'
      );
    }

    var titre =
      langue === 'en'
        ? document.documentElement.getAttribute('data-titre-en')
        : document.documentElement.getAttribute('data-titre-fr');
    if (titre) document.title = titre;

    var description =
      langue === 'en'
        ? document.documentElement.getAttribute('data-description-en')
        : document.documentElement.getAttribute('data-description-fr');
    var meta = document.querySelector('meta[name="description"]');
    if (meta && description) meta.setAttribute('content', description);
  }

  // Le site memorise deja le theme ('clair' ou 'sombre') : une page legale
  // ouverte depuis le meme navigateur doit rester dans la meme ambiance.
  try {
    if (localStorage.getItem('blamune_theme') === 'clair') {
      document.documentElement.setAttribute('data-theme', 'clair');
    }
  } catch (e) {}

  var boutonsLangue = document.querySelectorAll('button[data-langue]');
  for (var i = 0; i < boutonsLangue.length; i++) {
    boutonsLangue[i].addEventListener('click', function () {
      var langue = this.getAttribute('data-langue');
      // Comme sur le site : le choix survit au rechargement et se retrouve
      // en revenant dans l'application (meme cle 'blamune_langue').
      try {
        localStorage.setItem(CLE_LANGUE, langue);
      } catch (e) {}
      appliquer(langue);
    });
  }

  appliquer(langueInitiale());
})();
