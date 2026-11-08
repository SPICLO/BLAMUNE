// =====================================================================
//  Ecritures differees : ne pas toucher le disque a chaque changement
// =====================================================================
//  Pourquoi (phase 3 de l'audit, P3-1) : plusieurs chemins ecrivaient un
//  fichier PAR UTILISATEUR a chaque message —
//    - etat_blamune.json (sauvegarderEtat, appele par /send) ;
//    - memoire.txt (ecrireMemoire / sauvegarderMemoireComplete) ;
//    - proactif.json (ecrireProactif) ;
//    - etat abrege de /stats-perso.
//  Un fil actif faisait donc des dizaines de writeFileSync par minute et
//  par visiteur. Sur un disque reseau (Render) c'est de la latence gratuite,
//  et rien ne le disait.
//
//  La regle ici : une cle = un contenu, et le disque ne recoit qu'UN
//  ecrivement par cle et par fenetre (FLUSH_MS, 5 s par defaut). Une
//  ecriture pendant la fenetre remplace la precedente : le DERNIER contenu
//  gagne, c'est exactement ce que le fichier doit etre.
//
//  Ce qui n'est PAS differe :
//    - les fichiers GLOBAUX (comptes.json, invites.json, stats.json) : ils
//      changent rarement, et leur perte coute un compte ;
//    - tout ce qui est une ECRITURE STRICTE et attendue (POST /savoir →
//      savoir.txt, DELETE /profil) : chaque ecriture y est visible par un
//      autre composant juste apres la reponse HTTP. Ce module ne les touche
//      pas (ecrireMaintenant / oublier).
//
//  Honnetete de l'arret : `vider()` ecrit TOUT ce qui est en attente. Il est
//  appele par SIGTERM/SIGINT (fermerProperement de server.js) et par les
//  tests, pour qu'un redemarrage ne perde jamais plus que la derniere
//  fenetre de 5 s — le meme compromis que storage.js pour le cloud.
// =====================================================================
'use strict';

const fs = require('fs');

// Taille de la fenetre, en ms. 0 = differe coupe (ecriture immediate) :
// pratique pour les tests qui lisent un fichier juste apres une requete.
function entierEnv(nom, defaut) {
  const v = parseInt(process.env[nom] || '', 10);
  return Number.isInteger(v) && v >= 0 ? v : defaut;
}

function creerEcritures({ flushMs, logger } = {}) {
  const FENETRE = flushMs !== undefined ? flushMs : entierEnv('ECRITURES_FLUSH_MS', 5000);

  // cle -> { chemin, contenu } : la derniere version gagne.
  const attente = new Map();
  // Compteur honnete pour /health (meme esprit que lib/sortie.js).
  let ecritures = 0; // ecritures disque REELLES
  let demandes = 0; // ecritures demandees (dont celles absorbees)
  let octets = 0; // octets reellement ecrits
  let echecs = 0;
  let minuteur = null;

  function noterEchec(e) {
    echecs++;
    try {
      if (logger) logger('ecritures', 'flush: ' + (e && e.message));
    } catch (err) {}
  }

  /** Ecrit tout de suite (non differe) : comptabilise pareil. */
  function ecrireMaintenant(chemin, contenu) {
    demandes++;
    try {
      fs.writeFileSync(chemin, contenu, 'utf8');
      ecritures++;
      octets += Buffer.byteLength(contenu);
      return true;
    } catch (e) {
      noterEchec(e);
      return false;
    }
  }

  /** Programme une ecriture : remplace celle en attente pour la meme cle. */
  function differer(cle, chemin, contenu) {
    if (!FENETRE) return ecrireMaintenant(chemin, contenu);
    demandes++;
    attente.set(cle, { chemin, contenu });
    if (!minuteur) {
      minuteur = setTimeout(vider, FENETRE);
      // Ne retient jamais l'arret du process : `vider()` est appele
      // explicitement par fermerProperement, c'est lui qui garantit.
      if (minuteur.unref) minuteur.unref();
    }
    return true;
  }

  /** Ecrit tout ce qui est en attente. Retourne le nombre de fichiers. */
  function vider() {
    if (minuteur) {
      clearTimeout(minuteur);
      minuteur = null;
    }
    let n = 0;
    const lot = Array.from(attente.entries());
    attente.clear();
    for (const [, e] of lot) {
      try {
        fs.writeFileSync(e.chemin, e.contenu, 'utf8');
        ecritures++;
        octets += Buffer.byteLength(e.contenu);
        n++;
      } catch (err) {
        noterEchec(err);
      }
    }
    return n;
  }

  /** Abandonne ce qui attend pour une cle (le fichier est efface ailleurs). */
  function oublier(cle) {
    attente.delete(cle);
  }

  /** A-t-on une ecriture en attente pour cette cle ? (tests, diag) */
  function enAttente(cle) {
    return attente.has(cle);
  }

  /** Etat lisible par /health : des chiffres, pas un tableau de bord. */
  function etat() {
    return { flushMs: FENETRE, demandes, ecritures, octets, echecs, enAttente: attente.size };
  }

  /** Remise a zero (tests) : purge la file sans ecrire. */
  function reinitialiser() {
    if (minuteur) {
      clearTimeout(minuteur);
      minuteur = null;
    }
    attente.clear();
    ecritures = 0;
    demandes = 0;
    octets = 0;
    echecs = 0;
  }

  return { differer, ecrireMaintenant, vider, oublier, enAttente, etat, reinitialiser };
}

module.exports = { creerEcritures };
