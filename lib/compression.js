// =====================================================================
//  Compression des reponses (zlib natif, zero dependance npm)
// =====================================================================
//  Un serveur qui repond en texte brut gaspille 65-85 % de la bande
//  passante. Cette couche comprime a la volee les reponses lisibles
//  (html, css, js, json, svg...) avec la zlib integree a Node : le
//  bundle IA (6,6 Mo) voyage en ~1-2 Mo, style.css en ~6 Ko.
//
//  Cycle : le middleware intercepe res.write/res.end. Tant qu'aucun
//  octet n'est parti, la decision reste reversible ; elle tombe a la
//  PREMIERE ecriture, au moment ou les en-tetes (Content-Type,
//  Content-Length) sont encore modifiables. Trois issues possibles :
//
//   - COMPRESSER : un flux (brotli si possible, sinon gzip) s'intercale
//     entre les ecritures du serveur et le client, avec controle de
//     flux des deux cotes (ni la memoire, ni le client ne saturent) ;
//   - SERVIR TEL QUEL : petit corps, type binaire, methode autre que
//     GET, plage 206, flux SSE, no-transform... rien a gagner ;
//   - SERVIR DU CACHE : une URL statique deja comprimee une fois est
//     re-servee depuis la RAM, revalidation ETag comprise.
//
//  Deux contrats avec le reste du serveur :
//   - server.js declare 'Cache-Control: no-store' sur les reponses
//     API ; les assets statiques en sont exclus (serve-static pose
//     alors son 'public, max-age=0', revalides par ETag) : c'est ce
//     qui interdit au cache ci-dessous de retenir un corps variable.
//   - Le cache est volontairement rudimentaire : le processus
//     redemarre a chaque deploiement, il sert donc toujours LE code
//     du deploy actif (pas d'obsolete a gerer).
// =====================================================================
'use strict';

const zlib = require('zlib');

// Types lisibles. Tout le reste (png, jpeg, wasm, mp3...) est deja
// comprime d'origine : recompresser n'y gagne rien et coute du CPU.
const PREFIXES_LISIBLES = [
  'text/',
  'application/json',
  'application/javascript',
  'application/xml',
  'application/x-javascript',
  'image/svg+xml'
];

// En dessous, les en-tetes supplementaires coutent plus cher que ce que
// la compression rapporte (gzip ajoute ~30 octets a lui seul).
const SEUIL_DEFAUT = 1024;

// Bornes du cache, en dur : 10 entrees, 4 Mo par representation, 12 Mo
// au total. Le bundle IA comprime loge tres bien ; 12 Mo restent une
// goutte devant la RAM d'une instance.
const MAX_ENTREES = 10;
const MAX_OCTETS_ENTREE = 4 * 1024 * 1024;
const MAX_OCTETS_TOTAL = 12 * 1024 * 1024;

// Extensions dont on garde la version comprimee en RAM. Le HTML hors '/'
// et les JSON de l'API (corps variables) restent hors cache.
const SITE_EXT_MISE_EN_CACHE = ['.css', '.js', '.mjs', '.svg', '.txt'];

const cache = new Map(); // chemin -> { enc, corps, type, etag, dernierModifie }
let octetsMiseEnCache = 0;

/** Parse 'Accept-Encoding: br;q=1.0, gzip;q=0.8' en [{ nom, poids }] utiles. */
function dechargerAccept(req) {
  return String(req.headers['accept-encoding'] || '')
    .split(',')
    .map((partie) => {
      const morceaux = partie.trim().split(';');
      const nom = (morceaux[0] || '').trim().toLowerCase();
      let poids = 1;
      for (let i = 1; i < morceaux.length; i++) {
        const m = /q=([0-9.]+)/.exec(morceaux[i]);
        if (m) poids = parseFloat(m[1]);
      }
      return { nom, poids };
    })
    .filter((x) => x.nom && x.poids > 0);
}

/** Vrai si le client accepte au moins un des encodings proposes. */
function accepte(req, encodages) {
  return dechargerAccept(req).some((x) => encodages.includes(x.nom));
}

/**
 * Decide si la reponse merite d'etre comprimee, et avec quoi ('br' ou
 * 'gzip'), ou null. Le client recoit ce qu'il sait decompresser le mieux :
 * brotli gagne ~20 % de plus que gzip, gzip est compris par tous.
 */
function choisirEncodage(req, res, seuil) {
  if (res.getHeader('Content-Encoding')) return null;
  if (res.getHeader('Content-Range')) return null; // plage 206 d'un fichier, pas celle du corps comprime
  const type = String(res.getHeader('Content-Type') || '').toLowerCase();
  if (type.indexOf('event-stream') >= 0) return null; // SSE : un flux doit arriver au fil de l'eau
  if (!PREFIXES_LISIBLES.some((p) => type.indexOf(p) === 0)) return null;
  // no-transform : le serveur interdit explicitement cette transformation
  // (c'est le cas de la tranche SSE, qui pose no-cache + no-transform).
  if (String(res.getHeader('Cache-Control') || '').indexOf('no-transform') >= 0) return null;
  if (!accepte(req, ['br', 'gzip'])) return null;
  const longueur = parseInt(res.getHeader('Content-Length'), 10);
  if (!Number.isNaN(longueur) && longueur < seuil) return null;
  return accepte(req, ['br']) ? 'br' : 'gzip';
}

/** Vrai si cette URL merite qu'on garde sa representation comprimee. */
function cacheable(req, res) {
  const cle = req.path || '';
  if (req.method !== 'GET' || (res.statusCode || 200) !== 200) return false;
  if (cle !== '/' && !SITE_EXT_MISE_EN_CACHE.some((e) => cle.toLowerCase().endsWith(e)))
    return false;
  const cc = String(res.getHeader('Cache-Control') || '').toLowerCase();
  return cc.indexOf('no-store') < 0 && cc.indexOf('private') < 0 && cc.indexOf('no-cache') < 0;
}

/** If-None-Match / If-Modified-Since reconnaissent-ils l'entre en memoire ? */
function intact(req, entre) {
  const inm = req.headers['if-none-match'];
  if (inm && entre.etag) {
    return String(inm)
      .split(',')
      .some((v) => v.trim() === entre.etag);
  }
  const ims = req.headers['if-modified-since'];
  return Boolean(ims && entre.dernierModifie && ims === entre.dernierModifie);
}

/** Stocke une representation, en respectant les bornes du cache. */
function memoriser(cle, entre) {
  while (cache.has(cle)) {
    octetsMiseEnCache -= cache.get(cle).corps.length;
    cache.delete(cle);
  }
  if (octetsMiseEnCache + entre.corps.length > MAX_OCTETS_TOTAL) {
    for (const k of Array.from(cache.keys())) {
      if (octetsMiseEnCache + entre.corps.length <= MAX_OCTETS_TOTAL) break;
      octetsMiseEnCache -= cache.get(k).corps.length;
      cache.delete(k);
    }
  }
  while (cache.size >= MAX_ENTREES) {
    const premiere = cache.keys().next().value;
    octetsMiseEnCache -= cache.get(premiere).corps.length;
    cache.delete(premiere);
  }
  cache.set(cle, entre);
  octetsMiseEnCache += entre.corps.length;
}

/**
 * Middleware : installe la couche pour cette requete.
 *   logger (serie, message) : signal d'un flux tombe en cours d'ecriture.
 *   cacheActiver : false pour tester le flux comprime sans le cache.
 */
function creerCompression(options) {
  const seuil = (options && options.seuil) || SEUIL_DEFAUT;
  const logger = (options && options.logger) || function () {};
  const cacheActiver = !options || options.cacheActiver !== false;

  return function compression(req, res, next) {
    if (req.method !== 'GET') return next();

    // ===== 1. CACHE : servie avant le routage, c'est tout le gain ====
    const cle = req.path;
    const entre = cacheActiver && cache.get(cle);
    if (entre && accepte(req, [entre.enc])) {
      if (intact(req, entre)) {
        res.setHeader('Vary', 'Accept-Encoding');
        if (entre.etag) res.setHeader('ETag', entre.etag);
        if (entre.dernierModifie) res.setHeader('Last-Modified', entre.dernierModifie);
        res.statusCode = 304;
        res.end();
        return;
      }
      res.setHeader('Content-Type', entre.type);
      res.setHeader('Content-Encoding', entre.enc);
      res.setHeader('Content-Length', String(entre.corps.length));
      res.setHeader('Vary', 'Accept-Encoding');
      if (entre.etag) res.setHeader('ETag', entre.etag);
      if (entre.dernierModifie) res.setHeader('Last-Modified', entre.dernierModifie);
      res.statusCode = 200;
      res.end(entre.corps);
      return;
    }

    // ===== 2. A LA VOLEE : on n'intercepe write/end qu'a la demande ====
    const ecrire = res.write.bind(res);
    const finir = res.end.bind(res);
    let etat = 'attente'; // attente | compresse | direct
    let flux = null;
    let encComp = null;
    let sauverPossible = false;
    let morceaux = null;
    let octetsCompression = 0;
    let dejaFinie = false;
    // Controle de flux sortant : si le client avale moins vite que zlib
    // ne produit, on retient les sorties et on attend un drain. Sans
    // cela, une sauvegarde de 50 Mo monterait entiere en memoire.
    let file = [];
    let enAttenteDrain = false;

    res.once('close', function () {
      if (!res.writableEnded && flux) flux.destroy();
    });

    function premierOctet(morceau) {
      // headersSent : la reponse part deja (SSE) — decision impossible,
      // on laisse passer tel quel.
      if (res.headersSent) {
        etat = 'direct';
        return 'direct';
      }
      // Vary annonce une variance possible, meme si on finira par ne
      // pas comprimer (fichier trop court : la reponse reste honnete).
      res.setHeader('Vary', 'Accept-Encoding');
      const encMise = choisirEncodage(req, res, seuil);
      if (!encMise) {
        etat = 'direct';
        return 'direct';
      }
      etat = 'compresse';
      encComp = encMise;
      flux = encMise === 'br' ? zlib.createBrotliCompress() : zlib.createGzip({ level: 6 });
      // Le Content-Length ne decrit plus ce qui va partir : on le retire.
      if (res.getHeader('Content-Length')) res.removeHeader('Content-Length');
      res.setHeader('Content-Encoding', encMise);
      // Quand la zlib a fini d'empiler son ENTREE (write() avait pu
      // renvoyer false), son tampon se vide : il faut rendre la main au
      // pipeline d'origine, qui s'etait mis en pause. Sans ce relais, le
      // fichier ne repartirait jamais — un pipe n'attend qu'un 'drain'
      // de sa destination, et la destination c'est res, pas la zlib.
      flux.on('drain', function () {
        res.emit('drain');
      });
      sauverPossible = cacheActiver && cacheable(req, res);
      flux.on('data', function (d) {
        if (sauverPossible) {
          if (!morceaux) morceaux = [];
          morceaux.push(d);
          octetsCompression += d.length;
          if (octetsCompression > MAX_OCTETS_ENTREE) {
            sauverPossible = false;
            morceaux = null;
          }
        }
        if (enAttenteDrain) {
          file.push(d);
          return;
        }
        const pret = ecrire(d);
        if (pret === false) {
          enAttenteDrain = true;
          res.once('drain', function () {
            enAttenteDrain = false;
            for (const c of file) {
              const pret2 = ecrire(c);
              if (pret2 === false) return; // tjs sature : un nouveau drain suivra
            }
            file = [];
          });
        }
      });
      flux.on('error', function (e) {
        logger('compression', 'flux interrompu a mi-course : ' + e.message);
        sauverPossible = false;
        morceaux = null;
        if (!dejaFinie) {
          dejaFinie = true;
          finir();
        }
      });
      flux.on('end', function () {
        if (sauverPossible && morceaux) {
          memoriser(cle, {
            enc: encComp,
            corps: Buffer.concat(morceaux),
            type: String(res.getHeader('Content-Type') || ''),
            etag: String(res.getHeader('ETag') || ''),
            dernierModifie: String(res.getHeader('Last-Modified') || '')
          });
        }
        dejaFinie = true;
        finir();
      });
      return 'compresse';
    }

    res.write = function (morceau, enc, reperage) {
      if (typeof enc === 'function') {
        reperage = enc;
        enc = null;
      }
      if (typeof morceau === 'string') morceau = Buffer.from(morceau, enc || 'utf8');
      if (!morceau || !morceau.length) return true;

      if (etat === 'attente' && premierOctet(morceau) === 'direct') {
        return ecrire(morceau, reperage);
      }
      if (etat === 'direct') {
        return ecrire(morceau, reperage);
      }
      return flux.write(morceau, reperage);
    };

    res.end = function (morceau, enc, reperage) {
      if (typeof enc === 'function') {
        reperage = enc;
        enc = null;
      }
      if (typeof morceau === 'string') morceau = Buffer.from(morceau, enc || 'utf8');

      if (etat === 'attente') {
        // Le corps arrive par end() sans aucune ecriture prealable
        // (res.send d'un gros corps, par exemple) : meme decision
        // qu'une ecriture, puis on finit, compresse ou tel quel.
        const sortie = !morceau || !morceau.length ? 'direct' : premierOctet(morceau);
        if (sortie === 'direct') return finir(morceau, reperage);
        // Le corps entier passe dans le flux AVANT sa fermeture, sinon
        // une reponse compresse vide partirait.
        if (morceau && morceau.length) flux.write(morceau);
        flux.end();
        return;
      }
      if (etat === 'compresse') {
        if (morceau && morceau.length) flux.write(morceau);
        flux.end();
        return;
      }
      // direct : delegue tel quel (corps non comprime).
      return finir(morceau, reperage);
    };

    next();
  };
}

module.exports = { creerCompression, choisirEncodage, cacheable, accepte, intact, memoriser };
