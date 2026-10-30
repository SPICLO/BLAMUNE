# Gardiens anti-saturation : historique dégradé en éco + Retry-After — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** pendant la tension (mode éco), réduire ce que chaque appel dépense — l'historique envoyé au modèle passe de 16 à 6 échanges — et lire l'en-tête standard `Retry-After` pour attendre le délai exact que le fournisseur impose, au lieu de dépendre de la formulation du message d'erreur.

**Architecture :** le goulot des 429 existe déjà (`marquerQuota` → `lib/tension.js`, singleton). On ajoute (1) une fonction pure `retryApresDepuisEnTete(valeur)` (module `lib/ia/gemini.js`, comme `estQuota`), lue sur les en-têtes aux 3 sites d'erreur non-200 (Gemini non-flux, Gemini flux, transport OpenAI) puis en tête de `delaiIndique` ; (2) `nbEchanges()` dans `lib/ia/gemini.js` qui consulte `tension.enTension()` — injecté au transport OpenAI (paramètre `nbEchanges`, fallback `HISTO_API_MAX` pour la compatibilité des tests existants).

**Tech stack :** Node 22 (`node:text`), ESLint flat config, Prettier appliqué, pas de dépendance nouvelle.

**Ce qui est HORS périmètre (décidé) :** P3 (état partagé Redis) — documenté seulement, pas de code (YAGNI : une instance Render free) ; ajout de vraies clés API — action utilisateur, documenté dans `.env.example` ; pas de commit par tâche : le dépôt contient des modifications de l'utilisateur non committées (`server.js` entre autres), les miennes ne doivent pas les mélanger — vérification finale à la main à la fin.

---

### Task 1: Tests d'abord — Retry-After + historique éco dans `tests/gardiens.test.js`

**Files:**

- Modify: `tests/gardiens.test.js` (nouveaux blocs en bas, style identique : entêtes sections avec `====`)

- [ ] **Step 1: Ajouter les tests qui échouent**

Insérer avant le test `cache recherche : même sujet...` :

```js
// ====================== RETRY-AFTER + HISTORIQUE ECO ======================

const { creerGemini } = require('../lib/ia/gemini');
const gemini = creerGemini({ getConfig: () => ({}), providerOpenAI: () => false });

test('retryApresDepuisEnTete : secondes -> ms, absent/invalide -> 0, date -> temps restant', () => {
  assert.strictEqual(gemini.retryApresDepuisEnTete('45.4'), 45400, 'second flottant');
  assert.strictEqual(gemini.retryApresDepuisEnTete('60'), 60000, 'second entier');
  assert.strictEqual(gemini.retryApresDepuisEnTete(''), 0, 'chaine vide : 0');
  assert.strictEqual(gemini.retryApresDepuisEnTete(undefined), 0, 'absent : 0');
  assert.strictEqual(gemini.retryApresDepuisEnTete(' pas-un-nombre '), 0, 'invalide : 0');
  const ms = gemini.retryApresDepuisEnTete(new Date(Date.now() + 5000).toUTCString());
  assert.ok(ms > 2500 && ms <= 5000, 'date HTTP ms restants (recu ' + ms + 'ms)');
});

test('delaiIndique : e.retryAfterMs prioritaire, texte du message en base de secours', () => {
  assert.strictEqual(gemini.delaiIndique({ retryAfterMs: 9000 }), 9000, 'champ en-tete gagne');
  assert.strictEqual(
    gemini.delaiIndique({ message: 'Please retry in 45.411629042s' }),
    45412,
    'parsing texte conserve'
  );
  assert.strictEqual(
    gemini.delaiIndique({ retryAfterMs: 9000, message: 'Please retry in 45.4s' }),
    9000,
    'en-tete prioritaire sur texte'
  );
  assert.strictEqual(gemini.delaiIndique(null), 0, 'pas de crash sans erreur');
});

test('historique eco : nbEchanges=16 hors tension, 6 sous tension, systeme conserve', () => {
  const histo = [{ role: 'system', content: 'sys' }];
  for (let i = 0; i < 20; i++)
    histo.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'm' + i });
  tension.reinitialiser();
  const hors = gemini.limiterHisto(histo, gemini.nbEchanges());
  assert.strictEqual(hors.filter((h) => h.role !== 'system').length, 16, 'hors tension : 16');
  // Arme l'eco (seuil 3 x 429 dans la fenetre de 5 min, horloge reelle).
  tension.noter();
  tension.noter();
  tension.noter();
  const eco = gemini.limiterHisto(histo, gemini.nbEchanges());
  assert.strictEqual(eco.filter((h) => h.role !== 'system').length, 6, 'en eco : 6');
  assert.strictEqual(eco[0].role, 'system', 'le message systeme reste en tete');
  assert.strictEqual(eco[1].role, 'user', 'reprise sur un echange utilisateur');
  tension.reinitialiser();
});
```

- [ ] **Step 2: Vérifier l'échec**

`node --test tests/gardiens.test.js`
Attendu : FAIL — `gemini.retryApresDepuisEnTete is not a function` à la première partie.

### Task 2: `retryApresDepuisEnTete` + `delaiIndique` dans `lib/ia/gemini.js`

**Files:**

- Modify: `lib/ia/gemini.js` (1) fonction pure niveau module, sous `estQuota` ; (2) `delaiIndique` ; (3) exports module + creerGemini)

- [ ] **Step 1: Fonction pure niveau module**

Après `estQuota` (ligne ~56) :

```js
// En-tete standard Retry-After (RFC 7231) pose sur les 429 par la plupart
// des fournisseurs, en secondes ou en date HTTP. Rendu en ms restants ;
// 0 si absent, vide ou illisible. Fonction pure : partagee avec le
// transport OpenAI (comme estQuota) et rattachee aux erreurs au moment
// de la reponse non-200 (server.js, lib/ia/openai.js).
function retryApresDepuisEnTete(valeur) {
  if (!valeur) return 0;
  const s = String(valeur).trim();
  if (!s) return 0;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Math.max(0, Math.round(parseFloat(s) * 1000));
  const date = Date.parse(s);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return 0;
}
```

- [ ] **Step 2: exports module (openai.js en a besoin)**

```js
module.exports = { creerGemini, estQuota, retryApresDepuisEnTete };
```

- [ ] **Step 3: `delaiIndique` (dans creerGemini) lit le champ d'abord**

Remplacer :

```js
function delaiIndique(e) {
  const m = e && e.message && e.message.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.round(parseFloat(m[1]) * 1000) : 0;
}
```

par :

```js
// Priorite a e.retryAfterMs (valeur reelle en-tete attachee par
// modeleClassiqueBrut / modeleEnFluxBrut / openAIRequete) : la base
// "retry in 45.4s" du message reste de secours pour les rares 429 sans
// en-tete, et pour que les vieux tests factices continuent de passer.
function delaiIndique(e) {
  if (e && e.retryAfterMs > 0) return e.retryAfterMs;
  const m = e && e.message && e.message.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.round(parseFloat(m[1]) * 1000) : 0;
}
```

- [ ] **Step 4: retour de creerGemini — exposer les deux pour server.js**

Dans le return final, ajouter aux côtés de `delaiIndique` :

```js
    retryApresDepuisEnTete,
```

- [ ] **Step 5: PASS**

`node --test tests/gardiens.test.js` → les 3 tests Task 1 passent.

### Task 3: Dégradé d'historique en éco dans `lib/ia/gemini.js` + `lib/ia/openai.js` + `server.js`

**Files:**

- Modify: `lib/ia/gemini.js` (HISTO_ECO_MAX, nbEchanges, export creerGemini)
- Modify: `lib/ia/openai.js` (paramètre nbEchanges, fallback HISTO_API_MAX)
- Modify: `server.js` (désé围绕 3 symboles, appel ligne 1091, câblage openai)

- [ ] **Step 1: gemini.js — constante et fonction**

Sous `const HISTO_AFFICHAGE_MAX` (ligne ~47) :

```js
const HISTO_ECO_MAX = 6; // echanges envoyes sous tension/eco : economie d'entree
```

Dans creerGemini, avant `limiterHisto` (qui doit rester pure — le branche avec l'état de tension est fait par ce acces) :

```js
// Nombre d'echanges a envoyer a LA PROCHAINE requete : 16 ordinairement,
// 6 sous tension (mode eco) : il n'y a pas de quota d'entree vs sortie
// distingue chez tous les fournisseurs, le prompt IS le quota depense.
function nbEchanges() {
  return tension.enTension() ? HISTO_ECO_MAX : HISTO_API_MAX;
}
```

Export dans le return de creerGemini : `HISTO_ECO_MAX,` et `nbEchanges,`.

- [ ] **Step 2: openai.js — paramètre avec fallback**

Signature `creerOpenai({...})` : ajouter après `HISTO_API_MAX,` :

```js
  nbEchanges, // () => 16 OU 6 selon tension (defaut : HISTO_API_MAX)
```

Ligne 216 (appelerOpenAI) :

```js
const nb = typeof nbEchanges === 'function' ? nbEchanges() : HISTO_API_MAX;
const messages = construireMessages(limiterHisto(histo, nb), imageParts);
```

Commit-compat : tests/lib.test.js (creerOpenai sans nbEchanges) continue son chemin via fallback.

- [ ] **Step 3: server.js — câbler**

Déséctruente creerGemini (~line 702) : ajouter `HISTO_ECO_MAX, nbEchanges, retryApresDepuisEnTete,`.
Ligne 1091 : `construireContenus(limiterHisto(histo, nbEchanges()), imageParts)`.
Câblage creerOpenai (~line 738) : ajouter `nbEchanges,` à côté de `HISTO_API_MAX,`.

- [ ] **Step 4: PASS + suite régression**

`npm run test:unit` → tout vert (incl. tests/lib.test.js openai intact).

### Task 4: Attacher `e.retryAfterMs` aux 3 sites non-200

**Files:**

- Modify: `server.js` (2 sites), `lib/ia/openai.js` (1 site)

- [ ] **Step 1: server.js modeleClassiqueBrut (~line 871)**

```js
if (res.statusCode !== 200) e.statusCode = res.statusCode;
e.retryAfterMs = retryApresDepuisEnTete(res.headers && res.headers['retry-after']);
```

- [ ] **Step 2: server.js modeleEnFluxBrut (~line 951)**

```js
if (!refuse) err.statusCode = res.statusCode;
err.retryAfterMs = retryApresDepuisEnTete(res.headers && res.headers['retry-after']);
```

(`refuse` : 400 sur champ refusé, pas un 429 — n'a pas d'en-tête Retry-After utile, mais l'attache est sans effet.)

- [ ] **Step 3: lib/ia/openai.js openAIRequete (~line 119)**

```js
const err = new Error('HTTP ' + res.statusCode + ' ' + data.substring(0, 200));
err.statusCode = res.statusCode;
err.retryAfterMs = retryApresDepuisEnTete(res.headers && res.headers['retry-after']);
```

En-tête du fichier : `const { estQuota, retryApresDepuisEnTete } = require('./gemini');`

- [ ] **Step 4: PASS + lint**

`npm run test:unit` && `npx eslint lib/ia/gemini.js lib/ia/openai.js server.js tests/gardiens.test.js` → 0 erreur. Prettier sur les fichiers touchés : `npx prettier --write lib/ia/gemini.js lib/ia/openai.js server.js tests/gardiens.test.js`.

### Task 5: Docs — `.env.example`, `README.md`, `CHANGELOG.md`

**Files:**

- Modify: `.env.example` (commentaire MAX_CONC : calibrage selon la largeur du pool)
- Modify: `README.md` (bloc Gardiens : éco tronque l'historique ; Retry-After lu ; MAX_CONC calibré sur le pool)
- Modify: `CHANGELOG.md` (une entrée, en tête, style vérifié au moment de l'édition)

- [ ] **Step 1: .env.example** — après `MAX_CONC=3` insérer :

```
# Calibrage : 3 suffit pour 1-2 cles Gemini. Un pool large (4+ membres
# API_POOL, chacun SON quota) supporte 5-6 sans 429 en rafale : la
# capacite reelle de la boite = la largeur du pool + les cles Gemini.
```

- [ ] **Step 2: README.md** — dans la bulle Gardiens (§ Fonctionnalites, ligne ~43) remplacer la phrase sur le mode éco par :

```
mode eco automatique (recherche coupee, taches de fond suspendues,
historique envoye au modele tronque a 6 echanges (HISTO_ECO_MAX),
retour au calme avec anti-clignotement), en-tete standard Retry-After
lu sur les 429 (attente exacte demandee par le fournisseur), cache des
sujets deja cherches (CACHE_RECHERCHE_MS).
```

- [ ] **Step 3: CHANGELOG.md** — entrée la plus haute, style découvert à l'ouverture :

```
## Gardiens anti-saturation encore plus frugaux
- Mode eco : l'historique envoye aux modeles est tronque a 6 echanges
  (HISTO_ECO_MAX) contre 16 hors tension — economie d'entree quand le
  quota sature.
- En-tete Retry-After lu sur les 429 des 3 transports (Gemini non-flux,
  Gemini flux, pool OpenAI) : attente exacte, plus de dependance a la
  formulation "retry in 45.4s" du message.
- .env.example : calibrage MAX_CONC documenté selon la largeur d'API_POOL.
```

- [ ] **Step 4: Vérification finale**

`npm run test:unit && npm run lint` ; `git diff --stat` pour lister ce qui a changé (pas de commit : modifications utilisateur en cours).
