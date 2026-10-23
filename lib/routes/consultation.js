// =====================================================================
//  Routes : consultation cote utilisateur
// =====================================================================
//  historique (avec recherche ?q=), message proactif, statistiques
//  perso, mode et profil.
//
//  Extraites de server.js. Toutes ne font que lire ou muter l'etat par
//  reference : aucun objet n'est reaffecte ici, donc on passe les
//  references directes (modeParUser, apiHistoriqueParUser) plutot que
//  des getters.
//
//  /historique ne renvoie que les dernieres bulles : au-dela de
//  HISTO_AFFICHAGE_MAX, le rendu DOM fige la page au chargement. Le
//  fichier complet reste intact sur disque — et ?q= fouille justement
//  l'ensemble (lib/recherche.js).
// =====================================================================
'use strict';

const fs = require('fs');
const { creerRecherche } = require('../recherche');
const { filtrerHistorique } = creerRecherche();

function creerRoutesConsultation(app, deps) {
  const {
    getEtat,
    getStats,
    getConfig,
    modeParUser,
    apiHistoriqueParUser,
    chargerHistorique,
    cheminHistorique,
    supprimerResume,
    livrerProactif,
    checkRateLimit,
    loggerErreur,
    extraireAuth,
    extraireChamp,
    lireEtat,
    lireMemoire,
    ecrireMemoire,
    joursAvantAnniversaire,
    savoirDb,
    histoAffichageMax
  } = deps;

  app.get('/historique', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    const mode = modeParUser[auth.uid] || '2';
    const hist = chargerHistorique(auth.uid, mode);
    // Recherche (sprint E) : ?q= fouille l'historique ENTIER, au-dela des
    // dernieres bulles affiches au chargement normal. Reponse bornee
    // (maxResultats) et marquee par q + total, pour que le client sache
    // qu'il regarde des correspondances et pas le fil continu.
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const filtre = filtrerHistorique(hist, q);
    if (filtre) {
      return res.json({
        ok: true,
        etat: getEtat(),
        mode,
        recherche: String(q).trim(),
        total: filtre.total,
        historique: filtre.liste,
        provider: getConfig().api_provider
      });
    }
    res.json({
      ok: true,
      etat: getEtat(),
      mode,
      historique: hist.slice(-histoAffichageMax),
      provider: getConfig().api_provider
    });
  });

  // Delete history
  app.delete('/historique', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    const mode = modeParUser[auth.uid] || '2';
    const f = cheminHistorique(auth.uid, mode);
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (e) {}
    // Le resume porte sur l'ancien historique : il ne doit pas survivre a son effacement.
    supprimerResume(auth.uid, mode);
    delete apiHistoriqueParUser[auth.uid + '_' + mode];
    res.json({ etat: getEtat(), historique: [] });
  });

  // Message proactif : le client sonde en tache de fond, BLAMUNE ecrit le
  // premier quand un evenement le merite (anniversaire, absence, promesse).
  app.get('/proactif', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    if (!checkRateLimit('proactif:' + auth.uid, 12))
      return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
    try {
      res.json({ ok: true, message: livrerProactif(auth.uid) });
    } catch (e) {
      loggerErreur('proactif', e.message);
      // Le client doit pouvoir rendre la main meme si le proactif echoue :
      // une erreur ici ne doit pas faire boucler la sonde.
      res.json({ ok: true, message: null });
    }
  });

  // Stats perso : /stats est admin, /stats-perso raconte SA vie a n'importe
  // qui (utilise par la commande /stats du client).
  app.get('/stats-perso', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    const etatP = lireEtat(auth.uid);
    const memoire = lireMemoire(auth.uid);
    const jours = etatP.premierContact
      ? Math.floor((Date.now() - etatP.premierContact) / 86400000)
      : 0;
    res.json({
      ok: true,
      messages: etatP.messages || 0,
      sessions: etatP.sessions || 0,
      jours,
      premierContact: etatP.premierContact || 0,
      dernierContact: etatP.dernierContact || 0,
      mode: modeParUser[auth.uid] || '2',
      anniversaire: memoire.anniversaire || '',
      joursAnniversaire: memoire.anniversaire ? joursAvantAnniversaire(memoire.anniversaire) : -1,
      proactifs: getStats().proactifs || 0,
      // Etat interieur visible (sprint E) : ce que BLAMUNE "ressent" et ce
      // qu'elle a note de toi, sans ouvrir le profil complet. Ce bloc reste
      // discret a dessein : il nourrit une pastille, pas un rapport.
      blamune: {
        humeur: memoire.humeur || '',
        humeurUser: memoire.humeurUser || '',
        promesses: String(memoire.promesses || '')
          .split('|')
          .filter(Boolean)
      }
    });
  });

  // Mode
  app.post('/mode', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    const m = extraireChamp(req, 'm');
    if (m !== '1' && m !== '2')
      return res.status(400).json({ ok: false, message: 'Mode invalide (1 ou 2)' });
    const ancienMode = modeParUser[auth.uid];
    modeParUser[auth.uid] = m;
    if (ancienMode && ancienMode !== m) {
      delete apiHistoriqueParUser[auth.uid + '_' + ancienMode];
    }
    res.json({ etat: getEtat(), mode: m });
  });

  // Profile POST
  app.post('/profil', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    const champ = extraireChamp(req, 'champ');
    const valeur = extraireChamp(req, 'valeur');
    const ok = ecrireMemoire(auth.uid, champ, valeur);
    if (ok) res.json({ ok: true, message: 'Profil mis a jour.' });
    else res.json({ ok: false, message: 'Champ inconnu : ' + champ });
  });

  // Profile GET
  app.get('/profil', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    const memoire = lireMemoire(auth.uid);
    let savoir = [];
    try {
      savoir = savoirDb
        .toutes()
        .map((e) => ({ cle: e.cle, reponse: e.reponse, categorie: e.categorie }));
    } catch (e) {}
    res.json({ profil: memoire, savoir });
  });
}

module.exports = { creerRoutesConsultation };
