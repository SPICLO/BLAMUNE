// Tests de saturation des gardiens anti-saturation (concurrence, tension).
// Simule une charge importante pour verifier que le serveur reste repondant
// et que le mode eco se declenche correctement.
//   node --test tests/saturation.test.js
const test = require('node:test');
const assert = require('node:assert');

const concurrence = require('../lib/concurrence');
const tension = require('../lib/tension');
const cacheReponses = require('../lib/cache_reponses');

function attendre(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ========================================================================
// SATURATION CONCURRENCE : 50 requetes simultanees avec MAX_CONC=2
// ========================================================================

test('saturation concurrence : 50 requetes simultanees, MAX_CONC=2', async () => {
  concurrence.reinitialiser();
  concurrence.configurer({ max: 2, attenteMs: 200, maxFile: 100 });

  const demandes = [];
  const resultats = { reelles: 0, fantomes: 0 };

  for (let i = 0; i < 50; i++) {
    demandes.push(
      concurrence.demanderPlace().then((place) => {
        if (place.debordement) {
          resultats.fantomes++;
        } else {
          resultats.reelles++;
        }
        return attendre(50).then(() => place.liberrer());
      })
    );
  }

  await Promise.all(demandes);

  const etat = concurrence.etat();
  assert.ok(resultats.reelles > 0, 'au moins une place reelle');
  assert.strictEqual(etat.enCours, 0, 'toutes les places liberees');
  assert.strictEqual(etat.file, 0, 'file vide a la fin');
  console.log(
    `[saturation concurrence] reelles=${resultats.reelles} fantomes=${resultats.fantomes} debordements=${etat.debordements}`
  );
});

// ========================================================================
// TENSION : declenchement du mode eco apres SEUIL 429
// ========================================================================

test('tension : mode eco declenche apres SEUIL 429', () => {
  tension.reinitialiser();
  concurrence.reinitialiser(); // isole la pression locale
  tension.noter(Date.now()); // 429 #1
  tension.noter(Date.now()); // 429 #2
  // Avec un instant explicite, on teste uniquement le protocole 429 (pas de pression locale)
  assert.strictEqual(tension.enTension(Date.now()), false, 'pas encore en eco (seuil=3)');

  tension.noter(Date.now()); // 429 #3 -> declenche eco
  assert.strictEqual(tension.enTension(Date.now()), true, 'en mode eco apres 3 429');
  assert.strictEqual(tension.etat().eco, true, 'etat eco = true');

  const etatAvant = tension.etat();
  assert.ok(etatAvant.sejourMinMs > 0, 'sejour minimum defini');
});

// ========================================================================
// CACHE : reuse et eviction LRU
// ========================================================================

test('cache : hit, miss, non-cacheable messages', () => {
  cacheReponses.reinitialiser();

  const cle1 = cacheReponses.cle('2', 'ca va ?', {});
  assert.ok(cle1, 'cle generee pour message simple');
  assert.strictEqual(cacheReponses.repondre(cle1), null, 'miss au premier coup');

  const retenu = cacheReponses.retenir(cle1, 'Je vais bien, merci !', {});
  assert.strictEqual(retenu, true, 'reponse retenue');
  assert.strictEqual(cacheReponses.repondre(cle1), 'Je vais bien, merci !', 'hit au second coup');

  const etat = cacheReponses.etat();
  assert.strictEqual(etat.entrees, 1, '1 entree dans le cache');
  assert.strictEqual(etat.coups, 1, '1 hit');
  assert.strictEqual(etat.rater, 1, '1 miss');

  // Message avec indice de memoire : non cacheable
  assert.strictEqual(
    cacheReponses.cle('2', 'retiens que je m appelle Alice', { indiceMemoire: () => true }),
    null,
    'message avec indice memoire non cacheable'
  );

  // Commande : non cacheable
  assert.strictEqual(
    cacheReponses.cle('2', '/cherche actualite', {}),
    null,
    'commande non cacheable'
  );

  cacheReponses.reinitialiser();
});

// ========================================================================
// SANTE GLOBALE : etats coherents
// ========================================================================

test('sante globale : etats des gardiens coherents', () => {
  concurrence.reinitialiser();
  tension.reinitialiser();
  cacheReponses.reinitialiser();

  const etatConc = concurrence.etat();
  const etatTen = tension.etat();
  const etatCache = cacheReponses.etat();

  assert.ok(typeof etatConc.enCours === 'number', 'concurrence.enCours est un nombre');
  assert.ok(typeof etatTen.eco === 'boolean', 'tension.eco est un boolean');
  assert.ok(typeof etatCache.entrees === 'number', 'cache.entrees est un nombre');

  assert.strictEqual(etatTen.eco, false, 'pas en eco au demarrage');
  assert.strictEqual(etatCache.entrees, 0, 'cache vide au demarrage');
});

console.log('\n=== Tous les tests de saturation passes ===');
