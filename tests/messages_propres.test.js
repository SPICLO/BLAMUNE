// ====================================================================
//  Tests unitaires : les textes servis au visiteur sont propres
// ====================================================================
//  Regression constatee le 2026-11-10 : les messages proactifs de
//  server.js (absence, promesse) s'affichaient chez le visiteur en
//  mojibake (« Tu m'as manquÃƒÆ'Ã†â€™... »), reliquats d'une chaine
//  d'encodages mal interpretes. Le texte est DESORMAIS ecrit en ASCII,
//  comme le reste du projet : plus rien a re-encoder, donc plus rien a
//  corrompre.
//
//  Ce fichier garde la porte fermee : il lit les sources et refuse tout
//  caractere de mojibake dans les chaines de texte visibles.
// ====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');

// Motifs de mojibake : UTF-8 relu en latin1, en double ou en triple.
const MOJIBAKE = /ÃƒÆ’|Ã¢â‚¬|Ãƒâ€|Ã©|Ã¨|Ã |â€™|â€œ|â€/;

function sourcesTexte() {
  return ['server.js', 'lib/routes/send.js', 'lib/routes/admin.js'].map((f) => ({
    nom: f,
    contenu: fs.readFileSync(path.join(RACINE, f), 'utf8')
  }));
}

test('aucun mojibake dans les fichiers qui servent du texte', () => {
  const fautifs = [];
  for (const { nom, contenu } of sourcesTexte()) {
    contenu.split('\n').forEach((ligne, i) => {
      if (MOJIBAKE.test(ligne)) fautifs.push(nom + ':' + (i + 1));
    });
  }
  assert.deepEqual(fautifs, [], 'lignes en mojibake (a reecrire en ASCII) : ' + fautifs.join(', '));
});

test('les textos proactifs ne contiennent que de l ASCII imprimable', () => {
  const src = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
  const debut = src.indexOf("cle: 'manque'");
  const fin = src.indexOf('return null;', debut);
  assert.ok(debut > 0 && fin > debut, 'bloc proactif introuvable');
  const bloc = src.slice(debut, fin);
  const horsAscii = bloc.split('\n').flatMap((l) =>
    l
      .split('')
      .map((c, i) => ({ c, i }))
      .filter((o) => o.c.charCodeAt(0) > 126)
      .map((o) => JSON.stringify(o.c))
  );
  assert.deepEqual(horsAscii, [], 'caracteres non ASCII dans les textos proactifs : ' + horsAscii);
});

test('le texte "manque" est grammatical (pas de tiret colle)', () => {
  const src = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
  assert.ok(src.includes("Tu m'as manque. Ca fait "), 'phrase d absence presente');
  assert.ok(src.includes("que t'as pas donne de nouvelles."), 'fin de phrase d absence presente');
});
