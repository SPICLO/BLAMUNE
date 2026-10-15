#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests de bot_service.py (wrapper HTTP du bot C++).

Aucun binaire C++ n'est requis : un faux processus reproduit le protocole
d'invites de bot.cpp (prompts ecrits SANS saut de ligne). Cela permet de
valider ce qui casse vraiment en production :

  - la sequence de poignee de main de BotLocal.demarrer(),
  - la lecture non bloquante _lire_jusqu_a(),
  - le nettoyage des reponses _nettoyer(),
  - le contrat HTTP de /health et /respond (codes, JSON, erreurs).

Lancement :
    python tests/bot_service.test.py

Note : _lire_jusqu_a() utilise select(), qui ne fonctionne sur les tubes que
sur POSIX. Les tests de protocole sont donc ignores sous Windows (le service
ne tourne que dans le conteneur Linux de toute facon). Les tests HTTP
s'executent partout.
"""
import io
import json
import os
import socket
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bot_service  # noqa: E402

# bot_service._lire_jusqu_a() fait select() puis os.read() sur le descripteur
# du stdout du bot. Sous POSIX un tube convient. Sous Windows, select() n'accepte
# QUE des sockets et os.read() echoue sur un socket : on passe donc par
# socket.socketpair() et on shimme os.read le temps des tests concernes.
POSIX = os.name == "posix"

PROMPT_CHOIX = "Ton choix :"
PROMPT_IA = "ton IA :"
PROMPT_GENRE = "(masculin/feminin)"
PROMPT_NOM = "ton nom ?"
ATTENTE = bot_service.PROMPT_ATTENTE

# fd -> socket, pour le shim os.read() sous Windows
_SOCKETS = {}
_os_read_reel = os.read


def _os_read_compat(fd, taille):
    sock = _SOCKETS.get(fd)
    if sock is not None:
        return sock.recv(taille)
    return _os_read_reel(fd, taille)


class _Lecture(object):
    """Adaptateur de lecture : .read(n) + .fileno(), que ce soit tube ou socket."""

    def __init__(self, flux, est_socket):
        self._f = flux
        self._est_socket = est_socket

    def fileno(self):
        return self._f.fileno()

    def read(self, n):
        if self._est_socket:
            try:
                return self._f.recv(n)
            except OSError:
                # Le test a fini et a ferme le canal : on se comporte comme
                # une fin de flux pour que le thread se termine proprement.
                return b""
        try:
            return self._f.read(n)
        except ValueError:
            # Sous POSIX, fermer un tube pendant une lecture levoque un
            # ValueError, pas une fin de flux. Meme traitement.
            return b""

    def close(self):
        try:
            self._f.close()
        except (OSError, ValueError):
            pass


class _Ecriture(object):
    """Adaptateur d'ecriture : .write(bytes) + .flush(), tube ou socket."""

    def __init__(self, flux, est_socket):
        self._f = flux
        self._est_socket = est_socket

    def write(self, data):
        if self._est_socket:
            return self._f.sendall(data)
        return self._f.write(data)

    def flush(self):
        if not self._est_socket:
            self._f.flush()

    def close(self):
        try:
            self._f.close()
        except (OSError, ValueError):
            # ValueError : deja ferme, sans importance.
            pass


def _canaux():
    """(lecture du service, ecriture du service, lecture du bot, ecriture du bot).

    Chaque tube relie le bot AU SERVICE dans un seul sens :
      - le bot ecrit l'invite, le service la lit  -> ce tube-la
      - le service ecrit la reponse, le bot la lit -> l'autre tube

    Les quatre canaux passent TOUJOURS par les adaptateurs _Lecture /
    _Ecriture, y compris sous POSIX : c'est ce qui garantit qu'un canal
    ferme fait proprement end of stream au lieu de lever dans le thread.
    """
    if POSIX:
        sr, sw = os.pipe()   # bot -> service
        er, ew = os.pipe()   # service -> bot
        return (_Lecture(os.fdopen(sr, "rb", buffering=0), False),
                _Ecriture(os.fdopen(ew, "wb", buffering=0), False),
                _Lecture(os.fdopen(er, "rb", buffering=0), False),
                _Ecriture(os.fdopen(sw, "wb", buffering=0), False))
    # socketpair : bidirectionnel, le service prend 'a', le bot 'b'.
    a, b = socket.socketpair()
    _SOCKETS[a.fileno()] = a
    _SOCKETS[b.fileno()] = b
    return (_Lecture(a, True), _Ecriture(a, True), _Lecture(b, True), _Ecriture(b, True))


class _SelectCompatible(unittest.TestCase):
    """Active le shim os.read() quand la lecture passe par un socket."""

    def setUp(self):
        super(_SelectCompatible, self).setUp()
        if not POSIX:
            reel = os.read
            os.read = _os_read_compat
            self.addCleanup(setattr, os, "read", reel)


class _TubeEcriture(object):
    """Fait semblant d'etre le stdin d'un processus : collecte ce qui est ecrit."""

    def __init__(self, ecrivure):
        self._f = ecrivure
        self.lignes = []

    def write(self, data):
        self.lignes.append(data.decode("utf-8").rstrip("\n"))
        return self._f.write(data)

    def flush(self):
        self._f.flush()

    def close(self):
        self._f.close()


class FauxProcess(object):
    """Processus interactif factice reproduisant les invites de bot.cpp.

    Le protocole reel est : ecrire une invite, lire une ligne, ecrire
    l'invite suivante... La premiere invite est ecrite au demarrage.
    """

    def __init__(self, invites, reponse="BLAMUNE : salut !", defiler=False):
        lecture_srv, ecrit_srv, lecture_bot, ecrit_bot = _canaux()
        self._lecture = lecture_srv
        self._ecriture = ecrit_srv
        self._lecture_bot = lecture_bot
        self._ecriture_bot = ecrit_bot
        self.stdout = lecture_srv
        self.stdin = _TubeEcriture(ecrit_srv)
        self.lignes_recues = []
        self.message_recu = None
        self.poll = lambda: None
        self._defiler = defiler
        self._ferme = False
        self._thread = threading.Thread(
            target=self._boucle, args=(invites, reponse, lecture_bot),
            daemon=True,
        )
        self._thread.start()

    # -- helpers --
    def _ecrire(self, texte):
        try:
            self._ecriture_bot.write(texte.encode("utf-8"))
        except (OSError, ValueError):
            # Le test a fini (close() a ferme le canal) alors que ce thread
            # daemon s'executait encore : rien a signaler.
            # Sous POSIX, ecrire sur un tube ferme leve ValueError ; sous
            # Windows, le socket leve OSError. Il faut couvrir les deux, sinon
            # ce traceback ecrit sur stderr pendant l'arret de l'interpreteur
            # provoque un abort aleatoire (exit 134).
            pass

    def _bloquer_si(self, condition):
        # On ne bloque qu'AVANT la reponse finale : bloquer pendant la
        # poignee de main ferait echouer demarrer() (delai 20 s) au lieu de
        # repondre() (delai 0,5 s dans les tests).
        # L'attente est interruptible pour que close() puisse arreter le
        # thread sans attendre la fin du delai.
        if self._defiler and condition:
            limite = time.time() + 8
            while not self._ferme and time.time() < limite:
                time.sleep(0.02)

    def _boucle(self, invites, reponse, f):
        try:
            self._ecrire(invites[0])
            for invite in invites[1:]:
                self._lire_ligne(f)
                self._ecrire(invite)
            self.message_recu = self._lire_ligne(f)
            self._bloquer_si(True)
            self._ecrire(reponse + ATTENTE)
            # Reste ouvert tant que le test vit, comme un vrai bot en attente
            # de la saisie suivante. La boucle s'arrete sur _ferme : un thread
            # daemon qui tourne encore a la fermeture de l'interpreteur entre
            # en course avec l'arret du processus (abort aleatoire, exit 134).
            while not self._ferme:
                time.sleep(0.02)
        finally:
            f.close()

    @staticmethod
    def _lire_ligne(f):
        # On accumule des OCTETS et on decode une fois la ligne complete :
        # decoder octet par octet casserait sur les accents (multi-octets
        # UTF-8 coupes entre deux lectures).
        morceaux = b""
        while True:
            c = f.read(1)
            if not c or c == b"\n":
                return morceaux.decode("utf-8", "replace").strip()
            morceaux += c

    def close(self):
        # Arreter proprement le thread : un daemon encore vivant pendant
        # l'arret de l'interpreteur provoque un abort aleatoire (exit 134).
        #
        # L'ordre compte. On ferme D'ABORD la lecture du bot : il est
        # bloque dedans en permanence, et la fermeture le rend la main
        # immediatement. Joindre avant de fermer le laisserait attendre le
        # timeout a chaque test (suite multipliee par 6).
        self._ferme = True
        try:
            self._lecture_bot.close()
        except OSError:
            pass
        self._thread.join(timeout=2)
        for f in (self.stdout, self.stdin, self._lecture, self._ecriture,
                  self._lecture_bot, self._ecriture_bot):
            try:
                f.close()
            except OSError:
                pass
        _SOCKETS.clear()


class TestLectureNonBloquante(_SelectCompatible):
    """_lire_jusqu_a : lecture par marqueur, tolerant aux invites coupees."""

    def setUp(self):
        super(TestLectureNonBloquante, self).setUp()
        self.proc = FauxProcess([PROMPT_CHOIX])
        self.addCleanup(self.proc.close)
        self.bot = bot_service.BotLocal.__new__(bot_service.BotLocal)
        self.bot.proc = self.proc
        self.bot.buffer = ""
        self.bot.lock = threading.Lock()

    def test_lit_jusqu_au_marqueur(self):
        texte = self.bot._lire_jusqu_a(PROMPT_CHOIX, delai=5)
        self.assertIsInstance(texte, str)

    def test_marqueur_present_dans_un_meme_lecture(self):
        # setUp a deja fait ecrire "Ton choix : " : on le consomme d'abord,
        # sinon il traine dans le buffer et pollue le resultat.
        self.bot._lire_jusqu_a(PROMPT_CHOIX, delai=5)
        self.proc._ecrire("avant " + ATTENTE + " apres")
        self.assertEqual(self.bot._lire_jusqu_a(ATTENTE, delai=5), "avant ")

    def test_timeout_leve_timeouterror(self):
        proc = FauxProcess([PROMPT_CHOIX], defiler=True)
        self.addCleanup(proc.close)   # sinon son thread survit au test
        bot = bot_service.BotLocal.__new__(bot_service.BotLocal)
        bot.proc = proc
        bot.buffer = ""
        with self.assertRaises(TimeoutError):
            bot._lire_jusqu_a("jamais-ecrit", delai=0.5)


class TestEcriture(unittest.TestCase):
    """_ecrire : UTF-8 + saut de ligne, comme l'attend bot.cpp."""

    def test_ecrire_envoie_utf8_avec_saut_de_ligne(self):
        proc = FauxProcess([PROMPT_CHOIX])
        self.addCleanup(proc.close)
        bot = bot_service.BotLocal.__new__(bot_service.BotLocal)
        bot.proc = proc
        bot._ecrire("ça va")
        self.assertEqual(proc.stdin.lignes, ["ça va"])


class TestNettoyage(unittest.TestCase):
    """_nettoyer : retire les invites et le prefixe BLAMUNE."""

    def setUp(self):
        self.bot = bot_service.BotLocal.__new__(bot_service.BotLocal)

    def test_retire_prefixe_et_lignes_vides(self):
        brut = "\nBLAMUNE : Salut, comment ca va ?\nToi :\n\n"
        self.assertEqual(self.bot._nettoyer(brut), "Salut, comment ca va ?")

    def test_concatene_les_lignes_multiples(self):
        brut = "BLAMUNE : ligne une\nBLAMUNE : ligne deux\n"
        self.assertEqual(self.bot._nettoyer(brut), "ligne une ligne deux")

    def test_texte_vide(self):
        self.assertEqual(self.bot._nettoyer("\n\nToi :\n"), "")


class TestPoigneeDeMain(_SelectCompatible):
    """demarrer() : l'ordre exact des invites est le contrat avec bot.cpp."""

    def _bot(self, invites, mode="2", **kw):
        proc = FauxProcess(invites, **kw)
        self.addCleanup(proc.close)
        bot = bot_service.BotLocal.__new__(bot_service.BotLocal)
        bot.proc = None
        bot.buffer = ""
        bot.lock = threading.Lock()
        bot.chemin = sys.executable  # existe : evite le garde de demarrer()
        bot.repertoire = "."
        import subprocess as sp
        reel = sp.Popen
        sp.Popen = lambda *a, **k: proc
        try:
            bot.demarrer(mode)
        finally:
            sp.Popen = reel
        return bot

    def test_sequence_mode_2(self):
        bot = self._bot([PROMPT_CHOIX, PROMPT_IA, PROMPT_GENRE, PROMPT_NOM, ATTENTE])
        self.assertEqual(
            bot.proc.stdin.lignes, ["2", "BLAMUNE", "feminin", "Visiteur"]
        )

    def test_sequence_mode_1_saut_les_invites_ia_et_genre(self):
        bot = self._bot([PROMPT_CHOIX, PROMPT_NOM, ATTENTE], mode="1")
        self.assertEqual(bot.proc.stdin.lignes, ["1", "Visiteur"])

    def test_repondre_transmet_le_message_et_nettoie(self):
        bot = self._bot([PROMPT_CHOIX, PROMPT_IA, PROMPT_GENRE, PROMPT_NOM, ATTENTE],
                        reponse="BLAMUNE : bien recu\n")
        self.assertEqual(bot.repondre("bonjour", delai=5), "bien recu")
        self.assertEqual(bot.proc.message_recu, "bonjour")

    def test_repondre_si_timeout(self):
        bot = self._bot([PROMPT_CHOIX, PROMPT_IA, PROMPT_GENRE, PROMPT_NOM, ATTENTE],
                        defiler=True)
        with self.assertRaises(TimeoutError):
            bot.repondre("bonjour", delai=0.5)


class _BotFaux(object):
    """Double de BotLocal pour les tests HTTP (pas de select)."""

    def __init__(self, pret=True, reponse="Salut !", erreur=None):
        self._pret = pret
        self._reponse = reponse
        self._erreur = erreur
        # Handler.do_GET teste BOT.proc.poll() : on se fait passer pour un
        # vrai processus vivant (ou mort).
        self.proc = self

    def poll(self):
        return None if self._pret else 0

    def repondre(self, message, delai=5):
        if self._erreur:
            raise self._erreur
        return self._reponse


class TestHttp(unittest.TestCase):
    """Contrat HTTP de /health et /respond."""

    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), bot_service.Handler)
        cls.port = cls.srv.server_address[1]
        # log_message ecrit chaque requete sur stderr : on le neutralise pour
        # que la sortie du test reste lisible.
        cls._log = bot_service.Handler.log_message
        bot_service.Handler.log_message = lambda self, *a: None
        cls.thread = threading.Thread(target=cls.srv.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        bot_service.Handler.log_message = cls._log
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        self._avant = bot_service.BOT

    def tearDown(self):
        bot_service.BOT = self._avant

    # -- helpers --
    def _url(self, chemin):
        return "http://127.0.0.1:%d%s" % (self.port, chemin)

    def _get(self, chemin):
        try:
            with urllib.request.urlopen(self._url(chemin), timeout=5) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            # HTTPError retient le flux de la reponse : sans close() explicite
            # Python signale un ResourceWarning a la destruction.
            try:
                return e.code, json.loads(e.read().decode("utf-8"))
            finally:
                e.close()

    def _post(self, chemin, corps, brut=False):
        data = corps if brut else json.dumps(corps).encode("utf-8")
        req = urllib.request.Request(self._url(chemin), data=data, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read().decode("utf-8"))
            finally:
                e.close()

    # -- tests --
    def test_health_pret(self):
        bot_service.BOT = _BotFaux(pret=True)
        code, obj = self._get("/health")
        self.assertEqual(code, 200)
        self.assertTrue(obj["ok"])
        self.assertTrue(obj["pret"])

    def test_health_pas_pret(self):
        bot_service.BOT = _BotFaux(pret=False)
        code, obj = self._get("/health")
        self.assertEqual(code, 200)
        self.assertFalse(obj["pret"])

    def test_health_sans_bot(self):
        bot_service.BOT = None
        code, obj = self._get("/health")
        self.assertEqual(code, 200)
        self.assertFalse(obj["pret"])

    def test_route_inconnue_404(self):
        bot_service.BOT = _BotFaux()
        for chemin in ("/inconnu", "/reponse/x"):
            self.assertEqual(self._get(chemin)[0], 404, chemin)

    def test_post_inconnu_404(self):
        bot_service.BOT = _BotFaux()
        self.assertEqual(self._post("/health", {})[0], 404)

    def test_respond_ok(self):
        bot_service.BOT = _BotFaux(reponse="Salut !")
        code, obj = self._post("/respond", {"message": "bonjour"})
        self.assertEqual(code, 200)
        self.assertEqual(obj["reponse"], "Salut !")
        self.assertIn("confiance", obj)

    def test_respond_message_vide_400(self):
        bot_service.BOT = _BotFaux()
        for corps in ({"message": ""}, {"message": "   "}, {}):
            code, obj = self._post("/respond", corps)
            self.assertEqual(code, 400, corps)
            self.assertFalse(obj["ok"])

    def test_respond_json_invalide_400(self):
        bot_service.BOT = _BotFaux()
        code, _ = self._post("/respond", b"{pas du json", brut=True)
        self.assertEqual(code, 400)

    def test_respond_reponse_vide_503(self):
        bot_service.BOT = _BotFaux(reponse="")
        code, _ = self._post("/respond", {"message": "bonjour"})
        self.assertEqual(code, 503)

    def test_respond_timeout_503(self):
        bot_service.BOT = _BotFaux(erreur=TimeoutError("delai depasse"))
        code, _ = self._post("/respond", {"message": "bonjour"})
        self.assertEqual(code, 503)

    def test_respond_fermeture_503(self):
        bot_service.BOT = _BotFaux(erreur=RuntimeError("flux du bot ferme"))
        code, _ = self._post("/respond", {"message": "bonjour"})
        self.assertEqual(code, 503)

    def test_respond_erreur_inattendue_500(self):
        bot_service.BOT = _BotFaux(erreur=ValueError("boum"))
        code, _ = self._post("/respond", {"message": "bonjour"})
        self.assertEqual(code, 500)

    def test_accent_preserve_en_json(self):
        bot_service.BOT = _BotFaux(reponse="Salut, comment ça va ?")
        code, obj = self._post("/respond", {"message": "ça va"})
        self.assertEqual(code, 200)
        self.assertEqual(obj["reponse"], "Salut, comment ça va ?")


if __name__ == "__main__":
    unittest.main(verbosity=2)