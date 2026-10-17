# DEPLOIEMENT OPTION A — BLAMUNE toujours en ligne (Render + OpenRouter)

Ce guide te permet de mettre BLAMUNE en production sur **Render**, de sorte que
ton PC puisse être éteint : le chat répond 24/7 depuis le cloud.

## Ce que tu dois faire toi-même (comptes externes)

Je ne peux pas créer ces comptes à ta place. Voici ce qu'il te faut :

| Service | Pourquoi | Lien |
|---------|----------|------|
| **GitHub** | Ton code y est déjà poussé | github.com |
| **Render** | Héberge le serveur Node 24/7 (plan gratuit) | render.com |
| **OpenRouter** | Clé IA principale, modèles gratuits | openrouter.ai/keys |
| **JSONBin** | Persistance des comptes, mémoires, historiques | jsonbin.io |
| **Gemini (Google)** | Clé de secours si OpenRouter est saturé | aistudio.google.com/app/apikey |

---

## Étape 1 : Créer tes clés API

### 1.1 OpenRouter (principal)
1. Va sur [https://openrouter.ai/keys](https://openrouter.ai/keys)
2. Crée une clé API (commence par `sk-or-...`)
3. Copie-la, tu en auras besoin dans Render.

### 1.2 Gemini (secours, gratuit)
1. Va sur [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Crée une clé API (commence par `AIza...`)
3. Tu la mettras dans `API_MODELS` ou comme clé de secours.

### 1.3 JSONBin (persistance obligatoire)
1. Va sur [https://jsonbin.io](https://jsonbin.io)
2. Crée un compte gratuit
3. Crée un **Bin** (contenu vide `{}`)
4. Copie :
   - **API Key** → `JSONBIN_API_KEY`
   - **Bin ID** → `JSONBIN_BIN_ID`

> Sans JSONBin, tous les comptes et mémoires sont perdus à chaque redéploiement Render.

---

## Étape 2 : Pousser le code sur GitHub

Le fichier `render.yaml` a déjà été mis à jour pour OpenRouter par défaut.

```powershell
git add .
git commit -m "Option A : deploiement Render avec OpenRouter"
git push origin main
```

---

## Étape 3 : Déployer sur Render

1. Va sur [render.com](https://render.com), connecte ton compte GitHub.
2. Clique **"New +" → "Web Service"**.
3. Sélectionne ton dépôt `BLAMUNE`.
4. Render détecte `render.yaml` automatiquement. Valide :
   - **Runtime :** Node
   - **Build command :** `npm ci --omit=dev`
   - **Start command :** `node server.js`
   - **Plan :** Free

### Variables d'environnement (onglet Environment du dashboard Render)

Ajoute chacune de ces variables :

| Clé | Valeur |
|-----|--------|
| `API_PROVIDER` | `openrouter` |
| `API_KEY` | `sk-or-TA_CLE_OPENROUTER` |
| `API_URL` | `https://openrouter.ai/api/v1` |
| `API_MODEL` | `meta-llama/llama-3.1-8b-instruct:free` |
| `API_MODELS` | `google/gemini-2.0-flash-exp:free,meta-llama/llama-3.1-8b-instruct` |
| `API_MAX_TOKENS` | `512` |
| `API_TEMPERATURE` | `0.7` |
| `MEMOIRE_EXTRACTION` | `1` |
| `RECHERCHE_WEB` | `0` |
| `NODE_ENV` | `production` |
| `PORT` | `8080` |
| `ADMIN_PSEUDO` | `admin` |
| `ADMIN_MDP` | *(laisse vide : mot de passe auto-généré une fois)* |
| `JSONBIN_API_KEY` | `ta_cle_jsonbin` |
| `JSONBIN_BIN_ID` | `ton_id_bin_jsonbin` |
| `JSONBIN_API_URL` | `https://api.jsonbin.io/v3/b` |
| `KEEPALIVE` | `1` |
| `RATE_SEND_IP` | `20` |
| `RATE_SEND_UID` | `10` |
| `API_POOL` | `pollinations\|https://text.pollinations.ai/openai\|\|openai-fast;mistral\|https://api.mistral.ai/v1\|mstrl_TA_CLE\|mistral-small-latest` |
| `API_POOL_COOLDOWN_MS` | `60000` |
| `API_POOL_COOLDOWN_AUTH_MS` | `600000` |

### La cascade IA, expliquée : rien ne dépend de ton PC

Le serveur Render fonctionne SEUL. Le proxy DeepSeek local (`deepseek-auth.json`,
Chrome automatisé) est un **bonus pour ton PC uniquement** : il exige un
navigateur et des cookies de session, il ne tourne donc pas sur Render et
personne n'en devrait dépendre. Sur le serveur hébergé, la chaîne de repli est :

1. **Principal** : le fournisseur d'`API_PROVIDER/API_URL` (ex. OpenRouter ou Gemini).
2. **Membres d'`API_POOL`** (dans l'ordre, cooldown auto sur 429/401/403/5xx) :
   - **pollinations** : aucun compte, aucune clé — marche toujours, ~1 réponse/30 s ;
   - **mistral** : ta clé est déjà dans le pool (voir `.env` local) ; sur Render,
     remplace `mstrl_TA_CLE` par la vraie clé ;
   - libres **groq** et **cerebras** (tiers gratuits, ~30/min et 1 M tokens/jour)
     dès que tu crées les comptes : une ligne à ajouter à `API_POOL`.
3. **Repli navigateur** (déjà en place) : si le serveur entier est saturé ou
   en sommeil, la page tente Pollinations elle-même puis le petit modèle
   WebGPU hors ligne — l'utilisateur reste toujours servi.

Avec `API_POOL` d'un seul membre (pollinations), le pool est actif dés que le
principal échoue : le chat ne rend plus jamais « problème technique » sans
d'abord avoir fait le tour de tous les replis cloud.

Clique sur **Save Changes**, puis **Manual Deploy** → **Deploy latest commit**.

---

## Étape 4 : Empêcher Render de s'endormir (Keepalive)

Sur le plan gratuit, Render endort l'instance après ~15 min d'inactivité.

Ton projet contient déjà `.github/workflows/keepalive.yml` qui ping ton URL toutes les 5 minutes via GitHub Actions.

### Configurer l'URL dans GitHub
1. Dans ton dépôt GitHub, va dans **Settings > Secrets and variables > Actions > Variables**.
2. Crée une variable `BLAMUNE_URL` avec la valeur : `https://TON-NOM-APP.onrender.com`
   (Remplace par le nom exact de ton service Render.)

Le workflow se déclenche automatiquement à chaque push et toutes les 5 minutes.

> Alternative plus fiable : ajoute un service externe gratuit (cron-job.org ou UptimeRobot) qui ping `https://TON-APP.onrender.com/health` toutes les 5 minutes.

---

## Étape 5 : Tester (même PC éteint)

1. Note l'URL Render : `https://TON-APP.onrender.com`
2. Ouvre le navigateur sur cette URL : le site PWA doit s'afficher.
3. Envoie un message dans le chat : l'IA doit répondre via OpenRouter.
4. **Éteins ton PC** (ou ferme tout).
5. Attends 30 min, puis rouvre l'URL Render : le chat doit toujours répondre.

Si le premier chargement est lent, c'est normal : Render réveille l'instance endormie.

---

## Étape 6 : Vérifier que tout est prêt

Lance ce script à la racine du projet pour confirmer qu'aucun fichier critique ne manque :

```powershell
python verifier_deploiement.py
```

Résultat attendu : `PRÊT À PUBLIER`.

---

## Ce qui est déjà fait dans le dépôt (je l'ai préparé pour toi)

- `render.yaml` : configuré pour OpenRouter par défaut, modèles de secours inclus, `RECHERCHE_WEB=0` pour économiser les appels.
- `.env.example` : valeurs par défaut OpenRouter + documentation.
- `lib/config_ia.js` : gère déjà `API_MODELS` (bascule automatique si le modèle principal est saturé).
- `lib/routes/admin.js` : routes `/ping` et `/health` déjà présentes.
- `.github/workflows/keepalive.yml` : ping externe toutes les 5 minutes.
- `.github/workflows/ci.yml` : tests automatiques à chaque push.

---

## Quand tu auras besoin de mon aide

Dis-moi quand tu bloques sur l'une de ces étapes, par exemple :
- Créer le bin JSONBin ou récupérer l'API key
- Configurer les variables d'environnement sur Render
- Le déploiement échoue (copie-colle les logs Render)
- Le chat ne répond pas après déploiement

Je pourrai alors t'aider à débloquer ou passer à l'**Option B** (Ollama auto-hébergé pour l'illimité sans aucune clé API).
