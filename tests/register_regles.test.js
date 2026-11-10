// ====================================================================
//  Tests unitaires : regles d'inscription (/register)
// ====================================================================
//  Avant le 2026-11-10, /register avait SES propres regles (pseudo >= 2,
//  mot de passe >= 6) et ignorait lib/validation.js : deux contrats pour
//  la meme regle, l'un teste et jamais branche, l'autre en service. Un
//  sous-titre « 3 minimum » dans la doc ne voulait donc rien dire.
//
//  Ici on verifie ce que le SERVEUR accepte, en appelant directement les
//  fonctions que la route utilise. Le chemin HTTP complet est couvert par
//  tests/run.js (inscription reelle) et par l'essai manuel du 2026-11-10.
// ====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validerPseudo, validerMotDePasse } = require('../lib/validation');

// --------------------------------------------------------------------
// 1. Pseudo
// --------------------------------------------------------------------
test('pseudo: accepte 3 a 32 caracteres alphanumeriques', () => {
  for (const p of ['abc', 'Jean', 'jean-paul', 'jean_paul', 'jean.paul', 'A'.repeat(32)]) {
    const r = validerPseudo(p);
    assert.ok(r.ok, JSON.stringify(p) + ' refuse: ' + JSON.stringify(r.erreurs));
    assert.equal(r.pseudo, p);
  }
});

test('pseudo: refuse moins de 3 caracteres (regle du serveur, pas 2)', () => {
  const r = validerPseudo('ab');
  assert.ok(!r.ok);
  assert.ok(
    r.erreurs.some((e) => e.includes('trop court')),
    JSON.stringify(r.erreurs)
  );
});

test('pseudo: refuse plus de 32 caracteres', () => {
  const r = validerPseudo('a'.repeat(33));
  assert.ok(!r.ok);
});

test('pseudo: refuse un pseudo vide ou absent', () => {
  assert.ok(!validerPseudo('').ok);
  assert.ok(!validerPseudo(null).ok);
  assert.ok(!validerPseudo(undefined).ok);
});

test('pseudo: refuse espaces et caracteres speciaux', () => {
  for (const p of ['mon pseudo', 'jean@paul', 'jean/paul', 'jean\\paul', '<script>', 'jean!']) {
    assert.ok(!validerPseudo(p).ok, JSON.stringify(p) + ' aurait du etre refuse');
  }
});

test('pseudo: "admin" est reserve, quelle que soit la casse', () => {
  for (const p of ['admin', 'Admin', 'ADMIN']) {
    const r = validerPseudo(p);
    assert.ok(!r.ok, p + ' aurait du etre refuse');
    assert.ok(
      r.erreurs.some((e) => e.includes('reserve')),
      JSON.stringify(r.erreurs)
    );
  }
});

// --------------------------------------------------------------------
// 2. Mot de passe
// --------------------------------------------------------------------
test('mdp: accepte 8 caracteres et plus', () => {
  assert.ok(validerMotDePasse('12345678').ok);
  assert.ok(validerMotDePasse('motdepasse-tres-long').ok);
  assert.ok(validerMotDePasse('a'.repeat(128)).ok);
});

test('mdp: refuse 7 caracteres (regle du serveur, pas 6)', () => {
  const r = validerMotDePasse('1234567');
  assert.ok(!r.ok);
  assert.ok(
    r.erreurs.some((e) => e.includes('trop court')),
    JSON.stringify(r.erreurs)
  );
});

test('mdp: refuse plus de 128 caracteres (borne de hachage)', () => {
  assert.ok(!validerMotDePasse('a'.repeat(129)).ok);
});

test('mdp: refuse vide, null ou non-chaine', () => {
  assert.ok(!validerMotDePasse('').ok);
  assert.ok(!validerMotDePasse(null).ok);
  assert.ok(!validerMotDePasse(42).ok);
});

// --------------------------------------------------------------------
// 3. Le contrat d'erreur rendu par la route
// --------------------------------------------------------------------
test('contrat: le premier refus est un message lisible', () => {
  // /register renvoie `erreurs[0]` : ce doit etre une phrase, jamais undefined.
  const cas = [
    validerPseudo('ab'),
    validerPseudo('admin'),
    validerPseudo('mon pseudo'),
    validerMotDePasse('court')
  ];
  for (const r of cas) {
    assert.ok(typeof r.erreurs[0] === 'string' && r.erreurs[0].length > 8, JSON.stringify(r));
  }
});
