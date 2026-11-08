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

// Singleton voisin : la pression locale (file, debordements) du limiteur
// de concurrence alimente l'eco PREEMPTIF (voir enTension).
const concurrence = require('./concurrence');

// Instants des 429 de la fenetre (ordre croissant).
const notes = [];
// Instant du passage en eco (0 = pas en eco).
let ecoDepuis = 0;
// Compteur "du jour" : toISOString().slice(0,10) change a minuit UTC.
let jour429 = null;
let nb429Jour = 0;
// JOURNAL D'ENTREE/SORTIE (phase 3, P3-3) : l'eco pouvait s'armer 90 s par
// trois debordements et couper la recherche web SANS laisser de trace. On
// n'ecrit qu'aux transitions (jamais a chaque appel) ; qui ecrit est injecte
// (logger), le module reste sans dependance de journal.
const CAUSES = { debordements: 0, file: 0, 429: 0 };
let logger = null;
let ecoEffectif = false; // etat de la derniere evaluation (transitions)
let ecoCause = '';
// Taches de fond suspendues pendant l'eco (chiffre lisible pour /admin).
let tachesSuspendues = 0;
// Heure d'entree de la derniere sequence PREEMPTIVE (P3-3). Distincte de
// ecoDepuis : les personnes qui posent un rapport SANS reference (voir
// etat(instant)) ne lisent de toute facon que le cas reel (instant absent).
let preemptifEntreeLe = 0;

// ECO PREEMPTIF : ne pas ATTENDRE les 429 du fournisseur pour s'armer.
// La pression locale deja comptee (lib/concurrence.js) est un signal
// PRECOCE : une file qui grossit ou des debordements qui s'accumulent
// disent "surcharge en cours" des maintenant. Couper recherche web et
// taches de fond a ce moment evite de pousser le pool jusqu'aux 429
// (moins de cooldowns, moins de clignotement, le pool sert le chat).
const PREEMPT_FILE = parseInt(process.env.TENSION_PREEMPT_FILE || '', 10) || 30;
const PREEMPT_DEB = parseInt(process.env.TENSION_PREEMPT_DEB || '', 10) || 3;
// Sejour minimal apres une pression locale (anti-clignotement, comme
// le sejour eco des 429).
const PREEMPT_SEJOUR_MS = parseInt(process.env.TENSION_PREEMPT_SEJOUR_MS || '', 10) || 90000;
let preemptifDepuis = 0;

function jourDe(instant) {
  return new Date(instant).toISOString().slice(0, 10);
}

/** Une fonction logger(msg) ; le serveur y branche loggerErreur('tension', msg).
 *  Sans elle, le module reste silencieux (tests, scripts). */
function configurerJournal(fn) {
  logger = typeof fn === 'function' ? fn : null;
}

/** Quelle pression locale arme l'eco preemptif ? Sert au journal et a /health. */
function causePression() {
  const e = concurrence.etat();
  if (e.file >= PREEMPT_FILE) return 'file';
  if (e.debordementsFenetre >= PREEMPT_DEB) return 'debordements';
  return '';
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

/** Pression locale ACTUELLE (file ou debordements recents). N'a de sens
 *  qu'avec l'horloge reelle : jamais jugee avec un instant de test passe,
 *  sinon les etats historiques de 1970 des tests ressembleraient a une
 *  surcharge actuelle. */
function pressionLocale() {
  return !!causePression();
}

/**
 * Drapeau de tension. Appeler ce qu'on veut FREINER quand il vaut true.
 * Arme le drapeau des que la fenetre compte SEUIL notes ; le laisse
 * actif au minimum SEJOUR_MIN_MS, puis le retient tant qu'il reste des
 * notes dans la fenetre (retour a zero naturel quand plus de 429 vivant).
 *
 * PREEMPTIF : un appel SANS instant (l'usage production) lit AUSSI la
 * pression locale de concurrence.js et renvoie true tant qu'elle dure
 * (sejours anti-clignotement PREEMPT_SEJOUR_MS). Un appel AVEC instant
 * (tests, lecctures historiques) retient uniquement le protocole 429.
 */
function enTension(instant) {
  const e = calculer(instant);
  journaliserTransitions(e);
  return e.eco;
}

/** Le calcul pur : qui est en eco, et pourquoi. Aucun effet de journal. */
function calculer(instant) {
  const epoch = instant || Date.now();
  let cause = '';
  if (instant === undefined) {
    cause = causePression();
    if (cause) {
      if (!preemptifDepuis) preemptifDepuis = epoch;
      return { eco: true, cause: cause };
    }
    // Pas de pression : le sejour anti-clignotement tient encore un peu.
    if (preemptifDepuis && epoch - preemptifDepuis < PREEMPT_SEJOUR_MS)
      return { eco: true, cause: 'preemptif-sejour' };
    preemptifDepuis = 0;
  }
  purger(epoch);
  if (ecoDepuis) {
    const calme = notes.length < SEUIL;
    if (epoch - ecoDepuis >= SEJOUR_MIN_MS && calme) ecoDepuis = 0;
    else return { eco: true, cause: '429' };
  }
  if (notes.length >= SEUIL) {
    ecoDepuis = epoch;
    return { eco: true, cause: '429' };
  }
  return { eco: false, cause: '' };
}

// Ne s'ecrit qu'aux TRANSITIONS : une entree, une sortie. Un journal par
// appel inonderait erreurs.log sous la charge, exactement quand on en a le
// plus besoin.
function journaliserTransitions(e) {
  if (e.eco === ecoEffectif) {
    if (e.eco && e.cause !== ecoCause) ecoCause = e.cause;
    return;
  }
  ecoEffectif = e.eco;
  ecoCause = e.cause;
  // L'ENTREE dans le preemptif est datable (phase 3, P3-3) : etat() publie
  // `eco: true` pour lui AUSSI, avec l'heure. Avant, seule la voie 429
  // posait ecoDepuis : `entrees.debordements` montait sans que `eco` passe a
  // true, et /stats-perso annoncait "tout va bien" pendant l'eco.
  // A l'epoque de la fenetre 429, on n'y touche pas : ce champ reste le
  // seuil des 429, que les lectures datees (tests) utilisent.
  if (e.eco && (e.cause === 'file' || e.cause === 'debordements')) {
    if (!preemptifEntreeLe) preemptifEntreeLe = Date.now();
  } else if (!e.eco) {
    preemptifEntreeLe = 0;
  }
  // LES COMPTEURS montent MEME SANS JOURNAL (P3-3). Le test l'a montre :
  // avec un logger absent (module charge seul, /stats, scripts), `entrees`
  // restait a zero et l'observation tant attendue ne voyait rien. Le
  // journal reste, l'observation aussi.
  if (e.eco) {
    if (e.cause === 'file' || e.cause === 'debordements') CAUSES[e.cause]++;
    else if (e.cause === '429') CAUSES['429']++;
  }
  if (!logger) return;
  if (e.eco) {
    const detail =
      e.cause === 'debordements'
        ? ' (debordements de file en fenetre)'
        : e.cause === 'file'
          ? ' (file > ' + PREEMPT_FILE + ')'
          : e.cause === '429'
            ? ' (' + notes.length + ' 429 en fenetre)'
            : '';
    logger('eco active : cause=' + e.cause + detail);
  } else {
    logger('eco levee : recherche web auto et taches de fond reprennent');
  }
}

/** Compte une tache de fond jetee pendant l'eco (pour /admin). */
function tacheSuspendue() {
  tachesSuspendues++;
}

/** Etat lisible pour /admin et /health. Sans effet : ne journalise pas. */
function etat(instant) {
  const epoch = instant || Date.now();
  purger(epoch);
  // La cause est celle du dernier calcul reel (enTension), pas recalculee
  // ici : etat() est appele par des sondes, il ne doit pas changer le monde.
  // Le preemptif est lu DIRECTEMENT (pression locale ou sejour) et non le
  // type de cause : entre deux enTension(), la pression peut etre apparue
  // sans qu'aucun message ne passe encore.
  const preemptif = instant === undefined && (preemptifDepuis > 0 || pressionLocale());
  const eco = ecoDepuis > 0 || preemptif;
  const cause = eco ? (preemptif ? ecoCause || 'preemptif' : ecoCause || '429') : '';
  return {
    eco,
    ecoDepuis: ecoDepuis || preemptifEntreeLe,
    cause,
    preemptif,
    preemptifDepuis,
    fenetreMs: FENETRE_MS,
    seuil: SEUIL,
    nb429Fenetre: notes.length,
    nb429Jour,
    tachesSuspendues,
    sejourMinMs: SEJOUR_MIN_MS,
    // Combien de fois l'eco a ete arme, par cause, depuis le demarrage :
    // 3 fois "debordements" en une heure disent un PREEMPT_DEB trop bas.
    entrees: Object.assign({}, CAUSES)
  };
}

/** Remise a zero de tous les compteurs (tests uniquement). */
function reinitialiser() {
  notes.length = 0;
  ecoDepuis = 0;
  jour429 = null;
  nb429Jour = 0;
  tachesSuspendues = 0;
  preemptifDepuis = 0;
  preemptifEntreeLe = 0;
  CAUSES.debordements = 0;
  CAUSES.file = 0;
  CAUSES['429'] = 0;
  ecoEffectif = false;
  ecoCause = '';
}

module.exports = {
  noter,
  enTension,
  tacheSuspendue,
  etat,
  configurerJournal,
  reinitialiser
};
