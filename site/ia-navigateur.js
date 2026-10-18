// BLAMUNE - IA embarquee dans le navigateur (WebGPU / WebLLM + palier en ligne).
// Palier de repli ULTIME : si le serveur BLAMUNE ET les APIs cote serveur
// sont injoignables, la page elle-meme retrouve une IA :
//   1. EN LIGNE (internet marche, plus le serveur) : appel direct au format
//      OpenAI vers text.pollinations.ai (GPT-OSS 20B, libre, gratuit, SANS
//      cle, CORS ouvert). Quota anonyme : 1 reponse / 30 s par IP du
//      visiteur, donc passe pour un repli individuel.
//   2. HORS LIGNE netto (plus d'internet du tout) : petit modele WebGPU
//      telecharge une fois (~450 Mo) et garde dans le cache du navigateur.
// La lib WebLLM est embarquee dans le site (site/ia-webllm.mjs) puisque la
// CSP interdit tout script externe ; pour le palier en ligne, seul
// connect-src a du etre elargi (cote server.js).
//
// Etats du moteur local : 'absent' (pas de WebGPU), 'eteint',
// 'telechargement', 'pret', 'en_cours', 'erreur'. Consulte par app.js via
// IA_NAV.etatCourant(). Le palier en ligne, lui, est sans etat : on tente,
// ou on ne tente pas (402 FREE_LIMIT si moins de 30 s se sont ecoulees).

var moteurNav = (function () {
  var MODELE_DEFAUT = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
  // Plus bon en francais mais ~2x plus lourd ; experimenteurs seulement :
  // localStorage.setItem('blamune_ia_nav_modele', 'Llama-3.2-1B-Instruct-q4f16_1-MLC')
  var MODELE_ALT_OK = ['Qwen2.5-0.5B-Instruct-q4f16_1-MLC', 'Llama-3.2-1B-Instruct-q4f16_1-MLC'];

  var ETAT_ABSENT = 'absent';
  var ETAT_ETEINT = 'eteint';
  var ETAT_TELE = 'telechargement';
  var ETAT_PRET = 'pret';
  var ETAT_EN_COURS = 'en_cours';
  var ETAT_ERREUR = 'erreur';

  var etat = webgpuDisponible() ? ETAT_ETEINT : ETAT_ABSENT;
  var moteur = null;
  var libChargee = null;

  // Personnalite locale : version condensee de personnalite.txt. Le modele
  // n'a ni Memoire ni savoir.db : il improvise, d'ou le cadre strict.
  var PERSONNALITE = [
    'Tu es BLAMUNE, un ami chaleureux qui parle francais avec le visiteur.',
    'Reponds toujours en francais, en 1 a 3 phrases courtes et vivantes.',
    'Ton : complice, positif, un peu espiegle. Pose parfois une petite',
    'question pour relancer la conversation. Tu navigues sans internet :',
    'si la question demande une info recente ou exacte, dis-le franchement',
    'plutot que d inventer. Pas de listes, pas de markdown, juste du texte.'
  ].join(' ');

  function webgpuDisponible() {
    try {
      return typeof navigator !== 'undefined' && !!navigator.gpu;
    } catch (e) {
      return false;
    }
  }

  function modeleChoisi() {
    try {
      var c = localStorage.getItem('blamune_ia_nav_modele');
      if (c && MODELE_ALT_OK.indexOf(c) >= 0) return c;
    } catch (e) {}
    return MODELE_DEFAUT;
  }

  function etatCourant() {
    return etat;
  }

  function moteurPret() {
    return etat === ETAT_PRET;
  }

  // Import du bundle WebLLM (seule fois ou il est charge : dynamic import,
  // donc le site demarre exactement aussi vite qu'avant sans cette feature).
  function importer() {
    if (!libChargee) {
      libChargee = import('/ia-webllm.mjs');
      libChargee.catch(function () {
        libChargee = null;
      });
    }
    return libChargee;
  }

  // Vrai si le modele a deja ete telecharge par le navig visiteur passe :
  // sans reseau, on saura repondre quand meme.
  async function enCache() {
    if (!webgpuDisponible()) return false;
    try {
      var w = await importer();
      return await w.hasModelInCache(modeleChoisi());
    } catch (e) {
      return false;
    }
  }

  // Telecharge (1ere fois) puis charge le modele en memoire GPU.
  async function activer(surProgres) {
    if (etat === ETAT_ABSENT) throw new Error('WebGPU absent sur ce navigateur');
    if (etat === ETAT_TELE) return etat;
    if (moteur) {
      etat = ETAT_PRET;
      return etat;
    }
    etat = ETAT_TELE;
    try {
      var w = await importer();
      var modele = modeleChoisi();
      moteur = await w.CreateMLCEngine(modele, {
        initProgressCallback: function (r) {
          if (typeof surProgres === 'function') surProgres(r);
        }
      });
      // Le cache GPU/WebGPU peut etre evacue sous pression disque : on
      // demande gentiment une persistance (sans bloquer si refusee).
      try {
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      } catch (e) {}
      etat = ETAT_PRET;
      return etat;
    } catch (e) {
      moteur = null;
      etat = ETAT_ERREUR;
      throw e;
    }
  }

  // Libere la GPU (par exemple pour une machine modeste). Les poids restent
  // dans le cache : reactiver sera quasi instantane.
  async function desactiver() {
    if (moteur) {
      try {
        await moteur.unload();
      } catch (e) {}
    }
    moteur = null;
    etat = webgpuDisponible() ? ETAT_ETEINT : ETAT_ABSENT;
  }

  // histo : [{ role:'user'|'assistant', content:'...' }] du plus ancien au
  // plus recent. onDelta(texteTotal) est appele a chaque fragment, meme
  // contrat que lireFlux() dans app.js : la bulle recoit toujours le texte
  // ABSOLU, jamais un fragment isol (pas de doublon possible).
  async function repondre(histo, onDelta) {
    if (etat === ETAT_ABSENT) throw new Error('WebGPU absent');
    if (!moteur) {
      await activer();
    }
    if (etat === ETAT_EN_COURS) throw new Error('IA locale deja en train de repondre');
    etat = ETAT_EN_COURS;
    var liste = Array.isArray(histo) ? histo.slice(-10) : [];
    if (liste.length === 0 || liste[liste.length - 1].role !== 'user') {
      throw new Error('IA locale : dernier message utilisateur attendu');
    }
    try {
      var messages = [{ role: 'system', content: PERSONNALITE }].concat(liste);
      var compl = await moteur.chat.completions.create({
        messages: messages,
        stream: true,
        max_tokens: 240,
        temperature: 0.85
      });
      var total = '';
      for await (var part of compl) {
        var choix = (part && part.choices && part.choices[0]) || null;
        var delta = choix && choix.delta && choix.delta.content ? choix.delta.content : '';
        if (delta) {
          total += delta;
          if (typeof onDelta === 'function') onDelta(total);
        }
      }
      if (!total.trim()) throw new Error('IA locale : reponse vide');
      etat = ETAT_PRET;
      return total;
    } catch (e) {
      etat = moteur ? ETAT_PRET : ETAT_ERREUR;
      throw e;
    }
  }

  function modeleCourant() {
    return modeleChoisi();
  }

  // ---- Palier EN LIGNE direct (depuis la page, sans serveur) ------------
  // Le service est OpenAI-compatible et CORS ouvert ; sans cle. Un modele
  // libre (gpt-oss-20b) repond ; la reflexion du modele arrive dans un
  // champ separe ('reasoning'), volontairement ignoree ici.
  var URL_EN_LIGNE = 'https://text.pollinations.ai/openai';
  var MODELE_EN_LIGNE = 'openai-fast'; // alias du tier anonyme

  async function repondreEnLigne(histo, onDelta) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('pas d internet : tente la reponse locale');
    }
    var liste = Array.isArray(histo) ? histo.slice(-10) : [];
    if (liste.length === 0 || liste[liste.length - 1].role !== 'user') {
      throw new Error('dernier message utilisateur attendu');
    }
    var messages = [{ role: 'system', content: PERSONNALITE }].concat(liste);
    var ctrl = new AbortController();
    var chrono = setTimeout(function () {
      ctrl.abort();
    }, 45000);
    try {
      var r = await fetch(URL_EN_LIGNE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODELE_EN_LIGNE,
          messages: messages,
          stream: true,
          max_tokens: 240,
          temperature: 0.85
        }),
        signal: ctrl.signal
      });
      if (r.status === 402) {
        throw new Error(
          'limite du service atteinte (1 reponse / 30 s par IP) : reessaie dans un instant'
        );
      }
      if (!r.ok) {
        throw new Error('service en ligne refuse (HTTP ' + r.status + ')');
      }
      // Chemin JSON unique (service qui ignore stream=true)
      if (!r.body || !r.body.getReader) {
        var j = await r.json();
        var m = (j && j.choices && j.choices[0] && j.choices[0].message) || null;
        var t = m && typeof m.content === 'string' ? m.content : '';
        if (!t.trim()) throw new Error('reponse vide');
        if (typeof onDelta === 'function') onDelta(t);
        return t;
      }
      // SSE au format OpenAI : "data: {...}", choices[0].delta.content.
      var lecteur = r.body.getReader();
      var decodeur = new TextDecoder();
      var tampon = '';
      var total = '';
      function traiterBloc(bloc) {
        var lignes = bloc.split('\n');
        for (var i = 0; i < lignes.length; i++) {
          var ligne = lignes[i];
          if (ligne.substring(0, 5) !== 'data:') continue;
          var brut = ligne.substring(5).trim();
          if (!brut || brut === '[DONE]') continue;
          var d;
          try {
            d = JSON.parse(brut);
          } catch (e) {
            continue;
          }
          var choix = (d && d.choices && d.choices[0]) || null;
          var frg =
            choix && choix.delta && typeof choix.delta.content === 'string'
              ? choix.delta.content
              : '';
          if (frg) {
            total += frg;
            if (typeof onDelta === 'function') onDelta(total);
          }
        }
      }
      while (true) {
        var res = await lecteur.read();
        if (res.done) break;
        tampon += decodeur.decode(res.value, { stream: true });
        var blocs = tampon.split('\n\n');
        tampon = blocs.pop();
        for (var b = 0; b < blocs.length; b++) traiterBloc(blocs[b]);
      }
      tampon += decodeur.decode();
      if (tampon.trim()) traiterBloc(tampon);
      if (!total.trim()) throw new Error('reponse vide');
      return total;
    } finally {
      clearTimeout(chrono);
    }
  }

  return {
    webgpuDisponible: webgpuDisponible,
    etatCourant: etatCourant,
    moteurPret: moteurPret,
    enCache: enCache,
    activer: activer,
    desactiver: desactiver,
    repondre: repondre,
    repondreEnLigne: repondreEnLigne,
    modeleCourant: modeleCourant,
    PERSONNALITE: PERSONNALITE
  };
})();

// Exposition sur window : app.js lit IA_NAV.* depuis un script classique
// distinct (index.html charge ia-navigateur.js avant app.js).
window.IA_NAV = moteurNav;
