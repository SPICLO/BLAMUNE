// BLAMUNE - Cloud Storage Module (Cloudflare KV)
// Stockage cloud persistant : comptes, memoires, historiques et la
// sauvegarde complete (tous les fichiers) reconstruite par server.js.
//
// Une instance Render perdue doit pouvoir se reconstituer seule :
//   CF_KV_ACCOUNT_ID    (obligatoire) -> identifiant de compte Cloudflare
//   CF_KV_NAMESPACE_ID  (obligatoire) -> le namespace KV dedie a BLAMUNE
//   CF_KV_API_TOKEN     (obligatoire) -> jeton avec droit KV Edit
//   CF_KV_API_URL       (optionnel)   -> surcharge pour les tests
// Les TROIS variables ensemble activent le cloud ; sans elles, le mode
// est local (donnees perdues au redeploiement Render : disque ephemere).
//
// Note : l'ancien backend JSONBin.io a ete retire. Son plan gratuit
// plafonnait le bin a 100 Ko — le snapshot complet grossit a chaque
// message, le bin saturait, les PUT recevaient un 403 et toute la
// chaine de decouverte de bins (listing, .bin-id, reprise auto) servait
// a pallier une limite structurelle. Cloudflare KV : 1 Go gratuit,
// valeurs jusqu'a 25 Mo — des annees de marge, une seule cle.

const https = require('https');
const http = require('http');
const path = require('path');

if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
}

const CF_KV_ACCOUNT_ID = (process.env.CF_KV_ACCOUNT_ID || '').trim();
const CF_KV_NAMESPACE_ID = (process.env.CF_KV_NAMESPACE_ID || '').trim();
const CF_KV_API_TOKEN = (process.env.CF_KV_API_TOKEN || '').trim();
// Surchargeable pour les tests (faux serveur KV local).
const CF_KV_API_URL =
  process.env.CF_KV_API_URL || 'https://api.cloudflare.com/client/v4';
// Une seule cle valeur porte l'objet data ENTIER (comptes + historiques
// + memoires + snapshot). Le plafond de 25 Mo par valeur donne des annees
// de marge ; l'API KV n'accepte pas une valeur vide, d'ou le marqueur
// "application" dans data.
const CLE_KV = 'blamune';

// Reconstruction du snapshot au plus une fois par minute (surchargeable
// en test via STORAGE_SNAP_MIN_MS).
const SNAP_MIN_INTERVAL = Number(process.env.STORAGE_SNAP_MIN_MS || 60000);

// Donnees en memoire (cache). "application" sert de marqueur : une valeur
// vide est refusee par l'API KV, on la remplit toujours.
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

// Observation pour /admin (sait-on si les donnees partent vraiment au cloud ?)
let derniereSauvegarde = null;
let derniereErreur = null;
let derniereTaille = null;
// Le KV a-t-il deja ete LU avec succes (ou confirme vide) ? Si un
// demarrage tombe pendant une panne KV, l'etat local garde en memoire
// n'est que le reste d'un disque neuf (1 compte admin sur Render). Un PUT
// au nom de ces restes ecraserait comptes + historiques + memoires REELS
// du cloud. Exception voulue : un 404 (cloud vierge) autorise le premier
// PUT — il n'y a rien a ecraser.
let kvLuAuMoinsUneFois = false;

function enregistrerFabrique(fn) {
  fabriqueSauvegarde = fn;
}
function getSauvegarde() {
  return data.sauvegarde;
}

// Debouncing pour la sauvegarde cloud
let _saveTimer = null;
const SAVE_DELAY = 3000; // 3 secondes
// Reprise apres echec : 3 s, puis 12 s, 27 s... crible a 60 s. Sans
// reprise, une panne reseau suivie d'une tranche sans ecriture laissait
// les donnees non sauvegardees jusqu'au prochain utilisateur.
let echecSauvegarde = 0;

function planifierSauvegarde(retardMs) {
  if (_saveTimer) clearTimeout(_saveTimer);
  // .unref : le minuteur ne doit jamais RETENIR le processus en vie tout
  // seul. Le serveur garde ses sockets ouverts ; et a l'arret,
  // sauvegarderFinale() fait la sauvegarde immediate de toute facon.
  // Sans lui, node --test (et tout harnais sans serveur) restait accroche.
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    sauvegarderTout().catch(() => {});
  }, retardMs || SAVE_DELAY);
  if (_saveTimer.unref) _saveTimer.unref();
}

/**
 * Sauvegarde immediate, sans debouncing. Appelee a l'arret du processus
 * (SIGTERM/SIGINT) : Render donne quelques secondes de grace, sans elle
 * le minuteur de 3 s mourrait avec le processus et les dernieres
 * ecritures des utilisateurs seraient perdues a chaque redoploiement.
 */
function sauvegarderFinale() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  return sauvegarderTout();
}

// Requete HTTP vers Cloudflare KV. Corps = valeur brute (notre JSON
// stringifie) ; reponse = valeur brute en GET (404 -> null). L'API KV
// renvoie du JSON pour les erreurs et parfois pour le PUT.
function kvRequete(methode, corps) {
  return new Promise((resolve, reject) => {
    const chemin = `/accounts/${CF_KV_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${CLE_KV}`;
    const url = new URL(CF_KV_API_URL + chemin);
    const bodyStr = methode === 'PUT' && corps !== undefined ? String(corps) : null;
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: methode,
      headers: Object.assign(
        {
          Authorization: 'Bearer ' + CF_KV_API_TOKEN
        },
        bodyStr !== null ? { 'Content-Type': 'application/json' } : {}
      ),
      timeout: 15000
    };
    if (bodyStr !== null) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    // Le transport suit le protocole de CF_KV_API_URL : https en
    // production, http pour un faux serveur de test local.
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        if (res.statusCode === 404 && methode === 'GET') return resolve(null);
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(raw);
        let detail = raw;
        try {
          const j = JSON.parse(raw);
          detail = (j.errors && j.errors.length
            ? j.errors
                .map((e) =>
                  e && typeof e === 'object'
                    ? (e.message ? e.message + ' (code ' + e.code + ')' : JSON.stringify(e))
                    : String(e)
                )
                .join('; ')
            : raw) || raw;
        } catch (e) {}
        reject(
          new Error(`${methode} KV -> HTTP ${res.statusCode}: ${detail.substring(0, 160)}`)
        );
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    if (bodyStr !== null) req.write(bodyStr);
    req.end();
  });
}

// Snapshot de la sauvegarde complete : reconstruit au plus une fois par
// minute. Jamais d'ecrasement du cloud par un disque vide : une instance
// perdue avant restauration ne doit pas effacer la sauvegarde.
function rafraichirSnapshot() {
  if (!fabriqueSauvegarde || Date.now() - _snapDate <= SNAP_MIN_INTERVAL) return;
  try {
    const s = fabriqueSauvegarde();
    const utile =
      s &&
      s.fichiers &&
      (s.fichiers['comptes.json'] ||
        Object.keys(s.fichiers).some((k) => k.indexOf('users/') === 0));
    if (utile) {
      data.sauvegarde = s;
      _snapDate = Date.now();
    }
  } catch (e) {
    console.log('[storage] Snapshot impossible:', e.message);
  }
}

// Sauvegarder tout le data dans le cloud
async function sauvegarderTout() {
  if (!estConfigure()) return;
  try {
    // Garde anti-ecrasement : tant qu'aucune lecture du KV n'a jamais
    // reussi (demarrage pendant une panne KV), l'etat en memoire peut
    // n'etre qu'un reste ampute. On retente d'abord une lecture ; si elle
    // echoue encore, on n'emet AUCUN PUT et on reprogramme comme un echec :
    // la file reste vivante, et l'ecriture utilisateur suivante rearme.
    if (!kvLuAuMoinsUneFois) {
      const lu = await chargerDuCloud();
      if (!lu) {
        // Un 404 a deja mis kvLuAuMoinsUneFois : ici c'est un VRAI echec.
        derniereErreur = 'KV jamais charge avec succes : PUT ajourne';
        echecSauvegarde += 1;
        planifierSauvegarde(Math.min(SAVE_DELAY * echecSauvegarde * echecSauvegarde, 60000));
        return;
      }
    }
    rafraichirSnapshot();
    const charge = JSON.stringify(data);
    derniereTaille = Buffer.byteLength(charge);
    await kvRequete('PUT', charge);
    derniereSauvegarde = new Date().toISOString();
    derniereErreur = null;
    echecSauvegarde = 0;
  } catch (e) {
    derniereErreur = e.message;
    echecSauvegarde += 1;
    // Reprise a dosage croissant : l'ecriture suivante redeclenche aussi
    // la sauvegarde, mais si personne n'ecrit plus, la file reste vivante
    // jusqu'au plafond de 60 s.
    planifierSauvegarde(Math.min(SAVE_DELAY * echecSauvegarde * echecSauvegarde, 60000));
    console.log('[storage] Erreur sauvegarde KV :', e.message);
  }
}

// Charger depuis le cloud
async function chargerDuCloud() {
  if (!estConfigure()) return false;
  try {
    const brut = await kvRequete('GET');
    if (!brut) {
      console.log('[storage] KV : cle inexistante (premiere instance ?)');
      // Rien dans le cloud : un PUT initial est legitime (le cloud est
      // vide par construction, aucun risque d'ecraser des donnees reelles).
      kvLuAuMoinsUneFois = true;
      return false;
    }
    const rec = JSON.parse(brut);
    if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
      data = Object.assign(
        { application: 'blamune', comptes: {}, historiques: {}, memories: {}, sauvegarde: null },
        rec
      );
      data.application = 'blamune';
      // Lecture reussie : a partir de maintenant, l'etat en memoire
      // PROVIENT du cloud. Toute ecriture qui suivra porte du contenu vrai.
      kvLuAuMoinsUneFois = true;
      console.log(
        `[storage] Charge depuis Cloudflare KV: ${Object.keys(data.comptes || {}).length} comptes` +
          (data.sauvegarde ? `, sauvegarde du ${data.sauvegarde.date}` : '')
      );
      return true;
    }
    return false;
  } catch (e) {
    console.log('[storage] Erreur chargement KV:', e.message);
    return false;
  }
}

// ==================== API PUBLIQUE ====================

// Le cloud n'est actif qu'avec les TROIS variables CF_KV_* ensemble.
function estConfigure() {
  return !!(CF_KV_ACCOUNT_ID && CF_KV_NAMESPACE_ID && CF_KV_API_TOKEN);
}

function initialiser() {
  if (!estConfigure()) {
    console.log(
      '[storage] Cloud KV partiellement configure : CF_KV_ACCOUNT_ID, CF_KV_NAMESPACE_ID et CF_KV_API_TOKEN sont tous requis -> mode local'
    );
    return Promise.resolve(false);
  }
  return chargerDuCloud();
}

function getComptes() {
  return data.comptes;
}
function setComptes(c) {
  data.comptes = c;
  planifierSauvegarde();
}

function getHistorique(uid, mode) {
  return data.historiques[`${uid}_${mode}`] || [];
}
function setHistorique(uid, mode, hist) {
  data.historiques[`${uid}_${mode}`] = hist;
  planifierSauvegarde();
}

function getMemoire(uid) {
  return data.memories[uid] || null;
}
function setMemoire(uid, memo) {
  data.memories[uid] = memo;
  planifierSauvegarde();
}

/**
 * Supprime dans le cloud tout ce qui appartient a un utilisateur :
 * ses historiques (cles "uid_mode" ; le uid ne contient jamais de
 * underscore, l'indice sert de prefixe) et sa memoire. Appellee a la
 * suppression d'un compte cote admin ET a la purge des invites (24 h).
 *
 * Le SNAPSHOT est aussi invalide : il embarque une copie des fichiers
 * du dossier utilisateur, qui vient d'etre efface du disque. Sans cette
 * remise a zero, la sauvegarde suivante (moins d'une minute plus tard)
 * repartirait avec le snapshot ANTERIEUR — l'invite supprimee resterait
 * dans le cloud jusqu'au prochain refresh spontane.
 */
function supprimerTout(uid) {
  const prefixe = uid + '_';
  for (const cle of Object.keys(data.historiques)) {
    if (cle.indexOf(prefixe) === 0) delete data.historiques[cle];
  }
  delete data.memories[uid];
  if (data.sauvegarde && data.sauvegarde.fichiers) {
    const d = 'users/' + uid + '/';
    for (const cle of Object.keys(data.sauvegarde.fichiers)) {
      if (cle.indexOf(d) === 0) delete data.sauvegarde.fichiers[cle];
    }
  }
  _snapDate = 0; // le prochain PUT reconstruit un snapshot propre
  planifierSauvegarde();
}

// Etat de la sauvegarde cloud, expose par /stats (admin).
function etatSauvegarde() {
  return {
    configure: estConfigure(),
    backend: 'kv',
    derniereSauvegarde,
    derniereErreur,
    nbEchecs: echecSauvegarde,
    derniereTaille,
    chargee: !!(data && data.sauvegarde)
  };
}

module.exports = {
  initialiser,
  getComptes,
  setComptes,
  getHistorique,
  setHistorique,
  getMemoire,
  setMemoire,
  supprimerTout,
  sauvegarderTout,
  sauvegarderFinale,
  enregistrerFabrique,
  getSauvegarde,
  etatSauvegarde,
  declencherSauvegarde: planifierSauvegarde,
  estConfigure
};
