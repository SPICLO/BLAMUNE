// =====================================================================
//  Plafond global des messages /send (toutes IP et comptes confondues)
// =====================================================================
//  Les limites par IP (RATE_SEND_IP) et par compte (RATE_SEND_UID) ne
//  bornent qu'un visiteur. Une attaque repartie sur beaucoup d'IP passe
//  au travers : chaque bot respecte son propre quota et, ensemble, ils
//  atteignent le pool IA (et la facture des fournisseurs).
//
//  Ce module ajoute la derniere ceinture : une fenetre glissante d'UNE
//  HEURE comptant tous les messages acceptes par /send, sans considerer
//  qui les envoie. Au-dela de SEND_MAX_HEURE_TOUT, la route repond un 429
//  honnete et le message est remis dans le champ par le client.
//
//  Defaut 720/h : aligne sur le vrai plafond technique du pool — MAX_CONC
//  = 3 appels simultanes, reponse dure ~15 s, soit ~12 messages/minute au
//  grand maximum pour des visiteurs legitimes. Le plafond suit ce calibre :
//  au-dela, il s'agit de charge artificielle, pas de conversation reelle.
//
//  Singleton volontaire (comme lib/tension.js) : un seul comptage honnete
//  par processus, reinitialisable pour les tests.
// =====================================================================
'use strict';

const FENETRE_MS = 60 * 60 * 1000; // 1 heure glissante
let max = parseInt(process.env.SEND_MAX_HEURE_TOUT || '', 10) || 720;

// Instants des messages acceptes, ordre croissant.
const notes = [];
// Refus : messages rejetes le plafond atteint (visibles par /admin).
let refus = 0;
let jourRefus = null;
let refusJour = 0;

function jourDe(instant) {
  return new Date(instant).toISOString().slice(0, 10);
}

// Fenetre glissante : supprime les notes devenues plus vieilles que l'heure.
function purger(instant) {
  while (notes.length && notes[0] < instant - FENETRE_MS) notes.shift();
}

/** Consomme une place si la fenetre n'est pas pleine ; sinon, compte le
 *  refus (visibles par /admin) et renvoie false. */
function tenterPlace(instant) {
  const epoch = instant || Date.now();
  const jour = jourDe(epoch);
  if (jour !== jourRefus) {
    jourRefus = jour;
    refusJour = 0;
  }
  purger(epoch);
  if (notes.length >= max) {
    refus++;
    refusJour++;
    return false;
  }
  notes.push(epoch);
  return true;
}

/** Reglage de test (l'env SEND_MAX_HEURE_TOUT fixe la production). */
function configurer(opts) {
  if (opts && opts.max && opts.max >= 1) max = opts.max;
}

/** Etat lisible pour /admin et /health. */
function etat() {
  return { maxHeure: max, dansFenetre: notes.length, refus, refusJour };
}

/** Remise a zero pour les tests. */
function reinitialiser() {
  notes.length = 0;
  refus = 0;
  jourRefus = null;
  refusJour = 0;
  max = parseInt(process.env.SEND_MAX_HEURE_TOUT || '', 10) || 720;
}

module.exports = { tenterPlace, configurer, etat, reinitialiser };
