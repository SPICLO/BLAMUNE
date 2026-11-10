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
    effacerHistorique,
    supprimerResume,
    livrerProactif,
    checkRateLimit,
    loggerErreur,
    extraireAuth,
    extraireChamp,
    lireEtat,
    lireMemoire,
    ecrireMemoire,
    sauvegarderMemoireComplete,
    getIp,
    joursAvantAnniversaire,
    savoirDb,
    getComptes,
    histoAffichageMax,
    // Etat des gardiens anti-saturation (phase 3, P3-3) : l'eco coupe la
    // recherche web auto et les taches de fond ; il se VOIT desormais dans
    // /stats-perso, pas seulement dans /health reserve a l'admin.
    getTension
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
    // Effacement complet : fichier disque + cache memoire de l'ecriture
    // differee + copie cloud (effacerHistorique, lib/historique.js).
    effacerHistorique(auth.uid, mode);
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
      // Mode eco (3 formes : {eco:false} quand tout va bien) : cause,
      // depuis quand, et combien de fois arme depuis le demarrage. Une
      // pastille discrete suffit — c'est ce qui explique pourquoi BLAMUNE
      // ne cherche plus sur le web pendant une minute.
      service: getTension
        ? (() => {
            const t = getTension();
            return {
              eco: !!t.eco,
              cause: t.eco ? t.cause || '' : '',
              depuis: t.ecoDepuis || 0,
              entrees: t.entrees || {}
            };
          })()
        : undefined,
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

  // Profile GET : UNIQUEMENT CE QUE LE BOT A RETENU DE CET UTILISATEUR.
  // (La reponse incluait toute la base savoir — les faits appris des
  // AUTRES visiteurs : un detournement de la page ; les faits de chacun
  // restent prives, on ne livre pas les 1266 a chaque client.)
  app.get('/profil', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    const memoire = lireMemoire(auth.uid);
    // Les champs dont il ne faut rien MONTRER comme "profil" : humeur
    // interne du bot, notes de conduite (promesses = trame interne).
    const prive = { humeur: 1, promesses: 1 };
    const profil = {};
    for (const [c, v] of Object.entries(memoire)) {
      if (!prive[c] && v) profil[c] = v;
    }
    res.json({ profil });
  });

  // Profile DELETE : OUBLIER TOUT — chaque champ repasse a vide, y
  // compris l'humeur interne. Le respect de la vie privee n'est pas une
  // option : un visiteur doit pouvoir repartir de zero en un clic, sans
  // passer par l'admin. On garde l'uid et le compte (ce n'est pas une
  // suppression de compte ; la suppression complete existe ailleurs).
  app.delete('/profil', (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    // Champ interdit d'oubli : humeurUser n'est pas une donnee
    // identifiante mais une ambiance de la conversation en cours.
    try {
      sauvegarderMemoireComplete(auth.uid, { humeurUser: lireMemoire(auth.uid).humeurUser });
      res.json({ ok: true, message: 'Profil oublie.' });
    } catch (e) {
      loggerErreur('profil', 'oubli: ' + (e && e.message));
      res.status(500).json({ ok: false, message: 'Erreur' });
    }
  });

  // ==================== JOURNAL PUBLIC DU BOT ====================
  // Page "bonnes surprises du jour" (site/journal.html) : des NOMBRES
  // SEULEMENT. Un journal qui recopierait les faits appris livrerait les
  // secrets que des visiteurs lui ont confies — les faits restent prives,
  // leur VOLUME se rend public. Lisses et gratuits a calculer (SQLite).
  app.get('/journal', (req, res) => {
    const ip = getIp(req);
    if (!checkRateLimit(`journal:${ip}`, 30))
      return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
    // 15 min de cache HTTP + CORS ouvert : une page de vitrine peut
    // circuler, elle ne contient rien de personnel.
    res.set('Cache-Control', 'public, max-age=900');
    res.set('Access-Control-Allow-Origin', '*');
    let faits = { appris: 0, semaine: 0 };
    try {
      faits = savoirDb.statistiques(7);
    } catch (e) {}
    const stats = getStats();
    const comptes = getComptes ? getComptes() : null;
    res.json({
      ok: true,
      date: Math.floor(Date.now() / 1000),
      savoir: faits,
      conversations: Number(stats.messages || 0),
      appreciees: Number(stats.avisHaute || 0) + Number(stats.avisBasse || 0),
      bonnesReponses: Number(stats.avisHaute || 0),
      joursActif: Number(stats.jours || 0),
      membres: comptes ? Object.keys(comptes).length : null
    });
  });
}

module.exports = { creerRoutesConsultation };
