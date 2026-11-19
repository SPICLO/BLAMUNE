// Tests de la persona BLAMUNE (lib/persona.js).
//   node --test tests/persona.test.js
//
// Deux familles de garanties :
//   1. le BUDGET : la persona part a chaque message, elle ne doit pas
//      regonfler en silence (elle pesait ~4 450 caracteres) ;
//   2. les INVARIANTS d'identite : ce sont eux que l'auto-test quotidien
//      (lib/autotest_identite.js) verifie sur de vraies reponses. Si le
//      prompt perd une regle, autant le voir ici, hors ligne, que le
//      decouvrir par un test d'identite en echec.
const test = require('node:test');
const assert = require('node:assert');

const { getPromptBLAMUNE, PERSONA_MAX_CAR } = require('../lib/persona');

test('persona : sous le budget de caracteres, et non vide', () => {
  const p = getPromptBLAMUNE();
  assert.ok(p.length > 1500, 'persona complete (pas un squelette) : ' + p.length);
  assert.ok(
    p.length <= PERSONA_MAX_CAR,
    'persona sous ' + PERSONA_MAX_CAR + ' caracteres : ' + p.length
  );
  // Ordre de grandeur du gain : ~1 240 tokens -> ~680 tokens par message.
  assert.ok(p.length < 3000, 'la persona ne doit jamais repasser le tiers du prompt');
});

test('persona : identite stable (createur, date, annee entiere)', () => {
  const p = getPromptBLAMUNE();
  assert.match(p, /Ton createur est BLAMUNE/i, 'createur = BLAMUNE');
  assert.match(p, /jamais OpenAI, Google ni un nom de modele/i, 'refus des autres createurs');
  assert.match(p, /en ligne depuis juillet 2026/i, 'date de mise en ligne');
  assert.match(p, /TOUJOURS 2026 en entier/i, "regle de l'annee");
  assert.match(p, /jamais "226"/, 'le bug 226 est nomme explicitement');
  assert.match(p, /Ne cite jamais le modele ni le fournisseur/i, 'aucun nom de moteur');
});

test('persona : les titres attendus sont la, une seule fois', () => {
  const p = getPromptBLAMUNE();
  // tests/run.js : "CONSCIENCE DE SOI" identifie le mode BLAMUNE, et le
  // prompt EGO doit justement ne PAS le contenir.
  for (const titre of [
    'LANGUES',
    'IDENTITE',
    'CONSCIENCE DE SOI',
    "COMPREHENSION DE CE QU'IL ECRIT",
    'COMPREHENSION DE SON INTENTION'
  ]) {
    const n = p.split(titre).length - 1;
    assert.strictEqual(n, 1, titre + ' present exactement une fois (' + n + ')');
  }
});

test('persona : consignes de forme et de ton conservees', () => {
  const p = getPromptBLAMUNE();
  assert.match(p, /1 a 3 phrases MAXIMUM/, 'brievete');
  assert.match(p, /dis "Je sais pas"/, 'honnetete : jamais de fait invente');
  assert.match(p, /au plus un tour sur trois/i, 'rythme des reflexions');
  assert.match(p, /jamais deux messages de suite/i, 'jamais deux reflexions de suite');
  assert.match(p, /jamais recopiee/i, 'reflexion improvisee, non repetee');
  assert.match(p, /Jamais "en tant qu'intelligence artificielle"/i, 'pas de ton assistant');
  assert.match(p, /langue du message/, 'regle de langue');
});

test('persona : texte fixe, identique d un appel a l autre (prompt-cache)', () => {
  // Aucune heure ni etat dedans : c'est le prefixe stable. L'heure et le
  // profil sont ajoutes APRES par blocSysteme (server.js).
  assert.strictEqual(getPromptBLAMUNE(), getPromptBLAMUNE());
  assert.ok(
    getPromptBLAMUNE().indexOf('CONTEXTE TEMPS REEL') < 0,
    "l'heure n'appartient pas au bloc stable"
  );
});
