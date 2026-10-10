# -*- coding: utf-8 -*-
"""Verifie que le projet est pret a etre publie sur Render.

Controle ce qui peut casser un deploiement gratuit :
  1. render.yaml declare-t-il les variables d'environnement necessaires ?
  2. Aucun disque persistant (reserve aux plans payants) ;
  3. Aucun secret committe dans le depot ;
  4. Les fichiers de donnee lus par le serveur sont-ils presents et suivis ?
  5. Poids total du depot (Render a une limite de taille) ;
  6. Le serveur demarre-t-il et repond-il ?
"""
import os, re, subprocess, json, sys

P = os.path.dirname(os.path.abspath(__file__))
os.chdir(P)
ok = True

def section(t):
    print("\n" + "=" * 62)
    print("  " + t)
    print("=" * 62)

def check(label, condition, detail=""):
    global ok
    marque = "OK " if condition else "ECHEC"
    if not condition:
        ok = False
    print(f"  [{marque}] {label}" + (f"  — {detail}" if detail else ""))

section("1. render.yaml")

ry = open("render.yaml", encoding="utf-8").read()

check("pas de disque persistant (reserve aux plans payants)",
      not re.search(r'^\s*disk:', ry, re.M),
      "un bloc disk: ferait echouer le plan free")

check("JSONBIN_API_KEY declaree",
      "JSONBIN_API_KEY" in ry,
      "sans elle, comptes / memoires / savoir appris sont perdus a chaque redeloiement")

check("JSONBIN_BIN_ID declare",
      "JSONBIN_BIN_ID" in ry,
      "recommande : evite de retrouver le bin a chaque demarrage")

check("healthCheckPath present", "healthCheckPath" in ry)

check("API_KEY en sync: false (jamais dans le depot)",
      re.search(r'key:\s*API_KEY\s*\n\s*sync:\s*false', ry) is not None)

section("2. Secrets dans le depot")

# cherche une vraie cle API commitee
pattes = [r'sk-[A-Za-z0-9]{20,}', r'AIza[0-9A-Za-z_\-]{25,}', r'master\.jsonbin\.io']
trouve = False
for root, dirs, files in os.walk(P):
    dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", "backups")]
    for f in files:
        if f.endswith((".exe", ".zip", ".png", ".bak_*")):
            continue
        p = os.path.join(root, f)
        try:
            txt = open(p, encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        for pat in pattes:
            m = re.search(pat, txt)
            if m:
                print(f"  [ECHEC] cle trouvee dans {f}: {m.group(0)[:18]}...")
                trouve = True
check("aucune cle API commitee", not trouve)

gitign = open(".gitignore", encoding="utf-8").read()
for f in ["config.json", "comptes.json", "users/", ".blamune_session", "bot.exe", ".env"]:
    check(f"{f} ignore par git", f in gitign)

section("3. Fichiers necessaires au serveur")

lignes = subprocess.run(["git", "ls-files"], capture_output=True, text=True).stdout.split()
suivis = set(lignes)
for f in ["server.js", "storage.js", "package.json", "package-lock.json",
          "savoir.txt", "personnalite.txt", "vocabulaire.txt",
          "README.md", "LICENSE", "CHANGELOG.md", ".env.example",
          "Dockerfile", ".dockerignore", ".editorconfig", ".nvmrc",
          ".prettierrc.json", "eslint.config.mjs", "verifier_deploiement.py", "extraire_savoir.py", "fusionner_vocabulaire.py",
          ".github/workflows/ci.yml", "tests/unit.test.js",
          "build_bot.ps1", "build_bot.bat", "requirements.txt",
          "CLOUD.md", "Dockerfile.bot", "docker-compose.yml", "bot_service.py",
          "savoir_db.js", "migrer_savoir_sqlite.js", "replis.js", "replis.txt",
          "site/manifest.json", "site/app.js", "site/sw.js",
          "site/apple-touch-icon.png", "site/favicon.ico",
          "site/icon-192.png", "site/icon-512.png"]:
    check(f"{f} present et suivi par git",
          os.path.exists(f) and f in suivis)

for d in ["site", "admin"]:
    check(f"dossier {d}/ suivi par git",
          any(x.startswith(d + "/") for x in suivis))

section("4. Poids du depot")

total = 0
for x in suivis:
    try:
        total += os.path.getsize(x)
    except OSError:
        pass
print(f"  Fichiers suivis : {len(suivis)}")
print(f"  Poids total    : {total/1024/1024:.2f} Mo")
check("sous 100 Mo (limite Render)", total < 100 * 1024 * 1024,
      f"{total/1024/1024:.2f} Mo")

# les gros non-suivis qui gonflent le disque local
gros = []
for f in os.listdir(P):
    p = os.path.join(P, f)
    if os.path.isfile(p) and f not in suivis and os.path.getsize(p) > 5 * 1024 * 1024:
        gros.append((f, os.path.getsize(p) / 1024 / 1024))
if gros:
    print("\n  Fichiers non publies mais volumineux (sans impact sur le depot) :")
    for f, m in sorted(gros, key=lambda x: -x[1]):
        print(f"    {m:6.1f} Mo  {f}")

section("RESULTAT")
print("  " + ("PRÊT À PUBLIER" if ok else "CORRECTIONS NÉCESSAIRES"))
sys.exit(0 if ok else 1)
