// ====================================================================
//  Protection CSRF (Cross-Site Request Forgery)
// ====================================================================
//  BLAMUNE s'authentifie par headers (X-UID, X-EGO, X-Jeton) et non par
//  cookies de session, donc un site tiers ne peut pas reutiliser
//  automatiquement les identifiants de l'utilisateur. Cependant, un
//  formulaire HTML classique peut envoyer une requete POST vers le
//  serveur : ce module ajoute un jeton CSRF lie a l'ego de l'utilisateur.
//
//  Principe : le jeton CSRF est derive de l'ego (secret par utilisateur)
//  + un secret serveur. Le client doit l'envoyer dans l'entete
//  X-CSRF-Token sur toute methode mutative (POST, DELETE, PUT, PATCH).
//
//  Les methodes GET/HEAD/OPTIONS sont exemptes.
// ====================================================================
'use strict';

const crypto = require('crypto');

// Secret serveur pour derivage (laisse vide => derive de NODE_ENV ou random)
const SERVER_SECRET = process.env.CSRF_SECRET || crypto.randomBytes(16).toString('hex');

// Jeton CSRF par ego (memoisation en memoire, perdure le temps du processus)
const tokensParEgo = new Map();

function derivage(ego, sel) {
  return crypto
    .createHmac('sha256', SERVER_SECRET + sel)
    .update(String(ego || ''))
    .digest('hex');
}

/** Genere (ou recupere) le jeton CSRF lie a un ego. */
function tokenPourEgo(ego) {
  if (!ego) return null;
  let entree = tokensParEgo.get(ego);
  if (!entree) {
    const sel = crypto.randomBytes(8).toString('hex');
    entree = { token: derivage(ego, sel), sel };
    tokensParEgo.set(ego, entree);
  }
  return entree.token;
}

/** Verifie un jeton CSRF envoye par le client. */
function verifierToken(ego, tokenClient) {
  if (!ego || !tokenClient) return false;
  const attendu = tokenPourEgo(ego);
  if (!attendu) return false;
  // Comparaison en temps constant
  const a = Buffer.from(attendu, 'utf8');
  const b = Buffer.from(String(tokenClient), 'utf8');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Chemins exemptees de CSRF (pas d'ego encore : inscription, connexion). */
const CHEMINS_EXEMPTES = ['/register', '/login', '/logout', '/invite/jeton', '/ping', '/health'];

function cheminExempte(path) {
  return CHEMINS_EXEMPTES.some((c) => path === c || path.startsWith(c + '/'));
}

/** Middleware Express : impose un CSRF valide sur les methodes mutatives. */
function middlewareCsrf(req, res, next) {
  const method = req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  if (cheminExempte(req.path)) return next();
  // L'ego arrive par X-EGO ; le token CSRF par X-CSRF-Token
  const ego = req.headers['x-ego'] || (req.body && req.body.ego) || '';
  const tokenClient = req.headers['x-csrf-token'] || (req.body && req.body._csrf) || '';
  if (!ego) {
    // Pas d'ego et pas exempte : on ne peut pas verifier le CSRF.
    return res.status(403).json({
      ok: false,
      message: 'Authentification requise.'
    });
  }
  if (!verifierToken(ego, tokenClient)) {
    return res.status(403).json({
      ok: false,
      message: 'Jeton CSRF manquant ou invalide.'
    });
  }
  next();
}

/** Etat pour /admin. */
function etat() {
  return { jetonsActifs: tokensParEgo.size };
}

/** Remise a zero (tests). */
function reinitialiser() {
  tokensParEgo.clear();
}

module.exports = { middlewareCsrf, tokenPourEgo, verifierToken, etat, reinitialiser };
