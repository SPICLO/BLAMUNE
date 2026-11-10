// =====================================================================
//  Garde annee d'identite (bug "226") : lib/utilitaires.js
// =====================================================================
//  Une auto-revelation de creation avec une annee course ("en 226",
//  "en 22", "en 26") est corrigee en l'annee en cours. Les chiffres
//  des autres (= vie de l'utilisateur, dates historiques, especes
//  d'autres donnees) ne sont jamais touches.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const { corrigerAnneeIdentite } = require('../lib/utilitaires');

const annee = String(new Date().getFullYear());

const correr = [
  ['Je suis né en 226, loin d ici.', 'Je suis ' + 'né en ' + annee + ', loin d ici.'],
  ['Je suis créée depuis 22 !', 'Je suis créée depuis ' + annee + ' !'],
  ["J'ai été créée en 226 par BLAMUNE.", "J'ai été créée en " + annee + ' par BLAMUNE.'],
  ["J'ai été mise en ligne depuis 226.", "J'ai été mise en ligne depuis " + annee + '.'],
  ['Mise en ligne depuis 226.', 'Mise en ligne depuis ' + annee + '.'],
  ['I was created in 226.', 'I was created in ' + annee + '.'],
  ['Fui creado en 226.', 'Fui creado en ' + annee + '.'],
  ['أنا صُنعت في 226.', 'أنا صُنعت في ' + annee + '.']
];

const intact = [
  'Je suis né en 2026.',
  'Tu es né en 1998, je m en souviens.',
  'Il est né en 1998.',
  'Née en 1998, ma mère vit a Lyon.',
  'My account was created in 2015.',
  'You were born in 1998.',
  'I was born in 1998, right?',
  'Les Jeux se tiennent depuis 1896. Tu as 15 ans.',
  'Cure pure 1210 depuis mars !'
];

test('auto-revelation : une annee corse devient l annee en cours', () => {
  for (const [entree, attendu] of correr) {
    assert.strictEqual(corrigerAnneeIdentite(entree), attendu, entree);
  }
});

test('auto revelation deja juste : texte inchangé', () => {
  assert.strictEqual(corrigerAnneeIdentite('Je suis né en 2026.'), 'Je suis né en 2026.');
});

test('tiers (utilisateur, comptes, histoire) : jamais touches', () => {
  for (const entree of intact) {
    assert.strictEqual(corrigerAnneeIdentite(entree), entree, entree);
  }
});

test('entree vide ou non-string : neutre', () => {
  assert.strictEqual(corrigerAnneeIdentite(''), '');
  assert.strictEqual(corrigerAnneeIdentite(null), null);
  assert.strictEqual(corrigerAnneeIdentite(42), 42);
});
