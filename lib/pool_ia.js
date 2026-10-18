// =====================================================================
//  Pool multi-fournisseur pour la couche compatible OpenAI
// =====================================================================
//  Objectif : personne ne sature plus. Quand le fournisseur principal
//  (API_PROVIDER/API_URL) renvoie 429/401/403/5xx, la cascade passe au
//  membre suivant du pool (API_POOL), et un fournisseur revenu est
//  reutilise en priorite (sticky) : un aller-retour perdu, zero.
//
//  Format d'API_POOL :
//    nom|url|cle|modele ; nom2|url2|cle2|modele2 ; ...
//  La cle est facultative (Ollama local n'en veut pas) : nom|url||modele.
//  Le membre "principal" est toujours en tete de liste ; il est fourni
//  par une fonction (membrePrincipal) appelee A CHAQUE ordre() : la config
//  de /config-api reste donc vivante (pas de reference perimee).
//
//  Ce module ne connait ni fetch ni le protocole : il decide QUI tente,
//  pas COMMENT appeler. Testable sans serveur : voir tests/pool_ia.test.js.
// =====================================================================
'use strict';

// Codes reseau qui signifient " membre temporairement inutilisable ".
const CODES_RESEAU = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'ENOTFOUND'];

function creerPoolIA({ sourcesEnv, membrePrincipal, cooldownMs, cooldownAuthMs, logger }) {
  const CD_STANDARD = cooldownMs > 0 ? cooldownMs : 60000; // 1 min : quotas, 5xx, reseau
  const CD_AUTH = cooldownAuthMs > 0 ? cooldownAuthMs : 600000; // 10 min : seance morte (401/403)

  // --- Parse de API_POOL -------------------------------------------------
  function parseSources(brut) {
    const sources = [];
    const blocs = String(brut || '').split(';');
    for (const bloc of blocs) {
      const champ = bloc.split('|').map((c) => c.trim());
      if (!bloc.trim()) continue;
      const nom = champ[0] || 'fournisseur-' + (sources.length + 1);
      const url = (champ[1] || '').replace(/\/+$/, '');
      const cle = champ[2] || '';
      const modele = champ[3] || '';
      if (!url || !modele) continue; // membre incomplet : ignore, jamais crash
      sources.push({ nom, url, cle, modele });
    }
    return sources;
  }

  const membresEnv = parseSources(sourcesEnv);

  // Cooldown : nom -> instant (epoch ms) jusqu'auquel il est exclu.
  const cooldown = new Map();
  // Sticky : dernier membre ayant VRAIMENT repondu ; on y revient en tete.
  let dernierOk = '';
  let rotation = 0;

  function membresMoinsPrincipal() {
    return membresEnv;
  }

  function tous() {
    // membrePrincipal() est appele ici, a chaque demande : la config reste
    // vivante (URL/cle/modele changes par /config-api sont repris).
    const principal = typeof membrePrincipal === 'function' ? membrePrincipal() : null;
    const liste = [];
    if (principal) liste.push(principal);
    for (const m of membresEnv) liste.push(m);
    return liste;
  }

  function actif() {
    return tous().length >= 2;
  }

  function disponible(arg) {
    const cd = cooldown.get(arg.nom);
    return !cd || cd <= arg.instant;
  }

  /** Membres tentables, sticky d'abord, puis rotation round-robin. */
  function ordre(instant) {
    const epoch = instant || Date.now();
    const membres = tous();
    const dispo = membres.filter((m) => disponible({ nom: m.nom, instant: epoch }));
    if (dispo.length === 0) return [];

    // Sticky : le dernier membre qui a VRAIMENT repondu revient en tete.
    if (dernierOk) {
      const idx = dispo.findIndex((m) => m.nom === dernierOk);
      if (idx > 0) {
        const [suivant] = dispo.splice(idx, 1);
        dispo.unshift(suivant);
      }
      return dispo;
    }

    // Sans sticky : principal toujours en tete ; les membres additionnels
    // tournent entre eux (round-robin) pour repartir la charge.
    const principalNom = membres[0] ? membres[0].nom : '';
    const principal = dispo.find((m) => m.nom === principalNom) || null;
    const reste = dispo.filter((m) => m.nom !== principalNom);
    if (reste.length > 1) {
      rotation = (rotation + 1) % reste.length;
      if (rotation > 0) reste.push(reste.shift());
    }
    return principal ? [principal].concat(reste) : reste;
  }

  function noteOk(nom) {
    dernierOk = nom;
    cooldown.delete(nom);
  }

  /** 401/403 = 10 min ; 429/5xx/reseau/timeout = 1 min ; config (400) = 0. */
  function noteEchec(nom, e, instant) {
    const epoch = instant || Date.now();
    let ms = 0;
    if (e) {
      if (e.statusCode === 401 || e.statusCode === 403) ms = CD_AUTH;
      else if (e.statusCode === 429) ms = CD_STANDARD;
      else if (e.statusCode >= 500) ms = CD_STANDARD;
      else if (
        !e.statusCode &&
        (CODES_RESEAU.indexOf(e.code || '') >= 0 || e.message === 'Timeout')
      )
        ms = CD_STANDARD;
    }
    if (ms > 0) cooldown.set(nom, epoch + ms);
    if (dernierOk === nom) dernierOk = '';
  }

  /** Etat lisible pour /health : { nom, cooldownMsRestant }. */
  function sante(instant) {
    const epoch = instant || Date.now();
    return tous().map((m) => {
      const cd = cooldown.get(m.nom);
      const restant = cd && cd > epoch ? cd - epoch : 0;
      return { nom: m.nom, modele: m.modele, cooldownMsRestant: restant };
    });
  }

  function taille() {
    return tous().length;
  }

  if (membresEnv.length && logger)
    logger('pool', membresEnv.length + ' membre(s) additionnel(s) charge depuis API_POOL');

  return {
    actif,
    ordre,
    noteOk,
    noteEchec,
    sante,
    taille,
    membresMoinsPrincipal,
    // Expose pour les tests (injection de maintenant faisait le reste).
    _parseSources: parseSources
  };
}

module.exports = { creerPoolIA, CODES_RESEAU };
