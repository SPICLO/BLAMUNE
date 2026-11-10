// ====================================================================
//  Securise — Centre de securite centralise
// ====================================================================
// Regroupement de toutes les regles de securite transverses :
//   - extensions de fichiers interdites (blocage serveur)
//   - validation stricte des uid (liste blanche + anti-traversee)
//   - en-tetes de securite HTTP (CSP, HSTS, X-Frame-Options, etc.)
//   - taux de requete par route (rate limit dedie)
// ====================================================================
'use strict';

const path = require('path');
const crypto = require('crypto');

// ------------------------------------------------------------------
// 1. FICHIERS / EXTENSIONS INTERDITES
// ------------------------------------------------------------------
const BLOCKED_EXT = new Set([
  '.env',
  '.ps1',
  '.bat',
  '.cmd',
  '.sh',
  '.exe',
  '.dll',
  '.so',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.log',
  '.tmp',
  '.bak',
  '.pem',
  '.key',
  '.crt',
  '.pfx',
  '.gitignore',
  '.dockerignore'
]);

const BLOCKED_NAMES = new Set([
  '.env',
  '.env.example',
  '.env.securise',
  'comptes.json',
  'config.json',
  'storage.json',
  'savoir.db',
  'savoir.txt',
  'savoir.sql',
  'replis.txt',
  '.gitignore',
  '.dockerignore',
  'security.md',
  'contributing.md',
  'changelog.md',
  'design.md',
  'product.md',
  'cloud.md',
  'keepalive.md'
]);

function estBloque(cheminRelatif) {
  const base = path.basename(cheminRelatif).toLowerCase();
  const ext = path.extname(cheminRelatif).toLowerCase();
  if (BLOCKED_NAMES.has(base)) return true;
  if (BLOCKED_EXT.has(ext)) return true;
  return false;
}

// ------------------------------------------------------------------
// 2. VALIDATION STRICTE DES UID
// ------------------------------------------------------------------
const RE_UID_COMPTE = /^u[0-9a-f]{12}$/;
const RE_UID_INVITE = /^inv_[0-9a-f]{24}$/;
const UID_MAX_LEN = 64;

function uidValide(uid) {
  if (typeof uid !== 'string' || !uid) return false;
  if (uid.length < 3 || uid.length > UID_MAX_LEN) return false;
  // Liste blanche : lettres, chiffres, _, ., -
  if (!/^[A-Za-z0-9_.\-]+$/.test(uid)) return false;
  if (uid.includes('..')) return false;
  // Format lisible : compte (u+12h) ou invite (inv_+24h)
  return RE_UID_COMPTE.test(uid) || RE_UID_INVITE.test(uid);
}

// ------------------------------------------------------------------
// 3. EN-TETES DE SECURITE HTTP
// ------------------------------------------------------------------
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()'
};

const CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data: https:; " +
  "connect-src 'self' ws: wss: https:; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self';";

function appliquerEnTetesSecurite(res) {
  Object.entries(SECURITY_HEADERS).forEach(([k, v]) => {
    res.setHeader(k, v);
  });
  res.setHeader('Content-Security-Policy', CSP);
  return res;
}

// ------------------------------------------------------------------
// 4. TAUX DE REQUETE PAR ROUTE (rate limit dedie)
// ------------------------------------------------------------------
const LIMITES_ROUTES = {
  send: { ip: 30, uid: 20 },
  login: { ip: 10 },
  register: { ip: 5 },
  admin: { ip: 5 },
  profil: { uid: 20 },
  historique: { uid: 30 },
  stats: { uid: 10 },
  statique: { ip: 120 },
  push: { uid: 5 },
  invite: { ip: 10 }
};

function limiterRoute(nomRoute) {
  return LIMITES_ROUTES[nomRoute] || {};
}

// ------------------------------------------------------------------
// 5. HASHAGE DE MOT DE PASSE (scrypt + sel)
// ------------------------------------------------------------------
const SCRYPT_PARAMS = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
  maxmem: 64 * 1024 * 1024
};
const SEL_LENGTH = 16;
const CLEF_LENGTH = 64;

function genererSel() {
  return crypto.randomBytes(SEL_LENGTH).toString('hex');
}

function hashMdpScrypt(mdp, sel) {
  const derive = crypto.scryptSync(mdp, sel, CLEF_LENGTH, SCRYPT_PARAMS);
  return sel + ':' + derive.toString('hex');
}

function verifierMdpScrypt(mdp, hacheStockee) {
  const sep = hacheStockee.indexOf(':');
  if (sep < 0) return false;
  const sel = hacheStockee.substring(0, sep);
  const hache = hacheStockee.substring(sep + 1);
  const derive = crypto.scryptSync(mdp, sel, CLEF_LENGTH, SCRYPT_PARAMS);
  return crypto.timingSafeEqual(Buffer.from(hache, 'hex'), derive);
}

// ------------------------------------------------------------------
// 6. GENERATION DE JETONS (nonce, invite, etc.)
// ------------------------------------------------------------------
function genererJeton(octets = 32) {
  return crypto.randomBytes(octets).toString('hex');
}

// ------------------------------------------------------------------
// 7. EXPORTS
// ------------------------------------------------------------------
module.exports = {
  estBloque,
  BLOCKED_EXT,
  BLOCKED_NAMES,
  uidValide,
  RE_UID_COMPTE,
  RE_UID_INVITE,
  SECURITY_HEADERS,
  CSP,
  appliquerEnTetesSecurite,
  LIMITES_ROUTES,
  limiterRoute,
  hashMdpScrypt,
  verifierMdpScrypt,
  genererSel,
  genererJeton,
  SCRYPT_PARAMS
};
