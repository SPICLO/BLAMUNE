# Publier BLAMUNE — décision et marche à suivre

Ce document répond à trois questions : où mettre les fichiers, comment ne pas
perdre les données, et quelle IA utiliser.

## 1. Où mettre les fichiers

**Tout est déjà prêt.** Le serveur est sur Render (`render.yaml`), il n'a besoin
que de ce qui suit :

| Fichier | Poids | Rôle |
|---|---|---|
| `server.js` | 139 Ko | le serveur Express (toutes les routes) |
| `storage.js` | 11 Ko | sauvegarde cloud JSONBin |
| `savoir.txt` | 94 Ko | les connaissances du bot |
| `personnalite.txt` | 115 Ko | sa personnalité |
| `vocabulaire.txt` | 12 Ko | son vocabulaire |
| `site/` | 400 Ko | le site public |
| `admin/` | 37 Ko | le panneau d'administration |

**Total publié : 1,5 Mo.** La limite de Render est de 100 Mo. Tu as de la marge
pour les années.

### Ce qui ne part PAS sur le serveur (et pourquoi)

| Élément | Poids | Pourquoi pas |
|---|---|---|
| `bot.exe` | 3,1 Mo | le bot **local** ; le serveur ne le lit pas (seulement mentionné dans des commentaires) |
| `bot.cpp` | 492 Ko | le code source C++, utile seulement pour recompiler en local |
| `node_modules` | 3,7 Mo | recréé par `npm install` au build |
| `cloudflared.exe` | ~~53 Mo~~ | **supprimé** — résidu du tunnel, plus utilisé |
| `users/`, `backups/`, `*.log` | — | données de comptes, ignorées par git |

> Le dossier fait 69 Mo sur ton disque, mais **1,5 Mo seulement sont publiés**.
> Les 53 Mo de `cloudflared.exe` et les 3,7 Mo de `node_modules` ne quittent
> jamais ta machine.

## 2. Persistance — le vrai risque

Le disque de Render est **éphémère** : à chaque redéploiement, tout est perdu.
Comptes, mémoires, historiques **et le savoir appris** par le bot.

Tu as déjà la solution : `storage.js` pousse tout vers **JSONBin.io** ~3 s après
chaque écriture, et restaure tout au démarrage.

### Ce qu'il te reste à faire (une seule fois)

Dans le dashboard Render (`https://dashboard.render.com`) :

1. Va sur ton service **blamune** → **Environment**
2. Ajoute `JSONBIN_API_KEY` = ta clé JSONBin.io (obligatoire)
3. Ajoute `JSONBIN_BIN_ID` = l'ID de ton bin (recommandé)

Sans `JSONBIN_API_KEY`, tout est perdu à chaque redéploiement. C'est la seule
chaine obligatoire pour que le bot garde sa mémoire en ligne.

> `render.yaml` déclare déjà ces deux variables avec `sync: false` : tu n'as
> qu'à **remplir les valeurs dans le dashboard**, elles ne seront jamais
> committées.

### Pourquoi pas de disque Render ?

J'ai écrit puis retiré un bloc `disk:` dans `render.yaml` : **Render réserve les
disques persistants aux plans payants** (~0,25 $/Go/mois). Le conserver aurait
fait **échouer ton déploiement en plan gratuit**. JSONBin fait le même travail
gratuitement, et tu l'as déjà intégré.

## 3. Quelle IA utiliser

### Recommandation : **garder le moteur de règles**

Ton bot n'est pas un modèle de langage : c'est un moteur C++ de ~10 000 lignes
qui reconnaît des intentions par motifs et compose ses réponses à partir de
`savoir.txt`. Il a déjà ces qualités :

- **100 % local**, aucune clé API, aucun quota
- **gratuit**, pas de dépendance externe
- **déterministe** : mêmes règles = mêmes réponses
- **~1,5 Mo** de données au lieu de plusieurs gigaoctets

### Pourquoi un modèle local ne conviendrait pas ici

Le plan gratuit Render donne **512 Mo de RAM**.

| Modèle | Poids (Q4) | Verdict en 512 Mo |
|---|---|---|
| `Qwen2.5-0.5B` | ~400 Mo | à peine — Node + OS mangent déjà 250 Mo |
| `Qwen2.5-1.5B` | ~1 Go | **ne tient pas** |

Le moteur de règles actuel pèse **0 Mo de RAM**. Tu gains 40× avec lui.

### Si tu veux quand même une IA en ligne

Ton `render.yaml` a déjà les variables (`API_KEY`, `API_PROVIDER`, `API_MODEL`).
Le mode 1 appelle alors Gemini à la place de répondre localement. À utiliser
ponctuellement, pas par défaut — quota limité, et tes données partent chez un
tiers.

### Recommendation finale

| | Moteur de règles | API en ligne | Modèle local |
|---|---|---|---|
| Coût | 0 € | ~2–10 €/mois | 0 € mais 7 $/mois d'hébergement |
| Mémoire | 0 Mo | 0 Mo | 400 Mo+ (impossible en gratuit) |
| Hors ligne | ✅ | ❌ | ✅ |
| Qualité sur sujet connu | très bonne | bonne | bonne |
| Prévisibilité | totale | variable | variable |

**Garde le moteur de règles.** Si un jour tu veux plus d'intelligence, le
prochain palier raisonnable est un **bot OpenAI/Render payant** (2 Go de RAM) —
pas un modèle local, car le coût d'hébergement dépasse alors le bénéfice.

## Vérifier avant de publier

```
python verifier_deploiement.py
```

Contrôle 22 points : variables d'environnement, absence de secret committé,
présence des fichiers nécessaires, poids du dépôt. Sortie attendue :
`PRÊT À PUBLIER`.

## Checklist de publication

- [ ] `python verifier_deploiement.py` → PRÊT À PUBLIER
- [ ] `node tests/run.js` → 47 vérifications, 0 échec
- [ ] Clé JSONBin créée sur jsonbin.io
- [ ] `JSONBIN_API_KEY` + `JSONBIN_BIN_ID` dans le dashboard Render
- [ ] UptimeRobot surveille `https://ton-url/health` (évite la mise en veille)
- [ ] Premier message envoyé → vérifie qu'il est bien sauvegardé
- [ ] Redéploie manuellement → vérifie que le message est toujours là
