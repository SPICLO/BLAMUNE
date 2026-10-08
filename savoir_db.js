// BLAMUNE - Source de verite des connaissances (SQLite).
//
// Remplace le fichier plat savoir.txt comme source de verite. Le fichier
// reste un EXPORT (pour git, pour le bot Windows local et pour la
// sauvegarde JSONBin), mais plus l'endroit ou l'on ecrit.
//
// Pourquoi SQLite : plusieurs visiteurs apprennent en meme temps. Avec un
// fichier texte, deux requetes concurrentes se l/ecrasaient mutuellement et
// un arret de processus au milieu d'une reecriture tronquait le fichier.
// Ici : transactions atomiques, deduplication native par cle normalisee,
// et un lecteur ne voit jamais une ecriture partielle.
//
// Format conserve : "cle|reponse|categorie" (categorie optionnelle).
// La reponse vide signale un simple mot-cle de categorie : le mot est connu
// (il declenche le sujet) mais le bot n'affirme rien dessus.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Meme normalisation que le reste du projet / que le bot C++ : minuscules
// et sans accents, pour que "Café" et "cafe" soient la meme cle.
function sansAccents(s) {
  return String(s == null ? '' : s).normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

class SavoirDB {
  constructor(repertoire, fichier) {
    this.repertoire = repertoire;
    this.fichier = fichier || path.join(repertoire, 'savoir.db');
    this.db = new Database(this.fichier);
    this._init();
  }

  // Schema + requetes preparees. Facteur commun au demarrage et a la
  // rechargement apres restauration : une seule definition du schema.
  _init() {
    // WAL : lecteurs et ecrivain coexistent sans se bloquer. Le bot et le
    // serveur peuvent lire pendant qu'une transaction ecrit.
    this.db.pragma('journal_mode = WAL');
    // Si une autre instance tient le verrou, on attend au lieu d'echouer.
    this.db.pragma('busy_timeout = 5000');
    // Integrite referentielle : ces PRAGMA sont securitaires par defaut, on
    // les ecrit explicitement pour qu'un changement futur soit assume.
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS savoir (
        cle_norm  TEXT PRIMARY KEY,
        cle       TEXT NOT NULL,
        reponse   TEXT NOT NULL DEFAULT '',
        categorie INTEGER,
        rang      INTEGER,
        source    TEXT NOT NULL DEFAULT 'fichier',
        maj_le    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_savoir_cat ON savoir(categorie);
      CREATE TABLE IF NOT EXISTS meta (
        cle    TEXT PRIMARY KEY,
        valeur TEXT
      );
    `);
    this._prep = {
      get: this.db.prepare('SELECT cle, reponse, categorie FROM savoir WHERE cle_norm = ?'),
      // L'export conserve l'ordre du fichier d'origine (`rang`) : sans cela,
      // chaque export trierait par cle et le diff git du savoir deviendrait
      // illisible, alors que c'est justement le moyen de relire les
      // connaissances ajoutees.
      all: this.db.prepare('SELECT cle, reponse, categorie FROM savoir ORDER BY rang IS NULL, rang, cle_norm'),
      allRang: this.db.prepare('SELECT cle_norm, cle, reponse, categorie, rang, source FROM savoir ORDER BY rang IS NULL, rang, cle_norm'),
      count: this.db.prepare('SELECT COUNT(*) AS n FROM savoir'),
      upsert: this.db.prepare(`
        INSERT INTO savoir (cle_norm, cle, reponse, categorie, rang, source, maj_le)
        VALUES (@cle_norm, @cle, @reponse, @categorie, @rang, @source, datetime('now'))
        ON CONFLICT(cle_norm) DO UPDATE SET
          cle = excluded.cle,
          reponse = CASE WHEN excluded.reponse <> '' THEN excluded.reponse ELSE savoir.reponse END,
          categorie = COALESCE(excluded.categorie, savoir.categorie),
          rang = COALESCE(savoir.rang, excluded.rang),
          source = excluded.source,
          maj_le = excluded.maj_le
      `),
      meta: this.db.prepare('INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur')
    };
  }

  total() {
    return this._prep.count.get().n;
  }

  // Remplace la reponse d'une cle, ou cree l'entree si elle n'existe pas.
  // `categorie` : nombre, ou null pour "non classe".
  mettre(cle, reponse, categorie, source) {
    const c = String(cle || '').trim();
    if (!c) return false;
    const norm = sansAccents(c);
    if (!norm) return false;
    this._prep.upsert.run({
      cle_norm: norm,
      cle: c,
      reponse: String(reponse == null ? '' : reponse),
      categorie: (typeof categorie === 'number' && Number.isFinite(categorie)) ? categorie : null,
      rang: null,
      source: source || 'serveur'
    });
    return true;
  }

  // Met a jour la reponse d'une cle existente sans jamais l'effacer si la
  // nouvelle reponse est vide (cas du mot-cle de categorie).
  repondre(cle, reponse, categorie) {
    return this.mettre(cle, reponse, categorie, 'apprentissage');
  }

  parCle(norm) {
    return this._prep.get.get(String(norm || ''));
  }

  // Toutes les entrees qui AFFIRMENT quelque chose (reponse non vide).
  // Les simples mots-cles de categorie sont exclus : ils declenchent un
  // sujet mais ne doivent jamais etre lu a voix haute.
  toutes() {
    return this._prep.all.all().filter(e => e.reponse && e.reponse.trim());
  }

  toutesAvecCategorie() {
    return this._prep.all.all();
  }

  // Tout, y compris le rang et la source : utilise par le dump SQL.
  toutesAvecCategorieRang() {
    return this._prep.allRang.all();
  }

  // Import du fichier plat (migration initiale). Ne remplace pas une
  // reponse deja presente en base si la ligne du fichier est vide.
  importerFichier(fichier) {
    let contenu = '';
    try { contenu = fs.readFileSync(fichier, 'utf8'); } catch (e) { return 0; }
    const tx = this.db.transaction((lignes) => {
      let n = 0;
      for (const l of lignes) {
        const pos = l.indexOf('|');
        if (pos <= 0) continue;
        const cle = l.substring(0, pos).trim();
        let rep = l.substring(pos + 1).trim();
        if (!cle) continue;
        let cat = null;
        const pos2 = rep.indexOf('|');
        if (pos2 >= 0) {
          const num = rep.substring(pos2 + 1).trim();
          rep = rep.substring(0, pos2).trim();
          if (/^\d+$/.test(num)) cat = parseInt(num, 10);
        }
        this._prep.upsert.run({
          cle_norm: sansAccents(cle), cle, reponse: rep, categorie: cat,
          rang: n, source: 'migration'
        });
        n++;
      }
      return n;
    });
    const lignes = contenu.split('\n').map(x => x.replace(/\r$/, '')).filter(x => x.trim());
    const n = tx(lignes);
    this._prep.meta.run('import_le', new Date().toISOString());
    return n;
  }

  // Export vers le format historique. Ecriture atomique : le fichier reste
  // valide meme si le processus s'arrete pendant l'ecriture.
  exporter(fichier) {
    const cible = fichier || path.join(this.repertoire, 'savoir.txt');
    const lignes = this.toutesAvecCategorie().map(e => {
      let l = e.cle + '|' + e.reponse;
      if (e.categorie !== null && e.categorie !== undefined) l += '|' + e.categorie;
      return l;
    });
    const contenu = lignes.join('\n') + (lignes.length ? '\n' : '');
    const tmp = cible + '.tmp';
    fs.writeFileSync(tmp, contenu, 'utf8');
    try { fs.renameSync(tmp, cible); } catch (e) { fs.writeFileSync(cible, contenu, 'utf8'); }
    return lignes.length;
  }

  // ---------- Sauvegarde : DUMP SQL (texte), pas le fichier binaire ----------
// La sauvegarde applicative (JSON) ne manipule que du texte. Un fichier
// SQLite est BINAIRE : le lire en utf8 puis le reecrire en utf8 le rend
// illisible ("database disk image is malformed"). On produit donc un dump SQL,
// qui est du texte, lisible, et portable entre versions de SQLite.

_dumpValeur(v) {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

exporterSql() {
  const lignes = [
    '-- BLAMUNE - dump du savoir',
    '-- Source de verite exportee en SQL pour la sauvegarde applicative.',
    'BEGIN TRANSACTION;'
  ];
  for (const e of this.toutesAvecCategorieRang()) {
    lignes.push('INSERT INTO savoir (cle_norm, cle, reponse, categorie, rang, source) VALUES (' +
      this._dumpValeur(e.cle_norm) + ',' + this._dumpValeur(e.cle) + ',' +
      this._dumpValeur(e.reponse) + ',' +
      (e.categorie === null || e.categorie === undefined ? 'NULL' : String(e.categorie)) + ',' +
      (e.rang === null || e.rang === undefined ? 'NULL' : String(e.rang)) + ',' +
      this._dumpValeur(e.source) + ');');
  }
  lignes.push('COMMIT;');
  return lignes.join('\n') + '\n';
}

// Restaure depuis un dump SQL. On repart d'une base vide puis on rejoue les
// insertions : le resultat est exactement l'etat sauvegarde, y compris les
// suppressions (contrairement a une simple fusion).
importerSql(dump) {
  const texte = String(dump || '');
  if (!texte.trim()) return 0;
  // [\s\S] et non . : une reponse peut contenir un saut de ligne, et "." ne
// matche pas les retours a la ligne sans l'option "s".
    const extraction = /INSERT INTO savoir\s*\([^)]*\)\s*VALUES\s*\(([\s\S]*?)\);?/gi;
  const lignes = [];
  let m;
  while ((m = extraction.exec(texte)) !== null) {
    // Decoupe la liste de valeurs en respectant les apostrophes doublées.
    const corps = m[1];
    const valeurs = [];
    let courant = '';
    let enChaine = false;
    for (let i = 0; i < corps.length; i++) {
      const c = corps[i];
      if (c === "'") {
        if (enChaine && corps[i + 1] === "'") { courant += "'"; i++; continue; }
        enChaine = !enChaine;
        courant += c;
        continue;
      }
      if (c === ',' && !enChaine) { valeurs.push(courant.trim()); courant = ''; continue; }
      courant += c;
    }
    if (courant.trim() !== '') valeurs.push(courant.trim());
    const lire = (brut) => {
      const s = String(brut || '').trim();
      if (s.toUpperCase() === 'NULL') return null;
      if (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'") {
        return s.slice(1, -1).replace(/''/g, "'");
      }
      return s;
    };
    if (valeurs.length >= 6) {
      lignes.push({
        cle_norm: lire(valeurs[0]), cle: lire(valeurs[1]), reponse: lire(valeurs[2]),
        categorie: valeurs[3].toUpperCase() === 'NULL' ? null : parseInt(valeurs[3], 10),
        rang: valeurs[4].toUpperCase() === 'NULL' ? null : parseInt(valeurs[4], 10),
        source: lire(valeurs[5]) || 'sauvegarde'
      });
    }
  }
  const tx = this.db.transaction((entrees) => {
    this.db.prepare('DELETE FROM savoir').run();
    const stmt = this.db.prepare(`
      INSERT INTO savoir (cle_norm, cle, reponse, categorie, rang, source, maj_le)
      VALUES (@cle_norm, @cle, @reponse, @categorie, @rang, @source, datetime('now'))
    `);
    for (const e of entrees) {
      if (!e.cle_norm || !e.cle) continue;
      stmt.run(e);
    }
    return entrees.length;
  });
  return tx(lignes);
}

fermer() {
    try { this.db.close(); } catch (e) {}
  }

  // Ferme la base pour qu'un fichier de remplacement puisse etre ecrit par
  // dessus (indispensable sous Windows, ou SQLite garde un verrou).
  // Apres ecriture du fichier, appeler rouvrir().
  rouvrir() {
    if (this.db && this.db.open) {
      try { return this.total(); } catch (e) {}
    }
    this.db = new Database(this.fichier);
    this._init();
    return this.total();
  }
}

module.exports = { SavoirDB, sansAccents };