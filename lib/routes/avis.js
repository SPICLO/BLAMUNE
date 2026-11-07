// =====================================================================
//  Route : avis du visiteur sur une reponse (/avis)
// =====================================================================
//  Un bouton 👍 / 👎 sous chaque bulle du bot. Le visiteur vote, le lieu
//  stocke une ligne par vote dans avis.json : message, reponse, et le
//  sens du vote. C'est LA boussole produit : ce fichier reste petit, on
//  n'y relit que ce que le visiteur a signalé lui-meme.
//
//  Regles essentielles :
//   - le vote est ANONYME dans les usages mais rattache a l'uid pour
//     empecher le spam (un vote de moins de 30 min sur la meme reponse
//     est ignore). La liste admin retient l'uid : seul l'admin y accede.
//   - pas de sur-engagement : le fichier est borne (AVIS_MAX lignes), un
//     vote trop ancien est purge a l'ecriture.
//   - aucun contenu nouveau n'est cree ici : on archive ce que le bot a
//     deja envoye. Toutefois message et reponse sont bornes — un vote ne
//     doit pas servir de memoire d'attachement de fichiers.
// =====================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const AVIS_MAX = 5000; // borne absolue du fichier (anti-creusement)
const AVIS_FENETRE_MS = 30 * 60 * 1000; // anti-spam par reponse
const AVIS_PURGE_JOURS = 180;

function creerRouteAvis(app, deps) {
  const { racine, extraireAuth, getIp, checkRateLimit, getStats, loggerErreur } = deps;

  const chemin = path.join(racine, 'avis.json');

  function lire() {
    try {
      const j = JSON.parse(fs.readFileSync(chemin, 'utf8'));
      return Array.isArray(j) ? j : [];
    } catch (e) {
      return [];
    }
  }

  // L'ecriture la plus simple defendable : on purge, on borne, on file
  // sequentielle (pas de concurrency hazard critique : FileSystem
  // atomique via write temporaire).
  function ecrire(liste) {
    const t = JSON.stringify(liste, null, 0);
    const tmp = chemin + '.tmp';
    try {
      fs.writeFileSync(tmp, t);
      fs.renameSync(tmp, chemin);
      return true;
    } catch (e) {
      loggerErreur('avis', 'ecriture: ' + (e && e.message));
      return false;
    }
  }

  app.post('/avis', async (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    if (!checkRateLimit(`avis:${getIp(req)}`, 30))
      return res.status(429).json({ ok: false, message: 'Trop de requetes.' });

    const corps = typeof req.body === 'object' && req.body ? req.body : {};
    const avis = corps.avis === 'up' ? 'up' : corps.avis === 'down' ? 'down' : null;
    if (!avis) return res.status(400).json({ ok: false, message: 'Vote invalide.' });
    const msg = String(corps.msg || '')
      .substring(0, 2000)
      .trim();
    const repon = String(corps.reponse || '')
      .substring(0, 2500)
      .trim();

    const stats = getStats();
    if (avis === 'up') stats.avisHaute = (stats.avisHaute || 0) + 1;
    else stats.avisBasse = (stats.avisBasse || 0) + 1;

    const liste = lire();
    const maintenant = Date.now();
    // Anti-spam : un meme uid sur la meme reponse dans la fenetre est
    // IGNORE (pas de decompte double), mais renvoie ok (l'UI est sereine).
    const doublon = liste.some(
      (a) => a.uid === auth.uid && a.reponse === repon && maintenant - a.t < AVIS_FENETRE_MS
    );

    let ignore = false;
    if (!doublon) {
      // Purge des vieux votes a chaque ecriture (le fichier reste petit).
      const frais = liste.filter((a) => maintenant - a.t < AVIS_PURGE_JOURS * 86400000);
      frais.push({
        t: maintenant,
        uid: auth.uid,
        mode: corps.mode || '',
        msg,
        reponse: repon,
        avis
      });
      while (frais.length > AVIS_MAX) frais.shift();
      ecrire(frais);
    } else ignore = true;

    if (!ignore) {
      try {
        // La sauvegarde cloud reprend le fichier au prochain snapshot
        // (creerSauvegarde inclut avis.json) : declenchement throttle
        // deja gere par storage.js, non bloquant pour le visiteur.
        if (deps.storage && typeof deps.storage.declencherSauvegarde === 'function')
          deps.storage.declencherSauvegarde();
      } catch (e) {}
    }
    res.json({ ok: true, ignore });
  });
}

module.exports = { creerRouteAvis };
