// =====================================================================
//  Transport vers l'API Google Gemini
// =====================================================================
//  Deux points qui font gagner du temps :
//   1) on n'envoie que les N derniers messages (moins d'entree = premiere
//      lettre affichee bien plus tot),
//   2) on demande une reponse EN FLUX (SSE) : le client voit le texte
//      s'ecrire au lieu d'attendre la fin de la generation.
//
//  Ce module est aussi le possesseur de plusieurs etats de la couche IA,
//  alors qu'ils ne concernent que le fournisseur Gemini :
//
//  - la rotation des cles (API_KEYS), qui ne doit jamais s'appliquer a un
//    fournisseur compatible OpenAI : la cle principale appartient alors a
//    un autre service ;
//  - le "retraitement" du modele. Si celui-ci refuse thinkingConfig ou
//    google_search en renvoyant un 400, on ne insiste pas : on coupe le
//    champ definitivement pour ce processus. Ces deux drapeaux sont lus
//    par la suite de conversation, pas seulement ici ;
//  - l'instant du dernier quota reellement constate, qui sert a maintenir
//    les taches de fond hors du chemin quand le quota vient de sauter.
//
//  Les utilitaires de reprise sur erreur (erreurRetentable, tentable,
//  delaiIndique, attendre, requeter) sont plus larges que Gemini : ils sont
//  utilises aussi par le fournisseur compatible OpenAI et par le service du
//  bot C++. Ils vivent donc ici pour eviter un second module identique, et
//  sont exportes.
//
//  config est capture par reference : /config-api mute ses proprietes
//  (config.api_key = ...) sans jamais reassigner l'objet, donc la reference
//  reste valable. C'est ce qui permet d'eviter un getter a chaque acces.
// =====================================================================
'use strict';

const http = require('http');
const https = require('https');
// sansAccents est un utilitaire de texte pur exporte par savoir_db.js, pas un
// etat du serveur : l importer ici evite au cablage de dependre de l ordre
// de declaration des blocs de server.js.
const { sansAccents } = require('../../savoir_db');
// Comptage des 429 (fenetre) + drapeau "mode eco" pour les taches de fond.
// Singleton : marquerQuota() ci-dessous est LE goulot de tous les 429 (voie
// Gemini directe ET voie pool OpenAI), donc un seul proces suffit.
const tension = require('../tension');
// Fenetre de contexte pilotee par un BUDGET DE TOKENS (lib/tokens.js) : le
// nombre de messages n'est pas un metre fiable (10 messages courts valent
// 300 tokens, 10 messages denses en valent 6 000).
const { choisirFenetre, budgetCourant, plafondSortie } = require('../tokens');
const HISTO_API_MAX = 10; // derniers echanges envoyes a l'API
// 2026-10-30 : 16 -> 10. Le plafond Groq serrer ses 8 K tokens/min : la
// fenetre 16 degorgeait le budget en un ou deux echanges denses. Les
// echanges plus anciens ne sont pas perdus pour autant : le resume
// persistant (lib/resume.js : 20 echanges replies des que 10 echanges ou
// 3 000 caracteres ne sont plus couverts) les porte toujours dans le
// system prompt.
const HISTO_AFFICHAGE_MAX = 100; // dernieres bulles rendues par /historique
const HISTO_ECO_MAX = 6; // echanges envoyes sous tension : economie d'entree

// Error = quota ? Partage avec tout le transport IA (lib/ia/openai.js) :
// le message d'echec doit dire "quota" quand c'est du quota, pas plus tard
// qu'un souci technique. FAIL SAFE : aucun etat, jamais reassignee.
function estQuota(e) {
  if (!e) return false;
  if (e.statusCode === 429) return true;
  return /quota|exhausted|high demand|rate.?limit|resource has been/i.test(e.message || '');
}

// Quota de TOKENS (et non de requetes) ? Groq et les passerelles
// OpenAI-compatibles le disent explicitement :
//   "Rate limit reached ... on tokens per minute (TPM): Limit 8000,
//    Used 7500, Requested 1200"
// Gemini reste generique ("Resource has been exhausted") : dans ce cas
// l'appelant reduit aussi, mais seulement si la requete est deja grosse.
// Fonction pure, partagee avec lib/ia/openai.js.
function estQuotaTokens(e) {
  if (!e) return false;
  const m = String(e.message || '');
  return /tokens? per minute|\bTPM\b|token rate|tokens?\/min|tokens? per day|\bTPD\b|requested\s+\d+\s+tokens/i.test(
    m
  );
}

// En-tete standard Retry-After (RFC 7231) pose sur les 429 par la plupart
// des fournisseurs, en secondes ou en date HTTP. Rendu en ms restants ;
// 0 si absent, vide ou illisible. Fonction pure : partagee avec le
// transport OpenAI (comme estQuota) et rattachee a l'erreur au moment de
// la reponse non-200 (modeleClassiqueBrut / modeleEnFluxBrut / openAIRequete).
function retryApresDepuisEnTete(valeur) {
  if (!valeur) return 0;
  const s = String(valeur).trim();
  if (!s) return 0;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Math.max(0, Math.round(parseFloat(s) * 1000));
  const date = Date.parse(s);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return 0;
}

// Usage normalise, commun aux deux fournisseurs. Gemini rend
// `usageMetadata` (promptTokenCount / candidatesTokenCount), OpenAI rend
// `usage` (prompt_tokens / completion_tokens) : le compteur ne doit voir
// qu'une seule forme. Fonction pure, exposee pour les tests.
function normaliserUsage(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const entree = Number(meta.promptTokenCount || meta.prompt_tokens || 0);
  const sortie = Number(meta.candidatesTokenCount || meta.completion_tokens || 0);
  const total = Number(meta.totalTokenCount || meta.total_tokens || entree + sortie);
  if (!entree && !sortie && !total) return null;
  const u = { entree: entree, sortie: sortie, total: total };
  // Tokens servis depuis le cache de prompt : Gemini les rend dans
  // cachedContentTokenCount, les passerelles OpenAI-compatibles dans
  // prompt_tokens_details.cached_tokens. Absent = 0, et on n'ajoute pas la
  // cle : les formes existantes des mesures ne changent pas.
  const cache = Number(
    meta.cachedContentTokenCount ||
      (meta.prompt_tokens_details && meta.prompt_tokens_details.cached_tokens) ||
      meta.cached_tokens ||
      0
  );
  if (cache > 0) u.cache = cache;
  return u;
}

// Texte utile d'une reponse Gemini, et usage transmis au compteur.
// Fonction pure, exposee pour les tests.
function texteDepuisReponse(data, surUsage) {
  const json = JSON.parse(data);
  if (json.error) throw new Error(json.error.message);
  if (typeof surUsage === 'function') {
    const u = normaliserUsage(json.usageMetadata);
    if (u) {
      try {
        surUsage(u);
      } catch (e) {}
    }
  }
  return (
    (json.candidates &&
      json.candidates[0] &&
      json.candidates[0].content &&
      json.candidates[0].content.parts) ||
    []
  )
    .filter((p) => p && p.text && !p.thought)
    .map((p) => p.text)
    .join('');
}

function creerGemini({ getConfig, providerOpenAI }) {
  const config = getConfig();

  // --- Historique envoye au modele -------------------------------------

  function limiterHisto(histo, nb) {
    if (!Array.isArray(histo) || histo.length <= nb + 1) return histo;
    const systeme = histo.filter((h) => h.role === 'system');
    let convo = histo.filter((h) => h.role !== 'system').slice(-nb);
    while (convo.length && convo[0].role !== 'user') convo.shift();
    return systeme.concat(convo);
  }

  // Fenetre REELLE des requetes : un budget de tokens (5 000 par defaut,
  // 3 000 en mode eco) remplace le comptage en messages. Le bloc systeme
  // (persona + memoire + sources web) est toujours conserve : c'est la
  // conversation ancienne qui saute. `limiterHisto` reste expose pour les
  // tests et les appelants qui comptent encore en messages.
  function fenetrerHisto(histo, budget) {
    return choisirFenetre(histo, budget || budgetCourant(tension.enTension()));
  }

  // Nombre d'echanges pour LA PROCHAINE requete : 16 ordinairement, 6
  // sous tension (mode eco). Le prompt envoye EST le quota depense : la
  // troncature n'ajoute pas de requete, elle fait peser chaque appel
  // beaucoup moins lourd dans la fenetre saturee.
  function nbEchanges() {
    return tension.enTension() ? HISTO_ECO_MAX : HISTO_API_MAX;
  }

  function construireContenus(histo, imageParts) {
    const contents = [];
    for (const h of histo) {
      if (h.role === 'system') {
        // Le bloc systeme reste SEPARE des tours user/model : corpsGemini
        // l'envoie via `systemInstruction`, que Gemini traite comme un
        // prefixe stable (cache de prompt implicite) au lieu de le noyer
        // dans le premier message utilisateur.
        contents.push({ role: 'system', parts: [{ text: h.content }] });
        continue;
      }
      const role = h.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: h.content }] });
    }
    // La photo jointe : attachee au DERNIER message utilisateur (= celui qui
    // vient d'etre pousse dans l'historique), jamais aux anciens.
    if (imageParts) {
      for (let i = contents.length - 1; i >= 0; i--) {
        if (contents[i].role === 'user') {
          contents[i].parts.push({ inline_data: imageParts });
          break;
        }
      }
    }
    return contents;
  }

  // --- Cles API ----------------------------------------------------------

  // Support plusieurs cles Gemini : API_KEYS=cle1,cle2,...
  // On bascule automatiquement sur la suivante quand une cle est en quota.
  let cleGeminiIndex = 0;

  // Rotation reservee au fournisseur Gemini. Si le fournisseur actif est
  // compatible OpenAI (Eden AI, Groq, Ollama...), on ne retourne RIEN : la
  // cle principale appartient a un autre service et ne doit jamais etre
  // envoyee en x-goog-api-key a l'API Google.
  function clesGemini() {
    if (providerOpenAI()) return [];
    const raw = process.env.API_KEYS || process.env.API_KEY || '';
    const splittes = String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (splittes.length) return splittes;
    if (config.api_key) return [config.api_key];
    return [];
  }

  function cleGeminiActive() {
    const cles = clesGemini();
    if (!cles.length) return '';
    return cles[cleGeminiIndex % cles.length];
  }

  function noterErreurGemini(e) {
    if ((e && e.statusCode === 429) || (e && /quota|429|rate limit/i.test(e.message || ''))) {
      const cles = clesGemini();
      if (cles.length > 1) cleGeminiIndex++;
    }
  }

  function optionsGemini() {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cleGeminiActive() },
      timeout: 30000
    };
  }

  // --- Drapeaux de retraitement -----------------------------------------

  // La "reflexion" du modele (thinking) ajoute plusieurs secondes avant la
  // premiere lettre : on la desactive pour repondre vite. Si le modele refuse
  // ce champ (HTTP 400), on retente une seule fois sans, puis on n'insiste plus.
  let reflexionRefusee = false;
  // Idem pour l'outil de recherche web : si le modele refuse `tools`, on coupe
  // definitivement la recherche plutot que de casser la conversation.
  let rechercheRefusee = false;
  // Et pour `systemInstruction` : un modele ancien (ou un proxy) qui ne le
  // connait pas doit continuer a fonctionner. On repasse alors a l'ancienne
  // forme : le bloc systeme colle en tete du premier message utilisateur.
  let systemeRefuse = false;

  // Recherche web utile UNIQUEMENT pour les questions d'actualite : laisser
  // google_search sur chaque phrase facturerait une recherche a chaque appel.
  function mereiteRecherche(texte) {
    const t = sansAccents(String(texte || '').toLowerCase());
    // Volontairement strict : chaque declenchement facture une recherche
    // Google et retarde le premier caractere affiche. On garde les demandes
    // explicites d'infos en direct (actu, meteo, resultats sportifs ou
    // electoraux, sorties culturelles, cours) et on laisse tomber les pieges
    // du quotidien : "hier", "aujourd'hui", "match", "resultats" (scolaires
    // !), une date d'anniversaire, une annee... qui ne demandent pas le web.
    return /\b(actualite|dernieres? infos?|en ce moment|breaking|meteo|elections?|resultats? des elections|qui a gagne|gagn(e|er) (le |la |l')?(match|election|coupe)|nouveau (film|album|episode)|bande[- ]annonce|cours (du|de|des) (bourse|bitcoin|crypto|action)|ligue des champions|coupe du monde)\b/.test(
      t
    );
  }

  // Dernier texte vu dans les contenus (= le message qui arrive).
  function dernierTexteContenus(contents) {
    for (let i = contents.length - 1; i >= 0; i--) {
      const parts = (contents[i] && contents[i].parts) || [];
      for (const p of parts) if (p && p.text) return p.text;
    }
    return '';
  }

  // Vrai si la recherche web merite d'etre demandee pour CE contenu.
  // La RECHERCHE SERVEUR (lib/recherche_web.js, DuckDuckGo sans cle) peut
  // deja avoir rempli le prompt systeme de sources : dans ce cas on ne
  // facture PAS google_search par-dessus (meme sujet, double travail).
  function rechercheDejaInjectee(contents) {
    for (let i = 0; i < contents.length; i++) {
      const parts = (contents[i] && contents[i].parts) || [];
      for (let j = 0; j < parts.length; j++) {
        const p = parts[j];
        if (p && typeof p.text === 'string' && p.text.indexOf('RECHERCHE WEB (effectuee le ') >= 0)
          return true;
      }
    }
    return false;
  }

  function outillageUtile(contents) {
    return (
      config.recherche_web !== false &&
      !rechercheRefusee &&
      mereiteRecherche(dernierTexteContenus(contents)) &&
      !rechercheDejaInjectee(contents)
    );
  }

  // Separe le bloc systeme des tours de conversation. Gemini distingue
  // `systemInstruction` (instructions stables, mises en cache) des
  // `contents` : c'est la forme recommandee pour un prompt rejoue a chaque
  // message, et elle evite de noyer la persona dans le premier message.
  function separerSysteme(contents) {
    const morceaux = [];
    const tours = [];
    for (const c of contents || []) {
      if (c && c.role === 'system') {
        const texte = (c.parts || [])
          .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
          .join('');
        if (texte) morceaux.push(texte);
      } else {
        tours.push(c);
      }
    }
    return { systeme: morceaux.join('\n\n'), tours };
  }

  // Repli quand `systemInstruction` est refuse (ou quand il ne reste aucun
  // tour) : le texte revient en tete du premier message utilisateur, comme
  // avant ce changement. La photo eventuelle est conservee.
  function toursAvecSysteme(tours, systeme) {
    const copie = tours.slice();
    for (let i = 0; i < copie.length; i++) {
      const t = copie[i];
      if (!t || t.role !== 'user') continue;
      const parts = Array.isArray(t.parts) ? t.parts : [];
      const texte = parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
      const autres = parts.filter((p) => !(p && typeof p.text === 'string'));
      copie[i] = { role: 'user', parts: [{ text: systeme + '\n\n' + texte }].concat(autres) };
      return copie;
    }
    return [{ role: 'user', parts: [{ text: systeme }] }].concat(copie);
  }

  function corpsGemini(contents, sansReflexion, avecOutils) {
    const { systeme, tours } = separerSysteme(contents);
    const generationConfig = {
      // Plafond adapte a la demande (lib/tokens.js) : 384 tokens pour une
      // reponse de 1 a 3 phrases, jusqu'a config.api_max_tokens pour un
      // livrable (texte, code, traduction). Le plafond configure reste le
      // maximum absolu.
      maxOutputTokens: plafondSortie(dernierTexteContenus(contents), config.api_max_tokens),
      temperature: config.api_temperature
    };
    if (sansReflexion) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const corps = { contents: tours, generationConfig };
    if (systeme) {
      if (systemeRefuse || tours.length === 0) {
        corps.contents = toursAvecSysteme(tours, systeme);
      } else {
        corps.systemInstruction = { parts: [{ text: systeme }] };
      }
    }
    if (avecOutils) corps.tools = [{ google_search: {} }];
    return JSON.stringify(corps);
  }

  // 400 recu alors qu'on venait d'envoyer un champ que le modele refuse :
  // systemInstruction d'abord (present dans chaque requete), puis l'outil
  // de recherche (si on l'a vraiment envoye), puis thinkingConfig. On
  // marque l'echec et on signale le retraitement.
  function refusChamp(statusCode, sansReflexion, avecOutils, texteErreur) {
    if (statusCode !== 400) return null;
    if (!systemeRefuse && /system.?instruction/i.test(String(texteErreur || ''))) {
      systemeRefuse = true;
      const e = new Error('systemInstruction refuse par le modele');
      e.systeme = true;
      return e;
    }
    if (avecOutils && !rechercheRefusee) {
      rechercheRefusee = true;
      const e = new Error('outil de recherche refuse par le modele');
      e.recherche = true;
      return e;
    }
    if (sansReflexion && !reflexionRefusee) {
      reflexionRefusee = true;
      const e = new Error('thinkingConfig refuse par le modele');
      e.reflexion = true;
      return e;
    }
    return null;
  }

  // --- Construction des URL ----------------------------------------------

  // config.api_url accepte deux formats :
  //   - la base : https://host/v1beta                              (recommande)
  //   - l'URL complete : https://host/v1beta/models/modele:generateContent
  //     (ancien format, cf. config.json.example)
  // Dans les deux cas on en deduit la base, puis on construit l'URL exacte du
  // modele demande. Ca permet de pointer API_URL vers un proxy (http://...).
  const URL_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

  function baseGemini() {
    let u = String(config.api_url || '')
      .trim()
      .replace(/\/+$/, '');
    if (!u) return URL_GEMINI_BASE;
    u = u.replace(/\/models\/[^/:?]+:(?:generateContent|streamGenerateContent)(?:\?.*)?$/i, '');
    u = u.replace(/\/models\/[^/:?]+$/i, '');
    return u || URL_GEMINI_BASE;
  }

  function urlGemini(modele, enFlux) {
    return (
      baseGemini() +
      '/models/' +
      modele +
      (enFlux ? ':streamGenerateContent?alt=sse' : ':generateContent')
    );
  }

  // http ou https selon la base (un proxy local est en http).
  function requeter(url, options, onReponse) {
    return (url.indexOf('http:') === 0 ? http : https).request(url, options, onReponse);
  }

  // --- Reprise sur erreur transitoire ------------------------------------

  // 429 (quota), 5xx et erreurs reseau sont retentables UNE fois, avec un
  // delai court. Le budget est donne par l'appelant (`{ n: 1 }`) et reste local
  // a sa requete : une tache de fond (resume, extraction) n'empiete jamais sur
  // les tentatives de la reponse en cours d'ecriture.
  function erreurRetentable(e) {
    if (!e) return false;
    const c = e.statusCode;
    if (c === 429 || c === 500 || c === 502 || c === 503 || c === 504) return true;
    const code = e.code || '';
    if (
      ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'ENOTFOUND'].indexOf(
        code
      ) >= 0
    )
      return true;
    return e.message === 'Timeout';
  }

  function tentable(budget) {
    if (!budget || budget.n <= 0) return false;
    budget.n--;
    return true;
  }

  // Google precise la vraie duree d'attente dans le 429 :
  // "Please retry in 45.411629042s". Priorite a e.retryAfterMs (valeur de
  // l'en-tete Retry-After rattachee par les 3 sites non-200) ; le parsing
  // du message reste de secours pour les rares 429 sans en-tete.
  function delaiIndique(e) {
    if (e && e.retryAfterMs > 0) return e.retryAfterMs;
    const m = e && e.message && e.message.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i);
    return m ? Math.round(parseFloat(m[1]) * 1000) : 0;
  }

  // --- Quota et taches de fond --------------------------------------------

  // Dernier quota reel vu (pour garder les taches de fond hors du chemin).
  // Le quota gratuit se recharge en 1 minute.
  let dernierQuota = 0;
  const QUOTA_FENETRE = 60000;

  /** A appeler quand une requete a reellement echoue sur un 429. */
  function marquerQuota() {
    dernierQuota = Date.now();
    // Fenetre de tension (lib/tension.js) : chaque 429 visible dans /admin
    // et souffre le "mode eco" quand la fenetre sature (recherche auto
    // coupee, taches de fond suspendues). Un seul appel ici, goulot
    // unique des deux transporteurs.
    tension.noter();
  }

  /** Instant du dernier 429 constate, 0 si aucun. */
  function instantDernierQuota() {
    return dernierQuota;
  }

  /** Milliseconds restantes avant que la fenetre de quota ne soit rechargee. */
  function resteFenetreQuota() {
    return Math.max(0, QUOTA_FENETRE - (Date.now() - dernierQuota));
  }

  // Le drapeau est lu par la suite de conversation pour eviter de renvoyer
  // thinkingConfig a un modele qui l'a deja refuse. L accesseur ne porte pas
  // le meme nom que l etat : le nommer pareil serait une redefinition.
  function reflexionDejaRefusee() {
    return reflexionRefusee;
  }

  // Les taches de fond (resume, extraction) ajoutent des appels par message :
  // juste apres un 429, on attend la recharger de la fenetre plutot que de
  // crever a nouveau le quota et de voler les requetes de la reponse.
  // Et pendant une tension (fenetre de 429 saturee, mode eco) elles sont
  // JETEES au lieu d'etre lancees : le pool en sous-capacite n'a plus qu'un
  // client, le chat. Rien n'est perdu de facon irremplacable : un resume
  // saute est rattrape au message suivant, un fait web saute l'etait
  // volontairement (eco = garder les tokens pour le chat).
  // Timers de taches de fond en attente. Deux raisons de les garder :
  //  - unref : une tache REPORTEE (fenetre de quota en cours) ne doit pas
  //    retenir le process — sinon un SIGTERM attendait jusqu'a QUOTA_FENETRE
  //    (60 s), tres au-dela du filet de 5 s de fermerProperement ;
  //  - un handle : `annulerTachesReportees()` les coupe au demarrage d'une
  //    fermeture, pour ne pas ecrire dans un compte que l'admin supprime.
  const tachesReportees = new Set();

  function reporterTache(lancer) {
    if (tension.enTension()) {
      tension.tacheSuspendue();
      return;
    }
    const ecart = Date.now() - dernierQuota;
    const delai = ecart >= QUOTA_FENETRE ? 0 : QUOTA_FENETRE - ecart;
    if (delai <= 0) {
      lancer();
      return;
    }
    const minuteur = setTimeout(() => {
      tachesReportees.delete(minuteur);
      lancer();
    }, delai);
    tachesReportees.add(minuteur);
    if (minuteur.unref) minuteur.unref();
  }

  /** Coupe les taches de fond reportees (arret du process). */
  function annulerTachesReportees() {
    for (const m of tachesReportees) clearTimeout(m);
    tachesReportees.clear();
  }

  function attendre(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    HISTO_API_MAX,
    HISTO_AFFICHAGE_MAX,
    HISTO_ECO_MAX,
    QUOTA_FENETRE,
    limiterHisto,
    fenetrerHisto,
    nbEchanges,
    construireContenus,
    clesGemini,
    cleGeminiActive,
    noterErreurGemini,
    optionsGemini,
    outillageUtile,
    corpsGemini,
    refusChamp,
    normaliserUsage,
    texteDepuisReponse,
    baseGemini,
    urlGemini,
    requeter,
    erreurRetentable,
    tentable,
    delaiIndique,
    retryApresDepuisEnTete,
    marquerQuota,
    instantDernierQuota,
    resteFenetreQuota,
    reflexionDejaRefusee,
    reporterTache,
    annulerTachesReportees,
    attendre
  };
}

module.exports = {
  creerGemini,
  estQuota,
  estQuotaTokens,
  retryApresDepuisEnTete,
  normaliserUsage,
  texteDepuisReponse
};
