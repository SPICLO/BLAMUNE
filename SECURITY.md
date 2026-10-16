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

### 1. Mot de passe admin par défaut dans le dépôt

`server.js`, dans `serverListen()`, crée un compte `admin` si aucun n'existe,
avec un mot de passe **écrit en clair dans le code source**.

Conséquence : le dépôt étant public, toute personne connaissant ce mot de
passe obtient l'administration sur une instance fraîche. Le mot de passe ne
peut pas être changé par variable d'environnement : `.env.example` et
`render.yaml` n'exposent que `ADMIN_PSEUDO` et `ADMIN_UID`.

Ce que le serveur fait bien : ne pas recréer le compte s'il existe déjà, et
ne pas écraser un mot de passe changé via `/admin/change-mdp`.

Remédiation envisagée : lire le mot de passe depuis l'environnement, et
refuser de démarrer en production si la variable est absente, pour qu'on ne
puisse pas oublier.

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