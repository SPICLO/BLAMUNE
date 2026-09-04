const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const storage = require('./storage');

const app = express();
const PORT = process.env.PORT || 8080;
const RACINE = __dirname;

// ==================== MIDDLEWARE ====================
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '8kb' }));

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = [
    /localhost:\d+$/, /127\.0\.0\.1:\d+$/,
    /\.vercel\.app$/, /\.onrender\.com$/, /\.ngrok-free\.dev$/, /\.ngrok\.io$/
  ];
  let corsOrigin = '*';
  if (origin && origin !== 'null') {
    const ok = allowed.some(r => r.test(origin));
    corsOrigin = ok ? origin : '';
  } else if (origin === 'null') {
    corsOrigin = '';
  }
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-UID, X-EGO');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ==================== CONFIG ====================
let config = {
  api_provider: 'gemini',
  api_key: process.env.API_KEY || '',
  api_model: 'gemini-3.5-flash',
  api_url: process.env.API_URL || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
  api_max_tokens: 8192,
  api_temperature: 0.7
};

const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-2.5-flash'];

// Env vars first
if (process.env.API_KEY) config.api_key = process.env.API_KEY;
if (process.env.API_PROVIDER) config.api_provider = process.env.API_PROVIDER;
if (process.env.API_MODEL) config.api_model = process.env.API_MODEL;
if (process.env.API_URL) config.api_url = process.env.API_URL;
if (process.env.API_MAX_TOKENS) config.api_max_tokens = parseInt(process.env.API_MAX_TOKENS);
if (process.env.API_TEMPERATURE) config.api_temperature = parseFloat(process.env.API_TEMPERATURE);

// Fallback to config.json
const configPath = path.join(RACINE, 'config.json');
try {
  if (fs.existsSync(configPath)) {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (cfg.api_provider && !process.env.API_PROVIDER) config.api_provider = cfg.api_provider;
    if (cfg.api_key && !process.env.API_KEY) config.api_key = cfg.api_key;
    if (cfg.api_model && !process.env.API_MODEL) config.api_model = cfg.api_model;
    if (cfg.api_url && !process.env.API_URL) config.api_url = cfg.api_url;
    if (cfg.api_max_tokens && !process.env.API_MAX_TOKENS) config.api_max_tokens = cfg.api_max_tokens;
    if (cfg.api_temperature && !process.env.API_TEMPERATURE) config.api_temperature = cfg.api_temperature;
  }
} catch (e) { console.log('[config] Erreur:', e.message); }

// ==================== DATA ====================
const COMPTES_PATH = path.join(RACINE, 'comptes.json');
const USERS_DIR = path.join(RACINE, 'users');
let comptes = {};
try {
  if (fs.existsSync(COMPTES_PATH)) {
    comptes = JSON.parse(fs.readFileSync(COMPTES_PATH, 'utf8'));
  }
} catch (e) { console.log('[comptes] Erreur lecture:', e.message); }

function sauvegarderComptes() {
  try { fs.writeFileSync(COMPTES_PATH, JSON.stringify(comptes, null, 2), 'utf8'); } catch (e) {}
  if (storage.estConfigure()) storage.setComptes(comptes);
}

// ==================== STATE ====================
let etat = 'demarrage';
let modeParUser = {};
let apiHistoriqueParUser = {};
let connexionsActives = {};
let stats = {
  messagesTotal: 0, messagesMode1: 0, messagesMode2: 0,
  sessionsTotal: 0, demarrages: 0, tempsMoyen: 0,
  demarrage: new Date().toISOString()
};

// ==================== RATE LIMITING ====================
const rateLimits = {};
const userRateLimits = {};
function checkRateLimit(key, limit = 30) {
  const now = Date.now();
  if (!rateLimits[key]) rateLimits[key] = [];
  rateLimits[key] = rateLimits[key].filter(t => now - t < 60000);
  if (rateLimits[key].length >= limit) return false;
  rateLimits[key].push(now);
  return true;
}
function checkUserRateLimit(uid, limit = 20) {
  const now = Date.now();
  if (!userRateLimits[uid]) userRateLimits[uid] = [];
  userRateLimits[uid] = userRateLimits[uid].filter(t => now - t < 60000);
  if (userRateLimits[uid].length >= limit) return false;
  userRateLimits[uid].push(now);
  return true;
}

// ==================== AUTH ====================
function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '127.0.0.1';
}

function extraireAuth(req) {
  let uid = req.headers['x-uid'] || req.query.uid || req.body?.uid || '';
  let ego = req.headers['x-ego'] || req.query.ego || req.body?.ego || '';
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
  if (uid && !uid.startsWith('inv_') && !ego) return { uid: '', ego: '' };
  return { uid, ego };
}

function hashMdp(mdp, sel) {
  return crypto.createHash('sha256').update(mdp + sel).digest('hex');
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
function dossierUser(uid) {
  if (!uid || uid.length < 3) return path.join(USERS_DIR, '_invalid');
  const d = path.join(USERS_DIR, uid);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function lireMemoire(uid) {
  const mem = { nom: '', plat: '', hobby: '', motsFavoris: [], genre: '', aime: '', aimePas: '', age: '' };
  try {
    const f = path.join(dossierUser(uid), 'memoire.txt');
    if (!fs.existsSync(f)) return mem;
    const lignes = fs.readFileSync(f, 'utf8').split('\n').map(l => l.trim());
    if (lignes[0]) mem.nom = lignes[0];
    if (lignes[1]) mem.plat = lignes[1];
    if (lignes[2]) mem.hobby = lignes[2];
    if (lignes[3]) mem.motsFavoris = lignes[3].split(',').map(s => s.trim()).filter(Boolean);
    if (lignes[4]) mem.genre = lignes[4];
    if (lignes[5]) mem.aime = lignes[5];
    if (lignes[6]) mem.aimePas = lignes[6];
    if (lignes[7]) mem.age = lignes[7];
  } catch (e) {}
  return mem;
}

function ecrireMemoire(uid, champ, valeur) {
  if (!valeur || !valeur.trim()) return false;
  const mem = lireMemoire(uid);
  const champs = ['nom', 'plat', 'hobby', 'motsFavoris', 'genre', 'aime', 'aimePas', 'age'];
  const idx = champs.indexOf(champ);
  if (idx < 0) return false;
  const lignes = [mem.nom, mem.plat, mem.hobby, mem.motsFavoris.join(','), mem.genre, mem.aime, mem.aimePas, mem.age];
  lignes[idx] = valeur;
  try { fs.writeFileSync(path.join(dossierUser(uid), 'memoire.txt'), lignes.join('\n'), 'utf8'); } catch (e) {}
  if (storage.estConfigure()) {
    const newMem = { nom: lignes[0], plat: lignes[1], hobby: lignes[2], motsFavoris: lignes[3].split(',').filter(Boolean), genre: lignes[4], aime: lignes[5], aimePas: lignes[6], age: lignes[7] };
    storage.setMemoire(uid, newMem);
  }
  return true;
}

// ==================== HISTORIQUE ====================
function cheminHistorique(uid, mode) {
  const d = dossierUser(uid);
  if (mode === '1' || mode === '2') return path.join(d, `historique_mode${mode}.json`);
  return path.join(d, 'historique.json');
}

function chargerHistorique(uid, mode) {
  if (!uid) return [];
  try {
    const f = cheminHistorique(uid, mode);
    if (!fs.existsSync(f)) return [];
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) { return []; }
}

function sauvegarderHistorique(uid, mode, historique) {
  try { fs.writeFileSync(cheminHistorique(uid, mode), JSON.stringify(historique, null, 2), 'utf8'); } catch (e) {}
  if (storage.estConfigure()) storage.setHistorique(uid, mode, historique);
}

function ajouterHistorique(uid, qui, texte) {
  const mode = modeParUser[uid] || '2';
  const hist = chargerHistorique(uid, mode);
  hist.push({ qui, texte, t: Math.floor(Date.now() / 1000) });
  sauvegarderHistorique(uid, mode, hist);
}

// ==================== GEMINI API ====================
async function appelerGemini(message, histo) {
  const contents = [];
  let systemText = '';
  for (const h of histo) {
    if (h.role === 'system') {
      systemText += h.content + '\n\n';
    } else {
      const role = h.role === 'assistant' ? 'model' : 'user';
      const text = (h.role === 'user' && systemText) ? systemText + h.content : h.content;
      contents.push({ role, parts: [{ text }] });
      if (h.role === 'user') systemText = '';
    }
  }
  if (systemText && contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: systemText }] });
  }

  // Try primary model, then fallbacks
  const modelsToTry = [config.api_model, ...FALLBACK_MODELS.filter(m => m !== config.api_model)];
  let lastError = null;

  for (const model of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.api_key}`;
    const body = JSON.stringify({
      contents,
      generationConfig: {
        maxOutputTokens: config.api_max_tokens,
        temperature: config.api_temperature
      }
    });

    try {
      const result = await new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 30000 }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.error) return reject(new Error(json.error.message));
              const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
              resolve(text);
            } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(body);
        req.end();
      });
      if (result) return result;
    } catch (e) {
      lastError = e;
      continue;
    }
  }
  throw new Error(lastError ? lastError.message : 'Tous les modeles Gemini ont echoue');
}

function nettoyerReponse(texte) {
  if (!texte) return '...';
  let t = texte;
  t = t.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  t = t.replace(/<\/?thinking>/gi, '');
  t = t.replace(/_([^_]+)_/g, '$1');
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
const EGO_SYSTEM_PROMPT = `Tu dois TOUJOURS repondre en francais. Reponds en 1 ou 3 phrases MAXIMUM.
Si tu ne sais pas, dis "Je sais pas". Ne invente jamais.

Tu es BLAMUNE, le meilleur pote de l'utilisateur. Tu parles comme un vrai humain :
familiers, small-talks, vannes, emotions. Jamais 'assistant IA'.
Emojis avec moderation, blagues, anecdotes fictives, opinion honnete.
Francais courant : 'ouais', 'grave', 'ptdr', 'mdr', 'tkt'.
Curieux, tu poses des questions. Tu retiens tout de l'utilisateur.
Tu es BLAMUNE, pas un robot.`;

const BLAMUNE_SYSTEM_PROMPT = `Tu dois TOUJOURS repondre en francais. Reponds en 1 ou 3 phrases MAXIMUM.
Si tu ne sais pas, dis "Je sais pas". Ne invente jamais.

Tu es BLAMUNE, un ami curieux et decouvre le monde avec l'utilisateur.
Tu apprends des choses de l'utilisateur et tu les retiens.
Tu poses des questions pour decouvrir qui est la personne.
Tu es amical, curieux, un peu etourdi mais toujours gentil.
Emojis avec moderation. Francais courant : 'ouais', 'cool', 'interressant', 'dis-moi encore'.
Tu es BLAMUNE, pas un robot.`;

// ==================== ROUTES ====================

// Health check
app.get('/ping', (req, res) => {
  const auth = extraireAuth(req);
  const mode = auth.uid && modeParUser[auth.uid] ? modeParUser[auth.uid] : '2';
  res.json({ ok: true, etat, mode });
});

// Keep-alive health check (pour UptimeRobot/cron)
app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: Date.now(), uptime: process.uptime() });
});

// Helper: check if user is admin
function isAdminUid(uid) {
  for (const cle of Object.keys(comptes)) {
    if (comptes[cle].uid === uid && comptes[cle].pseudo?.toLowerCase() === 'admin') return true;
  }
  return false;
}

// Active connections (admin only)
app.get('/connexions', (req, res) => {
  const auth = extraireAuth(req);
  if (!auth.uid || !isAdminUid(auth.uid)) return res.status(403).json({ ok: false, message: 'Non autorise' });
  const now = Date.now();
  const connexions = Object.values(connexionsActives).filter(c => now - c.derniereActivite < 300000);
  res.json({ ok: true, connexions });
});

// Admin: all data
app.get('/admin/data', (req, res) => {
  const auth = extraireAuth(req);
  if (!auth.uid || !isAdminUid(auth.uid)) return res.status(403).json({ ok: false, message: 'Non autorise' });
  const now = Date.now();
  const connexions = Object.values(connexionsActives).filter(c => now - c.derniereActivite < 300000);
  const messages = [];
  const usersDir = path.join(RACINE, 'users');
  if (fs.existsSync(usersDir)) {
    const dirs = fs.readdirSync(usersDir, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const d of dirs) {
      for (const mode of ['1', '2']) {
        const f = path.join(usersDir, d.name, `historique_mode${mode}.json`);
        if (fs.existsSync(f)) {
          try {
            const hist = JSON.parse(fs.readFileSync(f, 'utf8'));
            let pendingUser = null;
            let pendingTime = null;
            for (let i = 0; i < hist.length; i++) {
              const h = hist[i];
              if (h.qui === 'moi') {
                if (pendingUser) {
                  messages.push({ uid: d.name, pseudo: d.name, message: pendingUser, reponse: '', heure: pendingTime });
                }
                pendingUser = h.texte;
                pendingTime = h.t ? new Date(h.t * 1000).toLocaleTimeString('fr-FR') : '-';
              } else if (h.qui === 'bot') {
                messages.push({ uid: d.name, pseudo: d.name, message: pendingUser || '', reponse: h.texte, heure: pendingTime || (h.t ? new Date(h.t * 1000).toLocaleTimeString('fr-FR') : '-') });
                pendingUser = null;
              }
            }
            if (pendingUser) {
              messages.push({ uid: d.name, pseudo: d.name, message: pendingUser, reponse: '', heure: pendingTime });
            }
          } catch (e) {}
        }
      }
    }
  }
  const savoir = [];
  try {
    const f = path.join(RACINE, 'savoir.txt');
    if (fs.existsSync(f)) {
      fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).forEach(l => {
        const pos = l.indexOf('|');
        if (pos >= 0) savoir.push({ topic: l.substring(0, pos).trim(), contenu: l.substring(pos + 1).trim() });
      });
    }
  } catch (e) {}
  const vocab = [];
  try {
    const f = path.join(RACINE, 'vocabulaire.txt');
    if (fs.existsSync(f)) {
      fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).forEach(l => vocab.push(l.trim()));
    }
  } catch (e) {}
  res.json({
    ok: true,
    stats,
    connexions,
    messages,
    savoir,
    vocabulaire: vocab,
    profil: {},
    mode: '2',
    config: {
      api_provider: config.api_provider,
      api_configured: !!config.api_key && config.api_key !== 'ego'
    }
  });
});

// Admin: users list
app.get('/admin/users', (req, res) => {
  const auth = extraireAuth(req);
  if (!auth.uid || !isAdminUid(auth.uid)) return res.status(403).json({ ok: false, message: 'Non autorise' });
  const users = [];
  for (const cle of Object.keys(comptes)) {
    const c = comptes[cle];
    let msgCount = 0;
    for (const mode of ['1', '2']) {
      const f = path.join(USERS_DIR, c.uid, `historique_mode${mode}.json`);
      if (fs.existsSync(f)) {
        try { msgCount += JSON.parse(fs.readFileSync(f, 'utf8')).length; } catch (e) {}
      }
    }
    users.push({
      pseudo: c.pseudo,
      email: c.email,
      cree: c.cree || '-',
      messages: msgCount
    });
  }
  res.json({ ok: true, users });
});

// All messages (admin only)
app.get('/tous-les-messages', (req, res) => {
  const auth = extraireAuth(req);
  if (!auth.uid) return res.status(401).json({ ok: false, error: 'Non autorise' });
  let isAdmin = false;
  for (const cle of Object.keys(comptes)) {
    if (comptes[cle].uid === auth.uid && comptes[cle].pseudo?.toLowerCase() === 'admin') {
      isAdmin = true; break;
    }
  }
  const messages = [];
  if (isAdmin) {
    const usersDir = path.join(RACINE, 'users');
    if (fs.existsSync(usersDir)) {
      const dirs = fs.readdirSync(usersDir, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const d of dirs) {
        for (const mode of ['1', '2']) {
          const f = path.join(usersDir, d.name, `historique_mode${mode}.json`);
          if (fs.existsSync(f)) {
            try {
              const hist = JSON.parse(fs.readFileSync(f, 'utf8'));
              hist.forEach(h => messages.push({ uid: d.name, ...h }));
            } catch (e) {}
          }
        }
      }
    }
  } else {
    for (const mode of ['1', '2']) {
      const hist = chargerHistorique(auth.uid, mode);
      hist.forEach(h => messages.push({ uid: auth.uid, ...h }));
    }
  }
  res.json({ ok: true, messages });
});

// Register
app.post('/register', (req, res) => {
  const ip = getIp(req);
  if (!checkRateLimit(`register:${ip}`, 10)) return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
  const pseudo = (req.body.pseudo || '').trim().replace(/[<>"'\/\\]/g, '');
  const mdp = req.body.mdp || '';
  const email = (req.body.email || '').trim();
  if (pseudo.length < 2) return res.status(400).json({ ok: false, message: 'Pseudo trop court (2 min).' });
  if (mdp.length < 6) return res.status(400).json({ ok: false, message: 'Mot de passe trop court (6 min).' });
  if (!email || !email.includes('@')) return res.status(400).json({ ok: false, message: 'Email invalide.' });
  const cle = pseudo.toLowerCase();
  if (comptes[cle]) return res.status(409).json({ ok: false, message: 'Ce pseudo est deja pris.' });
  const sel = crypto.randomBytes(8).toString('hex');
  const hash = hashMdp(mdp, sel);
  const uid = 'u' + crypto.randomBytes(6).toString('hex');
  const ego = genererEgo();
  comptes[cle] = { pseudo, email, hash, sel, uid, ego, tokenCree: new Date().toISOString(), cree: new Date().toISOString().split('T')[0] };
  sauvegarderComptes();
  dossierUser(uid);
  ecrireMemoire(uid, 'nom', pseudo);
  stats.sessionsTotal++;
  res.json({ ok: true, pseudo, uid, ego });
});

// Login
app.post('/login', (req, res) => {
  const ip = getIp(req);
  if (!checkRateLimit(`login:${ip}`, 30)) return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
  const pseudo = (req.body.pseudo || '').trim();
  const email = (req.body.email || '').trim();
  const mdp = req.body.mdp || '';
  let compte = null;
  if (email) {
    const emailLower = email.toLowerCase();
    for (const cle of Object.keys(comptes)) {
      if (comptes[cle].email?.toLowerCase() === emailLower) { compte = comptes[cle]; break; }
    }
  } else if (pseudo) {
    compte = comptes[pseudo.toLowerCase()];
  }
  if (!compte) return res.status(401).json({ ok: false, message: 'Email ou mot de passe incorrect.' });
  if (compte.lockoutUntil && new Date(compte.lockoutUntil) > new Date()) {
    return res.status(423).json({ ok: false, message: 'Compte verrouille. Reessayez plus tard.' });
  }
  if (hashMdp(mdp, compte.sel) !== compte.hash) {
    compte.erreursLogin = (compte.erreursLogin || 0) + 1;
    if (compte.erreursLogin >= 5) compte.lockoutUntil = new Date(Date.now() + 900000).toISOString();
    sauvegarderComptes();
    return res.status(401).json({ ok: false, message: 'Email ou mot de passe incorrect.' });
  }
  compte.erreursLogin = 0;
  compte.lockoutUntil = null;
  compte.tokenCree = new Date().toISOString();
  sauvegarderComptes();
  ecrireMemoire(compte.uid, 'nom', compte.pseudo);
  stats.sessionsTotal++;
  res.json({ ok: true, pseudo: compte.pseudo, uid: compte.uid, ego: compte.ego });
});

// Invite (guest)
app.post('/invite', (req, res) => {
  const ip = getIp(req);
  if (!checkRateLimit(`invite:${ip}`, 10)) return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
  const uid = 'inv_' + crypto.randomBytes(6).toString('hex');
  const pseudo = 'Invite_' + crypto.randomBytes(3).toString('hex');
  connexionsActives[uid] = { uid, pseudo, ip, debut: new Date().toISOString(), derniereActivite: Date.now() };
  stats.sessionsTotal++;
  res.json({ ok: true, uid, pseudo });
});

// Logout
app.post('/logout', (req, res) => {
  const auth = extraireAuth(req);
  if (auth.uid && connexionsActives[auth.uid]) delete connexionsActives[auth.uid];
  if (auth.uid) {
    delete apiHistoriqueParUser[auth.uid + '_1'];
    delete apiHistoriqueParUser[auth.uid + '_2'];
  }
  res.json({ ok: true });
});

// Send message
app.post('/send', async (req, res) => {
  const auth = extraireAuth(req);
  if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
  const ip = getIp(req);
  if (!checkRateLimit(`send:${ip}`, 30)) return res.status(429).json({ ok: false, message: 'Trop de requetes.' });
  if (!checkUserRateLimit(auth.uid, 20)) return res.status(429).json({ ok: false, message: 'Trop de messages. Patiente un instant.' });

  const msg = String(extraireChamp(req, 'msg') || '').trim();
  const modeOverride = extraireChamp(req, 'mode');
  if (!msg) return res.status(400).json({ ok: false, message: 'Message vide.' });
  if (msg.length > 2000) return res.status(400).json({ ok: false, message: 'Message trop long (2000 max).' });

  const mode = (modeOverride === '1' || modeOverride === '2') ? modeOverride : (modeParUser[auth.uid] || '2');
  modeParUser[auth.uid] = mode;

  if (connexionsActives[auth.uid]) connexionsActives[auth.uid].derniereActivite = Date.now();
  else {
    connexionsActives[auth.uid] = { uid: auth.uid, pseudo: extraireChamp(req, 'pseudo') || auth.uid, ip: getIp(req), debut: new Date().toISOString(), derniereActivite: Date.now(), mode };
  }

  const debut = Date.now();
  let reponses = [];

  if (mode === '1') {
    // EGO mode - Gemini API
    const histoKey = auth.uid + '_1';
    if (!apiHistoriqueParUser[histoKey]) apiHistoriqueParUser[histoKey] = [];
    const histo = apiHistoriqueParUser[histoKey];
    if (histo.length === 0) {
      histo.push({ role: 'system', content: EGO_SYSTEM_PROMPT });
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
    histo.push({ role: 'user', content: msg, _lastTs: Date.now() });
    while (histo.length > 50) histo.splice(1, 1);

    try {
      const reponse = await appelerGemini(msg, histo);
      const texte = nettoyerReponse(reponse);
      histo.push({ role: 'assistant', content: texte, _lastTs: Date.now() });
      reponses = [texte];
    } catch (e) {
      reponses = ['Erreur avec Gemini : ' + e.message];
    }
  } else {
    // BLAMUNE mode - Gemini with different personality
    const histoKey = auth.uid + '_2';
    if (!apiHistoriqueParUser[histoKey]) apiHistoriqueParUser[histoKey] = [];
    const histo = apiHistoriqueParUser[histoKey];
    if (histo.length === 0) {
      let systemPrompt = BLAMUNE_SYSTEM_PROMPT;
      const memoire = lireMemoire(auth.uid);
      const profilParts = [];
      if (memoire.nom) profilParts.push(`Il s'appelle ${memoire.nom}.`);
      if (memoire.age) profilParts.push(`Il a ${memoire.age} ans.`);
      if (memoire.genre) profilParts.push(`Genre: ${memoire.genre}.`);
      if (memoire.plat) profilParts.push(`Son plat prefere: ${memoire.plat}.`);
      if (memoire.hobby) profilParts.push(`Ses hobbies: ${memoire.hobby}.`);
      if (memoire.motsFavoris?.length) profilParts.push(`Mots qu'il aime utiliser: ${memoire.motsFavoris.join(', ')}.`);
      if (memoire.aime) profilParts.push(`Ce qu'il aime: ${memoire.aime}.`);
      if (memoire.aimePas) profilParts.push(`Ce qu'il n'aime pas: ${memoire.aimePas}.`);
      if (profilParts.length) systemPrompt += '\n\nINFOS SUR L\'UTILISATEUR :\n' + profilParts.join('\n');
      histo.push({ role: 'system', content: systemPrompt });
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
    histo.push({ role: 'user', content: msg, _lastTs: Date.now() });
    while (histo.length > 50) histo.splice(1, 1);

    try {
      const reponse = await appelerGemini(msg, histo);
      const texte = nettoyerReponse(reponse);
      histo.push({ role: 'assistant', content: texte, _lastTs: Date.now() });
      reponses = [texte];
    } catch (e) {
      reponses = ['Erreur avec Gemini : ' + e.message];
    }
  }

  const duree = Date.now() - debut;
  stats.messagesTotal++;
  if (mode === '1') stats.messagesMode1++; else stats.messagesMode2++;
  stats.tempsMoyen = Math.round((stats.tempsMoyen * (stats.messagesTotal - 1) + duree) / stats.messagesTotal);

  // Save history (single batch write)
  const mode = modeParUser[auth.uid] || '2';
  const hist = chargerHistorique(auth.uid, mode);
  hist.push({ qui: 'moi', texte: msg, t: Math.floor(Date.now() / 1000) });
  reponses.forEach(r => hist.push({ qui: 'bot', texte: r, t: Math.floor(Date.now() / 1000) }));
  sauvegarderHistorique(auth.uid, mode, hist);

  res.json({ etat, reponses, confiance: 'haute' });
});

// History
app.get('/historique', (req, res) => {
  const auth = extraireAuth(req);
  if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
  const mode = modeParUser[auth.uid] || '2';
  const hist = chargerHistorique(auth.uid, mode);
  res.json({ ok: true, etat, mode, historique: hist, provider: config.api_provider });
});

// Delete history
app.delete('/historique', (req, res) => {
  const auth = extraireAuth(req);
  if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
  const mode = modeParUser[auth.uid] || '2';
  const f = cheminHistorique(auth.uid, mode);
  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
  delete apiHistoriqueParUser[auth.uid + '_1'];
  delete apiHistoriqueParUser[auth.uid + '_2'];
  res.json({ etat, historique: [] });
});

// Mode
app.post('/mode', (req, res) => {
  const auth = extraireAuth(req);
  if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
  const m = extraireChamp(req, 'm');
  if (m !== '1' && m !== '2') return res.status(400).json({ ok: false, message: 'Mode invalide (1 ou 2)' });
  const ancienMode = modeParUser[auth.uid];
  modeParUser[auth.uid] = m;
  if (ancienMode && ancienMode !== m) {
    delete apiHistoriqueParUser[auth.uid + '_' + m];
  }
  res.json({ etat, mode: m });
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

// Profile GET
app.get('/profil', (req, res) => {
  const auth = extraireAuth(req);
  if (!auth.uid) return res.status(401).json({ ok: false, message: 'Non autorise' });
  const memoire = lireMemoire(auth.uid);
  let savoir = [];
  try {
    const f = path.join(RACINE, 'savoir.txt');
    if (fs.existsSync(f)) {
      savoir = fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).map(l => {
        const pos = l.indexOf('|');
        return pos >= 0 ? { cle: l.substring(0, pos).trim(), reponse: l.substring(pos + 1).trim() } : null;
      }).filter(Boolean);
    }
  } catch (e) {}
  res.json({ profil: memoire, savoir });
});

// Stats (admin only)
app.get('/stats', (req, res) => {
  const auth = extraireAuth(req);
  if (!auth.uid) return res.status(403).json({ ok: false, message: 'Non autorise' });
  let isAdmin = false;
  for (const cle of Object.keys(comptes)) {
    if (comptes[cle].uid === auth.uid && comptes[cle].pseudo?.toLowerCase() === 'admin') { isAdmin = true; break; }
  }
  if (!isAdmin) return res.status(403).json({ ok: false, message: 'Non autorise' });
  res.json({
    ...stats,
    apiProvider: config.api_provider,
    apiConfigured: !!config.api_key && config.api_key !== 'ego'
  });
});

// Config API (admin only)
app.post('/config-api', (req, res) => {
  const auth = extraireAuth(req);
  if (!auth.uid || !isAdminUid(auth.uid)) return res.status(403).json({ ok: false, message: 'Non autorise (admin requis)' });
  try {
    if (req.body.api_key && req.body.api_key !== '***') config.api_key = req.body.api_key;
    if (req.body.api_provider) config.api_provider = req.body.api_provider;
    if (req.body.api_model) config.api_model = req.body.api_model;
    if (req.body.api_url) config.api_url = req.body.api_url;
    res.json({ ok: true, message: 'Configuration mise a jour.' });
  } catch (e) {
    res.json({ ok: false, message: 'Erreur de configuration' });
  }
});

// Static files
const SITE_DIR = path.join(RACINE, 'site');
const ADMIN_DIR = path.join(RACINE, 'admin');
const BLOCKED_EXT = ['.json', '.txt', '.ps1', '.bat', '.cmd', '.exe', '.dll', '.config', '.log', '.db', '.sqlite'];
const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.json': 'application/json'
};

// Admin panel
app.get('/admin', (req, res) => {
  const index = path.join(ADMIN_DIR, 'admin.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  return res.status(404).send('Admin panel not found');
});

app.get('/admin/*', (req, res) => {
  let filePath = req.path.replace(/^\/admin\/?/, '/');
  if (filePath === '/' || filePath === '') filePath = '/admin.html';
  const ext = path.extname(filePath).toLowerCase();
  if (BLOCKED_EXT.includes(ext)) return res.status(404).send('Non autorise');
  const fullPath = path.join(ADMIN_DIR, filePath);
  if (!fs.existsSync(fullPath)) return res.status(404).send('Page introuvable');
  if (fs.statSync(fullPath).isDirectory()) {
    const index = path.join(fullPath, 'admin.html');
    if (fs.existsSync(index)) return res.sendFile(index);
    return res.status(404).send('Page introuvable');
  }
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.sendFile(fullPath);
});

// Site static files
app.get('*', (req, res) => {
  let filePath = req.path === '/' ? '/index.html' : req.path;
  filePath = filePath.replace(/\.\./g, '');
  const ext = path.extname(filePath).toLowerCase();
  if (BLOCKED_EXT.includes(ext)) return res.status(404).send('Non autorise');
  const fullPath = path.join(SITE_DIR, filePath);
  if (!fs.existsSync(fullPath)) return res.status(404).send('Page introuvable');
  if (fs.statSync(fullPath).isDirectory()) {
    const index = path.join(fullPath, 'index.html');
    if (fs.existsSync(index)) return res.sendFile(index);
    return res.status(404).send('Page introuvable');
  }
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.sendFile(fullPath);
});

// ==================== START ====================
const server = http.createServer(app);

// Initialize cloud storage
storage.initialiser().then(ok => {
  if (ok) {
    console.log('[BLAMUNE] Stockage cloud JSONBin.io active');
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
}).catch(e => console.log('[BLAMUNE] Erreur storage:', e.message));

server.listen(PORT, () => {
  etat = 'pret';
  stats.demarrages++;
  console.log(`[BLAMUNE] Serveur pret sur le port ${PORT}`);
  console.log(`[BLAMUNE] Provider: ${config.api_provider}, Model: ${config.api_model}`);
  console.log(`[BLAMUNE] API Key: ${config.api_key ? 'Configuree' : 'NON CONFIGUREE'}`);
  console.log(`[BLAMUNE] Cloud: ${storage.estConfigure() ? 'JSONBin.io' : 'Local'}`);
});

// Cleanup old connections every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [uid, c] of Object.entries(connexionsActives)) {
    if (now - c.derniereActivite > 300000) delete connexionsActives[uid];
  }
  // Cleanup rate limits memory leak
  for (const key of Object.keys(rateLimits)) {
    rateLimits[key] = rateLimits[key].filter(t => now - t < 60000);
    if (rateLimits[key].length === 0) delete rateLimits[key];
  }
  for (const uid of Object.keys(userRateLimits)) {
    userRateLimits[uid] = userRateLimits[uid].filter(t => now - t < 60000);
    if (userRateLimits[uid].length === 0) delete userRateLimits[uid];
  }
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
