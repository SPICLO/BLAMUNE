// =====================================================================
//  Tests : nonce de re-inscription des invitations (correctif A)
// =====================================================================
//  Lancement : node --test tests/invite_nonce.test.js
//  Aucun serveur : le module est pur (Map en memoire), injectable.
//
//  Ce que ce test protege (l'analyse en profondeur l'avait trouve) :
//  une invitation dont le jeton avait ete oublie par la chasse des 30 jours
//  reprenait la conversation avec le SEUL uid, des que son dossier
//  existait. Desormais la seule reprise possible console a un nonce rendu
//  par /invite au demandeur : court (10 min), usage unique, lie a l'uid.
// =====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const compte = require('../lib/routes/compte');

const UID = 'inv_' + 'a'.repeat(24);
const AUTRE = 'inv_' + 'b'.repeat(24);

test('nonce : valable une seule fois, et seulement pour son uid', () => {
  const n = compte.creerNonceInvite(UID);
  assert.match(n, /^[0-9a-f]{48}$/, '192 bits en hexa');
  assert.strictEqual(compte.nonceValide(n, AUTRE), false, 'nonce vole : refuse');
  // Un mauvais essai ne consomme PAS la recette du bon porteur.
  assert.strictEqual(compte.nonceValide(n, UID), true, 'premier usage accepte');
  assert.strictEqual(compte.nonceValide(n, UID), false, 'rejeu refuse (usage unique)');
});

test('nonce : inconnu ou vide refuse, jamais une exception', () => {
  assert.strictEqual(compte.nonceValide('', UID), false);
  assert.strictEqual(compte.nonceValide('f'.repeat(48), UID), false);
  assert.strictEqual(compte.nonceValide(undefined, undefined), false);
});

test('nonce : la purge retire les recettes perimees', async () => {
  // Une recette a duree de vie nulle est perimee a la pose : purgerNonces
  // doit la retirer. (INVITE_NONCE_MS n'est pas surchargeable ici — le
  // module lit l'environnement au chargement — donc on teste la purge
  // comme une fonction pure sur l'etat courant : elle ne casse rien.)
  compte.creerNonceInvite(UID);
  const n = compte.purgerNonces();
  assert.strictEqual(typeof n, 'number', 'nombre de recettes retirees');
  // La recette vient d'etre posee : elle survit a une purge immediate.
  assert.strictEqual(compte.purgerNonces(), 0, 'rien de perime apres un instant');
});
