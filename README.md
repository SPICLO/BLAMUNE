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
|- savoir.txt         Connaissances du bot
|- personnalite.txt   Personnalite du bot
|- vocabulaire.txt    Vocabulaire du composeur de phrases
|- site/              Front PWA (index.html, app.js, style.css, sw.js, manifest.json)
|- admin/             Panneau d'administration
|- tests/             Tests (integration + unitaires)
|- users/             Donnees par utilisateur (ignore par git)
|- logs/ backups/     Journaux et sauvegardes (ignores par git)
```

## Prerequis

- **Node.js >= 18** (voir `.nvmrc` : 20).
- npm.
- (optionnel) Python 3 pour `verifier_deploiement.py` et les outils `*.py`.

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

## Configuration de l'IA

Le bot fonctionne **sans cle**. Pour activer la conversation intelligente :

| Fournisseur | `API_PROVIDER` | `API_URL` | `API_MODEL` (exemple) |
|---|---|---|---|
| Google Gemini | `gemini` | `https://generativelanguage.googleapis.com/v1beta` | `gemini-3.5-flash` |
| Groq | `groq` | `https://api.groq.com/openai/v1` | `llama-3.1-8b-instant` |
| OpenRouter | `openrouter` | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.1-8b-instruct:free` |
| Ollama (local, illimite) | `ollama` | `http://127.0.0.1:11434/v1` | `llama3.1` |

Tous les fournisseurs `groq`, `openrouter`, `ollama`, `lmstudio`, `vllm`,
`mistral`, `deepseek`, `openai` utilisent le format **OpenAI**
(`POST {API_URL}/chat/completions`). Renseigne `API_KEY` (sauf Ollama local).

## Variables d'environnement

Voir `.env.example` (commentaires complets). Principales :

- `API_PROVIDER`, `API_KEY`, `API_MODEL`, `API_MODELS`, `API_URL`, `API_MAX_TOKENS`, `API_TEMPERATURE`
- `MEMOIRE_EXTRACTION`, `RECHERCHE_WEB`, `EXTRACT_PAUSE_MS`
- `RATE_SEND_IP`, `RATE_SEND_UID`, `QUOTA_ATTENTE_MAX_MS`, `QUOTA_ATTENTE_MSG_MS`
- `ADMIN_PSEUDO`, `ADMIN_UID`
- `JSONBIN_API_KEY`, `JSONBIN_BIN_ID`, `JSONBIN_API_URL`, `JSONBIN_SNAP_MIN_MS`
- `PORT`, `BLAMUNE_DATA_DIR`

## Utilisation

- Site : `http://localhost:8080/`
- Admin : `http://localhost:8080/admin`
- Endpoints : `/ping`, `/health` (health check), `/send`, `/historique`,
  `/register`, `/login`, `/stats`...

## Tests

```powershell
npm test          # tests d'integration (lance un vrai server.js + faux modele)
npm run test:unit # tests unitaires (node:test)
```

Verification du dossier de deploiement :

```powershell
python verifier_deploiement.py
```

## Deploiement

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

Le disque Render est **ephemere**. `storage.js` pousse comptes, memoires et
historiques vers **JSONBin.io** ~3 s apres chaque ecriture et restaure tout au
demarrage. Sans `JSONBIN_API_KEY`, les donnees sont perdues a chaque redeploiement.

## Securite

- Mots de passe hashes (scrypt + sel).
- En-tetes de securite (CSP, X-Frame-Options, HSTS...).
- Fichiers sensibles (`comptes.json`, `config.json`...) servis en 404.
- Limitation de debit par IP et par utilisateur.
- Role admin configure via `ADMIN_PSEUDO` / `ADMIN_UID`.

## Licence

MIT - voir [LICENSE](./LICENSE).
