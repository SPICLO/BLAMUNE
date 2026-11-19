# Contexte et consommation de tokens

Ce document décrit la fenêtre de contexte envoyée au modèle et la mesure de
la consommation. Il complète `MOBILE.md` (publication) et `CLOUD.md`
(hébergement).

## Le problème

La fenêtre était comptée en **messages** (`HISTO_API_MAX = 10`), jamais en
tokens. Dix messages courts valent ~300 tokens ; dix messages denses en
valent 6 000. Avec un plafond TPM (Groq gratuit : 8 000 tokens/min, Gemini
gratuit du même ordre), un seul message en pic déclenchait un 429, puis les
replis (modèles Gemini en cascade, puis membres du pool) **re-facturaient le
même prompt** 3 à 6 fois.

## Ce qui a changé

### 1. Fenêtre par budget de tokens — `lib/tokens.js`

| Réglage                    | Valeur | Rôle                                  |
| -------------------------- | ------ | ------------------------------------- |
| `BUDGET_ENTREE_TOKENS`     | 5 000  | budget d'entrée d'une requête normale |
| `BUDGET_ENTREE_ECO_TOKENS` | 3 000  | budget sous tension (mode éco)        |
| `MESSAGE_MAX_CAR`          | 12 000 | un seul message au-delà est tronqué   |

Règles appliquées par `choisirFenetre()` :

1. les messages **système** sont toujours conservés (persona, mémoire,
   résumé, sources web) ;
2. on empile depuis la fin jusqu'au budget ;
3. la conversation commence par un tour utilisateur ;
4. le message courant est toujours gardé, tronqué s'il est démesuré.

L'estimation est volontairement prudente : ~3,6 caractères par token en
français, 1 token par caractère CJK. Ce n'est pas un tokenizer exact — c'est
un garde-fou de plafond, et la mesure réelle est faite en parallèle (ci-dessous).

### 2. Bloc web plafonné — `lib/recherche_web.js`

| Constante                       | Avant       | Après      |
| ------------------------------- | ----------- | ---------- |
| `BLOC_MAX` (bloc injecté)       | 14 000 car. | 4 000 car. |
| `PAGE_TXT_MAX` (texte par page) | 6 000 car.  | 1 800 car. |
| pages lues par `/cherche`       | 4           | 2          |

Le bloc web était le principal pic : ≈ 3 900 tokens ramenés à ≈ 1 100, sans
perte de fiabilité (au-delà, le modèle noie les faits utiles).

### 3. Mesure réelle — `lib/compteur_tokens.js`

- `usage` (OpenAI-compatible) et `usageMetadata` (Gemini) sont lus, plus
  jetés ;
- fenêtre glissante de **60 s** par utilisateur + **totaux du jour** ;
- tâches de fond (résumé, extraction) comptées sous l'identifiant `fond` ;
- aucune écriture disque : instrument de bord en RAM, remis à zéro au
  redémarrage (comme les compteurs de 429).

Où lire les chiffres :

- `GET /stats` (admin) → champ `tokens` ;
- `GET /health` (admin) → champ `tokens` ;
- ligne `:diag` de chaque réponse en flux :
  `tokens=1234/88`. Un `~` devant les nombres signale une **estimation**
  (le fournisseur n'a pas renvoyé d'usage) ;
- champ `cache` (fenêtre, jour, total), présent **uniquement** si un
  fournisseur signale des tokens d'entrée servis par le cache de prompt ;
  `:diag` ajoute alors `cachePrompt=N`.

`USAGE_STREAM=1` ajoute `stream_options.include_usage` aux appels en flux :
on mesure alors les réponses en streaming. À n'activer que si tous les
fournisseurs du pool l'acceptent (certains proxys répondent 400).

### 4. Repli sans repayer — `server.js`, `lib/ia/openai.js`

Un 429 « tokens/minute » (TPM/TPD) ne rejoue plus le même payload. Le
transport reconnaît la nature du refus (`estQuotaTokens`) et **réduit la
fenêtre avant de réessayer** :

| Étape              | Budget d'entrée      | Bloc web |
| ------------------ | -------------------- | -------- |
| requête initiale   | 5 000 (3 000 en éco) | inclus   |
| 1er refus de quota | 3 000                | retiré   |
| 2e refus de quota  | 1 800                | retiré   |
| plancher           | 1 200                | —        |

- **deux réductions au maximum** par message, puis plus rien n'est sacrifié
  (le modèle perdrait la question elle-même) ;
- le **même modèle** est retenté une fois avec la fenêtre réduite — sans
  cela, une installation mono-modèle transformait un simple quota en
  « problème technique » ;
- les modèles suivants et les membres du pool reçoivent la fenêtre **déjà
  réduite** (le pilier de secours repart du budget courant, il ne
  reconstruit pas le gros prompt) ;
- un 429 « requêtes/minute » (RPM) sur une requête déjà petite ne coupe
  **rien** : cela ne changerait pas le refus ;
- le chemin Gemini et le chemin OpenAI-compatible appliquent la même
  politique.

La ligne `:diag` expose `reduit=N` (nombre de réductions faites pour ce
message) : un `reduit=2` répété signale un fournisseur qui refuse
régulièrement la taille envoyée.

### 5. Persona compressée — `lib/persona.js`

La persona est le premier bloc du prompt système : elle part à **chaque
message**. Elle pesait 4 452 caractères (~1 240 tokens), soit près d'un
quart de la fenêtre pour une conversation de deux échanges. Elle tient
désormais en 2 452 caractères (~680 tokens), **−45 %**, sans perdre de
règle de comportement.

| Bloc                 | Avant      | Après        |
| -------------------- | ---------- | ------------ |
| Persona (texte fixe) | 4 452 car. | 2 452 car.   |
| Tokens estimés       | ≈ 1 240    | ≈ 680        |
| Gain par message     | —          | ≈ 560 tokens |

Ce qui a été retiré, ce sont les **redites** : trois formulations de la
même consigne d'identité, deux de la brièveté, deux listes qui disaient la
même chose sur la lecture du message. Ce qui a été conservé, mot pour mot
quand il compte : créateur = BLAMUNE, mise en ligne juillet 2026, année
toujours écrite en entier, aucun nom de modèle, rythme des réflexions,
honnêteté (« Je sais pas »), ton.

La persona est aussi un **préfixe stable** pour le prompt-cache des
fournisseurs (les tokens cachés ne comptent pas dans les plafonds
RPM/TPM) : elle ne contient ni heure ni état, ajoutés après par
`blocSysteme`.

Invariants verrouillés par `tests/persona.test.js` : budget de 2 600
caractères, titres `LANGUES` et `CONSCIENCE DE SOI` présents une seule
fois (le second distingue le mode BLAMUNE du mode EGO), et texte
identique d'un appel à l'autre.

### 6. Résumé de conversation borné — `lib/resume.js`

Le résumé est injecté à **chaque** message (`CE QUE VOUS AVIEZ DIT
AVANT`). Il était demandé en « 60 mots, compléter sans rien perdre » :
au fil des replis, le modèle collait le nouveau bloc à l'ancien, et le
résumé devenait une liste de redites qui grossissait sans jamais se
réorganiser. Il est maintenant demandé en **réécriture complète** sur
quatre lignes fixes — `QUI`, `FIL`, `PROMIS`, `TON` —, 140 mots, avec
un **plafond dur de 1 100 caractères** appliqué à l'écriture, troncature
` [...]` comprise.

| Déclencheur                    | Avant                   | Après                      |
| ------------------------------ | ----------------------- | -------------------------- |
| Nombre d'échanges non couverts | 10                      | 10 (inchangé)              |
| Volume non couvert             | —                       | 3 000 caractères           |
| Bloc replié par appel          | 10                      | 20                         |
| Taille du résumé injecté       | ≈ 400 car. (~80 tokens) | ≤ 1 100 car. (~300 tokens) |

Le déclencheur de volume rattrape les conversations où quatre messages
très longs sortent de la fenêtre avant le dixième échange. Le bloc de 20
évite de repayer un appel pour 10 échanges de plus.

**Écart de coût assumé** : au repos, le résumé coûte ~200 tokens de plus
par message qu'avant. C'est le prix d'une mémoire qui reste lisible et
stable sur une longue conversation — et il reste borné, ce que l'ancien
format ne garantissait pas. Il n'est payé que par les conversations qui
ont déjà dépassé 10 échanges.

Invariants verrouillés par `tests/lib.test.js` : déclencheur de volume,
bloc borné à 20, plafond de 1 100 caractères, prompt structuré et
réécriture (pas d'ajout bout à bout).

### 7. Élagage des vieux messages — `lib/tokens.js`

Les trois dernières réponses de BLAMUNE partent **verbatim** : ce sont
elles qui portent le fil. Au-delà, une réponse est coupée à
`HISTO_ELAGUE_CAR = 400` caractères (` [...]`), jamais un message
utilisateur : les mots de la personne restent intacts.

L'élagage se fait **avant** le calcul du budget, pas après. Ce qui est
libéré profite donc à des messages plus utiles au lieu de rester en
réserve. Mesure sur une conversation dense (30 échanges, réponses de
~1 200 caractères, budget de 5 000 tokens) :

| Fenêtre                        | Messages envoyés | Tokens |
| ------------------------------ | ---------------- | ------ |
| Sans élagage                   | 19               | 4 795  |
| Avec élagage (3 tours intacts) | **37**           | 4 900  |

À budget égal, la profondeur d'historique envoyée **double**. C'est ce
qui permet au modèle de retrouver un détail d'il y a vingt messages sans
payer 2 000 caractères de vieilles réponses.

Aucune mutation : l'historique relu du disque n'est jamais modifié, les
messages élagués sont des copies (`tests/tokens.test.js`).

### 8. Plafond de sortie adaptatif — `lib/tokens.js`

`API_MAX_TOKENS` (1 024 par défaut, 512 dans `.env.example`) était
envoyé à **chaque** appel, alors que le prompt impose « 1 à 3 phrases ».
Le plafond suit maintenant la demande :

| Demande                                                             | Plafond          |
| ------------------------------------------------------------------- | ---------------- |
| Chat du quotidien (`salut`, `ça va ?`)                              | **384**          |
| Développement (`explique`, `liste`, `compare`, question > 600 car.) | **768**          |
| Livrable (`écris`, `traduis`, `code`, `poème`, bloc ` ``` `)        | `API_MAX_TOKENS` |

Détection insensible aux accents et à la casse, côté Gemini
(`maxOutputTokens`) comme côté OpenAI-compatible (`max_tokens`). Un faux
positif ne coûte rien — le modèle s'arrête tout seul bien avant le
plafond ; c'est pourquoi la détection penche du côté généreux.
`API_MAX_TOKENS` reste un **maximum** : `API_MAX_TOKENS=100` baisse tout,
jamais l'inverse.

Gain réel : ce n'est pas la réponse moyenne qui change, c'est le **pire
cas**. Une génération qui dérive (liste de 40 films, monologue) coûtait
jusqu'à 1 024 tokens ; elle est maintenant coupée à 384 en conversation
courante, soit ~600 tokens de moins sur le message.

### 9. Cache de prompt — `systemInstruction` (`lib/ia/gemini.js`)

Tout le bloc système (persona, état, profil, sources web) était **collé en
tête du premier message utilisateur**. Gemini le relisait donc comme une
conversation ordinaire : le préfixe n'était pas celui qu'il met en cache,
et un changement d'état ou de sources modifiait le message lui-même.

Le bloc part maintenant dans `systemInstruction`, le champ prévu pour les
instructions stables. Gemini le traite comme un préfixe à part, mis en
cache de façon implicite (seuil ~1 024 tokens) et **jamais confondu avec
ce que dit la personne**. Les blocs système multiples sont joints dans un
seul texte ; les tours `user/model` restent intacts.

Repli : si un modèle ou un proxy refuse le champ (400 nommant
`systemInstruction`), on revient à l'ancienne forme — texte recollé en
tête du premier message utilisateur — et on n'essaie plus, comme pour
`tools` et `thinkingConfig`. La conversation ne casse pas.

Mesure : `cachedContentTokenCount` (Gemini) et
`prompt_tokens_details.cached_tokens` (compatibles OpenAI) alimentent
`usage.cache`, cumulé dans le compteur et exposé par `/stats` et `/health`
**seulement quand il est non nul** (la forme des mesures ne change pas pour
un fournisseur muet). `:diag` ajoute `cachePrompt=N` dans ce cas — le
`cache=` existant désigne, lui, le cache de réponses.

Honnêteté sur le gain : le cache implicite de Gemini est automatique et
non garanti ; on ne peut pas le forcer sans créer un objet `cachedContent`
payant avec son propre TTL. Ce changement **fiabilise le préfixe**, il ne
promet pas un hit. La preuve est dans `cachePrompt`, pas dans une
estimation. Invariants verrouillés par `tests/tokens.test.js`.

## Ordres de grandeur

Mesure sur un profil réaliste (messages longs) :

| Scénario                              | Avant          | Après               |
| ------------------------------------- | -------------- | ------------------- |
| Chat court (messages de ~100 car.)    | ≈ 1 800 tokens | ≈ 1 300             |
| Conversation dense (réponses longues) | ≈ 8 000–12 000 | **≈ 5 000 au plus** |
| Tour avec recherche web               | ≈ 8 700        | ≈ 3 850             |
| Mode éco, conversation dense          | ≈ 3 600+       | ≈ 3 000 au plus     |
| Bloc web seul                         | ≈ 3 900        | ≈ 1 100             |

Le budget ne change rien aux conversations courtes : il coupe uniquement
ce qui dépassait. Le gain réel est double — des pics divisés par deux, et
surtout un **plafond prévisible** au lieu d'une taille qui dépendait de la
longueur des réponses précédentes.

## Réglages

Dans `.env` (ou le dashboard Render) :

```ini
# Budget d'entrée par requête (tokens estimés)
BUDGET_ENTREE_TOKENS=5000
BUDGET_ENTREE_ECO_TOKENS=3000
# Élagage des vieilles réponses de BLAMUNE (3 tours intacts, 400 car.)
# HISTO_ELAGUE_TOURS=3
# HISTO_ELAGUE_CAR=400
# Mesure des réponses en flux (opt-in)
USAGE_STREAM=1
```

Repères : descendre à 3 500 / 2 000 si les 429 restent fréquents ; monter à
6 000 / 4 000 si les réponses perdent le fil sur les très longs échanges.

## Ce qui reste à faire

La feuille de route de consommation est terminée : budget d'entrée, repli
sans repayer, persona compressée, résumé borné, élagage, plafond de sortie
et cache de prompt. Les pistes suivantes ne sont pas planifiées :

1. **Cache explicite** (`cachedContent`) : seul moyen de _garantir_ un
   cache, au prix d'un objet à créer, d'un TTL à gérer et d'une facture de
   stockage. À envisager seulement si `cachePrompt` reste à zéro sur de
   gros volumes.
2. **Réduire le bloc « état »** : il change à chaque tour et casse le
   préfixe caché au-delà de la persona ; le sortir du préfixe stable
   rendrait le cache plus fréquent.
