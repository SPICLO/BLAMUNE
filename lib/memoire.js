// =====================================================================
//  Dossier utilisateur et memoire
// =====================================================================
//  Chaque utilisateur a son dossier users/<uid>/ et, dedans, un unique
//  memoire.txt : une ligne par champ, dans un ordre fixe.
//
//  Ce format plat a ete chosen pour rester lisible et editable a la main,
//  et parce que le bot C++ le lit aussi (il partage le meme export). Un
//  fichier ancien a 9 lignes reste lisible : les champs manquants valent ''.
//
//  Extrait de server.js. Le repertoire de base et la persistance cloud
//  sont injectes.
// =====================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const CHAMPS_MEMOIRE = [
  'nom',
  'plat',
  'hobby',
  'motsFavoris',
  'genre',
  'aime',
  'aimePas',
  'age',
  'humeur', // 9 : etat interne de BLAMUNE (commandes "sois joyeux", "mode triste")
  'humeurUser', // 10 : humeur detectee chez l'utilisateur (a ne pas confondre)
  'ville',
  'travail',
  'musique',
  'serie',
  'sport',
  'reve',
  'anniversaire', // 16 : "12 mai" ou "12 mai 2005"
  'promesses'
]; // 17 : ce qu'il a demande de ne pas oublier (separes par |)

function creerMemoire({ usersDir, storage }) {
  /**
   * Dossier d'un utilisateur, cree a la volee.
   *
   * Defense en profondeur : la garde stricte du uid se fait dans
   * extraireAuth (server.js, liste blanche), mais dossierUser est aussi
   * appele par des chemins internes (migration, restauration). Liste
   * blanche [alnum . _ -] + refus de '..' et des separateurs : un
   * 'inv_x/../../victime' ne sort JAMAIS de users/, quel que soit
   * l'appelant. Un uid trop court ou forge part dans "_invalid".
   */
  function dossierUser(uid) {
    const u = String(uid || '');
    if (
      u.length < 3 ||
      u.length > 64 ||
      /[\r\n\\/]/.test(u) ||
      /\.\./.test(u) ||
      !/^[A-Za-z0-9_.\-]+$/.test(u)
    )
      return path.join(usersDir, '_invalid');
    const d = path.join(usersDir, u);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  }

  function memoireDepuisLignes(lignes) {
    const mem = {};
    CHAMPS_MEMOIRE.forEach((c, i) => {
      const v = lignes[i] || '';
      mem[c] = c === 'motsFavoris' ? v.split(',').filter(Boolean) : v;
    });
    return mem;
  }

  function lireMemoire(uid) {
    const mem = {};
    CHAMPS_MEMOIRE.forEach((c) => {
      mem[c] = c === 'motsFavoris' ? [] : '';
    });
    try {
      const f = path.join(dossierUser(uid), 'memoire.txt');
      if (!fs.existsSync(f)) return mem;
      const lignes = fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .map((l) => l.trim());
      CHAMPS_MEMOIRE.forEach((c, i) => {
        if (!lignes[i]) return;
        if (c === 'motsFavoris')
          mem[c] = lignes[i]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        else mem[c] = lignes[i];
      });
    } catch (e) {}
    return mem;
  }

  // memoire.txt est un format plat : une ligne = un champ (le bot C++
  // relit le meme fichier). Un saut de ligne dans une valeur decalerait
  // TOUS les champs suivants, y compris pour l'apprentissage regex.
  // Meme esprit que POST /savoir pour la structure de savoir.txt :
  // on ecrase par un espace, avec un plafond honnete de taille.
  function nettoyerValeur(v) {
    return String(v)
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  }

  function ecrireMemoire(uid, champ, valeur) {
    if (!valeur || !String(valeur).trim()) return false;
    const mem = lireMemoire(uid);
    const idx = CHAMPS_MEMOIRE.indexOf(champ);
    if (idx < 0) return false;
    const lignes = CHAMPS_MEMOIRE.map((c) =>
      c === 'motsFavoris' ? mem[c].join(',') : mem[c] || ''
    );
    lignes[idx] = nettoyerValeur(valeur);
    try {
      fs.writeFileSync(path.join(dossierUser(uid), 'memoire.txt'), lignes.join('\n'), 'utf8');
    } catch (e) {}
    if (storage.estConfigure()) storage.setMemoire(uid, memoireDepuisLignes(lignes));
    return true;
  }

  function sauvegarderMemoireComplete(uid, mem) {
    // Chaque champ traverse nettoyerValeur : une restauration contenant
    // un saut de ligne ne doit pas re-introduire la corruption du format.
    const lignes = CHAMPS_MEMOIRE.map((c) =>
      nettoyerValeur(
        c === 'motsFavoris'
          ? Array.isArray(mem[c])
            ? mem[c].join(',')
            : mem[c] || ''
          : mem[c] || ''
      )
    );
    try {
      fs.writeFileSync(path.join(dossierUser(uid), 'memoire.txt'), lignes.join('\n'), 'utf8');
    } catch (e) {}
    if (storage.estConfigure()) storage.setMemoire(uid, memoireDepuisLignes(lignes));
  }

  return {
    dossierUser,
    lireMemoire,
    ecrireMemoire,
    memoireDepuisLignes,
    sauvegarderMemoireComplete
  };
}

module.exports = { creerMemoire, CHAMPS_MEMOIRE };
