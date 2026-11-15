'use strict';
// =====================================================================
//  Sessions persistantes des comptes
// =====================================================================
//  L'ego d'un compte n'etait valable que 24 h apres la connexion
//  (server.js, extraireAuth). Sur l'application installee, il fallait donc
//  retaper son mot de passe chaque jour : c'est exactement le frottement
//  qu'on supprime ici.
//
//  Un jeton de session long (180 jours par defaut), un par appareil, est
//  remis a la connexion / l'inscription. Il est stocke HACHE (SHA-256)
//  dans le compte, jamais en clair cote serveur, et le client le renvoie
//  dans l'en-tete X-Session. La deconnexion revoque le jeton presente.
//
//  Format : v1.<sid 18 hex>.<secret 64 hex>. Le sid identifie l'entree,
//  le secret prouve la possession. Deux appareils ont deux sid : se
//  deconnecter d'un telephone ne coupe pas l'ordinateur.
// =====================================================================

const crypto = require('crypto');
const { egaleTimingSafe } = require('./timing');

// Duree de vie : 180 jours par defaut. SESSION_DUREE_MS existe pour les
// tests (une duree courte) ; SESSION_DUREE_JOURS pour l'exploitant.
const DUREE_MS =
  parseInt(process.env.SESSION_DUREE_MS || '', 10) ||
  (parseInt(process.env.SESSION_DUREE_JOURS || '', 10) || 180) * 86400000;

// Un compte ne garde pas un nombre illimite d'appareils : au-dela, le
// plus ancien est oublie (le telephone perdu n'a plus de session).
const MAX_PAR_COMPTE = 8;

// Meme forme que le jeton emis : un jeton tronque ou bricole ne declenche
// meme pas la recherche dans les comptes.
const FORMAT_JETON = /^v1\.([0-9a-f]{18})\.([0-9a-f]{64})$/;

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

function sessionsDe(compte) {
  if (!compte.sessions || typeof compte.sessions !== 'object') compte.sessions = {};
  return compte.sessions;
}

// Nettoie les entrees perimees au passage (appele a la connexion : une
// ecriture de comptes va suivre, le menage ne coute donc rien de plus).
function purgerSessions(compte, maintenant) {
  const sessions = sessionsDe(compte);
  for (const sid of Object.keys(sessions)) {
    const s = sessions[sid];
    if (!s || !s.h || !s.cree || maintenant - s.cree > DUREE_MS) delete sessions[sid];
  }
  return sessions;
}

function creerSession(compte, maintenant) {
  const t = maintenant || Date.now();
  const sessions = purgerSessions(compte, t);
  // Plafond : on oublie les plus anciennes, jamais la nouvelle.
  const sids = Object.keys(sessions).sort((a, b) => (sessions[a].cree || 0) - (sessions[b].cree || 0));
  while (sids.length >= MAX_PAR_COMPTE) {
    delete sessions[sids.shift()];
  }
  const sid = crypto.randomBytes(9).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  sessions[sid] = { h: hashSecret(secret), cree: t };
  return { jeton: 'v1.' + sid + '.' + secret, sid, expire: t + DUREE_MS };
}

// Rend { cle, compte, sid } si le jeton est valide et non perime, sinon
// null. Aucune ecriture ici : une requete authentifiee ne doit pas
// reecrire comptes.json a chaque appel.
function verifierSession(comptes, jeton, maintenant) {
  const m = FORMAT_JETON.exec(String(jeton || ''));
  if (!m) return null;
  const sid = m[1];
  const hash = hashSecret(m[2]);
  const t = maintenant || Date.now();
  for (const cle of Object.keys(comptes || {})) {
    const compte = comptes[cle];
    const s = compte && compte.sessions && compte.sessions[sid];
    if (!s || !s.h) continue;
    if (!egaleTimingSafe(s.h, hash)) continue;
    if (!s.cree || t - s.cree > DUREE_MS) return null;
    return { cle, compte, sid };
  }
  return null;
}

function revoquerSession(compte, sid) {
  if (!compte || !compte.sessions || !sid) return false;
  if (!Object.prototype.hasOwnProperty.call(compte.sessions, sid)) return false;
  delete compte.sessions[sid];
  return true;
}

module.exports = {
  DUREE_MS,
  MAX_PAR_COMPTE,
  creerSession,
  verifierSession,
  revoquerSession
};
