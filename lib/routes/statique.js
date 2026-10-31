// =====================================================================
//  Routes : fichiers statiques (site PWA et panneau admin)
// =====================================================================
//  Sert site/ sur la racine et admin/ sous /admin.
//
//  Deux garde-fous, non negociables :
//   1. BLOCKED_EXT : aucune extension sensible n'est servie, meme si le
//      fichier existe dans le dossier (scripts, logs, bases).
//   2. Le chemin resolu doit rester dans le dossier racine servi, sinon
//      403. C'est ce qui bloque ../../ et les liens symboliques.
//
//  Le controle d'extension passe AVANT la resolution : inutile d'aller
//  lire un chemin que l'on refusera ensuite.
//
//  Extrait de server.js.
// =====================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const BLOCKED_EXT = ['.ps1', '.bat', '.cmd', '.exe', '.dll', '.config', '.log', '.db', '.sqlite'];

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.xml': 'application/xml'
};

/**
 * Envoie un fichier statique en refusant toute sortie du dossier racine.
 * Retourne undefined si la requete a ete traitee (succes ou refus).
 */
function servirFichier(res, req, racine, fichier) {
  const ext = path.extname(fichier).toLowerCase();
  if (BLOCKED_EXT.includes(ext)) {
    res.status(404).send('Non autorise');
    return true;
  }
  const resolved = path.resolve(path.join(racine, fichier));
  // + path.sep : sans lui, un dossier FRERE prefixe (racine "admin", voisin
  // "admin2") passerait la garde startsWith. Aucun n'existe aujourd'hui :
  // la garde doit rester mathematiquement vraie, pas seulement actuelle.
  const racineResolue = path.resolve(racine) + path.sep;
  if (!resolved.startsWith(racineResolue)) {
    res.status(403).send('Acces interdit');
    return true;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).send('Page introuvable');
    return true;
  }
  if (fs.statSync(resolved).isDirectory()) {
    const index = path.join(resolved, 'admin.html');
    if (fs.existsSync(index)) {
      res.sendFile(index);
      return true;
    }
    res.status(404).send('Page introuvable');
    return true;
  }
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  res.sendFile(resolved);
  return true;
}

function creerRoutesStatique(app, deps) {
  const {
    siteDir,
    adminDir,
    // Double garde (optionnelles pour rester testable isolement) :
    //   1. fenetre d'une minute par IP ET par (IP + chemin) : coupe la
    //      violent d'un robot qui martelait un seul fichier ;
    //   2. plafond en OCTETS par IP et par jour (lib/garde_fichiers.js) :
    //      une limite en requetes laisse passer des gigaoctets a la
    //      frequence legale ; la limite en octets, non.
    checkRateLimit,
    getIp,
    limiteStatiqueGet = 120,
    limiteFichierGet = 30,
    gardeFichiers
  } = deps;

  // Refus commun aux 4 routes qui servent des fichiers. Vrai = reponse
  // deja envoyee (429 a corps minuscule : quelques octets, pas des Mo).
  function verrouiller(req, res) {
    if (!checkRateLimit || !getIp) return false;
    const ip = getIp(req);
    if (!checkRateLimit('fich:' + ip, limiteStatiqueGet)) {
      res.status(429).json({ ok: false, message: 'Trop de requetes.' });
      return true;
    }
    if (!checkRateLimit('fich:' + ip + ':' + req.path, limiteFichierGet)) {
      res.status(429).json({ ok: false, message: 'Trop de requetes sur ce fichier.' });
      return true;
    }
    if (gardeFichiers) {
      const v = gardeFichiers.peutServir(ip);
      if (v.refuse) {
        res.status(429).json({ ok: false, message: 'Quota du jour atteint.' });
        return true;
      }
      // Note au finish : Content-Length quand l'entete existe (exact),
      // sinon la somme des fragments passes a res.write/res.end.
      let somme = 0;
      const rWrite = res.write;
      const rEnd = res.end;
      res.write = function (c) {
        if (c) somme += Buffer.isBuffer(c) ? c.length : Buffer.byteLength(String(c));
        return rWrite.apply(res, arguments);
      };
      res.end = function (c) {
        if (c) somme += Buffer.isBuffer(c) ? c.length : Buffer.byteLength(String(c));
        return rEnd.apply(res, arguments);
      };
      res.on('finish', () => {
        try {
          const cl = res.getHeader ? res.getHeader('content-length') : null;
          const unis = cl != null && !Number.isNaN(Number(cl)) ? Number(cl) : somme;
          gardeFichiers.noter(ip, unis);
        } catch (e) {
          // Aucun echec de comptage ne doit casser la reponse.
        }
      });
    }
    return false;
  }

  // Admin panel
  app.get('/admin', (req, res) => {
    if (verrouiller(req, res)) return;
    res.set('Cache-Control', 'no-store');
    const index = path.join(adminDir, 'admin.html');
    if (fs.existsSync(index)) return res.sendFile(index);
    return res.status(404).send('Admin panel not found');
  });

  // Express 5 passe a path-to-regexp v8 : un wildcard porte obligatoirement
  // un nom ("/*splat"), le " * " nu est refuse au demarrage. Autre rupture :
  // un wildcard n'attrape jamais /, d'ou la route racine explicite.
  app.get('/admin/*splat', (req, res) => {
    if (verrouiller(req, res)) return;
    res.set('Cache-Control', 'no-store');
    let fichier = req.path.replace(/^\/admin\/?/, '');
    if (fichier === '/' || fichier === '' || fichier === 'admin.html') fichier = 'admin.html';
    servirFichier(res, req, adminDir, fichier);
  });

  // Racine : sert l'index du site. (/*splat ci-dessous ne la couvre pas.)
  app.get('/', (req, res) => {
    if (verrouiller(req, res)) return;
    servirFichier(res, req, siteDir, 'index.html');
  });

  // Site static files — catcher, TOUJOURS EN DERNIER. Comme pour /admin,
  // il ne sert que des GET (et HEAD) : une methode inconnue garde le 404
  // natif de Express, comme avant.
  app.get('/*splat', (req, res) => {
    if (verrouiller(req, res)) return;
    servirFichier(res, req, siteDir, req.path.replace(/^\//, ''));
  });
}

module.exports = { creerRoutesStatique, servirFichier, BLOCKED_EXT, MIME_TYPES };
