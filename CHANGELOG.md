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
- Contrôle admin factorisé (`isAdminUid`) et paramétrable par l'environnement.
