# Sécurité

## Signaler une vulnérabilité

N'ouvrez **pas** d'issue publique pour un problème de sécurité.

Utilisez l'alerte privée de GitHub :
**Security → Report a vulnerability** sur https://github.com/SPICLO/BLAMUNE

Merci d'indiquer : ce que vous avez trouvé, les étapes pour le reproduire,
et l'impact attendu. Une fois le rapport confirmé, un correctif sera
préparé et publié, puis créditée si vous le souhaitez.

## Périmètre

Sont hors périmètre : les divergences de configuration sur une instance que
vous n'administrez pas, et le comportement du modèle de langue (qui peut se
tromper ou inventer).

Sont dans le périmètre : authentification et autorisation, traversée de
chemin sur les fichiers statiques, injection, fuite de données entre
utilisateurs, déni de service par requête.

## Ce qui protège l'application

| Mesure                                                                | Où                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Mots de passe en scrypt + sel aléatoire                               | `hashMdpScrypt`, migration automatique des anciens hachages sha256 |
| **Aucun mot de passe dans le dépôt**                                  | `ADMIN_MDP`, sinon génération aléatoire                            |
| Verrouillage après 5 échecs de connexion (15 min)                     | route `/login`                                                     |
| Jeton secret par invite (256 bits, stocké **haché**)                  | `lib/routes/compte.js`                                             |
| Un uid d'invite seul ne suffit **jamais** : le jeton est exigé        | `extraireAuth`                                                     |
| Re-inscription d'une invite : nonce de /invite (10 min, usage unique) | `lib/routes/compte.js`, `POST /invite/jeton`                       |
| Limititation de débit par IP, par clé et par utilisateur              | `lib/rate_limit.js`                                                |
| Rate limiting **par route dédiée** (send, login, register, admin…)    | `lib/securite.js` (`LIMITES_ROUTES`) + middleware `server.js`      |
| Rôle admin par `ADMIN_PSEUDO` / `ADMIN_UID`                           | `isAdminUid`                                                       |
| En-têtes CSP, X-Frame-Options, HSTS, Referrer-Policy, Permissions     | `lib/securite.js` (`appliquerEnTetesSecurite`) + middleware        |
| Extensions sensibles non servies + garde anti-traversée               | `lib/routes/statique.js` + middleware global `server.js`           |
| Fichiers de configuration servis en 404                               | `lib/securite.js` (`BLOCKED_NAMES`) + middleware global            |
| Validation stricte des corps JSON (champs autorisés, tailles max)     | `lib/validation.js` (`validerSend`, `validerPseudo`, etc.)         |
| Validation stricte des UID (liste blanche, anti-traversée)            | `lib/securite.js` (`uidValide`, `RE_UID_COMPTE`, `RE_UID_INVITE`)  |
| Middleware d'erreur global (pas de crash silencieux)                  | `server.js` (après toutes les routes)                              |
| Mutations protégées par validation d'origine                          | `server.js`, section ORIGINE (`POST/PUT/PATCH/DELETE`)             |
| Conteneurs Docker sans privilège root                                 | `Dockerfile` (`USER node`), `Dockerfile.bot` (`USER 10001`)        |
| Secrets hors dépôt et hors image                                      | `.gitignore`, `.dockerignore`, `local/.env.securise`               |
| SSRF : redirections revalidées à chaque saut                          | `lib/recherche_web.js` (`telecharger`)                             |

## Nouveautés de sécurité (2026-11-09)

Les mesures suivantes ont été ajoutées lors de l'audit de sécurité :

| Domaine                | Mesure                                                                                                            | Fichier                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Centre de sécurité     | Module centralisé regroupant extensions bloquées, validation UID, en-têtes HTTP, rate limit par route, scrypt+sel | `lib/securite.js`                                                |
| Validation des entrées | Rejet des champs non autorisés, limitation des tailles, sanitisation des champs libres                            | `lib/validation.js`                                              |
| Middleware global      | Blocage des fichiers sensibles + en-têtes de sécurité sur toutes les réponses + rate limiting par route           | `server.js`                                                      |
| Tests                  | 64 tests unitaires couvrant `securite.js` et `validation.js`                                                      | `tests/lib.securite.*.test.js`, `tests/lib.validation.*.test.js` |

### Détails des nouvelles protections

- **Extensions bloquées étendues** : `.env`, `.ps1`, `.bat`, `.exe`, `.db`, `.log`, `.pem`, `.key`, `.crt`, `.gitignore`, `.dockerignore`, et tous les fichiers de configuration sensibles (`comptes.json`, `config.json`, `savoir.db`, `savoir.txt`, `replis.txt`, etc.) sont servis en 404.
- **En-têtes de sécurité** : CSP, HSTS, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy, Permissions-Policy appliqués sur **toutes** les réponses.
- **Rate limiting par route** : `/send` (30/min IP, 20/min uid), `/login` (10/min IP), `/register` (5/min IP), `/admin` (5/min IP), `/historique` (30/min uid), `/stats` (10/min uid), `/push` (5/min uid), `/invite` (10/min IP).
- **CSRF / origine des mutations** : les requêtes mutantes (POST/PUT/PATCH/DELETE) d'une origine tierce, `null`, ou d'un `Sec-Fetch-Site: cross-site` sans `Origin` reçoivent un 403 (`server.js`, section ORIGINE). Les origines de confiance se déclarent par `CORS_ORIGINS` (séparateur espace).

  _Supprimé le 2026-11-10_ : `lib/csrf.js` annonçait un jeton `X-CSRF-Token` dérivé de l'ego. Il n'était **importé par aucune ligne du serveur**, son `ALLOWED_ORIGINS` n'existait dans aucune configuration ni documentation, et le site n'envoyait évidemment pas le jeton qu'il exigeait. Un module de sécurité jamais monté ne protège rien ; il donne surtout la fausse impression que la question est traitée. Le seul contrôle réel — et suffisant ici, l'authentification passant par des en-têtes personnalisés que ni un formulaire tiers ni un appel `fetch` cross-origin simple ne peuvent poser — est le contrôle d'origine de `server.js`.

## Points connus, à traiter avant une exposition publique

Ce ne sont pas des failles exploitées, ce sont des décisions de conception
qui méritent d'être tranchées.

### 1. ~~Mot de passe admin par défaut~~ — corrigé

Le compte `admin` était créé au premier démarrage avec un mot de passe
écrit en clair dans `server.js`. Le dépôt étant public, ce mot de passe
donnait l'administration de toute instance fraîche.

Désormais, `motDePasseAdminInitial()` :

1. utilise `ADMIN_MDP` si elle est définie (8 caractères minimum) ;
2. sinon **génère un mot de passe aléatoire**, affiché une seule fois dans
   les journaux au premier démarrage.

Aucun secret n'est plus publié dans le dépôt. Le mot de passe existant
n'est **jamais** écrasé : un changement passe par `/admin/change-mdp`, ou
par la suppression de `comptes.json` pour repartir d'un compte neuf.

**À faire sur une instance déjà déployée** : le correctif ne change pas le
mot de passe existant. Connectez-vous et passez par `/admin/change-mdp`, ou
supprimez `comptes.json` puis redémarrez pour que le nouveau mécanisme
s'applique.

Le test d'intégration utilise lui aussi `ADMIN_MDP` : plus aucun mot de
passe n'est écrit en dur, ni dans le serveur ni dans la suite de tests.
`verifier_deploiement.py` échoue si l'ancien mot de passe réapparaît dans
un fichier suivi.

Le choix de ne pas **refuser de démarrer** sans `ADMIN_MDP` est
délibéré : cela casserait le déploiement d'un opérateur qui aurait oublié
la variable. Le mot de passe généré couvre déjà le risque ; `ADMIN_MDP`
épargne seulement d'aller le chercher dans les journaux.

### 2. ~~Endpoint d'administration lié à l'instance de production~~ — tranché : hôte configurable

`bot.cpp` comportait un `#define HOTE_BLAMUNE "blamune.onrender.com"` en
dur. Tout `bot.exe` compilé par un tiers poste ses connaissances apprises
vers cette instance. Ce n'était pas configurable et ce n'était pas testé.

Désormais, la variable d'environnement `BLAMUNE_HOTE` remplace l'hôte au
lancement (lue une fois, puis mise en cache) ; le `#define` n'est plus
qu'un défaut de compilation. Sans la variable, le comportement reste le
même qu'avant — c'est le contrat déclaré, pas un hasard de binaire.

Couvert par :

- `verifier_deploiement.py` vérifie **les deux moitiés du contrat** :
  que la lecture de `BLAMUNE_HOTE` existe, et que le défaut de
  compilation a été préservé ;
- la CI compile toujours les branches `_WIN32` et POSIX de `bot.cpp`.

**Limite assumée** : la CI ne _fait pas parler_ le binaire Windows avec
un serveur — l'appel WinINet réel n'est pas exécuté sous Linux. La
destination d'un `bot.exe` tournant sous Windows reste un contrôle de
dépôt + compilation locale, pas un test d'exécution.

### 3. ~~Re-inscription d'une invite sans jeton~~ — corrigé (2026-11-08)

`extraireAuth` acceptait une invite **sans enregistrement de jeton** : c'était
le chemin de « migration des vieilles invitations », où le seul uid ouvrait la
conversation. Or `ecrireInvites()` **oublie les jetons inactifs depuis 30
jours**. Une invite revenue après un mois perdait donc son jeton, gardait son
dossier `users/<uid>/`, et reprenait la conversation **sans aucune preuve** —
il suffisait de connaître l'uid. `POST /invite/jeton` rendait même un jeton
neuf à tout uid dont le dossier existait désormais.

Le correctif, appliqué sur trois étages :

1. **`extraireAuth` refuse une invite sans enregistrement** (et les pierres
   tombales). Plus de « mode legacy » : uid seul = 401, systématiquement.
2. **`POST /invite` rend un `nonce`** (192 bits, 10 min, un seul usage, lié à
   l'uid) à celui qui demande l'invitation. `POST /invite/jeton` n'accepte
   plus qu'une preuve : le jeton actuel, ou ce nonce. Un uid deviné, ou
   repris par un autre, n'en a pas.
3. **La purge traite les dossiers orphelins** (invite sans enregistrement)
   comme des invitations : ils meurent à 48 h au lieu de s'accumuler.

Le site (`site/app.js`) conserve le nonce et l'échange contre un jeton au
chargement ; un refus 401 sans jeton efface l'identité locale plutôt que
d'afficher une application condamnée à un 401 par message.

_Conséquence assumée_ : une invitation d'avant 2026-11-08 dont le jeton a
été oublié **perd son accès** (les données restent). C'est le prix de la
règle ; l'invité recrée une invitation ou un compte.

### 4. Rate limiting en mémoire — assumé

`lib/rate_limit.js` garde les compteurs en mémoire du processus. Sur
Render à l'échelle gratuite, l'instance redémarre et les compteurs repartent
à zéro ; en cas de passage à plusieurs instances, la limite devient
proportionnelle au nombre d'instances. C'est acceptable pour un usage
personnel, pas pour une exposition publique.

**Décision** : assumé tant que le service tient dans une seule instance
sur le plan gratuit. Ce choix suit la règle du projet : zéro dépendance
npm ; une persistance des compteurs (Redis, JSONBin) créerait une
latence et un point de panne pour une protection qu'un opérateur solo
n'a pas besoin d'acheter.

Deux signaux tiendraient lieu de déclencheur pour reprendre le sujet :

1. une **exposition réellement publique** (le compte utilisateur devient
   ouvert à n'importe qui, le spam a un intérêt) ;
2. un **passage à plusieurs instances** (le compteur par processus perd
   tout sens).
