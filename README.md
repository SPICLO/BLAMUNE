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
- [Scripts Windows](#scripts-windows)
- [Prerequis](#prerequis)
- [Installation](#installation)
- [Configuration de l'IA](#configuration-de-lia)
- [Variables d'environnement](#variables-denvironnement)
- [Utilisation](#utilisation)
- [Tests](#tests)
- [Outillage](#outillage)
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
|
|- --- Serveur ---
|- server.js          Express : assemble les modules, ne definit plus de route
|- storage.js         Persistance cloud JSONBin
|- savoir_db.js       Source de verite SQLite des connaissances
|- migrer_savoir_sqlite.js  Migration savoir.txt -> savoir.db (au 1er demarrage)
|- lib/               Modules metier (voir "Modules extraits" plus bas)
|- lib/routes/        Un module de routes par domaine
|
|- --- Bot local ---
|- bot.cpp / bot.exe  Moteur de regles C++ (compile par build_bot.ps1)
|- bot_service.py     Service HTTP qui enveloppe bot.cpp (cloud, Linux)
|- savoir.txt         Connaissances du bot (export lisible ; source : savoir.db)
|- vocabulaire.txt    Vocabulaire du composeur de phrases
|- vocabulaire_partage.txt  Mots appris en mode 1, partages avec le mode 2
|- personnalite.txt   Personnalite du bot
|- replis.txt         Banque de repli francaise quand l'IA est injoignable
|- replis.js          Detection de situation + tirage anti-repetition
|
|- --- Scripts Windows (usage local) ---
|- build_bot.ps1 / .bat     Compile bot.cpp ; sort en erreur si ca echoue
|- ouvrir_bot.bat           Lance la version locale C++ (compile si besoin)
|- ouvrir_admin.bat         Lance le panneau d administration
|- serveur_bot.ps1          Serveur du bot local (le vrai, 1 962 lignes)
|- serveur_admin.ps1        Serveur du panneau d administration
|- protection.ps1           Integrite SHA256 + surveillance (voir plus bas)
|- sauvegarde.ps1           Sauvegarde complete locale, hors cloud
|- ouvrir_parefeu.bat/.ps1 Regles pare-feu locales
|
|- --- Outils Python (optionnels) ---
|- extraire_savoir.py       Extrait des personas parquet (pyarrow)
|- fusionner_vocabulaire.py Fusionne les ajouts dans le vocabulaire
|- verifier_deploiement.py  Garde-fous de depot et de deploiement
|
|- --- Front et donnees ---
|- site/              PWA (index.html, app.js, style.css, sw.js, manifest.json)
|- admin/             Panneau d administration (HTML / JS / CSS)
|- tests/             run.js, unit.test.js, lib.test.js, routes_smoke.test.js,
|                     bot_service.test.py
|- users/             Donnees par utilisateur (ignore par git)
|- logs/ backups/     Journaux et sauvegardes (ignores par git)
|
|- --- Deploiement ---
|- Dockerfile / Dockerfile.bot   Images, epinglees par digest
|- docker-compose.yml           Stack cloud (serveur + Ollama + bot)
|- render.yaml                  Service Render (plan gratuit)
|- PUBLICATION.md / CLOUD.md    Guide de publication et choix de serveur
|- KEEPALIVE.md                 Eviter la mise en veille de l instance
|- SECURITY.md / CONTRIBUTING.md
```

### Scripts Windows

`ouvrir_bot.bat` et `ouvrir_admin.bat` sont les deux portes d'entrée : elles
lancent le bon serveur et, pour le bot, compilent `bot.exe` s'il est absent.

`serveur_bot.ps1` et `serveur_admin.ps1` sont les serveurs réels de la
version locale, distincts de `server.js`. Ils tournent en parallèle de la
version web, pas à sa place.

### protection.ps1

Sert à vérifier qu'aucun fichier critique n'a été modifié, et à surveiller
les fichiers en temps réel.

```powershell
.\protection.ps1 -Verifier    # compare les hachages, sort si l'un differe
.\protection.ps1 -Reparer     # retire le lecture seule pour permettre une edition
.\protection.ps1 -Surveiller  # FileSystemWatcher, alerte a chaque ecriture
```

Trois limites, à connaître :

1. **17 fichiers seulement** (`bot.cpp`, `site/app.js`, `admin/*`, les
   scripts de lancement, `vocabulaire.txt`...). Un `npm install` n'y touche
   rien, et n'est jamais surveillé.
2. **Faux positifs possibles sur les fins de ligne.** Les hachages sont
   calculés sur les octets. `.gitattributes` impose LF sauf pour `.ps1` et
   `.bat`, qui doivent rester en CRLF : un `core.autocrlf` mal réglé, ou un
   éditeur qui réécrit ces fichiers, fera signaler une modification qui est
   en fait un simple changement d'encodage. Le fichier de référence
   `.protection_hash.json` est ignoré par git, donc chaque machine
   enregistre sa propre base.
3. **Windows uniquement**, et **non couvert par la CI** : la CI tourne sous
   Linux. Son comportement est vérifié à la main, pas automatiquement.

### Modules extraits de `server.js`

`server.js` fait encore ~2 800 lignes. Il ne définit plus **aucune route** :
il branche des modules, qui reçoivent leurs dépendances par injection au
lieu de les importer. Conséquence directe : ils sont testables sans démarrer
le serveur — voir `tests/lib.test.js`.

**Règle d'injection :** tout ce qui est réaffecté quelque part passe par un
**getter**, tout ce qui n'est muté que par propriété passe par référence. Une
référence injectée à l'initialisation devient périmée après une restauration
de sauvegarde — c'est le piège que `comptes` et `stats` posent, et la
raison pour laquelle `getComptes()` / `getStats()` existent.

| Module                | Rôle                                                                            | Lignes |
| --------------------- | ------------------------------------------------------------------------------- | ------ |
| `lib/config_ia.js`    | Fournisseur, modèles de secours, rotation du dernier modèle répondu             | 181    |
| `lib/rate_limit.js`   | Fenêtre glissante par IP et par utilisateur, purge périodique                   | 53     |
| `lib/memoire.js`      | `users/<uid>/`, `memoire.txt` (format plat partagé avec le bot C++)             | 125    |
| `lib/historique.js`   | `historique_mode<1\|2>.json`, push cloud                                        | 45     |
| `lib/resume.js`       | Repliage des anciens échanges en tâche de fond                                  | 121    |
| `lib/pool_ia.js`      | Pool de secours `API_POOL` : ordres de passage, cooldowns, réutilisation sticky | 189    |
| `lib/keepalive.js`    | Rappel planifié sur `/health` quand personne n'est connecté (anti-veille)       | 107    |
| `lib/compression.js`  | Compression des réponses (zlib natif) : brotli puis gzip, cache RAM, ETag       | 338    |
| `lib/ia/gemini.js`    | Transport Gemini, historique envoyé au modèle, reprise sur 429, état de quota   | 371    |
| `lib/ia/openai.js`    | Fournisseurs compatibles OpenAI (Groq, DeepSeek, Ollama…), même cascade 429     | 283    |
| `lib/qdrant_faits.js` | Mémoire vectorielle du savoir (Qdrant) : embeddings injectés ou hachage local   | 423    |
| `lib/service_bot.js`  | Bot C++ local via HTTP, cache LRU 5 min des messages récurrents                 | 132    |
| `lib/savoir.js`       | Base de connaissances : SQLite, embeddings + Qdrant, banque de replis           | 641    |

| Module de routes             | Couvre                                                                      | Lignes |
| ---------------------------- | --------------------------------------------------------------------------- | ------ |
| `lib/routes/send.js`         | `/send` — message → réponse, streaming SSE, apprentissage avant prompt      | 367    |
| `lib/routes/admin.js`        | `/ping`, `/health`, `/connexions`, tout `/admin/*`, `/stats`, `/config-api` | 488    |
| `lib/routes/compte.js`       | `/register`, `/login`, `/logout`, `/invite`, `/savoir`                      | 229    |
| `lib/routes/consultation.js` | `/historique`, `/proactif`, `/stats-perso`, `/mode`, `/profil`              | 154    |
| `lib/routes/statique.js`     | Site PWA et panneau admin, avec garde-fous de traversée de chemin           | 97     |

La couche HTTP est intégralement extraite : Gemini (`lib/ia/gemini.js`, sorti
le premier car il possède un état transversal — rotation des clés, drapeaux
de retraitement, instant du dernier 429 — que le reste de la couche lit et
écrit), puis le fournisseur compatible OpenAI (`lib/ia/openai.js`), le
service du bot C++ (`lib/service_bot.js`) et le secours savoir
(`lib/savoir.js`). Restent dans `server.js` l'assemblage des modules, la
construction des prompts (`blocSysteme`, rituels, intentions) et
l'apprentissage automatique local (`autoApprentissage` : nom, âge, révê,
anniversaire, promesses, et depuis peu les faits « retiens que… »).

````

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
````

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

| Fournisseur                          | `API_PROVIDER` | `API_URL`                                          | `API_MODEL` (exemple)                   |
| ------------------------------------ | -------------- | -------------------------------------------------- | --------------------------------------- |
| Google Gemini                        | `gemini`       | `https://generativelanguage.googleapis.com/v1beta` | `gemini-3.5-flash`                      |
| Groq                                 | `groq`         | `https://api.groq.com/openai/v1`                   | `llama-3.1-8b-instant`                  |
| OpenRouter                           | `openrouter`   | `https://openrouter.ai/api/v1`                     | `meta-llama/llama-3.1-8b-instruct:free` |
| Ollama (local, illimite)             | `ollama`       | `http://127.0.0.1:11434/v1`                        | `llama3.1`                              |
| NVIDIA NIM (credits gratuits)        | `nvidia`       | `https://integrate.api.nvidia.com/v1`              | `meta/llama-3.1-8b-instruct`            |
| Eden AI (passerelle, ~1 100 modeles) | `edenai`       | `https://api.edenai.run/v3`                        | `openai/gpt-4o-mini`                    |

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
- **Côté bot C++ local** (`bot.exe` lit l'environnement système, pas le `.env`) :
  `BLAMUNE_HOTE` — hôte de la version en ligne qu'un `bot.exe` appelle ;
  par défaut `blamune.onrender.com`. Utile pour pointer un bot compilé
  maison vers sa propre instance (test, auto-hébergement).

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
npm test                          # tests d'integration (lance un vrai server.js + faux modele)
npm run test:unit                 # tests unitaires (node:test) : coherence + modules de lib/
python tests\bot_service.test.py  # service HTTP du bot (poignee de main, /health, /respond)
```

Le bot C++ est compile par la CI, pas par les tests ci-dessus. Le job
`bot-cpp` verifie **les deux branches plateforme** de `bot.cpp` :

| Branche  | Commande                                                        | Ce qu'elle couvre                                                        |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `_WIN32` | `x86_64-w64-mingw32-g++-posix -std=c++14 -fsyntax-only bot.cpp` | toute l'implementation reelle : WinINet, appel en ligne, `pousserSavoir` |
| POSIX    | `g++ -std=c++14 -fsyntax-only bot.cpp`                          | ce que compile `Dockerfile.bot`                                          |

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

## Outillage

| Outil                     | Role                                    | Etat                         |
| ------------------------- | --------------------------------------- | ---------------------------- |
| `npm run lint`            | ESLint (flat config) sur tout le JS     | **0 erreur, 0 warning**      |
| `.github/dependabot.yml`  | npm, pip, images Docker, actions GitHub | hebdomadaire                 |
| `prettier`                | `.prettierrc.json` + `.prettierignore`  | **appliqué à tout le dépôt** |
| `verifier_deploiement.py` | garde-fous de depot                     | tourne dans la CI            |

### Le cas prettier, en clair

La configuration a longtemps été décorative (le paquet n'était pas
installé, puis le code n'était pas passé sous la moulinette). C'est
réglé : le formatage est appliqué à tout le dépôt, un commit dédié à
chaque reprise de code pour ne pas masquer les refactorings dans
`git log -p`.

```bash
npm run format        # applique la configuration
npm run format:check  # signale les écarts sans les corriger
```

`.prettierignore` écarte les fichiers dont le format **est** la donnée
(`savoir.txt`, vocabulaires…), le Python, et les scripts Windows dont le
CRLF est imposé par `.editorconfig`. La CI ne bloque pas sur ce point :
un écart de formatage doit rester cosmétique, jamais un verrou qui
retarde un correctif.

### Dependabot

Ouvert chaque lundi sur cinq ecosystèmes : `npm`, `pip`, `Dockerfile`,
`Dockerfile.bot`, et les actions GitHub. Les patchs npm sont regroupés en un
seul lot — une PR par dépendance de sécurité, c'est du bruit qui retarde le
vrai merge.

Dependabot sait mettre à jour un épinglage par digest, ce qui compte ici :
les images Docker sont volontairement figées sur un digest (voir
[Deploiement](#deploiement)).

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

**A lire avant une exposition publique : [SECURITY.md](./SECURITY.md).** Il
documente ce qui protege l'application et les points connus qui meritent
d'etre tranches.

Le compte `admin` est cree au premier demarrage. Son mot de passe vient de
`ADMIN_MDP`, ou est **genere aleatoirement et affiche une seule fois** dans
les journaux : il n'existe nulle part dans le depot. Voir `.env.example`
pour la mise en place sur Render.

Pour contribuer : [CONTRIBUTING.md](./CONTRIBUTING.md).

## Licence

MIT - voir [LICENSE](./LICENSE).
