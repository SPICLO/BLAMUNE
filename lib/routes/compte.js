// =====================================================================
//  Routes : comptes, invites et push du savoir
// =====================================================================
//  inscription, connexion, deconnexion, cycle de vie des invites et
//  reception des connaissances apprises par le bot C++ local.
//
//  Extrait de server.js.
//
//  comptes et stats sont exposes par des GETTERS (getComputes/getStats) et
//  non par reference : ces deux variables sont REAFFECTEES ailleurs
//  (chargement depuis le disque, restauration d'une sauvegarde, synchro
//  cloud). Une reference injectee a l'initialisation deviendrait obsolete
//  apres une restauration, et les verifications de mot de passe viseraient
//  l'ancien objet. Une reference reste correcte pour connexionsActives,
//  qui n'est jamais reassigne.
//
//  Tous les identifiants arrives par le header X-EGO, l'uid seul est
//  rejete : c'est extraireAuth() qui applique cette regle, ces routes
//  reutilisent ses resultats telles quelles.
// =====================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function creerRoutesCompte(app, deps) {
  const {
    getIp, checkRateLimit, extraireAuth, extraireChamp,
    getComptes, getStats, sauvegarderComptes,
    hashMdpScrypt, verifierMdp, rehacherMdp, genererEgo,
    dossierUser, ecrireMemoire,
    enregistrerJetonInvite, lireJetonInvite, hashJeton,
    connexionsActives, apiHistoriqueParUser, usersDir,
    savoirDb, sansAccentsDB, savoirEnregistrer, storage,
  } = deps;

  app.post('/register', (req, res) => {
    const ip = getIp(req);
    if (!checkRateLimit(`register:${ip}`, 10)) return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
    const pseudo = (req.body.pseudo || '').trim().replace(/[<>"'\/\\]/g, '');
    const mdp = req.body.mdp || '';
    const email = (req.body.email || '').trim();
    if (pseudo.length < 2) return res.status(400).json({ ok: false, message: 'Pseudo trop court (2 min).' });
    if (mdp.length < 6) return res.status(400).json({ ok: false, message: 'Mot de passe trop court (6 min).' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, message: 'Email invalide.' });
    const comptes = getComptes();
    const cle = pseudo.toLowerCase();
    if (comptes[cle]) return res.status(409).json({ ok: false, message: 'Ce pseudo est deja pris.' });
    const sel = crypto.randomBytes(16).toString('hex');
    const hash = hashMdpScrypt(mdp, sel);
    const uid = 'u' + crypto.randomBytes(6).toString('hex');
    const ego = genererEgo();
    comptes[cle] = { pseudo, email, hash, sel, uid, ego, tokenCree: new Date().toISOString(), cree: new Date().toISOString().split('T')[0] };
    sauvegarderComptes();
    dossierUser(uid);
    ecrireMemoire(uid, 'nom', pseudo);
    getStats().sessionsTotal++;
    res.json({ ok: true, pseudo, uid, ego });
  });

  app.post('/login', (req, res) => {
    const ip = getIp(req);
    if (!checkRateLimit(`login:${ip}`, 10)) return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
    const pseudo = (req.body.pseudo || '').trim();
    const email = (req.body.email || '').trim();
    const mdp = req.body.mdp || '';
    const comptes = getComptes();
    let compte = null;
    if (email) {
      const emailLower = email.toLowerCase();
      for (const cle of Object.keys(comptes)) {
        if (comptes[cle].email?.toLowerCase() === emailLower) { compte = comptes[cle]; break; }
      }
    } else if (pseudo) {
      compte = comptes[pseudo.toLowerCase()];
    }
    if (!compte) return res.status(401).json({ ok: false, message: 'Email ou mot de passe incorrect.' });
    if (compte.lockoutUntil && new Date(compte.lockoutUntil) > new Date()) {
      return res.status(423).json({ ok: false, message: 'Compte verrouille. Reessayez plus tard.' });
    }
    if (!verifierMdp(mdp, compte)) {
      compte.erreursLogin = (compte.erreursLogin || 0) + 1;
      if (compte.erreursLogin >= 5) compte.lockoutUntil = new Date(Date.now() + 900000).toISOString();
      sauvegarderComptes();
      return res.status(401).json({ ok: false, message: 'Email ou mot de passe incorrect.' });
    }
    compte.erreursLogin = 0;
    compte.lockoutUntil = null;
    compte.tokenCree = new Date().toISOString();
    // Migration : un ancien hash sha256 est remplace par scrypt des que le
    // mot de passe est reconnu (une seule fois, puis c'est fini).
    if (String(compte.hash).indexOf('scrypt$') !== 0) rehacherMdp(compte, mdp);
    sauvegarderComptes();
    ecrireMemoire(compte.uid, 'nom', compte.pseudo);
    getStats().sessionsTotal++;
    res.json({ ok: true, pseudo: compte.pseudo, uid: compte.uid, ego: compte.ego });
  });

  app.post('/invite', (req, res) => {
    const ip = getIp(req);
    if (!checkRateLimit(`invite:${ip}`, 10)) return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
    // 12 octets (96 bits) pour l'identite, 32 octets (256 bits) pour le jeton
    // qui prouve qu'on est bien le proprietaire de ce uid.
    const uid = 'inv_' + crypto.randomBytes(12).toString('hex');
    const jeton = crypto.randomBytes(32).toString('hex');
    const pseudo = 'Invite_' + crypto.randomBytes(3).toString('hex');
    enregistrerJetonInvite(uid, jeton);
    connexionsActives[uid] = { uid, pseudo, ip, debut: new Date().toISOString(), derniereActivite: Date.now() };
    getStats().sessionsTotal++;
    res.json({ ok: true, uid, pseudo, jeton });
  });

  // Migration : une invite d'avant les jetons n'a que son uid. Elle l'envoie et
  // recoit un jeton (une seule fois connue : ensuite, plus d'echange sans le
  // jeton valide). Refuse pour un uid inconnu du serveur.
  app.post('/invite/jeton', (req, res) => {
    const ip = getIp(req);
    if (!checkRateLimit(`invite:${ip}`, 10)) return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
    const uid = req.headers['x-uid'] || req.body?.uid || req.query?.uid || '';
    const jetonClient = req.headers['x-jeton'] || req.body?.jeton || req.query?.jeton || '';
    if (!/^inv_[0-9a-f]{24}$/.test(uid)) return res.status(401).json({ ok: false, message: 'Non autorise' });
    const connu = !!connexionsActives[uid] || fs.existsSync(path.join(usersDir, uid));
    if (!connu) return res.status(401).json({ ok: false, message: 'Non autorise' });
    const enregistrement = lireJetonInvite(uid);
    if (enregistrement && (!jetonClient || hashJeton(jetonClient) !== enregistrement.h)) {
      return res.status(401).json({ ok: false, message: 'Non autorise' });
    }
    const jeton = crypto.randomBytes(32).toString('hex');
    enregistrerJetonInvite(uid, jeton);
    res.json({ ok: true, jeton });
  });

  // Le bot local (bot.exe) pousse ses apprentissages ici : la connaissance
  // rejoint savoir.txt IMMEDIATEMENT (aucun commit ni deploy) et sert de
  // secours des le prochain message quand Gemini est en panne. Ecriture
  // protegee : authentification stricte (invite muni de son jeton ou compte
  // admin -- pas d'invite legacy sans enregistrement) + debit limite.
  app.post('/savoir', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    if (auth.uid.startsWith('inv_') && !lireJetonInvite(auth.uid))
      return res.status(401).json({ ok: false, message: 'Non autorise' });
    if (!checkRateLimit('savoir:' + auth.uid, 20))
      return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
    let cle = String(extraireChamp(req, 'cle') || '');
    let reponse = String(extraireChamp(req, 'reponse') || '');
    // "|", retours ligne : structure de savoir.txt, jamais dans les donnees.
    cle = cle.replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim();
    reponse = reponse.replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cle || !reponse) return res.status(400).json({ ok: false, message: 'Entree invalide.' });
    if (cle.length > 100 || reponse.length > 500)
      return res.status(400).json({ ok: false, message: 'Entree trop longue.' });
    try {
      const dejaConnue = !!savoirDb.parCle(sansAccentsDB(cle));
      savoirEnregistrer(cle, reponse, null, 'bot-local');
      storage.declencherSauvegarde();
      res.json({ ok: true, remplace: dejaConnue });
    } catch (e) {
      res.status(500).json({ ok: false, message: 'Ecriture impossible.' });
    }
  });

  app.post('/logout', (req, res) => {
    const auth = extraireAuth(req);
    if (auth.uid && connexionsActives[auth.uid]) delete connexionsActives[auth.uid];
    if (auth.uid) {
      delete apiHistoriqueParUser[auth.uid + '_1'];
      delete apiHistoriqueParUser[auth.uid + '_2'];
    }
    res.json({ ok: true });
  });
}

module.exports = { creerRoutesCompte };