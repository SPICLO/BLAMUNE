#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scan les fichiers SUIVIS par git pour detecter d'eventuelles vraies cles
API ou mots de passe laisses en clair.

Usage : python scripts/verifier_secrets.py
Retourne 0 si rien de suspect, 1 sinon.
"""
import os, re, subprocess, sys

P = os.path.dirname(os.path.abspath(__file__))
os.chdir(os.path.dirname(P))  # racine du projet

# Motifs de vrais secrets (non exhaustifs)
PATTERNS = [
    (r"sk-or-v1-[0-9a-f]{64}", "cle OpenRouter"),
    (r"gsk_[A-Za-z0-9]{40,}", "cle Groq"),
    (r"mstrl_[A-Za-z0-9_\-]{20,}", "cle Mistral"),
    (r"gnk-prx-[0-9a-f]{60,}", "cle Gonka"),
    (r"cfut_[A-Za-z0-9_\-]{40,}", "cle Cloudflare"),
    (r"eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+", "JWT / Qdrant API key"),
    (r"AQ\.Ab8RN[A-Za-z0-9_\-]{20,}", "cle Gemini"),
    (r"(?m)^\s*(?:export\s+)?VAPID_PRIVATE_KEY\s*=\s*[^\s]+", "cle VAPID privee"),
    (r"(?m)^\s*(?:export\s+)?ADMIN_MDP\s*=\s*[^\s]{8,}", "mot de passe admin en clair"),
]

# Fichiers a ignorer (documentation, exemples, ce script lui-meme)
IGNORE = {
    "verifier_deploiement.py",
    "verifier_secrets.py",
    ".env.example",
    "SECURITY.md",
    "README.md",
    "PRODUCT.md",
    "DESIGN.md",
    "CLOUD.md",
    "CONTRIBUTING.md",
}

try:
    suivis = subprocess.run(
        ["git", "ls-files"], capture_output=True, text=True, check=True
    ).stdout.split()
except Exception as e:
    print(f"Erreur git ls-files : {e}")
    sys.exit(1)

trouves = []
for x in suivis:
    if os.path.basename(x) in IGNORE:
        continue
    try:
        with open(x, encoding="utf-8", errors="ignore") as f:
            txt = f.read()
    except Exception:
        continue
    for motif, label in PATTERNS:
        for m in re.finditer(motif, txt):
            ligne = txt[: m.start()].count("\n") + 1
            trouves.append((x, ligne, label, m.group(0)[:20]))

if trouves:
    print("SECRETS DETECTES dans des fichiers suivis par git :\n")
    for f, ligne, label, valeur in trouves:
        print(f"  {f}:{ligne}  [{label}]  {valeur}...")
    print(f"\n{trouves.__len__()} secret(s) suspect(s). Nettoyer avant tout deploy.")
    sys.exit(1)
else:
    print("Aucun secret suspect detecte dans les fichiers suivis par git.")
    sys.exit(0)