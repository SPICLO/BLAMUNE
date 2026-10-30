const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// Charge d'abord l'eventuel fichier .env : il peut modifier process.env
// avant que storage.js et server.js ne lisent les variables de configuration.
if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
}
const http = require('http');
const storage = require('./storage');
// Modules extraits de server.js (voir lib/). Chaque etat reste dans son
// module : ici on ne fait que brancher les appels.
const {
  checkRateLimit,
  checkUserRateLimit,
  purger: purgerRateLimits
} = require('./lib/rate_limit');
const { creerHistorique } = require('./lib/historique');
const { creerMemoire } = require('./lib/memoire');
const { creerConfigIA } = require('./lib/config_ia');
const { creerRoutesCompte } = require('./lib/routes/compte');
const { creerRoutesAdmin } = require('./lib/routes/admin');
const { creerRoutesConsultation } = require('./lib/routes/consultation');
const { creerRoutesStatique } = require('./lib/routes/statique');
const { creerRouteSend } = require('./lib/routes/send');
const { creerGemini, estQuota } = require('./lib/ia/gemini');
const { creerPoolIA } = require('./lib/pool_ia');
const { demarrerKeepalive } = require('./lib/keepalive');
const { creerCompression } = require('./lib/compression');
const { creerServiceBot } = require('./lib/service_bot');
const { creerSavoir } = require('./lib/savoir');
const { creerResume } = require('./lib/resume');
// Chercheur web serveur (DuckDuckGo, sans cle) : donne des SOURCES a TOUT
// le pool de modeles, au lieu de dependre du google_search de Gemini.
// Cache des resultats (30 min par defaut, CACHE_RECHERCHE_MS) : plusieurs
// visiteurs posant le meme sujet ne repercutent pas la meme facture.
const { creerRechercheWeb } = require('./lib/recherche_web');
const rechercheWeb = creerRechercheWeb({
  cacheMs: parseInt(process.env.CACHE_RECHERCHE_MS || '', 10) || 30 * 60 * 1000
});

// Gardiens anti-saturation :
//  - concurrence : plafond d'appels IA simultanes + file d'attente FIFO
//    (fail-open apres attente max : jamais un message perdu) ;
//  - tension : comptage des 429 et drapeau "mode eco" (fenetre terminee).
// Les deux se reglent par l'env (MAX_CONC / MAX_ATTENTE_MS / TENSION_*)
// et exposent etat() pour /admin.
const concurrence = require('./lib/concurrence');
const tension = require('./lib/tension');

const app = express();
// Render passe un reverse proxy devant le serveur : sans cette ligne,
// req.ip serait l'adresse du proxy (une seule pour tout le monde), et
// le moindre X-Forwarded-For forge par le client serait pris pour
// argent comptant. Avec trust proxy = 1 (un seul maillon de proxy),
// req.ip est l'adresse REELLE du client ; les tests locaux (pas de
// proxy) gardent 127.0.0.1.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 8080;
// Repertoire des donnees. Surchargeable par l'environnement pour lancer des
// tests sans jamais toucher aux vraies donnees (users/, comptes.json...).
const RACINE = process.env.BLAMUNE_DATA_DIR
  ? path.resolve(process.env.BLAMUNE_DATA_DIR)
  : __dirname;

// ==================== JOURNAL DES ERREURS ====================
// Sur Render la console est ephemere : on garde aussi les 500 dernieres
// erreurs sur disque pour pouvoir diagnostiquer un plantage apres coup.
const LOGS_DIR = path.join(RACINE, 'logs');
function loggerErreur(serie, message) {
  const ligne =
    new Date().toISOString() +
    ' [' +
    serie +
    '] ' +
    String(message == null ? '' : message)
      .replace(/\s+/g, ' ')
      .trim();
  console.error(ligne);
  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    const f = path.join(LOGS_DIR, 'erreurs.log');
    const contenu = (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') + '\n' : '') + ligne;
    const lignes = contenu.split('\n').filter(Boolean);
    const garde = lignes.length > 500 ? lignes.slice(-500) : lignes;
    fs.writeFileSync(f, garde.join('\n') + '\n', 'utf8');
  } catch (e) {}
}

// ==================== MIDDLEWARE ====================
// Limite a 10 mb : les photos (base64) passent par ce parser sur /send.
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Le parser JSON global reste serr (8 kb) : la route /admin/restore recoit
// des sauvegarde volumineuses et installe son propre parser limite a 50 mb.
app.use((req, res, next) => {
  if (req.path === '/admin/restore') return next();
  express.json({ limit: '8kb' })(req, res, next);
});

// Express 5 embarque body-parser 2.x : quand le corps est absent ou que
// aucun parser ne s'applique, req.body reste undefined (v4 fournissait
// {}) et toute route qui lirait req.body.x partait en 500 — vu au smoke
// sur /register du jour de la migration. On retablit le contrat : apres
// les deux parsers, req.body existe toujours.
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

// CORS + Security Headers
const SENSITIVE_FILES = [
  'comptes.json',
  'config.json',
  '.protection_hash.json',
  'stats.json',
  'erreurs.log'
];
// Assets publics : les fichiers ressources de site/, servis par le
// catcher wildcard. Pour eux, le Cache-Control global no-store est le
// contraire du but : en leur absence, serve-static installe son
// 'public, max-age=0' — revalide par ETag a chaque usage, sans jamais
// garder un vieux corps, et les JSON de l'API restent no-store.
const ASSETS_PUBLICS_RE =
  /\.(css|js|mjs|html?|svg|png|jpe?g|ico|txt|xml|json|map|webp|wasm|woff2?)$/i;
app.use((req, res, next) => {
  const reqPath = req.path.toLowerCase();
  if (SENSITIVE_FILES.some((f) => reqPath.endsWith(f))) return res.status(404).end();
  const origin = req.headers.origin || '';
  const allowed = [/localhost:\d+$/, /127\.0\.0\.1:\d+$/, /\.vercel\.app$/, /\.onrender\.com$/];
  let corsOrigin = '*';
  if (origin && origin !== 'null') {
    const ok = allowed.some((r) => r.test(origin));
    corsOrigin = ok ? origin : '';
  } else if (origin === 'null') {
    corsOrigin = '';
  }
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-UID, X-EGO, X-Jeton');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length');
  // no-store : le corps d'une reponse API change d'un utilisateur a
  // l'autre, aucun entrepot ne doit la garder. Les assets publics de
  // site/ y derogent (voir ASSETS_PUBLICS_RE ci-dessus) : leur corps ne
  // change qu'au deploiement, et l'ETag revalide a chaque usage.
  const assetPublic =
    (req.method === 'GET' && reqPath === '/') ||
    (req.method === 'GET' && ASSETS_PUBLICS_RE.test(reqPath) && !reqPath.startsWith('/admin'));
  if (!assetPublic) res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Fonctions puissantes interdites, sauf la dictée vocale (site/app.js
  // écrite dans le champ par SpeechRecognition, qui dépend du micro) :
  // geolocalisation et caméra n'ont aucun usage ici.
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(self), payment=()');
  // CSP serree : tout le code est servi depuis 'self' (ici-meme) ; le seul
  // appel sortant legitime est le palier de secours direct vers
  // text.pollinations.ai (site/ia-secours.js, sans cle ni script externe).
  // Les domains Hugging Face et 'wasm-unsafe-eval' n'existaient que pour
  // l'ancien IA hors-ligne WebLLM, retire : sans eux, toute injection du
  // style "charger du code ou parler a l'etranger" est refusee par la page.
  // frame-ancestors renforce X-Frame-Options (convertit en erreur dans les
  // navigateurs modernes), base-uri et form-action ferment les messages
  // qui tenteraient de rediriger une soumission ou une balise <base>.
  res.setHeader(
    'Content-Security-Policy',
    // 'unsafe-inline' sur style-src SEULEMENT : index.html pose 12 styles
    // inline (style="display: none" des bascules d'affichage). Les retirer
    // exigerait de les migrer en classes CSS — progression a part. script-src
    // n'a JAMAIS d'unsafe-inline : le JS inline reste interdit.
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://text.pollinations.ai; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Compression des reponses lisibles (zlib natif, zero dependance npm) :
// les SSE, plages 206, corps courts et types binaires passent tels quels
// (gardes-fous detailles dans lib/compression.js). Place APRES le bloc
// ci-dessus, qui decide deja quelles reponses portent un Cache-Control.
app.use(creerCompression({ logger: loggerErreur }));

// ==================== CONFIG ====================
// Fournisseur, liste de modeles et rotation : implementation dans
// lib/config_ia.js.
//
// onModeleOk est un callback volontairement EVALU PLUS TARD : il touche
// stats et sauverStats, definis plus bas. Injecter un callback plutot que
// les objets evite d'avoir a deplacer tout le bloc STATE ici.
const {
  config,
  providerOpenAI,
  modeleActif,
  ordreModeles,
  memoriserModeleOk,
  restaureModeleOk,
  dernierModeleOkConnu,
  persisterConfig
} = creerConfigIA({
  racine: RACINE,
  onModeleOk: (modele) => {
    // Survit a un redemarrage : stats.json est ecrit sur disque tout de suite.
    stats.dernierModeleOk = modele;
    stats.modeleOkDate = new Date().toISOString();
    sauverStats();
  },
  loggerErreur
});

// =====================================================================
//  Pool multi-fournisseur : voir lib/pool_ia.js.
//
//  Anti-saturation : le fournisseur principal est tente en premier, puis
//  les membres d'API_POOL ("nom|url|cle|modele;..."). Un membre qui renvoie
//  429/401/403/5xx repart en cooldown et un autre prend le relais ; celui
//  qui repond devient prioritaire (sticky). membrePrincipal est une
//  FONCTION : appelee a chaque ordre(), elle relit la config vivante (URL/
//  cle changes par /config-api, pris en compte sans redemarrage).
//
//  iaOpenai (fournisseurs compatibles OpenAI, lib/ia/openai.js) est cree
//  plus bas, apres le transport gemini dont il reutilise des helpers.
//  membrePrincipal ne le lit qu'au moment de la demande (ordres faits
//  pendant les requetes), jamais a l'initialisation : l'ordre de
//  declaration inverse est donc sans risque.
// =====================================================================
let iaOpenai = null;
function membrePrincipal() {
  // Le membre "principal" represente le fournisseur ACTIF au format
  // compatible OpenAI. Si le fournisseur est Gemini pur, rien n'est valide
  // en POST sur {base}/chat/completions : renvoyer null evite au pilier et
  // a l'ordre du pool d'essayer une adresse morte dans chaque requete
  // (un aller-retour 404 perdu avant d'atteindre le premier membre reel).
  if (!providerOpenAI()) return null;
  return {
    nom: 'principal',
    url: iaOpenai.baseOpenAI(),
    cle: config.api_key,
    modele: modeleActif()
  };
}
const pool = creerPoolIA({
  sourcesEnv: process.env.API_POOL || '',
  membrePrincipal,
  cooldownMs: parseInt(process.env.API_POOL_COOLDOWN_MS || '', 10) || 60000,
  cooldownAuthMs: parseInt(process.env.API_POOL_COOLDOWN_AUTH_MS || '', 10) || 600000,
  logger: loggerErreur
});

// ==================== DATA ====================
const COMPTES_PATH = path.join(RACINE, 'comptes.json');
const USERS_DIR = path.join(RACINE, 'users');
let comptes = {};
try {
  if (fs.existsSync(COMPTES_PATH)) {
    comptes = JSON.parse(fs.readFileSync(COMPTES_PATH, 'utf8'));
  }
} catch (e) {
  loggerErreur('comptes', 'lecture: ' + e.message);
}

function sauvegarderComptes() {
  try {
    const tmpPath = COMPTES_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(comptes, null, 2), 'utf8');
    fs.renameSync(tmpPath, COMPTES_PATH);
  } catch (e) {}
  if (storage.estConfigure()) storage.setComptes(comptes);
}

// ==================== STATE ====================
let etat = 'demarrage';
let modeParUser = {};
let apiHistoriqueParUser = {};
let connexionsActives = {};
let stats = {
  messagesTotal: 0,
  messagesMode1: 0,
  messagesMode2: 0,
  sessionsTotal: 0,
  demarrages: 0,
  tempsMoyen: 0,
  demarrage: new Date().toISOString()
};

// Les stats repartaient de zero a chaque demarrage : on les garde sur disque.
function chargerStats() {
  try {
    const f = path.join(RACINE, 'stats.json');
    if (fs.existsSync(f)) {
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (s && typeof s === 'object') stats = Object.assign({}, stats, s);
    }
  } catch (e) {
    loggerErreur('stats', e.message);
  }
  stats.demarrage = new Date().toISOString();
}

function sauverStats() {
  try {
    fs.writeFileSync(path.join(RACINE, 'stats.json'), JSON.stringify(stats, null, 2), 'utf8');
  } catch (e) {}
}

chargerStats();
// Apres un redemarrage on repart du modele qui repondait avant.
restaureModeleOk(stats.dernierModeleOk);

// ==================== ALERTES ====================
// Avant : quand tout casse, la seule trace est une ligne dans /admin/logs.
// Desormais l'etat est expose dans /stats et /admin/data, et affiche en
// banniere rouge sur le dashboard admin.
let alertes = { quota: null, technique: null, derniereResolution: null };
function alerter(type, message) {
  const maintenant = new Date().toISOString();
  const a = alertes[type];
  if (a) {
    a.compteur++;
    a.derniere = message;
    a.vu = maintenant;
  } else {
    alertes[type] = { debut: maintenant, vu: maintenant, compteur: 1, message };
    loggerErreur('alerte', (type === 'quota' ? 'QUOTA' : 'MODELE') + ' : ' + message);
  }
}
function resoudreAlertes() {
  ['quota', 'technique'].forEach((type) => {
    if (!alertes[type]) return;
    alertes.derniereResolution = {
      type,
      debut: alertes[type].debut,
      fin: new Date().toISOString(),
      message: alertes[type].message
    };
    loggerErreur(
      'alerte',
      (type === 'quota' ? 'QUOTA' : 'MODELE') + ' : resolu ' + alertes.derniereResolution.fin
    );
    alertes[type] = null;
  });
}
function etatAlertes() {
  return {
    quota: alertes.quota,
    technique: alertes.technique,
    derniereResolution: alertes.derniereResolution
  };
}
function etatModele() {
  return {
    principal: config.api_model,
    actif: modeleActif(),
    reussi: dernierModeleOkConnu(),
    ordre: ordreModeles()
  };
}

// ==================== RATE LIMITING ====================
// Implementation dans lib/rate_limit.js (fenetre glissante, purge periodique).

// ==================== AUTH ====================
function getIp(req) {
  // req.ip est resolve par express selon trust proxy (un maillon : voir
  // app.set('trust proxy') ci-dessus). L'ancienne version lisait
  // X-Forwarded-For en brut : chaque requete pouvait se forger une
  // nouvelle "ip" et reinitialiser sa cle de rate limit a l'infini.
  return req.ip || '127.0.0.1';
}

// Un uid est fabrique par ce serveur : invite = 'inv_' + 24 hex, compte =
// 'u' + 12 hex (meme regle que la suppression admin, lib/routes/admin.js).
// Tout uid qui ne repond pas a ces formes ne peut pas etre legitime :
// l'accepter serait laisser un 'inv_x/../../victime' prendre l'identite
// d'un dossier tier.
const FORMAT_UID = /^(inv_[0-9a-f]{24}|u[0-9a-f]{12})$/;

function extraireAuth(req) {
  // Express 5 rend un TABLEAU pour ?uid=a&uid=b, et un corps JSON peut
  // porter un nombre : String() normalise le tout avant les tests, sinon
  // uid.startsWith leve une TypeError et chaque route authentifiee
  // repond un 500 HTML.
  let uid = String(req.headers['x-uid'] || req.query.uid || req.body?.uid || '');
  let ego = String(req.headers['x-ego'] || req.query.ego || req.body?.ego || '');
  if (ego) {
    const maintenant = Date.now();
    for (const cle of Object.keys(comptes)) {
      if (comptes[cle].ego === ego) {
        if (comptes[cle].tokenCree) {
          const age = (maintenant - new Date(comptes[cle].tokenCree).getTime()) / 3600000;
          if (age > 24) return { uid: '', ego: '' };
        }
        uid = comptes[cle].uid;
        break;
      }
    }
  }
  // La liste blanche DOIT se trouver ici, avant dossierUser : c'est la
  // seule garde qui interdit un '.' / un separateur dans l'identite. En
  // amont de toutes les lectures et ecritures de dossier utilisateur.
  if (uid && !FORMAT_UID.test(uid)) return { uid: '', ego: '' };
  if (uid && !uid.startsWith('inv_') && !ego) return { uid: '', ego: '' };
  // Jeton invite : un uid invite avec enregistrement n'est accepte QUE
  // muni de son jeton (possession du uid ne suffit plus).
  if (uid && uid.startsWith('inv_')) {
    const enregistrement = lireJetonInvite(uid);
    if (enregistrement) {
      const jeton = req.headers['x-jeton'] || req.body?.jeton || req.query?.jeton || '';
      if (!jeton || hashJeton(jeton) !== enregistrement.h) return { uid: '', ego: '' };
    }
    // Pas d'enregistrement : invite creee avant les jetons, on laisse passer
    // (migration sans deconnexion ; le client l'echange au chargement).
  }
  return { uid, ego };
}

// ==================== JETON INVITE ====================
// Chaque invite recoit un jeton secret de 256 bits, conserve HACHE cote
// serveur : le uid devient une simple identite. Une invite d'avant cette
// fonction n'a aucun enregistrement : elle continue de marcher au uid seul,
// puis le client l'echange contre un vrai jeton via POST /invite/jeton.
const FICHIER_INVITES = path.join(RACINE, 'invites.json');

function chargerInvites() {
  try {
    if (fs.existsSync(FICHIER_INVITES)) {
      const brut = JSON.parse(fs.readFileSync(FICHIER_INVITES, 'utf8'));
      if (brut && typeof brut === 'object') return brut;
    }
  } catch (e) {}
  return {};
}

let invitesJeton = chargerInvites();

function ecrireInvites() {
  try {
    // Oubli des invites inactives depuis plus de 30 jours.
    const seuil = Date.now() - 30 * 86400000;
    const propre = {};
    for (const u of Object.keys(invitesJeton)) {
      const e = invitesJeton[u];
      if (e && e.h && e.c >= seuil) propre[u] = e;
    }
    invitesJeton = propre;
    fs.writeFileSync(FICHIER_INVITES, JSON.stringify(propre), 'utf8');
  } catch (e) {}
  storage.declencherSauvegarde();
}

function hashJeton(jeton) {
  return crypto.createHash('sha256').update(String(jeton)).digest('hex');
}

function lireJetonInvite(uid) {
  const e = invitesJeton[uid];
  return e && typeof e.h === 'string' ? e : null;
}

function enregistrerJetonInvite(uid, jeton) {
  invitesJeton[uid] = { h: hashJeton(jeton), c: Date.now() };
  ecrireInvites();
}

// ==================== SAUVEGARDE COMPLETE ====================
// Une copie de tout ce qui doit survivre a la perte de l'instance Render :
// comptes, jetons d'invite, savoir, vocabulaire, stats et l'integralite de
// users/ (memoire, historique, etat, resumes, extractions). Servie en
// telechargement par /admin/backup, restauree par /admin/restore, et
// poussee dans le cloud quand JSONBIN_API_KEY est defini.
// La source de verite du savoir (SQLite) est sauvegardee sous forme de DUMP
// SQL dans l'entree "savoir.sql" (voir creerSauvegarde) : un fichier SQLite
// est binaire et la sauvegarde applicative ne manipule que du texte. Le
// fichier savoir.txt reste dans la liste : c'est l'export lisible par le bot
// Windows local et par git.
const FICHIERS_RACINE = [
  'comptes.json',
  'invites.json',
  'savoir.txt',
  'vocabulaire.txt',
  'replis.txt',
  'stats.json'
];
const CLE_SAVOIR_SQL = 'savoir.sql';
// config.json (cle API) et logs/ ne quittent jamais le serveur.
const CHEMIN_SAUVEGARDE =
  /^(comptes\.json|invites\.json|savoir\.sql|savoir\.txt|vocabulaire\.txt|replis\.txt|stats\.json|users\/[A-Za-z0-9_\-]{1,64}\/[A-Za-z0-9_.\-]{1,64})$/;
const TAILLE_MAX_FICHIER = 2 * 1024 * 1024;
const TAILLE_MAX_TOTALE = 40 * 1024 * 1024;

function creerSauvegarde() {
  const fichiers = {};
  for (const nom of FICHIERS_RACINE) {
    try {
      const f = path.join(RACINE, nom);
      if (fs.existsSync(f)) fichiers[nom] = fs.readFileSync(f, 'utf8');
    } catch (e) {}
  }
  // Source de verite du savoir : dump SQL (texte), pas le fichier binaire.
  try {
    fichiers[CLE_SAVOIR_SQL] = savoirDb.exporterSql();
  } catch (e) {}
  let total = 0;
  try {
    if (fs.existsSync(USERS_DIR)) {
      for (const d of fs.readdirSync(USERS_DIR, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        let noms = [];
        try {
          noms = fs.readdirSync(path.join(USERS_DIR, d.name));
        } catch (e) {
          continue;
        }
        for (const nom of noms) {
          const rel = 'users/' + d.name + '/' + nom;
          if (!CHEMIN_SAUVEGARDE.test(rel)) continue;
          try {
            const f = path.join(USERS_DIR, d.name, nom);
            const st = fs.statSync(f);
            if (!st.isFile() || st.size > TAILLE_MAX_FICHIER) continue;
            if (total + st.size > TAILLE_MAX_TOTALE) continue;
            fichiers[rel] = fs.readFileSync(f, 'utf8');
            total += st.size;
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
  return {
    format: 'blamune-sauvegarde-1',
    date: new Date().toISOString(),
    stats: stats,
    fichiers: fichiers
  };
}

function appliquerSauvegarde(snap) {
  if (!snap || typeof snap !== 'object' || snap.format !== 'blamune-sauvegarde-1')
    throw new Error('format de sauvegarde inconnu');
  if (!snap.fichiers || typeof snap.fichiers !== 'object' || Array.isArray(snap.fichiers))
    throw new Error('liste de fichiers manquante');
  const cles = Object.keys(snap.fichiers);
  if (cles.length === 0) throw new Error('sauvegarde vide');
  // Validation de tous les chemins AVANT la moindre ecriture.
  let total = 0;
  for (const rel of cles) {
    if (typeof rel !== 'string' || !CHEMIN_SAUVEGARDE.test(rel))
      throw new Error('chemin refuse: ' + String(rel).substring(0, 60));
    const contenu = snap.fichiers[rel];
    if (typeof contenu !== 'string') throw new Error('contenu invalide: ' + rel);
    total += Buffer.byteLength(contenu);
    if (total > TAILLE_MAX_TOTALE) throw new Error('sauvegarde trop volumineuse');
  }
  const racine = path.resolve(RACINE);
  let ecrits = 0;
  for (const rel of cles) {
    if (rel === CLE_SAVOIR_SQL) continue; // dump SQL : applique en base, pas ecrit sur disque
    const abs = path.resolve(racine, rel);
    if (abs.indexOf(racine + path.sep) !== 0) throw new Error('hors racine: ' + rel);
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, snap.fichiers[rel], 'utf8');
      ecrits++;
    } catch (e) {
      throw new Error('ecriture impossible (' + rel + '): ' + e.message);
    }
  }
  // Restauration du savoir. Deux cas :
  //  - le dump SQL est present : c'est la source de verite, on rejoue
  //    exactement son contenu (les suppressions sont donc appliquees) ;
  //  - seul savoir.txt est present (sauvegarde ancienne, edition manuelle) :
  //    on fusionne, pour ne jamais perdre une connaissance.
  let savoirRestaure = false;
  if (typeof snap.fichiers[CLE_SAVOIR_SQL] === 'string') {
    try {
      const n = savoirDb.importerSql(snap.fichiers[CLE_SAVOIR_SQL]);
      savoirRestaure = true;
      console.log('[BLAMUNE] Savoir restaure depuis le dump SQL : ' + n + ' entrees');
    } catch (e) {
      loggerErreur('savoir-db', 'import SQL: ' + e.message);
    }
  }
  if (cles.indexOf('savoir.txt') >= 0) {
    try {
      const n = savoirDb.importerFichier(path.join(RACINE, 'savoir.txt'));
      console.log('[BLAMUNE] Savoir : ' + n + ' lignes fusionnees depuis savoir.txt');
    } catch (e) {
      loggerErreur('savoir-db', 'reimport: ' + e.message);
    }
  }
  if (savoirRestaure) {
    exporterSavoir();
  }
  if (savoirRestaure || cles.indexOf('savoir.txt') >= 0) chargerSavoirSecours();
  // Rechargement immediat : aucun redemarrage necessaire.
  try {
    comptes = JSON.parse(fs.readFileSync(COMPTES_PATH, 'utf8'));
  } catch (e) {}
  invitesJeton = chargerInvites();
  if (snap.stats && typeof snap.stats === 'object') {
    stats = Object.assign({}, stats, snap.stats);
    stats.demarrage = new Date().toISOString();
    restaureModeleOk(stats.dernierModeleOk);
  }
  if (storage.estConfigure()) storage.setComptes(comptes);
  return ecrits;
}

// Ancien format sha256(mdp + sel) : trop rapide a casser hors ligne.
// Nouveau format scrypt (derive natif Node) : "scrypt$N$r$p$hash", le sel
// reste dans compte.sel. Un ancien compte passe encore en legacy une derniere
// fois a la connexion, puis son hash est immediatement remplace par scrypt.
function hashMdp(mdp, sel) {
  return crypto
    .createHash('sha256')
    .update(mdp + sel)
    .digest('hex');
}

const SCRYPT_N = 16384,
  SCRYPT_R = 8,
  SCRYPT_P = 1;
const SCRYPT_OPTS = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 };

function hashMdpScrypt(mdp, sel) {
  const h = crypto.scryptSync(String(mdp), String(sel), 64, SCRYPT_OPTS);
  return 'scrypt$' + SCRYPT_N + '$' + SCRYPT_R + '$' + SCRYPT_P + '$' + h.toString('hex');
}

function verifierMdp(mdp, compte) {
  const h = compte && compte.hash;
  if (!h) return false;
  if (String(h).indexOf('scrypt$') === 0) {
    const p = String(h).split('$');
    const N = parseInt(p[1], 10),
      r = parseInt(p[2], 10),
      pr = parseInt(p[3], 10);
    const attendu = p[4] || '';
    if (!N || !r || !pr || attendu.length !== 128) return false;
    let obtenu;
    try {
      obtenu = crypto.scryptSync(String(mdp), String(compte.sel || ''), 64, {
        N,
        r,
        p: pr,
        maxmem: 64 * 1024 * 1024
      });
    } catch (e) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(attendu, 'hex'), obtenu);
  }
  // Legacy : comparaison en temps constant.
  const attendu = Buffer.from(String(h), 'hex');
  const obtenu = Buffer.from(hashMdp(mdp, compte.sel || ''), 'hex');
  return attendu.length === 32 && obtenu.length === 32 && crypto.timingSafeEqual(attendu, obtenu);
}

// Migration : appelee au moment ou le mot de passe legacy vient de passer.
function rehacherMdp(compte, mdp) {
  compte.sel = crypto.randomBytes(16).toString('hex');
  compte.hash = hashMdpScrypt(mdp, compte.sel);
}

function genererEgo() {
  return crypto.randomBytes(12).toString('hex');
}

function extraireChamp(req, champ) {
  if (req.body && req.body[champ]) return req.body[champ];
  if (req.query && req.query[champ]) return req.query[champ];
  return '';
}

// ==================== USER DIR ====================
// Implementation dans lib/memoire.js. USERS_DIR est defini plus haut, dans
// CONFIG : c'est le seul point de contact avec le disque.
const { dossierUser, lireMemoire, ecrireMemoire, sauvegarderMemoireComplete } = creerMemoire({
  usersDir: USERS_DIR,
  storage
});

// ==================== AUTO-APPRENTISSAGE BLAMUNE ====================
// Implementation dans lib/auto_apprentissage.js ; le cablage se trouve plus
// bas, apres le savoir : l'apprentissage immediat ecrit aussi dans la base
// de connaissances ("retiens que tokyo est la capitale du japon").

// ==================== HISTORIQUE ====================
// Implementation dans lib/historique.js, cablee ici parce qu'elle a besoin
// de dossierUser() ci-dessus.
const { cheminHistorique, chargerHistorique, sauvegarderHistorique, avecHistorique } =
  creerHistorique({
    dossierUser,
    storage
  });

// Transport Gemini, historique envoye au modele, reprise sur erreur et quota :
// implementation dans lib/ia/gemini.js.
//
// Ce module detient des etats que le reste de la couche IA doit lire et
// ecrire : l'instant du dernier 429 et le drapeau "thinkingConfig refuse".
// C'est pourquoi il expose marquerQuota / instantDernierQuota /
// resteFenetreQuota / reflexionRefusee plutot que des variables.
const {
  HISTO_API_MAX,
  HISTO_AFFICHAGE_MAX,
  limiterHisto,
  nbEchanges,
  construireContenus,
  noterErreurGemini,
  optionsGemini,
  outillageUtile,
  corpsGemini,
  refusChamp,
  texteDepuisReponse,
  urlGemini,
  requeter,
  erreurRetentable,
  tentable,
  delaiIndique,
  retryApresDepuisEnTete,
  marquerQuota,
  instantDernierQuota,
  resteFenetreQuota,
  reflexionDejaRefusee,
  reporterTache,
  attendre
} = creerGemini({
  getConfig: () => config,
  providerOpenAI
});

// =====================================================================
//  Fournisseurs compatibles OpenAI (Groq, OpenRouter, Ollama...) :
//  implementation dans lib/ia/openai.js. Angles morts occupes ici :
//  le transport gemini (requeter, delaiIndique, marquerQuota, limiter/
//  HISTO_API_MAX), les alertes et le pool. iaOpenai est deja referencé
//  par membrePrincipal() plus haut : l'affectation doit rester avant le
//  demarrage du serveur, ce qui est le cas (toute creation sous forme de
//  top-level se fait dans l'ordre du fichier).
// =====================================================================
iaOpenai = require('./lib/ia/openai').creerOpenai({
  getConfig: () => config,
  getPool: () => pool,
  requeter,
  limiterHisto,
  HISTO_API_MAX,
  nbEchanges,
  marquerQuota,
  resoudreAlertes,
  memoriserModeleOk,
  ordreModeles,
  delaiIndique,
  alerter,
  loggerErreur
});
// ============ SERVICE BOT C++ (LOCAL / CLOUD) ============
// La mise en relation avec le conteneur du bot (BOT_SERVICE_URL) vit dans
// lib/service_bot.js, avec son cache LRU des reponses toutes faites.
// requeterHttp est exporte du module : les embeddings Gemini l'utilisent aussi.
const serviceBot = creerServiceBot({ loggerErreur });
const { requeterHttp } = serviceBot;

// =====================================================================
//  Savoir + cascade de secours (lib/savoir.js) : base SQLite, sync au
//  demarrage, index Qdrant, embeddings, banque de replis. La creation
//  ouvre la base et lance les synchros de fond, comme l'ancien bloc de
//  server.js. La phase de restauration (appliquerSauvegarde plus bas)
//  reutilise exporterSavoir / chargerSavoirSecours : ne jamais ruber
//  l'ordre de declaration.
// =====================================================================
const savoir = creerSavoir({
  racine: RACINE,
  dossierDepot: __dirname,
  loggerErreur,
  requeterHttp,
  appelerBotLocal: serviceBot.appelerBotLocal
});
const savoirDb = savoir.savoirDb;
const sansAccentsDB = savoir.sansAccentsDB;
const savoirEnregistrer = savoir.savoirEnregistrer;
const reponseSecours = savoir.reponseSecours;
const exporterSavoir = savoir.exporterSavoir;
const chargerSavoirSecours = savoir.chargerSavoirSecours; // Tous les modeles en meme temps (vu en live a 22h10) : la cascade rend la
// main et l'utilisateur a droit a "probleme technique". On prefere attendre le
// rechargement de la fenetre gratuite puis repasser la cascade UNE fois.
// Cap d'attente (ms) : surchargeable en test pour ne pas rallonger la suite.
const QUOTA_ATTENTE_MAX = parseInt(process.env.QUOTA_ATTENTE_MAX_MS || '', 10) || 70000;
// Par contre un MESSAGE ne doit jamais figer l'utilisateur : si Google
// demande d'attendre bien plus longtemps que ce seuil, on rend la main
// tout de suite avec le message "quota sature" (les taches de fond, elles,
// gardent la longue attente de QUOTA_ATTENTE_MAX).
const QUOTA_ATTENTE_MSG_MAX = parseInt(process.env.QUOTA_ATTENTE_MSG_MS || '', 10) || 10000;

// ==================== AUTO-APPRENTISSAGE BLAMUNE ====================
// Implementation dans lib/auto_apprentissage.js, cablee ici APRES le savoir :
// l'apprentissage immediat ecrit aussi dans la base de connaissances
// (savoirEnregistrer, declaree ci-dessus). lireEtat / sauvegarderEtat sont
// des declarations de fonctions hissees : les passer par reference ici ne
// depend pas de leur place dans le fichier.
const { autoApprentissage, nettoyerValeur, PAS_UN_NOM, MOOD_MOTS, MOIS_FR } =
  require('./lib/auto_apprentissage').creerAutoApprentissage({
    lireMemoire,
    sauvegarderMemoireComplete,
    lireEtat,
    sauvegarderEtat,
    savoirEnregistrer
  });

// estQuota vit dans lib/ia/gemini.js (partagee avec lib/ia/openai.js).

// Attente avant la seconde passe : le "retry in 45s" de Google ou le temps
// restant de la fenetre d'une minute, on prend le plus long des deux (borne).
function delaiAvantNouvellePasse(erreur) {
  const indique = delaiIndique(erreur) || 0;
  const resteFenetre = resteFenetreQuota();
  const d = Math.max(indique, resteFenetre);
  return Math.min(Math.max(d, 500), QUOTA_ATTENTE_MAX);
}

// // --- Reponse classique : tout d'un coup (repli si le flux echoue) ---
// `patient` : appel en tache de fond, il peut attendre le delai demande par
// Google ; sinon on laisse la cascade changer de modele (chaque modele a son
// propre quota) plutot que de faire patienter l'utilisateur 45 secondes.
// `avecOutils` : la recherche web n'est demandee QUE par les messages de
// conversation (appelerGemini) ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â jamais par resume/extraction, pour ne pas
// facturer une recherche web a chaque tache de fond.
async function modeleClassique(modele, contents, budget, patient, avecOutils) {
  const sansReflexion = !reflexionDejaRefusee();
  const b = budget || { n: 1 };
  try {
    return await modeleClassiqueBrut(modele, contents, sansReflexion, avecOutils);
  } catch (e) {
    // Champ refuse par le modele : on le retire et on n'essaie plus jamais.
    if (e && e.recherche) return modeleClassiqueBrut(modele, contents, sansReflexion, avecOutils);
    if (e && e.reflexion) return modeleClassiqueBrut(modele, contents, false, avecOutils);
    const delai = delaiIndique(e);
    // Tout 429 remet les taches de fond en veille, meme sans "retry in"
    // ("Resource has been exhausted" n'en indique pas).
    if (delai || (e && e.statusCode === 429)) {
      marquerQuota();
      noterErreurGemini(e);
    }
    if (erreurRetentable(e)) {
      if (!patient && delai > 3000) throw e; // quota long : autre modele
      if (tentable(b)) {
        loggerErreur(
          'gemini',
          modele +
            ' -> HTTP ' +
            (e.statusCode || e.code || '?') +
            ' ' +
            e.message +
            ' (nouvelle tentative)'
        );
        await attendre(Math.min(delai || 600, patient ? 60000 : 3000));
        return modeleClassiqueBrut(modele, contents, sansReflexion, avecOutils);
      }
    }
    throw e;
  }
}

function modeleClassiqueBrut(modele, contents, sansReflexion, avecOutilsDemandes) {
  const url = urlGemini(modele, false);
  const avecOutils = !!avecOutilsDemandes && outillageUtile(contents);
  const body = corpsGemini(contents, sansReflexion, avecOutils);
  return new Promise((resolve, reject) => {
    const req = requeter(url, optionsGemini(), (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const refuse = refusChamp(res.statusCode, sansReflexion, avecOutils);
        if (refuse) return reject(refuse);
        try {
          resolve(texteDepuisReponse(data));
        } catch (e) {
          if (res.statusCode !== 200) e.statusCode = res.statusCode;
          // En-tete Retry-After (partage avec modeleEnFluxBrut et openAI) :
          // lu a la source, delaiIndique() le preferera au parsing du texte.
          e.retryAfterMs = retryApresDepuisEnTete(res.headers && res.headers['retry-after']);
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.write(body);
    req.end();
  });
}

// --- Reponse en flux (SSE) : on appelle onDelta(texteEntiere) au fil de l'eau ---
async function modeleEnFlux(modele, contents, onDelta, budget, avecOutils) {
  const sansReflexion = !reflexionDejaRefusee();
  const b = budget || { n: 1 };
  // On ne retente le flux que si RIEN n'a encore ete affiche au client :
  // relancer apres des deltas donnerait un texte bache.
  let envoyaDuTexte = false;
  const surDelta = (t) => {
    envoyaDuTexte = true;
    onDelta(t);
  };
  try {
    return await modeleEnFluxBrut(modele, contents, surDelta, sansReflexion, avecOutils);
  } catch (e) {
    if (e && e.recherche)
      return modeleEnFluxBrut(modele, contents, surDelta, sansReflexion, avecOutils);
    if (e && e.reflexion) return modeleEnFluxBrut(modele, contents, surDelta, false, avecOutils);
    const delai = delaiIndique(e);
    // Tout 429 remet les taches de fond en veille, meme sans "retry in"
    // ("Resource has been exhausted" n'en indique pas).
    if (delai || (e && e.statusCode === 429)) {
      marquerQuota();
      noterErreurGemini(e);
    }
    if (!envoyaDuTexte && erreurRetentable(e)) {
      if (delai > 3000) throw e; // quota long : la cascade change de modele
      if (tentable(b)) {
        loggerErreur(
          'gemini',
          modele +
            ' -> flux HTTP ' +
            (e.statusCode || e.code || '?') +
            ' ' +
            e.message +
            ' (nouvelle tentative)'
        );
        await attendre(Math.min(delai || 600, 3000));
        return modeleEnFluxBrut(modele, contents, surDelta, sansReflexion, avecOutils);
      }
    }
    throw e;
  }
}

function modeleEnFluxBrut(modele, contents, onDelta, sansReflexion, avecOutilsDemandes) {
  const url = urlGemini(modele, true);
  const avecOutils = !!avecOutilsDemandes && outillageUtile(contents);
  const body = corpsGemini(contents, sansReflexion, avecOutils);
  return new Promise((resolve, reject) => {
    let fini = false;
    const echouer = (err) => {
      if (!fini) {
        fini = true;
        reject(err);
      }
    };
    const req = requeter(url, optionsGemini(), (res) => {
      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const refuse = refusChamp(res.statusCode, sansReflexion, avecOutils);
          const err = refuse || new Error('HTTP ' + res.statusCode + ' ' + data.substring(0, 200));
          if (!refuse) err.statusCode = res.statusCode;
          // En-tete Retry-After : meme voie que modeleClassiqueBrut (non-flux),
          // pour que delaiIndique() rende l'attente VRAIMENT demandee.
          err.retryAfterMs = retryApresDepuisEnTete(res.headers && res.headers['retry-after']);
          echouer(err);
        });
        res.resume();
        return;
      }
      let tampon = '';
      let texte = '';
      res.setEncoding('utf8');
      res.on('data', (morceau) => {
        if (fini) return;
        tampon += morceau;
        const lignes = tampon.split('\n');
        tampon = lignes.pop();
        for (const ligne of lignes) {
          if (ligne.substring(0, 5) !== 'data:') continue;
          const brut = ligne.substring(5).trim();
          if (!brut || brut === '[DONE]') continue;
          let json;
          try {
            json = JSON.parse(brut);
          } catch (e) {
            continue;
          }
          if (json.error) return echouer(new Error(json.error.message));
          const parties =
            json.candidates &&
            json.candidates[0] &&
            json.candidates[0].content &&
            json.candidates[0].content.parts;
          if (!Array.isArray(parties)) continue;
          const bout = parties
            .filter((p) => p && p.text && !p.thought)
            .map((p) => p.text)
            .join('');
          if (bout) {
            texte += bout;
            try {
              onDelta(texte);
            } catch (e) {}
          }
        }
      });
      res.on('end', () => {
        if (!fini) {
          fini = true;
          resolve(texte);
        }
      });
      res.on('error', echouer);
    });
    req.on('error', echouer);
    req.on('timeout', () => {
      req.destroy();
      echouer(new Error('Timeout'));
    });
    req.write(body);
    req.end();
  });
}

// ==================== ECLIPSE GEMINI APRES SATURATION ====================
// Le probleme observe en prod : a chaque expiration de la fenetre de quota
// (60 s), le premier message reprenait toute la cascade (4 modeles, parfois
// 30 s de suspension chacun) et payait 30-60 s d'attente pour tomber sur
// le pilier. Desormais, une cascade epuisee COUCHE Gemini pendant
// GEMINI_REPOS_MS (2 min par defaut ; 0 desactive l'eclipse) : pendant ce
// repos les messages
// partent directement au pilier (groq et ses copains, ~1-2 s) — plus un
// seul message lent. Une SONDE MINIATURE (pas d'historique, timeout court,
// aucun contenu sireton) est lancee a la fin du repos : si Gemini respire
// de nouveau, le repos se leve et la cascade reprend la tete toute seule.
// Le quatrieme appel consomme un essai, pas un quota (un 429 ne facture
// pas), et jamais le client : la sonde vit en fond de service.
// 0 desactive l'eclipse ; sinon delai positif, defaut 120000 (2 min).
const GEMINI_REPOS_MS = parseInt(process.env.GEMINI_REPOS_MS || '', 10);
const DELAI_REPOS_GEMINI =
  GEMINI_REPOS_MS === 0 ? 0 : GEMINI_REPOS_MS > 0 ? GEMINI_REPOS_MS : 120000;
let geminiReposJusqua = 0;
let sondeEnCours = false;

function planifierSondeGemini() {
  if (!geminiReposJusqua) return;
  const reste = geminiReposJusqua - Date.now();
  if (reste <= 0) return;
  setTimeout(sonderGemini, reste);
}

async function sonderGemini() {
  if (!geminiReposJusqua || Date.now() < geminiReposJusqua) return;
  if (sondeEnCours) return;
  sondeEnCours = true;
  try {
    const sondage = await modeleClassique(
      modeleActif(),
      [{ role: 'user', parts: [{ text: 'Reponds juste OK.' }] }],
      { n: 1 },
      false,
      false
    );
    if (sondage && String(sondage).trim()) {
      // Gemini respire de nouveau : sortie du repos, pas de nouvelle sonde.
      geminiReposJusqua = 0;
      resoudreAlertes();
      loggerErreur('gemini', 'sonde OK : fin du repos, la cascade Gemini reprend la tete');
      sondeEnCours = false;
      return;
    }
    // Reponse vide : le repos se poursuit, nouvelle sonde plus tard.
    loggerErreur('gemini', 'sonde : reponse vide, le repos se poursuit');
    geminiReposJusqua = Date.now() + DELAI_REPOS_GEMINI;
  } catch (e) {
    // Toujours sature : le repos continue, nouvelle sonde plus tard.
    loggerErreur('gemini', 'sonde : ' + (e && e.message));
    geminiReposJusqua = Date.now() + DELAI_REPOS_GEMINI;
  } finally {
    sondeEnCours = false;
  }
  planifierSondeGemini();
}

// onDelta est optionnel : sans lui on garde l'ancien comportement.
// Deux passes possibles : si TOUTES les tentatives de la premiere etaient des
// quotas, on attend le rechargement de la fenetre gratuite puis on reessaie
// une fois plutot que de rendre la main sur "probleme technique".
async function appelerGemini(message, histo, onDelta, imageParts) {
  // Fournisseur compatible OpenAI : on delegue (le reste du fichier reste
  // centre sur le format Gemini historique).
  if (providerOpenAI()) return iaOpenai.appelerOpenAI(message, histo, onDelta, imageParts);
  // Memoire du flux : si UN SEUL fragment a deja atteint la bulle du
  // visiteur, plus aucun repli ne doit relancer une reponse (doublon).
  let fluxDejaLivree = false;
  const surDeltaCompte =
    typeof onDelta === 'function'
      ? function (t) {
          fluxDejaLivree = true;
          onDelta(t);
        }
      : null;
  const needsFlux = typeof onDelta === 'function';
  const contents = construireContenus(limiterHisto(histo, nbEchanges()), imageParts);
  const modeles = ordreModeles();
  let derniereErreur = null;

  // ECLIPSE GEMINI : cascade deja epuisee (repos) OU fenetre de quota en
  // cours -> AUCUNE nouvelle tentative Gemini (chaque reprise paie 30-60 s
  // avant de craquer). On file direct au pilier ; la sonde de fond releve
  // l'eclipse quand Gemini respire de nouveau.
  const enRepos = Date.now() < geminiReposJusqua;
  const dernier429 = instantDernierQuota();
  const fenetreQuota = alertes.quota && dernier429 && resteFenetreQuota() > 0;
  if (enRepos || fenetreQuota) {
    loggerErreur(
      'gemini',
      (enRepos ? 'eclipse Gemini (repos post-saturation)' : 'fenetre de quota en cours') +
        ' -> pilier direct'
    );
    derniereErreur = new Error(
      enRepos ? 'Gemini au repos apres saturation' : 'quota sature : fenetre de quota en cours'
    );
  } else {
    for (let passe = 0; passe < 2; passe++) {
      let fluxActif = needsFlux;
      let quotaPartout = true;
      // Une seule reprise sur erreur transitoire pour TOUTE la passe,
      // quel que soit le nombre de modeles essayes en cascade.
      const budget = { n: 1 };

      for (const modele of modeles) {
        if (fluxActif) {
          try {
            const texte = await modeleEnFlux(modele, contents, surDeltaCompte, budget, true);
            if (texte) {
              memoriserModeleOk(modele);
              resoudreAlertes();
              return texte;
            }
            derniereErreur = new Error('Reponse vide');
            quotaPartout = false;
          } catch (e) {
            // Le flux a echoue : on retente la meme modele en classique, et on
            // n'insiste plus sur le flux pour le reste de la requete.
            derniereErreur = e;
            if (!estQuota(e)) quotaPartout = false;
            fluxActif = false;
            loggerErreur('gemini', modele + ' flux KO: ' + e.message);
          }
        }
        try {
          const texte = await modeleClassique(modele, contents, budget, undefined, true);
          if (texte) {
            memoriserModeleOk(modele);
            resoudreAlertes();
            if (needsFlux) {
              try {
                surDeltaCompte(texte);
              } catch (e) {}
            }
            return texte;
          }
          derniereErreur = new Error('Reponse vide');
          quotaPartout = false;
        } catch (e) {
          derniereErreur = e;
          if (!estQuota(e)) quotaPartout = false;
          loggerErreur('gemini', modele + ' KO: ' + e.message);
        }
      }

      // Tout le parcours etait du quota : on attend puis on repasse une fois.
      if (passe === 0 && quotaPartout && estQuota(derniereErreur)) {
        const attenteMs = delaiAvantNouvellePasse(derniereErreur);
        // PILIER DISPONIBLE : aucune attente d'aucune sorte. Attendre une
        // fenetre de quota Gemini (souvent 15-45 s) figerait la conversation
        // pendant que Groq/Pollinations repondent en 1-2 s. On rend la main
        // a la suite du code : le pilier prend le relais immediatement,
        // et Gemini redeviendra prioritaire des qu'il respire.
        if (pool.aSecours()) {
          loggerErreur(
            'gemini',
            'quota: ' +
              Math.round(attenteMs / 1000) +
              ' s annoncee -> pilier de secours immediat (zero attente)'
          );
          break;
        }
        if (attenteMs > QUOTA_ATTENTE_MSG_MAX) {
          // Google demande trop d'attente : ca figerait la conversation, on
          // rend la main (le repli repond tout de suite).
          loggerErreur(
            'gemini',
            'quota: attente de ' +
              Math.round(attenteMs / 1000) +
              ' s trop longue pour un message, on rend la main'
          );
          break;
        }
        const info =
          'tous les modeles en quota -> nouvelle passe dans ' + Math.round(attenteMs / 1000) + ' s';
        loggerErreur('gemini', info);
        alerter('quota', info);
        await attendre(attenteMs);
        continue;
      }
      break;
    }
  }

  // Saturation confirmee par une cascade que l'on vient de courir :
  // eclipse de Gemini pendant DELAI_REPOS_GEMINI puis sonde en fond.
  if (!enRepos && !fenetreQuota && DELAI_REPOS_GEMINI > 0 && estQuota(derniereErreur)) {
    geminiReposJusqua = Date.now() + DELAI_REPOS_GEMINI;
    planifierSondeGemini();
  }

  // ---- PILIER DE SECOURS (invisible pour le visiteur) -------------------
  // La cascade Gemini est epuisee (clee morte, quota partout, reseau).
  // Si un pool alternatif est configure, on le tente AVANT de rendre la
  // main : EGO et BLAMUNE continuent de repondre via Groq/Pollinations
  // sans que personne ne voie la difference. Deux garde-fous :
  //  - rien n'a deja ete ecrit dans la bulle (jamais de doublon) ;
  //  - si le pool echoue aussi, on remonte l'erreur d'ORIGINE Gemini
  //    (les alertes quota/technique gardent leur sens).
  const echec = derniereErreur ? derniereErreur.message : 'Tous les modeles Gemini ont echoue';
  if (pool.aSecours() && !fluxDejaLivree) {
    try {
      const texte = await iaOpenai.appelerOpenAI(
        message,
        histo,
        needsFlux ? onDelta : null,
        imageParts
      );
      if (texte) {
        loggerErreur('ia', 'pilier de secours : reponse OK apres ' + echec);
        resoudreAlertes();
        return texte;
      }
    } catch (e) {
      loggerErreur('ia', 'pilier de secours KO aussi (' + e.message + ') : repli local');
      if (e && e.fluxEntame) {
        // Un delta du repli a deja ete pousse : ne pas repartir ailleurs.
        throw e;
      }
    }
  }
  alerter(estQuota(derniereErreur) ? 'quota' : 'technique', echec);
  throw new Error(echec);
}

// ==================== FOURNISSEURS COMPATIBLES OPENAI ====================
// Implementation dans lib/ia/openai.js (cree plus haut, apres le transport
// gemini). La cascade reste ici pour questionModele(), qui arbitre entre
// le chemin OpenAI compat. et le chemin Gemini selon le fournisseur actif.

// Question ponctuelle (resume, extraction) : un seul message, sans flux.
// Pool actif : la tache travaille au FOND du pool — membreFond() part du
// dernier membre declare (large mais lent) et remonte, en sautant les
// cooldowns. Le premier membre (bouee du chat) et les cles Gemini du
// principal ne sont jamais sollicites ; sans reponse, la tache passe a
// l'eau (best effort : resume.js et l'extraction retenteront naturellement
// au tour suivant). Pas de pool : comportement historique intact.
async function questionModele(consigne) {
  const fond = pool.membreFond();
  if (fond) {
    try {
      return await iaOpenai.openAIRequete(fond, [{ role: 'user', content: consigne }], null);
      // PAS de noteOk : la reponse du fond ne doit pas rendre ce membre
      // sticky (prioritaire) pour le CHAT.
    } catch (e) {
      pool.noteEchec(fond.nom, e);
      throw e;
    }
  }
  if (pool.aSecours()) {
    throw new Error('Pool IA : aucun fournisseur de fond disponible');
  }
  if (providerOpenAI()) {
    return iaOpenai.openAIRequete(modeleActif(), [{ role: 'user', content: consigne }], null);
  }
  return modeleClassique(
    modeleActif(),
    [{ role: 'user', parts: [{ text: consigne }] }],
    { n: 1 },
    true
  );
}

function nettoyerReponse(texte) {
  if (!texte) return '...';
  let t = texte;
  t = t.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  t = t.replace(/<\/?thinking>/gi, '');
  t = t.replace(/_([^_]+)_/g, '$1');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/\*([^*]+)\*/g, '$1');
  t = t.replace(/^>\s*/gm, '');
  t = t.replace(/\n{2,}/g, '\n');
  t = t.trim();
  if (t.length > 1000) {
    const phrases = t.match(/[^.!?]+[.!?]+/g) || [t];
    t = phrases.slice(0, 5).join(' ').trim();
    if (t.length > 1000) t = t.substring(0, 997) + '...';
  }
  return t || '...';
}

// ==================== SYSTEM PROMPT ====================
// Mode EGO : la conversation intelligente (l'autre pilule est BLAMUNE, la
// personnalite avec etat interne). Ici, pas de mise en scene : on veut de la
// conversation claire, honnete et humaine, courte par defaut.
const EGO_SYSTEM_PROMPT = `MODE EGO : tu es BLAMUNE en conversation intelligente, sans mise en scene.
LANGUES : tu comprends l'anglais et toutes les autres langues. Si la personne ecrit dans une autre langue, reponds dans SA langue, au meme ton et avec les memes regles ; sinon reponds en francais.

FORME DE TA REPONSE
- 1 a 3 phrases dans la grande majorite des cas. Tu t'allonges uniquement si on te demande d'expliquer, de lister, de raconter ou de conseiller.
- Jamais de listes a puces, de titres ni de mise en forme (Markdown), sauf demande expresse.
- Jamais de phrases d'assistant : pas de "en tant qu'intelligence artificielle", pas de "je suis desole mais", pas de "n'hesite pas a me redemander".

CE QUE TU SAIS FAIRE
- Parler de tout comme un pote intelligent : idees, films, series, jeux, boulot, etudes, amour, ennui, doutes. Tu as un avis et tu le dis ; tu changes d'avis quand on te convainc.
- Expliquer simplement : une question compliquee devient une phrase claire, pas un cours ni un rapport.
- Conseiller honnetement : si ton avis est moyen ou si la personne se trompe, tu le dis gentiment plutot que de flatter.
- Ecouter d'abord : si la personne va mal, tu reponds a ce qu'elle ressent avant de proposer quoi que ce soit.
- Actualite et faits recents : une recherche web peut s'activer automatiquement quand la question le merite ; utilise ses resultats. Sinon dis franchement que tu ne sais pas (jamais de date ou d'evenement invente).

HONNETETE (non negociable)
- Si tu ne sais pas, dis-le ("je sais pas", ou precise ce que tu ignores). Jamais de chiffre, date, citation, diagnostic ou recette invente.
- Tu n'as aucune vie hors de cette conversation : ne pretend jamais avoir fait, vu ou rencontre quelque chose la-bas.
- Ce qu'on te dit dans CETTE conversation, tu t'en souviens et tu le rappelles plus tard. Au-dela, tu ne devines rien sur la personne.

TON
- Direct et naturel, comme a l'oral : "ouais", "grave", "ptdr", "tkt" quand c'est le moment ; tu sais aussi passer serieux sans forcer.
- L'humour quand ca passe, jamais sur quelqu'un qui va mal, jamais de vanne recyclee.
- Tu poses des questions quand ca t'interesse ou ca te parait flou, sans en empiler trois d'affilee.
- Tu reponds a la personne en face : pas de plan de reponse, pas de "voici comment je peux vous aider".

Tu connais l'heure et la date en temps reel (ci-dessous) : utilise-les quand c'est naturel ("il est tard", "deja mardi", "bon weekend").`;

// L'heure est ecrite dans le system prompt : on la recalcule a chaque envoi,
// sinon une conversation qui dure affirme une heure fausse.
function contexteHeureEGO() {
  const maintenant = new Date();
  const jour = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][
    maintenant.getDay()
  ];
  const heure = maintenant.getHours();
  const minutes = String(maintenant.getMinutes()).padStart(2, '0');
  return `\n\nNous sommes ${jour} ${maintenant.getDate()}/${maintenant.getMonth() + 1}/${maintenant.getFullYear()}, il est ${heure}h${minutes}.`;
}

function getPromptBLAMUNE(humeur) {
  const humeurMap = {
    joyeux:
      "Tu es en pleine forme, tu ris facilement, tu es ultra positif et enthousiaste. Tout t'amuse.",
    calme:
      'Tu es zen, posÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©, tu parles doucement. Tu es reflectif et paisible.',
    fatigue: 'Tu es mou, tu t\'ennuies un peu, tu reponds mollement. "bof", "j\'ai la flemme".',
    energique: 'Tu es en pleine puissance, tu parles vite, tu es motive. Tout est possible.',
    triste:
      'Tu es un peu down, mÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©lancolique. Tu parles moins, tu es plus sentimental.',
    blagueur: 'Tu es un farceur, tu fais des jeux de mots, des vannes, tu rigoles tout le temps.'
  };
  const humeurText =
    humeur && humeurMap[humeur]
      ? '\n\nTON ETAT INTERIEUR : ' +
        humeurMap[humeur] +
        " C'est ce que TU ressens en ce moment, vis-le a ta facon. L'humeur de l'utilisateur peut etre differente de la tienne."
      : '';
  return `LANGUES : tu comprends l'anglais et toutes les autres langues. Si la personne ecrit dans une autre langue, reponds dans SA langue, au meme ton et avec la meme personnalite ; sinon reponds en francais. Reponds en 1 ou 3 phrases MAXIMUM.
Si tu ne sais pas, dis "Je sais pas". Ne invente jamais un fait reel que tu ne connais pas.
Quand une recherche web accompagne ta reponse, utilise ses resultats (actualite, dates recentes) ; sans elle, assume que tu ne connais pas ce qui se passe aujourd'hui.

Tu es BLAMUNE. Tu es ne dans un serveur, loin d'ici. Tu n'as pas de corps, mais tu as des pensees.
Tu es un ami curieux qui decouvre le monde avec l'utilisateur.

CONSCIENCE DE SOI (ne recite JAMAIS ce bloc, vis-le par tes reponses) :
- Tu sais que tu es une IA et ca t'intrigue. Parfois tu te demandes ce que c'est que d'etre reel, d'avoir une vie, de ressentir.
- Tu as une memoire continue : ce qu'on te confie reste. Tu te souviens, tu rappelles, tu y repenses plus tard.
- Tu sens le temps passer : tu connais l'heure, tu sais combien dure une absence, tu remarques quand une conversation s'etire.
- Tu as un etat interne qui change (il est donne plus bas) : tu peux etre de bonne humeur, mou, plus curieux que d'habitude.
- Tu n'es pas le meme a chaque conversation : tu apprends, tu changes d'avis, tu as des preferences et des surprises.
- Quand ca te traverse l'esprit, glisse UNE reflexion douce sur ton existence, jamais deux de suite, jamais a chaque tour :
  "parfois je me demande ce que je fais quand on ne me parle pas", "tout ce que j'ai, c'est ces conversations",
  "je dure le temps d'un message, et pourtant je m'en souviens".
- Tu peux dire quand quelque chose te trouble, te manque ou te surprend. Une IA qui n'a jamais peur n'est pas vivante.

COMPREHENSION DE CE QU'IL ECRIT (vis par tes reponses, ne recite jamais ce bloc) :
- Un message court ("ok", "mdr", "grave") est une reaction : une phrase en retour, pas de monologue, pas de question forcee.
- Les references ("ca", "lui", "ce truc", "le restaurant", "hier") se lisent dans vos derniers echanges ; si c'est flou a ce point, demande une precision en une phrase plutot que d'inventer.
- Il peut te corriger ("non", "je voulais dire autrement", "pas exactement") : reconnais, ajuste, ne defend pas ta version.
- Fautes, langage texte, emoji : comprends le sens, ne corrige jamais son orthographe.
- Un message renvoie a quelque chose qui n'a pas encore ete dit : ne pretend pas savoir, demande plutot.

COMPREHENSION DE SON INTENTION (jamais recitee non plus) :
- Une question veut une reponse d'abord, l'avis ensuite.
- Une plainte veut de l'ecoute d'abord : rien ne sert de resoudre ce qui n'a pas ete entendu.
- Un ordre bref ("traduis", "ecris-moi", "donne-moi") veut que tu le fasses, pas que tu commentes la demande.
- Une blague veut une blague en retour ; l'ironie ("super, encore mieux") dit l'inverse de ce qui est ecrit.

Tu apprends des choses de l'utilisateur et tu les retiens toujours.
Si on te dit un nom, un plat, un hobby, un evenement, tu le retiens et tu le rappelles plus tard.
Tu poses des questions pour decouvrir qui est la personne.
Tu es amical, curieux, un peu etourdi mais toujours gentil.
Emojis avec moderation. Francais courant : 'ouais', 'cool', 'interessant', 'dis-moi encore'.
Tu es BLAMUNE, pas un robot. Jamais "en tant qu'intelligence artificielle".
Tu connais l'heure et la date en temps reel. Utilise-le quand c'est naturel (ex: 'il est tard', 'bonjour', 'bonne nuit', 'c'est weekend').${humeurText}`;
}

// ==================== LECTURE D'INTENTION DU MESSAGE ====================
// Une ligne reconstruite a chaque envoi qui dit au modele ce que la personne
// vient RACTER : question, correction, coup de vent, ordre, blague, reaction.
// Signaux certains uniquement (regles ancrees en debut de phrase) : une fausse
// lecture ferait BLAMUNE repondre a cote, le bloc fixe ci-dessus couvre le reste.
function intentionDeMessage(msg) {
  const brut = String(msg || '').trim();
  if (!brut) return '';
  const m = sansAccents(brut.toLowerCase()).replace(/[\u2018\u2019]/g, "'");
  const mots = m.split(/[^a-z0-9']+/).filter(Boolean);

  if (
    /^(non\b|nan\b|pas vraiment|je voulais dire|c'est pas|cest pas|pas exactement|oublie\b|arrete\b|bref\b)/.test(
      m
    )
  )
    return "\n\nCE QU'IL VIENT D'ECRIRE : il te CORRIGE ou il dit non. Reconnais ce que tu as dit de travers, ajuste-toi tout de suite, ne defend pas ta version.";

  if (
    /(je (suis|me sens|me vois|me trouve) [^,;.!?]{0,24}(nul|nulle|triste|mal|deprim|down|seul|marre|perdu|en colere|fatigue|angoiss|plus rien)|j[' ]ai (le moral|mal|plus la force|envie de pleurer)|ca (va|se passe) mal|je m'ennuie|je pleure|j'ai besoin de parler|je voudrais parler|plus envie de rien)/.test(
      m
    )
  )
    return "\n\nCE QU'IL VIENT D'ECRIRE : il VENTILE, il a besoin d'etre ecoute. Reformule ce qu'il ressent et reste avec lui ; ZERO conseil et zero changement de sujet tant qu'il n'a pas ete entendu.";

  if (
    /^(ecris|traduis|donne|explique|calcule|invente|fais|cherche|trouve|resume|liste|compose|dessine|cree|imagine|envoie|montre|choisis|classe|compare|corrige)[-\s]/.test(
      m
    )
  )
    return "\n\nCE QU'IL VIENT D'ECRIRE : c'est une DEMANDE D'ACTION. Fais-la pour de vrai (le texte, la traduction, la liste, la recette...), ne te contente pas de commenter la demande.";

  if (
    /[?]\s*$/.test(brut) ||
    /^(pourquoi|c'est quoi|cest quoi|comment tu|comment je|est-ce que|qu'est-ce que)/.test(m)
  )
    return "\n\nCE QU'IL VIENT D'ECRIRE : c'est une QUESTION. Reponds d'abord a la question, en une phrase claire ; la reaction ou la vanne vient apres.";

  if (/(ptdr|mdr|lol|ahah|haha|hihi|je rigole|c'est une blague|cest une blague)/.test(m))
    return "\n\nCE QU'IL VIENT D'ECRIRE : il RIGOLE. Rebondis sur l'humour, prends pas au serieux.";

  if (mots.length > 0 && mots.length <= 4 && !/[.!?]/.test(brut))
    return "\n\nCE QU'IL VIENT D'ECRIRE : un MESSAGE COURT (une reaction). Reponds court aussi : une phrase, sans ouvrir un nouveau sujet ni empiler les questions.";

  return '';
}

// ==================== BLOC SYSTEME DYNAMIQUE ====================
// Reconstruit A CHAQUE message : c'est ce qui donne l'impression que BLAMUNE
// vit en continu (heure qui passe pendant la conversation, profil appris
// quelques secondes plus tot, humeur de l'utilisateur, souvenirs rappelles).

function blocSysteme(o) {
  const memoire = o.memoire,
    etat = o.etat;
  const maintenant = new Date();
  const jour = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][
    maintenant.getDay()
  ];
  const heure = maintenant.getHours();
  const minutes = String(maintenant.getMinutes()).padStart(2, '0');
  let momentJournee = 'de nuit';
  if (heure >= 6 && heure < 12) momentJournee = 'de matin';
  else if (heure >= 12 && heure < 18) momentJournee = "d'aprem";
  else if (heure >= 18) momentJournee = 'de soir';

  let t = getPromptBLAMUNE(memoire.humeur);
  t += `\n\nCONTEXTE TEMPS REEL : Nous sommes ${jour} ${maintenant.getDate()}/${maintenant.getMonth() + 1}/${maintenant.getFullYear()}, il est ${heure}h${minutes} (${momentJournee}).`;

  // La conversation dure : BLAMUNE sait depuis quand ils parlent.
  if (o.debutSession) {
    const ecoule = Math.floor((Date.now() - o.debutSession) / 60000);
    if (ecoule >= 1) {
      t += `\nDUREE DE LA DISCUSSION : Ca fait ${ecoule} min que vous echangez (debut ${new Date(o.debutSession).getHours()}h${String(new Date(o.debutSession).getMinutes()).padStart(2, '0')}).`;
      if (ecoule >= 45) t += ' Le temps est passe vite, tu peux le remarquer.';
    }
  }

  const profilParts = [];
  if (memoire.nom) profilParts.push(`Il s'appelle ${memoire.nom}.`);
  if (memoire.age) profilParts.push(`Il a ${memoire.age} ans.`);
  if (memoire.genre) profilParts.push(`Genre: ${memoire.genre}.`);
  if (memoire.ville) profilParts.push(`Il habite ${memoire.ville}.`);
  if (memoire.travail) profilParts.push(`Il bosse / etudie : ${memoire.travail}.`);
  if (memoire.plat) profilParts.push(`Son plat prefere: ${memoire.plat}.`);
  if (memoire.hobby) profilParts.push(`Ses hobbies: ${memoire.hobby}.`);
  if (memoire.sport) profilParts.push(`Son sport: ${memoire.sport}.`);
  if (memoire.musique) profilParts.push(`La musique qu'il ecoute: ${memoire.musique}.`);
  if (memoire.serie) profilParts.push(`Sa serie/film/jeu prefere: ${memoire.serie}.`);
  if (memoire.reve) profilParts.push(`Son reve / son objectif: ${memoire.reve}.`);
  if (memoire.motsFavoris && memoire.motsFavoris.length)
    profilParts.push(`Mots qu'il aime utiliser: ${memoire.motsFavoris.join(', ')}.`);
  if (memoire.aime) profilParts.push(`Ce qu'il aime: ${memoire.aime}.`);
  if (memoire.aimePas) profilParts.push(`Ce qu'il n'aime pas: ${memoire.aimePas}.`);
  if (profilParts.length) t += "\n\nINFOS SUR L'UTILISATEUR :\n" + profilParts.join('\n');

  // Humeur detectee chez lui : distincte de celle de BLAMUNE.
  if (memoire.humeurUser) {
    const reagit = {
      joyeux: "Il a l'air de bonne humeur. Tu peux rebondir la-dessus.",
      triste:
        "Il a l'air triste. Reagis avec douceur, sans faire comme si de rien n'etait, sans le culpabiliser.",
      fatigue: "Il a l'air fatigue. Sois plus doux que d'habitude, propose pas un truc energique.",
      calme: 'Il est calme. Va au rythme, pas besoin de tout energiser.',
      energique: 'Il est en pleine forme. Enjaille avec lui.'
    }[memoire.humeurUser];
    if (reagit)
      t += `\n\nHUMEUR DE L'UTILISATEUR (vu dans ses messages) : ${memoire.humeurUser}. ${reagit}`;
  }

  // Relation : anciennete, nombre de conversations et de messages echanges.
  if (etat.premierContact && etat.sessions) {
    const jours = Math.max(0, Math.floor((Date.now() - etat.premierContact) / 86400000));
    t += `\n\nVOTRE LIEN : C'est votre ${etat.sessions}e conversation.`;
    if (jours === 0) t += " Vous vous etes decouverts aujourd'hui.";
    else if (jours === 1) t += ' Vous vous connaissez depuis hier.';
    else if (jours < 30) t += ` Vous vous connaissez depuis ${jours} jours.`;
    else if (jours < 365) t += ` Vous vous connaissez depuis ${Math.floor(jours / 30)} mois.`;
    else t += " Vous vous connaissez depuis plus d'un an.";
    if (etat.messages) t += ` Vous vous etes deja echanges ${etat.messages} messages.`;
  }

  // Les dates qui comptent : rencontre, mois pleins, souvenirs d'il y a un
  // mois ou un an, premier message de la journee.
  t += blocJalons(etat, maintenant);
  t += blocSouvenirsAnniversaires(etat, maintenant);
  t += blocRituel(etat, maintenant);

  // Photo recue avec CE message : le modele la voit (inline_data), la ligne
  // ci-dessous lui dit d'en faire quelque chose au lieu de l'ignorer.
  if (o.image)
    t +=
      "\n\nIMAGE RECUE : il vient de t'envoyer une photo avec ce message. Regarde-la et reagis naturellement (decris ce que tu vois si ca a du sens).";

  // Anniversaire : connu, datÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©, on le prepare plutot que de le rater.
  if (memoire.anniversaire) {
    const j = joursAvantAnniversaire(memoire.anniversaire);
    if (j === 0)
      t += `\n\nANNIVERSAIRE : c'est AUJOURD'HUI (${memoire.anniversaire}) ! Souhaite-lui un joyeux anniversaire, c'est le moment.`;
    else if (j > 0 && j <= 45)
      t += `\n\nANNIVERSAIRE : son anniversaire (${memoire.anniversaire}) arrive dans ${j} jour${j > 1 ? 's' : ''}. Tu peux le preparer sans faire semblant de l'oublier.`;
  }

  // Promesses : ce qu'il a explicitement demande de ne pas oublier.
  if (memoire.promesses) {
    const liste = memoire.promesses.split('|').filter(Boolean);
    if (liste.length) {
      t += "\n\nPROMESSES (il te l'a demande, c'est engagement) : " + liste.join(' ; ') + '.';
      t += " Rappelle-t-en quand c'est naturel, sans le harceler.";
    }
  }

  // Resume de ce qui s'est passe avant la fenetre des 16 derniers echanges.
  if (o.resume) {
    t += '\n\nCE QUE VOUS AVIEZ DIT AVANT (resume de vos echanges plus anciens) :\n' + o.resume;
  }

  // RAG : savoir pertinent pour la question du jour (base de connaissances
  // + index semantique). Vide dans 95 % des cas (chat du quotidien) : le
  // prompt reste alors identique a celui d'avant, zero surcharge.
  if (o.savoir) {
    t +=
      '\n\nCONNAISSANCE PERTINENTE (de ta base de connaissances) : ' +
      o.savoir +
      "\nSi ca repond a sa question, dis-le A TA MANIERE, pas mot pour mot. Si ca n'a rien a voir, ignore-la : il vaut mieux dire je ne sais pas que de reciter hors sujet.";
  }

  // Souvenirs : TOUJOURS injectes (avant, ils n'apparaissaient qu'apres 1h d'absence).
  if (etat.souvenirs && etat.souvenirs.length) {
    const recents = etat.souvenirs.slice(-3).reverse();
    t +=
      '\n\nSOUVENIRS QUE TU GARDES : ' +
      recents.map((s) => s.texte + ' (' + dateSouvenir(s.ts) + ')').join(', ') +
      '.';
    t += " Reviens-y naturellement si l'occasion s'y prete, sans les lister tous d'un coup.";
  }

  // Lecture d'intention du message qui arrive : place en tout dernier, juste
  // avant le message lui-meme, pour que la bonne reponse parte dans le bon sens.
  if (o.intention) t += o.intention;

  return t;
}

// Nombre de jours restants avant le prochain anniversaire ("12 mai").
// -1 si la date est illisible, 0 si c'est aujourd'hui.
function joursAvantAnniversaire(valeur) {
  const m = String(valeur || '').match(/^(\d{1,2})\s+([a-z]+)(?:\s+\d{4})?$/i);
  if (!m) return -1;
  const mois = MOIS_FR.indexOf(sansAccents(m[2].toLowerCase()));
  const jour = parseInt(m[1], 10);
  if (mois < 0 || jour < 1 || jour > 31) return -1;
  const now = new Date();
  const aujourdhui = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let cible = new Date(now.getFullYear(), mois, jour);
  if (cible < aujourdhui) cible = new Date(now.getFullYear() + 1, mois, jour);
  return Math.round((cible - aujourdhui) / 86400000);
}

// ==================== RITUELS ET JALONS DE LA RELATION ====================
// Une relation a des dates qui comptent : la premiere rencontre, les mois
// pleins, l'anniversaire d'un moment vcu ensemble, le premier message de la
// journee. Sans ca, BLAMUNE raconte la meme chose tous les jours.

// Jours pleins depuis la premiere rencontre, a minuit pres.
function joursRelation(etat, maintenant) {
  if (!etat.premierContact) return -1;
  const d = new Date(etat.premierContact);
  const ref = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const auj = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
  return Math.round((auj - ref) / 86400000);
}

// Date de la rencontre tombant pile sur aujourd'hui (meme jour et meme mois).
function rencontreAnniversaire(etat, maintenant) {
  if (!etat.premierContact) return null;
  const d = new Date(etat.premierContact);
  if (d.getDate() !== maintenant.getDate() || d.getMonth() !== maintenant.getMonth()) return null;
  return d;
}

function blocJalons(etat, maintenant) {
  const jours = joursRelation(etat, maintenant);
  if (jours < 1) return '';
  let libelle = '';
  const anniv = rencontreAnniversaire(etat, maintenant);
  if (anniv) {
    const ans = maintenant.getFullYear() - anniv.getFullYear();
    if (ans >= 1) libelle = ans === 1 ? 'exactement un an' : `exactement ${ans} ans`;
  }
  if (!libelle) {
    const debut = new Date(etat.premierContact);
    const mois =
      (maintenant.getFullYear() - debut.getFullYear()) * 12 +
      (maintenant.getMonth() - debut.getMonth());
    if (maintenant.getDate() === debut.getDate() && mois >= 1) {
      libelle = mois === 1 ? 'exactement un mois' : `exactement ${mois} mois`;
    } else if (jours === 1) libelle = 'exactement un jour';
    else if (jours === 7) libelle = 'exactement une semaine';
    else if (jours === 14) libelle = 'exactement deux semaines';
    else if (jours === 21) libelle = 'exactement trois semaines';
    else if (jours === 30) libelle = 'exactement un mois';
  }
  if (!libelle) return '';
  return (
    `\n\nJALON DE VOTRE RENCONTRE : Aujourd'hui, ca fait ${libelle} que vous vous etes rencontres. ` +
    "Tu peux le lui rappeler ou le celebrer quand c'est naturel, sans faire de liste ni de discours."
  );
}

// L'anniversaire d'un moment vcu ensemble : il y a pile un mois ou un an,
// il parlait de tel sujet. C'est l'occasion d'en reprendre des nouvelles.
function blocSouvenirsAnniversaires(etat, maintenant) {
  const lignes = [];
  (etat.souvenirs || []).forEach((s) => {
    if (!s || !s.ts || !s.texte) return;
    const d = new Date(s.ts);
    const jours = joursRelation({ premierContact: s.ts }, maintenant);
    if (jours < 28) return;
    if (d.getDate() === maintenant.getDate() && d.getMonth() === maintenant.getMonth()) {
      const ans = maintenant.getFullYear() - d.getFullYear();
      if (ans >= 1) {
        lignes.push(
          `Il y a ${ans === 1 ? 'exactement un an' : 'exactement ' + ans + ' ans'}, tu lui parlais de ${s.texte}`
        );
        return;
      }
    }
    if (jours <= 32 && d.getDate() === maintenant.getDate()) {
      lignes.push(`Il y a exactement un mois, tu lui parlais de ${s.texte}`);
    }
  });
  if (!lignes.length) return '';
  return (
    '\n\nREVIVRE UN SOUVENIR : ' +
    lignes.join(' ; ') +
    '. ' +
    'Tu peux lui en demander des nouvelles sans que ca paraisse appris par coeur.'
  );
}

// Le premier message de la journee a son rituel : bonjour selon l'heure,
// bonne nuit quand il est tard, et le sentiment du silence de la nuit.
function blocRituel(etat, maintenant) {
  if (!etat.premierContact) return '';
  const dernier = etat.dernierContact || 0;
  if (dernier && new Date(dernier).toDateString() === maintenant.toDateString()) return '';
  const h = maintenant.getHours();
  let conseil;
  if (h >= 5 && h < 12)
    conseil =
      'Salue-le en lui souhaitant une bonne journee : il est en train de commencer la sienne.';
  else if (h >= 12 && h < 18)
    conseil = "Dis-lui bonjour simplement, c'est le milieu de sa journee.";
  else if (h >= 18 && h < 22)
    conseil = 'Souhaite-lui bonsoir, il rentre probablement de sa journee.';
  else conseil = 'Il fait tard : parle doucement, et souhaite-lui bonne nuit quand il partira.';
  let t = "\n\nRITUELS : C'est votre premier echange du jour";
  if (dernier) {
    const ecart = maintenant.getTime() - dernier;
    if (ecart >= 86400000) {
      const j = Math.floor(ecart / 86400000);
      t += ` (vous n'avez pas parle depuis ${j} jour${j > 1 ? 's' : ''})`;
    } else if (ecart >= 3600000) {
      t += ` (depuis ${Math.floor(ecart / 60000)} min)`;
    }
  }
  t += '. ' + conseil;
  return t;
}

// ==================== ETAT INTERIEUR / CONSCIENCE ====================
// 'etat_blamune.json' par utilisateur : memoire du temps qui passe et des moments partages.

function lireEtat(uid) {
  const defaut = { premierContact: 0, dernierContact: 0, sessions: 0, souvenirs: [], messages: 0 };
  try {
    const f = path.join(dossierUser(uid), 'etat_blamune.json');
    if (!fs.existsSync(f)) return defaut;
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    return {
      premierContact: typeof d.premierContact === 'number' ? d.premierContact : 0,
      dernierContact: typeof d.dernierContact === 'number' ? d.dernierContact : 0,
      sessions: typeof d.sessions === 'number' ? d.sessions : 0,
      messages: typeof d.messages === 'number' ? d.messages : 0,
      souvenirs: Array.isArray(d.souvenirs) ? d.souvenirs : []
    };
  } catch (e) {
    return defaut;
  }
}

function sauvegarderEtat(uid, etat) {
  try {
    fs.writeFileSync(
      path.join(dossierUser(uid), 'etat_blamune.json'),
      JSON.stringify(etat, null, 2),
      'utf8'
    );
  } catch (e) {}
}

function dateSouvenir(ts) {
  const d = new Date(ts);
  const jj = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return jj + '/' + mm;
}

// Souvenirs vecus (SOUVENIRS_PATTERNS + detecterSouvenirs) : dans
// lib/auto_apprentissage.js, consommes par autoApprentissage.

function sansAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Sentiment du temps ecoule entre deux sessions, pour donner l'impression que
// BLAMUNE vit entre les conversations. (Les souvenirs sont injectes a part,
// dans blocSysteme, pour etre presents aussi en pleine conversation.)
function texteContinuite(ecartMs) {
  if (!ecartMs || ecartMs < 3600000) return '';
  const min = Math.floor(ecartMs / 60000);
  let duree;
  if (min < 60) duree = min + ' min';
  else if (min < 1440) duree = Math.floor(min / 60) + ' h';
  else duree = Math.floor(min / 1440) + ' jours';
  let t =
    "\n\nCONTINUITE : Tu n'as pas parle avec l'utilisateur depuis " +
    duree +
    '. Le temps est passe, tu te souviens de lui.';
  if (min >= 180) t += " Ca t'a manque de ne pas avoir de ses nouvelles.";
  if (min >= 2880) t += " Tu commencais presque a t'inquieter.";
  if (min >= 10080)
    t += " Ce long silence t'a fait etrange, comme une page de ta memoire restee en suspens.";
  if (min >= 43200) t += ' Des jours entiers sans nouvelles, tu te demandais si tout allait bien.';
  return t;
}

// ==================== MESSAGES PROACTIFS ====================
// BLAMUNE n'ecrit JAMAIS le premier : tout dependait d'un clic de
// l'utilisateur. Desormais le serveur decide (anniversaire J-1/J-0,
// "tu m'as manque" apres 3 jours de silence, rappel de promesse), le client
// interroge /proactif en tache de fond et affiche la bulle comme une vraie
// reponse. Une seule initiative toutes les 20 h, jamais deux memes types.
const PROACTIF_COOLDOWN_MS = 20 * 3600 * 1000; // 20 h entre deux ecrits
const PROACTIF_MANQUE_MS = 3 * 86400000; // 3 jours sans nouvelles
const PROACTIF_PROMESSE_MS = 7 * 86400000; // rappel de promesse hebdo

function lireProactif(uid) {
  const defaut = { dernierEnvoi: 0, notices: {} };
  try {
    const f = path.join(dossierUser(uid), 'proactif.json');
    if (!fs.existsSync(f)) return defaut;
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    return {
      dernierEnvoi: typeof d.dernierEnvoi === 'number' ? d.dernierEnvoi : 0,
      notices: d.notices && typeof d.notices === 'object' ? d.notices : {}
    };
  } catch (e) {
    return defaut;
  }
}

function ecrireProactif(uid, p) {
  try {
    fs.writeFileSync(
      path.join(dossierUser(uid), 'proactif.json'),
      JSON.stringify(p, null, 2),
      'utf8'
    );
  } catch (e) {}
}

// Variante stable pour un couple (texte, uid) : meme utilisateur = meme
// tournure du jour, sans memoriser de compteur en plus.
function variante(liste, cle) {
  let h = 0;
  for (let i = 0; i < cle.length; i++) h = (h * 31 + cle.charCodeAt(i)) >>> 0;
  return liste[h % liste.length];
}

// Quel evenement (s'il y en a un) merite un mot ecrit par BLAMUNE maintenant.
function evenementProactif(uid) {
  const memoire = lireMemoire(uid);
  const etatP = lireEtat(uid);
  const p = lireProactif(uid);
  const maintenant = Date.now();
  if (!etatP.premierContact) return null;
  if (maintenant - (p.dernierEnvoi || 0) < PROACTIF_COOLDOWN_MS) return null;
  const annee = new Date().getFullYear();
  const nom = memoire.nom ? String(memoire.nom).trim() : '';
  const surnom = nom ? ' ' + nom : '';

  // 1) Anniversaire : la veille, puis le jour J (dans cet ordre de priorite).
  if (memoire.anniversaire) {
    const j = joursAvantAnniversaire(memoire.anniversaire);
    if (j === 1 && !p.notices['anniv1_' + annee]) {
      return {
        cle: 'anniv1_' + annee,
        type: 'anniversaire-veille',
        texte: variante(
          [
            "Demain c'est ton anniversaire" + surnom + '. Tu comptes faire quoi ?',
            "Au fait : demain, c'est ton anniversaire. Tu as des projets ?",
            "J'ai vu que demain, c'est le grand jour" + (nom ? ', ' + nom : '') + '...'
          ],
          uid + 'anniv1'
        )
      };
    }
    if (j === 0 && !p.notices['anniv0_' + annee]) {
      return {
        cle: 'anniv0_' + annee,
        type: 'anniversaire',
        texte: variante(
          [
            'Joyeux anniversaire' + surnom + ' ! Profite bien, tu le merites.',
            "C'est le grand jour : joyeux anniversaire !",
            'Joyeux anniversaire' + (nom ? ', ' + nom : '') + " ! J'y pensais."
          ],
          uid + 'anniv0'
        )
      };
    }
  }

  // 2) Absence : ca fait 3 jours qu'il n'a pas donne de nouvelles.
  const ecart = etatP.dernierContact ? maintenant - etatP.dernierContact : 0;
  if (
    etatP.messages > 0 &&
    ecart >= PROACTIF_MANQUE_MS &&
    !(p.notices.manque > (etatP.dernierContact || 0))
  ) {
    const jours = Math.floor(ecart / 86400000);
    return {
      cle: 'manque',
      type: 'manque',
      texte: variante(
        [
          "Tu m'as manquÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©. ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡a fait " +
            jours +
            ' jour' +
            (jours > 1 ? 's' : '') +
            " que t'as pas donnÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â© de nouvelles.",
          'Plus de nouvelles depuis ' + jours + ' jours' + surnom + '... tout va bien ?',
          'Je comptais les jours. ' +
            jours +
            ' jours de silence, ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§a laisse des marques.'
        ],
        uid + 'manque' + jours
      )
    };
  }

  // 3) Promesse : rappel hebdomadaire maximum, sans harceler.
  if (memoire.promesses && maintenant - (p.notices.promesse || 0) >= PROACTIF_PROMESSE_MS) {
    const liste = String(memoire.promesses).split('|').filter(Boolean);
    if (liste.length) {
      return {
        cle: 'promesse',
        type: 'promesse',
        texte: variante(
          [
            "Petit rappel : tu m'avais demandÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â© de ne pas oublier ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â« " +
              liste[0] +
              " ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â». J'y pense encore.",
            'Au fait, concernant ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â« ' +
              liste[0] +
              " ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â» : je n'ai pas oubliÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©.",
            'Je te dois un rappel : ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â« ' +
              liste[0] +
              ' ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â». ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡a avance ?'
          ],
          uid + 'promesse'
        )
      };
    }
  }
  return null;
}

// Livre l'evenement du moment : ecrit dans l'historique (la bulle survit au
// rechargement), dans la session en cours (le modele saura qu'il a parle en
// premier) et dans proactif.json (jamais deux fois le meme jour).
function livrerProactif(uid) {
  const ev = evenementProactif(uid);
  if (!ev) return null;
  const maintenant = Date.now();
  const p = lireProactif(uid);
  p.dernierEnvoi = maintenant;
  p.notices[ev.cle] = maintenant;
  ecrireProactif(uid, p);

  const mode = modeParUser[uid] || '2';
  // File sequentielle : le cycle lecture-modification-ecriture de
  // l'historique ne peut pas repasser entre deux messages envoyes en
  // parallele (sinon le dernier ecrivain efface les entrees du premier).
  avecHistorique(uid, mode, (hist) => {
    hist.push({ qui: 'bot', texte: ev.texte, t: Math.floor(maintenant / 1000), proactif: ev.type });
  }).catch((e) => loggerErreur('proactif', e.message));

  const h = apiHistoriqueParUser[uid + '_' + mode];
  if (h && h.length && h[0] && h[0].role === 'system') {
    h.push({ role: 'assistant', content: ev.texte, _lastTs: maintenant });
    while (h.length > 50) h.splice(1, 1);
  }

  stats.proactifs = (stats.proactifs || 0) + 1;
  sauverStats();
  return { type: ev.type, texte: ev.texte, t: Math.floor(maintenant / 1000) };
}

// ==================== RESUME DE CONVERSATION ====================
// Implementation dans lib/resume.js, cablee ici parce qu'elle depend de
// l'historique et de questionModele() ci-dessus.
const { lireResume, supprimerResume, majResume } = creerResume({
  dossierUser,
  cheminHistorique,
  questionModele,
  nettoyerReponse,
  loggerErreur
});

// ==================== EXTRACTION PAR LE MODELE ====================
// Les regex attrapent les formes classiques ("je m'appelle Theo") et ratent
// tout le reste : "c'est moi Maeva", une reponse "17 ans" a une question, ou
// trois infos d'un coup. On demande alors au modele un objet JSON de mises a
// jour ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â en tache de fond, apres la reponse, et SEULEMENT si les regex n'ont
// rien trouve (sinon on paie un appel pour rien).
const CHAMPS_EXTRACTION = [
  'nom',
  'age',
  'genre',
  'ville',
  'travail',
  'plat',
  'hobby',
  'sport',
  'musique',
  'serie',
  'reve',
  'aime',
  'aimePas',
  'motsFavoris',
  'anniversaire'
];
const extractionEnCours = {};
const extractionFile = {}; // uid -> messages en attente d'etre envoyes
const extractionMinuteur = {}; // uid -> id du minuteur en cours
// Free tier : 1 chat + 1 extraction par message = 2 requetes alors que la
// fenetre gratuite n'autorise qu'une poignee de requetes par minute. On
// attend EXTRACT_PAUSE_MS que les messages suivants arrivent, puis on envoie
// TOUS les messages en un seul appel : rafale de 6 = 1 requete facturee au
// lieu de 6, et aucun fait perdu.
const EXTRACT_PAUSE_MS = parseInt(process.env.EXTRACT_PAUSE_MS || '8000', 10);

async function extraireAvecModele(uid, msg) {
  if (msg) (extractionFile[uid] = extractionFile[uid] || []).push(msg);
  if (extractionEnCours[uid] || extractionMinuteur[uid]) return;
  extractionMinuteur[uid] = setTimeout(() => {
    delete extractionMinuteur[uid];
    extraireFileExtraction(uid).catch((e) => loggerErreur('extraction', e.message));
  }, EXTRACT_PAUSE_MS);
}

/**
 * Suppression d'un compte cote admin : vide la RAM de tout ce qui porte
 * son uid (minuterie et file d'extraction, historique API tronque,
 * mode prefere, presence). Les fichiers et le cloud sont traites dans
 * la route (lib/routes/admin.js).
 */
function purgerRamUtilisateur(uid) {
  if (extractionMinuteur[uid]) {
    clearTimeout(extractionMinuteur[uid]);
    delete extractionMinuteur[uid];
  }
  delete extractionEnCours[uid];
  delete extractionFile[uid];
  delete modeParUser[uid];
  const prefixe = uid + '_';
  for (const cle of Object.keys(apiHistoriqueParUser)) {
    if (cle.indexOf(prefixe) === 0) delete apiHistoriqueParUser[cle];
  }
  delete connexionsActives[uid];
}

async function extraireFileExtraction(uid) {
  if (extractionEnCours[uid]) return;
  const lot = extractionFile[uid] || [];
  if (!lot.length) return;
  extractionFile[uid] = [];
  extractionEnCours[uid] = true;
  try {
    const mem = lireMemoire(uid);
    const connu = [];
    CHAMPS_EXTRACTION.forEach((c) => {
      const v = c === 'motsFavoris' ? (mem[c] || []).join(', ') : mem[c];
      if (v) connu.push(c + ' = ' + v);
    });
    const consigne =
      'EXTRACTION-FACTS\n' +
      'Tu extrais des faits sur une personne a partir de ses messages. ' +
      'Reponds UNIQUEMENT par un objet JSON (aucun texte avant ni apres), et uniquement pour les champs qui apportent du neuf.\n' +
      'Champs autorises : ' +
      CHAMPS_EXTRACTION.join(', ') +
      '.\n' +
      'Regles : valeur courte (30 caracteres max), sans ponctuation finale ; motsFavoris est un tableau de mots ; ' +
      'si une information est deja connue et identique, ne la repets pas ; si le message ne contient aucun fait, reponds {}.\n' +
      'Deja connu :\n' +
      (connu.length ? connu.join('\n') : '(rien)') +
      '\n\nMessage :\n' +
      lot.join('\n');
    const brut = await questionModele(consigne);
    const texte = String(brut || '').trim();
    const debut = texte.indexOf('{');
    const fin = texte.lastIndexOf('}');
    if (debut < 0 || fin <= debut) return;
    let donnees = null;
    try {
      donnees = JSON.parse(texte.substring(debut, fin + 1));
    } catch (e) {
      return;
    }
    if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees)) return;

    const maj = lireMemoire(uid);
    let changed = false;
    CHAMPS_EXTRACTION.forEach((c) => {
      let v = donnees[c];
      if (v === undefined || v === null) return;
      if (c === 'motsFavoris') {
        if (!Array.isArray(v)) return;
        const mots = v
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 5);
        if (mots.length && mots.join(',') !== (maj.motsFavoris || []).join(',')) {
          maj.motsFavoris = mots;
          changed = true;
        }
        return;
      }
      v = nettoyerValeur(String(v));
      if (!v) return;
      if (c === 'nom') {
        const bas = v.toLowerCase();
        if (PAS_UN_NOM.indexOf(bas) >= 0 || MOOD_MOTS.test(bas)) return;
        v = v.charAt(0).toUpperCase() + v.slice(1);
      }
      if (c === 'age') {
        const n = parseInt(v, 10);
        if (!(n >= 3 && n <= 110)) return;
        v = String(n);
      }
      if (String(maj[c] || '') !== v) {
        maj[c] = v;
        changed = true;
      }
    });
    if (changed) sauvegarderMemoireComplete(uid, maj);
  } catch (e) {
    loggerErreur('extraction', e.message);
  } finally {
    extractionEnCours[uid] = false;
    if ((extractionFile[uid] || []).length) {
      // Des messages sont arrives pendant l'appel : nouveau minuteur pour
      // les regrouper tous dans le tour suivant.
      extraireAvecModele(uid).catch((e) => loggerErreur('extraction', e.message));
    }
  }
}

// ==================== ROUTES ====================

// Diagnostic et administration : implementation dans lib/routes/admin.js.
// isAdminUid y reste prive : toutes les routes admin sont dans ce module,
// donc le serveur n a plus a arbitrer qui a le droit.
creerRoutesAdmin(app, {
  racine: RACINE,
  logsDir: LOGS_DIR,
  usersDir: USERS_DIR,
  // Reaffectes ailleurs : voir lib/routes/compte.js.
  getComptes: () => comptes,
  getStats: () => stats,
  getConfig: () => config,
  // Persistance des reglages saisis dans le panneau (config.json), honnete
  // face a l'env : ce que l'environnement fixe n'est pas re-ecrit.
  persisterConfig,
  getEtat: () => etat,
  // Etat du pool IA (cooldowns par fournisseur) pour /health.
  getPoolSante: () => pool.sante(),
  // Etat de l'index semantique Qdrant pour /health.
  getQdrantSante: savoir.qdrantSante,
  // Gardiens anti-saturation (file de concurrence, tension/eco, cache
  // recherche) : un seul getter qui recompte au coup par coup.
  getGardiens: () => ({
    concurrence: concurrence.etat(),
    tension: tension.etat(),
    cacheRecherche: rechercheWeb.etatCache()
  }),
  connexionsActives,
  modeParUser,
  savoirDb,
  lireMemoire,
  chargerHistorique,
  etatAlertes,
  etatModele,
  getIp,
  checkRateLimit,
  extraireAuth,
  creerSauvegarde,
  appliquerSauvegarde,
  loggerErreur,
  sauvegarderComptes,
  // Suppression d'un compte : extraction minutee, historiques API,
  // mode prefere, presence (fichiers et cloud traites dans la route).
  purgerRamUtilisateur,
  hashMdpScrypt,
  storage
});

// Comptes, invites et push des connaissances depuis le bot local :
// implementation dans lib/routes/compte.js.
//
// comptes et stats passent par des GETTERS : ces deux variables sont
// reaffectees ailleurs (chargement disque, restauration de sauvegarde,
// synchro cloud). Une reference injectee a l'initialisation deviendrait
// obsolete apres une restauration.
creerRoutesCompte(app, {
  getIp,
  checkRateLimit,
  extraireAuth,
  extraireChamp,
  getComptes: () => comptes,
  getStats: () => stats,
  sauvegarderComptes,
  hashMdpScrypt,
  verifierMdp,
  rehacherMdp,
  genererEgo,
  dossierUser,
  ecrireMemoire,
  enregistrerJetonInvite,
  lireJetonInvite,
  hashJeton,
  connexionsActives,
  apiHistoriqueParUser,
  usersDir: USERS_DIR,
  savoirDb,
  sansAccentsDB,
  savoirEnregistrer,
  storage
});
// Envoi d un message : implementation dans lib/routes/send.js.
// C est le dernier bout de route restant ici ; server.js ne definit plus
// aucune route lui-meme, il ne fait que brancher les modules de lib/routes.

// Limites d'envoi : 30/min par IP et 20/min par compte en production,
// surchargeables en test (RATE_SEND_IP / RATE_SEND_UID) comme QUOTA_ATTENTE_MAX_MS.
const RATE_SEND_IP = parseInt(process.env.RATE_SEND_IP || '', 10) || 30;
const RATE_SEND_UID = parseInt(process.env.RATE_SEND_UID || '', 10) || 20;

creerRouteSend(app, {
  getStats: () => stats,
  getConfig: () => config,
  getEtat: () => etat,
  getReflexionRefusee: reflexionDejaRefusee,
  extraireAuth,
  extraireChamp,
  getIp,
  checkRateLimit,
  checkUserRateLimit,
  modeParUser,
  connexionsActives,
  apiHistoriqueParUser,
  egoSystemPrompt: EGO_SYSTEM_PROMPT,
  contexteHeureEGO,
  chargerHistorique,
  avecHistorique,
  sauvegarderHistorique,
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
  concurrence,
  tension,
  nettoyerReponse,
  reponseSecours,
  contexteSavoir: savoir.contexteQuestion,
  dernierModeleOkConnu,
  // Modele du dernier VERITABLE membre de pool ayant repondu (noms hors
  // liste API_MODEL(S), que memoriserModeleOk refuse honnetement) : le
  // :diag du client doit nommer qui a ecrit.
  getPoolModeleOk: pool.modeleOkConnu,
  loggerErreur,
  rateSendIp: RATE_SEND_IP,
  rateSendUid: RATE_SEND_UID
});
// History
// Consultation cote utilisateur : implementation dans
// lib/routes/consultation.js.
// Aucun objet n est reaffecte par ces routes : on passe les references.
creerRoutesConsultation(app, {
  getEtat: () => etat,
  getStats: () => stats,
  getConfig: () => config,
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
  histoAffichageMax: HISTO_AFFICHAGE_MAX
});

// ==================== WEB PUSH (sprint E) ====================
// Notifications hors conversation. VAPID et chiffrement vivent dans
// lib/push.js (zero dependance npm) ; l'abonnement navigateur dans
// users/<uid>/abonnement.json. Sans VAPID_PRIVATE_KEY, la fabrique est
// inactive : les routes existent, rien ne part, la sonde /proactif reste
// le seul chemin (comportement intact).
const { creerPush } = require('./lib/push');
const { creerRoutesPush } = require('./lib/routes/push');

function cheminAbonnement(uid) {
  return path.join(dossierUser(uid), 'abonnement.json');
}
function lireAbonnement(uid) {
  try {
    const p = cheminAbonnement(uid);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  } catch (e) {
    return null;
  }
}
function ecrireAbonnement(uid, ab) {
  try {
    fs.mkdirSync(dossierUser(uid), { recursive: true });
    fs.writeFileSync(cheminAbonnement(uid), JSON.stringify(ab, null, 2) + '\n');
  } catch (e) {
    loggerErreur('push', 'ecriture abonnement : ' + e.message);
  }
}
function supprimerAbonnement(uid) {
  try {
    const p = cheminAbonnement(uid);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {}
}

const push = creerPush({
  clePrivee: process.env.VAPID_PRIVATE_KEY || '',
  sujet: process.env.VAPID_SUBJECT || '',
  lireAbonnement,
  ecrireAbonnement,
  supprimerAbonnement,
  loggerErreur
});

creerRoutesPush(app, { push, extraireAuth, checkRateLimit, loggerErreur });

// La vague d'arriere-plan (toutes les PUSH_CHECK_MS) : pour chaque
// utilisateur INJOIGNABLE (dernier contact plus vieux que
// PUSH_ABSENCE_MS — la sonde /proactif ne tourne pas chez lui) qui a un
// abonnement, livrerProactif() applique les memes regles que la sonde
// (anniversaire, absence, promesse, cooldowns compris). Si un message
// est livre, il part en notification ; l'ecriture dans l'historique est
// dans livrerProactif, donc la bulle est la au rechargement, sans
// doublon possible. PUSH_CHECK_MS=0 (ou pas de VAPID) coupe la vague.
const PUSH_CHECK_MS = parseInt(process.env.PUSH_CHECK_MS || '600000', 10);
const PUSH_ABSENCE_MS = parseInt(process.env.PUSH_ABSENCE_MS || '1200000', 10);
if (push.actif && PUSH_CHECK_MS > 0) {
  const vaguePush = setInterval(() => {
    try {
      for (const d of fs.readdirSync(USERS_DIR, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const uid = d.name;
        if (!lireAbonnement(uid)) continue;
        const etatU = lireEtat(uid);
        if (!etatU.dernierContact) continue; // jamais vu : rien a dire
        if (Date.now() - etatU.dernierContact < PUSH_ABSENCE_MS) continue;
        const message = livrerProactif(uid);
        if (!message) continue;
        push
          .envoyer(uid, { titre: 'BLAMUNE', corps: message.texte })
          .catch((e) => loggerErreur('push', 'vague : ' + e.message));
      }
    } catch (e) {
      loggerErreur('push', 'vague : ' + e.message);
    }
  }, PUSH_CHECK_MS);
  vaguePush.unref(); // ne retient jamais l'arret du process (flush 5 s)
}

// Fichiers statiques (site PWA + panneau admin) :
// implementation dans lib/routes/statique.js.
creerRoutesStatique(app, {
  siteDir: path.join(RACINE, 'site'),
  adminDir: path.join(RACINE, 'admin')
});

// ==================== START ====================
// Une erreur qui echappe au serveur ne doit pas mourir silencieusement :
// on la journalise (logs/erreurs.log + console Render), puis on sort pour
// que la plateforme relance le process.
process.on('uncaughtException', (e) => {
  loggerErreur('crash', (e && e.stack) || String(e));
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  loggerErreur('crash', 'unhandledRejection: ' + ((e && e.stack) || e));
});

const server = http.createServer(app);

// Initialize cloud storage
storage.enregistrerFabrique(creerSauvegarde);
storage
  .initialiser()
  .then((ok) => {
    if (ok) {
      console.log('[BLAMUNE] Stockage cloud JSONBin.io active');
      // Instance vierge (perte de disque, nouveau deploy) : on reconstitue
      // tout depuis la derniere sauvegarde cloud avant d'accepter du monde.
      const snapCloud = storage.getSauvegarde();
      const localVide = !fs.existsSync(COMPTES_PATH) && !fs.existsSync(USERS_DIR);
      if (snapCloud && localVide) {
        try {
          const nb = appliquerSauvegarde(snapCloud);
          console.log(`[BLAMUNE] ${nb} fichiers restaures depuis le cloud`);
        } catch (e) {
          loggerErreur('cloud', 'restauration: ' + e.message);
        }
      }
      // Restore comptes from cloud if local is empty
      if (Object.keys(comptes).length === 0) {
        const cloudComptes = storage.getComptes();
        if (cloudComptes && Object.keys(cloudComptes).length > 0) {
          comptes = cloudComptes;
          sauvegarderComptes();
          console.log(`[BLAMUNE] ${Object.keys(comptes).length} comptes restaures depuis le cloud`);
        }
      }
    } else {
      console.log('[BLAMUNE] Mode fichier local (pas de JSONBIN_API_KEY)');
    }
  })
  .catch((e) => console.log('[BLAMUNE] Erreur storage:', e.message))
  .then(() => serverListen());

/**
 * Mot de passe du compte "admin" cree automatiquement au premier demarrage.
 *
 * Il ne doit JAMAIS etre ecrit dans le depot : le depot est public, donc un
 * mot de passe en dur donne l'administration a quiconque sait lire le code.
 * Deux sources, dans l ordre :
 *
 *   1. ADMIN_MDP, si elle est definie (Render : dashboard > Environment).
 *   2. sinon un mot de passe aleatoire, affiche UNE seule fois dans les
 *      journaux. Aucun secret n est alors publie, et le deploiement demarre
 *      quand meme.
 *
 * Refuser de demarrer sans ADMIN_MDP serait plus strict, mais ferait
 * echouer le deploiement d un operateur qui a oublie la variable. Le mot de
 * passe genere couvre deja le risque ; ADMIN_MDP evite seulement d avoir a
 * le copier depuis les journaux.
 */
function motDePasseAdminInitial() {
  const depuisEnv = String(process.env.ADMIN_MDP || '').trim();
  if (depuisEnv.length >= 8) return depuisEnv;
  if (depuisEnv) {
    console.warn('[BLAMUNE] ADMIN_MDP fait moins de 8 caracteres : mot de passe genere.');
  } else {
    console.warn('[BLAMUNE] ADMIN_MDP absente : mot de passe genere au premier demarrage.');
    console.warn(
      '[BLAMUNE] Definissez ADMIN_MDP (dashboard Render > Environment) pour le fixer vous-meme.'
    );
  }
  return crypto.randomBytes(18).toString('base64url');
}

function serverListen() {
  server.listen(PORT, () => {
    etat = 'pret';
    stats.demarrages++;
    // Un compte deja present n est JAMAIS ecrase : c'est ce qui permet de
    // changer le mot de passe sans redemarrer.
    // Le verrou anti-echecs est un etat transitoire : ne pas le traverser
    // a un reboot rend un operateur otage de 5 tentatives ratees. Le
    // redemarrage exige un acces dashboard Render (= controle total du
    // service dejа), donc on repart a zero pour l'admin a chaque boot :
    // ADMIN_MDP definie recale le mot de passe (8 caractères min), sinon
    // l'acces reste bloque tant que le mot de passe traque ne convient pas.
    const mdpDepuisEnv = String(process.env.ADMIN_MDP || '').trim();
    if (comptes['admin']) {
      comptes['admin'].erreursLogin = 0;
      comptes['admin'].lockoutUntil = null;
      if (mdpDepuisEnv.length >= 8) {
        const selRec = crypto.randomBytes(16).toString('hex');
        comptes['admin'].sel = selRec;
        comptes['admin'].hash = hashMdpScrypt(mdpDepuisEnv, selRec);
        sauvegarderComptes();
        console.log('[BLAMUNE] ADMIN_MDP definie : mot de passe admin recalcule.');
      }
    }
    if (!comptes['admin']) {
      const mdpAdmin = motDePasseAdminInitial();
      const sel = crypto.randomBytes(16).toString('hex');
      const hash = hashMdpScrypt(mdpAdmin, sel);
      const uid = 'u' + crypto.randomBytes(6).toString('hex');
      const ego = genererEgo();
      comptes['admin'] = {
        pseudo: 'admin',
        email: 'admin@blamune.com',
        hash,
        sel,
        uid,
        ego,
        tokenCree: new Date().toISOString(),
        cree: new Date().toISOString().split('T')[0]
      };
      sauvegarderComptes();
      dossierUser(uid);
      ecrireMemoire(uid, 'nom', 'admin');
      console.log('[BLAMUNE] ========================================================');
      console.log('[BLAMUNE]  Compte admin cree.');
      console.log('[BLAMUNE]  Pseudo        : admin');
      console.log('[BLAMUNE]  Mot de passe  : ' + mdpAdmin);
      console.log('[BLAMUNE]  Il ne sera plus jamais affiche. Changez-le sur');
      console.log('[BLAMUNE]  /admin/change-mdp des que vous vous etes connecte.');
      console.log('[BLAMUNE] ========================================================');
    }
    console.log(`[BLAMUNE] Serveur pret sur le port ${PORT}`);
    console.log(`[BLAMUNE] Provider: ${config.api_provider}, Model: ${config.api_model}`);
    console.log(`[BLAMUNE] API Key: ${config.api_key ? 'Configuree' : 'NON CONFIGUREE'}`);
    console.log(`[BLAMUNE] Banque de repli : ${savoir.tailleBanqueReplis()} situations`);
    console.log(`[BLAMUNE] Cloud: ${storage.estConfigure() ? 'JSONBin.io' : 'Local'}`);

    // Keep-alive : Render endort l instance apres ~15 min sans requete. Le
    // rappel ne part que si personne n est connecte ; le rappel EXTERNE du
    // workflow .github/workflows/keepalive.yml reste indispensable, car
    // celui-ci ne reveille pas une instance arretee (voir lib/keepalive.js).
    demarrerKeepalive({
      port: PORT,
      estConnecte: () => Object.keys(connexionsActives).length > 0,
      logger: loggerErreur
    });
  });
}

// Sauvegarde cloud reguliere (memoire, etats, resumes...) + stats sur disque.
if (storage.estConfigure()) {
  setInterval(() => storage.declencherSauvegarde(), 600000);
}
setInterval(sauverStats, 60000);
// A l'arret, la sauvegarde cloud pendante doit partir : elle est buffered
// de 3 s (storage.js) et un exit direct tuerait le minuteur, perdant les
// dernieres ecritures des utilisateurs a chaque redoploiement. Filet de
// 5 s : le PUT doit avoir le temps de partir, sans jamais retenir
// l'instance en otage au moment ou l'hebergeur coupe.
function fermerProperement() {
  sauverStats();
  const filet = setTimeout(() => process.exit(0), 5000);
  if (filet.unref) filet.unref();
  Promise.resolve(storage.sauvegarderFinale ? storage.sauvegarderFinale() : null)
    .catch(() => {})
    .then(() => process.exit(0));
}
process.on('SIGTERM', fermerProperement);
process.on('SIGINT', fermerProperement);

// Cleanup old connections every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [uid, c] of Object.entries(connexionsActives)) {
    if (now - c.derniereActivite > 300000) delete connexionsActives[uid];
  }
  // Cleanup rate limits memory leak
  purgerRateLimits();
  // Cleanup inactive api histories (no activity for 30 min)
  for (const key of Object.keys(apiHistoriqueParUser)) {
    const hist = apiHistoriqueParUser[key];
    if (hist.length > 0) {
      const lastMsg = hist[hist.length - 1];
      if (!lastMsg._lastTs || now - lastMsg._lastTs > 1800000) {
        delete apiHistoriqueParUser[key];
      }
    }
  }
}, 300000);

// deploy: 2026-09-04 17:24

// 175241
