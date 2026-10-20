// =====================================================================
//  Tests du pool multi-fournisseur (lib/pool_ia.js)
// =====================================================================
//  Lancement : node --test tests/pool_ia.test.js
//  Aucun reseau : le temps est injecte (instant) pour rejouer les cooldown
//  en quelques microsecondes.
// =====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { creerPoolIA } = require('../lib/pool_ia');

const T0 = 1_700_000_000_000;

function fabrique({ env = '', principal = true } = {}) {
  return creerPoolIA({
    sourcesEnv: env,
    membrePrincipal: principal
      ? () => ({ nom: 'principal', url: 'http://principal/v1', cle: 'k', modele: 'm-principal' })
      : null,
    cooldownMs: 60000,
    cooldownAuthMs: 600000,
    logger: null
  });
}

test('parse d API_POOL : nom|url|cle|modele, cle facultative, blocs incomplets ignores', () => {
  const r = fabrique({
    env: 'a|http://a/v1|cleA|modelA; b|http://b/v1||modelB;  ; c|http://c/v1|| ; x|http://x/v1|k'
  });
  assert.strictEqual(r.actif(), true); // principal + a + b = 3 membres valides (c sans modele ignore)
  const ordre = r.ordre(T0);
  // 3 membres valides : principal, a, b
  assert.strictEqual(ordre.length, 3);
  assert.strictEqual(ordre[0].nom, 'principal');
  assert.ok(ordre.some((m) => m.nom === 'a' && m.cle === 'cleA'));
  assert.ok(ordre.some((m) => m.nom === 'b' && m.cle === ''));
});

test('principal vivant : membrePrincipal() est rappele a chaque ordre()', () => {
  let modele = 'avant';
  const r = creerPoolIA({
    sourcesEnv: '',
    membrePrincipal: () => ({ nom: 'principal', url: 'http://p/v1', cle: '', modele }),
    cooldownMs: 60000,
    cooldownAuthMs: 600000,
    logger: null
  });
  assert.strictEqual(r.ordre(T0)[0].modele, 'avant');
  modele = 'apres'; // simule /config-api sans redemarrage
  assert.strictEqual(r.ordre(T0)[0].modele, 'apres');
});

test('pool inactif : aucun membre additionnel', () => {
  assert.strictEqual(fabrique({}).actif(), false);
});

test('rotation : principal en echec 429 -> le membre avec cooldown fait place nette', () => {
  const r = fabrique({ env: 'groq|http://g/v1|k|llama; cerebras|http://c/v1||70b' });
  const ordre1 = r.ordre(T0);
  assert.strictEqual(ordre1[0].nom, 'principal');
  // principal plaie 429 : sorti pendant 60 s
  r.noteEchec('principal', { statusCode: 429 }, T0);
  const ordre2 = r.ordre(T0);
  assert.ok(ordre2.every((m) => m.nom !== 'principal'));
  assert.strictEqual(ordre2.length, 2);
  // sante expose les cooldowns
  const s = r.sante(T0).find((x) => x.nom === 'principal');
  assert.ok(s.cooldownMsRestant > 0 && s.cooldownMsRestant <= 60000);
});

test('cooldown expire : le membre redevient disponible', () => {
  const r = fabrique({ env: 'groq|http://g/v1|k|llama' });
  r.noteEchec('groq', { statusCode: 429 }, T0);
  assert.ok(!r.ordre(T0).some((m) => m.nom === 'groq'));
  assert.ok(r.ordre(T0 + 61000).some((m) => m.nom === 'groq'));
});

test('401/403 = cooldown long (10 min), 400 = pas de cooldown', () => {
  const r = fabrique({ env: 'a|http://a/v1|k|m' });
  r.noteEchec('a', { statusCode: 401 }, T0);
  assert.ok(!r.ordre(T0).some((m) => m.nom === 'a'));
  assert.ok(!r.ordre(T0 + 61000).some((m) => m.nom === 'a'));
  assert.ok(r.ordre(T0 + 601000).some((m) => m.nom === 'a'));

  const r2 = fabrique({ env: 'b|http://b/v1||m' });
  r2.noteEchec('b', { statusCode: 400 }, T0);
  assert.ok(r2.ordre(T0).some((m) => m.nom === 'b')); // erreur persistante : pas de cooldown
});

test('noteOk efface le cooldown du membre qui repond', () => {
  const r = fabrique({ env: 'a|http://a/v1|k|m; b|http://b/v1||m' });
  r.noteEchec('b', { statusCode: 429 }, T0);
  assert.ok(!r.ordre(T0).some((m) => m.nom === 'b'));
  r.noteOk('b');
  assert.ok(r.ordre(T0).some((m) => m.nom === 'b'));
  assert.strictEqual(r.sante(T0).find((x) => x.nom === 'b').cooldownMsRestant, 0);
});

test('sticky : le dernier membre qui a repondu revient en tete', () => {
  const r = fabrique({ env: 'a|http://a/v1|k|m; b|http://b/v1||m' });
  r.noteOk('b', T0);
  assert.strictEqual(r.ordre(T0)[0].nom, 'b');
  r.noteOk('principal', T0);
  assert.strictEqual(r.ordre(T0)[0].nom, 'principal');
});

test('serveur mort (ECONNREFUSED/Timeout) : cooldown standard', () => {
  const r = fabrique({ env: 'a|http://a/v1|k|m' });
  r.noteEchec('a', { code: 'ECONNREFUSED' }, T0);
  assert.ok(!r.ordre(T0).some((m) => m.nom === 'a'));
  r.noteEchec('a', new Error('Timeout'), T0 + 70000);
  assert.ok(!r.ordre(T0 + 70000).some((m) => m.nom === 'a'));
});

test('membreFond : le 1er membre reste au chat, fond du dernier vers le premier', () => {
  const r = fabrique({
    env: 'groq|http://g/v1|k|llama; pollinations|http://p/v1||fast; mistral|http://m/v1|k2|small'
  });
  // fond = le dernier membre declare (le « boursier » lent du bout de liste)
  assert.strictEqual(r.membreFond(T0).nom, 'mistral');
  r.noteEchec('mistral', { statusCode: 429 }, T0);
  // mistral en cooldown : la tache remonte vers pollinations, jamais groq
  assert.strictEqual(r.membreFond(T0).nom, 'pollinations');
  r.noteEchec('pollinations', { statusCode: 429 }, T0);
  // tout fond en cooldown : null — la bouee du chat n'est jamais donnee
  assert.strictEqual(r.membreFond(T0), null);
  // cooldowns expires : le fond redevient disponible
  assert.strictEqual(r.membreFond(T0 + 61000).nom, 'mistral');
  // un membne seul dans le pool : tout pour le chat, aucune tache de fond
  const r1 = fabrique({ env: 'groq|http://g/v1|k|llama' });
  assert.strictEqual(r1.membreFond(T0), null);
});

test('membreFond ne depend pas du sticky du chat', () => {
  const r = fabrique({ env: 'groq|http://g/v1|k|llama; pollinations|http://p/v1||fast' });
  // noteOk du chat : groq redevient sticky en tete d'ordre()
  r.noteOk('groq', T0);
  assert.strictEqual(r.ordre(T0)[0].nom, 'groq');
  // le fond suit l'ordre DU FICHIER DECLARE, pas le sticky du chat
  assert.strictEqual(r.membreFond(T0).nom, 'pollinations');
});

test('aSecours : des qu un membre additionnel existe, meme seul', () => {
  // Pas d'API_POOL : aucun membre de secours, meme principal present
  assert.strictEqual(fabrique({}).aSecours(), false);
  // Un membre seul suffit pour armer le pilier
  assert.strictEqual(fabrique({ env: 'groq|http://g/v1|k|llama' }).aSecours(), true);
  assert.strictEqual(
    fabrique({ principal: false, env: 'groq|http://g/v1|k|llama' }).aSecours(),
    true
  );
});
