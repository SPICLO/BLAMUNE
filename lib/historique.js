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

function creerHistorique({ dossierUser, storage }) {
  function cheminHistorique(uid, mode) {
    const d = dossierUser(uid);
    if (mode === '1' || mode === '2') return path.join(d, `historique_mode${mode}.json`);
    return path.join(d, 'historique.json');
  }

  function chargerHistorique(uid, mode) {
    if (!uid) return [];
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
    // Ecriture compacte : meme contenu, fichiers 3 a 4 fois plus legers.
    try {
      fs.writeFileSync(cheminHistorique(uid, mode), JSON.stringify(aSauver), 'utf8');
    } catch (e) {}
    if (storage.estConfigure()) storage.setHistorique(uid, mode, aSauver);
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

  return { cheminHistorique, chargerHistorique, sauvegarderHistorique, avecHistorique };
}

module.exports = { creerHistorique };
