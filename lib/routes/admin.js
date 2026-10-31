// =====================================================================
//  Routes : diagnostic et administration
// =====================================================================
//  /ping et /health (sondes de disponibilite), /connexions, et tout le
//  panneau admin : export de donnees, liste des utilisateurs, journal des
//  erreurs, sauvegarde et restauration, export brut des messages.
//
//  Extrait de server.js. Comme dans lib/routes/compte.js, comptes et stats
//  passent par des getters car ils sont reaffectes ailleurs.
//
//  Le droit admin est centralise dans isAdminUid(), utilise par toutes ces
//  routes : le laisser ici evite d'avoir a le reconcilier a chaque route.
// =====================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

function creerRoutesAdmin(app, deps) {
  const {
    racine,
    logsDir,
    usersDir,
    getComptes,
    getStats,
    getConfig,
    persisterConfig,
    getEtat,
    getPoolSante,
    getQdrantSante,
    getGardiens,
    getSortie,
    connexionsActives,
    modeParUser,
    savoirDb,
    lireMemoire,
    chargerHistorique,
    etatAlertes,
    etatModele,
    getIp,
    checkRateLimit,
    extraireAuth,
    creerSauvegarde,
    appliquerSauvegarde,
    loggerErreur,
    sauvegarderComptes,
    purgerRamUtilisateur,
    hashMdpScrypt,
    storage
  } = deps;

  // Helper: check if user is admin.
  // ADMIN_PSEUDO (defaut "admin") et, en option, ADMIN_UID pour figer l'uid.
  const ADMIN_PSEUDO = String(process.env.ADMIN_PSEUDO || 'admin').toLowerCase();
  const ADMIN_UID = String(process.env.ADMIN_UID || '');

  function isAdminUid(uid) {
    const comptes = getComptes();
    for (const cle of Object.keys(comptes)) {
      const c = comptes[cle];
      if (c.uid !== uid) continue;
      if (ADMIN_UID && c.uid !== ADMIN_UID) return false;
      return String(c.pseudo || '').toLowerCase() === ADMIN_PSEUDO;
    }
    return false;
  }

  // Connexions actives : on ignore tout ce qui est inactif depuis 5 min,
  // sinon la liste grossirait a chaque message sans jamais se vider.
  function connexionsVivantes() {
    const now = Date.now();
    return Object.values(connexionsActives).filter((c) => now - c.derniereActivite < 300000);
  }

  /** Parcourt users/ et renvoie tous les echanges, tous utilisateurs confondus. */
  function lireTousLesMessages() {
    const messages = [];
    const d = path.join(usersDir);
    if (!fs.existsSync(d)) return messages;
    const dirs = fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory());
    for (const x of dirs) {
      for (const mode of ['1', '2']) {
        const f = path.join(d, x.name, `historique_mode${mode}.json`);
        if (!fs.existsSync(f)) continue;
        try {
          const hist = JSON.parse(fs.readFileSync(f, 'utf8'));
          hist.forEach((h) => messages.push({ uid: x.name, ...h }));
        } catch (e) {}
      }
    }
    return messages;
  }

  // Health check
  app.get('/ping', (req, res) => {
    const auth = extraireAuth(req);
    const mode = auth.uid && modeParUser[auth.uid] ? modeParUser[auth.uid] : '2';
    res.json({ ok: true, etat: getEtat(), mode });
  });

  // Keep-alive health check (pour UptimeRobot/cron)
  app.get('/health', async (req, res) => {
    // sante() est asynchrone (va questionner Qdrant) : on attend le
    // resultat avant de repondre, sinon JSON criserait une Promise en {}.
    let etatQdrant = null;
    try {
      if (getQdrantSante) etatQdrant = await getQdrantSante();
    } catch (e) {
      etatQdrant = null;
    }
    res.json({
      ok: true,
      timestamp: Date.now(),
      uptime: process.uptime(),
      // Pool IA : cooldowns en cours par fournisseur (supervision
      // anti-saturation). Champs ajoutes en fin : les sondes existantes
      // ignorent ce qu'elles ne connaissent pas.
      pool: getPoolSante ? getPoolSante() : undefined,
      // Gardiens anti-saturation : file de concurrence, tension (429),
      // cache de recherche. Les sondes existantes ignorent ce champ.
      gardiens: getGardiens ? getGardiens() : undefined,
      // Bande passante sortante (octets du jour, familles + top chemins) :
      // la seule statistique qui previent une suspension Render avant
      // qu'elle n'arrive.
      sortie: getSortie ? getSortie() : undefined,
      // Index semantique savoir (null si Qdrant non configure).
      qdrant: etatQdrant && etatQdrant.statut === 'inactif' ? null : etatQdrant
    });
  });

  // Active connections (admin only)
  app.get('/connexions', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid || !isAdminUid(auth.uid))
      return res.status(403).json({ ok: false, message: 'Non autorise' });
    res.json({ ok: true, connexions: connexionsVivantes() });
  });

  // Admin: all data
  app.get('/admin/data', (req, res) => {
    const ip = getIp(req);
    if (!checkRateLimit(`admin:${ip}`, 30))
      return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
    const auth = extraireAuth(req);
    if (!auth.uid || !isAdminUid(auth.uid))
      return res.status(403).json({ ok: false, message: 'Non autorise' });
    const connexions = connexionsVivantes();
    const messages = [];
    const d = path.join(usersDir);
    if (fs.existsSync(d)) {
      const dirs = fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory());
      for (const x of dirs) {
        for (const mode of ['1', '2']) {
          const f = path.join(d, x.name, `historique_mode${mode}.json`);
          if (fs.existsSync(f)) {
            try {
              const hist = JSON.parse(fs.readFileSync(f, 'utf8'));
              let pendingUser = null;
              let pendingTime = null;
              for (let i = 0; i < hist.length; i++) {
                const h = hist[i];
                if (h.qui === 'moi') {
                  if (pendingUser) {
                    messages.push({
                      uid: x.name,
                      pseudo: x.name,
                      message: pendingUser,
                      reponse: '',
                      heure: pendingTime
                    });
                  }
                  pendingUser = h.texte;
                  pendingTime = h.t ? new Date(h.t * 1000).toLocaleTimeString('fr-FR') : '-';
                } else if (h.qui === 'bot') {
                  messages.push({
                    uid: x.name,
                    pseudo: x.name,
                    message: pendingUser || '',
                    reponse: h.texte,
                    heure:
                      pendingTime || (h.t ? new Date(h.t * 1000).toLocaleTimeString('fr-FR') : '-')
                  });
                  pendingUser = null;
                }
              }
              if (pendingUser) {
                messages.push({
                  uid: x.name,
                  pseudo: x.name,
                  message: pendingUser,
                  reponse: '',
                  heure: pendingTime
                });
              }
            } catch (e) {}
          }
        }
      }
    }
    messages.sort((a, b) => {
      const ta = a.heure || '';
      const tb = b.heure || '';
      return tb.localeCompare(ta);
    });
    const messagesLimite = messages.slice(0, 100);
    const savoirTotal = [];
    try {
      for (const e of savoirDb.toutesAvecCategorie()) {
        savoirTotal.push({ topic: e.cle, contenu: e.reponse, categorie: e.categorie });
      }
    } catch (e) {}
    const vocabTotal = [];
    try {
      const f = path.join(racine, 'vocabulaire.txt');
      if (fs.existsSync(f)) {
        fs.readFileSync(f, 'utf8')
          .split('\n')
          .filter((l) => l.trim())
          .forEach((l) => vocabTotal.push(l.trim()));
      }
    } catch (e) {}
    // Premier profil utilisateur non vide : sert d apercu dans l admin.
    let profil = {};
    try {
      if (fs.existsSync(d)) {
        const dirs2 = fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory());
        for (const x of dirs2) {
          const mem = lireMemoire(x.name);
          if (
            mem.nom ||
            mem.age ||
            mem.hobby ||
            mem.plat ||
            mem.aime ||
            mem.aimePas ||
            mem.genre ||
            mem.humeur
          ) {
            profil = mem;
            break;
          }
        }
      }
    } catch (e) {}
    const modeGlobal =
      Object.keys(modeParUser).length > 0 ? modeParUser[Object.keys(modeParUser)[0]] : '2';
    const config = getConfig();
    res.json({
      ok: true,
      stats: getStats(),
      alertes: etatAlertes(),
      modele: etatModele(),
      // Gardiens anti-saturation : file de concurrence, comptage 429 /
      // mode eco, cache de recherche. Champ ajouté en fin : le tableau
      // existant l'ignore s'il ne le connait pas.
      gardiens: getGardiens ? getGardiens() : undefined,
      connexions,
      messages: messagesLimite,
      messagesTotal: messages.length,
      savoir: savoirTotal.slice(0, 100),
      savoirTotal: savoirTotal.length,
      vocabulaire: vocabTotal.slice(0, 100),
      vocabulaireTotal: vocabTotal.length,
      profil,
      mode: modeGlobal,
      config: {
        api_provider: config.api_provider,
        api_configured: !!config.api_key && config.api_key !== 'ego'
      }
    });
  });

  // Admin: users list
  app.get('/admin/users', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid || !isAdminUid(auth.uid))
      return res.status(403).json({ ok: false, message: 'Non autorise' });
    const comptes = getComptes();
    const users = [];
    for (const cle of Object.keys(comptes)) {
      const c = comptes[cle];
      let msgCount = 0;
      for (const mode of ['1', '2']) {
        const f = path.join(usersDir, c.uid, `historique_mode${mode}.json`);
        if (fs.existsSync(f)) {
          try {
            msgCount += JSON.parse(fs.readFileSync(f, 'utf8')).length;
          } catch (e) {}
        }
      }
      users.push({
        pseudo: c.pseudo,
        email: c.email,
        uid: c.uid,
        cree: c.cree || '-',
        messages: msgCount
      });
    }
    res.json({ ok: true, users });
  });

  // Journal des erreurs (admin) : les 200 dernieres lignes de logs/erreurs.log.
  // Sert a voir en prod ce qui a casse (modeles en echec, quota, plantages).
  app.get('/admin/logs', (req, res) => {
    const ip = getIp(req);
    if (!checkRateLimit(`admin:${ip}`, 30))
      return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
    const auth = extraireAuth(req);
    if (!auth.uid || !isAdminUid(auth.uid))
      return res.status(403).json({ ok: false, message: 'Non autorise' });
    let texte = '';
    try {
      const f = path.join(logsDir, 'erreurs.log');
      if (fs.existsSync(f)) texte = fs.readFileSync(f, 'utf8');
    } catch (e) {}
    res.json({
      ok: true,
      lignes: texte
        .split('\n')
        .filter((l) => l.trim())
        .slice(-200)
    });
  });

  // Sauvegarde complete (admin) : telecharge tout ce qui doit survivre a la
  // perte de l'instance Render. Meme reponse que celle envoyee au cloud.
  app.get('/admin/backup', (req, res) => {
    const ip = getIp(req);
    if (!checkRateLimit(`admin:${ip}`, 30))
      return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
    const auth = extraireAuth(req);
    if (!auth.uid || !isAdminUid(auth.uid))
      return res.status(403).json({ ok: false, message: 'Non autorise' });
    try {
      const snap = creerSauvegarde();
      const nom = 'blamune-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json';
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="' + nom + '"');
      res.send(JSON.stringify(snap, null, 2));
    } catch (e) {
      loggerErreur('backup', e.message);
      res.status(500).json({ ok: false, message: 'Erreur de sauvegarde' });
    }
  });

  // Restauration (admin) : reecrit les fichiers de la sauvegarde puis
  // recharge comptes/invites/stats en memoire. Pas de redemarrage.
  app.post('/admin/restore', express.json({ limit: '50mb' }), (req, res) => {
    const ip = getIp(req);
    if (!checkRateLimit(`restore:${ip}`, 5))
      return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
    const auth = extraireAuth(req);
    if (!auth.uid || !isAdminUid(auth.uid))
      return res.status(403).json({ ok: false, message: 'Non autorise' });
    try {
      const ecrits = appliquerSauvegarde(req.body);
      console.log(`[BLAMUNE] Restauration : ${ecrits} fichier(s) reecrit(s)`);
      res.json({ ok: true, fichiers: ecrits });
    } catch (e) {
      loggerErreur('restore', e.message);
      res.status(400).json({ ok: false, message: e.message });
    }
  });

  // All messages (admin only)
  app.get('/tous-les-messages', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, error: 'Non autorise' });
    // Le passage sur la liste des comptes n'est pas decoratif : sans au
    // moins un compte enregistre il n'existe pas d'admin, et l'export
    // global doit rester refuse.
    const estAdmin = Object.keys(getComptes()).length > 0 && isAdminUid(auth.uid);
    if (estAdmin) {
      res.json({ ok: true, messages: lireTousLesMessages() });
      return;
    }
    const messages = [];
    for (const mode of ['1', '2']) {
      const hist = chargerHistorique(auth.uid, mode);
      hist.forEach((h) => messages.push({ uid: auth.uid, ...h }));
    }
    res.json({ ok: true, messages });
  });

  // Stats (admin only)
  app.get('/stats', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(403).json({ ok: false, message: 'Non autorise' });
    // Comme /tous-les-messages : sans aucun compte enregistre, l'admin
    // n'existe pas et la route doit rester fermee.
    if (!(Object.keys(getComptes()).length > 0 && isAdminUid(auth.uid))) {
      return res.status(403).json({ ok: false, message: 'Non autorise' });
    }
    res.json({
      ...getStats(),
      apiProvider: getConfig().api_provider,
      apiConfigured: !!getConfig().api_key && getConfig().api_key !== 'ego',
      sauvegarde: storage.etatSauvegarde(),
      alertes: etatAlertes(),
      modele: etatModele()
    });
  });

  // Config API (admin only)
  app.post('/config-api', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid || !isAdminUid(auth.uid))
      return res.status(403).json({ ok: false, message: 'Non autorise (admin requis)' });
    try {
      const config = getConfig();
      // "***" est le masque affiche dans le panneau : le renvoyer tel quel
      // n'aurait pas d'effet et effacerait la cle si on ne filtrait pas.
      const branches = {};
      if (req.body.api_key && req.body.api_key !== '***') branches.api_key = req.body.api_key;
      if (req.body.api_provider) branches.api_provider = req.body.api_provider;
      if (req.body.api_model) branches.api_model = req.body.api_model;
      if (req.body.api_url) branches.api_url = req.body.api_url;
      if (!Object.keys(branches).length)
        return res.status(400).json({
          ok: false,
          message: 'Aucune valeur reconnue (api_key/api_provider/api_model/api_url).'
        });
      for (const champ of Object.keys(branches)) config[champ] = branches[champ];
      // Persistance : sinon la configuration saisie ne survit pas au
      // redemarrage de l'instance (dans le cas de Render, a ch Преdeploiement).
      const ecriture = persisterConfig(branches);
      let message = 'Configuration mise a jour.';
      if (ecriture.persistes.length)
        message +=
          ' Enregistree pour les prochains demarrages (' + ecriture.persistes.join(', ') + ').';
      if (ecriture.bloquesEnv && Object.keys(ecriture.bloquesEnv).length) {
        const noms = Object.keys(ecriture.bloquesEnv)
          .map((k) => k + ' (fixe par ' + ecriture.bloquesEnv[k] + ')')
          .join(', ');
        message += ' Attention, non persiste : ' + noms + ' — l environnement reste prioritaire.';
      }
      res.json({
        ok: true,
        message,
        persistes: ecriture.persistes,
        bloques_env: ecriture.bloquesEnv
      });
    } catch (e) {
      res.json({ ok: false, message: 'Erreur de configuration' });
    }
  });

  // Suppression d'un compte (admin) : efface le registre, le dossier
  // utilisateur (memoire, historiques, resumes), la copie cloud
  // (historiques + memoire) et la RAM du serveur. Destructif a souhait
  // mais utilise pour les comptes de test et les faux comptes.
  // Impossibilites voulues : supprimer un admin (dans quel panneau se
  // reconnecterait-on ?) et supprimer l'admin connecte (son token survivrait).
  app.post('/admin/supprimer-compte', (req, res) => {
    const ip = getIp(req);
    if (!checkRateLimit(`admin:${ip}`, 30))
      return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
    const auth = extraireAuth(req);
    if (!auth.uid || !isAdminUid(auth.uid))
      return res.status(403).json({ ok: false, message: 'Non autorise' });
    const uid = String((req.body && req.body.uid) || '').trim();
    if (!uid) return res.status(400).json({ ok: false, message: 'uid requis' });
    // Un uid est fabrique par ce serveur : 'inv_' + 24 hex (invite) ou
    // 'u' + 12 hex (compte). Sans ce garde, le corps adresserait fs.rmSync
    // ou il veut : '../x' effacerait un dossier arbitraire. Cote admin
    // seulement, mais un simple copier-coller rate suffit pour detruire.
    if (!/^inv_[0-9a-f]{24}$/.test(uid) && !/^u[0-9a-f]{12}$/.test(uid))
      return res.status(400).json({ ok: false, message: 'uid invalide' });
    if (isAdminUid(uid))
      return res
        .status(400)
        .json({ ok: false, message: 'Un compte admin ne peut pas etre supprime ici.' });
    const comptes = getComptes();
    const cle = Object.keys(comptes).find((k) => comptes[k].uid === uid);
    if (!cle) return res.status(404).json({ ok: false, message: 'Compte introuvable' });
    const pseudo = comptes[cle].pseudo;
    try {
      delete comptes[cle];
      sauvegarderComptes();
    } catch (e) {
      loggerErreur('admin', 'suppression registre: ' + e.message);
    }
    try {
      fs.rmSync(path.join(usersDir, uid), { recursive: true, force: true });
    } catch (e) {
      loggerErreur('admin', 'suppression dossier: ' + e.message);
    }
    try {
      if (storage.supprimerTout) storage.supprimerTout(uid);
      else if (storage.estConfigure()) loggerErreur('admin', 'cloud : supprimerTout absent');
    } catch (e) {
      loggerErreur('admin', 'suppression cloud: ' + e.message);
    }
    try {
      if (purgerRamUtilisateur) purgerRamUtilisateur(uid);
    } catch (e) {
      loggerErreur('admin', 'purge RAM: ' + e.message);
    }
    console.log(`[BLAMUNE] Compte supprime : ${pseudo} (${uid})`);
    loggerErreur('admin', 'compte supprime : ' + pseudo + ' (' + uid + ')');
    res.json({ ok: true, message: 'Compte ' + pseudo + ' supprime' });
  });

  // Change admin password (admin only)
  app.post('/admin/change-mdp', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid || !isAdminUid(auth.uid))
      return res.status(403).json({ ok: false, message: 'Non autorise' });
    const nouveauMdp = (req.body.nouveau_mdp || '').trim();
    // 8 caracteres : meme plancher que ADMIN_MDP. La variable d'env et la
    // route du panneau doivent exiger la meme politique, sinon on peut
    // affaiblir depuis le panneau ce que l'environnement interdit.
    if (nouveauMdp.length < 8)
      return res.status(400).json({ ok: false, message: 'Mot de passe trop court (8 min).' });
    const comptes = getComptes();
    for (const cle of Object.keys(comptes)) {
      if (comptes[cle].uid === auth.uid) {
        const sel = crypto.randomBytes(16).toString('hex');
        comptes[cle].sel = sel;
        comptes[cle].hash = hashMdpScrypt(nouveauMdp, sel);
        comptes[cle].erreursLogin = 0;
        comptes[cle].lockoutUntil = null;
        sauvegarderComptes();
        return res.json({ ok: true, message: 'Mot de passe change.' });
      }
    }
    res.status(404).json({ ok: false, message: 'Compte introuvable' });
  });

  return { isAdminUid };
}

module.exports = { creerRoutesAdmin };
