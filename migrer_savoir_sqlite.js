#!/usr/bin/env node
// Migration du savoir vers SQLite.
//
//   node migrer_savoir_sqlite.js            # cree/agrege la base
//   node migrer_savoir_sqlite.js --rapport  # montre l'etat sans ecrire
//
// Le fichier savoir.txt reste l'export lisible (git, bot Windows local,
// sauvegarde JSONBin) : il est regenere depuis la base, jamais lu comme
// source de verite par le serveur.
const fs = require('fs');
const path = require('path');
const { SavoirDB } = require('./savoir_db');

const RACINE = process.env.BLAMUNE_DATA_DIR
  ? path.resolve(process.env.BLAMUNE_DATA_DIR)
  : __dirname;
const FICHIER_SAVOIR = process.argv.includes('--fichier')
  ? process.argv[process.argv.indexOf('--fichier') + 1]
  : path.join(RACINE, 'savoir.txt');
const BASE = path.join(RACINE, 'savoir.db');
const rapport = process.argv.includes('--rapport');

if (!fs.existsSync(FICHIER_SAVOIR)) {
  console.error('Fichier introuvable : ' + FICHIER_SAVOIR);
  process.exit(1);
}

const lignes = fs.readFileSync(FICHIER_SAVOIR, 'utf8')
  .split('\n')
  .map(l => l.replace(/\r$/, ''))
  .filter(l => l.trim());

// Diagnostic du fichier avant migration : met en evidence les entrees
// suspectes (reponse vide = mot-cle, ou ligne sans separateur).
const sansSeparateur = lignes.filter(l => l.indexOf('|') <= 0);
const motsClesVides = lignes.filter(l => {
  const pos = l.indexOf('|');
  if (pos <= 0) return false;
  let rep = l.substring(pos + 1);
  const pos2 = rep.indexOf('|');
  if (pos2 >= 0) rep = rep.substring(0, pos2);
  return !rep.trim();
});

console.log('Fichier   : ' + FICHIER_SAVOIR);
console.log('Base      : ' + BASE);
console.log('Lignes    : ' + lignes.length);
console.log('  sans separateur (ignorees) : ' + sansSeparateur.length);
console.log('  mots-cles sans reponse    : ' + motsClesVides.length);

if (rapport) {
  console.log('\nMode rapport : aucune ecriture.');
  process.exit(0);
}

const db = new SavoirDB(RACINE, BASE);
const avant = db.total();
const n = db.importerFichier(FICHIER_SAVOIR);
const apres = db.total();
const exportes = db.exporter(path.join(RACINE, 'savoir.txt'));

console.log('\nLignes importees : ' + n);
console.log('Entrees en base : ' + avant + ' -> ' + apres);
console.log('Export regenere : ' + exportes + ' lignes');
db.fermer();
console.log('\nMigration terminee.');