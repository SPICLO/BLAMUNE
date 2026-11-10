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

// `ecritures` (optionnel) : differeur d'ecriture (lib/ecritures.js). Absent =
// on garde l'ecriture synchrone historique (tests isoles, scripts).
// `logger` (optionnel) : (serie, message) => void. Sans lui, un echec
// d'ecriture de memoire.txt restait MUET : le fait appris (nom, ville,
// gouts) disparaissait au redemarrage sans une ligne de journal.
function creerMemoire({ usersDir, storage, ecritures, logger }) {
  function signaler(serie, e) {
    try {
      if (logger) logger(serie, (e && e.message) || String(e));
    } catch (err) {}
  }
  // Cache en memoire pour eviter de lire un fichier qui vient d'etre modifie
  // mais pas encore flush sur disque par ecritures.differer().
  //
  // BUG CORRIGE (2026-11-10) : le cache ne verifiait JAMAIS le disque. Une
  // ecriture faite par un AUTRE chemin que ce module (restauration de
  // sauvegarde, DELETE /profil, correction manuelle, migration) restait
  // invisible pour toujours : lireMemoire rendait l'ancienne valeur jusqu'au
  // redemarrage. Meme piege que proactif.json, ou reprendreProactif() existe
  // justement pour ca.
  //   - une ecriture locale (ecrireMemoire, sauvegarderMemoireComplete) met
  //     la cle dans `enAttente` : la version RAM est la plus fraiche, on la
  //     sert sans disque (comportement historique, indispensable entre deux
  //     flushes de 5 s) ;
  //   - hors de cette fenetre, on compare la DATE DE MODIFICATION du fichier
  //     a celle lue et mise en cache : un fichier reecrit ailleurs invalide
  //     l'entree, sans cout notable (un statSync par lecture).
  const cacheMemoire = new Map();
  const enAttente = new Set();

  function mtimeDe(chemin) {
    try {
      return fs.statSync(chemin).mtimeMs;
    } catch (e) {
      return -1;
    }
  }

  function cleCache(uid) {
    return String(uid);
  }

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
    const cle = cleCache(uid);
    // dossierUser peut LEVER (mkdirSync refuse). Une lecture impossible doit
    // rendre une memoire VIDE, pas faire tomber /send en 500 : le cache RAM
    // reste consultable, et l'echec est trace.
    let f;
    try {
      f = path.join(dossierUser(uid), 'memoire.txt');
    } catch (e) {
      signaler('memoire', e);
      if (cacheMemoire.has(cle)) return cacheMemoire.get(cle).mem;
      return mem;
    }
    // 1) Ecriture locale pas encore flushee : c'est la version la plus fraiche.
    // 2) Sinon, cache valide tant que le fichier n'a pas ete reecrit ailleurs
    //    (mtime identique). Un fichier disparu invalide aussi l'entree.
    if (cacheMemoire.has(cle)) {
      const entree = cacheMemoire.get(cle);
      if (enAttente.has(cle)) return entree.mem;
      const mtime = mtimeDe(f);
      if (mtime !== -1 && mtime === entree.mtime) return entree.mem;
      cacheMemoire.delete(cle);
    }
    try {
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
      // Mettre en cache pour les prochaines lectures (avec la date lue).
      cacheMemoire.set(cle, { mem, mtime: mtimeDe(f) });
      return mem;
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
    ecrireFichier(uid, lignes.join('\n'));
    // Mettre a jour le cache pour que la prochaine lecture voie la modification
    memoriser(uid, memoireDepuisLignes(lignes));
    if (storage.estConfigure()) storage.setMemoire(uid, memoireDepuisLignes(lignes));
    return true;
  }

  /** Cache + marque "ecriture locale en attente" : la RAM fait foi jusqu'au
   *  flush, meme si le disque porte encore l'ancienne version (5 s max). */
  function memoriser(uid, mem) {
    const cle = cleCache(uid);
    // dossierUser peut LEVER (mkdirSync refuse : disque plein, droits,
    // parent qui est un fichier). Le cache RAM reste utile meme sans
    // disque : on ne laisse pas l'exception remonter jusqu'a /send.
    let f = '';
    try {
      f = path.join(dossierUser(uid), 'memoire.txt');
    } catch (e) {
      signaler('memoire', e);
    }
    enAttente.add(cle);
    cacheMemoire.set(cle, { mem, mtime: f ? mtimeDe(f) : -1 });
    // Le differeur ecrit dans sa propre fenetre : on revalide le mtime une
    // fois la fenetre passee (double, elle est dans lib/ecritures.js).
    const minuteur = setTimeout(() => enAttente.delete(cle), 10000);
    if (minuteur.unref) minuteur.unref();
  }

  // memoire.txt est reecrit a chaque champ appris (regex, extraction par
  // modele, /profil) : meme regle que etat_blamune.json (phase 3, P3-1).
  // Le cloud (storage.setMemoire) reste, lui, debounce par storage.js.
  function ecrireFichier(uid, contenu) {
    // dossierUser cree le dossier : il peut LEVER. Sans ce try, un disque
    // plein faisait remonter une exception jusqu'a /send (500) au lieu de
    // perdre un fait et de le dire.
    let chemin;
    try {
      chemin = path.join(dossierUser(uid), 'memoire.txt');
    } catch (e) {
      signaler('memoire', e);
      return;
    }
    if (ecritures) {
      ecritures.differer('memoire:' + uid, chemin, contenu);
      return;
    }
    try {
      fs.writeFileSync(chemin, contenu, 'utf8');
    } catch (e) {
      // Disque plein, droits, dossier disparu : le fait appris est perdu.
      signaler('memoire', e);
    }
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
    ecrireFichier(uid, lignes.join('\n'));
    // Mettre a jour le cache pour que la prochaine lecture voie la modification
    memoriser(uid, memoireDepuisLignes(lignes));
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

// =====================================================================
//  Indices de memoire : ce message MERITE-T-IL une extraction par modele ?
// =====================================================================
//  L'extraction de faits (extraireAvecModele) consomme une place dans les
//  petits free tiers du fond du pool. La majorite des messages d'un chat
//  du quotidien n'a RIEN a extraire ("ok", "grave", une question sur la
//  meteo). Cette porte, pure et sans etat, ne laisse passer que les
//  messages qui portent une vraie indice de memoire. La liste est
//  GENEREUSE de facon deliberee : mieux vaut une extraction pour rien
//  (le modele repond {}) qu'un fait manque. Comparee sur le message sans
//  accents et en minuscules, meme convention que le reste du projet.
const INDICES_MEMOIRE = [
  // Explicites : l'utilisateur demande a retenir.
  /\b(retiens|rappelle[- ]?toi|souviens[- ]?toi|note que)\b/,
  // Identite : nom, presentation. Apostrophe ou meme espace : les
  // claviers mobiles la perdent souvent ("je m appelle").
  /\bje m(?:'| )?appelle\b|\bmoi c(?:'| )?est\b/,
  // Mini-presentation en fin de message : "au fait... je ne t'ai pas
  // dit, c'est Maeva" ne porte AUCUN marqueur de memoire explicite,
  // mais une presentation se finit par "c'est <quelque chose>". Ancre de
  // fin : faits positifs limites aux vraies queues de presentation.
  /\bc(?:'| )?est\s+[a-z]{2,}\s*[.!]?\s*$/,
  // Age / anniversaire.
  /\bj(?:'| )?ai\s+\d+\s+ans?\b|\bmon (?:anniversaire|age|anniv)\b/,
  // Lieu / logement / demenagement / changement d'ecole.
  /\bj(?:'| )?habite\b|\bje viens de\b|\bje vis a\b|\bje demenage\b|\bnouvel(?:le)? (?:appart|maison|ecole|ville|quartier)\b/,
  // Coordonnees et nom : possessifs sur des choses qu'on donne.
  /\b(mon|ma|mes)\s+(?:nom|prenom|ville|pays|telephone|mail|pseudo)\b/,
  // Famille et proches.
  /\b(mon|ma|mes)\s+(?:fils|fille|frere|soeur|papa|maman|copain|copine|femme|mari|chien|chat|animal|pere|mere|prof|voisin|chef|ami|amie)\b/,
  // Gouts, aversions, passions.
  /\bj(?:'| )?aime\b|\bj(?:'| )?adore\b|\bje deteste\b|\bj(?:'| )?ai horreur\b|\bje suis fan\b|\bmon plat\b|\bma serie\b|\bma passion\b|\bmes hobbies\b|\bmes gouts\b/,
  // Activites regulieres, boulot, etudes, diplomes.
  /\bje (?:joue|bosse|travaille|etudie|pratique|ecoute)\b|\bje fais (?:du|de la|des)\b|\bau (?:lycee|College|fac|universite)\b|\bj(?:'| )?ai eu\b|\bmon (?:bac|permis|exam|examen|entreprise|boutique)\b/,
  // Sante et vie sentimentale. Les souvenirs (SOUVENIRS_PATTERNS,
  // cote autoApprentissage) repondent a d'autres criteres ; le doublon
  // eventuel n'est pas grave (l'extraction repond {} au pire).
  /\b(hopital|hospitalis\w*|malade|maladie|mari\w*|fiance\w*|en couple|bebe|enceinte)\b/,
  // Animaux.
  /\b(chaton|chatte|chiot|lapin\w*|hamster)\b|\bj(?:'| )?ai (?:un|une) (?:chat|chien|animal)\b|\bmon (?:chat|chien|animal)\b/
];

/**
 * Vrai si le message porte une vraie indice de memoire : c'est la porte
 * d'entree de l'extraction par modele (send.js). Pure : ni disque, ni
 * horloge, ni etat.
 * @param {string} msg
 * @returns {boolean}
 */
function indiceMemoire(msg) {
  const t = String(msg || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (t.length < 6) return false;
  for (const re of INDICES_MEMOIRE) {
    if (re.test(t)) return true;
  }
  return false;
}

module.exports = { creerMemoire, CHAMPS_MEMOIRE, indiceMemoire };
