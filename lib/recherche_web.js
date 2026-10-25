// =====================================================================
//  Module : recherche web en profondeur (DuckDuckGo + lecture de pages)
// =====================================================================
//  Le but produit : "l'IA epaule BLAMUNE et EGO" INDEPENDAMMENT du
//  fournisseur. Avant ce module, seul Gemini pouvait chercher (outil
//  google_search, facture a chaque declenchement) : les modeles de
//  secours du pool (Groq, Pollinations, Mistral...) repondaient a
//  l'aveugle des que la question demandait une info du jour.
//
//  Le principe est inverse : un chercheur SERVEUR, sans cle, ramene des
//  SOURCES (titres + extraits + pages lues), et le texte est injecte
//  dans le prompt systeme. Tout modele du pool recoit le meme contexte,
//  la facture Google tombe a zero, et le modele cite les sources.
//
//  Decoupage honnete :
//    - rechercheWeb(sujet, opts)   : cherche + lit, renvoie des sources.
//    - pourPrompt(recherche, opts) : mise en forme pour le prompt systeme.
//    - faitsAPrendre(recherche)    : 2 faits max, dates et sourcees.
//    - commandeWeb(texte)          : decode "/cherche <sujet>".
//    - demandeWebEvidente(texte)   : declenchement auto (volontairement
//      proportionne : l'auto ne lit PAS de page, uniquement des extraits).
//
//  Garde-fous inclus :
//    - SSRF : la lecture de page refuse localhost, les plages IP
//      privees/metadata (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16,
//      CGNAT 100.64/10, ::1, fc00::/7, fe80::/10) et les protocoles non
//      http(s). (Le rebinding DNS reste en dehors du v1 : le serveur ne
//      lit jamais une URL fournie directement par le visiteur, il lit
//      seulement ce que DuckDuckGo a deja arbitre.)
//    - Lecture lisible uniquement text/html / text/plain / xhtml,
//      plafonnee en octets (300 Ko) puis en caracteres (6000 par page),
//      jamais un binaire decode a l'aveugle.
//    - DuckDuckGo peut lever une anomalie anti-bot selon l'IP du serveur :
//      on renvoie alors une recherche vide avec remarque, sans erreur
//      bloquante ; la reponse du modele continue sans web.
// =====================================================================
'use strict';

const USER_AGENT = 'Mozilla/5.0 (compatible; BLAMUNE/1.0; +https://blamune.onrender.com)';
const DELAI_REPONSE_MS = 7000; // timeout HTTP (recherche OU lecture de page)
const TAILLE_MAX_REPONSE = 300 * 1024; // octets max lus par requete
const EXTRAITS_MAX = 320; // caracteres d'un extrait garde
const PAGE_TXT_MAX = 6000; // caracteres de texte utile gardes par page
const BLOC_MAX = 14000; // caracteres max du bloc injecte dans le prompt

// ============================ OUTILS TEXTE ============================

const ENTITES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&#x2F;': '/',
  '&apos;': "'",
  '&nbsp;': ' ',
  '&rsquo;': "'",
  '&laquo;': '\u00ab',
  '&raquo;': '\u00bb',
  '&hellip;': '...',
  '&eacute;': '\u00e9',
  '&egrave;': '\u00e8',
  '&agrave;': '\u00e0',
  '&ccedil;': '\u00e7',
  '&ecirc;': '\u00ea'
};

function decodeEntites(s) {
  return String(s || '')
    .replace(/&#(\d{2,5});/g, (m, n) => {
      const c = parseInt(n, 10);
      return c > 0 && c < 0x10000 ? String.fromCharCode(c) : ' ';
    })
    .replace(/&#x([0-9a-fA-F]{2,4});/g, (m, n) => {
      const c = parseInt(n, 16);
      return c > 0 && c < 0x10000 ? String.fromCharCode(c) : ' ';
    })
    .replace(
      /&(amp|lt|gt|quot|#39|#x27|#x2F|apos|nbsp|rsquo|laquo|raquo|hellip|eacute|egrave|agrave|ccedil|ecirc);/g,
      (m) => ENTITES[m] || ' '
    );
}

// Enleve le HTML code (script/style/iframe d'abord, puis toute balise) ET
// decode les entites : on ramene au texte plat, lisible. Expose pour les
// tests ; analyserResultats et lirePage s'en servent toutes les deux.
function purgerBalises(html) {
  return decodeEntites(
    String(html || '')
      .replace(/<(script|style|noscript|svg|iframe|head)\b[\s\S]*?<\/\s*\1\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function normaliserSansAccents(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u00e0\u00e2\u00e4]/g, 'a')
    .replace(/[\u00e9\u00e8\u00ea\u00eb]/g, 'e')
    .replace(/[\u00ee\u00ef]/g, 'i')
    .replace(/[\u00f4\u00f6]/g, 'o')
    .replace(/[\u00f9\u00fb\u00fc]/g, 'u')
    .replace(/\u00e7/g, 'c')
    .replace(/\u0153/g, 'oe')
    .replace(/[\u2019\u2018]/g, "'");
}

function hoteDe(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

// ============================== SSRF ==============================

// Vrai si l'hote est une cible interdite (texte prive / metadata).
function hotePrive(hote) {
  const h = String(hote || '')
    .toLowerCase()
    .trim();
  if (!h) return true;
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.internal') ||
    h.endsWith('.local')
  )
    return true;
  if (h === 'metadata.google.internal') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const o = m.slice(1).map(Number);
    // "0.0.0.0" inparsi : chaque octet doit etre un vrai nombre.
    if (o.some((x) => x > 255)) return true;
    const a = o[0];
    const b = o[1];
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata cloud
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (h.indexOf(':') >= 0) {
    const n = h.replace(/^\[|\]$/g, '');
    if (n === '::' || n === '::1') return true;
    const p = n.slice(0, 4).toLowerCase();
    // fe80::/10 link-local, fc00::/7 unique local.
    if (/^fe[89ab]/.test(p) || /^f[cd]/.test(p)) return true;
    return false;
  }
  return false;
}

// Une URL n'est lisible (par le serveur) QUE si protocole http(s) et
// destination publique.
function urlLisible(url) {
  let u = null;
  try {
    u = new URL(url);
  } catch (e) {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  return !hotePrive(u.hostname);
}

// ============================ RECHERCHE ============================

// Analyse la page de resultats html.duckduckgo.com. Expose pour tests
// (une serie de fixtures HTML remplace le vrai reseau).
function analyserResultats(html) {
  const brut = String(html || '');
  const reLiens =
    /<a[^>]+class="(?:[^"\s]*\s)?result__a(?:\s[^"\s]*)?"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const liens = [];
  let m;
  while ((m = reLiens.exec(brut)) !== null) {
    liens.push({ href: m[1], titre: decodeEntites(purgerBalises(m[2])) });
  }
  if (!liens.length) return [];
  // result__snippet : texte du resultat, dans le MEME ordre que result__a.
  const reSnips = /class="(?:[^"\s]*\s)?result__snippet(?:\s[^"\s]*)?"[^>]*>([\s\S]*?)<\/a>/g;
  const snips = [];
  while ((m = reSnips.exec(brut)) !== null) {
    snips.push(decodeEntites(purgerBalises(m[1])));
  }
  const sources = [];
  const vus = Object.create(null);
  for (let i = 0; i < liens.length; i++) {
    const url = detortillerHref(liens[i].href);
    if (!url || !/^http/i.test(url)) continue;
    if (!urlLisible(url)) continue; // jamais de page privee
    if (vus[url]) continue;
    vus[url] = true;
    sources.push({
      titre: (liens[i].titre || '').slice(0, 160),
      url: url,
      extrait: (snips[i] || '').slice(0, EXTRAITS_MAX)
    });
  }
  return sources;
}

// Une href DuckDuckGo peut etre un redirect //duckduckgo.com/l/?uddg=...
// : on la detortille vers l'URL reelle du site.
function detortillerHref(href) {
  let h = String(href || '').trim();
  if (!h) return '';
  if (h.startsWith('//')) h = 'https:' + h;
  let u = null;
  try {
    u = new URL(h, 'https://duckduckgo.com');
  } catch (e) {
    return '';
  }
  const uddg = u.searchParams.get('uddg');
  if (uddg) return decodeURIComponent(uddg);
  return h;
}

// Telechargement generique : timeout + plafond d'octets, type textuel
// uniquement. Expose pour tests.
async function telecharger(url) {
  const ctrl = new AbortController();
  const temps = setTimeout(() => ctrl.abort(), DELAI_REPONSE_MS);
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html, text/plain;q=0.9, */*;q=0.1'
      },
      signal: ctrl.signal,
      redirect: 'follow'
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    const typeLisible =
      ctype.indexOf('text/html') >= 0 ||
      ctype.indexOf('text/plain') >= 0 ||
      ctype.indexOf('xhtml') >= 0;
    if (!typeLisible)
      throw new Error('type non lisible : ' + (ctype.split(';')[0] || ctype || 'inconnu'));
    const lecteur = r.body && r.body.getReader ? r.body.getReader() : null;
    if (!lecteur) {
      return (await r.text()).slice(0, TAILLE_MAX_REPONSE);
    }
    const deco = new TextDecoder('utf-8', { fatal: false });
    let lu = '';
    let octets = 0;
    while (true) {
      const morceau = await lecteur.read();
      if (morceau.done) break;
      if (morceau.value && morceau.value.length) {
        octets += morceau.value.length;
        lu += deco.decode(morceau.value, { stream: true });
      }
      if (octets >= TAILLE_MAX_REPONSE) {
        try {
          lecteur.cancel();
        } catch (e2) {}
        break;
      }
    }
    return lu;
  } finally {
    clearTimeout(temps);
  }
}

async function lirePage(url) {
  const brut = await telecharger(url);
  return purgerBalises(brut).slice(0, PAGE_TXT_MAX);
}

// La recherche elle-meme. options : nb (max resultats, def 5),
// lire (nb de pages lues en entier, def 4, 0 = extraits seuls).
async function rechercheWeb(sujet, options) {
  const opts = options || {};
  const question = String(sujet || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  const r = {
    sujet: question,
    date: new Date().toISOString(),
    sources: [],
    pages: [],
    remarque: ''
  };
  if (question.length < 2) {
    r.remarque = 'sujet trop court';
    return r;
  }
  const qUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(question);
  let htmlRecherche = '';
  try {
    htmlRecherche = await telecharger(qUrl);
  } catch (e) {
    r.remarque = 'recherche indisponible (' + ((e && e.message) || e) + ')';
    return r;
  }
  if (/anomaly|captcha/i.test(htmlRecherche)) {
    // Le message "anomaly detected" est celui des pages anti-bot DDG ; le
    // mot "captcha" ne se trouve (en pratique) que dans ces pages.
    r.remarque = 'recherche temporairement bloquee par DuckDuckGo (anti-bot)';
    return r;
  }
  r.sources = analyserResultats(htmlRecherche);
  if (!r.sources.length) {
    r.remarque = 'aucune source';
    return r;
  }
  r.sources = r.sources.slice(0, Math.max(1, Math.min(opts.nb || 5, r.sources.length)));
  const nbPages = Math.max(0, Math.min(opts.lire === undefined ? 4 : opts.lire, r.sources.length));
  for (let i = 0; i < nbPages; i++) {
    try {
      const txt = await lirePage(r.sources[i].url);
      if (txt && txt.length > 400) r.pages.push({ url: r.sources[i].url, texte: txt });
    } catch (e) {
      // Page morte, lente ou non textuelle : on continue avec les suivantes.
    }
  }
  return r;
}

// ==================== MISE EN FORME POUR LE PROMPT ====================

function pourPrompt(recherche) {
  if (!recherche || !recherche.sources || !recherche.sources.length) return '';
  const d = new Date(recherche.date || Date.now());
  const quand =
    String(d.getDate()).padStart(2, '0') +
    '/' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '/' +
    d.getFullYear() +
    ' ' +
    String(d.getHours()).padStart(2, '0') +
    'h' +
    String(d.getMinutes()).padStart(2, '0');
  const lignes = [];
  lignes.push('RECHERCHE WEB (effectuee le ' + quand + ') sur "' + recherche.sujet + '" :');
  recherche.sources.forEach((s, i) => {
    const hote = hoteDe(s.url);
    lignes.push(
      i +
        1 +
        '. ' +
        (s.titre || '(sans titre)') +
        (hote ? ' [' + hote + ']' : '') +
        (s.extrait ? ' - ' + s.extrait : '')
    );
  });
  (recherche.pages || []).forEach((p) => {
    lignes.push('--- TEXTE LU SUR ' + p.url + ' : ' + p.texte);
  });
  lignes.push(
    'Consignes : appuie-toi sur ces sources pour repondre, cite le site entre crochets quand tu utilises une info d ici. Si aucune source ne repond a la demande, dis-le honnetement - n invente RIEN. Ne donne jamais un chiffre absent des sources.'
  );
  let bloc = lignes.join('\n');
  if (bloc.length > BLOC_MAX)
    bloc = bloc.slice(0, BLOC_MAX) + ' ...\n(bloc deja riche : ne recite pas tout)';
  return bloc;
}

// ====================== APPRENTISSAGE DE FAITS =======================

// 2 faits maximum par recherche, dedupliques par site, de la forme
// "subject - titre. extrait (source: hote, date)" : ils rentrent dans le
// savoir via savoirEnregistrer (categorie 'recherche-web', source 'web').
// Un extrait de moins de 60 caracteres est un fragment : on ne l'apprend
// pas (un fait mal compose est pire qu'un fait manquant).
function faitsAPrendre(recherche) {
  const faits = [];
  if (!recherche || !recherche.sources || !recherche.sources.length) return faits;
  const cle = String(recherche.sujet || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
  if (cle.length < 3) return faits;
  const du = (recherche.date ? new Date(recherche.date) : new Date()).toISOString().slice(0, 10);
  const vus = Object.create(null);
  for (let i = 0; i < recherche.sources.length && faits.length < 2; i++) {
    const s = recherche.sources[i];
    const hote = hoteDe(s.url) || 'web';
    if (vus[hote]) continue;
    vus[hote] = true;
    const extrait = String(s.extrait || '').trim();
    if (extrait.length < 60) continue;
    const texte =
      ((s.titre ? s.titre.replace(/\s+\.$/, '') + '. ' : '') + extrait)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300) +
      ' (source: ' +
      hote +
      ', ' +
      du +
      ')';
    faits.push({ cle: cle, reponse: texte });
  }
  return faits;
}

// =========================== DECLENCHEMENTS ==========================

// "/cherche <sujet>" : recherche FORCEE sur demande explicite du visiteur.
function commandeWeb(texte) {
  const m = String(texte || '')
    .trim()
    .match(/^\/cherche\s+([\s\S]{2,300})$/i);
  if (!m) return null;
  return { sujet: m[1].trim() };
}

// Auto-declenchement : volontairement PLUS ETROIT que le regex de
// gemini.js (lui declenche google_search facture ; ici on ne facture
// rien mais chaque auto ajoute 1-3 s). Les echanges personnels ne
// doivent JAMAIS declencher : on ne garde que les demandes d'info sans
// pronom personnel.
function demandeWebEvidente(texte) {
  const t = normaliserSansAccents(texte);
  if (/\b(j'|je\b|tu\b|mon\b|ma\b|mes\b|notre\b|nos\b)\b/.test(t)) return false;
  if (t.length < 8) return false;
  return (
    /\b(actualite|actualites|dernieres? infos?|dernieres? nouvelles?|nouvelles du|en ce moment|quoi de neuf|breaking|meteo|elections?|resultats? des elections|qui a gagne|gagne(r)? (le|la|l')?(match|election|coupe)|ligue des champions|coupe du monde|cours (du|de la|des)? (bourse|bitcoin|crypto|action)|nouveau(x)? (film|album|episode)|bande.?annonce)\b/.test(
      t
    ) ||
    /\b(recherche(r|z)?( web)?|info(rmation)?s?|trouve(r)?) (sur|a propos de|internet)\b/.test(t)
  );
}

function creerRechercheWeb(opts) {
  // --- Cache des sujets deja cherches ----------------------------------
  // Deux visiteurs qui posent le meme sujet dans l'heure ne doivent pas
  // re-telecharger les memes pages ni re-payer les tokens du bloc web.
  // Cle = sujet normalise + options (nb/lire, car passer de l'auto aux
  // 4 pages de /cherche EST une autre recherche). Seuls les resultats
  // AVEC sources (les echecs, marques par une remarque, ne se cachent
  // pas) entrent au cache ; servi depuis le cache, le resultat garde sa
  // DATE D'ORIGINE : le modele annonce l'heure veritable de la
  // recherche, jamais une date retro-projetee.
  const cfg = opts || {};
  const cacheMs = cfg.cacheMs !== undefined ? cfg.cacheMs : 30 * 60 * 1000;
  const cacheMax = cfg.cacheMax && cfg.cacheMax >= 1 ? cfg.cacheMax : 300;
  const maintenant = cfg.maintenant || Date.now;
  const cache = new Map(); // cle -> { ecrit, r } (ordre d'insertion = plus ancien d'abord)
  let coupsCache = 0;
  let raterCache = 0;

  async function rechercheWebCache(sujet, options) {
    if (cacheMs <= 0) return rechercheWeb(sujet, options);
    const question = String(sujet || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    if (question.length < 2) return rechercheWeb(sujet, options);
    const o = options || {};
    const cle = question + '|' + (o.nb || 5) + '|' + (o.lire === undefined ? 4 : o.lire);
    const entree = cache.get(cle);
    if (entree && maintenant() - entree.ecrit < cacheMs) {
      coupsCache++;
      return entree.r;
    }
    raterCache++;
    const r = await rechercheWeb(sujet, options);
    if (r && r.sources && r.sources.length && !r.remarque) {
      cache.set(cle, { ecrit: maintenant(), r });
      // Eviction FIFO simple : la Map conserve l'ordre d'insertion.
      while (cache.size > cacheMax) cache.delete(cache.keys().next().value);
    }
    return r;
  }

  return {
    rechercheWeb: rechercheWebCache,
    pourPrompt: pourPrompt,
    faitsAPrendre: faitsAPrendre,
    commandeWeb: commandeWeb,
    demandeWebEvidente: demandeWebEvidente,
    etatCache: function () {
      return { cacheMs, cacheMax, entrees: cache.size, coupsCache, raterCache };
    }
  };
}

module.exports = {
  creerRechercheWeb: creerRechercheWeb,
  // Les morceaux purs (analyseur, garde-fou) : exposes pour les tests.
  analyserResultats: analyserResultats,
  purgerBalises: purgerBalises,
  hotePrive: hotePrive,
  urlLisible: urlLisible
};
