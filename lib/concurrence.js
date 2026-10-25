// =====================================================================
//  Limiteur de concurrence IA + file d'attente equitable
// =====================================================================
//  Le probleme que ce module coupe : plusieurs visiteurs qui envoient un
//  message au MÊME instant envoient tous ensemble leur appel au pool IA.
//  Meme en respectant les limites par IP/utilisateur (30/min, 20/min),
//  une rafale de 8 echanges simultanes cree 8 appels concurrents et
//  provoque des 429 en chaine arbitraires (quand le fournisseur ecrase
//  les bandes-par-minute en prediction de charge).
//
//  Le principe : un semaphore comptant les appels IA EN COURS. Audela
//  de MAX_CONC places, les suivants sont marques dans UNE FILE ordonnee
//  (premier arrive, premier servi) et partent des qu'une place se libere.
//  Si l'attente depasse MAX_ATTENTE_MS, on laisse passer le demandeur
//  (fail-open, on ne fait JAMAIS perdre un message) et on compte un
//  "debordement" pour /admin : la file sert a lisser, pas a bloquer.
//
//  Client : pendant l'attente il voit ses points de suspension habituels
//  (la bulle d'echo est deja affichee avant le premier jeton) ; et la
//  ligne :diag du flux SSE porte le temps attendu en file.
//
//  Invocation : lib/routes/send.js attend une place juste AUTOUR de
//  l'appel au modele (la ressource rare), pas pendant la recherche web
//  (reseau du serveur, pas quota de pool). Singleton volontaire, comme
//  lib/rate_limit.js : un comptage honnete pour tout le processus.
// =====================================================================
'use strict';

let max = parseInt(process.env.MAX_CONC || '', 10) || 3; // places simultanees
let MAX_ATTENTE_MS = parseInt(process.env.MAX_ATTENTE_MS || '', 10) || 10000;

// FIFO : { resolve, annuler } dans l'ordre d'arrivee.
const file = [];
let enCours = 0;
// Debordements : demandeurs passes par manque de place (fail-open).
let debordements = 0;
let jourDebordements = null;
let debordementsJour = 0;

function jourDe(instant) {
  return new Date(instant).toISOString().slice(0, 10);
}

function nouvellePlace() {
  const place = {
    libre: false,
    attenteMs: 0,
    liberrer() {
      if (place.libre) return; // idempotent : jamais une double liberte
      place.libre = true;
      enCours = Math.max(0, enCours - 1);
      pomper();
    }
  };
  enCours++;
  return place;
}

// Sert la file tant que des places sont libres : premier arrive, premier
// servi. Un setTimeout apres corps de file ne peut pas doubler (l'entree
// est retiree de la file AVANT resolve ; JS single-thread rend le reste
// de file stable entre pomper et le prochain timer).
function pomper() {
  while (enCours < max && file.length) {
    const entree = file.shift();
    clearTimeout(entree.annuler);
    const place = nouvellePlace();
    place.attenteMs = entree.depuis ? Date.now() - entree.depuis : 0;
    entree.resolve(place);
  }
}

/** Resolve TOUJOURS une place : reelle (attente terminee) ou fantome
 *  (debordement, apres MAX_ATTENTE_MS d'attente) ; jamais null, pour que
 *  le finally de l'appelant reste uniforme. */
function demanderPlace(instant) {
  const epoch = instant || Date.now();
  if (enCours < max) return Promise.resolve(nouvellePlace());
  return new Promise((resolve) => {
    const entree = { resolve, annuler: null, depuis: epoch };
    entree.annuler = setTimeout(() => {
      const i = file.indexOf(entree);
      if (i >= 0) file.splice(i, 1);
      // Fail-open : le demandeur part sans place reelle. Resolve d'un
      // fantome : libre des la naissance, liberrer() no-op, marqueur
      // `debordement` pour le :diag du routeur — jamais null, le finally
      // de l'appelant reste uniforme.
      debordements++;
      const jour = jourDe(Date.now());
      if (jour !== jourDebordements) {
        jourDebordements = jour;
        debordementsJour = 0;
      }
      debordementsJour++;
      resolve({ libre: true, debordement: true, attenteMs: Date.now() - epoch, liberrer() {} });
    }, MAX_ATTENTE_MS);
    file.push(entree);
  });
}

/** Reglage de test (et survie si MAX_CONC fonctionne deja). */
function configurer(opts) {
  if (!opts) return;
  if (opts.max && opts.max >= 1) max = opts.max;
  if (opts.attenteMs !== undefined && opts.attenteMs >= 0) MAX_ATTENTE_MS = opts.attenteMs;
}

/** Etat lisible pour /admin et /health. */
function etat() {
  return {
    max,
    enCours,
    file: file.length,
    attenteMaxMs: MAX_ATTENTE_MS,
    debordements,
    debordementsJour
  };
}

/** Remise a zero pour les tests (etats + file, timers des tests purges). */
function reinitialiser() {
  for (const entree of file.splice(0)) clearTimeout(entree.annuler);
  enCours = 0;
  debordements = 0;
  jourDebordements = null;
  debordementsJour = 0;
}

module.exports = { demanderPlace, configurer, etat, reinitialiser };
