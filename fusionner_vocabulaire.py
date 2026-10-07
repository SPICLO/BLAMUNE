# -*- coding: utf-8 -*-
"""Fusionne les themes personas dans vocabulaire.txt (PAS dans savoir.txt).

Pourquoi vocabulaire.txt et pas savoir.txt ?

savoir.txt = ce que le bot AFFIRME. Une entree y est une reponse du bot, donc
elle doit etre vraie. On ne peut pas ecrire "le petanque est ... a propos de
petanque" : ce serait du remplissage, et le bot l'affirmerait a l'utilisateur.

vocabulaire.txt = les mots que le bot CONNAIT et peut utiliser comme sujet ou
complement quand il compose une phrase. C'est exactement la bonne place pour
14 000 themes issus des personas : ils rendent les phrases composees credibles
("le domino", "la belote") au lieu de reutiliser 100 fois les memes mots.

C'est aussi la solution au probleme de coherence qu'on a mesure : sur 30
messages sans contenu, 1 phrase absurde sur 13. Avec 14 000 vrais themes, le
composeur a enfin de la matiere.

Le script ne touche JAMAIS a savoir.txt.

Usage :
    python fusionner_vocabulaire.py            # rapport
    python fusionner_vocabulaire.py --ecrire   # ecrit vocabulaire_ajouts.txt
"""
import os, re, sys, unicodedata, collections

P = r"C:\Users\BENECHE\OneDrive\Documents\PROJET"
THEMES = os.path.join(P, "themes_manquants.txt")
SORTIE = os.path.join(P, "vocabulaire_ajouts.txt")
VOCAB = os.path.join(P, "vocabulaire.txt")

CAT = ["sport","nourriture","voyage","musique","culture","travail","sante",
       "personnalite","loisirs","intelligence","tech","quotidien","nature"]

def cle_norm(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s.lower())).strip()

def est_theme_valide(theme: str) -> bool:
    """Un vocabulaire.txt contient un mot ou une expression courte.

    cote composition (construirePhraseBloc) chaque ligne passe par
    categoriserMot() : seul un mot simple est utile comme sujet ou complement.

    En revanche phraseContientCle() sait matcher une cle de plusieurs mots, si
    la phrase du visiteur contient tous les mots de 4 lettres ou plus. Une
    expression de 3 mots sert donc quand le visiteur pose la question complete
    ("c'est quoi le jardinage potager").

    On garde donc les expressions de 2 a 3 mots : elles ne polluent pas le
    composeur (categoriserMot() ne les retient pas comme sujet) et elles
    permettent de reconnaitre une question formulee normalement."""
    t = theme.strip()
    if not t or len(t) > 45:
        return False
    interdits = set("\\" + chr(39) + chr(34) + chr(0x2014) + chr(0x2026) + ",")
    if any(c in interdits for c in t):
        return False
    mots = t.split()
    if not (1 <= len(mots) <= 3):
        return False
    # au moins un mot de 4 lettres et plus, sinon la cle n'est jamais testee
    return any(len(m) >= 4 for m in mots)

if __name__ == "__main__":
    ecrire = "--ecrire" in sys.argv
    if not os.path.exists(THEMES):
        print("themes_manquants.txt absent — lance d'abord : python extraire_savoir.py --ecrire")
        sys.exit(1)

    deja = set()
    for l in open(VOCAB, encoding="utf-8-sig").read().splitlines():
        if l.strip():
            deja.add(cle_norm(l.strip()))

    lignes = open(THEMES, encoding="utf-8").read().splitlines()
    stats = collections.Counter()
    retenus = []   # (theme, categorie, frequence)

    for l in lignes:
        # format du fichier : "<freq>  [<cat>]  <theme>" — pas de separateur |
        if l.startswith("#") or "[" not in l:
            continue
        # format : "<freq>  [<cat>]  <theme>" — le theme peut contenir des
        # espaces et des accents, on isole donc le bloc [cat] explicitement.
        m = re.match(r"\s*(\d+)\s+\[([\w?]*)\]\s+(.+)$", l)
        if not m:
            stats["lignes illisibles"] += 1
            continue
        freq, cat, theme = int(m.group(1)), m.group(2), m.group(3).strip()
        stats["themes analyses"] += 1
        if not est_theme_valide(theme):
            stats["refuses (expression trop longue)"] += 1
            continue
        k = cle_norm(theme)
        if k in deja:
            stats["deja dans vocabulaire"] += 1
            continue
        deja.add(k)
        retenus.append((theme, cat, freq))
        stats["retenus"] += 1

    print("=== statistiques ===")
    for k, v in stats.most_common():
        print(f"  {k:<34}{v:>8,}")
    par = collections.Counter(c for _, c, _ in retenus)
    print("\nrepartition par categorie :")
    for c in CAT:
        if par[c]:
            print(f"  {c:<14}{par[c]:>7,}")
    if par["?"]:
        print(f"  {'(non classe)':<14}{par['?']:>7,}")

    print(f"\n{n.retenus if False else len(retenus):,} nouveaux mots pour le vocabulaire")
    print("\nexemples :")
    for theme, cat, f in retenus[:12]:
        print(f"  {theme:<28} [{cat}]  (vu {f:,} fois)")

    if ecrire:
        with open(SORTIE, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("# Mots ajoutes a vocabulaire.txt depuis les personas francaises.\n")
            fh.write("# Un mot par ligne, sans ponctuation ni numero (format attendu).\n")
            for theme, cat, f in retenus:
                fh.write(theme + "\n")
        print(f"\necrit : {os.path.basename(SORTIE)} ({os.path.getsize(SORTIE)/1024:.0f} Ko)")
