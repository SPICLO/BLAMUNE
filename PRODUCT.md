# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Le créateur du projet et son cercle privé : des proches **invités** par le
système d'invitations (`invites.json`) qui discutent avec BLAMUNE depuis le
navigateur ou la PWA installable. Le créateur est aussi l'**admin** (compte
créé au premier démarrage ; panneau `/admin` pour stats, utilisateurs, logs,
sauvegarde/restauration).

## Product Purpose

BLAMUNE est un **compagnon de conversation en français** : « Ton ami IA.
Discute, apprends-lui des choses, garde ton historique. » Il apprend des
choses sur son interlocuteur (nom, âge, ville, goûts, « retiens que… ») et
les retient d'une session à l'autre. Deux modes : **BLAMUNE** (personnalité,
humeur, état intérieur visible) et **EGO** (conversation directe).
Le succès = les invités reviennent, le bot se souvient d'eux, la
conversation reste vivante même quand l'IA en ligne est coupée.

## Positioning

Ce qu'un chatbot voisin ne peut pas copier tel quel — trois mécanismes
confirmés ensemble :

1. **Compagnon qui se souvient** : mémoire par utilisateur, savoir partagé
   (`savoir.db`), état intérieur visible (humeur, ce qu'il a noté de toi,
   promesses en cours) — un ami, pas un assistant.
2. **Fonctionne sans clé API** : le bot C++ (`bot.cpp`) répond en règles
   locales, 100 % hors ligne ; l'IA en ligne (Gemini, Groq, OpenRouter,
   Ollama, NVIDIA, Eden AI — pool `API_POOL` sticky) est optionnelle.
3. **Auto-hébergeable tout-en-un** : `server.js` + Ollama (`qwen2.5:3b`) +
   bot C++ sur une seule machine via `docker compose`, composants reliés
   par le réseau Docker interne — aucune dépendance à un SaaS.

## Operating Context

- **Langue du produit : français** — interface (`site/`, `admin/`), bot,
  vocabulaire, banque de replis. (Fait du dépôt ; l'interface du site est
  intégralement en français.)
- Les invités discutent via la **PWA** (`site/`, installable, mode hors
  ligne) et reçoivent des **notifications push** (Web Push VAPID, zéro
  dépendance) quand BLAMUNE ose écrire en leur absence.
- Le créateur opère via `/admin` (stats, file d'attente, 429, état éco,
  utilisateurs, logs, sauvegarde/restauration).
- **Deux variantes d'exécution** : la version web (`server.js`, `npm start`,
  port 8080, référence sécurité et API des clients réels) et le **miroir
  local Windows** sans Node (`serveur_bot.ps1`, `serveur_admin.ps1`,
  `bot.exe` compilé par `build_bot.ps1`) — décision actée octobre 2026 :
  miroir conservé en parallèle, jamais un clone.
- **Déploiement** : Render plan gratuit (`render.yaml`, persistance JSONBin
  obligatoire) **ou** stack cloud unifiée (`docker-compose.yml`). Les deux
  restent documentés ; aucun choix exclusif n'est tranché.
- Développement : `npm start`, `npm test`, `npm run test:unit`,
  `npm run lint` (0 erreur/0 warning attendu), prettier appliqué au dépôt.

## Capabilities and Constraints

**Confirmés :** chat à deux modes (BLAMUNE / EGO) ; mémoire par utilisateur
(extraction regex puis par modèle) ; historique persistant + résumé
automatique des longues conversations ; recherche dans l'historique entier ;
recherche en profondeur serveur (DuckDuckGo sans clé, commande `/cherche`,
déclenchement auto discret sur actualité) ; gardiens anti-saturation (file
`MAX_CONC`, mode éco sur 429, cache de recherche) ; PWA installable + mode
hors ligne + web push ; multi-fournisseur IA ; système d'invitations ;
panneau admin complet ; persistance à deux couches (SQLite `savoir.db`
source de vérité, JSONBin pour le cloud).

**Contraintes techniques :**

- Sans `JSONBIN_API_KEY`, comptes/mémoires/historiques/savoir sont **perdus
  à chaque redéploiement** ; le payload dépasse le plafond gratuit JSONBin
  (100 Ko) — **le plan Pro est un prérequis du déploiement cloud**.
- Le bot C++ est mono-utilisateur par instance ; sa branche POSIX gère le
  réseau en stubs (c'est `server.js` qui parle au réseau).
- Le plan gratuit Render (512 Mo) ne peut pas faire tourner Ollama ;
  keepalive via `/health` contre la mise en veille.
- Qdrant (mémoire vectorielle) activable mais **non lié** à ce jour
  (`QDRANT_URL`/`QDRANT_API_KEY` absents du dashboard).

**Décisions ouvertes (non tranchées, à ne pas inventer) :** le choix de
déploiement exclusif (Render vs stack cloud unifiée) ; l'activation
effective de Qdrant.

**Terminologie :** modes « BLAMUNE » / « EGO » ; « savoir » (base de
connaissances, `savoir.db`) ; « mémoire » (faits par utilisateur) ;
« invités » (utilisateurs inscrits via invitation) ; « gardiens »
(anti-saturation).

## Brand Commitments

- **Nom : BLAMUNE.**
- **Accroche (binding, README) :** « Ton ami IA. Discute, apprends-lui des
  choses, garde ton historique. »
- Le produit est en français, y compris la voix du bot.
- Les secrets ne vivent jamais dans le dépôt : clés dans le dashboard/env,
  mot de passe admin généré aléatoirement et affiché une seule fois dans
  les journaux.

## Evidence on Hand

- **Contenus réels, dans le dépôt :** `savoir.db` (SQLite, ~230 Ko) et son
  export lisible `savoir.txt` ; `vocabulaire.txt`,
  `vocabulaire_partage.txt`, `personnalite.txt`, `replis.txt`,
  `themes.txt`.
- **Données d'utilisation réelles :** `comptes.json`, `invites.json`,
  `users/<uid>/` (sensibles — jamais servies ni détaillées).
- **Documentation opérationnelle réelle :** `CLOUD.md`, `PUBLICATION.md`,
  `KEEPALIVE.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`.
- **Absences que le travail futur ne doit pas fabriquer :** aucun
  témoignage, presse, étude de cas, chiffre d'adoption ou prix n'existe.

## Product Principles

1. **L'amitié d'abord** — BLAMUNE se souvient, a une humeur et tient ses
   promesses ; c'est un compagnon, pas un assistant.
2. **Sans clé, sans réseau, ça marche** — le bot local et le site restent
   utilisables sans aucune dépendance vitale à un service distant ; l'IA
   en ligne est un bonus, jamais un prérequis.
3. **Une seule machine suffit** — l'auto-hébergement complet doit rester
   simple : un `docker compose`, un réseau interne, aucun SaaS obligatoire.
4. **La vie privée n'est pas négociable** — données des invités protégées,
   secrets hors du dépôt, fichiers sensibles jamais servis (contrainte
   confirmée par le créateur).
5. **Chaque appel IA coûte** — gardiens anti-saturation, caches et mode éco
   sont des choix de conception assumés, pas des rustines.
