const test = require('node:test');
// ====================================================================
//  Tests unitaires : lib/validation.js (partie 1)
// ====================================================================

('use strict');

const assert = require('node:assert/strict');
const { validerSend, validerUid, TAILLE_MAX_MESSAGE } = require('../lib/validation');

// ------------------------------------------------------------------
// 1. validerSend()
// ------------------------------------------------------------------
test('validerSend: accepte un message valide avec "msg"', () => {
  const result = validerSend({ msg: 'Bonjour, comment allez-vous ?' });
  assert.ok(result.ok);
  assert.equal(result.message, 'Bonjour, comment allez-vous ?');
  assert.equal(result.mode, '2');
});

test('validerSend: accepte un message valide avec "message"', () => {
  const result = validerSend({ message: 'Salut', stream: true, mode: '1' });
  assert.ok(result.ok);
  assert.equal(result.message, 'Salut');
  assert.equal(result.stream, true);
  assert.equal(result.mode, '1');
});

test('validerSend: accepte "stream" envoye en formulaire (le site envoie stream=1)', () => {
  // Le site poste un formulaire urlencoded : express rend des chaines.
  // Avant le correctif, ce corps repondait 400 et la page affichait
  // « Serveur injoignable » alors que le serveur vivait.
  const un = validerSend({ msg: 'bonjour', mode: '2', stream: '1' });
  assert.ok(un.ok);
  assert.equal(un.stream, true);

  const vrai = validerSend({ msg: 'bonjour', stream: 'true' });
  assert.ok(vrai.ok);
  assert.equal(vrai.stream, true);

  const zero = validerSend({ msg: 'bonjour', stream: '0' });
  assert.ok(zero.ok);
  assert.equal(zero.stream, false);

  const faux = validerSend({ msg: 'bonjour', stream: 'false' });
  assert.ok(faux.ok);
  assert.equal(faux.stream, false);
});

test('validerSend: rejecte une valeur "stream" qui n est pas booleenne', () => {
  const result = validerSend({ msg: 'bonjour', stream: 'peut-etre' });
  assert.ok(!result.ok);
  assert.ok(result.erreurs.some((e) => e.includes('stream')));
});

test('validerSend: rejecte un message vide', () => {
  const result = validerSend({ msg: '   ' });
  assert.ok(!result.ok);
  assert.ok(result.erreurs.some((e) => e.includes('vide')));
});

test('validerSend: rejecte un message trop long', () => {
  const long = 'a'.repeat(TAILLE_MAX_MESSAGE + 1);
  const result = validerSend({ msg: long });
  assert.ok(!result.ok);
  assert.ok(result.erreurs.some((e) => e.includes('trop long')));
});

test('validerSend: rejecte un champ non autorise (ex: "prix")', () => {
  const result = validerSend({ msg: 'hello', prix: 42 });
  assert.ok(!result.ok);
  assert.ok(result.erreurs.some((e) => e.includes('prix')));
});

test('validerSend: rejecte un champ null', () => {
  const result = validerSend({ msg: 'hello', mode: null });
  assert.ok(!result.ok);
  assert.ok(result.erreurs.some((e) => e.includes('mode')));
});

test('validerSend: rejecte un mode invalide', () => {
  const result = validerSend({ msg: 'hello', mode: '3' });
  assert.ok(!result.ok);
  assert.ok(result.erreurs.some((e) => e.includes('mode')));
});

test('validerSend: rejecte un corps qui n est pas un objet', () => {
  const result = validerSend(null);
  assert.ok(!result.ok);
  assert.ok(result.erreurs.some((e) => e.includes('Corps')));
});

test('validerSend: accepte une data URL de photo (forme envoyee par le site)', () => {
  // site/app.js envoie `image=data:image/png;base64,...`. L'ancienne
  // validation n'acceptait qu'un boolean : toute photo etait refusee en 400.
  const dataUrl = 'data:image/png;base64,' + 'A'.repeat(120);
  const result = validerSend({ msg: 'hello', image: dataUrl });
  assert.ok(result.ok, 'erreurs: ' + JSON.stringify(result.erreurs));
});

test('validerSend: accepte une photo SANS texte', () => {
  const dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(120);
  const result = validerSend({ image: dataUrl });
  assert.ok(result.ok, 'erreurs: ' + JSON.stringify(result.erreurs));
});

test('validerSend: accepte le booleen image (anciens clients)', () => {
  const result = validerSend({ msg: 'hello', image: true });
  assert.ok(result.ok, 'erreurs: ' + JSON.stringify(result.erreurs));
});

test('validerSend: rejecte une image d un autre type', () => {
  const result = validerSend({ msg: 'hello', image: 42 });
  assert.ok(!result.ok);
  assert.ok(result.erreurs.some((e) => e.includes('image')));
});

// ------------------------------------------------------------------
// 2. validerUid()
// ------------------------------------------------------------------
test('validerUid: accepte un uid de compte valide', () => {
  const result = validerUid('u' + 'a'.repeat(12));
  assert.ok(result.ok);
  assert.equal(result.uid, 'u' + 'a'.repeat(12));
});

test('validerUid: accepte un uid d invite valide', () => {
  const result = validerUid('inv_' + '0'.repeat(24));
  assert.ok(result.ok);
});

test('validerUid: refuse un uid invalide', () => {
  const result = validerUid('../admin');
  assert.ok(!result.ok);
  assert.equal(result.erreur, 'UID invalide');
});

test('validerUid: refuse un uid vide', () => {
  const result = validerUid('');
  assert.ok(!result.ok);
});
