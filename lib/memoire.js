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

const CHAMPS_MEMOIRE = ['nom', 'plat', 'hobby', 'motsFavoris', 'genre', 'aime', 'aimePas', 'age',
  'humeur',        // 9 : etat interne de BLAMUNE (commandes "sois joyeux", "mode triste")
  'humeurUser',    // 10 : humeur detectee chez l'utilisateur (a ne pas confondre)
  'ville', 'travail', 'musique', 'serie', 'sport', 'reve',
  'anniversaire',  // 16 : "12 mai" ou "12 mai 2005"
  'promesses'];    // 17 : ce qu'il a demande de ne pas oublier (separes par |)

function creerMemoire({ usersDir, storage }) {
  /**
   * Dossier d'un utilisateur, cree a la volee.
   *
   * La garde sur la longueur du uid n'est pas une validation de fond :
   * c'est ce qui empeche un "../.." ou un "a/b" de faire lire ou ecrire
   * hors de users/. Un uid trop court part dans un dossier "_invalid".
   */
  function dossierUser(uid) {
    if (!uid || uid.length < 3) return path.join(usersDir, '_invalid');
    const d = path.join(usersDir, uid);
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
    CHAMPS_MEMOIRE.forEach(c => { mem[c] = c === 'motsFavoris' ? [] : ''; });
    try {
      const f = path.join(dossierUser(uid), 'memoire.txt');
      if (!fs.existsSync(f)) return mem;
      const lignes = fs.readFileSync(f, 'utf8').split('\n').map(l => l.trim());
      CHAMPS_MEMOIRE.forEach((c, i) => {
        if (!lignes[i]) return;
        if (c === 'motsFavoris') mem[c] = lignes[i].split(',').map(s => s.trim()).filter(Boolean);
        else mem[c] = lignes[i];
      });
    } catch (e) {}
    return mem;
  }

  function ecrireMemoire(uid, champ, valeur) {
    if (!valeur || !valeur.trim()) return false;
    const mem = lireMemoire(uid);
    const idx = CHAMPS_MEMOIRE.indexOf(champ);
    if (idx < 0) return false;
    const lignes = CHAMPS_MEMOIRE.map(c => c === 'motsFavoris' ? mem[c].join(',') : (mem[c] || ''));
    lignes[idx] = valeur;
    try { fs.writeFileSync(path.join(dossierUser(uid), 'memoire.txt'), lignes.join('\n'), 'utf8'); } catch (e) {}
    if (storage.estConfigure()) storage.setMemoire(uid, memoireDepuisLignes(lignes));
    return true;
  }

  function sauvegarderMemoireComplete(uid, mem) {
    const lignes = CHAMPS_MEMOIRE.map(c => c === 'motsFavoris'
      ? (Array.isArray(mem[c]) ? mem[c].join(',') : (mem[c] || ''))
      : (mem[c] || ''));
    try { fs.writeFileSync(path.join(dossierUser(uid), 'memoire.txt'), lignes.join('\n'), 'utf8'); } catch (e) {}
    if (storage.estConfigure()) storage.setMemoire(uid, memoireDepuisLignes(lignes));
  }

  return { dossierUser, lireMemoire, ecrireMemoire, memoireDepuisLignes, sauvegarderMemoireComplete };
}

module.exports = { creerMemoire, CHAMPS_MEMOIRE };