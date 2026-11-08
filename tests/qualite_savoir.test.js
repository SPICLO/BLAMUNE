// =====================================================================
//  Tests : qualite du savoir SERVI (correctif C)
// =====================================================================
//  Lancement : node --test tests/qualite_savoir.test.js
//  Aucun serveur : la base et l'export sont lus sur place.
//
//  Ce que ce test garde : un fait dont la REPONSE contient le bruit d'une
//  citation mal decoupee (\" ou `) est servi mot pour mot au visiteur.
//  Trois faits de production en portaient (plage, ciel, farine) et
//  aucun test ne regardait le CONTENU — seule l'authentification etait
//  verifiee. Ce fichier ferme ce trou sur le savoir de depot : il echoue
//  si le bruit revient par une edition manuelle de savoir.txt.
//
//  Limite assumee : les faits APPRIS en usage (source 'auto', 'web',
//  'recherche-web') ne vivent pas dans le depot ; c'est au controle
//  d'ecriture de les refuser (voir poste /savoir dans tests/run.js).
// =====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const LIGNES = fs.readFileSync(path.join(RACINE, 'savoir.txt'), 'utf8').split('\n').filter(Boolean);

function reponses(ligne) {
  // Format : cle|reponse|categorie
  const debut = ligne.indexOf('|') + 1;
  const fin = ligne.lastIndexOf('|');
  return fin > debut ? ligne.slice(debut, fin) : ligne.slice(debut);
}

test('savoir.txt : aucune reponse avec un artefact de citation (\\" ou `)', () => {
  const bruit = LIGNES.filter((l) => /\\"|`/.test(reponses(l)));
  assert.deepStrictEqual(
    bruit.map((l) => l.slice(0, l.indexOf('|'))),
    [],
    'faits a corriger dans savoir.txt'
  );
});

test('savoir.txt : une reponse par ligne, non vide, cle sans separateur', () => {
  const mauvaises = LIGNES.filter((l) => {
    const i = l.indexOf('|');
    if (i <= 0) return true;
    const r = reponses(l);
    return !r.trim() || /[|\r]/.test(l.slice(i + 1, l.lastIndexOf('|')));
  });
  assert.deepStrictEqual(
    mauvaises.slice(0, 5).map((l) => l.slice(0, 80)),
    [],
    'ligne malformee : cle vide, reponse vide ou separateur en trop'
  );
});

test('savoir.txt : les faits corriges ne repondent plus avec le bruit', () => {
  // Les trois cas trouves en production, gardes comme cas de non-regression.
  for (const cle of ['plage', 'ciel', 'farine']) {
    const l = LIGNES.find((x) => x.startsWith(cle + '|'));
    assert.ok(l, 'fait introuvable : ' + cle);
    const r = reponses(l);
    assert.ok(!/\\"|`/.test(r), cle + ' porte encore un artefact de citation');
    assert.ok(/[éèà]/.test(r), cle + ' a perdu ses accents (encodage casse)');
  }
});
