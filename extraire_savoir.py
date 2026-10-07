# -*- coding: utf-8 -*-
"""Construit le vocabularye et des entrees de savoir.txt depuis les personas francaises.

Le jeu parquet contient des FICHES DE PERSONNES. Le champ exploitable est
"<theme>_list" : une liste de themes d'interet par personne.

  ['Tricot', 'Pétanque', 'Jardinage potager', 'Lecture de romans policiers']

Ce sont de VRAIS themes (15 495 distincts dans un seul fichier), contrairement
aux phrases de profil qui ne sont que des descriptions de vie. On normalise
(doublons Pétanque/pétanque, Lecture de/lecture de), on classe en 13
categories, et on produit :

  1. vocabulaire.txt        — les themes, pour que le composeur de phrases
                               dispose de sujets et de complements credibles
  2. themes.txt             — inventaire avec frequence (pour inspection)
  3. themes_manquants.txt   — ceux que le bot ne connait pas encore (a
                               enrichir a la main : on n'invente pas de faits)

RAM : lecture par row group (~17 000 lignes), jamais le fichier entier.
Usage :
    python extraire_savoir.py              # rapport
    python extraire_savoir.py --ecrire     # ecrit les 3 fichiers
"""
import pyarrow.parquet as pq
import glob, os, re, sys, collections, unicodedata

DOWNLOADS = r"C:\Users\BENECHE\Downloads"
P = r"C:\Users\BENECHE\OneDrive\Documents\PROJET"

CHAMPS_THEME = ["hobbies_and_interests_list", "skills_and_expertise_list"]
CAT = ["sport","nourriture","voyage","musique","culture","travail","sante",
       "personnalite","loisirs","intelligence","tech","quotidien","nature"]

CLASSIF = [
 (r"\b(?:kayak|randonn|cyclis|natation|padel|escalad|alpin|sport|course|marathon|foot|rugby|tennis|basket|nage|plong|ski|patin|velo|vtt|triathlon|pétanque|petanque|p[eé]tanque|bowling|tir a l'arc|sportif|gymnastique)\b", 0),
 (r"\b(?:cuisin|recette|resto|boulang|pâtiss|chocolat|caf[ée]|vin|bierre|fromage|l[ée]gume|viande|poisson|potage|mijot|rago|soupe|grillade|ap[ée]ritif|brunch|picnic|cuisine|traiteur|brasserie|barbecue)\b", 1),
 (r"\b(?:voyage|vacance|avion|itineran|h[ôo]tel|r[ée]sidenc|plage|montagn|oc[ée]an|camping|bivouac|destination|tourisme|[ée]tranger|visite|excursion|croisi[èe]re|road ?trip|s[ée]jour|escapade|guide touristique)\b", 2),
 (r"\b(?:musiqu|concert|chant|chorale|guitare|piano|violon|orchestre|chanson|album|vinyl|jazz|classique|rock|m[ée]tal|festival|karaok|harmonica|clavecin|accord[ée]on|balafon|op[ée]ra)\b", 3),
 (r"\b(?:roman|cin[ée]ma|film|s[ée]rie|th[ée][âa]tre|mus[ée]e|exposition|peinture|photograph|patrimoine|architecture|spectacle|biblioth[èe]que|presse|journal|revue|[ée]crivain|po[èe]sie|bande dessin|documentaire|m[ée]morial|art contemporain|th[ée][âa]tre)\b", 4),
 (r"\b(?:livre|lire|lisre|lecture|histoire|essai|BD )\b", 4),
 (r"\b(?:roman|cin[ée]ma|film|s[ée]rie|th[ée][âa]tre|mus[ée]e|exposition|peinture|photograph|histoire|patrimoine|architecture|spectacle|biblioth[èe]que|presse|journal|revue|[ée]crivain|po[èe]sie|bande dessin|documentaire|art contemporain|m[ée]morial)\b", 4),
 (r"\b(?:travail|emploi|m[ée]tier|profession|carri[èe]re|entreprise|bureau|coll[èe]gue|patron|r[ée]union|projet|formation|[ée]cole|universit|[ée]tudiant|retrait|ch[ôo]meur|artisan|commer[çc]ant|benevole|associat|syndicat|stage|apprentissage|professionnel|ben[ée]v[ée]at)\b", 5),
 (r"\b(?:sant[ée]|m[ée]decin|h[ôo]pital|sommeil|nutrition|di[ée]t|exercice|yoga|pilates|th[ée]rapie|soin|psycholog|v[ée]t[ée]rinaire|dentiste|bien-[êe]tre|m[ée]ditation|marche)\b", 6),
 (r"\b(?:personnalit[ée]|caract[èe]re|temp[ée]rament|empath|introvert|extravert|gentil|curieux|cr[ée]atif|rigide|sociable|r[ée]serv[ée]|confiance en soi)\b", 7),
 (r"\b(?:loisir|hobby|passion|jeu|bricolage|jardinage|tricot|couture|poterie|mod[ée]lisme|collection|p[êe]che|chasse|mot crois|belote|scrabble|cartes|puzzle|marqueterie|vitrail|broderie|feutre|sculpture|atelier|crochet|origami|m[ée]dailles|philat[ée]lie|genealogie)\b", 8),
 (r"\b(?:apprendre|connaissance|savoir|r[ée]flexi|intellect|curiosit[ée]|aphorisme|citation|philosoph|logique|raisonnement|essai|linguistique)\b", 9),
 (r"\b(?:informatique|ordinateur|logiciel|application|smartphone|t[ée]l[ée]phone|internet|informatique|montage vid[ée]o|photo num[ée]rique|r[ée]seau|cybers[ée]curit[ée]|donn[ée]e|blog|podcast|streaming|linux|python|programmation|developpement web)\b", 10),
 (r"\b(?:quotidien|maison|appartement|m[ée]nage|lessive|courses|voiture|transport|voisin|quartier|d[ée]coration|market|magasin|commer[çc]ant|r[ée]novation|tri |recyclage)\b", 11),
 (r"\b(?:nature|for[êe]t|montagn|oc[ée]an|rivi[èe]re|lac|campagne|animal|oiseau|chiens|chat|v[ée]g[ée]tal|[ée]cologie|biodiversit[ée]|m[ée]t[ée]o|jardin (public|botanique)|balade|s[ée]same)\b", 12),
]

def classer(t: str) -> int:
    for pat, cat in CLASSIF:
        if re.search(pat, t, re.I):
            return cat
    return -1

def libelle_propre(s: str) -> str:
    """Corrige les libelles tout en majuscules issus du jeu de donnees
    ("ART CONTEMPORAIN" -> "Art contemporain"). Ne touche qu'aux titres
    entierement en majuscules, pour ne pas casser les sigles (GMAO, HACCP)."""
    lettres = [c for c in s if c.isalpha()]
    if lettres and sum(1 for c in lettres if c.isupper()) / len(lettres) > 0.9:
        mots = s.split()
        if not any(len(m) <= 5 and m.isupper() for m in mots):  # pas de sigle
            s = s.capitalize()
    return s

def cle_norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s.lower())).strip()

def est_propre(s: str) -> bool:
    s = s.strip()
    if not (3 <= len(s) <= 55):
        return False
    if len(s.split()) > 4:
        return False
    if any(c in s for c in "'\"—…"):
        return False
    if s.endswith((",", ".")):
        return False
    # Les listes du jeu de donnees contiennent des apostrophes simples non
    # echappees : un item peut se retrouver coupe ("Animation d\\", "Visite
    # d\\"). Ces residus ne sont pas des themes, on les jette.
    if "\\" in s or s.endswith("d") and len(s.split()[-1]) <= 2:
        return False
    if not any(len(m) >= 4 for m in s.split()):
        return False
    return True

if __name__ == "__main__":
    ecrire = "--ecrire" in sys.argv
    fichiers = sorted(glob.glob(os.path.join(DOWNLOADS, "*.parquet")))
    themes = {}   # cle norm -> [affichage le plus frequent, count]
    stats = collections.Counter()

    for f in fichiers:
        pf = pq.ParquetFile(f)
        for rg in range(pf.metadata.num_row_groups):
            t = pf.read_row_group(rg, columns=CHAMPS_THEME)
            d = t.to_pydict()
            stats["personas lus"] += t.num_rows
            for c in CHAMPS_THEME:
                for val in d[c]:
                    if not val: continue
                    for item in re.findall(r"['\"]([^'\"]{2,60})['\"]", val):
                        item = item.strip()
                        stats["themes bruts"] += 1
                        if not est_propre(item):
                            stats["rejetes (format)"] += 1
                            continue
                        k = cle_norm(item)
                        if len(k) < 4:
                            stats["rejetes (trop court)"] += 1
                            continue
                        item = libelle_propre(item)
                        if k in themes:
                            themes[k][1] += 1
                            # garde la variante la plus frequente / la plus propre
                            if item[0].isupper() and not themes[k][0][0].isupper():
                                themes[k][0] = item
                        else:
                            themes[k] = [item, 1]
                        stats["themes valides"] += 1
            del t, d
            if not ecrire and stats["personas lus"] > 30000:
                break

    print("=== statistiques ===")
    for k, v in stats.most_common():
        print(f"  {k:<26} {v:>9,}")
    print(f"\nthemes distincts retenus : {len(themes):,}")

    par_cat = collections.Counter()
    for k, (aff, c) in themes.items():
        cat = classer(aff)
        if cat >= 0: par_cat[cat] += 1
        else: par_cat[-1] += 1
    print("\nrepartition par categorie :")
    for c in range(13):
        if par_cat[c]:
            print(f"  {CAT[c]:<14}{par_cat[c]:>7,}")
    print(f"  {'(non classe)':<14}{par_cat[-1]:>7,}")

    # ce que le bot connait deja
    deja = set()
    for l in open(os.path.join(P, "savoir.txt"), encoding="utf-8-sig").read().splitlines():
        if "|" in l:
            deja.add(cle_norm(l.split("|")[0]))
    for l in open(os.path.join(P, "vocabulaire.txt"), encoding="utf-8-sig").read().splitlines():
        if l.strip():
            deja.add(cle_norm(l))
    manquants = [(k, v) for k, v in themes.items() if v[1] >= 3 and k not in deja]
    print(f"\ndeja connus par le bot      : {len(themes) - len(manquants):,}")
    print(f"nouveaux (frequence >= 3)   : {len(manquants):,}")

    if ecrire:
        with open(os.path.join(P, "themes.txt"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write("# Inventaire des themes extraits des personas : frequence + libelle\n")
            for k, (aff, c) in sorted(themes.items(), key=lambda x: -x[1][1]):
                fh.write(f"{c:>6}  [{CAT[classer(aff)] if classer(aff)>=0 else '?'}]  {aff}\n")
        with open(os.path.join(P, "themes_manquants.txt"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write("# Themes frequents que le bot ne connait pas encore.\n")
            fh.write("# A enrichir a la main dans savoir.txt : on n'invente pas de faits.\n")
            for k, (aff, c) in sorted(manquants, key=lambda x: -x[1][1]):
                cat = classer(aff)
                fh.write(f"{c:>6}  [{CAT[cat] if cat>=0 else '?'}]  {aff}\n")
        print("\necrit : themes.txt, themes_manquants.txt")
