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
    } catch (e) { return []; }
  }

  function sauvegarderHistorique(uid, mode, historique) {
    // Ecriture compacte : meme contenu, fichiers 3 a 4 fois plus legers.
    try { fs.writeFileSync(cheminHistorique(uid, mode), JSON.stringify(historique), 'utf8'); } catch (e) {}
    if (storage.estConfigure()) storage.setHistorique(uid, mode, historique);
  }

  return { cheminHistorique, chargerHistorique, sauvegarderHistorique };
}

module.exports = { creerHistorique };