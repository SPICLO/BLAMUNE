# -*- coding: utf-8 -*-
"""Verifie que le projet est pret a etre publie sur Render.

Controle ce qui peut casser un deploiement gratuit :
  1. render.yaml declare-t-il les variables d'environnement necessaires ?
  2. Aucun disque persistant (reserve aux plans payants) ;
  3. Aucun secret committe dans le depot ;
  4. Les fichiers necessaires au serveur sont-ils presents et suivis ?
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

# Liste des fichiers SUIVIS par git, calculee une seule fois et reutilisee
# par les sections suivantes (les secrets, les fichiers attendus, le poids).
SUIVIS = set(subprocess.run(["git", "ls-files"],
                           capture_output=True, text=True).stdout.split())

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

# Mots de passe administrateur qui auraient pu etre laisses en clair.
# Historique : ADMIN_MDP n'existait pas et le compte admin etait cree avec
# un mot de passe ecrit en dur dans server.js. Le depot etant public, ce
# mot de passe donnait l'administration de toute instance deployee depuis
# ce depot. Le serveur genere maintenant un mot de passe aleatoire quand
# ADMIN_MDP est absente.
ANCIENS_MDP_ADMIN = ["@" + "clotaire" + "#2012", "clo" + "taire"]
# Ce fichier se declare lui-meme exclu : il doit pouvoir nommer le secret
# qu il interdit, sinon le controle se detecterait lui-meme.
FICHiers_A_EXCLURE = {"verifier_deploiement.py"}
for secret in ANCIENS_MDP_ADMIN:
    trouves = []
    for x in SUIVIS:
        if os.path.basename(x) in FICHiers_A_EXCLURE:
            continue
        try:
            txt = open(x, encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        if secret in txt:
            trouves.append(x)
    check(f"aucun mot de passe admin en clair ({secret[:9]}...)",
          not trouves,
          "present dans " + ", ".join(trouves) if trouves else
          "le serveur genere un mot de passe si ADMIN_MDP est absente")

# ADMIN_MDP doit etre declaree et jamais synchronisee depuis le depot.
check("render.yaml declare ADMIN_MDP en sync: false",
      re.search(r'key:\s*ADMIN_MDP\s*\n\s*sync:\s*false', ry) is not None,
      "la valeur doit venir du dashboard Render, jamais du depot")
check(".env.example documente ADMIN_MDP",
      "ADMIN_MDP" in open(".env.example", encoding="utf-8").read())

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

# Donnees d'un poste de travail : memoire.txt/profil.txt racine ne servent
# qu'au repli hors ligne (le bot les recree), et les brouillons enrichir_lot*
# ne sont lus par aucun code. Les versionner publiait des donnees de test.
for f in ["memoire.txt", "profil.txt", "enrichir_lot1.txt", "enrichir_lot2.txt"]:
    check(f"{f} non suivi par git", f not in SUIVIS,
          "contient des donnees locales, pas de code")
    # enrichir_lot1.txt et enrichir_lot2.txt sont couverts par un seul motif.
    motif = re.sub(r"enrichir_lot\d", "enrichir_lot*", f)
    check(f"{f} ignore par git", motif in gitign)

# Contraire : vocabulaire_partage.txt DOIT rester versionne, Dockerfile.bot
# le copie dans l'image. Le retirer ferait echouer docker compose build.
check("vocabulaire_partage.txt reste suivi par git",
      "vocabulaire_partage.txt" in SUIVIS,
      "Dockerfile.bot fait COPY de ce fichier : absent, le build echoue")
check("Dockerfile.bot copie vocabulaire_partage.txt",
      "COPY vocabulaire_partage.txt" in open("Dockerfile.bot", encoding="utf-8").read())

section("3. Fichiers necessaires au serveur")

for f in ["server.js", "storage.js", "package.json", "package-lock.json",
          "savoir.txt", "personnalite.txt", "vocabulaire.txt",
          "README.md", "LICENSE", "CHANGELOG.md", ".env.example",
          "Dockerfile", ".dockerignore", ".editorconfig", ".nvmrc",
          ".prettierrc.json", "eslint.config.mjs", "verifier_deploiement.py", "extraire_savoir.py", "fusionner_vocabulaire.py",
          ".github/workflows/ci.yml", "tests/unit.test.js", "tests/bot_service.test.py",
          "tests/lib.test.js", "tests/routes_smoke.test.js",
          "lib/rate_limit.js", "lib/memoire.js", "lib/historique.js", "lib/resume.js",
          "lib/config_ia.js",
          "lib/routes/compte.js", "lib/routes/admin.js",
          "lib/routes/consultation.js", "lib/routes/statique.js",
          "lib/routes/push.js", "lib/routes/send.js", "lib/ia/gemini.js",
          "lib/keepalive.js", "lib/pool_ia.js", "lib/qdrant_faits.js",
          "lib/compression.js", "lib/auto_apprentissage.js", "lib/push.js",
          "scripts/generer_cles_push.js",
          "tests/pool_ia.test.js", "tests/qdrant_faits.test.js",
          ".github/workflows/keepalive.yml",
          ".github/dependabot.yml", "SECURITY.md", "CONTRIBUTING.md",
          ".prettierignore",
          "build_bot.ps1", "build_bot.bat", "requirements.txt",
          "CLOUD.md", "Dockerfile.bot", "docker-compose.yml", "bot_service.py",
          "savoir_db.js", "migrer_savoir_sqlite.js", "replis.js", "replis.txt",
          "site/manifest.json", "site/app.js", "site/sw.js",
          "site/apple-touch-icon.png", "site/favicon.ico",
          "site/icon-192.png", "site/icon-512.png"]:
    check(f"{f} present et suivi par git",
          os.path.exists(f) and f in SUIVIS)

for d in ["site", "admin", "lib"]:
    check(f"dossier {d}/ suivi par git",
          any(x.startswith(d + "/") for x in SUIVIS))

# Compression des reponses : quatre non-regressions a garder en vie.
#   - la zlib integree seule (zero dependance npm ajoutee) ;
#   - l'installation reelle dans server.js (sans elle, tout part en
#     texte brut : 6,7 Mo pour le bundle IA) ;
#   - les assets publics restent exclus du no-store global : sinon les
#     navigateurs ne gardent aucun fichier en cache ET le cache RAM du
#     serveur reste vide, et chaque visite re-telecharge tout ;
#   - le flux SSE passe sans transformation (comprimer un flux le
#     retarderait morceau par morceau, jusqu'a un faux "plus rien"). 
compjs = open("lib/compression.js", encoding="utf-8").read()
srv = open("server.js", encoding="utf-8").read()
check("lib/compression.js comprime avec la zlib integree",
      "createGzip" in compjs and "createBrotliCompress" in compjs
      and "require('zlib')" in compjs,
      "brotli + gzip via node:zlib, sans dependance npm")
check("server.js installe la compression des reponses",
      "creerCompression" in srv)
check("server.js tient les assets hors du no-store global",
      "ASSETS_PUBLICS_RE" in srv and "if (!assetPublic)" in srv,
      "un no-store inconditionnel remettrait chaque visite a " "re-telecharger chaque fichier, cache RAM compris")
check("lib/compression.js laisse passer le flux SSE",
      "event-stream" in compjs,
      "comprimer un flux SSE le retarderait morceau par morceau")

# Sprint D : Express 5 et l'auto-apprentissage extrait. Si Express
# repassait en 4, le depot compilerait avec le wildcard v4 app.get('*')
# qui fait planter le demarrage en Express 5 ; a l'inverse, un retour
# a l'ancien code rendrait impossible le check exprime sur la syntaxe
# v8. Et l'auto-apprentissage hors de server.js est ce qui rend
# possible ses tests unitaires (sans fabrique injectable, aucun cas
# dedie ne peut tourner sans demarrer le serveur entier).
stq = open("lib/routes/statique.js", encoding="utf-8").read()
pkgj = open("package.json", encoding="utf-8").read()
aap = open("lib/auto_apprentissage.js", encoding="utf-8").read()

check("express 5 declare comme dependance de production",
      '"express": "^5.' in pkgj,
      "express 4.x nest plus maintenu ; la migration majeure est faite")

check("les wildcards Express sont nommes (/*splat, jamais * nu)",
      "'/*splat'" in stq and "app.get('*'" not in stq,
      "Express 5 refuse le wildcard nu au demarrage : path-to-regexp v8")

check("la racine a sa route explicite (un /*splat ne couvre pas /)",
      "app.get('/'," in stq,
      "sans elle, la page daccueil devient un 404 sous Express 5")

check("l auto-apprentissage vit dans lib/, plus dans server.js",
      "creerAutoApprentissage" in srv and "function autoApprentissage(" not in srv,
      "la plus grosse fonction du serveur est desormais un module injectable")

check("l apprentissage immediat ecrit aussi dans le savoir",
      "savoirEnregistrer" in aap,
      "\"retiens que tokyo est la capitale du japon\" reste un fait persistent")

check("le filet req.body (express 5 / body-parser 2.x) est en place",
      "if (req.body === undefined) req.body = {};" in srv,
      "v5 ne fournit plus req.body = {} : /register et /login partaient en 500 sans corps")

# Sprint E, etape 2 : la recherche d'historique. Son interet entier est de
# trouver au-dela des dernieres bulles affichees (le fil normal fige le DOM a
# HISTO_AFFICHAGE_MAX) : si un jour l'implementation repart du fil tronque,
# il ne reste qu'un faux moteur de recherche — c'est ce que ce check empeche.
rechjs = open("lib/recherche.js", encoding="utf-8").read()
consjs = open("lib/routes/consultation.js", encoding="utf-8").read()
check("la recherche d historique passe par ?q= via un module testable",
      "filtrerHistorique" in consjs and "filtrerHistorique" in rechjs,
      "l'archive entiere est fouillee, insensible aux accents et a la casse")

# Sprint E, etape 3 : l'etat interieur de BLAMUNE (humeur commandee, ce
# qu'elle a note de l'utilisateur, promesses) doit sortir du coffre — il est
# desormais dans /stats-perso (bloc blamune), consommable par la pastille.
check("l etat interieur de BLAMUNE est expose par /stats-perso",
      "blamune: {" in consjs and "humeurUser" in consjs and "promesses" in consjs,
      "la memoire emotionnelle est visible, pas enfermee dans le profil")

# Sprint E, etape 4 : Web Push. Trois garanties independantes :
#   1. la crypto vit dans lib/ SANS dependance npm (VAPID + aes128gcm) —
#      pas de moment ou un paquet externe aurait la main sur les cles ;
#   2. le service worker sait recevoir ET faire son travail au clic —
#      sinon la notification arrive dans le vide ;
#   3. le 410 du service purge l'abonnement — sinon le serveur retente
#      un abonnement mort a chaque vague d'arriere-plan, pour toujours.
pushjs = open("lib/push.js", encoding="utf-8").read()
swjs2 = open("site/sw.js", encoding="utf-8").read()
check("Web Push vit dans lib/, chiffre par le module, sans dependance npm",
      "creerJetonVAPID" in pushjs
      and "aes128gcm" in pushjs
      and "require('web-push')" not in pushjs,
      "VAPID RFC 8292 + aes128gcm RFC 8291 tiennent dans le crypto natif")
check("le service worker recoit la notification et reagit au clic",
      "addEventListener('push'" in swjs2 and "notificationclick" in swjs2,
      "une notification blanche et muette serait pire que rien")
check("l abonnement push est purge quand le service le declare mort",
      "abonnement.json" in srv and "404" in pushjs and "410" in pushjs,
      "sans purge, chaque vague retente un abonnement mort pour toujours")

section("4. Coverage du bot C++ (regressions deja corrigees)")

ci = open(".github/workflows/ci.yml", encoding="utf-8").read()
bat = open("ouvrir_bot.bat", encoding="utf-8").read()

# bot.cpp fait ~10 000 lignes et a deux branches plateforme. Sans ces
# controles, on peut supprimer la compilation de la CI ou le build au
# premier lancement : plus aucun test ne le rattraperait.
check("la CI compile bot.cpp",
      "bot.cpp" in ci,
      "le job bot-cpp verifie les branches _WIN32 et POSIX")

check("la CI verifie la branche _WIN32 (WinINet)",
      "mingw" in ci.lower(),
      "la branche #ifdef _WIN32 contient toute l'implementation reelle")

check("ouvrir_bot.bat compile bot.exe si absent",
      "build_bot.ps1" in bat,
      "bot.exe est ignore par git : un clone frais n'en a pas")

# Le README doit decrire ce qui existe, sinon un tiers ne sait pas quoi
# lancer. On verifie la presence de quelques entrees representatives.
readme = open("README.md", encoding="utf-8").read()
for jeton, quoi in [
    ("ouvrir_bot.bat", "lancement du bot local"),
    ("ouvrir_admin.bat", "lancement du panneau admin"),
    ("serveur_bot.ps1", "serveur de la version locale"),
    ("serveur_admin.ps1", "serveur du panneau admin"),
    ("protection.ps1", "integrite et surveillance des fichiers"),
    ("sauvegarde.ps1", "sauvegarde locale"),
    ("bot_service.py", "service HTTP du bot"),
    ("docker-compose.yml", "stack cloud"),
    ("render.yaml", "deploiement Render"),
    ("SECURITY.md", "signalement de vulnerabilite"),
    ("CONTRIBUTING.md", "guide de contribution"),
]:
    check(f"README documente {quoi}", jeton in readme)

# Sprint E, etape 1 : deux decisions ecrites pour ne plus etre a lire.
cloudmd = open("CLOUD.md", encoding="utf-8").read()
check("README tranche le statut des serveurs PowerShell (miroir local)",
      "miroir local" in readme and "serveur_bot.ps1" in readme,
      "sans ecrit, on rouvre chaque mois le sujet de la suppression")
check("CLOUD.md documente les plafonds JSONBin (100 Ko / 10 000 requetes)",
      "100 Ko" in cloudmd and "10 000" in cloudmd and "15 $" in cloudmd,
      "le payload de sauvegarde depasse le plafond gratuit : le plan Pro est un prerequis")

# Hote du bot : la variable BLAMUNE_HOTE permet de poster ailleurs que sur
# l'instance de production (instance de test, auto-hebergement d'un tiers).
# Deux gardes de depot, pas de test runtime : WinINet (la branche _WIN32)
# n'est pas executable sous Linux. Retirer l'un ou l'autre fragilise le
# contrat :
#   - sans lecture de la variable, un bot.exe recompile ne peut plus etre
#     pointe ailleurs : tout tiers publie chez nous, a notre insu ;
#   - sans defaut declare, un bot.exe lance sans variable ne sait plus ou
#     poster, et l'operateur d'une instance neuve n'a aucun avertissement.
botcpp = open("bot.cpp", encoding="utf-8").read()
check("bot.cpp lit BLAMUNE_HOTE (hote configurable)",
      "BLAMUNE_HOTE" in botcpp,
      "le bot poste vers la variable d'environnement, defaut : instance de production")
check("bot.cpp garde un hote par defaut declare",
      "#define HOTE_BLAMUNE" in botcpp,
      "sans defaut, un bot.exe lance sans variable ne sait plus ou poster")
check("README documente BLAMUNE_HOTE",
      "BLAMUNE_HOTE" in readme,
      "l'operateur doit savoir comment pointer un bot vers sa propre instance")

# Hygiene de la CI et de l'IP : des etiquettes de depot pour que la
# discipline ne retombe pas quand personne ne regarde.
check("server.js declare trust proxy (un maillon)",
      "app.set('trust proxy'" in srv,
      "sans lui, req.ip est l'adresse du proxy : une seule pour tout le monde")
check("getIp ignore l'entete X-Forwarded-For brute",
      "headers['x-forwarded-for']" not in srv and "req.ip || '127.0.0.1'" in srv,
      "lue en brut, chaque requete se forgait une cle de rate limit neuve")
check("la CI verifie la syntaxe de tout le JavaScript suivi",
      "git ls-files" in ci and "node --check" in ci,
      "une liste en dur finissait par oublier les fichiers nouveaux")
check("la CI verifie le format prettier",
      "format:check" in ci,
      "les fichiers mal formates ne doivent pas arriver a la revue")
check("la CI utilise checkout et setup-node v5",
      "checkout@v5" in ci and "setup-node@v5" in ci,
      "la v4 cible Node 20, deprecie sur les runners actuels")

section("5. Reproductibilite du build")

# Un build reproductible repose sur deux choses : des dependances installees
# depuis le lockfile, et des images epinglees. Un tag seul peut etre
# repousse : deux builds du meme commit ne produiraient pas la meme base.

dockerfile = open("Dockerfile", encoding="utf-8").read()
dockerfile_bot = open("Dockerfile.bot", encoding="utf-8").read()

# On ne regarde que les instructions RUN : un commentaire qui cite
# "npm install" pour expliquer pourquoi on fait autrement ne doit pas
# faire echouer le controle.
instructions_run = [l.strip() for l in dockerfile.splitlines()
                    if l.strip().startswith("RUN ")]
check("Dockerfile installe avec npm ci, pas npm install",
      any("npm ci" in l for l in instructions_run)
      and not any("npm install" in l for l in instructions_run),
      "npm install resout les plages au moment du build : deux builds "
      "differents pour un meme commit")

for nom, contenu in (("Dockerfile", dockerfile), ("Dockerfile.bot", dockerfile_bot)):
    lignes_from = [l.strip() for l in contenu.splitlines() if l.startswith("FROM ")]
    sans_digest = [l for l in lignes_from if "@sha256:" not in l]
    check(f"{nom} : chaque FROM epingle par digest",
          not sans_digest,
          ("sans digest : " + " | ".join(sans_digest)) if sans_digest else
          f"{len(lignes_from)} etape(s) epinglee(s)")

compose_texte = open("docker-compose.yml", encoding="utf-8").read()
check("docker-compose.yml : aucune image en :latest",
      ":latest" not in compose_texte,
      "un pull peut installer une version differente de celle testee")

images = re.findall(r"^\s*image:\s*(\S+)", compose_texte, re.M)
check("docker-compose.yml : chaque image epinglee",
      images and all("@sha256:" in i for i in images),
      ", ".join(images))

# ollama et ollama-init partagent le volume : des digests differents
# pourraient melanger deux versions sur le meme volume.
digests = [i.split("@")[-1] for i in images if i.startswith("ollama/ollama")]
check("ollama et ollama-init sur le meme digest",
      len(set(digests)) <= 1,
      "ils partagent le volume ollama_data : des versions differentes "
      "casseraient le modele")

# Le tag de base est volontairement flottant (22-slim) : il faut donc
# garantir qu'il reste dans la plage annoncee par package.json, sinon
# engines mentirait sur ce qui est reellement execute.
pkg = json.load(open("package.json", encoding="utf-8"))
engines = str(pkg.get("engines", {}).get("node", ""))
m_base = re.search(r"^FROM node:(\d+)", dockerfile, re.M)
m_haut = re.search(r"<\s*(\d+)\.", engines)
if m_base and m_haut:
    base = int(m_base.group(1))
    plafond = int(m_haut.group(1))
    check("image de base dans la plage engines.node",
          base < plafond,
          f"base node:{base} alors que engines.node interdit >= {plafond} ; "
          "node:sqlite ou les tests peuvent ne pas s'y attendre")
    m_bas = re.search(r">=\s*(\d+)", engines)
    if m_bas:
        plancher = int(m_bas.group(1))
        check("image de base au-dessus du plancher engines.node",
              base >= plancher,
              f"base node:{base} mais engines.node exige >= {plancher}")

section("6. Poids du depot")

total = 0
for x in SUIVIS:
    try:
        total += os.path.getsize(x)
    except OSError:
        pass
print(f"  Fichiers SUIVIS : {len(SUIVIS)}")
print(f"  Poids total    : {total/1024/1024:.2f} Mo")
check("sous 100 Mo (limite Render)", total < 100 * 1024 * 1024,
      f"{total/1024/1024:.2f} Mo")

# les gros non-SUIVIS qui gonflent le disque local
gros = []
for f in os.listdir(P):
    p = os.path.join(P, f)
    if os.path.isfile(p) and f not in SUIVIS and os.path.getsize(p) > 5 * 1024 * 1024:
        gros.append((f, os.path.getsize(p) / 1024 / 1024))
if gros:
    print("\n  Fichiers non publies mais volumineux (sans impact sur le depot) :")
    for f, m in sorted(gros, key=lambda x: -x[1]):
        print(f"    {m:6.1f} Mo  {f}")

section("RESULTAT")
print("  " + ("PRÊT À PUBLIER" if ok else "CORRECTIONS NÉCESSAIRES"))
sys.exit(0 if ok else 1)
