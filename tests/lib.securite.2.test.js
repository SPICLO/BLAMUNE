const test = require('node:test');
// ====================================================================
//  Tests unitaires : lib/securite.js (partie 2)
// ====================================================================
('use strict');

const assert = require('node:assert/strict');
const {
  uidValide,
  RE_UID_COMPTE,
  RE_UID_INVITE,
  appliquerEnTetesSecurite,
  limiterRoute,
  hashMdpScrypt,
  verifierMdpScrypt,
  genererJeton
} = require('../lib/securite');

// ------------------------------------------------------------------
// 2. uidValide()
// ------------------------------------------------------------------
test('uidValide: accepte un uid de compte valide', () => {
  assert.ok(uidValide('u' + 'a'.repeat(12)));
});

test('uidValide: accepte un uid d invite valide', () => {
  assert.ok(uidValide('inv_' + '0123456789abcdef01234567'));
});

test('uidValide: refuse un uid vide', () => {
  assert.ok(!uidValide(''));
  assert.ok(!uidValide(null));
  assert.ok(!uidValide(undefined));
});

test('uidValide: refuse un uid avec caracteres speciaux', () => {
  assert.ok(!uidValide('../admin'));
  assert.ok(!uidValide('user/../../admin'));
  assert.ok(!uidValide('user name'));
  assert.ok(!uidValide('user@domain'));
});

test('uidValide: refuse les traversÃ©es de repertoire', () => {
  assert.ok(!uidValide('../../etc/passwd'));
  assert.ok(!uidValide('..\\..\\windows\\system32'));
});

test('uidValide: refuse un uid trop long', () => {
  const long = 'u' + 'a'.repeat(70);
  assert.ok(!uidValide(long));
});

test('uidValide: refuse un uid trop court', () => {
  assert.ok(!uidValide('u1'));
  assert.ok(!uidValide('inv_123'));
});

test('uidValide: refuse un uid non conforme au format', () => {
  assert.ok(!uidValide('admin'));
  assert.ok(!uidValide('inv'));
  assert.ok(!uidValide('u1234567890123')); // 13 chars
  assert.ok(!uidValide('inv_12345678901234567890123')); // 23 chars
});

test('RE_UID_COMPTE correspond bien au format attendu', () => {
  assert.ok(RE_UID_COMPTE.test('u' + '0'.repeat(12)));
  assert.ok(!RE_UID_COMPTE.test('u' + '0'.repeat(11)));
  assert.ok(!RE_UID_COMPTE.test('u' + '0'.repeat(13)));
});

test('RE_UID_INVITE correspond bien au format attendu', () => {
  assert.ok(RE_UID_INVITE.test('inv_' + '0'.repeat(24)));
  assert.ok(!RE_UID_INVITE.test('inv_' + '0'.repeat(23)));
  assert.ok(!RE_UID_INVITE.test('inv_' + '0'.repeat(25)));
});

// ------------------------------------------------------------------
// 3. appliquerEnTetesSecurite()
// ------------------------------------------------------------------
test('appliquerEnTetesSecurite: ajoute les en-tetes de securite', () => {
  const res = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    }
  };
  appliquerEnTetesSecurite(res);
  assert.ok(res.headers['X-Frame-Options']);
  assert.ok(res.headers['X-Content-Type-Options']);
  assert.ok(res.headers['Strict-Transport-Security']);
  assert.ok(res.headers['Content-Security-Policy']);
});

// ------------------------------------------------------------------
// 4. limiterRoute()
// ------------------------------------------------------------------
test('limiterRoute: retourne les limites pour /send', () => {
  const l = limiterRoute('send');
  assert.ok(l.ip > 0);
  assert.ok(l.uid > 0);
});

test('limiterRoute: retourne les limites pour /login', () => {
  const l = limiterRoute('login');
  assert.equal(l.ip, 10);
});

test('limiterRoute: retourne les limites pour /register', () => {
  const l = limiterRoute('register');
  assert.equal(l.ip, 5);
});

test('limiterRoute: retourne les limites pour /admin', () => {
  const l = limiterRoute('admin');
  assert.equal(l.ip, 5);
});

test('limiterRoute: retourne les limites pour /historique', () => {
  const l = limiterRoute('historique');
  assert.equal(l.uid, 30);
});

test('limiterRoute: retourne les limites par defaut pour les routes inconnues', () => {
  const l = limiterRoute('inconnu');
  assert.deepEqual(l, {});
});

// ------------------------------------------------------------------
// 5. hashMdpScrypt() et verifierMdpScrypt()
// ------------------------------------------------------------------
test('hashMdpScrypt: crÃ©e un hash avec sel + hache', () => {
  const sel = genererJeton(16);
  const hash = hashMdpScrypt('monMotDePasse123', sel);
  assert.ok(hash.includes(':'));
  const parts = hash.split(':');
  assert.equal(parts.length, 2);
  assert.equal(parts[0].length, 32); // 16 bytes hex
  assert.ok(parts[1].length > 0);
});

test('hashMdpScrypt: le hash est different pour le meme mot de passe', () => {
  const sel1 = 'a'.repeat(16);
  const sel2 = 'b'.repeat(16);
  const h1 = hashMdpScrypt('password', sel1);
  const h2 = hashMdpScrypt('password', sel2);
  assert.notEqual(h1, h2);
});

test('hashMdpScrypt: verifie un mot de passe correct', () => {
  const sel = 'a'.repeat(16);
  const hash = hashMdpScrypt('monMdp123', sel);
  assert.ok(verifierMdpScrypt('monMdp123', hash));
});

test('hashMdpScrypt: refuse un mot de passe incorrect', () => {
  const sel = 'a'.repeat(16);
  const hash = hashMdpScrypt('monMdp123', sel);
  assert.ok(!verifierMdpScrypt('mauvaisMdp', hash));
});

test('hashMdpScrypt: refuse un hash malforme', () => {
  assert.ok(!verifierMdpScrypt('password', 'invalide'));
  assert.ok(!verifierMdpScrypt('password', 'no-colon-here'));
});

// ------------------------------------------------------------------
// 6. genererJeton()
// ------------------------------------------------------------------
test('genererJeton: genere un token de la taille demande', () => {
  const token = genererJeton(32);
  assert.equal(token.length, 64); // 32 bytes = 64 hex chars
});

test('genererJeton: genere des tokens uniques', () => {
  const tokens = new Set();
  for (let i = 0; i < 100; i++) {
    tokens.add(genererJeton(16));
  }
  assert.equal(tokens.size, 100);
});
