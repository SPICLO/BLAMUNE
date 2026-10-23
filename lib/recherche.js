// =====================================================================
//  RECHERCHE DANS L'HISTORIQUE
// =====================================================================
//  Sprint E. Petit module extrait pour etre testable sans Express
//  (tests/lib.test.js). Pur : aucune dependance, aucune IO — un filtre
//  memoire sur une liste deja chargee par chargerHistorique().
//
//  Deux regles a ne jamais casser :
//   1. La recherche fouille l'historique INTEGRAL. Le fil normal
//      n'affiche que HISTO_AFFICHAGE_MAX bulles (au-dela, le rendu DOM
//      fige la page) ; le fichier entier reste sur disque — chercher
//      sert precisement a retrouver ce qui n'est plus a l'ecran.
//   2. Insensible a la casse ET aux accents : "paris" rejoint "Paris",
//      "fevrier" joighe "février". On normalise les DEUX cotes.
// =====================================================================
'use strict';

function sansAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normaliser(s) {
  return sansAccents(String(s || ''))
    .toLowerCase()
    .trim();
}

const TAILLE_MIN = 2; // un seul caractere = trop de bruit, pas de recherche
const MAX_RESULTATS = 40; // au-dela, la liste serait inexploitable a lire

function creerRecherche() {
  /**
   * Filtre un historique (tableau de bulles {qui, texte, t, image}).
   * Renvoie null si q est vide ou trop court (mode fil normal),
   * sinon { total, liste } : total = nombre de correspondances, liste =
   * les MAX_RESULTATS plus recentes dans l'ordre chronologique.
   */
  function filtrerHistorique(hist, q) {
    const nq = normaliser(q);
    if (nq.length < TAILLE_MIN) return null;
    const cible = Array.isArray(hist) ? hist : [];
    const liste = cible.filter((m) => normaliser(m && m.texte ? m.texte : '').indexOf(nq) >= 0);
    return { total: liste.length, liste: liste.slice(-MAX_RESULTATS) };
  }

  return { filtrerHistorique, normaliser, tailleMin: TAILLE_MIN, maxResultats: MAX_RESULTATS };
}

module.exports = { creerRecherche };
