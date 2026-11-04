# DESIGN.md — Système visuel « Nuit vivante » (BLAMUNE)

Monde commis pour la vitrine produit. Toute nouvelle surface BLAMUNE hérite de
ces décisions plutôt que d'inventer les siennes. _Direction verrouillée par
l'utilisateur le 2026-11-02 (« Nuit vivante » / logo « Lune-compagnon » /
animations vivantes mais discrètes)._

## 1. Le monde

- **Thèse** : on parle à la nuit ; chaque souvenir confié devient une perle
  que le compagnon garde pour toi. Le souvenir se démontre (démo jouée, perle
  qui change d'état), il ne s'énonce pas.
- **Interdits de famille** (hérités du contrat de direction) : kicker/eyebrow
  au-dessus des titres, texte en dégradé, hero à cartes-métriques, grilles de
  cartes égales comme squelette de page, tout chiffre/témoignage inventé.

## 2. Couleurs (tokens portés par `style.css`)

| Token                            | Valeur                            | Rôle                                                                   |
| -------------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| `--nuit-1`                       | `#060b1c`                         | fond nuit profonde (page entière, commis)                              |
| `--nuit-2`                       | `#0b1430`                         | étage supérieur du dégradé                                             |
| `--nuit-3`                       | `#101a38`                         | horizon bas (remonter vers l'aube)                                     |
| `--encre`                        | `#eef3ff`                         | texte principal (toujours teinté bleu, jamais gris)                    |
| `--encre-2`                      | `#a9bcd9`                         | texte secondaire (≥7:1 sur nuit-2)                                     |
| `--encre-3`                      | `#7e93b8`                         | métadonnées, légendes                                                  |
| `--champagne`                    | `#f3d5a3`                         | lumière de lune : CTA, perle, liens clés (encre foncée #241a06 dessus) |
| `--perle`                        | `#e2f4ff`                         | perle de souvenir (blanc-cyan)                                         |
| `--violet` / `--bleu` / `--cyan` | `#8b7cf6` / `#6a9ffa` / `#7de3f5` | voiles d'aurores uniquement (saturé réservé aux fonds cosmétiques)     |
| `--bord`                         | `rgba(233,240,255,.09)`           | une seule famille de bordures                                          |

Règle : la saturation vit dans le ciel (aurores) et dans la lumière champagne ;
les surfaces de lecture restent indigo désaturé.

## 3. Typographie

- **Voix unique : Bricolage Grotesque** (auto-hébergée `assets/fonts/`,
  latin + latin-ext, axes opsz/wdth/wght). Raison : grotesque dessinée pour
  l'esprit « bricolage » français — la main qui apprend à un ami — aucune autre
  face ne portait ce ton.
- Mesure de corps : 56–62 `ch`, 17px/1.65.
- Échelle : h1 display `clamp(3rem,7.4vw,5.6rem)` · tracked −0.03em, épaisseur
  620 ; accroche champagne 1.35–1.9rem/460 ; h2 sections
  `clamp(2.1rem,4.8vw,3.4rem)`; corps 1.02–1.13rem.

## 4. La perle vivante (symbole)

- **Amendment 2026-11-03 (décision utilisateur)** : les croissants de lune sont
  retirés de toute la surface ; le symbole de marque est **la perle vivante
  seule**.
- Perle blanche-cyan (`#ffffff → #e6f6ff → #9fd4f2`) sur halo nuit
  (perle/violet/champagne en fondue radiale), **anneau d'orbite champagne**
  incliné (-16°) qui passe derrière la sphère, vif blanc, trois
  scintillements (perle/champagne/bleu pâle).
- **Trois états gouvernés par `data-etat`** : `repos` (respiration lente,
  flottement), `reflechit` (tourbillon intérieur qui tourne), `ecrit`
  (halo qui pulse + scintillements en cascade).
- `#MiniPerle` (SVG inline dans index.html, défs partagées) est la source
  unique réutilisée via `<use>` par l'en-tête, l'avatar du tchat et le pied ;
  les états ne vivent que sur l'instance héros `#LaPerle`.
- Fichiers : `favicon.svg` (16–32px), `favicon.ico` (32px, raster à jour),
  `apple-touch-icon.png` (180px, fond nuit opaque), `logo-perle.svg` (plein).
- Anciens symboles supprimés : `logo-lune.svg` (croissant), visages de lune.

## 5. Mouvement

- Nuancier : `--ease-out cubic-bezier(.23,1,.32,1)` · `--ease-in-out
cubic-bezier(.77,0,.175,1)` · durée IHM 180ms · révélations 600–640ms.
- Tuiles autorisées (composite-only) : aurores (translate/scale 38–52s),
  scintillement d'étoiles (opacity), poussière-souvenirs (translate, 30–46s,
  opacité ≤ .6 — atmosphère du monde, PAS un indicateur d'état), respiration
  de la perle (scale 1.014/9s + flottement 7s), tourbillon intérieur quand
  elle réfléchit (2.8s linéaire), halo expressif à l'écriture (1.15s) et
  scintillements en cascade (1.5s, délais 0.18/0.36/0.54s).
- **Révélations fail-open** : contenu déjà dans la vue au chargement →
  double-`requestAnimationFrame` ; le reste → IntersectionObserver une fois.
  Aucune appellation ne peut laisser un élément invisible si le JS ne tourne pas.
- **`prefers-reduced-motion: reduce`** : aurores/étoiles/poussière figées,
  perle immobile (états visibles en statique : tourbillon affiché sans
  rotation, scintillements posés), révélations instantanées, démo typée en
  une seule fois.
- Sus au hover non filtré : tout `:hover` vivant sous
  `@media (hover:hover) and (pointer:fine)` ; pressions ≥ 120ms, scale .98.

## 6. La preuve (démo)

- Conversation d'examen étiquetée **« démo »**, jouée une fois, sans rejeu ;
  la perle suit les tours (`repos → reflechit → ecrit → repos`) et les
  pastilles « ce qu'il a noté » s'ajoutent **synchrones** avec les notations.
- Le carnet fonctionne réellement (filtre client, normalisation NFD des
  accents) — la démonstration ne mente jamais sur la mécanique qu'elle montre.

## 7. Provenance des actifs

- Polices : googlefonts/css2 téléchargées le 2026-11-02 dans `assets/fonts/`.
- Logos/favicons : `apple-touch-icon.png` (180px) et `favicon.ico` (32px)
  redessinés perle par canvas le 2026-11-03 ; `favicon.svg`/`logo-perle.svg`
  écrits le 2026-11-03.
- Anciens actifs supprimés : `logo-perle.svg` (v1 lien-perle), `logo.png`,
  `icon-192.png`, `logo-lune.svg` (croissant, retiré avec le symbole lune).
