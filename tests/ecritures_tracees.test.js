// ====================================================================
//  Tests : un echec d'ecriture laisse une TRACE
// ====================================================================
//  Avant le 2026-11-10, 14 `catch (e) {}` avalaient une ecriture de
//  donnees utilisateur : historique, memoire, etat, comptes, resume,
//  invitations. L'utilisateur perdait ses donnees et logs/erreurs.log
//  restait vide — impossible de diagnostiquer, impossible de prevenir.
//
//  Ces tests provoquent un VRAI echec (dossier de destination supprime
//  puis remplace par un FICHIER, ce qui rend mkdir/write impossibles) et
//  verifient que le logger injecte est appele.
// ====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { creerHistorique } = require('../lib/historique');
const { creerMemoire } = require('../lib/memoire');

// Un dossier utilisateur qui ne peut PAS etre cree : son parent est un
// fichier. Toute ecriture echoue donc pour de vrai, sans mock.
function racineImpossible() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'blamune-trace-'));
  const users = path.join(base, 'users');
  fs.writeFileSync(users, 'je suis un fichier, pas un dossier', 'utf8');
  return { base, users };
}

function collecteur() {
  const appels = [];
  const logger = (serie, message) => appels.push({ serie, message });
  return { appels, logger };
}

const storageInactif = {
  estConfigure: () => false,
  setHistorique: () => {},
  setMemoire: () => {}
};

// --------------------------------------------------------------------
// 1. Historique
// --------------------------------------------------------------------
test('historique: une ecriture impossible est signalee', () => {
  const { base, users } = racineImpossible();
  const { appels, logger } = collecteur();
  const histo = creerHistorique({
    dossierUser: (uid) => path.join(users, uid),
    storage: storageInactif,
    // Pas de differeur : on veut l'ecriture synchrone, donc l'echec immediat.
    ecritures: null,
    logger
  });

  histo.sauvegarderHistorique('u000000000001', '2', [{ qui: 'moi', texte: 'bonjour' }]);

  assert.ok(appels.length > 0, 'aucune trace : l echec est reste muet');
  assert.equal(appels[0].serie, 'historique');
  assert.ok(appels[0].message.length > 0, 'message vide');
  fs.rmSync(base, { recursive: true, force: true });
});

test('historique: sans logger, l echec ne fait pas planter', () => {
  const { base, users } = racineImpossible();
  const histo = creerHistorique({
    dossierUser: (uid) => path.join(users, uid),
    storage: storageInactif,
    ecritures: null
  });
  // Ne doit pas lever : le logger est optionnel (tests isoles, scripts).
  assert.doesNotThrow(() =>
    histo.sauvegarderHistorique('u000000000002', '2', [{ qui: 'moi', texte: 'x' }])
  );
  fs.rmSync(base, { recursive: true, force: true });
});

// --------------------------------------------------------------------
// 2. Memoire
// --------------------------------------------------------------------
test('memoire: une ecriture impossible est signalee', () => {
  const { base, users } = racineImpossible();
  const { appels, logger } = collecteur();
  const memoire = creerMemoire({
    usersDir: users,
    storage: storageInactif,
    ecritures: null,
    logger
  });

  memoire.ecrireMemoire('u000000000003', 'nom', 'Maeva');

  assert.ok(appels.length > 0, 'aucune trace : le fait appris est perdu en silence');
  assert.equal(appels[0].serie, 'memoire');
  fs.rmSync(base, { recursive: true, force: true });
});

test('memoire: une ecriture reussie ne signale rien', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'blamune-ok-'));
  const { appels, logger } = collecteur();
  const memoire = creerMemoire({
    usersDir: path.join(base, 'users'),
    storage: storageInactif,
    ecritures: null,
    logger
  });

  memoire.ecrireMemoire('u000000000004', 'nom', 'Theo');

  assert.deepEqual(appels, [], 'un succes ne doit pas produire de trace');
  assert.equal(memoire.lireMemoire('u000000000004').nom, 'Theo');
  fs.rmSync(base, { recursive: true, force: true });
});

// --------------------------------------------------------------------
// 3. Le logger ne doit jamais casser l'appelant
// --------------------------------------------------------------------
test('un logger qui leve ne fait pas echouer l ecriture', () => {
  const { base, users } = racineImpossible();
  const memoire = creerMemoire({
    usersDir: users,
    storage: storageInactif,
    ecritures: null,
    logger: () => {
      throw new Error('logger casse');
    }
  });
  assert.doesNotThrow(() => memoire.ecrireMemoire('u000000000005', 'nom', 'X'));
  fs.rmSync(base, { recursive: true, force: true });
});
