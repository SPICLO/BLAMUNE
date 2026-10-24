// =====================================================================
//  Routes : Web Push (sprint E)
// =====================================================================
//  /push/config      GET  — etat de la feature + cle publique VAPID.
//  /push/abonnement  POST — l'abonnement navigateur, sur disque.
//  /push/essai       POST — notif de test vers son propre abonnement.
//  /push/retirer     POST — desabonnement (fichier supprime).
//
//  La fabrique push (lib/push.js) est inactive sans VAPID_PRIVATE_KEY :
//  /push/config dit alors actif=false (l'UI du site cache le bouton),
//  abonnement reste possible (les cles du navigateur ne changent pas
//  pour autant) mais essai explique pourquoi rien ne part.
// =====================================================================
'use strict';

function creerRoutesPush(app, deps) {
  const { push, extraireAuth, checkRateLimit, loggerErreur } = deps;

  app.get('/push/config', (req, res) => {
    const c = push.config();
    res.json({
      ok: true,
      actif: c.actif,
      cle: c.cle,
      sujet: c.sujet
    });
  });

  app.post('/push/abonnement', async (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    if (!checkRateLimit('push:' + auth.uid, 10))
      return res.status(429).json({ ok: false, message: 'Trop de requetes' });
    try {
      await push.abonnementSauver(auth.uid, req.body && req.body.abonnement);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: e.message });
    }
  });

  app.post('/push/retirer', async (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    push.abonnementRetirer(auth.uid);
    res.json({ ok: true });
  });

  app.post('/push/essai', async (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    if (!checkRateLimit('push:' + auth.uid, 10))
      return res.status(429).json({ ok: false, message: 'Trop de requetes' });
    if (!push.actif)
      return res.status(400).json({
        ok: false,
        message: 'Push non configure : generer VAPID_PRIVATE_KEY (scripts/generer_cles_push.js)'
      });
    try {
      const result = await push.envoyer(auth.uid, {
        titre: 'BLAMUNE',
        corps: 'Bon, les notifications marchent. On peut se parler de loin.',
        url: '/'
      });
      if (result.raison === 'pas d abonnement')
        return res.status(400).json({ ok: false, message: 'Aucun abonnement sur ce compte' });
      res.json({ ok: result.ok, statut: result.statut || null, detail: result.detail || null });
    } catch (e) {
      loggerErreur('push', 'essai : ' + e.message);
      res.status(502).json({ ok: false, message: 'Service push injoignable' });
    }
  });
}

module.exports = { creerRoutesPush };
