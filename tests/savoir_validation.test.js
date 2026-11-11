// =====================================================================
//  Tests : validation des faits pousses par les invites — phase 3, P3-5
// =====================================================================
//  Lancement : node --test tests/savoir_validation.test.js
//  Aucun serveur : la base SQLite sur un dossier temporaire.
//
//  La regle testee ici est celle tranchee par le proprietaire : « un invite
//  peut faire apprendre un fait a BLAMUNE, mais rien n'est servi avant la
//  validation admin ». Trois consequences, chacune un test :
//    1. le fait propose existe en base mais n'est PAS servisable ;
//    2. la validation le rend servisable (une seule fois) ;
//    3. une correction proposee sur un fait deja valide ne fait pas taire
//    l'ancienne reponse.
// =====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SavoirDB } = require('../savoir_db');

function base(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blamune-savoir-'));
  t.after(() => {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch (e) { }
  });
  const db = new SavoirDB(d);
  t.after(() => db.fermer());
  return db;
}

test('un fait propose est en base mais hors des faits servis', (t) => {
  const db = base(t);
  db.repondre('okapi de test', 'un animal a rayures', null, 0);
  assert.strictEqual(db.total(), 1, 'le fait doit exister en base');
  const servis = db.toutes().map((f) => f.cle);
  assert.deepStrictEqual(servis, [], 'un fait en attente ne doit jamais etre servi');
  assert.strictEqual(db.faitsEnAttente().length, 1, 'il doit apparaitre dans la file');
  assert.strictEqual(db.faitsEnAttente()[0].reponse, 'un animal a rayures');
});

test('valider rend le fait servisable, et une seule fois', (t) => {
  const db = base(t);
  db.repondre('okapi de test', 'un animal a rayures', null, 0);
  assert.strictEqual(db.valider('okapi de test'), true, 'premiere validation');
  assert.deepStrictEqual(
    db.toutes().map((f) => f.cle),
    ['okapi de test'],
    'le fait valide repond'
  );
  assert.strictEqual(db.faitsEnAttente().length, 0, 'la file se vide');
  assert.strictEqual(
    db.valider('okapi de test'),
    false,
    'une deuxieme validation ne doit rien changer'
  );
  assert.strictEqual(db.valider('fait qui nexiste pas'), false);
});

test('une correction proposee ne fait pas taire l ancienne reponse', (t) => {
  const db = base(t);
  db.repondre('okapi de test', 'un animal a rayures', null, 0);
  db.valider('okapi de test');
  // L'invite re-pousse la meme cle : le texte change, l'etat repasse en
  // attente — l'ancien fait valide cesse d'etre servi jusqu'a l'accord.
  db.repondre('okapi de test', 'un animal aux pattes zbrees', null, 0);
  assert.deepStrictEqual(db.toutes(), [], 'la correction non validee ne sert pas');
  assert.strictEqual(db.faitsEnAttente().length, 1);
  db.valider('okapi de test');
  assert.strictEqual(db.toutes()[0].reponse, 'un animal aux pattes zbrees');
});

test('un fait ecrit par l admin ou un compte est servi directement', (t) => {
  const db = base(t);
  db.mettre('tapir de test', 'un mammifere a trompe', null, 'admin');
  assert.deepStrictEqual(
    db.toutes().map((f) => f.cle),
    ['tapir de test'],
    'sans etat d attente, le fait repond tout de suite'
  );
  assert.strictEqual(db.faitsEnAttente().length, 0);
});

test('une base existante (sans colonne valide) migre sans perdre un fait', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blamune-savoir-v1-'));
  t.after(() => {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch (e) { }
  });
  // Schema d'AVANT P3-5 : pas de colonne `valide`.
  const { DatabaseSync } = require('node:sqlite');
  const brute = new DatabaseSync(path.join(d, 'savoir.db'));
  brute.exec(`
    CREATE TABLE savoir (
      cle_norm TEXT PRIMARY KEY, cle TEXT NOT NULL,
      reponse TEXT NOT NULL DEFAULT '', categorie INTEGER, rang INTEGER,
      source TEXT NOT NULL DEFAULT 'fichier',
      maj_le TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE meta (cle TEXT PRIMARY KEY, valeur TEXT);
    INSERT INTO savoir (cle_norm, cle, reponse) VALUES ('tokyo', 'tokyo', 'capitale du japon');
  `);
  brute.close();
  const db = new SavoirDB(d);
  t.after(() => db.fermer());
  assert.deepStrictEqual(
    db.toutes().map((f) => f.cle),
    ['tokyo'],
    'les faits existants restent servis (valide par defaut)'
  );
  assert.strictEqual(db.faitsEnAttente().length, 0);
});
