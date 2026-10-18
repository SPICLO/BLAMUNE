// =====================================================================
//  Savoir : secours quand l'IA est en panne (+ index semantique)
// =====================================================================
//  Source de verite : SQLite (savoir_db.js). Le fichier savoir.txt n'est
//  plus qu'un EXPORT : il sert au bot Windows local, a git et a la
//  sauvegarde JSONBin. On lit donc toujours la base, ce qui evite les
//  pertes de donnees liees aux ecritures concurrentes sur un fichier plat.
//
//  Couche par couche, ce module assemble :
//
//  1. La base SQLite (savoir.db), synchronisee au demarrage avec le
//     savoir.txt du depot : le fichier fait autorite sur les
//     connaissances EDITEES, les connaissances APPRISES en cours d'usage
//     ne sont jamais supprimees ;
//  2. L'index semantique (Qdrant cloud, optionnel) : retrouver le fait
//     pertinent quand la question n'emploie pas les memes mots. Sans
//     QDRANT_URL/QDRANT_API_KEY, tout est silencieux et le comportement
//     sans Qdrant reste impeccable ;
//  3. Les embeddings (Gemini, optionnel, QDRANT_EMBED=gemini) : les
//     vecteurs viennent de gemini-embedding-001. Sans cette variable, le
//     module retombe sur son hachage local 256 d. Un cache disque
//     (cache_embeddings.json) evite de repayer le boot initial ;
//  4. La cascade de secours reponseSecours() :
//       bot C++ local -> savoir connu -> recherche semantique ->
//       banque de replis francais -> message d'erreur.
//
//  Dependencies injectees : requeterHttp (_lib/service_bot.js_ : les
//  embeddings et le service bot partagent le transport) et
//  appelerBotLocal (le service bot). estQuota vient de lib/ia/gemini.js
//  (fonction pure partagee avec lib/ia/openai.js).
// =====================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const { SavoirDB, sansAccents: sansAccentsDB } = require('../savoir_db');
const { creerQdrantFaits, fnv1a } = require('./qdrant_faits');
const { estQuota } = require('./ia/gemini');
const { BanqueReplis } = require('../replis');

function creerSavoir({ racine, dossierDepot, loggerErreur, requeterHttp, appelerBotLocal }) {
  // ---- 1. BASE SQLITE --------------------------------------------------

  const CHEMIN_SAVOIR_DB = path.join(racine, 'savoir.db');
  const CHEMIN_SAVOIR_EXPORT = path.join(racine, 'savoir.txt');
  // Sur le cloud, un dossier d'export partage (volume Docker) permet au
  // bot C++ de lire le meme savoir que le serveur. Sinon tout se passe
  // dans racine.
  const DOSSIER_EXPORT_SAVOIR = process.env.SAVOIR_EXPORT_DIR || '';
  const savoirDb = new SavoirDB(racine, CHEMIN_SAVOIR_DB);

  function exporterSavoir() {
    try {
      if (DOSSIER_EXPORT_SAVOIR) {
        // Volume partage : le bot y lit le savoir le plus recent.
        savoirDb.exporter(path.join(DOSSIER_EXPORT_SAVOIR, 'savoir.txt'));
      }
      if (
        path.resolve(CHEMIN_SAVOIR_EXPORT) !==
        path.resolve(DOSSIER_EXPORT_SAVOIR ? path.join(DOSSIER_EXPORT_SAVOIR, 'savoir.txt') : '')
      ) {
        savoirDb.exporter(CHEMIN_SAVOIR_EXPORT);
      }
    } catch (e) {
      loggerErreur('savoir-db', 'export: ' + e.message);
    }
  }

  // Synchronisation au demarrage : le savoir.txt du depot fait autorite sur
  // les connaissances EDITEES (il est relu a chaque demarrage, et une ligne
  // retiree du fichier disparait de la base). Les connaissances apprises en
  // cours d'usage ne sont jamais supprimees.
  //
  // Pourquoi a chaque demarrage et seulement au premier : avec un import
  // unique (« si la base est vide »), une base deja creee conserve
  // indefiniment le contenu d'un savoir.txt ancien. C'est ce qui a garde en
  // production des entrees polluees retirees du depot.
  (function synchroniserSavoirAuDemarrage() {
    try {
      const avant = savoirDb.total();
      // Deux emplacements : la copie du depot (dossierDepot) et celle du
      // dossier de donnees (racine). Le depot gagne, c'est lui qui est
      // versionne.
      const candidats = [path.join(dossierDepot, 'savoir.txt'), CHEMIN_SAVOIR_EXPORT];
      let r = null;
      for (const f of candidats) {
        if (!fs.existsSync(f)) continue;
        r = savoirDb.synchroniserFichier(f);
        break;
      }
      if (r && (r.purges || avant !== savoirDb.total())) {
        console.log(
          '[BLAMUNE] Savoir synchronise : ' +
            r.importes +
            ' lignes du fichier, ' +
            r.purges +
            ' retiree(s), ' +
            savoirDb.total() +
            ' entrees en base'
        );
      } else if (avant === 0) {
        console.log('[BLAMUNE] Savoir : base vide et aucun fichier trouve');
      }
      // L'export savoir.txt doit toujours exister dans le dossier de donnees :
      // c'est lui que lisent le bot Windows local, git et la sauvegarde JSONBin.
      exporterSavoir();
    } catch (e) {
      loggerErreur('savoir-db', 'synchronisation: ' + e.message);
    }
  })();

  // Reflet en memoire du savoir, reconstruit a partir de la base.
  // On garde une Map pour ne pas interroger SQLite a chaque mot d'un message
  // (le parcours de reponse teste beaucoup de cles).
  let savoirSecours = new Map();

  function chargerSavoirSecours() {
    try {
      const carte = new Map();
      for (const e of savoirDb.toutes()) {
        carte.set(sansAccentsDB(e.cle), e.reponse);
      }
      savoirSecours = carte;
    } catch (e) {
      if (!savoirSecours) savoirSecours = new Map();
    }
  }
  chargerSavoirSecours();

  // ---- 2. INDEX SEMANTIQUE (Qdrant cloud) ------------------------------
  // savoir.db repond aux mots-cles EXACTS ; Qdrant ajoute la couche
  // semantique : retrouver le fait pertinent quand la question n'emploie
  // pas les memes mots ("combien coute le blabla" -> fait range sous
  // "prix du blabla"). Cote cloud (Render), les variables se posent dans
  // le dashboard, rien ne depend du PC local.
  const qdrantFaits = creerQdrantFaits({
    url: process.env.QDRANT_URL || '',
    cleApi: process.env.QDRANT_API_KEY || '',
    collection: process.env.QDRANT_COLLECTION || 'blamune-faits',
    seuilRecherche: parseFloat(process.env.QDRANT_SEUIL || '') || 0.3,
    actifForcer: process.env.QDRANT_ACTIV !== '0',
    sansAccents: sansAccentsDB,
    logger: loggerErreur
  });

  // ---- 3. VECTEURS DE RECHERCHE (Gemini, optionnel) --------------------
  // QDRANT_EMBED=gemini : les vecteurs viennent de gemini-embedding-001
  // (gratuit, quota D'EMBEDDING distinct du quota de chat des memes cles,
  // 768 dimensions).
  //
  // Le RPM d'embedding est TENDU (compte les items, parfois partage par
  // projet). Deux garde-fous structurels :
  //   1. CACHE DISQUE (cache_embeddings.json, cote racine) : le premier
  //      boot fait tout le travail (~13 min de fond pour 1266 faits), les
  //      boots suivants ne vectorisent que les faits NOUVEAUX : quelques
  //      secondes. Sur Render, le volume survit aux redemarrages : jamais
  //      de re-consumption.
  //   2. RESPIRATION : lots de 25, pause 15 s, et 65 s de patience sur un
  //      429 avant la cle suivante (les cles partagent parfois le meme
  //      budget).
  const EMBED_GEMINI =
    process.env.QDRANT_EMBED === 'gemini' &&
    qdrantFaits.actif() &&
    !!String(process.env.API_KEYS || process.env.API_KEY || '').trim();
  const EMBED_MODELE = 'gemini-embedding-001';
  const EMBED_DIM = 768;
  const CHEMIN_CACHE_EMBED = path.join(racine, 'cache_embeddings.json');
  let embedCleIndex = 0;

  function chargerCacheEmbed() {
    try {
      return JSON.parse(fs.readFileSync(CHEMIN_CACHE_EMBED, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  function sauverCacheEmbed(cache) {
    try {
      fs.writeFileSync(CHEMIN_CACHE_EMBED, JSON.stringify(cache));
    } catch (e) {
      loggerErreur('qdrant', 'cache embeddings: ' + e.message);
    }
  }

  // Empreinte du savoir : somme des hash des cles. Une entree ajoutee ou
  // retiree change l'empreinte (une edition de reponse non : majFait la
  // met a jour a chaud, elle ne passe pas le boot).
  function signatureSavoir(faits) {
    let s = 0;
    for (const f of faits) s = (s + fnv1a(sansAccentsDB(f.cle))) % 2147483647;
    return s | 0;
  }

  // Un lot de textes -> lot de vecteurs (rotation des cles sur erreurs,
  // longue pause sur 429 : reessayer trop vite remplume le meme budget).
  function geminiEmbedLot(textes, taskType) {
    const cles = String(process.env.API_KEYS || process.env.API_KEY || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!cles.length) return Promise.resolve(null);
    const demandes = textes.map((texte) => ({
      model: 'models/' + EMBED_MODELE,
      content: { parts: [{ text: String(texte).substring(0, 2000) }] },
      taskType,
      outputDimensionality: EMBED_DIM
    }));
    function essaiSurCle(i) {
      if (i >= cles.length) {
        loggerErreur('qdrant', 'embeddings: toutes les cles ont echoue sur ce lot');
        return Promise.resolve(null);
      }
      const cle = cles[i];
      return requeterHttp(
        'https://generativelanguage.googleapis.com/v1beta/models/' +
          EMBED_MODELE +
          ':batchEmbedContents',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cle },
          body: JSON.stringify({ requests: demandes })
        },
        60000
      )
        .then((brut) => {
          const j = JSON.parse(brut);
          const ves = (j.embeddings || []).map((e) => e.values);
          if (ves.length !== textes.length) throw new Error('longueur embeddings != textes');
          return ves;
        })
        .catch((e) => {
          const quota =
            e && (e.statusCode === 429 || /429|rate limit|quota/i.test(e.message || ''));
          const attente = quota ? 65000 : 3000;
          const suivant = () => {
            if (i + 1 < cles.length) {
              loggerErreur(
                'qdrant',
                'embeddings lot: ' +
                  e.message +
                  (quota ? ' (pause 65 s appliquee)' : '') +
                  ' -> cle suivante'
              );
              return essaiSurCle(i + 1);
            }
            loggerErreur('qdrant', 'embeddings lot: ' + e.message);
            return Promise.resolve(null);
          };
          return attente > 0 ? new Promise((r) => setTimeout(r, attente)).then(suivant) : suivant();
        });
    }
    embedCleIndex = (embedCleIndex + 1) % cles.length; // rotation sur les lots
    return essaiSurCle(embedCleIndex);
  }

  // Vecteur pour UN texte (un seul embedContent, moins lourd qu'un lot).
  // taskType : 'RETRIEVAL_DOCUMENT' (index) ou 'RETRIEVAL_QUERY' (question).
  function vecteurGemini(texte, taskType) {
    if (!EMBED_GEMINI) return Promise.resolve(null);
    return new Promise((resolve) => {
      const cles = String(process.env.API_KEYS || process.env.API_KEY || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const cle = cles[embedCleIndex % cles.length];
      requeterHttp(
        'https://generativelanguage.googleapis.com/v1beta/models/' + EMBED_MODELE + ':embedContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cle },
          body: JSON.stringify({
            content: { parts: [{ text: String(texte).substring(0, 2000) }] },
            taskType,
            outputDimensionality: EMBED_DIM
          })
        },
        30000
      )
        .then((brut) => {
          const j = JSON.parse(brut);
          resolve(
            Array.isArray(j.embedding && j.embedding.values) && j.embedding.values.length
              ? j.embedding.values
              : null
          );
        })
        .catch((e) => {
          loggerErreur('qdrant', 'embedding unitaire: ' + e.message);
          resolve(null);
        });
    });
  }

  // Synchro COMPLETE au demarrage (fond, jamais bloquant) : l'index est
  // jetable, source de verite = savoir.db. Recree tranquillement a chaque
  // boot, donc forcement coherent avec la base.
  (function synchroniserQdrantAuDemarrage() {
    if (!qdrantFaits.actif()) return;
    const faits = savoirDb.toutes().filter((f) => f.reponse && String(f.reponse).trim());
    const depart = Date.now();
    (async () => {
      if (EMBED_GEMINI) {
        // 1) CACHE : deja vectorise -> zero appel. 2) Reste : lots de 25
        // avec respiration. Cache mis a jour au fil de l'eau (1 ecriture
        // par lot) : un arret au milieu n'oublie que le lot en cours.
        const cache = chargerCacheEmbed();
        const repos = [];
        for (const f of faits) {
          const v = cache[sansAccentsDB(f.cle)];
          if (Array.isArray(v) && v.length) f.vecteur = v;
          else repos.push(f);
        }
        if (repos.length) {
          console.log(
            '[BLAMUNE] Qdrant : ' +
              (faits.length - repos.length) +
              ' vecteurs depuis le cache, ' +
              repos.length +
              ' a calculer'
          );
        }
        const FAISCEAU = 25;
        for (let i = 0; i < repos.length; i += FAISCEAU) {
          const morceau = repos.slice(i, i + FAISCEAU);
          const ves = await geminiEmbedLot(
            morceau.map((f) => (f.cle + '. ' + f.reponse).substring(0, 2000)),
            'RETRIEVAL_DOCUMENT'
          );
          if (!ves) {
            // Vecteurs du cache utilises quand meme ; l'index des faits
            // restants sera complete par le prochain boot.
            sauverCacheEmbed(cache);
            loggerErreur(
              'qdrant',
              'embeddings du boot interrompues (resync partielle, le cache garde le reste)'
            );
            break;
          }
          morceau.forEach((f, x) => {
            f.vecteur = ves[x];
            cache[sansAccentsDB(f.cle)] = ves[x];
          });
          sauverCacheEmbed(cache);
          if (i + FAISCEAU < repos.length) {
            await new Promise((r) => setTimeout(r, 15000));
          }
        }
        const indexables = faits.filter((f) => Array.isArray(f.vecteur) && f.vecteur.length);
        if (!indexables.length) {
          loggerErreur('qdrant', 'aucun vecteur disponible ce boot');
          return;
        }
        // RESYNC CONDITIONNELLE : l'index est compare au savoir (nombre de
        // points + signature des cles). Identique = on ne touche a rien
        // (zero risque de socket hang up, zero latence au boot). Differents
        // = raser puis rejouer depuis le cache (aucun appel d'embedding).
        const s = await qdrantFaits.sante();
        const signature = signatureSavoir(indexables);
        if (
          s &&
          s.statut === 'ok' &&
          s.points === indexables.length &&
          cache._signature === signature
        ) {
          console.log(
            '[BLAMUNE] Qdrant : index deja synchronise (' +
              s.points +
              ' points, signature ok) : aucune ecriture'
          );
          return;
        }
        const r = await qdrantFaits.synchroniserTout(indexables);
        if (r) {
          cache._signature = signature;
          sauverCacheEmbed(cache);
          console.log(
            '[BLAMUNE] Qdrant : ' +
              r.total +
              ' faits indexes (Gemini ' +
              EMBED_DIM +
              'd, cache ' +
              (faits.length - repos.length) +
              '/' +
              faits.length +
              ' hits, travail total ' +
              Math.round((Date.now() - depart) / 1000) +
              ' s)'
          );
        }
      } else {
        const r = await qdrantFaits.synchroniserTout(faits);
        if (r)
          console.log(
            '[BLAMUNE] Qdrant : ' + r.total + ' faits indexes (recherche semantique locale)'
          );
      }
    })().catch((e) => loggerErreur('qdrant', 'demarrage: ' + (e && e.message)));
  })();

  // Apres toute ecriture, on rafraichit le reflet en memoire et on regenere
  // l'export (pour git / bot local), sans bloquer la reponse. L'index
  // semantique Qdrant est mis a jour en tache de fond (meme regle).
  function savoirEnregistrer(cle, reponse, categorie, source) {
    const ok = savoirDb.repondre(cle, reponse, categorie);
    if (ok) {
      chargerSavoirSecours();
      exporterSavoir();
      // majQdrant : uniquement si le fait AFFIRME quelque chose (meme regle
      // que toutes()) — un mot-cle de categorie n'indexe rien a lire.
      if (reponse && String(reponse).trim() && qdrantFaits.actif()) {
        (async () => {
          const fait = { cle, reponse, categorie };
          if (EMBED_GEMINI) {
            const v = await vecteurGemini(
              (cle + '. ' + reponse).substring(0, 2000),
              'RETRIEVAL_DOCUMENT'
            );
            if (!v) return; // embeddings indisponibles : le prochain boot resynchronisera
            fait.vecteur = v;
          }
          await qdrantFaits.majFait(fait);
        })().catch((e) => loggerErreur('qdrant', 'maj fait: ' + (e && e.message)));
      }
    }
    return ok;
  }

  // La cle est-elle presente comme mot entier ? "un ordi" est dans "c est
  // quoi un ordi", mais "ordi" n'est pas dans "ordinateur" ni "match" dans
  // "matche". Meme regle que le bot local (contientMot).
  function savoirContientEntier(texte, cle) {
    let i = texte.indexOf(cle);
    while (i >= 0) {
      const avant = i > 0 ? texte[i - 1] : ' ';
      const apres = i + cle.length < texte.length ? texte[i + cle.length] : ' ';
      const lettre = (c) => (c >= 'a' && c <= 'z') || c === "'";
      if (!lettre(avant) && !lettre(apres)) return true;
      i = texte.indexOf(cle, i + 1);
    }
    return false;
  }

  // Plus longue cle connue presente dans le message : la plus precise gagne
  // (comme le bot local : "course" cede la place a "courses").
  function chercherSavoir(msg) {
    try {
      chargerSavoirSecours();
    } catch (e) {}
    if (!savoirSecours || savoirSecours.size === 0) return '';
    const texte = sansAccentsDB(String(msg || '').toLowerCase());
    if (!texte) return '';
    let meilleureCle = '';
    let meilleureRep = '';
    for (const [cle, rep] of savoirSecours) {
      if (cle.length <= meilleureCle.length) continue;
      if (savoirContientEntier(texte, cle)) {
        meilleureCle = cle;
        meilleureRep = rep;
      }
    }
    return meilleureRep;
  }

  // ---- 4. CASCADE DE SECOURS -------------------------------------------
  // Ce que l'utilisateur voit quand l'IA echoue, dans l'ordre :
  //   1. le bot C++ local      (regles BLAMUNE, hors ligne, francais)
  //   2. le savoir connu       (reponse factuelle, si on l'a)
  //   3. la banque replis.txt  (ton de BLAMUNE, francais, hors ligne)
  //   4. le message d'erreur   (dernier recours)
  // Aucune latence ajoutee sur le chemin nominal : tout est local, et le
  // service bot n'est interroge qu'apres un echec reel de l'IA.

  // Ce que l'utilisateur voit quand tout a echoue : on distingue le quota
  // (il n'y a rien a faire d'autre que d'attendre) d'un vrai souci technique.
  function messageTechnique(e) {
    if (estQuota(e))
      return 'Beaucoup de monde en ce moment, mon quota est sature. Reessaie dans une minute, je suis la.';
    return "Desole, j'ai eu un probleme technique. Reessaie.";
  }

  // Comme pour savoir.txt : on cherche d'abord dans le dossier de donnees,
  // puis dans le depot. Sans ce repli, un BLAMUNE_DATA_DIR vide (tests,
  // cloud) demarre sans banque et retombe sur le message d'erreur technique.
  const CHEMIN_REPLIS = fs.existsSync(path.join(racine, 'replis.txt'))
    ? path.join(racine, 'replis.txt')
    : path.join(dossierDepot, 'replis.txt');
  const banqueReplis = new BanqueReplis(racine, CHEMIN_REPLIS);

  // chercherSemantique : quand la question n'emploie pas les mots exacts du
  // fait, Qdrant retrouve le voisin le plus proche (cosinus >= seuil).
  // QDRANT_EMBED=gemini : le vecteur de la question vient de Gemini
  // (RETRIEVAL_QUERY, meme espace vectoriel que les faits indexes).
  // EN ECHEC reseau : '' (le repli continue), jamais d'exception.
  async function chercherSemantique(msg) {
    try {
      if (!qdrantFaits.actif()) return '';
      let options;
      if (EMBED_GEMINI) {
        const v = await vecteurGemini(String(msg).substring(0, 2000), 'RETRIEVAL_QUERY');
        if (!v) return ''; // pas de vecteur : pas de recherche, le repli continue
        options = { vecteur: v };
      }
      const r = await qdrantFaits.chercher(msg, 3, options);
      if (r && r.length && r[0].reponse) {
        loggerErreur(
          'qdrant',
          'semantique: "' +
            msg +
            '" -> fait "' +
            r[0].cle +
            '" (cosinus ' +
            r[0].score.toFixed(2) +
            ')'
        );
        return r[0].reponse;
      }
    } catch (e) {
      /* bonus seulement */
    }
    return '';
  }

  async function reponseSecours(msg, e) {
    const local = await appelerBotLocal(msg);
    if (local) return local;
    // Le savoir n'est consulte que si le message demande vraiment une
    // information sur un sujet. Une question ouverte ("qu'est-ce qui se
    // passe ?", "comment va la meteo") n'attend pas une definition : y
    // repondre avec le fait qui partage un mot ("passe" -> la passe au
    // foot) est une coincidence lexicale, pas une connaissance. Voir
    // demandeInfo() plus bas.
    const rep = demandeInfo(msg) ? chercherSavoir(msg) : '';
    if (rep) return rep;
    const sem = await chercherSemantique(msg);
    if (sem) return sem;
    const repli = banqueReplis.repli(msg);
    if (repli) return repli;
    return messageTechnique(e);
  }

  // Demande d'information sur un sujet : la forme de la phrase separe
  // "c'est quoi tokyo ?" (definition plausible) de "qu'est-ce qui se
  // passe ?" (situation, aucun sujet). Meme nettoyage que detecterSituation
  // (replis.js) : accents retires (sansAccents), apostrophes et tirets
  // devenus espaces.
  const MOTIF_DEMANDE_INFO =
    /(qu est ce que|c est quoi|c quoi|que signifie|definition|definit|a quoi sert|sert a quoi|comment ca marche|comment marche|comment faut faire|comment on fait)/;

  function demandeInfo(msg) {
    // sansAccents (de savoir_db) ne normalise pas la casse ni les
    // apostrophes : le motif vire les guillemets et les tirets.
    const t = sansAccentsDB(String(msg || '').toLowerCase())
      .replace(/[\u2018\u2019'`]/g, ' ')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ');
    return MOTIF_DEMANDE_INFO.test(t);
  }

  return {
    // Acces a la source de verite (routes admin, sauvegarde/restauration).
    savoirDb,
    sansAccentsDB,
    // Export / reflet memoire (appliquerSauvegarde les rappelle apres un
    // import).
    exporterSavoir,
    chargerSavoirSecours,
    // Ecriture d'une connaissance (routes compte : proliferation du savoir).
    savoirEnregistrer,
    // Cascade de secours complete (send.js, l'appel 'EGO' repond en dernier
    // recours) :
    reponseSecours,
    chercherSavoir,
    chercherSemantique,
    demandeInfo,
    messageTechnique,
    // Etat de l'index semantique pour /health.
    qdrantSante: () => qdrantFaits.sante(),
    // Diagnostique du demarrage (nombre de situations de repli dispo).
    tailleBanqueReplis: () => banqueReplis.taille(),
    qdrant: qdrantFaits
  };
}

module.exports = { creerSavoir };
