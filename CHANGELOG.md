# Journal des modifications

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Ce journal démarre avec la mise à niveau « hygiène du dépôt » ci-dessous ; les
versions antérieures sont visibles dans `git log`.

## [Non publié] - 2026-10-21

### Ajouté

- **Le format prettier est devenu une porte de la CI** — `format:check`
  tourne avant les tests : un fichier mal formate ne passe plus l'etape.
  Dans la meme passe, `actions/checkout` et `actions/setup-node` passent
  en v5 (la v4 ciblait Node 20, depuis deprecie sur les runners — les
  annotations jaunes s'en vont), et `ubuntu-latest` est epingle sur
  `ubuntu-24.04` : le label `latest` migre vers Ubuntu 26 depuis le
  19 octobre 2026, sans preavis sur un depot qui compile mingw.

- **Compression des reponses (zlib natif, zero dependance npm)** — le
  serveur renvoyait tout en texte brut : le bundle IA voyageait sur 6,7 Mo
  a chaque telechargement. Maintenant brotli quand le client le sait lire,
  sinon gzip : bundle IA 6,7 Mo -> 1,5 Mo, app.js 65 Ko -> 17 Ko, style.css
  34 Ko -> 8 Ko. Les reponses courtes, les SSE, les plages 206 et les
  types deja binaires passent sans transformation ; une URL statique deja
  comprimee sertie depuis la RAM ne se recomprime plus et rejoue son ETag
  (revalidation 304 gratuite, bornee a 10 entrees / 12 Mo).

- **La sauvegarde cloud finit son travail a l'arret** — la sauvegarde
  part 3 s apres la derniere ecriture (debounce) ; un SIGTERM direct
  tuait le minuteur, et chaque redeploiement Render perdait les
  derniers messages et memoires des utilisateurs.
  `storage.sauvegarderFinale()` vide le minuteur et fait le PUT tout
  de suite ; server.js attend la fin (filet de 5 s, jamais plus).
- **Reprise apres echec de sauvegarde** — delai croissant 3 s, 12 s,
  27 s... plafonne a 60 s. Sinon, une panne reseau suivie d'une heure
  sans ecriture laissait les donnees non sauvegardees tout ce temps.
  Le nombre d'echecs se voit dans /stats (`sauvegarde.nbEchecs`).
- **La route destructive a enfin ses tests** — `/admin/supprimer-compte`
  etait la plus puissante du serveur et la seule sans filet. Smoke :
  six controles de plus (refus hors admin, admin non supprimable, uid
  hors format, suppression reussie, dossier efface du disque, 404 au
  deuxieme passage). Integration : un compte inscrit de A a Z, efface,
  et ses trois endroits verifies (registre, dossier, cloud).

- **BLAMUNE_HOTE : hote du bot configurable** — `bot.cpp` avait
  `#define HOTE_BLAMUNE "blamune.onrender.com"` en dur : tout `bot.exe`
  compile par un tiers postait ses connaissances vers cette instance,
  sans aucun moyen de rediriger. La variable d'environnement
  `BLAMUNE_HOTE` remplace desormais l'hote au lancement (lue une fois,
  puis mise en cache) ; le `#define` reste le defaut de compilation,
  donc sans la variable le comportement ne change rien. Coute zero :
  le chemin POSIX garde ses stubs, Dockerfile.bot et la stack cloud ne
  voient aucune difference. `verifier_deploiement.py` surveille les
  deux moities du contrat (lecture de la variable ET defaut declare) ;
  la CI compile toujours les branches _WIN32 et POSIX — l'appel WinINet
  reel reste a tester a la main sous Windows, limite documentee dans
  SECURITY.md.
- **Limitation de debit : point tranche dans SECURITY.md** — les
  compteurs resteront en memoire du processus : assumee tant que le
  service tient dans une seule instance gratuite (regle du projet :
  zero dependance npm). Deux declencheurs reouvriront le sujet :
  exposition vraiment publique, passage multi-instances.
- **Dependances** : express 4.22.3 (transitives `proxy-addr` 2.0.8 et
  `qs` 6.16.1 — ferme la faille critique d'usurpation d'IP et trois
  advisories moderees sur `qs`), `dotenv` 18.0.8 et `eslint` 10.13.0.
  Batterie complete repassee au vert apres l'application : lint 0/0,
  82 unitaires, 50 integration, 54 routes, 24 tests Python du service
  du bot, prettier conforme.
- `tests/pool_ia.test.js` passe au format prettier (la CI ne bloque pas
  dessus : il avait echappe au formatage sans qu'aucune porte ne le
  voie).

### Corrigé

- **L'attaquant se forgeait sa propre cle de rate limit** — `getIp()`
  lisait `X-Forwarded-For` tel quel : chaque requete portant une entete
  forgee redevenait une "nouvelle IP", annulant le quota des routes
  sensibles (tentatives de connexion, invite...). `server.js` declare
  `trust proxy = 1` (Render pose un maillon de proxy) et `getIp()` sert
  `req.ip` — l'adresse reelle du client, resolue par express. Cote tests
  locaux rien ne change (pas de proxy : `127.0.0.1`).
- **La liste `node --check` de la CI etait en dur** — `lib/compression.js`
  avait echappe au filet sans que rien ne le voie. La liste vient
  maintenant de `git ls-files '*.js' '*.mjs'` : tout JavaScript suivi
  sera verifie par defaut, sans entretien. Pratique epinglee aussi :
  `ubuntu-24.04` aux deux jobs, v5 des actions.
- **`engines.node` elargi a `>=22.5.0 <25`** — le developpement local sur
  Node 24 ne ramasse plus d'avertissement EBADENGINE. Render reste sur
  Node 22 (via `.nvmrc`, deja en place), la CI sur 22.x, le Dockerfile
  sur `node:22-slim` epingle.
- **`Cache-Control: no-store` placé sur toutes les réponses**, y compris
  les fichiers de `site/` : aucun navigateur ne gardait un asset en cache,
  chaque visite re-telechargeait tout (bundle inclus). Les assets publics
  (GET hors panneau) reçoivent maintenant `public, max-age=0` —
  revalidés par ETag a chaque usage, jamais servis vieux — tandis que
  l'API et le panneau admin restent sans aucune mémorisation.
- `/admin/supprimer-compte` valide desormais le format du uid cible
  (`inv_` + 24 hex ou `u` + 12 hex) AVANT le `fs.rmSync` : la cible
  arrivait telle quelle du corps, un copier-coller rate pouvait effacer
  un dossier arbitraire hors de `users/`.
- `/admin/change-mdp` exige desormais 8 caracteres, comme ADMIN_MDP.
  La variable d'environnement et le panneau doivent exiger la meme
  politique, sinon on peut affaiblir depuis le panneau ce que
  l'environnement interdit.

### Modifie

- `README.md` rattrape sur le code : tableau des modules complet (12
  entrees — `lib/pool_ia.js`, `lib/keepalive.js`, `lib/qdrant_faits.js`
  manquaient a la table) et comptes de lignes a jour ; meme chose pour
  la table des modules de routes ; `server.js` annonce ~2 800 lignes ;
  section prettier reecrite (le depot est formate, la note « pas
  encore » n'a plus de raison d'etre) ; tableau Outillage (ESLint
  couvre tout le JS, pas « 9 fichiers » ; prettier applique) ;
  `BLAMUNE_HOTE` documente dans les variables d'environnement.
- `SECURITY.md` : le point « Endpoint d'administration lié a
  l'instance de production » passe de « a trancher » a « tranche »
  (hote configurable, gardes en depot, limite assumee documentee) ; le
  point « Rate limiting en memoire » devient une decision assumee avec
  ses declencheurs de rouverture.

## [Non publié] - 2026-10-05

### Ajouté

- **Recouvrement du mot de passe admin via ADMIN_MDP** : la variable
  defini sur Render (8 caracteres min) recalcule le mot de passe du
  compte admin a chaque demarrage, meme si le compte existe deja — le
  mot de passe genere n'est affiche qu'une fois dans les journaux et
  un premier boot rate le rendait impossible a retrouver. Pour changer
  le mot de passe depuis /admin/change-mdp ensuite, retirer ADMIN_MDP
  de Render et redeployer (sinon la variable reprend la main). Le
  verrou d'echecs (5 tentatives, 15 min) ne survit plus au reboot :
  l'operateur qui reboot depuis Render controle deja le service, un
  verrou qui le bloquerait avec le bon mot de passe n'apporte rien.
- **Suppression de compte depuis le panneau admin** : nouvelle route
  `POST /admin/supprimer-compte` (uid en corps, session admin requise,
  compte admin non supprimable) qui efface le registre, le dossier
  utilisateur (memoire, historiques, resumes), la copie cloud
  (historiques + memoire via `supprimerTout()`) et la RAM du serveur
  (extraction minutee, fichiers d'API, mode prefere, presence). Le
  panneau liste desormais les uid et arme chaque ligne d'un bouton
  « Supprimer » avec confirmation. Sert notamment a retirer les comptes
  de test dont la memoire a ete empoisonnee avant les corrections.
- **Eclipse Gemini apres saturation** : quand une cascade Gemini complete finit
  en saturation (429 sur tous les modeles), les cles Gemini sont couchees
  pendant `GEMINI_REPOS_MS` (2 min par defaut, 0 pour desactiver). Pendant ce
  repos, les messages partent directement au pilier (API_POOL, ~1-2 s) au lieu
  de re-payer 30-60 s de cascade a chaque expiration de la fenetre de quota ;
  une sonde miniature (1 appel sans historique) verifie en fond a la fin du
  delai que Gemini respire : si OK, l'eclipse se leve et la cascade reprend la
  tete toute seule. Meme sujet : un pilier de secours s'arme des qu'UN membre
  existe dans API_POOL (`aSecours()`), plus besoin d'un principal compatible
  OpenAI au-dessus — un pool d'un seul membre ne tombait plus jamais sur
  groq depuis le retrait du faux membre « principal » ; et la garde de
  fenetre de quota (60 s) file elle aussi au pilier au lieu de rendre un
  repli local.
- **Fond du pool pour les taches de fond** : `questionModele()` (resume,
  extraction) travaille desormais au fond d'API_POOL via `membreFond()` —
  dernier membre declare d'abord (lent mais large), cooldowns respectes,
  jamais le premier membre ni les cles Gemini du chat. La tache rate sans
  bruler le quota du chat quand rien n'est disponible ; `noteOk` n'est pas
  appele, une reponse de fond ne peut pas rendre son membre sticky pour le
  chat. En profite pour retirer le faux membre « principal » du pool quand
  le fournisseur est Gemini pur (l'URL postee en `/chat/completions`
  donnait un 404 perdu a chaque pilier, avant d'atteindre groq).

### Modifié

- **Secours : plus de fait hors sujet comme « réponse du chat »** : la
  couche sémantique de `reponseSecours()` suit désormais la même règle que
  le savoir exact — elle ne partage sa trouvaille que sur une vraie
  demande d'information (« c'est quoi… », « qu'est-ce que… »). En
  contexte, un message de conversation (« tu es qui ? », « ok ») tombait
  sur le voisin vectoriel le plus proche (seuil 0.30) et recevait une
  définition sans rapport (« Parcourir pour découvrir. », « Médecin qui
  opère. ») — exactement l'incohérence constatée sur l'instance en ligne
  pendant la panne Gemini : la banque de replis (situations, ton de
  BLAMUNE) prend la suite à la place.

## [Non publié] - 2026-10-04

### Ajouté

- **RAG sur le chemin nominal** : la base de connaissances (SQLite + index
  sémantique Qdrant) ne servait **qu'en secours** (IA en panne) — le reste du
  temps, BLAMUNE pouvait inventer sur un fait que la base pourtant connu.
  Désormais, le fait pertinent accompagne la question dans le prompt
  système, en mode BLAMUNE comme en mode EGO. Sans surcoût pour le chat
  ordinaire : la couche ne se consulte que sur une vraie question
  (point d'interrogation, demande d'info, motif de début de question),
  la couche sémantique est plafonnée à 2,5 s (`Promise.race`), et un
  contexte vide laisse le prompt byte-identique à avant.
- **Enseignement explicite de faits** : « retiens que X est Y » /
  « apprends que… » / « sache que… » écrit en base dès le message
  (sujet sans article, jamais un pronom ni une phrase à la première
  personne, source `auto`), et la question du même tour en profite déjà.
- **Mode clair** : bouton dans l'en-tête, choix mémorisé dans le navigateur
  (`blamune_theme`), appliqué dès le premier rendu (écran de connexion
  compris), `<meta name="theme-color">` mis à jour.
- **Export de l'historique** : un clic télécharge un `.txt` lisible
  (rôles, horodatages, textes) construit localement dans le navigateur ;
  rien ne part sur un serveur tiers.

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

- `server.js` démembre en trois modules supplémentaires (style
  `creerX({deps})` identique aux routes existantes) : `lib/ia/openai.js`
  (fournisseurs compatibles OpenAI), `lib/service_bot.js` (bot C++ local
  - HTTP) et `lib/savoir.js` (base de connaissances, embeddings disk-cache,
    banque de replis). Le README documente désormais les neuf modules `lib/`.
- Prettier appliqué à tout le dépôt (`npm run format:check` dans les portes
  de commit), bundle vendor `site/ia-webllm.mjs` exclu via `.prettierignore`.
- Tests unitaires portés à 78 (dont 8 nouveaux pour `lib/ia/openai.js`),
  tests d'intégration à 50 (2 nouveaux pour le RAG nominal : injection
  mode 2 et mode EGO, rien sur le chat ordinaire, « retiens que… » exploité
  dans la minute).

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
  le fichier fait autorité sur les connaissances _éditées_ (une ligne retirée
  disparaît), tandis que les connaissances _apprises_ en cours d'usage
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
