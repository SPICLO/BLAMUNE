#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Service HTTP autour du bot C++ (bot.cpp).

Le bot est un programme interactif qui ecrit ses invites SANS saut de ligne
("Ton choix : ", "Toi : ", ...). Une lecture par ligne bloquerait donc
indefiniment : on lit en mode non bloquant (select + os.read) et on
recherche un marqueur.

Le service joue le role du serveur de terminal :
  - demarre le binaire,
  - fait la poignee de main de demarrage,
  - expose POST /respond,
  - renvoie la reponse en JSON.

Bibliotheque standard uniquement (aucune dependance), donc l'image Docker
reste minimale.

Lancer :
    python3 bot_service.py --bot ./bot --port 8090

API :
    GET  /health  -> {"ok": true, "pret": true}
    POST /respond -> {"message": "..."}  -> {"reponse": "...", "confiance": "..."}
"""
import argparse
import json
import os
import select
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROMPT_ATTENTE = "Toi : "
DELAI_REPONSE_S = 30.0
DELAI_DEMARRAGE_S = 20.0


class BotLocal(object):
    """Enveloppe le processus interactif du bot."""

    def __init__(self, chemin_bot, repertoire):
        self.chemin = chemin_bot
        self.repertoire = repertoire
        self.proc = None
        self.buffer = ""
        self.lock = threading.Lock()

    # ---------- I/O bas niveau (non bloquant) ----------

    def _lire_jusqu_a(self, marqueur, delai):
        fd = self.proc.stdout.fileno()
        limite = time.time() + delai
        while True:
            idx = self.buffer.find(marqueur)
            if idx >= 0:
                avant = self.buffer[:idx]
                self.buffer = self.buffer[idx + len(marqueur):]
                return avant
            restant = limite - time.time()
            if restant <= 0:
                raise TimeoutError("delai depasse en attendant %r" % marqueur)
            try:
                pret, _, _ = select.select([fd], [], [], restant)
            except (OSError, ValueError):
                raise RuntimeError("flux du bot ferme")
            if not pret:
                continue
            chunk = os.read(fd, 4096)
            if not chunk:
                raise RuntimeError("bot termine prematurement")
            self.buffer += chunk.decode("utf-8", "replace")

    def _ecrire(self, texte):
        self.proc.stdin.write((texte + "\n").encode("utf-8"))
        self.proc.stdin.flush()

    # ---------- Cycle de vie ----------

    def demarrer(self, mode="2", genre="feminin", nom="Visiteur", nom_bot="BLAMUNE"):
        if not os.path.exists(self.chemin):
            raise FileNotFoundError("binaire absent : %s" % self.chemin)
        self.proc = subprocess.Popen(
            [self.chemin],
            cwd=self.repertoire,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        # Poignee de main de demarrage (meme sequence que serveur_bot.ps1).
        self._lire_jusqu_a("Ton choix :", DELAI_DEMARRAGE_S)
        self._ecrire(mode)
        if mode == "2":
            self._lire_jusqu_a("ton IA :", DELAI_DEMARRAGE_S)
            self._ecrire(nom_bot)
            self._lire_jusqu_a("(masculin/feminin)", DELAI_DEMARRAGE_S)
            self._ecrire(genre)
        self._lire_jusqu_a("ton nom ?", DELAI_DEMARRAGE_S)
        self._ecrire(nom)
        self._lire_jusqu_a(PROMPT_ATTENTE, DELAI_DEMARRAGE_S)

    def repondre(self, message, delai=DELAI_REPONSE_S):
        with self.lock:
            self._ecrire(message)
            texte = self._lire_jusqu_a(PROMPT_ATTENTE, delai)
        return self._nettoyer(texte)

    def _nettoyer(self, texte):
        lignes = []
        for brute in texte.splitlines():
            l = brute.strip()
            if not l or l == "Toi :":
                continue
            if l.startswith("BLAMUNE :"):
                l = l[len("BLAMUNE :"):].strip()
            if l:
                lignes.append(l)
        return " ".join(lignes).strip()

    def arreter(self):
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.stdin.close()
            except Exception:
                pass
            try:
                self.proc.wait(timeout=3)
            except Exception:
                self.proc.kill()


BOT = None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _json(self, code, obj):
        corps = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corps)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corps)

    def do_GET(self):
        if self.path.rstrip("/") in ("/health", ""):
            self._json(200, {"ok": True, "pret": bool(BOT and BOT.proc
                                                     and BOT.proc.poll() is None)})
        else:
            self._json(404, {"ok": False, "error": "route inconnue"})

    def do_POST(self):
        if self.path.rstrip("/") != "/respond":
            self._json(404, {"ok": False, "error": "route inconnue"})
            return
        try:
            taille = int(self.headers.get("Content-Length") or 0)
            if taille <= 0 or taille > 100000:
                self._json(400, {"ok": False, "error": "corps invalide"})
                return
            data = json.loads(self.rfile.read(taille).decode("utf-8"))
        except Exception as e:
            self._json(400, {"ok": False, "error": "JSON invalide : %s" % e})
            return

        message = str(data.get("message") or "").strip()
        if not message:
            self._json(400, {"ok": False, "error": "message vide"})
            return
        try:
            reponse = BOT.repondre(message)
            if not reponse:
                self._json(503, {"ok": False, "error": "reponse vide"})
                return
            self._json(200, {"ok": True, "reponse": reponse, "confiance": "haute"})
        except (TimeoutError, RuntimeError) as e:
            self._json(503, {"ok": False, "error": str(e)})
        except Exception as e:
            self._json(500, {"ok": False, "error": str(e)})

    def log_message(self, fmt, *args):
        sys.stderr.write("[bot] " + (fmt % args) + "\n")


def main():
    global BOT
    ap = argparse.ArgumentParser()
    ap.add_argument("--bot", default="./bot")
    ap.add_argument("--repertoire", default=".")
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--mode", default="2")
    ap.add_argument("--genre", default="feminin")
    ap.add_argument("--nom", default="Visiteur")
    ap.add_argument("--nom-bot", default="BLAMUNE")
    ap.add_argument("--savoir-dossier", default="",
                    help="dossier contenant l'export savoir.txt partage par le serveur")
    args = ap.parse_args()

    # Sur le cloud, le serveur regenere en continu savoir.txt (export de la
    # base SQLite) dans un volume partage. On le copie dans le repertoire de
    # travail du bot, qui le lit au demarrage. Sans ce dossier, on garde la
    # copie embarquee dans l'image.
    if args.savoir_dossier:
        source = os.path.join(args.savoir_dossier, "savoir.txt")
        if os.path.exists(source):
            try:
                with open(source, "rb") as fsrc, \
                     open(os.path.join(args.repertoire, "savoir.txt"), "wb") as fdst:
                    fdst.write(fsrc.read())
                sys.stderr.write("[bot] savoir.txt partage charge depuis %s\n" % args.savoir_dossier)
                sys.stderr.flush()
            except OSError as e:
                sys.stderr.write("[bot] copie du savoir impossible : %s\n" % e)
        else:
            sys.stderr.write("[bot] aucun savoir.txt dans %s : copie embarquee conservee\n"
                             % args.savoir_dossier)
            sys.stderr.flush()

    BOT = BotLocal(args.bot, args.repertoire)
    BOT.demarrer(args.mode, args.genre, args.nom, args.nom_bot)
    sys.stderr.write("[bot] pret sur le port %d\n" % args.port)
    sys.stderr.flush()

    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
        BOT.arreter()


if __name__ == "__main__":
    main()