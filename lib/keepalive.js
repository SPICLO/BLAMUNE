// =====================================================================
//  Keep-alive : empeche la mise en veille de l instance
// =====================================================================
//  Render met un service gratuit en veille apres environ 15 minutes sans
//  requete entrante. Au reveil suivant, la premiere requete met 5 a 30
//  secondes a repondre : le visiteur croit que le site est casse.
//
//  Ce module envoie un rappel sur la route /health de notre propre service.
//  Deux bornes, dites franchement :
//
//  1. Il ne reveille PAS une instance deja endormie. Si le processus dort,
//     le minuteur ne tourne plus. C'est le role du rappel EXTERNE
//     (voir .github/workflows/keepalive.yml) : lui, il survit a notre
//     arret et fait les deux offices.
//
//  2. Render compte comme activite les requetes qui atteignent le service.
//     Un rappel sur 127.0.0.1 passe par le meme chemin HTTP, mais tous les
//     hebergeurs ne comptent pas forcement une requete locale. D ou la
//     precaution : ce module ne garantit rien a lui seul.
//
//  On ne rappelle QUE si personne n est connecte (estConnecte() === false).
//  Quand quelqu un discute, ses messages suffisent a maintenir l instance
//  eveillee : le rappel ne serait qu une requete inutile.
//
// Le minuteur est unref() : il ne doit jamais empecher le processus
//  Node de s arreter proprement a l arret du serveur.
//
// KEEPALIVE=0 desactive tout (utile en developpement et dans les tests).
// =====================================================================
'use strict';

const http = require('http');

const PERIODE_DEFAUT_MS = 150000; // 2 min 30 : large marge sous les 15 min

/**
 * @param {object} deps
 * @param {number} deps.port            port local du service
 * @param {Function} deps.estConnecte   vrai si au moins un utilisateur est actif
 * @param {Function} [deps.logger]      journalise les echecs
 * @param {number} [deps.periodeMs]     intervalle entre deux rappels
 * @param {string} [deps.chemin]        route appellee
 * @returns {{ arreter: Function, intervalle: object|null, rappel: Function }}
 */
function demarrerKeepalive(deps) {
  const { port, estConnecte, logger, periodeMs = PERIODE_DEFAUT_MS, chemin = '/health' } = deps;

  if (process.env.KEEPALIVE === '0') {
    if (logger) logger('keepalive', 'desactive par KEEPALIVE=0');
    // rappel() renvoie "un rappel a-t-il ete envoye" ; desactive, la
    // reponse est donc non, comme quand un utilisateur est connecte.
    return { arreter() {}, intervalle: null, rappel: () => false };
  }

  // Un seul rappel a la fois : si /health met 5 s a repondre, on ne veut pas
  // empiler les requetes les unes sur les autres.
  let enCours = false;

  function rappel() {
    // Quelqu'un est connecte : ses messages suffisent.
    if (enCours || estConnecte()) return false;

    enCours = true;
    let terminee = false;
    const finir = (erreur) => {
      if (terminee) return;
      terminee = true;
      enCours = false;
      if (erreur && logger) logger('keepalive', erreur);
    };

    try {
      const req = http.request(
        { host: '127.0.0.1', port, path: chemin, method: 'GET', timeout: 5000 },
        (res) => {
          // On vide la reponse pour liberer le socket.
          res.resume();
          res.on('end', () => finir(null));
        }
      );
      req.on('error', (e) => finir(e.message));
      req.on('timeout', () => {
        req.destroy();
        finir('delai depasse');
      });
      req.end();
    } catch (e) {
      finir(e.message);
    }
    return true;
  }

  const intervalle = setInterval(rappel, periodeMs);
  // Ne pas garder le processus en vie pour ce seul minuteur.
  if (typeof intervalle.unref === 'function') intervalle.unref();

  return {
    arreter() {
      clearInterval(intervalle);
    },
    intervalle,
    rappel
  };
}

module.exports = { demarrerKeepalive, PERIODE_DEFAUT_MS };
