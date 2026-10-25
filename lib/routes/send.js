// =====================================================================
//  Route : envoi d'un message (/send)
// =====================================================================
//  Une seule responsabilite : transformer un message en reponse.
//
//  Deux modes. Le mode 1 (EGO) est une conversation directe avec le
//  fournisseur ; le mode 2 (BLAMUNE) reconstruit le prompt systeme a
//  chaque message pour que la reponse tienne compte de ce qui vient
//  d etre appris.
//
//  Deux proprietes du flux sont deliberement placees ici :
//
//  - L APPRENTISSAGE AVANT LE PROMPT. En mode 2, autoApprentissage() est
//    appele avant blocSysteme(). Un surnom ou une humeur dite a l'instant
//    est donc deja connue de BLAMUNE dans la reponse qu'il est en train
//    d ecrire, pas au message suivant.
//
//  - LES TACHES DE FOND APRES LA REPONSE. Resume et extraction sont
//    lances via reporterTache() une fois la reponse rendue : ils ne
//    rallongent jamais l'attente de l'utilisateur, et juste apres un 429
//    reporterTache attend que la fenetre de quota se recharge.
//
//  Le streaming SSE est optionnel (champ "stream"). Le client peut
//  couper la connexion : coupe alimente la fermeture propre du flux, et
//  les ecritures SSE sont chacune protegees parce qu'ecrire sur une
//  reponse deja fermee leve une exception.
//
//  Extrait de server.js. stats, config et reflexionRefusee sont exposes
//  par des getters : stats et config sont reaffectes ailleurs, et
//  reflexionRefusee est un drapeau modifie en cours de route par la
//  couche IA.
// =====================================================================
'use strict';

function creerRouteSend(app, deps) {
  const {
    getStats,
    getConfig,
    getEtat,
    getReflexionRefusee,
    extraireAuth,
    extraireChamp,
    getIp,
    checkRateLimit,
    checkUserRateLimit,
    modeParUser,
    connexionsActives,
    apiHistoriqueParUser,
    egoSystemPrompt,
    contexteHeureEGO,
    chargerHistorique,
    avecHistorique,
    autoApprentissage,
    lireMemoire,
    lireEtat,
    sauvegarderEtat,
    lireResume,
    majResume,
    extraireAvecModele,
    reporterTache,
    texteContinuite,
    blocSysteme,
    intentionDeMessage,
    appelerGemini,
    rechercheWeb,
    savoirEnregistrer,
    nettoyerReponse,
    reponseSecours,
    contexteSavoir,
    dernierModeleOkConnu,
    loggerErreur,
    rateSendIp,
    rateSendUid
  } = deps;

  // Refroidissement du declenchement AUTO de la recherche web : 1 / 45 s
  // par visiteur (la commande /cherche, elle, reste un service explicite).
  const derniereAutoWeb = Object.create(null);

  app.post('/send', async (req, res) => {
    const auth = extraireAuth(req);
    if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
    const ip = getIp(req);
    if (!checkRateLimit(`send:${ip}`, rateSendIp))
      return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
    if (!checkUserRateLimit(auth.uid, rateSendUid))
      return res.status(429).json({ ok: false, message: 'Trop de messages. Patiente un instant.' });

    const msg = String(extraireChamp(req, 'msg') || '').trim();
    const modeOverride = extraireChamp(req, 'mode');

    // Photo jointe : data URL validee AVANT tout traitement (jpeg/png/webp/gif,
    // 7 Mo de binaire max une fois decode). Le modele la voit (inline_data),
    // l'historique garde seulement un marqueur (pas de base64 dans le cloud).
    let imageParts = null;
    const image = String(extraireChamp(req, 'image') || '').trim();
    if (image) {
      const m = image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
      const brut = m ? m[2] : '';
      if (!m || brut.length < 50 || brut.length > 9000000) {
        return res
          .status(400)
          .json({ ok: false, message: 'Image invalide (jpeg, png, webp ou gif, 7 Mo max).' });
      }
      imageParts = { mime_type: m[1], data: brut };
    }
    if (!msg && !imageParts) return res.status(400).json({ ok: false, message: 'Message vide.' });
    if (msg.length > 2000)
      return res.status(400).json({ ok: false, message: 'Message trop long (2000 max).' });
    // Message vide mais photo presente : un texte minimal pour le modele.
    const msgHisto = msg || (imageParts ? '(photo)' : msg);

    const mode =
      modeOverride === '1' || modeOverride === '2' ? modeOverride : modeParUser[auth.uid] || '2';
    modeParUser[auth.uid] = mode;

    if (connexionsActives[auth.uid]) connexionsActives[auth.uid].derniereActivite = Date.now();
    else {
      connexionsActives[auth.uid] = {
        uid: auth.uid,
        pseudo: extraireChamp(req, 'pseudo') || auth.uid,
        ip: getIp(req),
        debut: new Date().toISOString(),
        derniereActivite: Date.now(),
        mode
      };
    }

    const debut = Date.now();
    let reponses = [];
    // Vrai si les regex ont deja appris quelque chose dans ce message (on ne
    // paie alors pas l'extraction par le modele en plus).
    let dejaAppris = false;
    const nbMots = msg.split(/\s+/).filter(Boolean).length;

    // ===== RECHERCHE WEB EN PROFONDEUR (DuckDuckGo serveur, sans cle) =====
    // "L'IA epaule BLAMUNE et EGO" : des SOURCES servies a TOUT le pool.
    // Deux declenchements :
    //   - force : le visiteur a tape "/cherche <sujet>" (4 pages lues),
    //   - auto  : question d'actu detectee, refroidissement 45 s, mode 2,
    //             pas de photo (les extraits seuls suffisent, 0-2 s).
    // Toute panne de la recherche est silencieuse pour l'utilisateur :
    // le modele repondra simplement sans contexte, comme avant.
    let rechercheBloc = '';
    let recherchePourApprendre = null;
    const sujetForce = rechercheWeb ? rechercheWeb.commandeWeb(msg) : null;
    const autoWeb =
      !sujetForce &&
      rechercheWeb &&
      getConfig().recherche_web_auto !== false &&
      mode === '2' &&
      !imageParts &&
      msg.length >= 8 &&
      Date.now() - (derniereAutoWeb[auth.uid] || 0) > 45000 &&
      rechercheWeb.demandeWebEvidente(msg);
    if (sujetForce || autoWeb) {
      if (autoWeb) derniereAutoWeb[auth.uid] = Date.now();
      const sujet = sujetForce ? sujetForce.sujet : msg;
      const debit = sujetForce ? { nb: 5, lire: 4 } : { nb: 5, lire: 0 };
      try {
        const r = await rechercheWeb.rechercheWeb(sujet, debit);
        if (r && r.sources && r.sources.length) {
          rechercheBloc = rechercheWeb.pourPrompt(r);
          // Apprentissage reserve a la COMMANDE /cherche : le sujet y est
          // choisi par le visiteur. Sur declenchement auto, le sujet est
          // une question ambiante ("quelles sont les actualites du jour ?")
          // : apprendre ca remplirait le savoir d un mot-cle inutile.
          recherchePourApprendre = sujetForce ? r : null;
        } else if (sujetForce) {
          // Commande explicite sans resultat : le mot est du service,
          // le modele doit l'annoncer honnetement au lieu de deviner.
          loggerErreur(
            'recherche-web',
            'aucune source pour "' + sujet + '"' + (r && r.remarque ? ' (' + r.remarque + ')' : '')
          );
          rechercheBloc =
            'RECHERCHE WEB : la recherche n a donne AUCUNE source pour "' +
            sujet +
            '" en ce moment. Dis honnetement au visiteur que tu n as rien trouve, et ne devine rien.';
        }
      } catch (e) {
        loggerErreur('recherche-web', (e && e.message) || String(e));
      }
    }

    // Flux SSE : le client demande a voir la reponse s'ecrire au fur et a mesure.
    const enFlux = extraireChamp(req, 'stream') === '1';
    let coupe = false;
    const surDelta = enFlux
      ? (t) => {
          if (coupe || res.writableEnded || res.destroyed) return;
          try {
            res.write('data: ' + JSON.stringify({ t: t }) + '\n\n');
          } catch (e) {}
        }
      : null;

    if (enFlux) {
      res.status(200);
      res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders();
      try {
        res.write(':BLAMUNE\n\n');
      } catch (e) {}
      res.on('error', function () {});
      res.on('close', function () {
        if (!res.writableEnded) coupe = true;
      });
    }

    if (mode === '1') {
      // EGO mode - Gemini API
      const histoKey = auth.uid + '_1';
      if (!apiHistoriqueParUser[histoKey]) apiHistoriqueParUser[histoKey] = [];
      const histo = apiHistoriqueParUser[histoKey];
      if (histo.length === 0) {
        histo.push({ role: 'system', content: egoSystemPrompt + contexteHeureEGO() });
        // Restore history
        const histFichier = chargerHistorique(auth.uid, '1');
        const nbRestaurer = Math.min(histFichier.length, 10);
        if (nbRestaurer > 0) {
          const debutIdx = Math.max(0, histFichier.length - nbRestaurer);
          for (let i = debutIdx; i < histFichier.length; i++) {
            const e = histFichier[i];
            histo.push({ role: e.qui === 'moi' ? 'user' : 'assistant', content: e.texte });
          }
        }
      }
      // La reponse en mode 1 part du system prompt reconstruit :
      // l'heure est fausse dix minutes plus tard, on rafraichit avant
      // chaque envoi.
      histo[0].content = egoSystemPrompt + contexteHeureEGO();
      // ===== RAG sur le chemin nominal ================================
      // Le savoir pertinent accompagne la question dans le system prompt :
      // BLAMUNE ne pouvait l'utiliser qu'en panne. Zero effet de bord :
      // contexte vide = prompt identique a avant.
      let savoirMode1 = '';
      try {
        savoirMode1 = typeof contexteSavoir === 'function' ? await contexteSavoir(msg) : '';
      } catch (e) {
        loggerErreur('savoir', 'contexte EGO: ' + (e && e.message));
      }
      if (savoirMode1) {
        histo[0].content +=
          '\n\nCONNAISSANCE PERTINENTE : ' +
          savoirMode1 +
          '\nSi elle repond a la question, dis-la a ta maniere. Sinon ignore-la ; sans mieux, admet-le honnetement.';
      }
      // Sources web (recherche serveur) : injectees dans le system prompt,
      // donc vues par n'importe quel fournisseur, pas seulement Gemini.
      if (rechercheBloc) histo[0].content += '\n\n' + rechercheBloc;
      histo.push({ role: 'user', content: msgHisto, _lastTs: Date.now() });
      while (histo.length > 50) histo.splice(1, 1);

      try {
        const reponse = await appelerGemini(msgHisto, histo, surDelta, imageParts);
        const texte = nettoyerReponse(reponse);
        histo.push({ role: 'assistant', content: texte, _lastTs: Date.now() });
        reponses = [texte];
      } catch (e) {
        loggerErreur('EGO', e.message);
        reponses = [await reponseSecours(msg, e)];
      }
    } else {
      // BLAMUNE mode - Gemini with different personality
      const histoKey = auth.uid + '_2';
      if (!apiHistoriqueParUser[histoKey]) apiHistoriqueParUser[histoKey] = [];
      const histo = apiHistoriqueParUser[histoKey];
      // Nouvelle session si plus de 45 min sans activite (peu importe logout/restart) :
      // BLAMUNE "vit" entre deux sessions et sent le temps qui passe.
      const SEUIL_NOUVELLE_SESSION = 45 * 60 * 1000;
      const maintenant = Date.now();
      if (histo.length > 0) {
        const derniereActivite = histo[histo.length - 1]._lastTs || 0;
        if (derniereActivite && maintenant - derniereActivite > SEUIL_NOUVELLE_SESSION)
          histo.length = 0;
      }

      // 1) ON APPREND D'ABORD, PUIS ON CONSTRUIT LE PROMPT.
      // Ainsi un surnom, une humeur ou un souvenir dit a l'instant M est deja
      // connu de BLAMUNE dans la reponse qu'il est en train d'ecrire.
      dejaAppris = autoApprentissage(auth.uid, msg);

      // Etat et memoire APRES apprentissage : c'est la version que BLAMUNE voit.
      const memoire = lireMemoire(auth.uid);
      const etatBL = lireEtat(auth.uid);
      // Compteur de messages : BLAMUNE sait combien ils se sont deja parle.
      etatBL.messages = (etatBL.messages || 0) + 1;
      // Resume de ce qui s'est passe avant la fenetre des 16 derniers echanges.
      const resumeTexte = lireResume(auth.uid, '2').texte;
      // L'ecart depuis la derniere conversation se calcule avant de le re-ecrire
      // (dernierContact est mis a jour plus bas, a la fin du traitement).
      const ecartContact = etatBL.dernierContact ? maintenant - etatBL.dernierContact : 0;
      const continuite = texteContinuite(ecartContact);

      if (histo.length === 0) {
        if (!etatBL.premierContact) etatBL.premierContact = maintenant;
        etatBL.sessions = (etatBL.sessions || 0) + 1;
        sauvegarderEtat(auth.uid, etatBL);
        histo._debut = maintenant;
        histo._continuite = continuite;
        histo.push({ role: 'system', content: '' });
        const histFichier = chargerHistorique(auth.uid, '2');
        const nbRestaurer = Math.min(histFichier.length, 10);
        if (nbRestaurer > 0) {
          const debutIdx = Math.max(0, histFichier.length - nbRestaurer);
          for (let i = debutIdx; i < histFichier.length; i++) {
            const e = histFichier[i];
            histo.push({ role: e.qui === 'moi' ? 'user' : 'assistant', content: e.texte });
          }
        }
      }

      // LE PROMPT SYSTEME EST REECRIT A CHAQUE MESSAGE.
      // C'est ce qui fait que BLAMUNE "vit" : l'heure avance pendant la
      // discussion, un surnom appris il y a 10 secondes est deja utilise,
      // l'humeur de l'utilisateur est prise en compte immediatement.
      // ===== RAG sur le chemin nominal : le savoir pertinent est calcule
      // APRES autoApprentissage, donc un fait appris a l'instant est deja
      // injectable dans le meme tour. Zero effet de bord : contexte vide
      // = prompt identique a avant.
      let savoirMode2 = '';
      try {
        savoirMode2 = typeof contexteSavoir === 'function' ? await contexteSavoir(msg) : '';
      } catch (e) {
        loggerErreur('savoir', 'contexte BLAMUNE: ' + (e && e.message));
      }
      histo[0].content =
        blocSysteme({
          memoire: memoire,
          etat: etatBL,
          debutSession: histo._debut || maintenant,
          resume: resumeTexte,
          intention: intentionDeMessage(msg),
          image: !!imageParts,
          savoir: savoirMode2
        }) + (histo._continuite || '');
      // Sources web (recherche serveur) : injectees apres le bloc systeme,
      // donc vues par n'importe quel fournisseur du pool, pas seulement
      // par Gemini (qui desactive meme son google_search quand on a deja
      // cherche, voir lib/ia/gemini.js).
      if (rechercheBloc) histo[0].content += '\n\n' + rechercheBloc;

      histo.push({ role: 'user', content: msgHisto, _lastTs: maintenant });
      while (histo.length > 50) histo.splice(1, 1);

      // Le temps passe aussi pendant la conversation : dernierContact = moment de cet echange.
      // On garde aussi le compteur de messages mis a jour juste au-dessus.
      try {
        etatBL.dernierContact = maintenant;
        if (!etatBL.premierContact) etatBL.premierContact = maintenant;
        sauvegarderEtat(auth.uid, etatBL);
      } catch (e) {}

      try {
        const reponse = await appelerGemini(msgHisto, histo, surDelta, imageParts);
        const texte = nettoyerReponse(reponse);
        histo.push({ role: 'assistant', content: texte, _lastTs: Date.now() });
        reponses = [texte];
      } catch (e) {
        loggerErreur('BLAMUNE', e.message);
        reponses = [await reponseSecours(msg, e)];
      }
    }

    const duree = Date.now() - debut;
    const stats = getStats();
    stats.messagesTotal++;
    if (mode === '1') stats.messagesMode1++;
    else stats.messagesMode2++;
    stats.tempsMoyen = Math.round(
      (stats.tempsMoyen * (stats.messagesTotal - 1) + duree) / stats.messagesTotal
    );

    // Save history (single batch write) — via la file sequentielle :
    // deux /send parallel ou un message proactif croise un /send ne
    // doivent pas s'effacer l'un l'autre.
    await avecHistorique(auth.uid, mode, (hist) => {
      const entreeMoi = { qui: 'moi', texte: msg, t: Math.floor(Date.now() / 1000) };
      if (imageParts) entreeMoi.image = true;
      hist.push(entreeMoi);
      reponses.forEach((r) =>
        hist.push({ qui: 'bot', texte: r, t: Math.floor(Date.now() / 1000) })
      );
    });

    // Taches de fond mode 2, lancees APRES la reponse : elles ne rallongent
    // jamais l'attente de l'utilisateur. Juste apres un 429, reporterTache
    // laisse la fenetre de quota gratuite se recharger avant de les lancer.
    if (mode === '2') {
      reporterTache(() => majResume(auth.uid, '2').catch((e) => loggerErreur('resume', e.message)));
      if (getConfig().memoire_extraction && !dejaAppris && nbMots >= 6) {
        reporterTache(() =>
          extraireAvecModele(auth.uid, msg).catch((e) => loggerErreur('extraction', e.message))
        );
      }
    }

    // Apprentissage des faits TROUVES sur le web : tache de fond (jamais
    // dans l'attente du visiteur), categorie 'recherche-web', source 'web',
    // 2 faits max indexes par recherche, deduplies par site et dates. Ils
    // reprennent du service via contexteSavoir / Qdrant comme tout savoir.
    if (recherchePourApprendre) {
      reporterTache(async () => {
        try {
          const faits = rechercheWeb.faitsAPrendre(recherchePourApprendre);
          for (const fait of faits) {
            savoirEnregistrer(fait.cle, fait.reponse, 'recherche-web', 'web');
          }
        } catch (e) {
          loggerErreur('recherche-web', 'apprentissage: ' + ((e && e.message) || e));
        }
      });
    }

    if (enFlux) {
      if (!coupe && !res.writableEnded && !res.destroyed) {
        // Commentaire SSE ignore par le client : sert de diagnostic
        // (modele utilise + duree totale de la requete).
        try {
          res.write(
            ':diag modele=' +
              (dernierModeleOkConnu() || '?') +
              ' duree=' +
              duree +
              'ms recherche=' +
              (rechercheBloc ? 'web' : 'non') +
              ' reflexion=' +
              (getReflexionRefusee() ? 'off-forcee' : 'off') +
              '\n\n'
          );
          res.write(
            'data: ' +
              JSON.stringify({ fin: true, etat: getEtat(), reponses, confiance: 'haute' }) +
              '\n\n'
          );
        } catch (e) {}
      }
      try {
        res.end();
      } catch (e) {}
    } else {
      res.json({ etat: getEtat(), reponses, confiance: 'haute' });
    }
  });
}

module.exports = { creerRouteSend };
