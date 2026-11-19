'use strict';
// =====================================================================
//  Suppression definitive d'un compte
// =====================================================================
//  Une seule implementation pour deux chemins :
//   - l'admin (lib/routes/admin.js, /admin/supprimer-compte) ;
//   - l'utilisateur lui-meme (lib/routes/compte.js, DELETE /compte),
//     exigence des deux stores.
//
//  Le registre, le dossier utilisateur (memoire, historiques, resumes), la
//  copie cloud et la RAM du serveur partent ensemble. L'ordre compte : les
//  ecritures differees sont oubliees AVANT le rmSync, sinon un flush arriere
//  recreerait le dossier tout juste supprime.
// =====================================================================

const fs = require('fs');
const path = require('path');

function creerSuppressionCompte(deps) {
  const {
    usersDir,
    getComptes,
    sauvegarderComptes,
    ecrituresOublier,
    storage,
    purgerRamUtilisateur,
    loggerErreur
  } = deps;

  // Rend le pseudo supprime, ou null si l'uid n'est plus dans le registre.
  return function supprimerCompte(uid) {
    const comptes = getComptes();
    const cle = Object.keys(comptes).find((k) => comptes[k].uid === uid);
    if (!cle) return null;
    const pseudo = comptes[cle].pseudo || uid;

    try {
      delete comptes[cle];
      sauvegarderComptes();
    } catch (e) {
      loggerErreur('compte', 'suppression registre: ' + e.message);
    }
    try {
      if (ecrituresOublier) ecrituresOublier(uid);
    } catch (e) {}
    try {
      fs.rmSync(path.join(usersDir, uid), { recursive: true, force: true });
    } catch (e) {
      loggerErreur('compte', 'suppression dossier: ' + e.message);
    }
    try {
      if (storage.supprimerTout) storage.supprimerTout(uid);
      else if (storage.estConfigure()) loggerErreur('compte', 'cloud : supprimerTout absent');
    } catch (e) {
      loggerErreur('compte', 'suppression cloud: ' + e.message);
    }
    try {
      if (purgerRamUtilisateur) purgerRamUtilisateur(uid);
    } catch (e) {
      loggerErreur('compte', 'purge RAM: ' + e.message);
    }

    console.log(`[BLAMUNE] Compte supprime : ${pseudo} (${uid})`);
    loggerErreur('compte', 'compte supprime : ' + pseudo + ' (' + uid + ')');
    return pseudo;
  };
}

module.exports = { creerSuppressionCompte };
