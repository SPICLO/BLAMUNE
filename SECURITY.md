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

| Mesure | Où |
|---|---|
| Mots de passe en scrypt + sel aléatoire | `hashMdpScrypt`, migration automatique des anciens hachages sha256 |
| **Aucun mot de passe dans le dépôt** | `ADMIN_MDP`, sinon génération aléatoire |
| Verrouillage après 5 échecs de connexion (15 min) | route `/login` |
| Jeton secret par invite (256 bits, stocké **haché**) | `lib/routes/compte.js` |
| Un uid d'invite seul ne suffit plus : le jeton est exigé | `extraireAuth` |
| Limititation de débit par IP, par clé et par utilisateur | `lib/rate_limit.js` |
| Rôle admin par `ADMIN_PSEUDO` / `ADMIN_UID` | `isAdminUid` |
| En-têtes CSP, X-Frame-Options, HSTS | `server.js`, middleware |
| Extensions sensibles non servies + garde anti-traversée | `lib/routes/statique.js` |
| Fichiers de configuration servis en 404 | middleware |

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

### 2. Endpoint d'administration lié à l'instance de production

`bot.cpp` comporte un `#define HOTE_BLAMUNE "blamune.onrender.com"` en dur.
Tout `bot.exe` compilé par un tiers poste ses connaissances apprises vers
cette instance. Ce n'est pas configurable et ce n'est pas testé.

Ce n'est pas une faille — c'est un choix qui devrait être explicite et
configurable.

### 3. Rate limiting en mémoire

`lib/rate_limit.js` garde les compteurs en mémoire du processus. Sur Render
à l'échelle gratuite, l'instance redémarre et les compteurs repartent à
zéro ; en cas de passage à plusieurs instances, la limite devient
proportionnelle au nombre d'instances. C'est acceptable pour un usage
personnel, pas pour une exposition publique.