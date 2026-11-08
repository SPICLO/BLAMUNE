# Audit approfondi — Phase 3 : usage réel et robustesse

> Continuation de l'analyse en profondeur de BLAMUNE (projet `PROJET/`).
> Phase 1 : l'état des lieux (fonctionnalités, architecture, documentation).
> Phase 2 : la sécurité (audit des trois points : secrets locaux, CORS,
> `/health` à deux niveaux — corrigés, cf. `SECURITY.md`).
> **Phase 3 (ce document)** : ce que devient le produit quand des gens
> l'utilisent vraiment — batteries, rétention, coûts, pannes partielles,
> et la dette documentaire que personne ne voit.

Tous les constats ci-dessous ont été vérifiés dans le code à cette date
(fichier + ligne) ou par exécution locale. Aucune modification n'est faite
par ce document : chaque chantier est chiffré, priorisé, et laisse le
propriétaire décider.

Batterie de contrôle au moment de l'analyse : `npm run test:unit` (151 tests),
`npm test` (intégration), `npm run lint`, `node tests/routes_smoke.test.js`
(67/67) — tout au vert.

---

## 1. Ce qu'on a trouvé (classé par gravité)

### 🔴 P3-1 — `/send` peut écrire le disque du serveur à chaque message

**Faits.**
`lib/routes/send.js` appelle `sauvegarderEtat(auth.uid, etatBL)` **à chaque
message en mode BLAMUNE** (lignes ~502 et ~555), et plus précisément une fois
par changement de session et une fois au premier contact. Or
`sauvegarderEtat` (`server.js:1834`) fait un `fs.writeFileSync` complet de
`users/<uid>/etat_blamune.json` — **pas de debounce, pas de comparaison**.

Conséquence : sur un fil actif (10 messages/min, un visiteur), c'est
100 écritures/minute sur disque. Ajouté aux historiques (`lib/historique.js`),
aux résumés et à l'extraction, le serveur écrit **des dizaines de fichiers
par minute et par utilisateur**. Sur Render (disque réseau, plan gratuit),
c'est le type d'I/O qui fait exploser le temps de réponse **sans qu'aucun
garde-fou ne le voie** : `lib/sortie.js` compte la bande passante sortante,
rien ne compte l'I/O écriture. Sur `docker-compose.yml`, c'est directement
la durée de vie de la carte du serveur.

**Pourquoi c'est important ici et pas ailleurs.** Le produit est conçu pour
un cercle privé ; mais un invité actif suffit. Le pattern « write-on-change »
existe partout dans `server.js` (`sauvegarderComptes`, `ecrireMemoire`, etc.),
et il n'y a **aucune coordination**.

**Proposition.**

1. `sauvegarderEtat` devient `marquerEtatSale(uid)` : marque un uid dans une
   `Map` et programme un flush groupé toutes les 5 s (ou au `SIGTERM`).
2. Même traitement pour `ecrireMemoire` (déjà debounced côté `storage.js` pour
   le cloud, mais pas côté disque).
3. Ajouter un compteur `io` dans `/health` : `{ecritures, octets, flushEnAttente}`
   sur le modèle de `lib/sortie.js`. Un chiffre honnête, pas un dashboard.

Coût : ~1 journée. Risque : faible, le schéma de fichier ne change pas.

---

### 🔴 P3-2 — Le cache de réponses n'est **pas** un cache inter-visiteurs digne de ce nom

**Faits.** `lib/cache_reponses.js` documente « le small talk ne reçoit plus
d'appel IA », et le test d'intégration vérifie qu'un « bonjour » déjà servi
ne repart pas. Mais :

- le cache est **en mémoire du processus** (`Map`), donc perdu à chaque
  redémarrage. Or l'instance Render **redémarre à chaque déploiement** et
  parfois seule (suspension, OOM). Après un redémarrage, chaque question
  simple repart au pool ;
- `MAX_ENTREES = 200` (`CACHE_REPONSES_MAX`). Un pool de small talk réaliste
  dépasse 200 questions : le cache se vide en permanence par LRU ;
- et surtout **la clé dépend du dernier message de l'assistant**
  (`opt.avant`, `cle()` ligne 73). Excellent pour la cohérence, mais cela
  signifie que dans une conversation neuve, `avant` est vide, donc la clé
  ne correspond à **aucune** entrée précédente de la même question. Le cache
  ne peut servir qu'à quelqu'un qui a **la même séquence** (question + même
  phrase précédente du bot). En pratique : il rate beaucoup plus qu'il ne
  coûte.

**Ce n'est pas un bug — c'est un design honnête qui ne fait pas la promesse
que le README suppose.** Le gain réel est bien plus faible que « tout le
small talk gratuit ».

**Proposition.** Deux niveaux assumés :

- un cache _stable_ pour les questions **sans contexte** (« bonjour »,
  « présente-toi », « c'est quoi ton nom ? ») — clé sans `avant`, TTL court,
  jamais une réponse qui nomme le visiteur (déjà la règle) ;
- le cache _contextuel_ actuel pour les réponses en milieu de fil.
  Et compter les deux séparément dans `/admin` (`coupsStable` vs `coupsContextuel`)
  pour savoir si ça sert vraiment. Si `coupsStable` reste à zéro après deux
  semaines, on retire le niveau stable plutôt que de le garder par principe.

Coût : ~2 h. Risque : très faible.

---

### 🟠 P3-3 — Le « mode éco » peut rester bloqué `on` sans que personne ne le voie

**Faits.** `lib/tension.js` arme l'éco quand :

- `SEUIL` 429 sont notés dans `FENETRE_MS` (5 min), OU
- `pressionLocale()` est vrai : `e.file >= PREEMPT_FILE` (30) **ou**
  `e.debordementsFenetre >= PREEMPT_DEB` (3).

`PREEMPT_DEB = 3` signifie : **3 débordements de file en 10 minutes suffisent
à passer en éco preemptif**, avec un séjour anti-clignotement de 90 s. Or un
débordement = une attente > `MAX_ATTENTE_MS` (10 s par défaut). Sur un pic
de 5-10 visiteurs simultanés d'un cercle privé, 3 débordements sont
**normaux**. Résultat probable : le produit passe en éco à chaque pic, coupe
la recherche web auto et suspend les tâches de fond — **et le propriétaire ne
le perçoit que comme « BLAMUNE oublie de chercher sur le web depuis deux
jours »**.

`/health` expose bien `preemptif`, mais **rien ne rend cet état visible dans
l'interface du site** ni dans un résumé quotidien.

**Proposition.**

1. Exposer `tension.etat()` dans `/stats-perso` (déjà lu par la commande
   `/stats` du client) sous une forme minimaliste : `{eco: true, depuis:'14:02'}`.
   Le client peut l'afficher en petit.
2. Noter dans `logs/erreurs.log` une ligne `[tension] eco active: cause=preemptif`
   **une seule fois à l'entrée et à la sortie**. Aujourd'hui rien n'est écrit.
3. Relever le défaut `PREEMPT_DEB` à 6 si le test montre des faux positifs.
   C'est un paramètre, pas une décision structurante — la doc `.env.example`
   doit alors expliquer le tradeoff.

Coût : ~1 h + 1 test. Risque : très faible.

---

### 🟠 P3-4 — Le coût des embeddings au démarrage peut exploser (et n'est pas surveillé)

**Faits.** `lib/savoir.js` charge `cache_embeddings.json` (12 Mo à cette date)
et, si `QDRANT_EMBED=gemini`, appelle `gemini-embedding-001` pour les faits
**manquants**. Le commentaire prévient : « ~13 min de fond pour 1266 faits »
au premier démarrage. Avec 10 000 faits (le savoir grandit via `/savoir` et
`/cherche`), c'est **plus d'une heure et demie d'appels Gemini en tâche de
fond** sur le quota d'une clé gratuite, à chaque fois que `cache_embeddings.json`
n'est pas à la bonne signature (`_signature`).

Or :

- `cache_embeddings.json` n'est **pas** inclus dans la sauvegarde JSONBin
  (vérifié : `creerSauvegarde()` ne le liste pas). Après une perte de
  l'instance Render, **tout est re-calculé** ;
- les embeddings échoués (`loggerErreur('embeddings lot:…')`) ne remontent
  ni dans `/stats` ni dans `/admin` — seulement dans `logs/erreurs.log`.

**Proposition.**

1. Inclure `cache_embeddings.json` (ou un dérivé compressé) dans
   `creerSauvegarde()` **uniquement s'il existe et s'il fait < plafond**
   (par ex. 5 Mo après gzip). Aujourd'hui le payload JSONBin dépasse déjà
   100 Ko : il faut vérifier que ce fichier ne pousse pas au-delà de 10 Mo
   sur Pro.
2. Exposer dans `/health` : `{embeddings: {total, indexes, enAttente, echecs}}`.
3. Si `QDRANT_EMBED` n'est pas défini (hachage local 256 d), documenter
   clairement dans le `/admin` **quel mode est actif** : aujourd'hui il faut
   lire l'env pour le savoir.

Coût : ~3 h. Risque : moyen (touche la sauvegarde).

---

### 🟡 P3-5 — Le bot C++ apprend, mais le savoir qu'il produit n'est jamais vérifié

**Faits.** `bot.cpp` persiste ses « mots-clés de catégorie » sous la forme
`mot||categorie` (réponse vide). `lib/savoir.js` ignore ces entrées à
l'export et ne les prononce jamais. C'est honnête.

Mais `/savoir` (`lib/routes/compte.js:190`) accepte des faits **avec
réponse** depuis n'importe quel client authentifié (invite avec jeton, admin,
bot local). Aucune vérification :

- longueur maximale de `reponse` (seulement bornée par Express `json`/urlencoded
  à ~100 Ko par défaut) ;
- caractères de contrôle ;
- limitation de débit par uid : il y a `checkRateLimit` **par IP**, donc un
  bot sur une seule machine peut pousser des milliers de faits d'un coup ;
- **sur une instance publique, un invité authentifié peut injecter un fait
  « paris — capitale de l'italie » qui sera servi à tout le monde** via
  la cascade de secours (l'extrait devient un fait du savoir partagé).

Le test d'intégration couvre bien l'**authentification**, pas la
**qualité** du contenu.

**Proposition.** (par ordre de coût)

1. **Mutualiser** avec `/avis` : un fait poussé par `/savoir` avec un
   `reponse` non vide passe en `enAttente` si l'uid n'est pas admin, et
   n'est servi qu'après validation `/admin/savoir` (la route existe déjà
   pour modifier/supprimer). Coût : ~1 journée, ajoute un état dans le schéma.
2. Sinon, **au minimum** : borner `reponse` à 1 000 caractères, rejeter les
   caractères de contrôle, et ajouter `checkUserRateLimit(uid, 10/min)` en
   plus de la limite IP.
3. Que le bot local, lui, contourne la validation (il écrit par le même canal
   aujourd'hui — il faut alors un marqueur `source=bot`).

Coût : option 1 ~1 jour, option 2 ~1 h. Décision produit.

---

### 🟡 P3-6 — La page d'administration du savoir et les avis n'ont pas de parcours « boucle fermée »

**Faits.**

- `/admin/avis` liste les votes 👍/👎 (route `avis.js`), mais rien dans
  `admin.html` (vérifié : la page a 7,5 Ko pour tout l'admin) ne permet à
  l'admin de **répondre** à un avis (ex. « ce fait est à corriger dans savoir »).
- `/admin/savoir` permet de supprimer un fait. Pas de **proposition de
  correction** : l'admin voit l'avis 👎, ne sait pas ce qui a raté, et doit
  ouvrir `savoir.db` à la main.
- `lib/auto_apprentissage.js` détecte « non, X c'est Y » pour corriger un
  fait, mais **rien ne remonte à `/admin`** pour vérifier que la correction
  a été appliquée.

**Proposition.** Une page `/admin/avis` avec :

- la liste des 👎 des 7 derniers jours, groupée par réponse ;
- bouton « corriger dans le savoir » qui pré-remplit le formulaire
  `/admin/savoir/mettre` avec la clé et le texte de l'avis ;
- bouton « ignorer » qui marque l'avis comme traité (nouveau champ).

Coût : ~2 jours (routes existent, c'est essentiellement de l'UI + un champ).

---

### 🟢 P3-7 — Aucune métrique d'usage réelle consolidée

**Faits.** `/stats` expose des compteurs (`messagesTotal`, `tempsMoyen`,
`avisHaute`, …), mais :

- pas de **fréquentation unique** (combien d'uid distincts ont parlé
  aujourd'hui / cette semaine) ;
- pas de **rétention** (un invité revient-il après J+1, J+7 ?) ;
- pas de **taux de réussite** par fournisseur (le pool, `pool.sante()`
  expose l'état instantané, pas l'historique).

C'est pourtant ce qui décide les prochains chantiers (cf. PRODUCT.md,
« le succès = les invités reviennent »).

**Proposition.** Un compteur quotidien persisté dans `stats_daily.json` :
`{jour, uidUniques, messages, reponsesCachees, reponsesSecours, erreursParFournisseur}`.
Écrit une fois par jour à minuit UTC (comme `lib/tension.js` le fait déjà
pour `nb429Jour`). Exposé par `/stats`.

Coût : ~half-day. Risque : nul.

---

### 🟢 P3-8 — Dette documentaire : `qdrant` non lié, mais présenté comme actif

**Faits.** `PRODUCT.md` (lignes 84-85) dit : « Qdrant **non lié** à ce
jour (`QDRANT_URL`/`QDRANT_API_KEY` absents du dashboard) ». Or
`lib/savoir.js:298` synchronise **au démarrage** dès que `QDRANT_URL` existe,
et `scripts/resync_qdrant.js` est un outil manuel documenté nulle part
sauf dans son propre fichier.

Les docs se contredisent : `.env.example` (77-94) décrit Qdrant comme actif
si configuré, `PRODUCT.md` dit qu'il ne l'est pas. Ce n'est pas grave, mais
c'est exactement le type de contradiction que l'analyse suivante paiera.

**Proposition.** Une section « Mémoire sémantique » unique dans `CLOUD.md` :
quand c'est activé, ce que ça coûte, comment resynchroniser. Supprimer le
« non lié » de `PRODUCT.md` et le remplacer par « activable, voir CLOUD.md ».

Coût : 30 min. Risque : nul.

---

## 2. Ce qui est déjà solide (ne pas toucher)

- **La cascade de secours** (`lib/savoir.js`, `reponseSecours`) :
  `demandeInfo(msg)` avant le savoir, `chercherSemantique` sous la même règle.
  L'analyse en profondeur n'a **rien trouvé** qui justifie un changement.
- **Les gardiens anti-saturation** : file bornée, refus à l'admission,
  plafond global, cache de recherche. Les tests `gardiens.test.js` sont
  complets et le code est linéaire.
- **La recherche web** (`lib/recherche_web.js`) : SSRF revalidé à chaque
  saut depuis la correction (commit `12f5b7d`), `redirect: 'manual'` avec
  `REDIRECTIONS_MAX = 5`. Testé (e2e dans `recherche_web.test.js`).
- **La purge des invités** : couverte par `e2e_purge.test.js` (temps
  compressé, cycle complet, pierre tombale). Un vrai modèle de test.
- **Le CORS et `/health`** : la phase 2 est bien appliquée (allowlist exacte,
  `/health` résumé public + détail admin). Vérifié dans `verifier_deploiement.py`.

---

## 3. Le plan d'attaque proposé

### Semaine 1 — les deux fuites qui coûtent de l'argent

| #   | Chantier                                                                        | Effort | Gain                                                 |
| --- | ------------------------------------------------------------------------------- | ------ | ---------------------------------------------------- |
| 1   | P3-1 : flush groupé de l'état/mémoire + compteur `io` dans `/health`            | 1 j    | I/O divisée par ~50 sur un fil actif                 |
| 2   | P3-4 : inclure `cache_embeddings.json` dans la sauvegarde + état dans `/health` | 3 h    | un redéploiement ne repaie plus les embeddings       |
| 3   | P3-3 : rendre l'état éco visible (`/stats-perso` + log d'entrée/sortie)         | 1 h    | panne silencieuse de la recherche web rendue visible |

### Semaine 2 — la qualité du savoir

| #   | Chantier                                                            | Effort | Gain                                          |
| --- | ------------------------------------------------------------------- | ------ | --------------------------------------------- |
| 4   | P3-5 (option 2) : bornes `/savoir` (longueur, contrôle, limite uid) | 1 h    | ferme le vecteur d'injection le moins coûteux |
| 5   | P3-5 (option 1) : validation des faits poussés par les invités      | 1 j    | décision produit, à trancher                  |
| 6   | P3-6 : page `/admin/avis` en boucle fermée                          | 2 j    | les 👎 deviennent des corrections             |

### Semaine 3 — ce qui se mesure

| #   | Chantier                                                                     | Effort | Gain                              |
| --- | ---------------------------------------------------------------------------- | ------ | --------------------------------- |
| 7   | P3-7 : `stats_daily.json` (uid uniques, cache, secours, erreurs/fournisseur) | 0,5 j  | on saura quoi faire ensuite       |
| 8   | P3-2 : cache de réponse « stable » + compteur séparé                         | 2 h    | promesse du README tenue, mesurée |
| 9   | P3-8 : doc Qdrant consolidée                                                 | 0,5 h  | fin des contradictions            |

---

## 4. Décisions à trancher (pas à deviner) — **tranchées le 2026-11-08**

### Décision 1 — P3-5 : **option 1**. Un invité _peut_ apprendre, mais par

proposition.

Le propriétaire a retenu l'option 1, avec la réponse la plus permissive côté
usage et la plus prudente côté diffusion : un invité peut faire apprendre un
fait à BLAMUNE ; le fait est **accepté (201) mais mis en attente** et ne
répond à personne tant qu'un admin ne le valide pas dans `/admin/savoir`.

Appliqué ainsi :

- colonne `valide` dans `savoir` (défaut 1 : les 1 266 faits existants restent
  servis, migration sans réimport) ;
- `POST /savoir` d'un `inv_…` → 201 `{ok, enAttente:true}` ; d'un compte
  (`u…`) ou de l'admin → 200, écriture directe (c'est le propriétaire et ses
  proches, pas un inconnu) ;
- un fait proposé n'entre **ni** dans la Map de secours, **ni** dans
  `savoir.txt`, **ni** dans Qdrant avant validation (l'export est filtré sur
  `valide = 1`) ;
- `POST /admin/savoir/valider` refait les trois reflets par le choke point
  `savoirEnregistrer` ; `/admin/savoir` expose `enAttente` (liste, pas
  compteur) ; le panneau admin a un bloc « Fait proposé à valider » avec
  deux seules issues : Valider ou Supprimer ;
- une correction proposée sur un fait déjà validé le repasse en attente :
  elle n'est pas servie (et l'inventer à la place d'un fait validé serait
  un mensonge — l'ancienne réponse cesse de répondre jusqu'à l'accord).

Tests : `tests/savoir_validation.test.js` (5 cas, dont la migration d'une
base sans colonne) et le bloc 23 de `tests/run.js` (compte = direct,
invité = en attente, validation, correction non servie).

### Décision 2 — P3-2 : **supprimer** le niveau stable s'il ne sert pas.

Le propriétaire a tranché : « si après 2 semaines la personne n'est pas
revenue, on supprime ». Appliqué ainsi :

- niveau **stable** pour les questions sans contexte (liste `STABLE_QUESTIONS`
  dans `lib/cache_reponses.js`), TTL court (`CACHE_STABLE_MS`, 15 min) ;
- coups comptés séparément : `coupsStable` / `coupsContextuel` ;
- `etat().observation` donne le verdict tout seul : `indetermine` (fenêtre de
  14 jours en cours, jours restants), `utile` (un coup), `aSupprimer`
  (14 jours, zéro coup). `/admin` l'affiche en clair.

Le retrait lui-même n'est pas automatique : c'est une suppression de code
(le bloc stable et son test), à faire à l'échéance **si** `/admin` affiche
`A SUPPRIMER`.

### Décision 3 — P3-3 : **oui**, on rend l'éco visible et on observe.

- `/stats-perso` expose déjà `service` ; `tension.etat()` publie désormais
  `eco: true` aussi pour l'éco **préemptif** (avant : `entrees` montait sans
  que `eco` passe à vrai), avec `cause` et l'heure d'entrée ;
- compteurs `entrees` par cause incrémentés **même sans logger** (ils
  restaient à zéro en dehors du serveur) ;
- `/admin` affiche `Entrees eco depuis le demarrage : 429= / debordements= / file=` ;
- `PREEMPT_DEB` reste à **3** : la lecture des logs d'une semaine décide du
  passage à 6. Le tradeoff est écrit dans `.env.example`.

---

## 5. Méthode de vérification (à refaire après chaque chantier)

```powershell
npm run test:unit                      # 151 tests, ~12 s
npm test                               # intégration (serveur réel, faux Gemini)
node tests/routes_smoke.test.js        # 67 contrôles, routes non ombragées
node tests/e2e_purge.test.js           # cycle invite complet
npm run lint                           # 0 erreur / 0 avertissement attendu
python verifier_deploiement.py         # garde-fous de dépôt et de déploiement
```

Ces commandes ont été passées **au vert** le 2026-11-08, avant l'écriture
de ce document. Chaque chantier du plan doit les repasser avant commit.
