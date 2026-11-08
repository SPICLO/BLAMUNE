// =====================================================================
//  Cache de reponses : le small talk ne recoit PLUS d'appel au modele
// =====================================================================
//  Sur un chat public, une grande part des messages sont identiques :
//  "ca va ?", "merci", "presente-toi", "c'est quoi ton nom ?". Chacun
//  partait au pool de l'IA. Ce cache sert a la question SIMPLE (cle
//  normalisee : casse, accents, ponctuation, espaces, PLUS la derniere
//  phrase du bot : une reponse n'est reusee qu'apres LA MEME question,
//  jamais apres une autre) une reponse deja payee recemment : ZERO appel IA, ZERO tokens pour les suivants.
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
//
//  DEUX NIVEAUX (audit phase 3, P3-2). Le cache contextuel ci-dessus ne
//  sert qu'a qui emploie la MEME question apres le MEME message du bot :
//  dans une conversation neuve (`avant` vide), il ne trouve jamais rien.
//  D'ou un niveau STABLE, pour les questions qui ne dependent d'aucune
//  conversation ("bonjour", "presente-toi", "comment tu t'appelles"),
//  reconnues par STABLE_QUESTIONS, avec un TTL plus court. Les coups sont
//  comptes SEPAREMENT (`coupsStable` / `coupsContextuel`) : le proprietaire
//  a tranche — si au bout de 2 semaines `coupsStable` reste a zero, le
//  niveau stable est SUPPRIME, pas garde par principe. `verdict()` le dit
//  tout seul pour que /admin n'ait rien a calculer.
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
// Compteurs separes (P3-2) et date de naissance du suivi : le verdict a
// deux semaines se calcule sur une fenetre REELLE, pas sur un souvenir.
let coupsStable = 0;
let coupsContextuel = 0;
const OBSERVATION_MS = 14 * 86400000;
const depuisObservation = Date.now();
// TTL du niveau stable : court, parce qu'une salutation reutilisee doit
// suivre l'humeur du moment (15 min par defaut).
const TTL_STABLE_MS = entierEnv('CACHE_STABLE_MS', 15 * 60 * 1000);

// Questions SANS contexte : le texte entier du message suffit a definir
// la reponse (casse, accents et ponctuation normalises avant comparaison).
// Rien de personnel, rien de date, aucune relance de conversation. Volontairement
// COURT : chaque ajout ici est une promesse "cette reponse ne depend de rien".
const STABLE_QUESTIONS = [
  'bonjour',
  'salut',
  'bonsoir',
  'hello',
  'hey',
  'yo',
  'coucou',
  'merci',
  'merci beaucoup',
  'au revoir',
  'a plus',
  'bonne nuit',
  'comment tu vas',
  'ca va',
  'tu vas bien',
  'comment vas tu',
  'qui es tu',
  'tu es qui',
  'qui est tu',
  'presente toi',
  'presentes toi',
  'comment tu t appelles',
  'tu t appelles comment',
  'c est quoi ton nom',
  'quel est ton nom',
  'ton nom',
  'tu es une ia',
  'es tu une ia',
  'qu est ce que tu es',
  'c est quoi blamune',
  'qui est blamune',
  'bienvenue'
];
const STABLES = new Set(STABLE_QUESTIONS);

function normaliser(msg) {
  return String(msg)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Question sans contexte ? Alors le niveau stable peut la servir. */
function estStable(msg) {
  return STABLES.has(normaliser(msg));
}

/** La cle appartient-elle au niveau stable ? (bloc final termine par `s`) */
function estCleStable(cleMsg) {
  return String(cleMsg).split('|').pop().endsWith('s');
}

/** Cle normalisee d'un message ; null si le message n'est pas cacheable. */
function cle(mode, msg, opts) {
  const opt = opts || {};
  if (opt.imageParts || msg === '(photo)') return null;
  if (msg.startsWith('/')) return null;
  const nbMots = msg.split(/\s+/).filter(Boolean).length;
  if (nbMots === 0 || nbMots > MAX_MOTS) return null;
  if (opt.indiceMemoire && opt.indiceMemoire(msg)) return null;
  if (opt.rechercheBloc && opt.rechercheBloc.length) return null;
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}+/gu, '');
  // Niveau STABLE (P3-2) : `avant` est ignore, et un `s` colle au dernier
  // bloc (alphanumerique, il survit au filtre) marque la famille. Une
  // reponse stable ne peut donc jamais etre servie au milieu d'un fil, ni
  // l'inverse.
  if (!opt.avant && estStable(msg))
    return [mode || '2', norm(msg).replace(/[^a-z0-9]/gi, '') + 's'].join('|');
  const brut = [mode || '2', norm(msg)];
  // CONTEXTE DE CONVERSATION (bug corrige) : quand le bot pose une question
  // et que le visiteur repond ("oui", "la pizza", "vas y"), la reponse
  // n'a de sens qu'A CETTE question. Sans le message precedent du bot dans
  // la cle, deux "oui" de deux discussions differentes s'egalisaient et le
  // cache servait une reponse sans rapport avec le fil. Toute la
  // ponctuation ET les espaces partent : les caracteres alphanumeriques
  // restants suffisent a distinguer deux contextes.
  if (opt.avant) brut.push(norm(opt.avant).substring(0, 200));
  return brut.join('|').replace(/[^a-z0-9|]/gi, '');
}

/** Reponse en cache pour cette cle (et rajeunissement LRU), sinon null. */
function repondre(cleMsg) {
  if (!cleMsg) {
    rater++;
    return null;
  }
  const entree = map.get(cleMsg);
  // Chaque niveau a son TTL : le stable expire plus vite.
  const ttl = estCleStable(cleMsg) ? TTL_STABLE_MS : TTL_MS;
  if (!entree || Date.now() - entree.cree > ttl) {
    if (entree) map.delete(cleMsg);
    rater++;
    return null;
  }
  map.delete(cleMsg);
  map.set(cleMsg, entree);
  coups++;
  if (entree.stable) coupsStable++;
  else coupsContextuel++;
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
  map.set(cleMsg, { texte: t, cree: Date.now(), stable: estCleStable(cleMsg) });
  return true;
}

/**
 * Verdict sur le niveau STABLE (decision du proprietaire, P3-2) :
 *   - `indetermine` : la fenetre de 14 jours n'est pas finie ;
 *   - `utile` : au moins un coup stable a servi ;
 *   - `aSupprimer` : deux semaines passees, ZERO coup stable -> le niveau
 *     stable ne rend service a personne, il se retire (pas "garder par
 *     principe"). Jours restants exposes pour que /admin le dise avant
 *     l'echeance, pas apres.
 */
function verdict() {
  const ecoule = Date.now() - depuisObservation;
  const jours = Math.floor(ecoule / 86400000);
  if (coupsStable > 0) return { verdict: 'utile', jours };
  if (ecoule >= OBSERVATION_MS) return { verdict: 'aSupprimer', jours: 14 };
  return { verdict: 'indetermine', jours, reste: 14 - jours };
}

/** Etat lisible pour /admin et /health. */
function etat() {
  return {
    entrees: map.size,
    max: MAX_ENTREES,
    ttlMs: TTL_MS,
    ttlStableMs: TTL_STABLE_MS,
    coups,
    rater,
    coupsStable,
    coupsContextuel,
    observation: verdict()
  };
}

/** Remise a zero pour les tests. */
function reinitialiser() {
  map.clear();
  coups = 0;
  rater = 0;
  coupsStable = 0;
  coupsContextuel = 0;
}

module.exports = { cle, repondre, retenir, etat, reinitialiser, estStable };
