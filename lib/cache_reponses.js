// =====================================================================
//  Cache de reponses : le small talk ne recoit PLUS d'appel au modele
// =====================================================================
//  Sur un chat public, une grande part des messages sont identiques :
//  "ca va ?", "merci", "presente-toi", "c'est quoi ton nom ?". Chacun
//  partait au pool de l'IA. Ce cache sert a la question SIMPLE (cle
//  normalisee : casse, accents, ponctuation, espaces) une reponse deja
//  payee recemment : ZERO appel IA, ZERO tokens pour les suivants.
//
//  Ce qui n'est PAS cachable :
//    - un message avec photo, ou une commande ("/cherche", ...) ;
//    - un message plus long que CACHE_REPONSES_MOTS mots : au-dela,
//      c'est une vraie conversation, la personnalite joue ;
//    - un message avec des indices de memoire personnelle (nom, gouts...,
//      indiceMemoire) : la reponse depend de l'utilisateur, elle ne se
//      partage pas ;
//    - un message ayant pu inclure un bloc de recherche web (rechercheBloc) :
//      du "jour" ne se reutilise pas plus tard.
//
//  A LA RETENTION, deux regles de plus :
//    - une reponse qui nomme le pseudo du visiteur ne se cache pas :
//      chaque BLAMUNE s'adresse a SA personne ;
//    - une reponse trop courte (moins de 12 caracteres) : pas un vrai
//      texte de conversation, c'est peut-etre une erreur/repli.
//
//  TTL par defaut (45 min) borne la variation de l'humeur et de l'etat
//  interieur : une reponse reutilisee ne peut pas mener une conversation
//  de plusieurs jours avec un vieux texte. Le mode (2/1) reste dans la
//  cle : une reponse "EGO" ne serait pas reutilisee pour BLAMUNE.
// =====================================================================
'use strict';

// La valeur 0 EST admise (suite de tests : cache desactive) — d'ou le
// parseur entierEnv, contrairement a un `x || defaut` qui tuerait le 0.
function entierEnv(nom, defaut) {
  const v = parseInt(process.env[nom] || '', 10);
  return Number.isInteger(v) && v >= 0 ? v : defaut;
}
const MAX_ENTREES = entierEnv('CACHE_REPONSES_MAX', 200);
const TTL_MS = entierEnv('CACHE_REPONSES_MS', 45 * 60 * 1000);
const MAX_MOTS = entierEnv('CACHE_REPONSES_MOTS', 12);

// LRU honnete : Map (ordre d'insertion). A chaque reponse, la place est
// rajeunie (delete + set) ; au debordement du plafond, la PLUS ANCIENNE
// est evaincue (premiere cle de la Map).
const map = new Map();
let coups = 0;
let rater = 0;

/** Cle normalisee d'un message ; null si le message n'est pas cacheable. */
function cle(mode, msg, opts) {
  const opt = opts || {};
  if (opt.imageParts || msg === '(photo)') return null;
  if (msg.startsWith('/')) return null;
  const nbMots = msg.split(/\s+/).filter(Boolean).length;
  if (nbMots === 0 || nbMots > MAX_MOTS) return null;
  if (opt.indiceMemoire && opt.indiceMemoire(msg)) return null;
  if (opt.rechercheBloc && opt.rechercheBloc.length) return null;
  const brut = [
    mode || '2',
    msg
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
  ].join('|');
  // Toute la ponctuation ET les espaces partent : "  ca va ?" et "CA VA"
  // s'egalisent exactement ; les caracteres alphanumeriques restants
  // suffisent a distinguer deux questions differentes.
  return brut.replace(/[^a-z0-9|]/gi, '');
}

/** Reponse en cache pour cette cle (et rajeunissement LRU), sinon null. */
function repondre(cleMsg) {
  if (!cleMsg) {
    rater++;
    return null;
  }
  const entree = map.get(cleMsg);
  if (!entree || Date.now() - entree.cree > TTL_MS) {
    if (entree) map.delete(cleMsg);
    rater++;
    return null;
  }
  map.delete(cleMsg);
  map.set(cleMsg, entree);
  coups++;
  return entree.texte;
}

/** Retient une reponse MODELE du chat simple. Retourne true si retenu. */
function retenir(cleMsg, texte, opts) {
  const opt = opts || {};
  if (!cleMsg || !texte) return false;
  const t = String(texte).trim();
  if (t.length < 12 || t.length > 1200) return false;
  if (opt.pseudo && t.toLowerCase().includes(String(opt.pseudo).toLowerCase())) return false;
  if (map.size >= MAX_ENTREES) {
    // Evainc la plus ancienne (premiere cle d'insertion de la Map).
    const plusVieille = map.keys().next().value;
    map.delete(plusVieille);
  }
  map.set(cleMsg, { texte: t, cree: Date.now() });
  return true;
}

/** Etat lisible pour /admin et /health. */
function etat() {
  return { entrees: map.size, max: MAX_ENTREES, ttlMs: TTL_MS, coups, rater };
}

/** Remise a zero pour les tests. */
function reinitialiser() {
  map.clear();
  coups = 0;
  rater = 0;
}

module.exports = { cle, repondre, retenir, etat, reinitialiser };
