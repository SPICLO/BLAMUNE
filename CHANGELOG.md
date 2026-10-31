# Journal des modifications

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Ce journal démarre avec la mise à niveau « hygiène du dépôt » ci-dessous ; les
versions antérieures sont visibles dans `git log`.

## [Non publié] - 2026-10-31 (bande passante mesurée, avant la panne)

Le workspace Render Hobby a été **suspendu** : 5 Go de bande passante
sortante mensuelle épuisés — sans que le site n'ait reçu énormément de
visites (actifs légers, gzip et cache/ETag déjà en place). Le drain réel
est donc ailleurs (robot, moniteur externe qui retélécharge tout, boucle
d'un client). Mesure avant réparation.

### Gardiens

- **Plafond d'octets par IP et par jour** (`lib/garde_fichiers.js`,
  `STATIQUE_MAX_JOUR_IP=60 Mo` par défaut, mur branché sur les fichiers
  servis) : une limite **en requêtes** ne protège pas un quota — un
  client qui répète un fichier à la fréquence légale (120/min sur une
  page de 30 Ko compressée = 2,4 Go/jour) brûle quand même la bande
  passante. Le mur est **en octets** : 60 Mo/jour ≈ 800 chargements de
  page pour un humain, quelques ordres de grandeur sous un robot. Au
  plafond : 429 à corps minuscule jusqu'à minuit UTC. État public dans
  `/health` (`gardeFichiers` : nombre d'IP surveillées — **jamais de
  liste d'IP**, vie privée préservée).
- **Limite par (IP + chemin)** ajoutée sur les fichiers servis
  (`limiteFichierGet=30/min` en interne, sous la fenêtre
  `RATE_STATIQUE_GET=120/min/IP`) : un robot qui martèle **un seul**
  fichier (typiquement `/`) est coupé beaucoup plus tôt qu'avec la
  seule fenêtre globale.
- **Compteur d'octets sortants** (`lib/sortie.js`, exposé par `/health`
  sous `sortie`) : octets du jour par famille — `statique`, `api`, `sse`
  (les flux `text/event-stream` comptent à part : c'est le suspect n°1
  d'un debit continu) —, la veille pour comparer, et le **palmarès des
  5 chemins les plus gourmands du jour**. Mesure exacte quand
  `Content-Length` est défini (JSON compressé) ; somme des fragments
  sinon (sur-estimation honnête, jamais une découverte tardive).
- **Grade anti-boucle sur les fichiers servis** (`lib/routes/statique.js`,
  `RATE_STATIQUE_GET=120/min/IP`, borne partagée sur tous les fichiers) :
  un robot ou un moniteur sans cache qui retélécharge la page en boucle
  est arrêté par un 429 à corps minuscule (quelques octets), pas par des
  mégaoctets. Un vrai navigateur charge ~12 fichiers par page : dix
  rechargements complets à la minute restent possibles.

### Documentation

- `.env.example` : `RATE_STATIQUE_GET` documenté.
- Plan du constat : `docs/superpowers/plans/2026-10-31-bande-passante.md`.

## [Non publié] - 2026-10-30 (diète de tokens : la saturation réduite à la source)

### Gardiens

- **Prompt système cachable** : la persona (stable) ouvre le prompt ; la
  date/heure, la durée de l'échange et la photo reçue sont déplacées à la
  FIN de `blocSysteme()` (`server.js`). Premier texte inchangé à la virgule
  près = préfixe mis en cache par les fournisseurs (Groq, OpenAI,
  Anthropic) : **les tokens cachés ne comptent pas dans les plafonds
  RPM/TPM** (doc Groq : « Cached tokens do not count »). L'état interieur
  (`texteHumeur`, ex `getPromptBLAMUNE(humeur)`) suit d'abord la persona :
  un changement d'humeur casse le cache à sa ligne, jamais la persona
  elle-même.
- **Fenêtre d'historique 16 → 10** (`HISTO_API_MAX`, `lib/ia/gemini.js`) :
  avec le plafond ~8 K tokens/min de Groq, la fenêtre à 16 échanges
  dégorgeait la minute en un ou deux échanges denses. Les échanges plus
  anciens restent portés par le résumé persistant (`lib/resume.js`, un
  bloc de 10 replié dès que le seuil est atteint). Le mode éco reste à 6.
- **Extraction conditionnée aux vrais indices** (`indiceMemoire` dans
  `lib/memoire.js`, porte dans `lib/routes/send.js`) : les messages sans
  indice de mémoire (« ok », « grave », une question sur la météo…) ne
  partent plus en appel d'extraction ; les petits free tiers du fond du
  pool servent du vrai. La liste de motifs est volontairement généreuse
  (identité, âge, lieu, famille, goûts, activités, études, santé, animaux,
  « retiens », mini-présentations finissant par « c'est … ») : mieux vaut
  une extraction qui répond `{}` qu'un fait manqué.

### Documentation

- Plan d'analyse et de chantier :
  `docs/superpowers/plans/2026-10-30-diete-tokens-cache-extraction.md`.
- Constat d'audit : plafonds Groq 30 RPM / ~1 000 req/j / ~8 K tokens/min
  sur l'offre de base (les limites exactes de chaque organisation sont
  sur `console.groq.com/settings/limits`) ; par ailleurs le résumé de
  conversation était DÉJÀ seuillé à 10 échanges (`RESUME_SEUIL`,
  `lib/resume.js`) et les tâches de fond DÉJÀ routées hors du principal
  (`questionModele()` → `membreFond()`) : les deux chantiers initialement
  prévus se sont donc réduits à la diète de tokens ci-dessus.

## [Non publié] - 2026-10-29 (gardiens anti-saturation plus frugaux)

### Gardiens

- **Mode éco : historique tronqué** : quand la tension s'arme (fenêtre de 429
  saturée), l'historique envoyé aux modèles passe de 16 à 6 échanges
  (`HISTO_ECO_MAX=6`, `nbEchanges()` dans `lib/ia/gemini.js`, consulté par
  la voie Gemini directe ET la voie pool via `lib/ia/openai.js`). Le prompt
  envoyé est LE quota dépensé : sous tension, chaque appel pèse beaucoup
  moins lourd, sans requête supplémentaire.
- **En-tête standard `Retry-After` lu sur les 429** des trois transports
  (Gemini non-flux, Gemini flux, pool OpenAI) : la valeur réelle demandée
  par le fournisseur est rattachée à l'erreur (`e.retryAfterMs`) et
  `delaiIndique()` la priorise sur le parsing du message
  (« please retry in 45.4s ») qui reste de secours. Attente exacte, plus
  de dépendance à la formulation.

### Documentation

- `.env.example` : le calibrage de `MAX_CONC` est documenté selon la largeur
  du pool (`API_POOL`) — un pool large supporte un plafond plus haut, la
  capacité réelle de la boîte reste la largeur du pool plus les clés Gemini.

## [Non publié] - 2026-10-28 (durcissement en-têtes, dépendance et vigie de dépôt)

### Sécurité

- **Correction de la dépendance vulnérable** `body-parser` (DoS via
  octets résiduels après un corps compressé, advisory GHSA-27r3-jxmh-p828)
  : `npm audit fix` fait passer 2.3.0 → 2.4.0 dans le lockfile, sans
  changement majeur. `npm audit` repart à zéro vulnérabilité.
- **CSP durcie dans `server.js`** : `frame-ancestors 'none'`
  (double `X-Frame-Options: DENY` pour les navigateurs modernes),
  `base-uri 'self'` et `form-action 'self'` ferment les injections qui
  tenteraient de rediriger une soumission de formulaire ou une balise
  `<base>`. Aucune refonte : le site est déjà auto-porté (`'self'`).
- **Header `Permissions-Policy` ajouté** : `geolocation=(), camera=(),
payment=()` interdits, `microphone=(self)` laissé ouvert explicitement —
  la dictée vocale de `site/app.js` (`SpeechRecognition`) en dépend.
  En-têtes vérifiés en runtime (`/admin/`), pas qu'en source.

### Maintenance

- **ESLint et Prettier rendus utilisables à nouveau localement** :
  les dossiers posés à la racine sans être suivis par git (`OpenMontage/`,
  `agent/`, `.agents/`, `.claude/`, `.codex/`) plus l'outillage importé de
  `.github/skills/` sont passés dans le filet de la moulinette : 1 020 erreurs de lint et
  1 336 écarts de format, tous étrangers au projet. Ils sont ignorés par
  `eslint.config.mjs` et `.prettierignore` ; le motif `*.umd.js` rejoint
  `*.min.js` (bundles vendus). `npm run lint` et `npm run format:check`
  reviennent à zéro problème, et la CI garde son terrain propre
  (elle ne vérifie que les fichiers suivis).
- `verifier_deploiement.py` : verdict de sa passe longue « PRÊT À PUBLIER ».

## [Non publié] - 2026-10-25 (gardiens anti-saturation)

### Ajouté

- **Gardiens anti-saturation** — quatre couches qui rendent la montée
  d'un pic indolore au lieu d'encaisser des 429 en rafale :
  1. **File d'attente de concurrence** (`lib/concurrence.js`) : un
     plafond d'appels IA simultanés (`MAX_CONC`, 3 par défaut) ; les
     demandes en surplus patientent dans une file ordonnée (premier
     arrivé, premier servi) — le visiteur ne voit rien de nouveau (sa
     bulle d'écriture est déjà affichée) et le `:diag file=` du flux
     SSE dit combien de temps il a attendu. Après `MAX_ATTENTE_MS`
     (10 s), la requête part quand même (fail-open : on ne perd jamais
     un message) et compte un « débordement ».
  2. **Tension + mode éco** (`lib/tension.js`) : chaque 429 réel est
     compté au goulot unique `marquerQuota()` (voie Gemini ET voie
     pool). Dès `TENSION_SEUIL` (3) 429 en `TENSION_FENETRE_MS`
     (5 min), le site passe en **mode éco** : recherche web auto
     couchée, `/cherche` réduit aux extraits seuls (0 page lue),
     tâches de fond (résumé, extraction, apprentissage) suspendues —
     le pool ne sert plus que le chat. Sortie naturelle quand la
     fenêtre se calme, avec un séjour minimum
     (`TENSION_SEJOUR_MS`, 10 min) pour ne pas clignoter.
  3. **Cache du chercheur web** (`CACHE_RECHERCHE_MS`, 30 min par
     défaut, 300 sujets) : le même sujet demandé de près ou de loin
     n'est cherché qu'une fois ; le 2e visiteur est servi sans
     re-téléchargement ni tokens, avec l'heure de sa recherche
     d'origine (pas de fausse fraîcheur). Un échec, lui, ne se cache
     jamais.
  4. **Compteurs visibles** : panneau
     « Gardiens anti-saturation » dans `/admin` (appels en cours /
     max, file, débordements du jour, 429 de la fenêtre et du jour,
     état éco, cache) et champ `gardiens` dans `/health` pour les
     sondes externes.
- Rappel capacité : au delà du code, le levier qui AGRANDIT la
  capacité reste l'ajout d'une clé dans l'`API_POOL` (dashboard
  Render) ; chaque clé gratuite Groq ≈ +8-9 réponses/min.

### Changé

- `lib/routes/send.js` : acquiert une place de concurrence juste
  autour de l'appel au modèle (mode 1 et mode 2), libérée avant les
  replis locaux ; `:diag` enrichi (`file=`, `eco=`).
- `lib/ia/gemini.js` : `marquerQuota()` nourrit la fenêtre de tension ;
  `reporterTache()` jette les tâches de fond pendant l'éco (compteur
  `tachesSuspendues`).
- `lib/recherche_web.js` : `creerRechercheWeb({cacheMs, cacheMax,
maintenant})` encapsule `rechercheWeb()` avec une mise en cache
  honnête (aucun échec mémorisé, éviction FIFO, TTL 0 = désactivé).
- `.env.example` : les 7 variables des gardiens documentées.
- `tests/gardiens.test.js` : 7 tests (file FIFO, fail-open,
  tension/éco avec hystérésis, cache hit/TTL/échec).
- Diag `modele=` sur la voie pool : `pool_ia` mémorise le modèle du
  dernier membre vraiment répondu (`noteOk(nom, modele)`, getter
  `modeleOkConnu()`) — `memoriserModeleOk` refuse honnêtement les noms
  hors liste `API_MODEL(S)` (`openai/gpt-oss-120b`...), le :diag du
  client retombe donc sur l'info du pool ; QA locale :
  `diag modele=openai-fast`.

## [Non publié] - 2026-10-25 (recherche en profondeur)

- **Recherche en profondeur, serveur, sans clé** (`lib/recherche_web.js`) :
  DuckDuckGo cherche, les pages principales sont lues (extraits plafonnés),
  les sources sont injectées dans le prompt système — **tout modèle du
  pool** (Groq, Pollinations, Mistral, Gemini...) peut maintenant parler
  du jour, là où seul Gemini avait `google_search` (facturé). Deux
  déclenchements : la commande **`/cherche <sujet>`** (5 sources, 4 pages
  lues, et les 2 premiers faits entrent dans le savoir avec source et
  date, catégorie `recherche-web`) et le déclenchement **auto** discret
  sur question d'actualité en mode 2 (extraits seuls, refroidissement
  45 s/config utilisateur, jamais si l'utilisateur parle de lui). Le
  chercheur n'est pas si bête : garde-fous SSRF (`localhost`, plages
  privées, metadata cloud, protocoles non http(s) refusés), lectures
  bornées (300 Ko, 6 000 caractères, timeout 7 s), content-type vérifié,
  un seul fait par site DDG. `RECHERCHE_WEB_AUTO=0` coupe le chercheur
  serveur ; la clé existante `RECHERCHE_WEB` ne pilote plus que l'outil
  Gemini. Gemini « avale » proprement : quand le chercheur serveur a
  déjà rempli le prompt, `google_search` n'est pas invoqué (pas de
  double recherche).

### Changé

- `site/app.js` : `/cherche` est routé au serveur (usage `/cherche <sujet>`
  expliqué en info si vide) ; la liste `/aide` le documente.

## [Non publié] - 2026-10-21/23

### Ajouté

- **Sprint E, étape 4 : BLAMUNE écrit hors du site (Web Push)** — la sonde
  `/proactif` ne livre que quand l'utilisateur rafraîchit la page ; à
  partir de là, plus personne ne reçoit les anniversaires ni les rappels
  de promesse. Le Web Push arrive : clés générées par
  `node scripts/generer_cles_push.js` (une seule clé privée à poser en
  `VAPID_PRIVATE_KEY` ; la clé publique est dérivée et exposée par
  `/push/config`), **zéro dépendance npm** — VAPID (RFC 8292) et le
  chiffrement aes128gcm (RFC 8291/8188) tiennent dans le crypto natif de
  Node, testés en roundtrip complet dans `tests/lib.test.js` (un
  déchiffreur récepteur conforme lit ce que le module chiffre). Côté
  site : un bouton « Notifications » (caché quand le serveur n'est pas
  configuré), abonnement via `pushManager.subscribe` stocké dans
  `users/<uid>/abonnement.json` ; le service worker affiche la
  notification et adresse le clic vers le site. Côté serveur : une
  vague d'arrière-plan (toutes les 10 min, `PUSH_CHECK_MS`) applique les
  **mêmes règles proactives** (`livrerProactif`, cooldowns inclus) aux
  absents de plus de 20 min (`PUSH_ABSENCE_MS`) et pousse le message ; il
  est déjà dans l'historique, donc aucun doublon au retour. Sans `VAPID`
  configuré, la fonctionnalité est éteinte de part en part (bouton
  invisible, vague non démarrée, usage du site inchangé). Un abonnement
  déclaré mort (404/410) est purgé automatiquement. Intégration
  complète par un faux service push local (config, abonnement, essai
  chiffré, purge). Un envoi refusé par le service push remonte désormais
  son motif (champ `detail` de `/push/essai`) : le 400 du service se lit
  dans la réponse au lieu de rester muet.

- **Sprint E, étape 3 : l'état intérieur de BLAMUNE devient visible** —
  l'humeur commandée (« sois calme »), ce qu'elle a noté de l'utilisateur
  et les promesses en cours vivaient dans la mémoire, invisibles hors du
  profil complet. `/stats-perso` expose désormais un bloc `blamune` —
  discret à dessein : une pastille, pas un rapport — rendu visible sous
  le statut du site (retiré quand il n'y a rien à dire), rafraîchi à
  l'entrée dans l'app et après chaque message, et détaillé par la
  commande `/stats`. Intégrée par un nouveau cas (`sois calme` remonte
  dans l'état visible) ; +1 check vocabulaire.

- **Sprint E, étape 2 : retrouver une phrase dans tout l'historique** — le
  fil n'affiche que les dernières bulles (au-delà, le rendu fige la
  page), et rien ne permettait de relire une conversation d'il y a des
  semaines. Le bouton « Rechercher » du site ouvre un champ qui interroge
  `/historique?q=` : **l'archive entière est fouillée côté serveur**,
  insensible à la casse et aux accents, réponses bornées (40 plus
  récentes). Module pur `lib/recherche.js` testé sans Express (3 cas :
  accents des deux côtés, motif trop court, bornage), intégrée par un
  cas de plus dans `tests/run.js`, et l'UI reprend le même rendu que le
  fil (envoi pendant une lecture ferme proprement la recherche).

- **Sprint E, étape 1 : le coût du cloud et le sort des serveurs locaux
  sont écrits** — 2 600 lignes de PowerShell attendaient une décision :
  `serveur_bot.ps1` (2 078) et `serveur_admin.ps1` (513) deviennent le
  « miroir local » officiel — chemin Windows sans installation, server.js
  reste la référence sécurité/API, parité non recherchée, fin de route
  prévue : Node sur le poste (voir README). Côté cloud, `CLOUD.md` porte
  désormais la fiche JSONBin : 10 000 requêtes à vie et JSON de 100 Ko au
  plan gratuit, 15 $ le plan Pro (100 000 requêtes, 10 Mo). Notre payload
  de sauvegarde (dump SQL du savoir + historiques) dépasse déjà 100 Ko —
  le plan Pro y est un prérequis, pas une option ; cadences d'usure
  explicites (debounce 3 s, snapshot ≤ 1/min, GET au démarrage seul).

- **Sprint D : l'apprentissage immediat a ses tests unitaires** — la
  fonction qui capte un nom, un age une ville, des gouts ou un fait
  « retiens que... » et les ecrit tout de suite etait branchee dans
  server.js sans aucun test direct. Elle vit maintenant dans
  `lib/auto_apprentissage.js` (module injectable) et `tests/lib.test.js`
  la couvre par 7 cas : apprentissage multi-champs en un message,
  capture gourmande coupee au premier delimiteur, enseignement enregistre
  dans le savoir, humeur jamais prise pour un nom, promesse gardee sans
  doublon, souvenir ecrit dans l'etat interieur, humeur de BLAMUNE a la
  commande (« sois calme »).

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

- **Web Push refusé par FCM (400 « binary data passed in the request
  must be less than 4096 bytes »)** — le chiffrement remplissait un
  record entier : un corps de 4181 octets (86 d'entête + 4095 de
  chiffré) qui dépassait la limite froide du service. La norme
  (RFC 8188) autorise un dernier record plus court : le rembourrage du
  dernier record est désormais minimal (contenu + délimiteur, comme le
  font les vrais navigateurs) ; les records intermédiaires restent
  remplis à `rs`, requis par le framing, avec un nonce par compteur.
  Une notification typique voyage maintenant à ~450 octets. Repéré par
  des essais réels sur la production — le nouveau champ `detail` de
  `/push/essai` portait le motif exact de FCM.

- **Le bouton « Notifications » restait invisible** — son libellé
  changeait (« Activer les notifications ») mais le style `display:none`
  de départ dans `index.html` n'était jamais retiré : le clic était
  câblé, le bouton ne s'affichait pas. Repéré en vérifiant l'interface
  dans un vrai navigateur (pastille d'état et recherche validées au
  passage : « sois calme » fait bien apparaître « BLAMUNE se sent au
  calme », à l'écran comme dans `/stats`).

- **Express 5 casse les routes qui lisaient un corps absent** — v4
  fournissait `req.body = {}` quand aucun parser ne tournait (POST sans
  corps ni Content-Type), v5 laisse `req.body` undefined : `/register`
  et `/login` partaient en 500 avec la page d'erreur d'Express des que
  la requete arrivait sans corps. Un middleware apres les parsers retablit
  le contrat v4 pour toutes les routes d'un coup — un POST sans corps
  rend desormais le 400 legitime (« Pseudo trop court »).

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

### Modifié

- **Express 4 -> 5** — la dependance passe sur `^5.3.0`. Deux ruptures de
  ce framework majeur vous touchaient directement : `app.get('*')` est
  refuse au demarrage par path-to-regexp v8 (un wildcard porte un nom
  desormais, `/*splat`), et un wildcard n'attrape jamais `/` — la racine
  a desormais sa route explicite. Le reste du depot n'utilise aucune API
  supprimee (`res.sendfile`, `req.param()`, `req.query` reaffectable...).

- **server.js perd ~440 lignes : l'auto-apprentissage est externalise**
  dans `lib/auto_apprentissage.js`, comme memoire, historique ou savoir
  avant lui. Le cablage arrive apres la creation du savoir dans le
  fichier : un fait appris s'enregistre aussi en base de connaissances,
  donc `savoirEnregistrer` doit exister au moment de la fabrique.
  `nettoyerValeur`, `PAS_UN_NOM`, `MOOD_MOTS` et `MOIS_FR` restent
  importables par server.js : l'extraction par modele les reutilise.
  Comportement identique : 97 tests unitaires, 51 integration et 67
  smoke passes au meme niveau qu'avant l'extraction.

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
