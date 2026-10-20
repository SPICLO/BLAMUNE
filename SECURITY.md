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

| Mesure                                                   | Où                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| Mots de passe en scrypt + sel aléatoire                  | `hashMdpScrypt`, migration automatique des anciens hachages sha256 |
| **Aucun mot de passe dans le dépôt**                     | `ADMIN_MDP`, sinon génération aléatoire                            |
| Verrouillage après 5 échecs de connexion (15 min)        | route `/login`                                                     |
| Jeton secret par invite (256 bits, stocké **haché**)     | `lib/routes/compte.js`                                             |
| Un uid d'invite seul ne suffit plus : le jeton est exigé | `extraireAuth`                                                     |
| Limititation de débit par IP, par clé et par utilisateur | `lib/rate_limit.js`                                                |
| Rôle admin par `ADMIN_PSEUDO` / `ADMIN_UID`              | `isAdminUid`                                                       |
| En-têtes CSP, X-Frame-Options, HSTS                      | `server.js`, middleware                                            |
| Extensions sensibles non servies + garde anti-traversée  | `lib/routes/statique.js`                                           |
| Fichiers de configuration servis en 404                  | middleware                                                         |

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

### 3. Rate limiting en mémoire — assumé

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
