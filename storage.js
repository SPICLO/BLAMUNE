// BLAMUNE - Cloud Storage Module (JSONBin.io)
// Stockage cloud persistant - un seul bin pour toutes les données

const https = require('https');
const fs = require('fs');
const path = require('path');

const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY || '';
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID || '';

// Données en mémoire (cache)
let data = {
  comptes: {},
  historiques: {},
  memories: {}
};

// Requête HTTP vers JSONBin
function jsonbinRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.jsonbin.io',
      path: urlPath,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY
      },
      timeout: 15000
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(options, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(json.message || `HTTP ${res.statusCode}`));
        } catch (e) {
          reject(new Error(`Parse error: ${raw.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Sauvegarder tout le data dans le cloud
async function sauvegarderTout() {
  if (!JSONBIN_API_KEY) return;
  try {
    if (!JSONBIN_BIN_ID) {
      // Créer un nouveau bin
      const r = await jsonbinRequest('POST', '/v3', data);
      const newId = r.id || r.metadata?.id;
      console.log(`[storage] Bin créé: ${newId}`);
      // Sauvegarder l'ID dans un fichier local
      fs.writeFileSync(path.join(__dirname, '.bin-id'), newId, 'utf8');
      process.env.JSONBIN_BIN_ID = newId;
    } else {
      await jsonbinRequest('PUT', `/v3/${JSONBIN_BIN_ID}`, data);
    }
  } catch (e) {
    console.log('[storage] Erreur sauvegarde:', e.message);
  }
}

// Charger depuis le cloud
async function chargerDuCloud() {
  const binId = JSONBIN_BIN_ID || (() => {
    try { return fs.readFileSync(path.join(__dirname, '.bin-id'), 'utf8').trim(); } catch (e) { return ''; }
  })();
  if (!binId || !JSONBIN_API_KEY) return false;
  try {
    const r = await jsonbinRequest('GET', `/v3/${binId}`);
    data = r.record || r;
    console.log(`[storage] Chargé depuis cloud: ${Object.keys(data.comptes || {}).length} comptes`);
    return true;
  } catch (e) {
    console.log('[storage] Erreur chargement cloud:', e.message);
    return false;
  }
}

// ==================== API PUBLIQUE ====================

function initialiser() {
  if (!JSONBIN_API_KEY) {
    console.log('[storage] Pas de JSONBIN_API_KEY → mode local');
    return Promise.resolve(false);
  }
  return chargerDuCloud();
}

function getComptes() { return data.comptes; }
function setComptes(c) { data.comptes = c; sauvegarderTout().catch(() => {}); }

function getHistorique(uid, mode) {
  return data.historiques[`${uid}_${mode}`] || [];
}
function setHistorique(uid, mode, hist) {
  data.historiques[`${uid}_${mode}`] = hist;
  sauvegarderTout().catch(() => {});
}

function getMemoire(uid) {
  return data.memories[uid] || null;
}
function setMemoire(uid, memo) {
  data.memories[uid] = memo;
  sauvegarderTout().catch(() => {});
}

module.exports = {
  initialiser,
  getComptes, setComptes,
  getHistorique, setHistorique,
  getMemoire, setMemoire,
  sauvegarderTout,
  estConfigure: () => !!JSONBIN_API_KEY
};
