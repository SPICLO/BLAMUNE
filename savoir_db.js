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

// ---------- Choix du moteur SQLite ----------
//
// On preferne `node:sqlite`, le module natif de Node (>= 22.5) : aucune
// dependance a installer, donc `npm ci` ne peut jamais echouer sur une
// machine sans compilateur C++ (c'etait le cas de better-sqlite3, qui
// tentait une compilation node-gyp exigeant Visual Studio).
//
// `better-sqlite3` reste accepte comme solution de repli si quelqu'un
// l'installe volontairement (utile sur Node 18/20). Les deux API sont
// compatibles pour ce que nous faisons, aux rares differences pres ci-dessous.
function ouvrirBase(fichier) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    return { db: new DatabaseSync(fichier), moteur: 'node:sqlite' };
  } catch (e) {
    try {
      const Database = require('better-sqlite3');
      return { db: new Database(fichier), moteur: 'better-sqlite3' };
    } catch (e2) {
      // Ne pas masquer la cause reelle : "SQLite indisponible" a deja ete
      // emis alors que node:sqlite etait disponible et que le vrai probleme
      // etait filesysteme (dossier absent, droit d'ecriture). Chainer les
      // deux messages rend le diagnostic immediat.
      throw new Error(
        'SQLite indisponible. Utilise Node >= 22.5 (module natif node:sqlite) ' +
          'ou installe better-sqlite3. Node detecte : ' +
          process.version +
          ' — cause : node:sqlite -> ' +
          (e.message || e) +
          ' ; better-sqlite3 -> ' +
          (e2.message || e2)
      );
    }
  }
}

// PRAGMA : better-sqlite3 expose db.pragma(), node:sqlite non (exec seulement).
function pragma(db, sql) {
  if (typeof db.pragma === 'function') {
    try {
      db.pragma(sql);
      return;
    } catch (e) {
      /* on tente en exec */
    }
  }
  db.exec('PRAGMA ' + sql);
}

// Propriete d'ouverture : `isOpen` sur node:sqlite, `open` sur better-sqlite3.
function estOuvert(db) {
  if (!db) return false;
  if (typeof db.isOpen === 'boolean') return db.isOpen;
  return !!db.open;
}

// Transaction : better-sqlite3 fournit db.transaction(fn)(args...), node:sqlite
// non. On reproduit la meme signature dans les deux cas.
function dansTransaction(db, fn, ...args) {
  if (typeof db.transaction === 'function') return db.transaction(fn)(...args);
  db.exec('BEGIN');
  try {
    const resultat = fn(...args);
    db.exec('COMMIT');
    return resultat;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch (e2) {
      /* deja annulee */
    }
    throw e;
  }
}

// Meme normalisation que le reste du projet / que le bot C++ : minuscules
// et sans accents, pour que "Café" et "cafe" soient la meme cle.
function sansAccents(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

class SavoirDB {
  constructor(repertoire, fichier) {
    this.repertoire = repertoire;
    this.fichier = fichier || path.join(repertoire, 'savoir.db');
    this.db = ouvrirBase(this.fichier).db;
    this._init();
  }

  // Schema + requetes preparees. Facteur commun au demarrage et a la
  // rechargement apres restauration : une seule definition du schema.
  _init() {
    // WAL : lecteurs et ecrivain coexistent sans se bloquer. Le bot et le
    // serveur peuvent lire pendant qu'une transaction ecrit.
    pragma(this.db, 'journal_mode = WAL');
    // Si une autre instance tient le verrou, on attend au lieu d'echouer.
    pragma(this.db, 'busy_timeout = 5000');
    // Integrite referentielle : ces PRAGMA sont securitaires par defaut, on
    // les ecrit explicitement pour qu'un changement futur soit assume.
    pragma(this.db, 'foreign_keys = ON');
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
    // VALIDATION (phase 3, P3-5) : un fait pousse par un invite n'est pas
    // servi avant la validation admin. Colonne ajoutee APRES coup : une
    // base existante (1266 faits en production) reste valide sans reimport
    // (defaut 1, deja servis), et un index partiel rend le scan des
    // `enAttente` instantane sans peser sur les faits servis.
    const colonnes = this.db.prepare('PRAGMA table_info(savoir)').all();
    if (!colonnes.some((c) => c.name === 'valide')) {
      this.db.exec('ALTER TABLE savoir ADD COLUMN valide INTEGER NOT NULL DEFAULT 1');
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_savoir_valide ON savoir(valide, maj_le)
        WHERE valide = 0;
    `);
    this._prep = {
      get: this.db.prepare('SELECT cle, reponse, categorie FROM savoir WHERE cle_norm = ?'),
      // L'export conserve l'ordre du fichier d'origine (`rang`) : sans cela,
      // chaque export trierait par cle et le diff git du savoir deviendrait
      // illisible, alors que c'est justement le moyen de relire les
      // connaissances ajoutees.
      // WHERE valide = 1 (P3-5) : ce que l'export savoir.txt, la Map de
      // secours et le RAG peuvent lire. Un fait PROPOSE reste en base mais
      // n'y figure pas tant que l'admin ne l'a pas valide.
      all: this.db.prepare(
        'SELECT cle, reponse, categorie FROM savoir WHERE valide = 1 ORDER BY rang IS NULL, rang, cle_norm'
      ),
      allRang: this.db.prepare(
        'SELECT cle_norm, cle, reponse, categorie, rang, source FROM savoir ORDER BY rang IS NULL, rang, cle_norm'
      ),
      count: this.db.prepare('SELECT COUNT(*) AS n FROM savoir'),
      // Import / restauration : etat ecrit tel quel (1 si absent du dump).
      upsertEtat: this.db.prepare(`
        INSERT INTO savoir (cle_norm, cle, reponse, categorie, rang, source, maj_le, valide)
        VALUES (@cle_norm, @cle, @reponse, @categorie, @rang, @source, datetime('now'), @valide)
        ON CONFLICT(cle_norm) DO UPDATE SET
          cle = excluded.cle,
          reponse = excluded.reponse,
          categorie = excluded.categorie,
          rang = COALESCE(savoir.rang, excluded.rang),
          source = excluded.source,
          maj_le = excluded.maj_le,
          valide = excluded.valide
      `),
      // Faits en attente de validation (P3-5) : lus par /admin/savoir. La
      // nouvelle reponse n'est pas servie tant que l'admin ne valide pas.
      enAttente: this.db.prepare(
        'SELECT cle, reponse, categorie, source, maj_le FROM savoir WHERE valide = 0 ORDER BY maj_le DESC, cle_norm'
      ),
      // maj_le repart de maintenant : le fait, approuve par un humain, suit
      // la meme fenetre de fraicheur que tout le reste.
      valider: this.db.prepare(`
        UPDATE savoir SET valide = 1, maj_le = datetime('now') WHERE cle_norm = ? AND valide = 0
      `),
      upsert: this.db.prepare(`
        INSERT INTO savoir (cle_norm, cle, reponse, categorie, rang, source, maj_le, valide)
        VALUES (@cle_norm, @cle, @reponse, @categorie, @rang, @source, datetime('now'), @valide)
        ON CONFLICT(cle_norm) DO UPDATE SET
          cle = excluded.cle,
          reponse = CASE WHEN excluded.reponse <> '' THEN excluded.reponse ELSE savoir.reponse END,
          categorie = COALESCE(excluded.categorie, savoir.categorie),
          rang = COALESCE(savoir.rang, excluded.rang),
          source = excluded.source,
          maj_le = excluded.maj_le,
          valide = excluded.valide
      `),
      meta: this.db.prepare(
        'INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur'
      )
    };
  }

  total() {
    return this._prep.count.get().n;
  }

  // Supprime l'entree d'une cle (normalisee a l'interieur). Retourne vrai
  // si une ligne a reellement disparu. Utilise par le nettoyage admin :
  // jamais par l'apprentissage automatique (celui-ci corrige, il n'oublie
  // pas — la distinction fait partie de la regle de propriete documentee
  // sous synchroniserFichier).
  supprimer(cle) {
    const norm = sansAccents(cle);
    if (!norm) return false;
    const r = this.db.prepare('DELETE FROM savoir WHERE cle_norm = ?').run(norm);
    // node:sqlite renvoie {changes} ; better-sqlite3 aussi.
    return (r && r.changes) > 0;
  }

  // Remplace la reponse d'une cle, ou cree l'entree si elle n'existe pas.
  // `categorie` : nombre, ou null pour "non classe".
  // `valide` : 0 = PROPOSE, pas encore servi (P3-5). Absent = 1 : la
  // correction d'un fait deja valide ne le repasse jamais en attente.
  mettre(cle, reponse, categorie, source, valide) {
    const c = String(cle || '').trim();
    if (!c) return false;
    const norm = sansAccents(c);
    if (!norm) return false;
    this._prep.upsert.run({
      cle_norm: norm,
      cle: c,
      reponse: String(reponse == null ? '' : reponse),
      categorie: typeof categorie === 'number' && Number.isFinite(categorie) ? categorie : null,
      rang: null,
      source: source || 'serveur',
      valide: valide === 0 ? 0 : 1
    });
    return true;
  }

  // Met a jour la reponse d'une cle existente sans jamais l'effacer si la
  // nouvelle reponse est vide (cas du mot-cle de categorie).
  repondre(cle, reponse, categorie, valide) {
    return this.mettre(cle, reponse, categorie, 'apprentissage', valide);
  }

  parCle(norm) {
    return this._prep.get.get(String(norm || ''));
  }

  // Faits proposes par un invite, en attente de validation admin (P3-5).
  faitsEnAttente() {
    return this._prep.enAttente.all();
  }

  // Un admin valide un fait propose : il devient servisable. Retourne vrai
  // si une ligne etait bien en attente.
  valider(cle) {
    const norm = sansAccents(cle);
    if (!norm) return false;
    const r = this._prep.valider.run(norm);
    return (r && r.changes) > 0;
  }

  // Toutes les entrees qui AFFIRMENT quelque chose (reponse non vide).
  // Les simples mots-cles de categorie sont exclus : ils declenchent un
  // sujet mais ne doivent jamais etre lu a voix haute.
  toutes() {
    return this._prep.all.all().filter((e) => e.reponse && e.reponse.trim());
  }

  toutesAvecCategorie() {
    return this._prep.all.all();
  }

  // Tout, y compris le rang et la source : utilise par le dump SQL.
  toutesAvecCategorieRang() {
    return this._prep.allRang.all();
  }

  // Agregat du journal public (/journal) : combien de faits le bot a
  // APPRIS en usage (source 'apprentissage' = le chat, pas la main ni
  // le fichier de depot), au total et sur les n derniers jours. Aucun
  // contenu sort ici : des NOMBRES, jamais un fait personnel d'un
  // visiteur (la page est public, les faits ne le sont pas).
  statistiques(nJours) {
    const jours = Math.max(1, Number(nJours) || 7);
    const m = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM savoir WHERE source = 'apprentissage' AND maj_le >= datetime('now', '-' || ? || ' days')`
      )
      .get(jours);
    const total = this.db
      .prepare(`SELECT COUNT(*) AS n FROM savoir WHERE source = 'apprentissage'`)
      .get();
    return { appris: total.n || 0, semaine: m.n || 0 };
  }

  // Analyse un fichier plat en lignes structures.
  _analyserFichier(fichier) {
    let contenu = '';
    try {
      contenu = fs.readFileSync(fichier, 'utf8');
    } catch (e) {
      return [];
    }
    const lignes = [];
    for (const l of contenu.split('\n')) {
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
      lignes.push({
        cle_norm: sansAccents(cle),
        cle,
        reponse: rep,
        categorie: cat,
        source: 'migration'
      });
    }
    return lignes;
  }

  // Synchronise le fichier plat ET la base, dans les deux sens.
  //
  // Pourquoi pas seulement un import a froid : la premiere version de la base
  // a ete creee a partir d'un savoir.txt encore pollue. Avec un import unique
  // ("si la base est vide"), les entrees supprimees du depot restaient en base
  // indefiniment — c'est exactement ce qui s'est produit en production.
  //
  // Regle de propriete des donnees :
  //   - le FICHIER versionne fait autorite sur les connaissances EDITEES
  //     (source 'migration') : une ligne retiree du fichier disparait de la base ;
  //   - les connaissances APPRISES en cours d'usage (source 'apprentissage',
  //     'bot-local', 'serveur') ne sont jamais supprimees, meme absentes du
  //     fichier : elles n'ont pas de contrepartie dans le depot ;
  //   - une cle APPRISE qui existe aussi dans le fichier NE RETROGRADE PAS :
  //     source reste 'apprentissage' (sinon la purge du depot la supprimerait
  //     alors que son contenu a ete appris/corrige en usage).
  synchroniserFichier(fichier) {
    const lignes = this._analyserFichier(fichier);
    const dansFichier = new Set(lignes.map((l) => l.cle_norm));
    const resultat = dansTransaction(this.db, () => {
      const stmt = this.db.prepare(`
      INSERT INTO savoir (cle_norm, cle, reponse, categorie, rang, source, maj_le)
      VALUES (@cle_norm, @cle, @reponse, @categorie, @rang, @source, datetime('now'))
      ON CONFLICT(cle_norm) DO UPDATE SET
        cle = excluded.cle,
        reponse = CASE WHEN excluded.reponse <> '' THEN excluded.reponse ELSE savoir.reponse END,
        categorie = COALESCE(excluded.categorie, savoir.categorie),
        rang = COALESCE(savoir.rang, excluded.rang),
        source = CASE WHEN savoir.source <> 'migration' THEN savoir.source ELSE excluded.source END,
        maj_le = excluded.maj_le
    `);
      lignes.forEach((e, i) => stmt.run(Object.assign({ rang: i }, e)));

      // Purge : uniquement les entrees issues du fichier, devenues absentes.
      const toutes = this.db.prepare('SELECT cle_norm, source FROM savoir').all();
      const del = this.db.prepare('DELETE FROM savoir WHERE cle_norm = ?');
      let purges = 0;
      for (const t of toutes) {
        if (t.source === 'migration' && !dansFichier.has(t.cle_norm)) {
          del.run(t.cle_norm);
          purges++;
        }
      }
      return { importes: lignes.length, purges: purges };
    });
    this._prep.meta.run('sync_le', new Date().toISOString());
    return resultat;
  }

  // Import simple, sans purge (restauration d'une sauvegarde ancienne).
  // Ne remplace pas une reponse deja presente en base si la ligne du fichier
  // est vide.
  importerFichier(fichier) {
    const lignes = this._analyserFichier(fichier);
    if (!lignes.length) return 0;
    const n = dansTransaction(
      this.db,
      (entrees) => {
        let n = 0;
        for (const e of entrees) {
          this._prep.upsertEtat.run(Object.assign({ rang: n, valide: 1 }, e));
          n++;
        }
        return n;
      },
      lignes
    );
    this._prep.meta.run('import_le', new Date().toISOString());
    return n;
  }

  // Export vers le format historique. Ecriture atomique : le fichier reste
  // valide meme si le processus s'arrete pendant l'ecriture.
  exporter(fichier) {
    const cible = fichier || path.join(this.repertoire, 'savoir.txt');
    const lignes = this.toutesAvecCategorie().map((e) => {
      let l = e.cle + '|' + e.reponse;
      if (e.categorie !== null && e.categorie !== undefined) l += '|' + e.categorie;
      return l;
    });
    const contenu = lignes.join('\n') + (lignes.length ? '\n' : '');
    const tmp = cible + '.tmp';
    fs.writeFileSync(tmp, contenu, 'utf8');
    try {
      fs.renameSync(tmp, cible);
    } catch (e) {
      fs.writeFileSync(cible, contenu, 'utf8');
    }
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
      lignes.push(
        'INSERT INTO savoir (cle_norm, cle, reponse, categorie, rang, source) VALUES (' +
          this._dumpValeur(e.cle_norm) +
          ',' +
          this._dumpValeur(e.cle) +
          ',' +
          this._dumpValeur(e.reponse) +
          ',' +
          (e.categorie === null || e.categorie === undefined ? 'NULL' : String(e.categorie)) +
          ',' +
          (e.rang === null || e.rang === undefined ? 'NULL' : String(e.rang)) +
          ',' +
          this._dumpValeur(e.source) +
          ');'
      );
    }
    lignes.push('COMMIT;');
    return lignes.join('\n') + '\n';
  }

  // Restaure depuis un dump SQL. On repart d'une base vide puis on rejoue les
  // insertions : le resultat est exactement l'etat sauvegarde, y compris les
  // suppressions (contrairement a une simple fusion).
  //
  // Le repere de fin de VALUES est cherche EN RESPECTANT LES CHAINES : une
  // reponse apprise peut contenir ");" (visiteur tapant "blabla);..."). La
  // premiere version codait ce scan par regex ([\s\S]*?)\);?, qui s'arretait
  // au premier ");" meme au milieu d'une valeur : le DELETE qui suit (base
  // videe) perdait la ligne. Un scanner, pas une regex.
  importerSql(dump) {
    const texte = String(dump || '');
    if (!texte.trim()) return 0;
    const lignes = [];
    const MARQUE = 'INSERT INTO savoir';
    let pos = texte.indexOf(MARQUE);
    while (pos >= 0) {
      const marches = texte.toUpperCase().indexOf(' VALUES ', pos + MARQUE.length);
      if (marches < 0) break;
      const parenthese = texte.indexOf('(', marches);
      if (parenthese < 0) break;
      let prof = 1;
      let enChaine = false;
      let corps = '';
      let fin = -1;
      for (let i = parenthese + 1; i < texte.length; i++) {
        const c = texte[i];
        if (enChaine) {
          if (c === "'") {
            if (texte[i + 1] === "'") {
              corps += "''";
              i++;
              continue;
            }
            enChaine = false;
          }
          corps += c;
          continue;
        }
        if (c === "'") {
          enChaine = true;
          corps += c;
          continue;
        }
        if (c === '(') prof++;
        if (c === ')') {
          prof--;
          if (prof === 0) {
            if (texte[i + 1] === ';') i++;
            fin = i;
            break;
          }
        }
        corps += c;
      }
      if (fin < 0) break; // dump tronque : on garde ce qui a deja ete extrait
      // Decoupe la liste de valeurs en respectant les apostrophes doublées.
      // On garde l'echappement SQL TEL QUEL (une paire '' reste '') : la
      // lecture unique se fait dans lire() ci-dessous. Une double decodage
      // (une ici, une dans lire) ecrasait DEUX apostrophes adjacentes en
      // une seule : une reponse "simple ''" revenait "simple '".
      const valeurs = [];
      let courant = '';
      let chaine = false;
      for (let i = 0; i < corps.length; i++) {
        const c = corps[i];
        if (c === "'") {
          if (chaine && corps[i + 1] === "'") {
            courant += "''";
            i++;
            continue;
          }
          chaine = !chaine;
          courant += c;
          continue;
        }
        if (c === ',' && !chaine) {
          valeurs.push(courant.trim());
          courant = '';
          continue;
        }
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
          cle_norm: lire(valeurs[0]),
          cle: lire(valeurs[1]),
          reponse: lire(valeurs[2]),
          categorie: valeurs[3].toUpperCase() === 'NULL' ? null : parseInt(valeurs[3], 10),
          rang: valeurs[4].toUpperCase() === 'NULL' ? null : parseInt(valeurs[4], 10),
          source: lire(valeurs[5]) || 'sauvegarde'
        });
      }
      pos = texte.indexOf(MARQUE, fin + 1);
    }
    return dansTransaction(
      this.db,
      (entrees) => {
        this.db.prepare('DELETE FROM savoir').run();
        const stmt = this.db.prepare(`
      INSERT INTO savoir (cle_norm, cle, reponse, categorie, rang, source, maj_le)
      VALUES (@cle_norm, @cle, @reponse, @categorie, @rang, @source, datetime('now'))
    `);
        for (const e of entrees) {
          if (!e.cle_norm || !e.cle) continue;
          stmt.run(Object.assign({ valide: 1 }, e));
        }
        return entrees.length;
      },
      lignes
    );
  }

  fermer() {
    try {
      this.db.close();
    } catch (e) {}
  }

  // Ferme la base pour qu'un fichier de remplacement puisse etre ecrit par
  // dessus (indispensable sous Windows, ou SQLite garde un verrou).
  // Apres ecriture du fichier, appeler rouvrir().
  rouvrir() {
    // Fermer REELLEMENT d'abord : sous Windows, le handle ouvert empeche de
    // remplacer savoir.db. La version d'avant ne fermait rien (doc deja
    // fausse) et n'etait appelee nulle part : autant l'implementer pour de
    // vrai, idem si la base est deja fermee.
    if (estOuvert(this.db)) {
      try {
        this.db.close();
      } catch (e) {}
    }
    this.db = ouvrirBase(this.fichier).db;
    this._init();
    return this.total();
  }
}

module.exports = { SavoirDB, sansAccents };
