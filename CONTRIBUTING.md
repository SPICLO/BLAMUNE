# Contribuer

## Prérequis

| Outil | Pourquoi |
|---|---|
| **Node.js 22** (voir `.nvmrc`) | `node:sqlite` est utilisé pour les connaissances ; Node 22.5 minimum |
| **g++ avec MinGW** | compiler le bot C++ en local (`bot.exe`) |
| **Python 3** + `pip install -r requirements.txt` | outils hors ligne (`*.py`) |
| **WSL ou Linux** | `bot_service.py` et la CI ne tournent que sous POSIX |

## Démarrer

```bash
npm ci
copy .env.example .env   # puis renseigner API_KEY si l'on veut l'IA en ligne
npm start                # http://localhost:8080
```

Le bot local sans clé ne demande rien : `ouvrir_bot.bat` compile `bot.exe`
au premier lancement s'il est absent.

## Avant de pousser

```bash
npm run lint              # eslint : doit rester à 0 erreur, 0 warning
npm run test:unit         # tests unitaires (node:test)
npm test                  # 47 vérifications d'intégration sur un vrai serveur
python tests\bot_service.test.py   # service HTTP du bot (les deux plateformes)
node tests/routes_smoke.test.js    # aucune route ombragée par un wildcard
python verifier_deploiement.py     # garde-fous de dépôt et de déploiement
```

Les deux derniers sont importants et souvent oubliés :

- `tests/bot_service.test.py` est **intermittent par nature** : il manipule
  des threads et des canaux. Un unique passage vert ne prouve rien sur un
  bug d'exfiltration. Le `exit 134` que nous avons corrigé n'apparaissait
  qu'une fois sur six.
- `tests/routes_smoke.test.js` démarre le vrai serveur et vérifie le **type**
  de réponse de chaque route. Un inventaire statique ne voit pas une route
  capturée par un wildcard.

## Le bot C++ est vérifié par la CI, pas par npm test

`bot.cpp` fait plus de 10 000 lignes et n'est compilé par aucun script
`npm`. Le job `bot-cpp` de la CI compile **les deux branches plateforme** :
la branche `#else` (POSIX) ne contient que des stubs, toute l'implémentation
réelle est dans `#ifdef _WIN32`.

En local : `.\build_bot.ps1`, qui renvoie un code de sortie non nul si la
compilation échoue.

## Style

- **`.editorconfig`** : LF partout, sauf scripts Windows en CRLF.
- **`.prettierrc.json` existe, mais le code n'est pas encore formaté.**
  `npm run format` applique la configuration ; c'est une migration en une
  fois qui n'a pas été faite, et la CI ne bloque donc pas dessus. Si vous
  reformatez, faites-le dans un commit dédié : cela touche des milliers de
  lignes et masque sinon le changement réel dans `git log -p`.
- Les avertissements ESLint sont des erreurs à traiter : le projet est
  aujourd'hui à 0.

## Structure

`server.js` ne définit plus aucune route. Il assemble :

- `lib/` — modules métier (mémoire, historique, résumé, rate limit,
  configuration IA), dépendances injectées, donc testables sans serveur
- `lib/routes/` — un module par domaine

Quand vous ajoutez une route, demandez-vous dans quel module elle va, pas
dans `server.js`.

## Chiffres à jour

| | |
|---|---|
| `server.js` | 2 228 lignes |
| Tests d'intégration | 47 |
| Tests unitaires | 45 |
| Contrôles de routes | 54 |
| Tests du service bot | 24 |

`verifier_deploiement.py` échoue si un fichier attendu disparaît du dépôt,
si une image Docker perd son digest, ou si la CI cesse de compiler `bot.cpp`.