'use strict';
// =====================================================================
//  Sessions persistantes des comptes (lib/session.js)
// =====================================================================
//  Une application installee qu'on rouvre chaque jour ne peut pas dependre
//  d'un ego valable 24 h. Ces tests fixent le contrat du jeton long :
//  hache au repos, verifie en temps constant, revocable appareil par
//  appareil, borne dans le temps.
// =====================================================================

const test = require('node:test');
const assert = require('node:assert');

const sessions = require('../lib/session');

function compteNeuf() {
  return { pseudo: 'testeur', uid: 'u0123456789ab', ego: 'ego-de-test' };
}

test('session : le jeton est emis, hache et verifie', () => {
  const compte = compteNeuf();
  const s = sessions.creerSession(compte, 1000);
  assert.match(s.jeton, /^v1\.[0-9a-f]{18}\.[0-9a-f]{64}$/, 'format du jeton : ' + s.jeton);
  const [, sid, secret] = s.jeton.split('.');
  assert.strictEqual(Object.keys(compte.sessions).length, 1, 'une session enregistree');
  // Le secret ne doit JAMAIS etre ecrit tel quel dans comptes.json.
  assert.notStrictEqual(compte.sessions[sid].h, secret, 'secret stocke en clair');
  assert.ok(!JSON.stringify(compte).includes(secret), 'secret present dans le compte serialise');
  assert.strictEqual(compte.sessions[sid].h.length, 64, 'empreinte sha256 attendue');

  const vu = sessions.verifierSession({ testeur: compte }, s.jeton, 1000);
  assert.ok(vu, 'jeton valide refuse');
  assert.strictEqual(vu.compte.uid, 'u0123456789ab');
  assert.strictEqual(vu.sid, sid);
});

test('session : mauvais secret et jeton bricole refuses', () => {
  const compte = compteNeuf();
  const s = sessions.creerSession(compte, 1000);
  const [, sid, secret] = s.jeton.split('.');
  const mauvais = 'v1.' + sid + '.' + 'f'.repeat(64);
  assert.strictEqual(sessions.verifierSession({ c: compte }, mauvais, 1000), null);
  assert.strictEqual(sessions.verifierSession({ c: compte }, 'v1.abc.def', 1000), null);
  assert.strictEqual(sessions.verifierSession({ c: compte }, '', 1000), null);
  assert.strictEqual(sessions.verifierSession({ c: compte }, secret, 1000), null);
});

test('session : expiration au bout de la duree', () => {
  const compte = compteNeuf();
  const s = sessions.creerSession(compte, 5000);
  assert.ok(sessions.verifierSession({ c: compte }, s.jeton, 5000 + sessions.DUREE_MS - 1));
  assert.strictEqual(
    sessions.verifierSession({ c: compte }, s.jeton, 5000 + sessions.DUREE_MS + 1),
    null,
    'jeton encore accepte apres expiration'
  );
});

test('session : la deconnexion revoque un appareil, pas les autres', () => {
  const compte = compteNeuf();
  const telephone = sessions.creerSession(compte, 1000);
  const ordinateur = sessions.creerSession(compte, 2000);
  const sidTelephone = telephone.jeton.split('.')[1];

  assert.ok(sessions.revoquerSession(compte, sidTelephone), 'revocation attendue');
  assert.strictEqual(sessions.verifierSession({ c: compte }, telephone.jeton, 3000), null);
  assert.ok(
    sessions.verifierSession({ c: compte }, ordinateur.jeton, 3000),
    "l'autre appareil a ete deconnecte par erreur"
  );
  assert.strictEqual(sessions.revoquerSession(compte, sidTelephone), false, 'double revocation');
});

test('session : plafond d appareils, les plus anciens sortent', () => {
  const compte = compteNeuf();
  const jetons = [];
  for (let i = 0; i < sessions.MAX_PAR_COMPTE + 2; i++) {
    jetons.push(sessions.creerSession(compte, 1000 + i));
  }
  assert.strictEqual(
    Object.keys(compte.sessions).length,
    sessions.MAX_PAR_COMPTE,
    'trop de sessions conservees'
  );
  // Les deux premiers doivent etre oublies, les deux derniers acceptes.
  const anciens = jetons.slice(0, 2);
  const recents = jetons.slice(-2);
  for (const j of anciens) {
    assert.strictEqual(sessions.verifierSession({ c: compte }, j.jeton, 5000), null);
  }
  for (const j of recents) {
    assert.ok(sessions.verifierSession({ c: compte }, j.jeton, 5000));
  }
});

test('session : une session perimee est purgee a la connexion', () => {
  const compte = compteNeuf();
  compte.sessions = { vieille: { h: 'a'.repeat(64), cree: 1 } };
  sessions.creerSession(compte, 1 + sessions.DUREE_MS + 1);
  assert.ok(!compte.sessions.vieille, 'session perimee conservee');
});
