// =====================================================================
//  Historique de conversation
// =====================================================================
//  Un fichier JSON par utilisateur et par mode ("1" = EGO, "2" = BLAMUNE,
//  sinon le mode par defaut). Chaque entree est un echange.
//
//  Extrait de server.js. Le dossier utilisateur et la persistance cloud
//  sont injectes : ce module ne connait ni USERS_DIR ni storage.js.
// =====================================================================
'use strict';

const fs = require('fs');
const path = require('path');

// Plafond d'un fichier d'historique : sans lui, le JSON d'un utilisateur
// fidele grossit sans fin, est relit et parse ENTIER a chaque /send, puis
// repart complet dans la copie cloud (data.historiques) jusqu'a saturer la
// reservation JSONBin. 2000 echanges = environ un an de chat intensif ;
// au-dela, l'affichage est deja borne a 100 et le resume de conversation
// couvre ce qui a ete replie. La troncature invalide une fois le resume
// en attache (couverts > longueur) : il se refait en arriere-plan.
const HISTORIQUE_MAX = 2000;

// `logger` (optionnel) : (serie, message) => void. Sans lui, un echec
// d'ecriture restait MUET — l'utilisateur perdait son historique et rien
// n'apparaissait dans logs/erreurs.log. Les tests isoles peuvent l'omettre.
function creerHistorique({ dossierUser, storage, ecritures, logger }) {
  // Cache en mémoire pour éviter de lire un fichier qui vient d'être modifié
  // mais pas encore flushé sur disque par ecritures.differer().
  const cacheMemoire = new Map();

  function signaler(serie, e) {
    try {
      if (logger) logger(serie, (e && e.message) || String(e));
    } catch (err) {}
  }

  function cheminHistorique(uid, mode) {
    const d = dossierUser(uid);
    if (mode === '1' || mode === '2') return path.join(d, `historique_mode${mode}.json`);
    return path.join(d, 'historique.json');
  }

  function cleCache(uid, mode) {
    return String(uid) + '_' + String(mode);
  }

  function chargerHistorique(uid, mode) {
    if (!uid) return [];
    // Si le contenu est en cache (ecriture differee pas encore flush), le
    // retourner immediatement sans toucher le disque.
    const cle = cleCache(uid, mode);
    if (cacheMemoire.has(cle)) return cacheMemoire.get(cle);
    try {
      const f = cheminHistorique(uid, mode);
      if (!fs.existsSync(f)) return [];
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (e) {
      return [];
    }
  }

  function sauvegarderHistorique(uid, mode, historique) {
    // Plafond APPLIQUE A L'ECRITURE (l'affichage et l'idempotence n'en
    // dependent pas) : on garde les plus recents.
    let aSauver = historique;
    if (Array.isArray(aSauver) && aSauver.length > HISTORIQUE_MAX) {
      aSauver = aSauver.slice(-HISTORIQUE_MAX);
    }
    const contenu = JSON.stringify(aSauver);
    const cle = cleCache(uid, mode);
    // Mettre a jour le cache immediatement pour que la prochaine lecture
    // voie la modification sans attendre le flush disque.
    cacheMemoire.set(cle, aSauver);
    if (ecritures) {
      // Ecriture differee : ne bloque pas l'event loop.
      ecritures.differer(cle, cheminHistorique(uid, mode), contenu);
    } else {
      // Pas de module ecritures : ecriture synchrone directe (comportement
      // historique, tests isoles).
      try {
        fs.writeFileSync(cheminHistorique(uid, mode), contenu, 'utf8');
      } catch (e) {
        // Disque plein, droits, dossier disparu : l'echange est perdu.
        signaler('historique', e);
      }
    }
    if (storage.estConfigure()) storage.setHistorique(uid, mode, aSauver);
  }

  // Effacement COMPLET : fichier disque + cache memoire + copie cloud.
  // La route DELETE /historique s'en sert : sans le cache, un effacement
  // suivi d'une relisation rendait l'ancien historique (cacheMemoire
  // survivait au unlink).
  function effacerHistorique(uid, mode) {
    if (!uid) return;
    cacheMemoire.delete(cleCache(uid, mode));
    const f = cheminHistorique(uid, mode);
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (e) {
      // Le fichier survit a l'effacement : il reapparaitra au rechargement.
      signaler('historique', e);
    }
    try {
      if (storage.estConfigure()) storage.setHistorique(uid, mode, []);
    } catch (e) {
      // La copie cloud garde l'ancien historique : il reviendra a la
      // prochaine restauration. C'est le pire cas d'un effacement.
      signaler('historique-cloud', e);
    }
  }

  // File sequentielle par utilisateur et mode. Deux /send parallel
  // (le rate limit les autorise : 20/min), ou un /send croisant
  // l'envoi proactif, font tous un LECTURE-modification-ECRITURE du meme
  // JSON. Sans file, le dernier ecrivain ecrase les entrees du premier :
  // des messages disparaissent du fichier ET de la copie cloud.
  const files = new Map();
  function enFile(cle, tache) {
    const precedente = (files.get(cle) || Promise.resolve()).catch(() => {});
    const p = precedente.then(tache);
    files.set(
      cle,
      p.catch(() => {})
    );
    return p;
  }

  /**
   * Clusteriser un cycle lecture-modification-ecriture de l'historique :
   * avecHistorique(uid, mode, (hist) => hist.push(...)). La modification
   * synchrone ; si elle leve, RIEN n'est ecrit (ni fichier ni
   * cloud) et la file continue avec l'operation suivante. Retourne une
   * promesse resolue quand l'ecriture est faite.
   */
  function avecHistorique(uid, mode, modif) {
    return enFile(String(uid) + '_' + String(mode), () => {
      const hist = chargerHistorique(uid, mode);
      const ret = modif(hist);
      sauvegarderHistorique(uid, mode, hist);
      return ret;
    });
  }

  return {
    cheminHistorique,
    chargerHistorique,
    sauvegarderHistorique,
    avecHistorique,
    effacerHistorique
  };
}

module.exports = { creerHistorique };
