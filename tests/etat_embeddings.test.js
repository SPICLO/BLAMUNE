// =====================================================================
//  Tests : registre d'etat des embeddings (lib/etat_embeddings.js) — P3-4
// =====================================================================
//  Lancement : node --test tests/etat_embeddings.test.js
// =====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { creerEtatEmbeddings } = require('../lib/etat_embeddings');

test('etat initial : inactif, rien de compte', () => {
  const e = creerEtatEmbeddings();
  const s = e.etat();
  assert.strictEqual(s.mode, 'inactif');
  assert.strictEqual(s.phase, 'inactif');
  assert.strictEqual(s.aCalculer, 0);
  assert.strictEqual(s.echecs, 0);
});

test('poser() fusionne les champs sans effacer les autres', () => {
  const e = creerEtatEmbeddings();
  e.poser({ mode: 'gemini', total: 100 });
  e.poser({ depuisCache: 90, aCalculer: 10 });
  const s = e.etat();
  assert.strictEqual(s.mode, 'gemini', 'mode conserve');
  assert.strictEqual(s.total, 100, 'total conserve');
  assert.strictEqual(s.depuisCache, 90);
  assert.strictEqual(s.aCalculer, 10);
});

test('l etat renvoye est une copie : le lire ne modifie pas le registre', () => {
  const e = creerEtatEmbeddings();
  const a = e.etat();
  a.echecs = 999;
  assert.strictEqual(e.etat().echecs, 0, 'aucune mutation par reference');
});

test('lotEchoue() compte et borne le message', () => {
  const e = creerEtatEmbeddings();
  e.lotEchoue('x'.repeat(500));
  const s = e.etat();
  assert.strictEqual(s.echecs, 1);
  assert.strictEqual(s.erreur.length, 200, 'message borne a 200 caracteres');
});

test('reinitialiser() remet tout a zero', () => {
  const e = creerEtatEmbeddings();
  e.poser({ mode: 'gemini', aCalculer: 42, phase: 'calcul' });
  e.lotEchoue('429');
  e.reinitialiser();
  const s = e.etat();
  assert.strictEqual(s.mode, 'inactif');
  assert.strictEqual(s.aCalculer, 0);
  assert.strictEqual(s.echecs, 0);
});
