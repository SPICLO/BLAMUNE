// =====================================================================
//  Tests de la vectorisation locale et du client Qdrant faits
// =====================================================================
//  Lancement : node --test tests/qdrant_faits.test.js
//  AUCUN reseau : le client HTTP est injecte (requeteur) et rejoue des
//  reponses figees, les vrais appels REST sont verifies ailleurs (live).
// =====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  creerQdrantFaits,
  vectoriser,
  tokeniser,
  fnv1a,
  DIM,
  produitScalaire
} = require('../lib/qdrant_faits');

function sansAccents(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

test('vectorisation : >= 0, deterministe, divise par sa norme', () => {
  const v1 = vectoriser(' Achatsторе de blabla ', sansAccents);
  const v2 = vectoriser('achats de blabla', sansAccents);
  assert.strictEqual(v1.length, DIM);
  let s = 0;
  for (const x of v1) {
    s += x * x;
  }
  assert.ok(Math.abs(Math.sqrt(s) - 1) < 1e-9, 'norme L2 = 1');
  assert.strictEqual(JSON.stringify(v1), JSON.stringify(v2), 'stable');
});

test('similarite : une question reformulee > question sans rapport', () => {
  const prixOrdi = vectoriser('prix d un ordi portable achat ordinateur', sansAccents);
  const question1 = vectoriser('combien coute un ordi portable ?', sansAccents);
  const question2 = vectoriser('recette de gateau au chocolat', sansAccents);
  assert.ok(produitScalaire(question1, prixOrdi) > produitScalaire(question2, prixOrdi));
  assert.ok(
    produitScalaire(question1, prixOrdi) > 0.15,
    'un mot commun ("ordi") doit suffire a depasser 0.15'
  );
});

test('tokenisation : sauts stopwords, pluriel => singulier', () => {
  const t = tokeniser('les ordis sont bruyants je le sais', sansAccents);
  assert.ok(t.includes('ordis') && t.includes('ordi'));
  assert.ok(!t.includes('les') && !t.includes('je'));
});

// ---- Le client, avec un requeteur injecte (aucun reseau) -------------

function service(liste) {
  // Simulateur : liste de [methode, regexChemin, reponseJSON].
  return (methode, chemin) => {
    for (const [m, rx, rep] of liste) {
      if (m === methode && rx.test(chemin)) return Promise.resolve(rep);
    }
    return Promise.resolve(null);
  };
}

function fabrique(reponseur) {
  const q = creerQdrantFaits({
    url: 'https://qdrant.exemple.invalid',
    cleApi: 'k',
    collection: 'test-faits',
    sansAccents,
    seuilRecherche: 0.3,
    actifForcer: true,
    logger: null,
    requeteur: reponseur
  });
  return q;
}

test('client : chainage suppression collection, recreation, upsert par lots', async () => {
  const coups = [];
  const reponseur = (m, chemin, corps) => {
    coups.push(m + ' ' + chemin);
    if (m === 'DELETE') return Promise.resolve({ result: { operation_id: 1 } });
    return Promise.resolve({ result: { status: 'completed' } });
  };
  const q = fabrique(reponseur);
  const r = await q.synchroniserTout([
    { cle: 'prix du blabla', reponse: '30 euros', categorie: '' },
    { cle: 'horaires', reponse: '9h a 18h', categorie: '' }
  ]);
  assert.ok(r && r.total === 2);
  // 1. la collection existante est rasee...
  assert.ok(coups.some((c) => c.startsWith('DELETE /collections/test-faits')));
  // 2. ...recreee...
  assert.ok(coups.includes('PUT /collections/test-faits'));
  // 3. ...puis 2 faits = 1 seul lot de points.
  assert.strictEqual(
    coups.filter((c) => c.startsWith('PUT /collections/test-faits/points')).length,
    1
  );
});

test('recherche : filtre par le seuil, portes cle original', async () => {
  const recalque = {
    prix: 0.72,
    horaires: 0.05,
    meteo: 0.9
  };
  const reponseur = service([
    // Le vrai Qdrant renvoie deja TRIE par score decroissant.
    [
      'POST',
      /\/points\/search$/,
      {
        result: [
          {
            score: recalque.meteo,
            payload: { cle_orig: 'Meteo', cle: 'meteo', reponse: 'Il fait beau', categorie: '' }
          },
          {
            score: recalque.prix,
            payload: {
              cle_orig: 'prix du blabla',
              cle: 'prix-du-blabla',
              reponse: '30 euros',
              categorie: ''
            }
          },
          {
            score: recalque.horaires,
            payload: { cle_orig: 'horaires', cle: 'horaires', reponse: '9h', categorie: '' }
          }
        ]
      }
    ]
  ]);
  const q = fabrique(reponseur);
  const r = await q.chercher('pardon quelle heure');
  // 0.05 < seuil 0.30 : exclu ; meteo 0.9 et prix 0.72 restent.
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].cle, 'Meteo');
  assert.ok(r.every((x) => x.score >= 0.3));
});

test('vecteurs fournis (Gemini) : passes tels quels, dimensions respectees', async () => {
  const coups = [];
  const q = creerQdrantFaits({
    url: 'https://qdrant.exemple.invalid',
    cleApi: 'k',
    collection: 'test-faits',
    sansAccents,
    actifForcer: true,
    logger: null,
    requeteur: (m, chemin, corps) => {
      coups.push({ m, chemin, corps });
      return Promise.resolve({ result: { status: 'completed' } });
    }
  });
  const v = new Array(768).fill(0.02); // vecteur "Gemini" 768 d
  const r = await q.synchroniserTout([
    { cle: 'tokyo', reponse: 'c est la capitale du japon', categorie: '', vecteur: v }
  ]);
  assert.ok(r && r.total === 1);
  const creation = coups.find((c) => c.m === 'PUT' && c.chemin === '/collections/test-faits');
  assert.strictEqual(
    creation.corps.vectors.size,
    768,
    'collection alignee sur la dimension fournie'
  );
  const lot = coups.find((c) => c.m === 'PUT' && /\/points$/.test(c.chemin));
  assert.deepStrictEqual(lot.corps.points[0].vector, v);
});

test('echec reseau : chercher() rend null, synchroniserTout() rend null', async () => {
  const q = fabrique(() => Promise.resolve(null));
  assert.strictEqual(await q.chercher('nimporte'), null);
  assert.strictEqual(await q.synchroniserTout([{ cle: 'a', reponse: 'b' }]), null);
});

test('sans config : inactif, aucune demande reseau', async () => {
  let compteur = 0;
  const q = creerQdrantFaits({
    url: '',
    cleApi: '',
    collection: 'x',
    sansAccents,
    logger: null,
    requeteur: () => {
      compteur++;
      return Promise.resolve({});
    }
  });
  assert.strictEqual(q.actif(), false);
  assert.strictEqual(await q.chercher('salut'), null);
  assert.strictEqual(await q.synchroniserTout([]), null);
  assert.strictEqual(compteur, 0);
});

test('fnv1a : collide pas les cles differentes courantes', () => {
  const vus = new Set(
    ['prix', 'horaires', 'meteo', 'ordi', 'cafe'].map((k) => fnv1a(k) % 2147483647)
  );
  assert.strictEqual(vus.size, 5);
});
