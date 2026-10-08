# BLAMUNE — Stack cloud unifiée (server.js + Ollama + bot.cpp)

Ce document décrit la déploiement où **les trois composants tournent sur un
seul serveur cloud**, ce qui est la configuration qui minimise la latence.

---

## 1. Architecture

```
Navigateur
    ↓  (1 seul aller-retour public)
┌──────────────────────────────────────────┐
│  Serveur cloud unique                     │
│                                          │
│   server.js  ──HTTP interne──►  Ollama   │  (qwen2.5:3b, GPU, modèle chaud)
│       │                                  │
│       └────HTTP interne──►  bot.cpp      │  (règles locales + apprentissage)
│                      (service sur :8090)│
└──────────────────────────────────────────┘
```

Tout est dans un seul `docker compose` : les conteneurs se parlent via le
réseau Docker interne. Aucun aller-retour ne sort de la machine.

`server.js` interroge **Ollama en priorité**. Si l'IA est indisponible ou trop
lente, il bascule sur le bot C++ local, puis sur `savoir.txt`. Le service bot
n'est donc appelé **qu'après un échec réel** : aucune latence ajoutée sur le
chemin nominal.

---

## 2. Ce qu'il faut pour le serveur

| Modèle 3b | RAM мини | GPU | Sans GPU (CPU) |
|---|---|---|---|
| `qwen2.5:3b` (recommandé) | 8 Go | 4 Go VRAM | possible, 2 à 6 s/réponse |
| `llama3.2:3b` | 8 Go | 4 Go VRAM | possible, 2 à 6 s/réponse |
| `qwen2.5:7b` | 16 Go | 8 Go VRAM | 10 à 25 s/réponse |

Sans GPU, un modèle 3b reste utilisable mais la latence augmente fortement.

---

## 3. Mise en place

```bash
# Sur le serveur cloud (Ubuntu avec GPU)
git clone <ton-depot> blamune
cd blamune

# 1. Vérifier que le GPU est visible par Docker
nvidia-smi
docker run --rm --gpus all ubuntu nvidia-smi

# 2. Démarrer toute la stack
docker compose up -d

# 3. Suivre les logs
docker compose logs -f
```

Au premier démarrage, `ollama-init` télécharge `qwen2.5:3b` et le préchauffe.
Le site répond sur le port `8080`.

---

## 4. Optimisations de latence déjà appliquées

| Optimisation | Effet |
|---|---|
| `OLLAMA_KEEP_ALIVE=-1` | le modèle ne se décharge jamais (sinon 5 à 20 s au premier message) |
| `ollama-init` | modèle téléchargé et chauffé avant le premier usage |
| réseau Docker interne | pas d'aller-retour public entre composants |
| `API_MAX_TOKENS=512` | réponses courtes = moins de tokens à générer |
| `OLLAMA_NUM_PARALLEL=1` | évite de saturer une petite GPU |
| cache LRU 5 min | les messages récurrents (« salut », « merci ») ne relancent pas l'IA |
| bot local en secours | si l'IA tombe, la réponse vient du C++ en quelques ms |
| streaming SSE | le visiteur voit le début de la réponse sans attendre la fin |
| `RECHERCHE_WEB=0` par défaut | évite un appel outil inutile sur chaque message |

---

## 5. Variables d'environnement

Voir `.env.example`. Les essentielles côté cloud :

```env
API_PROVIDER=ollama
API_URL=http://ollama:11434/v1
API_MODEL=qwen2.5:3b
BOT_SERVICE_URL=http://bot:8090
JSONBIN_API_KEY=...
JSONBIN_BIN_ID=...
```

---

## 6. Commandes utiles

```bash
docker compose ps                      # état des services
docker compose logs -f server          # journal du serveur
docker compose logs -f bot             # journal du bot C++
docker compose restart bot             # redémarrer le bot
docker compose down                    # tout arrêter
docker compose up -d --build           # reconstruire après modification
curl localhost:8080/ping               # test serveur
curl localhost:8099/health             # test bot (via docker exec)
```

Changer de modèle sans tout reconstruire :

```bash
# dans .env : OLLAMA_MODEL=llama3.2:3b
docker compose up -d ollama-init
```

---

## 7. Persistance des connaissances

`savoir.txt` est un fichier vivant partagé entre `server.js` et `bot.cpp`.
Trois protections ont été mises en place :

| Risque | Protection |
|---|---|
| Un arrêt pendant l'écriture tronque le fichier | écriture atomique : temporaire + `rename` |
| Le bot écrase ce que le serveur vient d'ajouter | rechargement `stat()` avant réécriture |
| Deux requêtes concurrentes perdent une entrée | ajout par `appendFileSync` (pas de réécriture) |
| Clé en double après fusion serveur + locale | déduplication au chargement |

Si tu veux aller plus loin, la vraie évolution est de **sortir du fichier plat** :

| Option | Avantage | Inconvénient |
|---|---|---|
| **SQLite** (`bot.cpp` + `server.js` sur la même base) | transactions, index UNIQUE sur la clé, validation au niveau du schéma, vrai multi-écrivain | `sqlite3` à lier dans le C++, migration des 1 266 entrées |
| Journal append-only + compactage | jamais de réécriture complète, historique des événements | compactage à écrire, fichier toujours volumineux |
| Quarantaine + validation admin | `savoir.txt` reste propre, réversibilité totale | les connaissances ne sont actives qu'après validation |

Le JSONBin déjà en place sert de sauvegarde cloud : il reste utile dans les
trois options, mais ne remplace pas une source de vérité unique.

## 8. Sécurité

- Ollama est lié sur `127.0.0.1` : il **n'est jamais public**.
- Seul `server.js` est exposé sur le port `8080`.
- Le bot (`8090`) n'est joignable que depuis le réseau Docker interne.
- Si tu mets un reverse proxy devant `server.js`, ajoute HTTPS.

---

## 9. Limites connues

- **Le bot C++ apprend, mais uniquement des sujets valides.** Un mot n'est
  promu « mot-clé de catégorie » que s'il passe la validation
  (`motApprenable`) : longueur ≥ 4, pas de fragment de contraction
  (« j'aime » → « aime »), pas de verbe d'état (« j'habite » → « habite »),
  pas de chiffre ni de ponctuation. La promotion n'écrit **aucune
  affirmation** dans `savoir.txt` : l'entrée est persistée sous la forme
  `mot||categorie` (réponse vide), que le serveur ignore et que le bot ne
  prononce jamais. Une correction ultérieure
  (« non, X c'est Y ») vient la compléter normalement.
- **`bot.cpp` ne parle pas au réseau sous Linux.** La branche `appelerEnLigne`
  est un stub qui renvoie `""` : sur le cloud, c'est `server.js` qui gère le
  réseau, pas le bot.
- **Le bot est mono-utilisateur par instance.** Une seule session dexchange à
  la fois (un `stdin` / un `stdout`). Pour plusieurs utilisateurs simultanés,
  il faudrait une instance par session ou une refonte en bibliothèque.
- **512 Mo de RAM ne suffit pas.** Le plan gratuit Render ne peut pas faire
  tourner Ollama.
