# DEPLOIEMENT OPTION A — BLAMUNE toujours en ligne (Render + Gemini)

Ce guide te permet de mettre BLAMUNE en production sur **Render**, de sorte que
ton PC puisse être éteint : le chat répond 24/7 depuis le cloud.

## Ce que tu dois faire toi-même (comptes externes)

Je ne peux pas créer ces comptes à ta place. Voici ce qu'il te faut :

| Service                | Pourquoi                                        | Lien                           |
| ---------------------- | ----------------------------------------------- | ------------------------------ |
| **GitHub**             | Ton code y est déjà poussé                      | github.com                     |
| **Render**             | Héberge le serveur Node 24/7 (plan gratuit)     | render.com                     |
| **Gemini (Google)**    | Clé IA principale, gratuite et limitée en quota | aistudio.google.com/app/apikey |
| **Qdrant** (optionnel) | Mémoire vectorielle du savoir                   | cloud.qdrant.io                |
| **JSONBin**            | Persistance des comptes, mémoires, historiques  | jsonbin.io                     |

---

## Étape 1 : Créer tes clés API

### 1.1 Gemini (principal, gratuit)

1. Va sur [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Crée une clé API (commence par `AIza...`)
3. Copie-la, tu en auras besoin dans Render.

> ⚠️ NE JAMAIS mettre une clé OpenRouter (`sk-or-...`) dans `API_KEY` :
> le fournisseur configuré est Gemini, qui refuse la clé avec un 400.
> Symptôme observé en ligne : plus aucune IA, aucun cooldown, le bot répond
> seul via ses replis locaux et rien ne le signale dans `/health`.
> En cas de doute, ouvre **Render > ton service > Logs** : chaque échec IA
> y est tracé (ex. « API key not valid » = mauvaise clé).

### 1.2 Qdrant (optionnel, mémoire vectorielle du savoir)

1. Va sur [https://cloud.qdrant.io](https://cloud.qdrant.io), crée un cluster gratuit.
2. Copie :
   - **URL** → `QDRANT_URL`
   - **Clé API** → `QDRANT_API_KEY`
3. Les autres variables (`QDRANT_COLLECTION`, `QDRANT_SEUIL`, `QDRANT_EMBED`)
   sont déjà préremplies dans `render.yaml`.

> Sans Qdrant, BLAMUNE reste complet : le savoir répond par mots-clés
> exacts, il manque juste la tolérance aux tournures de phrases.

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

Le fichier `render.yaml` a déjà été mis à jour pour Gemini par défaut.

```powershell
git add .
git commit -m "Option A : deploiement Render avec Gemini"
git push origin main
```

---

## Étape 3 : Déployer sur Render

1. Va sur [render.com](https://render.com), connecte ton compte GitHub.
2. Clique **"New +" → "Web Service"** (ou ouvre ton service existant).
3. Sélectionne ton dépôt `BLAMUNE`.
4. Render détecte `render.yaml` automatiquement. Valide :
   - **Runtime :** Node
   - **Build command :** `npm ci --omit=dev`
   - **Start command :** `node server.js`
   - **Plan :** Free

### Variables d'environnement (onglet Environment du dashboard Render)

Les variables simples (`API_PROVIDER`, `API_MODEL`, limites, Qdrant activé...)
viennent déjà de `render.yaml` : ne les re-déclare pas. Ajoute seulement
celles-ci (des secrets, donc jamais dans le dépôt) :

| Clé               | Valeur                                 |
| ----------------- | -------------------------------------- |
| `API_KEY`         | `AIza_TA_CLE_GEMINI`                   |
| `JSONBIN_API_KEY` | `ta_cle_jsonbin`                       |
| `JSONBIN_BIN_ID`  | `ton_id_bin_jsonbin`                   |
| `QDRANT_URL`      | _(ton URL cloud.qdrant.io, optionnel)_ |
| `QDRANT_API_KEY`  | _(ta clé Qdrant, optionnel)_           |

> Le raccourci : à la racine du projet, lance `afficher_cles_render.bat`,
> il imprime ces lignes prêtes à copier-coller depuis ton `.env` local.

Réglages optionnels (defauts sains déjà posés dans `render.yaml`) :
`API_MODELS=gemini-3.5-flash-lite` (secours du principal),
`MEMOIRE_EXTRACTION=1`, `RECHERCHE_WEB=0`, limites `RATE_SEND_IP=20`
et `RATE_SEND_UID=10`, `ADMIN_PSEUDO=admin`, `ADMIN_MDP` (à définir :
mis au vide, il est généré et affiché une fois dans les logs).

### La cascade IA, expliquée : rien ne dépend de ton PC

Le serveur Render fonctionne SEUL. Le proxy DeepSeek local (`deepseek-auth.json`,
Chrome automatisé) est un **bonus pour ton PC uniquement** : il exige un
navigateur et des cookies de session, il ne tourne donc pas sur Render et
personne n'en devrait dépendre. Sur le serveur hébergé, la chaîne de repli est :

1. **Principal** : le fournisseur d'`API_PROVIDER/API_URL` (par défaut Gemini).
2. **Modeles de secours `API_MODELS`** (même fournisseur, liste automatique).
3. **Replis locaux** si toute l'IA en ligne échoue : chat bot local > savoir
   (mots-clés) > recherche vectorielle Qdrant (si active) > banque de replis > message technique.
4. **Repli navigateur** (déjà en place) : si le serveur entier est saturé ou
   en sommeil, la page tente Pollinations elle-même (site/ia-secours.js,
   sans clé) — le visiteur reste servi tant qu'il a internet.

Recherche en profondeur (nouveau) : un chercheur **serveur** (DuckDuckGo,
sans clé) ramène les sources et les transmet comme prompt à **tout le
pool** (Gemini, Groq, Pollinations, Mistral...). Déclenchements : la
commande `/cherche <sujet>` (4 pages lues, faits appris dans le savoir
avec source et date) et le déclenchement auto discret sur question
d'actualité (extraits seuls). Env vars : `RECHERCHE_WEB_AUTO=0` coupe le
chercheur serveur ; `RECHERCHE_WEB=0` coupe l'outil `google_search` de
Gemini (facturé).

Pour ajouter d'autres fournisseurs cloud (Groq, Mistral, Pollinations...)
comme filet supplémentaire, remplis `API_POOL` dans le dashboard au format
`nom|url|cle|modele;nom2|url2|cle2|modele2`.

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
3. Envoie un message dans le chat : l'IA doit répondre intelligemment
   (pas les réponses figées du bot local — sinon vérifie `API_KEY`, voir 1.1).
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

- `render.yaml` : configuré pour Gemini par défaut, secours inclus, `RECHERCHE_WEB=0` pour économiser les appels, variables Qdrant prêtes (l'URL et la clé restent à coller dans le dashboard).
- `.env.example` : valeurs par défaut Gemini + documentation.
- `lib/config_ia.js` : gère déjà `API_MODELS` (bascule automatique si le modèle principal est saturé).
- `lib/pool_ia.js` : cascade multi-fournisseur `API_POOL` (cooldowns, sticky).
- `lib/qdrant_faits.js` : mémoire vectorielle sans effet tant que Qdrant n'est pas configuré.
- `lib/routes/admin.js` : routes `/ping` et `/health` déjà présentes (l'état du pool et de Qdrant y est visible).
- `afficher_cles_render.bat` : imprime les valeurs dashboard à copier-coller.
- `.github/workflows/keepalive.yml` : ping externe toutes les 5 minutes.
- `.github/workflows/ci.yml` : tests automatiques à chaque push.

---

## Quand tu auras besoin de mon aide

Dis-moi quand tu bloques sur l'une de ces étapes, par exemple :

- Créer le bin JSONBin ou récupérer l'API key
- Configurer les variables d'environnement sur Render
- Le déploiement échoue (copie-colle les logs Render)
- Le chat ne répond pas après déploiement (copie-colle les lignes « ia »/« gemini » des logs)
