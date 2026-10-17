// =====================================================================
//  Qdrant faits : memoire SEMANTIQUE du savoir BLAMUNE, en cloud
// =====================================================================
//  Le savoir.db ne repond qu'aux mots-cles EXACTS (chercherSavoir en
//  serveur.js). Qdrant ajoute la couche manquante : retrouver le fait
//  pertinent quand la question n'utilise pas les memes mots
//  ("combien coute le blabla" -> fait range sous "prix du blabla").
//
//  Choix d'architecture (QDRANT_EMBED) :
//   - 'gemini' (conseille) : le foisseur de vecteurs est INJECTE par
//     serveur.js (fait.vecteur present sur chaque item, vitteur passe
//     pour la question) : vraie semantique, quota d'embeddings Gemini
//     (gratuit, distinct du quota de chat des memes cles). Collection
//     768 dimensions, se resynchronise entierement a chaque boot.
//   - defaut : VECTEUR LOCAL (hachage 256 dimensions, sans reseau) :
//     gratuit, deterministe, aucune API. Cosinus + seuil font le reste :
//     deja utile sur les reformulations lexicales, moins bon sur les
//     synonymes vrais.
//   - Le module decide RIEN des embeds : il indexe ce qu'on lui donne.
//
//  CLIENT REST minimal sur require('https') : aucune dependance npm,
//  comme le reste du projet.
//
//  ECRITURE de type "upsert" : le fait source de verite reste
//  savoir.db (SQLite). Qdrant n'est qu'un INDEX serviable et jetable :
//  on peut le vider et resynchroniser sans perdre un octet de savoir.
//
//  Toutes les fonctions reseau renvoient null en cas d'echec et loggent :
//  la recherche semantique est un BONUS, jamais une condition de marche.
//  Tests : tests/qdrant_faits.test.js (reseau injete, jamais vrai).
// =====================================================================
'use strict';

const https = require('https');
const http = require('http');

// Mots francais trop courants pour porter du sens : ils gonflent le
// cosinus de n'importe quelle paire de phrases sinon.
const STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'est',
  'qui', 'que', 'quoi', 'tout', 'tous', 'je', 'tu', 'il', 'elle', 'on',
  'nous', 'vous', 'ils', 'a', 'au', 'aux', 'ce', 'cet', 'cette', 'son',
  'sa', 'ses', 'mon', 'ma', 'mes', 'pour', 'pas', 'plus', 'par', 'comme',
  'ca', 'the', 'en', 'dans', 'sur', 'ben', 'moi', 'toi', 'lui', 'donc'
]);

const DIM = 256;

// FNV-1a 32 bits : rapide, deterministe, aucune dependance.
function fnv1a(texte) {
  let h = 0x811c9dc5;
  const s = String(texte);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

// Tokenisation : minuscules sans accents, mots entiers, pluriels
// rouges d'un 's' final. Retourne un tableau de mots.
function tokeniser(texte, sansAccents) {
  const brut = String(sansAccents(texte)).toLowerCase();
  const mots = brut.split(/[^a-z0-9']+/).filter(Boolean);
  const sortie = [];
  for (const m of mots) {
    if (m.length <= 2) continue;
    if (STOPWORDS.has(m)) continue;
    sortie.push(m);
    if (m.length > 3 && m.endsWith('s') && !m.endsWith('ss')) {
      // "ordis" -> meme sac de mots que "ordi".
      sortie.push(m.slice(0, -1));
    }
  }
  return sortie;
}

// Vecteur : sac de mots projetes par hachage, compte, normalise (L2).
function vectoriser(texte, sansAccents) {
  const mots = tokeniser(texte, sansAccents);
  const v = new Array(DIM).fill(0);
  if (!mots.length) return v;
  for (const m of mots) {
    v[fnv1a(m) % DIM] += 1;
    // Bigramme de caracteres courts : robuste aux fautes de frappe
    // legieres ("ordinauteur") sans base d'apprentissage.
    if (m.length > 5) {
      v[fnv1a('bg:' + m.slice(-4)) % DIM] += 0.5;
    }
  }
  let norme = 0;
  for (const x of v) norme += x * x;
  norme = Math.sqrt(norme) || 1;
  for (let i = 0; i < DIM; i++) v[i] = v[i] / norme;
  return v;
}

// Cosinus entre deux vecteurs dejа normalises = produit scalaire.
function produitScalaire(a, b) {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += a[i] * b[i];
  return s;
}

// ---- Client REST Qdrant --------------------------------------------

function creerQdrantFaits({
  url, cleApi, collection,
  sansAccents, requeteur, actifForcer,
  seuilRecherche, logger
}) {
  const BASE = String(url || '').replace(/\/+$/, '');
  const COLL = String(collection || 'blamune-faits');
  const SEUIL = Number.isFinite(seuilRecherche) ? seuilRecherche : 0.30;
  const ACTIF = actifForcer !== false && !!BASE && !!cleApi;

  const journal = (mess) => { try { if (logger) logger('qdrant', mess); } catch (e) {} };

  // Injection de test : requeteur fourni = il remplace la couche https
  // (aucun appel reseau dans les tests). Sinon le natif.
  const etage = typeof requeteur === 'function' ? requeteur : null;

  // requete JSON generique (fetch maison, timeout 15 s).
  function requete(methode, chemin, corps) {
    if (etage) return Promise.resolve(null)
      .then(() => etage(methode, chemin, corps));
    return new Promise((resolve) => {
      const fini = (valeur) => { resolve(valeur); };
      try {
        let rel = chemin;
        if (typeof rel !== 'string' || !rel.startsWith('/')) rel = '/' + String(rel || '');
        const u = new URL(BASE + rel);
        const lib = u.protocol === 'http:' ? http : https;
        const data = corps == null ? null : JSON.stringify(corps);
        const headers = { Accept: 'application/json' };
        if (cleApi) headers['api-key'] = cleApi;
        if (data) {
          headers['Content-Type'] = 'application/json';
          headers['Content-Length'] = Buffer.byteLength(data);
        }
        const req = lib.request(u, {
          method: methode, headers, timeout: 15000
        }, (res) => {
          let buf = '';
          res.on('data', c => { buf += c; });
          res.on('end', () => {
            if (res.statusCode >= 300) {
              journal('HTTP ' + res.statusCode + ' sur ' + chemin + ' : ' + buf.substring(0, 160));
              fini(null);
              return;
            }
            try { fini(JSON.parse(buf || '{}')); } catch (e) { fini({}); }
          });
          res.on('error', () => fini(null));
        });
        req.on('timeout', () => { req.destroy(); fini(null); });
        req.on('error', (e) => { journal('requete: ' + e.message); fini(null); });
        if (data) req.write(data);
        req.end();
      } catch (e) {
        journal('requete: ' + e.message);
        fini(null);
      }
    });
  }

  function actif() {
    return ACTIF;
  }

  // Vecteur d'un fait : celui que le serveur a calcule (Gemini) s'il
  // existe, sinon le hachage local.
  function vecteurDe(fait) {
    if (Array.isArray(fait.vecteur) && fait.vecteur.length) return fait.vecteur;
    return vectoriser(fait.cle + ' ' + (fait.reponse || ''), sansAccents);
  }

  function pointDe(fait) {
    const norm = sansAccents(fait.cle);
    return {
      id: fnv1a(norm) % 2147483647, // id entier positif (int32 > 0 pour Qdrant)
      vector: vecteurDe(fait),
      payload: {
        cle: norm,
        cle_orig: fait.cle,
        reponse: String(fait.reponse || '').substring(0, 500),
        categorie: fait.categorie == null ? '' : String(fait.categorie)
      }
    };
  }

  // Dimensions de la collection : la longueur du premier vecteur fourni
  // (768 avec Gemini), sinon le hachage local (256).
  function dimensionsDe(faits) {
    for (const f of faits) {
      if (Array.isArray(f.vecteur) && f.vecteur.length) return f.vecteur.length;
    }
    return DIM;
  }

  // (Re)cree la collection vierge selon l'embeder selection, Cosine.
  async function creerCollectionVierge(dimensions) {
    const d = Number.isInteger(dimensions) && dimensions > 0 ? dimensions : DIM;
    const cree = await requete('PUT', '/collections/' + encodeURIComponent(COLL), {
      vectors: { size: d, distance: 'Cosine' }
    });
    if (cree == null) return null;
    journal('collection ' + COLL + ' (re)creee (' + d + ' d, Cosine)');
    return cree;
  }

  // Synchronisation COMPLETE : tout savoir.db reprojete dans l'index.
  // Strategie SIMPLE : SUPPRESSION DE LA COLLECTION, puis recreation, puis
  // lots. Pourquoi pas un DELETE de points par filtre : deux obstacles
  // (la route DELETE /points n'existe pas dans l'API : c'est POST
  // /points/delete ; et le strict mode du cloud refuse les filtres non
  // indexes). L'index est jetable, on peut tout raser sereinement.
  async function synchroniserTout(faits) {
    if (!ACTIF) return null;
    const suppr = await requete('DELETE', '/collections/' + encodeURIComponent(COLL));
    if (suppr == null && await requete('GET', '/collections/' + encodeURIComponent(COLL))) {
      // La collection repond encore : impossible de garantir un index
      // tout neuf, on abort plutot que risquer un index moitie vieux.
      journal('synchronisation: suppression non confirmee, abort');
      return null;
    }
    // La suppression est ASYNCHRONE cote cloud : donner 3 s a Qdrant
    // d'achever le rassage avant la recreation, sinon la creation part
    // en competition avec la fin de deletion.
    await new Promise(r => setTimeout(r, 3000));
    if (!await creerCollectionVierge(dimensionsDe(faits))) return null;
    const dim = Math.max(1, dimensionsDe(faits));
    const lot = [];
    // Les vecteurs hors dimension (melange local/Gemini) sont ignores :
    // un index de dimensions heteroclites est inutilisable.
    for (const f of faits) {
      if (Array.isArray(f.vecteur) && f.vecteur.length && f.vecteur.length !== dim) continue;
      lot.push(pointDe(f));
    }
    const nLots = Math.ceil(lot.length / 200);
    let echecsFinDeChaine = false;
    for (let i = 0; i < nLots; i++) {
      const morceau = lot.slice(i * 200, (i + 1) * 200);
      if (!morceau.length) continue;
      // Transitoires courants sur le cloud (socket hang up, reset) : une
      // ecriture peut avoir ETE ACHEVEE cote serveur alors que la reponse
      // est morte. On reessaie 5 fois (PAS DE DUP danger teste : un upsert
      // rejoue est inoffensif, meme id = remplacement), puis le compte
      // final tranchera.
      for (let essai = 0; essai < 5; essai++) {
        if (essai > 0) await new Promise(x => setTimeout(x, 5000));
        const r = await requete('PUT', '/collections/' + encodeURIComponent(COLL) + '/points', {
          points: morceau, wait: true
        });
        if (r != null) break;
        if (essai === 4) echecsFinDeChaine = true;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    // Verdict via le compte REEL seulement si une demande a produit des
    // transitoires a la fin de la fenetre : sinon le 200 moyen suffit et
    // la verification est unnellement lente/inutile.
    if (!echecsFinDeChaine) {
      journal('synchronises ' + lot.length + ' faits dans ' + COLL);
      return { total: lot.length };
    }
    for (let tent = 0; tent < 5; tent++) {
      await new Promise(r => setTimeout(r, 2000));
      const info = await requete('GET', '/collections/' + encodeURIComponent(COLL));
      const points = info && info.result && info.result.points_count;
      if (points === lot.length) {
        journal('synchronises ' + lot.length + ' faits dans ' + COLL +
          ' (apres transitoires reeglus)');
        return { total: lot.length };
      }
    }
    journal('synchronisation: points_count ' +
      'inattendu apres les upserts (attendu ' + lot.length + ')');
    return null;
  }

  // Un seul fait upsert (apres un apprentissage utilisateur).
  async function majFait(fait) {
    if (!ACTIF) return null;
    const r = await requete('PUT', '/collections/' + encodeURIComponent(COLL) + '/points?wait=true', {
      points: [pointDe(fait)]
    });
    if (r == null) journal('maj d un fait ratee (non bloquant)');
    return r;
  }

  // Recherche semantique : top k, filtre par le seuil.
  // options.vecteur : vecteur de la QUESTION calcule par le serveur
  // (Gemini) ; absent = hachage local.
  // Retourne [{ cle, reponse, categorie, score }] ou null (echec reseau),
  // [] si aucun fait assez proche.
  async function chercher(question, k, options) {
    if (!ACTIF) return null;
    const o = options || {};
    const vecteurQuestion = Array.isArray(o.vecteur) && o.vecteur.length
      ? o.vecteur
      : vectoriser(question, sansAccents);
    const r = await requete('POST', '/collections/' + encodeURIComponent(COLL) + '/points/search', {
      vector: vecteurQuestion, limit: k || 3, with_payload: true
    });
    if (r == null) return null;
    const tout = (r.result || []).filter(x => x.score >= SEUIL);
    return tout.map(x => ({
      cle: x.payload.cle_orig || x.payload.cle,
      reponse: x.payload.reponse,
      categorie: x.payload.categorie,
      score: x.score
    }));
  }

  async function sante() {
    if (!ACTIF) return { statut: 'inactif' };
    const info = await requete('GET', '/collections/' + encodeURIComponent(COLL));
    if (!info) return { statut: 'joignable', collection: COLL };
    return {
      statut: 'ok', collection: COLL,
      points: (info.result && info.result.points_count) || 0
    };
  }

  return { actif, creerCollectionVierge, synchroniserTout, majFait, chercher, sante };
}

module.exports = { creerQdrantFaits, vectoriser, tokeniser, fnv1a, DIM, produitScalaire, STOPWORDS };
