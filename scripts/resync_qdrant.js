// =====================================================================
//  RESYNC QDRANT manuel : remplit le cache, puis rejette tout le savoir
//  dans l'index semantique. Identique a la synchro de demarrage de
//  server.js, mais lance a la main quand on veut finir/figer l'index sans
//  redemarrer le serveur.
//
//  Usage : node scripts/resync_qdrant.js
//  Ne touche pas au serveur en course ; savoir.db reste la source de verite.
// =====================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');

// .env into process.env (comme le serveur le fait).
for (const ligne of fs.readFileSync(path.join(RACINE, '.env'), 'utf8').split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const https = require('https');
const { SavoirDB, sansAccents } = require('../savoir_db');
const { creerQdrantFaits } = require('../lib/qdrant_faits');

// fetch maison (comme le reste du projet, aucune dependance).
function requeteHttp(url, options) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: options.method || 'GET',
        headers: options.headers || {}
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          if (res.statusCode === 429)
            return reject(Object.assign(new Error('429'), { statusCode: 429 }));
          if (res.statusCode !== 200)
            return reject(
              Object.assign(new Error('HTTP ' + res.statusCode), { statusCode: res.statusCode })
            );
          resolve(data);
        });
      }
    );
    req.setTimeout(60000, () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const CHEMIN_CACHE = path.join(RACINE, 'cache_embeddings.json');
function chargerCache() {
  try {
    return JSON.parse(fs.readFileSync(CHEMIN_CACHE, 'utf8'));
  } catch (e) {
    return {};
  }
}
function sauverCache(cache) {
  fs.writeFileSync(CHEMIN_CACHE, JSON.stringify(cache));
}

const MODELE = 'gemini-embedding-001';
const DIM = 768;
const KEY_API = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODELE + ':';

function clesEmbed() {
  return String(process.env.API_KEYS || process.env.API_KEY || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function embedLot(textes, taskType) {
  const cles = clesEmbed();
  if (!cles.length) return null;
  let crans = 0; // consecutive 429 : au-dela de 8, on laisse tomber ce lot
  for (let i = 0; i < cles.length; i++) {
    const cle = cles[i];
    try {
      const brut = await requeteHttp(KEY_API + 'batchEmbedContents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cle },
        body: JSON.stringify({
          requests: textes.map((texte) => ({
            model: 'models/' + MODELE,
            content: { parts: [{ text: texte.substring(0, 2000) }] },
            taskType,
            outputDimensionality: DIM
          }))
        })
      });
      const j = JSON.parse(brut);
      const ves = (j.embeddings || []).map((e) => e.values);
      if (ves.length !== textes.length) throw new Error('longueur embeddings != textes');
      return ves;
    } catch (e) {
      if (e.statusCode === 429) {
        crans++;
        if (crans > 8) {
          console.log('8 pauses 429 de suite : on laisse ce lot au prochain passage');
          return null;
        }
        console.log('429 : pause 65 s puis cle suivante (' + crans + ')');
        await new Promise((r) => setTimeout(r, 65000));
        continue; // cle suivante (budget potentiellement partage)
      }
      console.log('lot: ' + e.message + ' -> cle suivante');
    }
  }
  return null;
}

async function vecteurQuestion(texte) {
  const cles = clesEmbed();
  if (!cles.length) return null;
  const brut = await requeteHttp(KEY_API + 'embedContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cles[0] },
    body: JSON.stringify({
      content: { parts: [{ text: texte.substring(0, 2000) }] },
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: DIM
    })
  });
  const j = JSON.parse(brut);
  return j.embedding && j.embedding.values.length ? j.embedding.values : null;
}

(async () => {
  const db = new SavoirDB(RACINE, path.join(RACINE, 'savoir.db'));
  const faits = db.toutes().filter((f) => f.reponse && String(f.reponse).trim());
  const cache = chargerCache();

  const manquants = [];
  for (const f of faits) {
    const v = cache[sansAccents(f.cle)];
    if (Array.isArray(v) && v.length) f.vecteur = v;
    else manquants.push(f);
  }
  console.log(
    'faits total=' +
      faits.length +
      ' cache=' +
      (faits.length - manquants.length) +
      ' a calculer=' +
      manquants.length
  );

  const CODE = 25;
  for (let i = 0; i < manquants.length; i += CODE) {
    const morceau = manquants.slice(i, i + CODE);
    const ves = await embedLot(
      morceau.map((f) => (f.cle + '. ' + f.reponse).substring(0, 2000)),
      'RETRIEVAL_DOCUMENT'
    );
    if (!ves) {
      console.log('echec embeddings, cache conserve, abort');
      return;
    }
    morceau.forEach((f, x) => {
      f.vecteur = ves[x];
      cache[sansAccents(f.cle)] = ves[x];
    });
    sauverCache(cache);
    if (i + CODE < manquants.length) await new Promise((r) => setTimeout(r, 15000));
  }
  if (manquants.length) console.log('nouveaux vecteurs: ' + manquants.length);

  const indexables = faits.filter((f) => Array.isArray(f.vecteur) && f.vecteur.length);
  const q = creerQdrantFaits({
    url: process.env.QDRANT_URL,
    cleApi: process.env.QDRANT_API_KEY,
    collection: process.env.QDRANT_COLLECTION || 'blamune-faits',
    seuilRecherche: parseFloat(process.env.QDRANT_SEUIL || '') || 0.3,
    actifForcer: true,
    sansAccents,
    logger: (c, m) => console.log('[' + c + '] ' + m)
  });
  const r = await q.synchroniserTout(indexables);
  if (!r) {
    console.log('SYNCHRONISATION RATEE (voir logs au-dessus)');
    return;
  }
  console.log('INDEX : ' + r.total + ' faits dans Qdrant (768 d, Gemini)');

  // Preuve de qualite : une reformulation que le hachage local ratait.
  const question = 'c est quoi la plus grande ville du japon';
  const vq = await vecteurQuestion(question);
  if (vq) {
    const res = await q.chercher(question, 3, { vecteur: vq });
    console.log(
      'TEST SEMANTIQUE "' +
        question +
        '" : ' +
        JSON.stringify(res, (k, v) => (k === 'v' ? undefined : v))
    );
  }
})();
