// =====================================================================
//  Tension du pool : comptage des 429 + "mode eco"
// =====================================================================
//  La tension doit se VOIR et apporter une reponse, pas seulement
//  etre encaisee. Chaque 429 reellement constate passe par marquerQuota()
//  marquerQuota() dans lib/ia/gemini.js — et ce marquage est LE goulot
//  unique partagé par la voie Gemini directe et la voie pool OpenAI
//  (server.js injecte la même fonction aux deux). Ce module garde la
//  fenêtre des 429 et en tire un drapeau "mode eco" :
//
//    - recherche web AUTO : suspendue (les questions d'actu ne partent
//      plus déclencher des téléchargements),
//    - /cherche : dégradé en extraits seuls (0 page lue) au lieu de 4,
//    - taches de fond (resume, extraction, apprentissage) : suspendues
//      via reporterTache() — elles reprennent au message suivant,
//    - retour a la normal naturel : la fenêtre se vide quand les 429
//      ont fini de vieillir, avec un séjour minimum en eco pour ne pas
//      clignoter sous la charge.
//
//  Le module ne bloque RIEN et ne décide pas QUI appelle : il ne fait
//  que compter et répondre "tension ou pas". Singleton volontaire (comme
//  lib/rate_limit.js) : un seul état de tension par processus, réglable
//  via l'environnement, réinitialisable pour les tests.
// =====================================================================
'use strict';

// Fenetre des 429 comptes ensemble (5 min), seuil de declenchement de
// l'eco (3 dans la fenetre) et duree minimum passee en eco avant retour
// possible (10 min). Surchargeables par TENSION_FENETRE_MS / TENSION_SEUIL /
// TENSION_SEJOUR_MS.
const FENETRE_MS = parseInt(process.env.TENSION_FENETRE_MS || '', 10) || 5 * 60 * 1000;
const SEUIL = parseInt(process.env.TENSION_SEUIL || '', 10) || 3;
const SEJOUR_MIN_MS = parseInt(process.env.TENSION_SEJOUR_MS || '', 10) || 10 * 60 * 1000;

// Instants des 429 de la fenetre (ordre croissant).
const notes = [];
// Instant du passage en eco (0 = pas en eco).
let ecoDepuis = 0;
// Compteur "du jour" : toISOString().slice(0,10) change a minuit UTC.
let jour429 = null;
let nb429Jour = 0;
// Taches de fond suspendues pendant l'eco (chiffre lisible pour /admin).
let tachesSuspendues = 0;

function jourDe(instant) {
  return new Date(instant).toISOString().slice(0, 10);
}

// File de fenetre : supprime les notes devenues plus vieilles que FENETRE_MS.
function purger(instant) {
  while (notes.length && notes[0] < instant - FENETRE_MS) notes.shift();
}

/** A appeler a CHAQUE 429 reellement constate (marquerQuota est le goulot). */
function noter(instant) {
  const epoch = instant || Date.now();
  const jour = jourDe(epoch);
  if (jour !== jour429) {
    jour429 = jour;
    nb429Jour = 0;
  }
  nb429Jour++;
  notes.push(epoch);
  purger(epoch);
}

/**
 * Drapeau de tension. Appeler ce qu'on veut FREINER quand il vaut true.
 * Arme le drapeau des que la fenetre compte SEUIL notes ; le laisse
 * actif au minimum SEJOUR_MIN_MS, puis le retient tant qu'il reste des
 * notes dans la fenetre (retour a zero naturel quand plus de 429 vivant).
 */
function enTension(instant) {
  const epoch = instant || Date.now();
  purger(epoch);
  if (ecoDepuis) {
    const calme = notes.length < SEUIL;
    if (epoch - ecoDepuis >= SEJOUR_MIN_MS && calme) ecoDepuis = 0;
    else return true;
  }
  if (notes.length >= SEUIL) {
    ecoDepuis = epoch;
    return true;
  }
  return false;
}

/** Compte une tache de fond jetee pendant l'eco (pour /admin). */
function tacheSuspendue() {
  tachesSuspendues++;
}

/** Etat lisible pour /admin et /health. */
function etat(instant) {
  const epoch = instant || Date.now();
  purger(epoch);
  return {
    eco: ecoDepuis > 0,
    ecoDepuis,
    fenetreMs: FENETRE_MS,
    seuil: SEUIL,
    nb429Fenetre: notes.length,
    nb429Jour,
    tachesSuspendues,
    sejourMinMs: SEJOUR_MIN_MS
  };
}

/** Remise a zero de tous les compteurs (tests uniquement). */
function reinitialiser() {
  notes.length = 0;
  ecoDepuis = 0;
  jour429 = null;
  nb429Jour = 0;
  tachesSuspendues = 0;
}

module.exports = { noter, enTension, tacheSuspendue, etat, reinitialiser };
