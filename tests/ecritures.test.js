// =====================================================================
//  Tests : ecritures differees (lib/ecritures.js) — phase 3, P3-1
// =====================================================================
//  Lancement : node --test tests/ecritures.test.js
//  Aucun serveur : le module ne fait que du disque sur un dossier temporaire.
// =====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { creerEcritures } = require('../lib/ecritures');

function dossier(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blamune-ecritures-'));
  t.after(() => {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch (e) {}
  });
  return d;
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

test('differe : N demandes sur la meme cle = UNE ecriture, le dernier contenu gagne', async (t) => {
  const d = dossier(t);
  const f = path.join(d, 'etat.json');
  const e = creerEcritures({ flushMs: 30 });
  for (let i = 1; i <= 20; i++) e.differer('etat:u1', f, JSON.stringify({ n: i }));
  assert.strictEqual(fs.existsSync(f), false, 'rien ne doit etre ecrit avant la fenetre');
  assert.strictEqual(e.etat().enAttente, 1, 'une seule ecriture en attente');
  assert.strictEqual(e.etat().demandes, 20, 'les 20 demandes sont comptees');
  await attendre(80);
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(f, 'utf8')),
    { n: 20 },
    'dernier contenu ecrit'
  );
  const s = e.etat();
  assert.strictEqual(s.ecritures, 1, 'une seule ecriture disque reelle');
  assert.strictEqual(s.enAttente, 0, 'file videe');
});

test('differe : deux cles differentes partent dans deux fichiers', async (t) => {
  const d = dossier(t);
  const e = creerEcritures({ flushMs: 20 });
  e.differer('etat:u1', path.join(d, 'a.json'), 'A');
  e.differer('etat:u2', path.join(d, 'b.json'), 'B');
  await attendre(60);
  assert.strictEqual(fs.readFileSync(path.join(d, 'a.json'), 'utf8'), 'A');
  assert.strictEqual(fs.readFileSync(path.join(d, 'b.json'), 'utf8'), 'B');
  assert.strictEqual(e.etat().ecritures, 2);
});

test('vider() ecrit tout ce qui attend (arret propre) et annule le minuteur', (t) => {
  const d = dossier(t);
  const e = creerEcritures({ flushMs: 60000 });
  e.differer('memoire:u1', path.join(d, 'm.txt'), 'nom|Maeva');
  assert.strictEqual(fs.existsSync(path.join(d, 'm.txt')), false);
  const n = e.vider();
  assert.strictEqual(n, 1, 'un fichier ecrit');
  assert.strictEqual(fs.readFileSync(path.join(d, 'm.txt'), 'utf8'), 'nom|Maeva');
  assert.strictEqual(e.etat().enAttente, 0, 'plus rien en attente');
});

test('oublier() : une purge annule l ecriture et le fichier ne revient jamais', async (t) => {
  const d = dossier(t);
  const f = path.join(d, 'disparu.json');
  const e = creerEcritures({ flushMs: 20 });
  e.differer('etat:inv_1', f, '{"x":1}');
  e.oublier('etat:inv_1');
  await attendre(60);
  assert.strictEqual(fs.existsSync(f), false, 'le flush ne ressuscite pas un uid purge');
  assert.strictEqual(e.etat().enAttente, 0);
});

test('flushMs = 0 : ecriture immediate, rien n attend', (t) => {
  const d = dossier(t);
  const f = path.join(d, 'immediat.txt');
  const e = creerEcritures({ flushMs: 0 });
  e.differer('k', f, 'v');
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'v', 'ecrit tout de suite');
  assert.strictEqual(e.etat().enAttente, 0);
  assert.strictEqual(e.etat().ecritures, 1);
});

test('un echec d ecriture est compte, pas jete', (t) => {
  const d = dossier(t);
  const e = creerEcritures({ flushMs: 0 });
  const ok = e.differer('k', path.join(d, 'dossier-inexistant', 'x.txt'), 'v');
  assert.strictEqual(ok, false, 'echec signale');
  assert.strictEqual(e.etat().echecs, 1, 'echec compte');
});

test('octets : le compteur mesure la taille reelle ecrite', (t) => {
  const d = dossier(t);
  const e = creerEcritures({ flushMs: 0 });
  const contenu = 'abc\u00e9'; // 4 caracteres, 5 octets en UTF-8
  e.differer('k', path.join(d, 'o.txt'), contenu);
  assert.strictEqual(e.etat().octets, Buffer.byteLength(contenu));
});
