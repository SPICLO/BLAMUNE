// BLAMUNE - Cloud Storage Module (JSONBin.io)
// Stockage cloud persistant : comptes, memoires, historiques et la
// sauvegarde complete (tous les fichiers) reconstruite par server.js.
//
// Une instance Render perdue doit pouvoir se reconstituer seule :
//   JSONBIN_API_KEY  (obligatoire)  -> active le cloud
//   JSONBIN_BIN_ID   (recommande)   -> fige le bin utilise (sinon il est
//                                      retrouve automatiquement a chaque
//                                      demarrage en fouillant les bins du
//                                      compte, valide par leur contenu)

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY || '';
// Surchageable pour les tests (faux JSONBin local).
const JSONBIN_API_URL = process.env.JSONBIN_API_URL || 'https://api.jsonbin.io';
const JSONBIN_BIN_ID = (process.env.JSONBIN_BIN_ID || '').trim();
// .bin-id vit avec les donnees : sur Render il est ephemere, d'ou l'importance
// de JSONBIN_BIN_ID, mais en local il evite de creer un bin a chaque run.
const RACINE_DATA = process.env.BLAMUNE_DATA_DIR ? path.resolve(process.env.BLAMUNE_DATA_DIR) : __dirname;
const FICHIER_BIN_ID = path.join(RACINE_DATA, '.bin-id');

let binIdFichier = '';
try { binIdFichier = fs.readFileSync(FICHIER_BIN_ID, 'utf8').trim(); } catch (e) {}
let binIdCourant = JSONBIN_BIN_ID;
let _binPromise = null;

// Donnees en memoire (cache). "application" sert de marqueur : un bin vide
// est refuse par l API (400 "Bin cannot be blank"), on le remplit toujours.
let data = {
  application: 'blamune',
  comptes: {},
  historiques: {},
  memories: {},
  sauvegarde: null
};

// Fabrique de la sauvegarde complete (fournie par server.js).
let fabriqueSauvegarde = null;
let _snapDate = 0;
// Reconstruction du snapshot au plus une fois par minute (surchargeable
// en test via JSONBIN_SNAP_MIN_MS).
const SNAP_MIN_INTERVAL = Number(process.env.JSONBIN_SNAP_MIN_MS || 60000);

// Observation pour /admin (sait-on si les donnees partent vraiment au cloud ?)
let derniereSauvegarde = null;
let derniereErreur = null;
let derniereTaille = null;

function enregistrerFabrique(fn) { fabriqueSauvegarde = fn; }
function getSauvegarde() { return data.sauvegarde; }

function planifierSauvegarde() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    sauvegarderTout().catch(() => {});
  }, SAVE_DELAY);
}

// Debouncing pour la sauvegarde cloud
let _saveTimer = null;
const SAVE_DELAY = 3000; // 3 secondes

// Requete HTTP vers JSONBin (API_URL surchargeable pour les tests)
function jsonbinRequest(method, chemin, corps, entetes) {
  return new Promise((resolve, reject) => {
    const url = new URL(JSONBIN_API_URL + chemin);
    const bodyStr = corps !== undefined && corps !== null ? JSON.stringify(corps) : null;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: Object.assign({
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY
      }, entetes || {}),
      timeout: 15000
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`${method} ${chemin} -> HTTP ${res.statusCode}: ${json.message || raw.substring(0, 160)}`));
        } catch (e) {
          reject(new Error(`${method} ${chemin} -> HTTP ${res.statusCode}: ${raw.substring(0, 160) || '(reponse vide)'}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Un bin "a nous" : objet non vide portant l'une de nos marques.
async function binSemblable(id) {
  try {
    const r = await jsonbinRequest('GET', `/v3/b/${id}`);
    const rec = r && r.record !== undefined ? r.record : r;
    return !!(rec && typeof rec === 'object' && !Array.isArray(rec) &&
      (rec.application === 'blamune' || rec.sauvegarde || rec.comptes || rec.memories || rec.historiques));
  } catch (e) { return false; }
}

// Liste les ids des bins non classes : c'est la vraie route de l'API v3
// (GET /v3/b n'existe pas, elle rend 404). Paginee, du plus recent au plus
// ancien : on s'arrete au premier bin a nous.
async function listerNosBins() {
  const ids = [];
  let curseur = '';
  for (let page = 0; page < 5; page++) {
    const chemin = '/v3/c/uncategorized/bins' + (curseur ? '/' + curseur : '');
    const l = await jsonbinRequest('GET', chemin, null, { 'X-Sort-Order': 'Desc' });
    const bins = Array.isArray(l) ? l : (l && (l.bins || l.data || l.records)) || [];
    if (!bins.length) break;
    for (const b of bins) {
      const id = b && (b.id || b.binId || b._id);
      if (id && ids.indexOf(id) < 0) ids.push(id);
    }
    const dernier = bins[bins.length - 1];
    const idDernier = dernier && (dernier.id || dernier.binId || dernier._id);
    if (!idDernier || idDernier === curseur || bins.length < 10) break;
    curseur = idDernier;
  }
  return ids;
}

// Trouve le bin existant, ou en cree un. Jamais de bin cree a chaque sauvegarde.
async function trouverOuCreerBin() {
  if (JSONBIN_BIN_ID) { binIdCourant = JSONBIN_BIN_ID; return binIdCourant; }
  // Un .bin-id local connu, apres validation de son contenu.
  if (binIdFichier && (await binSemblable(binIdFichier))) {
    binIdCourant = binIdFichier;
    console.log(`[storage] Bin repris du fichier .bin-id: ${binIdFichier}`);
    return binIdCourant;
  }
  let listeOk = false;
  try {
    const ids = await listerNosBins();
    listeOk = true;
    for (const id of ids) {
      if (await binSemblable(id)) {
        binIdCourant = id;
        console.log(`[storage] Bin retrouve: ${id}`);
        return binIdCourant;
      }
    }
  } catch (e) { console.log(`[storage] liste bins KO: ${e.message}`); }
  if (!listeOk && binIdFichier) { binIdCourant = binIdFichier; return binIdCourant; }
  // L'API refuse un corps vide (400 "Bin cannot be blank") : on cree le bin
  // deja remplit avec les donnees du moment.
  const r = await jsonbinRequest('POST', '/v3/b', data, { 'X-Bin-Name': 'blamune' });
  const id = (r && r.id) || (r && r.metadata && r.metadata.id);
  if (!id) throw new Error('creation du bin impossible');
  binIdCourant = id;
  try { fs.writeFileSync(FICHIER_BIN_ID, id, 'utf8'); } catch (e) {}
  console.log(`[storage] Bin cree: ${id}`);
  console.log(`[storage] Pour figer ce bin: ajoute JSONBIN_BIN_ID=${id} (Render > Environment)`);
  return binIdCourant;
}

function binId() {
  if (binIdCourant) return Promise.resolve(binIdCourant);
  if (!_binPromise) {
    _binPromise = trouverOuCreerBin().catch(e => { _binPromise = null; throw e; });
  }
  return _binPromise;
}

// Sauvegarder tout le data dans le cloud
async function sauvegarderTout() {
  if (!JSONBIN_API_KEY) return;
  try {
    const id = await binId();
    if (!id) return;
    if (fabriqueSauvegarde && Date.now() - _snapDate > SNAP_MIN_INTERVAL) {
      try {
        const s = fabriqueSauvegarde();
        // Jamais d'ecrasement du cloud par un disque vide : une instance
        // perdue avant restauration ne doit pas effacer la sauvegarde.
        const utile = s && s.fichiers &&
          (s.fichiers['comptes.json'] || Object.keys(s.fichiers).some(k => k.indexOf('users/') === 0));
        if (utile) { data.sauvegarde = s; _snapDate = Date.now(); }
      } catch (e) { console.log('[storage] Snapshot impossible:', e.message); }
    }
    const charge = JSON.stringify(data);
    derniereTaille = Buffer.byteLength(charge);
    await jsonbinRequest('PUT', `/v3/b/${id}`, data);
    derniereSauvegarde = new Date().toISOString();
    derniereErreur = null;
  } catch (e) {
    derniereErreur = e.message;
    console.log(`[storage] Erreur sauvegarde (bin=${binIdCourant || 'inconnu'}):`, e.message);
  }
}

// Charger depuis le cloud
async function chargerDuCloud() {
  if (!JSONBIN_API_KEY) return false;
  let id;
  try { id = await binId(); } catch (e) {
    console.log('[storage] Pas de bin accessible:', e.message);
    return false;
  }
  if (!id) return false;
  try {
    const r = await jsonbinRequest('GET', `/v3/b/${id}`);
    const rec = r && r.record !== undefined ? r.record : r;
    if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
      data = Object.assign({ application: 'blamune', comptes: {}, historiques: {}, memories: {}, sauvegarde: null }, rec);
      data.application = 'blamune';
      console.log(`[storage] Charge depuis le cloud: ${Object.keys(data.comptes || {}).length} comptes`
        + (data.sauvegarde ? `, sauvegarde du ${data.sauvegarde.date}` : ''));
      return true;
    }
    return false;
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
function setComptes(c) { data.comptes = c; planifierSauvegarde(); }

function getHistorique(uid, mode) {
  return data.historiques[`${uid}_${mode}`] || [];
}
function setHistorique(uid, mode, hist) {
  data.historiques[`${uid}_${mode}`] = hist;
  planifierSauvegarde();
}

function getMemoire(uid) { return data.memories[uid] || null; }
function setMemoire(uid, memo) {
  data.memories[uid] = memo;
  planifierSauvegarde();
}

// Etat de la sauvegarde cloud, expose par /stats (admin).
function etatSauvegarde() {
  return {
    configure: !!JSONBIN_API_KEY,
    bin: binIdCourant || null,
    derniereSauvegarde,
    derniereErreur,
    derniereTaille,
    chargee: !!(data && data.sauvegarde)
  };
}

module.exports = {
  initialiser,
  getComptes, setComptes,
  getHistorique, setHistorique,
  getMemoire, setMemoire,
  sauvegarderTout,
  enregistrerFabrique, getSauvegarde, etatSauvegarde,
  declencherSauvegarde: planifierSauvegarde,
  estConfigure: () => !!JSONBIN_API_KEY
};
