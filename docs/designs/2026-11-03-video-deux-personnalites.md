# Design — Vidéo motion design « Deux personnalités » (BLAMUNE / EGO)

Date : 2026-11-03 · Média : Remotion (projet `motion-design/` existant)

## Intent et pourquoi

Montrer les **deux personnalités** du produit comme deux personnes distinctes :

- **BLAMUNE** — une personne **vraiment là pour toi** : présence, chaleur, mémoire,
  humeur visible. « Elle est là. Vraiment. »
- **EGO** — plus **distant**, comme une IA qui **vit sa propre vie** : il continue
  d'exister quand tu n'écris pas. « Il vit sa vie. »

Le moteur émotionnel : le contraste intimacy/altérité. C'est quand on voit EGO
s'absenter qu'on réalise que BLAMUNE, elle, reste.

## Goals / non-goals / anti-goals

- **Goals** : one maître 16:9 (~45 s, 1350 frames @30 fps) + une coupe 9:16
  (~20 s, 600 frames) ; chips texte en français ; rendus MP4 via le build
  Remotion existant.
- **Non-goals** : pas de voix off, pas de musique originale (muet ou une pièce
  libre), pas de foulage réel du produit (pas d'UI copy exacte).
- **Anti-goals** : ne pas transformer EGO en « froid hostile » ni BLAMUNE en
  « collant » ; ne pas contredire l'identité perle (cyan nocturne).

## Approches considérées

1. **Identique unifico perle, deux températures** _(choisi)_ — le même univers
   nocturne cyan ; BLAMUNE = halos chauds et proches, EGO = lumière froide
   désaturée, recadrée. Trade-off : moins de choc visuel, mais cohérent avec
   l'identité récente (les 6 derniers commits « perle »).
2. **Deux mondes opposés** (un charnel, un éthéré abstrait) — plus de contraste,
   mais il briserait l'unité de marque fraîchement posée.
3. Prolonger le teaser `BlamunePersona.tsx` (orange/rose) — écarté : palette
   contredit l'identité perle actée.

## Décisions prises par eux

- Sujet : les deux personnalités en contraste (leur formulation).
- Univers visuel : perle, deux déclinaisons d'ambiance (réponse « oui fait le »
  à la proposition par défaut).
- Formats : 16:9 ~45 s maître + coupe 9:16 ~20 s.

## Particularité apportée au builder

- Base technique : projet Remotion `motion-design/` (React 18, remotion 4).
- Nouveau composant recommandé : `src/BlamuneDeuxPersonnalites.tsx` (16:9) et
  version verticale dedans ou un composant à props (coupe 9:16).
- Palettes : s'appuyer sur les couleurs perle de `blamune-site/style.css` /
  `logo-perle.svg` (fond noir-bleu profond, cyan doux, blanc humain).
- `personnalite.txt` comme source de vérité des phrases d'ego/personnalité si
  quotes nécessaires.
- Structure narrée : Acte 1 BLAMUNE (présence, mémoire qui s'allume) →
  Acte 2 EGO (recul, dérive, sa propre vie) → Acte 3 convergence sur le
  clavier + logo perle + « BLAMUNE · EGO ».
- Reste au builder : timings précis scène par scène, easing, textures
  (grain, scanline) à dose légère.

## Suivi

- L'appréhension des timings se fait dans Remotion Studio, pas dans ce doc.
- Changement de périmètre (voix off, musique composée) → nouvelle discussion.
