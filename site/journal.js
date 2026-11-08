// Journal public du bot : des NOMBRES seulement. Le contenu des faits
// appris reste prive ; cette page ne lit que des compteurs agreges.
window.addEventListener('DOMContentLoaded', function () {
  var t = window.I18N
    ? window.I18N.t
    : function (c) {
        return c;
      };
  // Les data-i18n statiques sont deja traduits par langues.js ; ici on
  // traduit le reste (sous-titre, titre d'onglet, cartes venues du serveur).
  document.title = t('Journal du bot') + ' - BLAMUNE';
  var sous = document.querySelector('.journal-tete p');
  if (sous) sous.textContent = t('Les bonnes surprises du jour');

  fetch('/journal')
    .then(function (r) {
      return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status));
    })
    .then(function (j) {
      if (!j || !j.ok) throw new Error('refus');
      var d = new Date((j.date || Math.floor(Date.now() / 1000)) * 1000);
      var titre = document.getElementById('journal-date');
      if (titre) titre.textContent = d.toLocaleDateString();
      var s = j.savoir || {};
      var cartes = [
        [s.appris, t('faits appris au total')],
        [s.semaine, t('appris cette semaine')],
        [j.conversations, t('messages échangés')],
        [j.appreciees, t('réponses notées 👍/👎')],
        [j.bonnesReponses, t('réponses jugées bonnes')],
        [j.joursActif, t("jours d'activité")]
      ];
      if (j.membres !== null && j.membres !== undefined)
        cartes.push([j.membres, t('membres inscrits')]);
      var g = document.getElementById('journal-grille');
      if (!g) return;
      g.textContent = '';
      cartes.forEach(function (c) {
        var carte = document.createElement('div');
        carte.className = 'journal-carte';
        var b = document.createElement('b');
        b.textContent = String(c[0] === undefined ? 0 : c[0]);
        var span = document.createElement('span');
        span.textContent = c[1];
        carte.appendChild(b);
        carte.appendChild(span);
        g.appendChild(carte);
      });
    })
    .catch(function () {
      // Serveur injoignable : un message honnete plutot qu'une carte
      // muette. On n'invente pas des 0 pour faire joli.
      var g = document.getElementById('journal-grille');
      if (!g) return;
      g.textContent = '';
      var carte = document.createElement('div');
      carte.className = 'journal-carte journal-carte-large';
      carte.textContent = t('Journal indisponible pour le moment.');
      g.appendChild(carte);
    });
});
