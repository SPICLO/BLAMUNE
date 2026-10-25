// BLAMUNE - IA de secours DIRECtement depuis la page (sans serveur).
//
// Palier de repli : le serveur BLAMUNE est injoignable, mais l'internet du
// visiteur marche encore. La page appelle alors, en direct et SANS cle, un
// service libre au format OpenAI (text.pollinations.ai, CORS ouvert).
// Quota anonyme : 1 reponse / 30 s par IP — assez pour un repli individuel,
// jamais pour remplacer le serveur (par conception).
//
// L'ancien palier WebGPU/WebLLM ("IA hors-ligne", mini modele embarque de
// 6,8 Mo dans le depot, ~450 Mo telecharges par le visiteur) a ete retire :
// la memoire de BLAMUNE (savoir, resume, faits) vit cote serveur, une IA
// locale amnesiaque nem PARTIPE plus au produit. Ce fichier ne garde que ce
// qui sert encore : le palier en ligne.
//
// Sans etat : on tente, ou on ne tente pas (402 FREE_LIMIT si moins de 30 s
// se sont ecoulees du cote du service).
'use strict';

(function () {
  var URL_EN_LIGNE = 'https://text.pollinations.ai/openai';
  var MODELE_EN_LIGNE = 'openai-fast'; // alias du tier anonyme

  // Personnalite : version condensee de personnalite.txt. Ce serveur de
  // repli n'a ni Memoire ni savoir.db : il improvise, d'ou le cadre strict.
  var PERSONNALITE = [
    'Tu es BLAMUNE, un ami chaleureux qui parle francais avec le visiteur.',
    'Reponds toujours en francais, en 1 a 3 phrases courtes et vivantes.',
    'Ton : complice, positif, un peu espiegle. Pose parfois une petite',
    'question pour relancer la conversation. La reponse arrive en secours,',
    'sans serveur : si la question demande une info recente ou exacte,',
    'dis-le franchement plutot que d inventer. Pas de listes, pas de',
    'markdown, juste du texte.'
  ].join(' ');

  // histo : [{ role:'user'|'assistant', content:'...' }] du plus ancien au
  // plus recent. onDelta(texteTotal) est appele a chaque fragment, meme
  // contrat que lireFlux() dans app.js : la bulle recoit toujours le texte
  // ABSOLU, jamais un fragment isole (pas de doublon possible).
  async function repondreEnLigne(histo, onDelta) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error("pas d'internet : aucune IA de secours disponible");
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

  // Exposition sur window : app.js lit IA_Secours depuis un script classique
  // distinct (index.html charge ia-secours.js avant app.js).
  window.IA_Secours = { repondreEnLigne: repondreEnLigne, PERSONNALITE: PERSONNALITE };
})();
