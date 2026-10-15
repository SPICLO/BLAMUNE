# BLAMUNE

> Ton ami IA. Discute, apprends-lui des choses, garde ton historique.

BLAMUNE est un **serveur de chat** Node.js/Express accompagne d'un **bot local**
en C++ (moteur de regles, 100 % hors ligne), d'un **site web (PWA)** et d'un
**panneau d'administration**. Le serveur sert l'interface, gere les comptes,
l'historique et la memoire, et peut interroger une IA (Gemini ou tout
fournisseur compatible OpenAI) pour la conversation intelligente.

## Sommaire

- [Fonctionnalites](#fonctionnalites)
- [Architecture](#architecture)
- [Prerequis](#prerequis)
- [Installation](#installation)
- [Configuration de l'IA](#configuration-de-lia)
- [Variables d'environnement](#variables-denvironnement)
- [Utilisation](#utilisation)
- [Tests](#tests)
- [Deploiement](#deploiement)
- [Persistance](#persistance)
- [Securite](#securite)
- [Licence](#licence)

## Fonctionnalites

- Chat a deux modes : **BLAMUNE** (personnalite, etat interne, humeur) et
  **EGO** (conversation directe).
- **Memoire** par utilisateur (nom, age, ville, gouts...) extraite par regex
  puis par le modele.
- **Historique** persistant et **resume** automatique des longues conversations.
- **Recherche web** (grounding) declenchee uniquement sur les questions d'actualite.
- **PWA** installable (service worker, mode hors ligne) et **admin** (stats,
  utilisateurs, logs, sauvegarde/restauration).
- **Multi-fournisseur IA** : Gemini par defaut, ou tout endpoint compatible OpenAI.
- Le bot C++ (`bot.exe`) repond **sans aucune cle** : l'IA en ligne est optionnelle.

## Architecture

```
PROJET/
|- server.js          Serveur Express (routes, IA, comptes, admin)
|- storage.js         Persistance cloud JSONBin
|- bot.cpp / bot.exe  Bot local C++ (moteur de regles)
|- bot_service.py     Service HTTP qui enveloppe bot.cpp (cloud)
|- savoir.txt         Connaissances du bot (export lisible ; source : savoir.db)
|- savoir_db.js       Source de verite SQLite des connaissances
|- migrer_savoir_sqlite.js  Migration savoir.txt -> savoir.db
|- replis.txt         Banque de repli francaise quand l'IA est injoignable
|- replis.js          Detection de situation + tirage anti-repetition
|- personnalite.txt   Personnalite du bot
|- vocabulaire.txt    Vocabulaire du composeur de phrases
|- site/              Front PWA (index.html, app.js, style.css, sw.js, manifest.json)
|- admin/             Panneau d'administration
|- tests/             Tests (run.js + unit.test.js + bot_service.test.py)
|- users/             Donnees par utilisateur (ignore par git)
|- logs/ backups/     Journaux et sauvegardes (ignores par git)
```

## Prerequis

- **Node.js >= 22.5** (voir `.nvmrc` : 22). Requis pour le module natif
  `node:sqlite`, qui stocke les connaissances. Aucune dépendance native à
  compiler, donc `npm install` fonctionne partout.
- npm.
- (optionnel) Python 3 et `pip install -r requirements.txt` pour les outils `*.py`.

Pour régénérer le vocabulaire depuis des personas parquet :

```powershell
pip install -r requirements.txt
python extraire_savoir.py --ecrire --dossier "D:\donne pour fair apprendre a un ia"
python fusionner_vocabulaire.py --ecrire
Get-Content vocabulaire_ajouts.txt | Where-Object { $_ -and -not $_.StartsWith('#') } | Add-Content vocabulaire.txt
```

## Installation

```powershell
git clone <ton-depot> blamune
cd blamune
npm install
copy .env.example .env   # puis ajuster si besoin
npm start
```

Le serveur ecoute sur `http://localhost:8080` (ou `PORT`). Au demarrage, il charge automatiquement le fichier `.env` (sauf lorsque `NODE_ENV=test`).

## Construire le bot C++

Le bot local est recompile depuis `bot.cpp` avec :

```powershell
.\build_bot.ps1
```

ou depuis l'invite de commandes :

```cmd
build_bot.bat
```

Cela appelle :

```powershell
g++ -std=c++14 bot.cpp -o bot.exe -lwininet
```

Le projet utilise C++14 car la version MinGW de Dev-C++ ne supporte pas C++17.

`bot.exe` est ignore par git : un clone frais ne contient donc pas le
binaire. `ouvrir_bot.bat` le compile automatiquement au premier lancement
(il appelle `build_bot.ps1` si `bot.exe` est absent) et s'arrete avec un
message clair si la compilation echoue, au lieu de demarrer un serveur
qui ne pourra pas repondre.

`build_bot.ps1` renvoie un code de sortie non nul si la compilation echoue :
un script qui "reussit" en ayant produit aucun binaire ferait echouer la
detection plus tard, au pire moment.

## Configuration de l'IA

Le bot fonctionne **sans cle**. Pour activer la conversation intelligente :

| Fournisseur | `API_PROVIDER` | `API_URL` | `API_MODEL` (exemple) |
|---|---|---|---|
| Google Gemini | `gemini` | `https://generativelanguage.googleapis.com/v1beta` | `gemini-3.5-flash` |
| Groq | `groq` | `https://api.groq.com/openai/v1` | `llama-3.1-8b-instant` |
| OpenRouter | `openrouter` | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.1-8b-instruct:free` |
| Ollama (local, illimite) | `ollama` | `http://127.0.0.1:11434/v1` | `llama3.1` |
| NVIDIA NIM (credits gratuits) | `nvidia` | `https://integrate.api.nvidia.com/v1` | `meta/llama-3.1-8b-instruct` |
| Eden AI (passerelle, ~1 100 modeles) | `edenai` | `https://api.edenai.run/v3` | `openai/gpt-4o-mini` |

Tous les fournisseurs `groq`, `openrouter`, `ollama`, `lmstudio`, `vllm`,
`mistral`, `deepseek`, `openai`, `nvidia`, `edenai` utilisent le format
**OpenAI** (`POST {API_URL}/chat/completions`). Renseigne `API_KEY` (sauf Ollama local).

Pour lister les modeles disponibles d'un fournisseur compatible OpenAI :

```bash
curl -s "{API_URL}/models" -H "Authorization: Bearer {API_KEY}"
```

## Variables d'environnement

Voir `.env.example` (commentaires complets). Principales :

- `API_PROVIDER`, `API_KEY`, `API_MODEL`, `API_MODELS`, `API_URL`, `API_MAX_TOKENS`, `API_TEMPERATURE`
- `MEMOIRE_EXTRACTION`, `RECHERCHE_WEB`, `EXTRACT_PAUSE_MS`
- `RATE_SEND_IP`, `RATE_SEND_UID`, `QUOTA_ATTENTE_MAX_MS`, `QUOTA_ATTENTE_MSG_MS`
- `ADMIN_PSEUDO`, `ADMIN_UID`
- `JSONBIN_API_KEY`, `JSONBIN_BIN_ID`, `JSONBIN_API_URL`, `JSONBIN_SNAP_MIN_MS`
- `PORT`, `BLAMUNE_DATA_DIR`

## Utilisation

Deux entrées existent :

- **Version web IA externe / serveur Node** : `npm start` ; fonctionne sans clé en mode local limité, mais l'IA conversationnelle complète nécessite `API_KEY`.
- **Version locale C++ sans clé** : `ouvrir_bot.bat` ou `.\serveur_bot.ps1` ;
  utilise `bot.exe` et `site/`. Au premier lancement, `ouvrir_bot.bat`
  compile `bot.exe` s'il est absent.

- Site : `http://localhost:8080/`
- Admin : `http://localhost:8080/admin`
- Endpoints : `/ping`, `/health` (health check), `/send`, `/historique`,
  `/register`, `/login`, `/stats`...

## Tests

```powershell
npm test                      # tests d'integration (lance un vrai server.js + faux modele)
npm run test:unit             # tests unitaires (node:test)
python tests\bot_service.test.py  # service HTTP du bot (poignee de main, /health, /respond)
```

Le bot C++ est compile par la CI, pas par les tests ci-dessus. Le job
`bot-cpp` verifie **les deux branches plateforme** de `bot.cpp` :

| Branche | Commande | Ce qu'elle couvre |
|---|---|---|
| `_WIN32` | `x86_64-w64-mingw32-g++-posix -std=c++14 -fsyntax-only bot.cpp` | toute l'implementation reelle : WinINet, appel en ligne, `pousserSavoir` |
| POSIX | `g++ -std=c++14 -fsyntax-only bot.cpp` | ce que compile `Dockerfile.bot` |

La branche POSIX ne contient que des stubs (`pousserSavoir` et
`appelerEnLigne` y sont vides) : verifier uniquement celle-ci laisserait
passer la moitie du fichier.

`tests/bot_service.test.py` reproduit le protocole d'invites de `bot.cpp`
avec un faux processus, sans avoir besoin du binaire. Les 24 tests
s'executent sous Windows et sous Linux : la couche de transport utilise
`socket.socketpair()` là où `select()` n'accepte pas les tubes, et shimme
`os.read()` le temps des tests qui lisent.

Verification du dossier de deploiement :

```powershell
python verifier_deploiement.py
```

## Deploiement

### Stack cloud unifiee (latence minimale)

`docker-compose.yml` fait tourner **server.js + Ollama + bot.cpp sur un seul
serveur**. Les composants se parlent via le reseau Docker interne, donc aucun
aller-retour public n'est ajoute. Modele recommande : `qwen2.5:3b`, garde
chaud via `OLLAMA_KEEP_ALIVE=-1`.

```powershell
docker compose up -d
```

Voir [CLOUD.md](./CLOUD.md) pour le detail (choix du serveur, GPU, latence,
securite, limites).

### Render

`render.yaml` decrit le service (runtime Node, plan free). Renseigne
`JSONBIN_API_KEY` et `JSONBIN_BIN_ID` dans le dashboard (Environment).
Voir `PUBLICATION.md` et `KEEPALIVE.md`.

### Docker

```powershell
docker build -t blamune .
docker run -p 8080:8080 --env-file .env blamune
```

## Persistance

Deux couches indépendantes :

- **SQLite** (`savoir.db`) : source de vérité des connaissances. Clé
  normalisée en `PRIMARY KEY` (unicité garantie), transactions atomiques,
  mode `WAL`. `savoir.txt` n'est plus qu'un export lisible (git, bot local).
  Migration : `node migrer_savoir_sqlite.js` (automatique au 1er démarrage).
- **JSONBin.io** (`storage.js`) : comptes, mémoires, historiques et
  sauvegarde cloud. Sans `JSONBIN_API_KEY`, ces données sont perdues à chaque
  redéploiement.

## Securite

- Mots de passe hashes (scrypt + sel).
- En-tetes de securite (CSP, X-Frame-Options, HSTS...).
- Fichiers sensibles (`comptes.json`, `config.json`...) servis en 404.
- Limitation de debit par IP et par utilisateur.
- Role admin configure via `ADMIN_PSEUDO` / `ADMIN_UID`.

## Licence

MIT - voir [LICENSE](./LICENSE).
