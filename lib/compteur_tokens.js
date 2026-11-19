// =====================================================================
//  Compteur de tokens : mesurer au lieu de deviner
// =====================================================================
//  Jusqu'ici les reponses des fournisseurs (usage / usageMetadata) etaient
//  jetees : impossible de savoir ce qu'un message coutait vraiment, ni de
//  verifier qu'un reglage de budget tenait ses promesses.
//
//  Ce module garde, par utilisateur :
//    - une fenetre glissante (60 s par defaut) : entree + sortie ;
//    - les totaux du jour, remis a zero au changement de jour.
//  Rien n'est ecrit sur disque : c'est un instrument de bord, pas une
//  statistique historique (comme les compteurs de 429).
//
//  `resume()` est expose par /stats (admin) et /health : les sondes
//  ignorent les champs qu'elles ne connaissent pas, l'ajout est sans
//  risque pour elles.
// =====================================================================
'use strict';

function entierPositif(valeur, defaut) {
  const n = parseInt(valeur || '', 10);
  return Number.isInteger(n) && n > 0 ? n : defaut;
}

function creerCompteurTokens(opts) {
  const o = opts || {};
  const maintenant = typeof o.maintenant === 'function' ? o.maintenant : Date.now;
  const fenetreMs = entierPositif(o.fenetreMs, 60000);
  const maxUsers = entierPositif(o.maxUsers, 2000);

  // uid -> etat
  const etats = new Map();

  const jourDe = (ts) => Math.floor(ts / 86400000);

  function nouvelEtat(ts) {
    return {
      fenetre: [], // [{ ts, entree, sortie }] sur fenetreMs
      entree: 0, // cumul depuis le demarrage
      sortie: 0,
      cache: 0, // tokens d'entree servis depuis le cache de prompt
      messages: 0,
      jour: jourDe(ts),
      jourEntree: 0,
      jourSortie: 0,
      jourCache: 0,
      jourMessages: 0,
      derniere: ts
    };
  }

  function verifierJour(e, ts) {
    if (e.jour !== jourDe(ts)) {
      e.jour = jourDe(ts);
      e.jourEntree = 0;
      e.jourSortie = 0;
      e.jourCache = 0;
      e.jourMessages = 0;
    }
  }

  function etatDe(uid, ts) {
    const cle = String(uid || '?');
    let e = etats.get(cle);
    if (!e) {
      e = nouvelEtat(ts);
      etats.set(cle, e);
    }
    verifierJour(e, ts);
    return e;
  }

  function elaguer(e, ts) {
    while (e.fenetre.length && ts - e.fenetre[0].ts >= fenetreMs) e.fenetre.shift();
  }

  /** Evince l'utilisateur le moins recemment vu (borne memoire). */
  function elaguerUtilisateurs(cleGardee) {
    if (etats.size <= maxUsers) return;
    let plusVieux = null;
    let clePlusVieux = null;
    for (const [cle, e] of etats) {
      if (cle === cleGardee) continue;
      if (!plusVieux || e.derniere < plusVieux.derniere) {
        plusVieux = e;
        clePlusVieux = cle;
      }
    }
    if (clePlusVieux !== null) etats.delete(clePlusVieux);
  }

  /**
   * Note un appel modele. `u` : { entree, sortie, total?, estime? }.
   * Un appel sans usage fourni (fournisseur muet) est compte a zero mais
   * reste visible via `messages`.
   */
  function noter(uid, u) {
    if (!u) return;
    const ts = maintenant();
    const e = etatDe(uid, ts);
    const entree = Math.max(0, Math.round(Number(u.entree) || 0));
    const sortie = Math.max(0, Math.round(Number(u.sortie) || 0));
    const cache = Math.max(0, Math.round(Number(u.cache) || 0));
    e.fenetre.push({ ts, entree, sortie, cache });
    elaguer(e, ts);
    e.entree += entree;
    e.sortie += sortie;
    e.cache += cache;
    e.messages += 1;
    e.jourEntree += entree;
    e.jourSortie += sortie;
    e.jourCache += cache;
    e.jourMessages += 1;
    e.derniere = ts;
    elaguerUtilisateurs(String(uid || '?'));
  }

  function resumeUtilisateur(uid, ts) {
    const e = etats.get(String(uid || '?'));
    if (!e) return null;
    verifierJour(e, ts);
    elaguer(e, ts);
    let fEntree = 0;
    let fSortie = 0;
    let fCache = 0;
    for (const p of e.fenetre) {
      fEntree += p.entree;
      fSortie += p.sortie;
      fCache += p.cache || 0;
    }
    const fenetre = { ms: fenetreMs, entree: fEntree, sortie: fSortie, appels: e.fenetre.length };
    const jour = { entree: e.jourEntree, sortie: e.jourSortie, appels: e.jourMessages };
    const total = { entree: e.entree, sortie: e.sortie, appels: e.messages };
    // `cache` n'apparait que si un fournisseur a vraiment signale des
    // tokens servis depuis le cache : la forme des mesures ne change pas
    // pour les fournisseurs muets.
    if (fCache > 0) fenetre.cache = fCache;
    if (e.jourCache > 0) jour.cache = e.jourCache;
    if (e.cache > 0) total.cache = e.cache;
    return { fenetre, jour, total, derniere: e.derniere };
  }

  /** Vue globale (admin). Inclut le top 5 des consommateurs du jour. */
  function resume() {
    const ts = maintenant();
    let entree = 0;
    let sortie = 0;
    let cache = 0;
    let messages = 0;
    let jourEntree = 0;
    let jourSortie = 0;
    let jourCache = 0;
    let jourMessages = 0;
    let fEntree = 0;
    let fSortie = 0;
    let fCache = 0;
    let actifsFenetre = 0;
    const top = [];
    for (const [cle, e] of etats) {
      verifierJour(e, ts);
      elaguer(e, ts);
      entree += e.entree;
      sortie += e.sortie;
      cache += e.cache;
      messages += e.messages;
      jourEntree += e.jourEntree;
      jourSortie += e.jourSortie;
      jourCache += e.jourCache;
      jourMessages += e.jourMessages;
      let fe = 0;
      let fs = 0;
      let fc = 0;
      for (const p of e.fenetre) {
        fe += p.entree;
        fs += p.sortie;
        fc += p.cache || 0;
      }
      fEntree += fe;
      fSortie += fs;
      fCache += fc;
      if (e.fenetre.length) actifsFenetre++;
      top.push({ uid: cle, jourEntree: e.jourEntree, jourSortie: e.jourSortie });
    }
    top.sort((a, b) => b.jourEntree - a.jourEntree);
    const fenetre = {
      ms: fenetreMs,
      entree: fEntree,
      sortie: fSortie,
      utilisateurs: actifsFenetre
    };
    const jour = { entree: jourEntree, sortie: jourSortie, appels: jourMessages };
    const total = { entree, sortie, appels: messages };
    if (fCache > 0) fenetre.cache = fCache;
    if (jourCache > 0) jour.cache = jourCache;
    if (cache > 0) total.cache = cache;
    return { fenetre, jour, total, utilisateurs: etats.size, top: top.slice(0, 5) };
  }

  function pourUtilisateur(uid) {
    return resumeUtilisateur(uid, maintenant());
  }

  function remiseAZero(uid) {
    if (uid === undefined) etats.clear();
    else etats.delete(String(uid));
  }

  return { noter, resume, pourUtilisateur, remiseAZero };
}

module.exports = { creerCompteurTokens };
