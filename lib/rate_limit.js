// =====================================================================
//  Limitation de debit
// =====================================================================
//  Fenetre glissante d'une minute, comptee par cle (souvent l'IP) et par
//  utilisateur. Deux files separees : un utilisateur derriere une IP
//  partagee ne doit pas epuiser le quota de tous les autres.
//
//  Extrait de server.js. Aucun acces aux autres etats du serveur : c'est
//  ce qui permet de le tester isolement et de le reutiliser tel quel.
// =====================================================================
'use strict';

const FENETRE_MS = 60000;

const parCle = {};
const parUtilisateur = {};

function autorise(seau, cle, limite) {
  const now = Date.now();
  if (!seau[cle]) seau[cle] = [];
  // On ne garde que les appels encore dans la fenetre.
  seau[cle] = seau[cle].filter((t) => now - t < FENETRE_MS);
  if (seau[cle].length >= limite) return false;
  seau[cle].push(now);
  return true;
}

/** Rate limit par cle (typiquement `send:<ip>`). */
function checkRateLimit(key, limit = 30) {
  return autorise(parCle, key, limit);
}

/** Rate limit par utilisateur, independant du partage d'IP. */
function checkUserRateLimit(uid, limit = 20) {
  return autorise(parUtilisateur, uid, limit);
}

/**
 * Purge periodique. Sans elle, chaque IP vue une seule fois garderait une
 * entree en memoire pour toujours : le serveur grossirait sans borne.
 */
function purger() {
  const now = Date.now();
  for (const seau of [parCle, parUtilisateur]) {
    for (const cle of Object.keys(seau)) {
      seau[cle] = seau[cle].filter((t) => now - t < FENETRE_MS);
      if (seau[cle].length === 0) delete seau[cle];
    }
  }
}

module.exports = { checkRateLimit, checkUserRateLimit, purger };
