# Journal des modifications

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Ce journal démarre avec la mise à niveau « hygiène du dépôt » ci-dessous ; les
versions antérieures sont visibles dans `git log`.

## [Non publié] - 2026-10-04

### Ajouté
- `README.md` : point d'entrée du projet (installation, variables, tests, déploiement).
- `build_bot.ps1` / `build_bot.bat` : scripts reproductibles pour recompiler `bot.exe`.
- `requirements.txt` : dépendances Python des scripts locaux.
- Scripts Python d’enrichissement du vocabulaire documentés et suivis par Git.
- `LICENSE` (MIT) et champs `license` / `author` / `repository` / `keywords` dans `package.json`.
- `.env.example` : documentation de **toutes** les variables d'environnement.
- Prise en charge des fournisseurs **compatibles OpenAI** (Groq, OpenRouter,
  Ollama, LM Studio, vLLM, Mistral, DeepSeek) en plus de Gemini.
- Variables `ADMIN_PSEUDO` / `ADMIN_UID` pour ne plus coder en dur le pseudo admin.
- `.editorconfig`, `.nvmrc`, `.prettierrc.json`, `eslint.config.mjs`.
- Intégration continue : `.github/workflows/ci.yml`, avec ESLint inclus.
- Conteneurisation : `Dockerfile`, `.dockerignore`.
- Tests unitaires `tests/unit.test.js` (runner natif `node:test`) et script `npm run test:unit`.
- Icônes PWA complètes : `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon.ico`.
- ESLint maintenant installé en dépendance de développement et exécuté par `npm run lint`.
- `Dockerfile.bot` : image Linux du bot C++ (compilation multi-étape + service).
- `bot_service.py` : service HTTP (stdlib) autour du bot interactif —
  `GET /health`, `POST /respond`, avec lecture non bloquante des invites.
- `docker-compose.yml` : stack unifiée Ollama (modèle 3b, GPU) + bot + serveur,
  modèle pré-téléchargé et préchauffé, Ollama non exposé publiquement.
- `CLOUD.md` : guide de déploiement cloud unifié et optimisations de latence.
- `server.js` : bascule automatique sur le bot C++ local via `BOT_SERVICE_URL`
  quand l'IA échoue, avec cache LRU de 5 min sur les messages récurrents.
- Rotation automatique entre plusieurs clés Gemini (`API_KEYS`).
- `.env.example` : documentation de `API_KEYS`, `BOT_SERVICE_URL`,
  `BOT_SERVICE_TIMEOUT_MS`.

### Modifié
- `config.json.example` : modèle aligné sur le défaut du serveur (`gemini-3.5-flash`).
- `render.yaml` : variables optionnelles documentées (limites, quota, admin).
- `site/manifest.json` : ajout de `id`, `scope`, `lang`, `categories` et de l'icône 192.
- `site/index.html` : liens d'icônes (favicon + apple-touch-icon) et apple-mobile-web-app.

### Corrigé
- **Portage Linux de `bot.cpp`** : les helpers de session (`.blamune_session`)
  étaient Defined dans un bloc `#ifdef _WIN32` alors que
  `cheminFichierUtilisateur()` les utilise — la compilation Linux échouait.
  Le binaire compile et repond desormais sous Linux.
- `themes.txt` / `themes_manquants.txt` (sorties générées, ~7 Mo) désormais ignorés par git.
- Suppression des fichiers parasites : `config.json.placeholder`, `curl_out.txt`, `curl_output.txt`, `serveur_errors.log`.
- **Apprentissage du bot C++ non validé** : une phrase banale comme
  « je m'appelle Thomas » suffisait à promouvoir « appelle » en mot-clé et
  à écrire la fausse connaissance `appelle|Je ne sais pas encore...` dans
  `savoir.txt`. Ajout de `motApprenable()` (bloque les fragments de
  contraction, les verbes d'état, les chiffres et la ponctuation) ; la
  promotion n'écrit plus qu'une entrée `mot||categorie` sans réponse, que le
  serveur ignore et que le bot ne prononce pas. Les 3 entrées polluées
  héritées (`salut`, `connais`, `suite`) ont été supprimées de `savoir.txt`.
- **Pertes de données silencieuses sur `savoir.txt`** : le bot et le serveur
  écrivaient le même fichier sans coordination. Le bot réécrivait le fichier
  depuis son instantané de démarrage et effaçait tout ce que le serveur avait
  ajouté entre-temps ; les deux écrivaient par troncature directe, donc un
  arrêt de processus laissait un fichier corrompu.
  - `bot.cpp` recharge désormais `savoir.txt` s'il a changé sur disque
    (`stat()`) avant de réécrire, et écrit via un fichier temporaire +
    `rename` (écriture atomique).
  - `server.js` ajoute une nouvelle entrée par `appendFileSync` (au lieu de
    réécrire 1 200 lignes) et utilise temporaire + `rename` pour un
    remplacement.
  - `chargerSavoirFichier()` déduplique les clés (le fichier peut contenir la
    même clé deux fois après une fusion serveur + locale).
- **Migration du savoir vers SQLite** (`savoir.db`). `savoir.txt` n'est plus la
  source de vérité : c'est un **export** (git, bot Windows local, JSONBin),
  régénéré depuis la base. Ce que cela corrige :
  - **écritures concurrentes** : plusieurs visiteurs apprenaient en même temps
    et s'écrasaient mutuellement sur le fichier plat ;
  - **corruption** : la sauvegarde lisait le binaire SQLite en `utf8` et le
    réécrivait en `utf8` (« database disk image is malformed »). La source de
    vérité est donc sauvegardée sous forme de **dump SQL** (texte) ;
  - **doublons** : la clé normalisée est une `PRIMARY KEY`, donc l'unicité est
    garantie par la base et non par une comparaison de lignes ;
  - **ordre** : la colonne `rang` préserve l'ordre du fichier, donc chaque
    export est stable et le diff git ne montre que de vraies modifications ;
  - transactions atomiques en mode `WAL` (lecteurs et écrivain coexistent).
  `migrer_savoir_sqlite.js` migre les 1 266 entrées existantes (`--rapport`
  pour un diagnostic sans écriture). `server.js` migre automatiquement au
  premier démarrage si la base est vide.
- **Banque de repli hors ligne** (`replis.txt` + `replis.js`). Quand l'IA est
  injoignable (quota, coupure, clé absente), le serveur ne renvoie plus
  « Désolé, j'ai eu un problème technique » mais une réponse de BLAMUNE tirée
  dans un fichier de données français. Zéro latence, zéro quota, aucune panne
  possible (le fichier est versionné et déployé avec le reste, donc disponible
  24 h/24 même si le PC du créateur est éteint). 20 situations, détection par
  motifs, tirage aléatoire avec mémorisation des 3 dernières réponses pour éviter
  les répétitions, variantes selon le moment de la journée.
  Principe : sur une question factuelle, BLAMUNE **avoue son ignorance** plutôt
  que d'inventer une réponse.
  Chaîne de repli : bot C++ local → savoir connu → banque → message d'erreur.
- **Build cassé sur une installation propre** : `better-sqlite3` était sans
  binaire précompilé et lançait une compilation `node-gyp` exigeant Visual
  Studio — `npm ci` échouait, donc **le build Render aurait échoué aussi**.
  Remplacé par **`node:sqlite`**, le module natif de Node : zéro dépendance
  à installer. `better-sqlite3` reste accepté comme repli si installé
  volontairement (Node 18/20). Node minimum porté à **22.5**, CI alignée
  sur Node 22.
- **Savoir obsolète jamais corrigé en production** : la base SQLite n'importait
  `savoir.txt` que si elle était **vide**. Une base déjà créée gardait donc
  indéfiniment le contenu d'un `savoir.txt` ancien — les entrées polluées
  (`salut`, `connais`, `suite`) retirées du dépôt continuaient de répondre
  « Je ne sais pas encore... » en ligne. Vérifié sur le déploiement réel.
  `savoirDb.synchroniserFichier()` rejoue le dépôt à **chaque démarrage** :
  le fichier fait autorité sur les connaissances *éditées* (une ligne retirée
  disparaît), tandis que les connaissances *apprises* en cours d'usage
  (`source` ≠ `migration`) sont conservées.
- **Fournisseur `edenai` ajouté** : Eden AI est une passerelle
  OpenAI-compatible (`https://api.edenai.run/v3`) donnant accès à 1 100+
  modèles avec une seule clé. C'est un service **payant** : sans crédit sur
  le compte, les appels renvoient `HTTP 402 insufficient_quota`.
  La rotation `API_KEYS` est désormais restreinte au fournisseur Gemini :
  la clé principale d'un fournisseur compatible OpenAI ne peut plus être
  envoyée en `x-goog-api-key` à l'API Google.
- **Banque de repli vide avec `BLAMUNE_DATA_DIR`** : `replis.txt` était
  cherché uniquement dans le dossier de données. Un dossier vide (tests,
  cloud) démarrait donc sans banque et retombait sur le message technique.
  Repli sur le fichier du dépôt, comme pour `savoir.txt`.
- Contrôle admin factorisé (`isAdminUid`) et paramétrable par l'environnement.
