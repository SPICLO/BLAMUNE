// =====================================================================
//  Etat de l'index des embeddings (phase 3, P3-4)
// =====================================================================
//  Le probleme constate : au demarrage, lib/savoir.js recharge
//  cache_embeddings.json et vectorise les faits manquants via Gemini. Le
//  commentaire du module annonce ~13 min pour 1266 faits ; avec 10 000 faits
//  c'est plus d'une heure, sur le quota d'embedding d'une cle. Et RIEN ne
//  le disait : pas dans /health, pas dans /admin, seulement dans
//  logs/erreurs.log en cas d'echec de lot.
//
//  Ce module est un registre minuscule, sans dependance :
//    - savoir.js y depose l'etat (faits, depuis le cache, a calculer,
//      calcules, echecs, phase) ;
//    - /health le lit (`embeddings`) — c'est un chiffre, pas un tableau de
//      bord : `enAttente > 0` pendant une heure se voit d'un coup d'oeil.
//
//  Aucun etat n'est persiste ici : le cache disque (cache_embeddings.json)
//  reste la seule source de verite pour rejouer sans payer.
// =====================================================================
'use strict';

function creerEtatEmbeddings() {
  let etat = {
    mode: 'inactif', // 'gemini' | 'local' | 'inactif'
    phase: 'inactif', // 'chargement' | 'calcul' | 'indexation' | 'pret' | 'erreur'
    total: 0, // faits a vectoriser
    depuisCache: 0, // vecteurs relus du cache disque (gratuits)
    aCalculer: 0, // faits sans vecteur au demarrage
    calcules: 0, // faits vectorises pendant ce boot
    echecs: 0, // lots refuses (429, erreur reseau)
    erreur: '', // dernier message d'echec, pour /health
    debut: 0, // instant du debut de la synchro (0 = jamais lancee)
    fin: 0 // instant de fin (0 = en cours ou jamais lancee)
  };

  function poser(champs) {
    etat = Object.assign({}, etat, champs);
    return etat;
  }

  /** Un lot d'embedding a echoue (le boot continue avec le cache). */
  function lotEchoue(message) {
    etat.echecs++;
    etat.erreur = String(message || '').substring(0, 200);
    return etat;
  }

  function etatCourant() {
    return Object.assign({}, etat);
  }

  function reinitialiser() {
    etat = {
      mode: 'inactif',
      phase: 'inactif',
      total: 0,
      depuisCache: 0,
      aCalculer: 0,
      calcules: 0,
      echecs: 0,
      erreur: '',
      debut: 0,
      fin: 0
    };
  }

  return { poser, lotEchoue, etat: etatCourant, reinitialiser };
}

module.exports = { creerEtatEmbeddings };
