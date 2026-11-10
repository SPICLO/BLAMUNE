// ====================================================================
//  Tests unitaires : lib/validation.js (partie 2)
// ====================================================================
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  validerPseudo,
  validerMotDePasse,
  sanitiserValeurChamp,
  validerMotsFavoris,
  TAILLE_MAX_MESSAGE,
  TAILLE_MAX_PSEUDO,
  TAILLE_MAX_MDP,
  TAILLE_MAX_CHAMP_LIBRE
} = require('../lib/validation');

test('validerPseudo: accepte un pseudo valide', () => {
  const result = validerPseudo('MonPseudo123');
  assert.ok(result.ok);
  assert.equal(result.pseudo, 'MonPseudo123');
});

test('validerPseudo: rejet un pseudo trop court', () => {
  const result = validerPseudo('ab');
  assert.ok(!result.ok);
  assert.ok(result.erreurs.some((e) => e.includes('trop court')));
});

test('validerPseudo: rejecte un pseudo avec caracteres interdits', () => {
  const result = validerPseudo('bad/user');
  assert.ok(!result.ok);
  assert.ok(result.erreurs.some((e) => e.includes('lettres, chiffres, _, ., -')));
});

test('validerPseudo: rejecte le pseudo admin', () => {
  const result = validerPseudo('admin');
  assert.ok(!result.ok);
  assert.ok(result.erreurs.some((e) => e.includes('reserve')));
});

test('validerMotDePasse: accepte un mot de passe valide', () => {
  const result = validerMotDePasse('MonMotDePasse123');
  assert.ok(result.ok);
});

test('validerMotDePasse: rejecte un mot de passe trop court', () => {
  const result = validerMotDePasse('short');
  assert.ok(!result.ok);
  assert.ok(result.erreurs.some((e) => e.includes('trop court')));
});

test('validerMotDePasse: rejecte un mot de passe null', () => {
  const result = validerMotDePasse(null);
  assert.ok(!result.ok);
});

test('sanitiserValeurChamp: nettoie une valeur', () => {
  const result = sanitiserValeurChamp('  Bonjour\t\r\n ');
  assert.equal(result, 'Bonjour');
});

test('sanitiserValeurChamp: limite la taille', () => {
  const long = 'a'.repeat(TAILLE_MAX_CHAMP_LIBRE + 10);
  const result = sanitiserValeurChamp(long);
  assert.equal(result.length, TAILLE_MAX_CHAMP_LIBRE);
});

test('sanitiserValeurChamp: supprime les sauts de ligne', () => {
  const result = sanitiserValeurChamp('a\nb\r\nc');
  assert.equal(result, 'a b c');
});

test('validerMotsFavoris: accepte un tableau valide', () => {
  const result = validerMotsFavoris(['chocolate', 'pizza', 'sushi']);
  assert.ok(result.ok);
  assert.equal(result.motsFavoris.length, 3);
});

test('validerMotsFavoris: rejecte un non-tableau', () => {
  const result = validerMotsFavoris('pas un tableau');
  assert.ok(!result.ok);
  assert.equal(result.erreur, 'motsFavoris doit etre un tableau');
});

test('validerMotsFavoris: limite a 5 elements', () => {
  const result = validerMotsFavoris(['a', 'b', 'c', 'd', 'e', 'f']);
  assert.ok(!result.ok);
  assert.equal(result.erreur, 'max 5 mots favoris');
});

test('validerMotsFavoris: filtre les chaines vides', () => {
  const result = validerMotsFavoris(['', ' ', 'bonjour', '', 'salut']);
  assert.ok(result.ok);
  assert.equal(result.motsFavoris.length, 2);
});

test('taille maximales: TAILLE_MAX_MESSAGE est correcte', () => {
  assert.ok(TAILLE_MAX_MESSAGE > 1000);
  assert.ok(TAILLE_MAX_MESSAGE <= 5000);
});

test('taille maximales: TAILLE_MAX_PSEUDO est correcte', () => {
  assert.ok(TAILLE_MAX_PSEUDO >= 8);
  assert.ok(TAILLE_MAX_PSEUDO <= 64);
});

test('taille maximales: TAILLE_MAX_MDP est correcte', () => {
  assert.ok(TAILLE_MAX_MDP >= 64);
  assert.ok(TAILLE_MAX_MDP <= 256);
});
