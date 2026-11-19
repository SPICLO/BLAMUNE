// =====================================================================
//  Transport vers tout fournisseur compatible OpenAI
// =====================================================================
//  Format "chat/completions" : meme corps et meme reponse que l'API OpenAI.
//  Couvre Groq, OpenRouter, Ollama, LM Studio, vLLM, Mistral, DeepSeek,
//  Eden AI, NVIDIA NIM, et tout endpoint declare par API_POOL.
//
//  Deux cascades vivent ici :
//
//  - secours disponibles (aSecours, des qu'UN membre existe) : cascade
//    MULTI-fournisseur (principal, puis les membres d'API_POOL
//    disponibles). Un membre mort part en cooldown, un revenu redevient
//    prioritaire (sticky) ;
//  - sinon : cascade historique d'UN fournisseur (ordreModeles()).
//
//  Le drapeau err.fluxEntame est crucial : si le client a deja recu une
//  goutte de texte, aucune rotation de fournisseur n'est permise — il
//  afficherait deux reponses. Dans ce cas on rethrowe tel quel.
//
//  Extractions des dependances, dans l'esprit de lib/ia/gemini.js :
//  config est capture par reference (muted par /config-api, jamais
//  reassigne) ; pool peut etre fourni par getter avant sa creation ou
//  directement une fois instancie.
// =====================================================================
'use strict';

// La detection de quota est partagee avec le transport Gemini : elle vit
// dans lib/ia/gemini.js (fonction pure, aucun etat).
const { estQuota, estQuotaTokens, retryApresDepuisEnTete } = require('./gemini');
// Estimation locale (budget de contexte + repli quand le fournisseur ne
// renvoie pas d'usage exploitable), et meme politique de reduction que le
// chemin Gemini (fenetre plus courte + bloc web retire avant de reessayer).
const {
  estimerMessages,
  estimerTexte,
  budgetCourant,
  budgetReduit,
  plafondSortie,
  retirerBlocWeb,
  BUDGET_ENTREE_MIN,
  BUDGET_ENTREE_ECO_TOKENS
} = require('../tokens');

function creerOpenai({
  getConfig, // () => config vivant (proprietes mutees, objet jamais reassigne)
  getPool, // () => pool multi-fournisseur
  requeter, // transport http/https fourni par lib/ia/gemini.js
  limiterHisto, // troncature de l'historique envoyee au modele
  // Fenetre par budget de tokens (lib/ia/gemini.js) : remplace le comptage
  // en messages. Absent (tests isoles) : limiterHisto/nbEchanges.
  fenetrerHisto,
  HISTO_API_MAX,
  // () => nombre d'echanges a envoyer : 16, ou 6 sous tension/eco
  // (lib/ia/gemini.js). Absent : HISTO_API_MAX (compat tests existants).
  nbEchanges,
  marquerQuota,
  resoudreAlertes,
  memoriserModeleOk,
  ordreModeles,
  delaiIndique,
  alerter,
  loggerErreur
}) {
  const config = getConfig();

  function baseOpenAI() {
    let u = String(config.api_url || '')
      .trim()
      .replace(/\/+$/, '');
    if (!u) return 'https://api.openai.com/v1';
    return u.replace(/\/chat\/completions$/i, '');
  }

  // Les en-tetes (Bearer facultatif pour Ollama, timeout) sont concus PAR
  // MEMBRE dans openAIRequete() depuis le pool multi-fournisseur : l'URL et
  // la cle d'un membre du pool n'ont rien a voir avec celle du principal.
  function construireMessages(histo, imageParts) {
    const messages = [];
    for (const h of histo) {
      if (!h || !h.content) continue; // system vide du mode normal BLAMUNE
      const role = h.role === 'assistant' ? 'assistant' : h.role === 'system' ? 'system' : 'user';
      messages.push({ role, content: h.content });
    }
    if (imageParts) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          messages[i] = {
            role: 'user',
            content: [
              { type: 'text', text: messages[i].content || '(photo)' },
              {
                type: 'image_url',
                image_url: {
                  url: 'data:' + imageParts.mime_type + ';base64,' + imageParts.data
                }
              }
            ]
          };
          break;
        }
      }
    }
    return messages;
  }

  // Dernier message utilisateur en texte brut (la photo arrive sous forme
  // de parts) : sert au plafond de sortie adaptatif, comme cote Gemini.
  function dernierTexteUtilisateur(messages) {
    if (!Array.isArray(messages)) return '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m || m.role !== 'user') continue;
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((p) => p && typeof p.text === 'string')
          .map((p) => p.text)
          .join('\n');
      }
    }
    return '';
  }

  // Un appel unique. onDelta optionnel : fourni = reponse en flux (SSE).
  // membreOuModele accepte deux formes :
  //   - un STRING (nom de modele) : l'URL et la cle viennent de config
  //     (chemin historique : cascade de modeles d'UN fournisseur) ;
  //   - un MEMBRE de pool { nom, url, cle, modele } : tout vient du membre
  //     (cascade MULTI-fournisseur).
  // En cas d'echec, err.fluxEntame indique si le client a deja recu du texte :
  // pas de rotation possible alors, le client afficherait deux reponses.
  function openAIRequete(membreOuModele, messages, onDelta, surUsage) {
    const membre =
      typeof membreOuModele === 'string'
        ? { nom: 'principal', url: baseOpenAI(), cle: config.api_key, modele: membreOuModele }
        : membreOuModele;
    const url = String(membre.url || '').replace(/\/+$/, '') + '/chat/completions';
    const enFlux = typeof onDelta === 'function';
    // Mesure reelle quand le fournisseur la donne ; sinon on retombe sur
    // l'estimation locale (jamais silencieux : `estime: true` le dit).
    let vuUsage = false;
    const noterUsage = (usage) => {
      if (!usage || typeof surUsage !== 'function') return;
      const entree = Number(usage.prompt_tokens || usage.entree || 0);
      const sortie = Number(usage.completion_tokens || usage.sortie || 0);
      if (!entree && !sortie) return;
      vuUsage = true;
      const u = { entree, sortie, total: Number(usage.total_tokens) || entree + sortie };
      // Meme lecture que cote Gemini : les passerelles OpenAI-compatibles
      // signalent les tokens servis par le cache dans
      // `prompt_tokens_details.cached_tokens`. Absent = 0, et on n'ajoute
      // pas la cle (la forme des mesures ne change pas).
      const cache = Number(
        (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) ||
          usage.cached_tokens ||
          0
      );
      if (cache > 0) u.cache = cache;
      try {
        surUsage(u);
      } catch (e) {}
    };
    const corpsObj = {
      model: membre.modele,
      messages,
      // Plafond adapte a la demande (lib/tokens.js) : le prompt impose
      // "1 a 3 phrases", 1024 tokens n'est utile que pour un livrable.
      max_tokens: plafondSortie(dernierTexteUtilisateur(messages), config.api_max_tokens),
      temperature: config.api_temperature,
      stream: enFlux
    };
    // `stream_options.include_usage` n'est pas universel (certains proxys
    // OpenAI-compatibles le refusent en 400). Opt-in explicite : sans lui,
    // le flux reste inchange et on mesure par estimation.
    if (enFlux && process.env.USAGE_STREAM === '1') {
      corpsObj.stream_options = { include_usage: true };
    }
    const corps = JSON.stringify(corpsObj);
    const entreeEstimee = estimerMessages(messages);
    const finir = (texte) => {
      if (!vuUsage && typeof surUsage === 'function') {
        try {
          surUsage({
            entree: entreeEstimee,
            sortie: estimerTexte(texte),
            estime: true
          });
        } catch (e) {}
      }
      return texte;
    };
    const headers = { 'Content-Type': 'application/json' };
    if (membre.cle) headers['Authorization'] = 'Bearer ' + membre.cle;
    const options = { method: 'POST', headers, timeout: 20000 };
    let fluxFait = false;
    const promesse = new Promise((resolve, reject) => {
      const req = requeter(url, options, (res) => {
        if (res.statusCode !== 200) {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            const err = new Error('HTTP ' + res.statusCode + ' ' + data.substring(0, 200));
            err.statusCode = res.statusCode;
            // En-tete Retry-After (lib/ia/gemini.js) : le cascade note les
            // cooldowns et delaiIndique() lit l'attente reelle du membre.
            err.retryAfterMs = retryApresDepuisEnTete(res.headers && res.headers['retry-after']);
            reject(err);
          });
          res.resume();
          return;
        }
        if (!enFlux) {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.error) throw new Error(json.error.message || 'erreur API');
              noterUsage(json.usage);
              const choix = (json.choices && json.choices[0]) || {};
              resolve(finir((choix.message && choix.message.content) || choix.text || ''));
            } catch (e) {
              reject(e);
            }
          });
          return;
        }
        let tampon = '';
        let texte = '';
        let fini = false;
        res.setEncoding('utf8');
        res.on('data', (morceau) => {
          if (fini) return;
          tampon += morceau;
          const lignes = tampon.split('\n');
          tampon = lignes.pop();
          for (const ligne of lignes) {
            if (ligne.substring(0, 5) !== 'data:') continue;
            const brut = ligne.substring(5).trim();
            if (!brut || brut === '[DONE]') continue;
            let json;
            try {
              json = JSON.parse(brut);
            } catch (e) {
              continue;
            }
            if (json.error) {
              fini = true;
              reject(new Error(json.error.message || 'erreur API'));
              return;
            }
            if (json.usage) noterUsage(json.usage);
            const delta = (json.choices && json.choices[0] && json.choices[0].delta) || {};
            if (delta.content) {
              fluxFait = true;
              texte += delta.content;
              try {
                onDelta(texte);
              } catch (e) {}
            }
          }
        });
        res.on('end', () => {
          if (!fini) {
            fini = true;
            resolve(finir(texte));
          }
        });
        res.on('error', (e) => {
          if (!fini) {
            fini = true;
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      req.write(corps);
      req.end();
    });
    return promesse.catch((e) => {
      try {
        e.fluxEntame = fluxFait;
      } catch (x) {}
      throw e;
    });
  }

  // Cascade pour le mode compatible OpenAI.
  // Secours disponibles : tentatives dans l'ordre() du pool — principal
  // d'abord, puis les membres d'API_POOL (cooldown auto sur 429/401/403/5xx,
  // sticky sur celui qui repond) ; le drapeau quota global sert aux taches
  // de fond (reporterTache), on le tient a jour au passage du 429. Si le
  // client a deja recu du texte (fluxEntame), plus aucune rotation : on
  // rethrowe sans polluer un autre fournisseur.
  // Aucun secours : comportement historique (cascade de modeles d'UN
  // fournisseur, ordreModeles()).
  async function appelerOpenAI(message, histo, onDelta, imageParts, surUsage, options) {
    // Symetrie d'API avec appelerGemini (l'histo porte deja le message) :
    // on garde le parametre pour que les deux cassettes restent interchangeables.
    // La fenetre est un BUDGET DE TOKENS (5 000, 3 000 en eco) : dix
    // messages courts ne pesent pas autant que dix messages denses.
    const opt = options || {};
    const suivi = opt.suivi || null;
    let budgetEntree = opt.budget || budgetCourant(false);
    let sansWeb = !!opt.sansWeb;
    let reductions = 0;

    const fenetrer = () => {
      const h = sansWeb ? retirerBlocWeb(histo) : histo;
      if (typeof fenetrerHisto !== 'function')
        return limiterHisto(h, typeof nbEchanges === 'function' ? nbEchanges() : HISTO_API_MAX);
      return budgetEntree ? fenetrerHisto(h, budgetEntree) : fenetrerHisto(h);
    };
    const construire = () => construireMessages(fenetrer(), imageParts);
    let messages = construire();

    // Meme regle qu'en chemin Gemini : deux reductions au maximum par
    // message, et seulement sur un refus de quota de tokens (ou sur un 429
    // generique si la requete est deja grosse). Rejouer le meme payload sur
    // chaque membre du pool est exactement ce qui multipliait la facture.
    const doitReduire = (e) => {
      if (!e || e.statusCode !== 429) return false;
      if (reductions >= 2 || budgetEntree <= BUDGET_ENTREE_MIN) return false;
      if (estQuotaTokens(e)) return true;
      return estimerMessages(messages) > BUDGET_ENTREE_ECO_TOKENS;
    };
    const reduire = (e) => {
      budgetEntree = budgetReduit(budgetEntree);
      sansWeb = true;
      reductions++;
      messages = construire();
      if (suivi) suivi.reductions = (suivi.reductions || 0) + 1;
      loggerErreur(
        'ia',
        'quota de tokens (pool) : requete reduite a ' +
          budgetEntree +
          ' tokens (sans web) apres ' +
          String((e && e.message) || '').slice(0, 90)
      );
    };
    const pool = getPool();

    let derniereErreur = null;

    if (pool.aSecours()) {
      let arret = false;
      for (const membre of pool.ordre()) {
        // Une seconde chance par membre, UNIQUEMENT apres reduction de la
        // fenetre : sur un pool a un seul membre, sans cela un quota de
        // tokens terminait en "probleme technique" sans aucun repli.
        let reduitPourCeMembre = false;
        for (;;) {
          try {
            const texte = await openAIRequete(membre, messages, onDelta, surUsage);
            if (texte) {
              // Nom + MODELE du membre : le :diag du client pourra dire qui
              // a vraiment repondu, meme quand la voie pool ne passe pas par
              // la liste API_MODEL/API_MODELS (memoriserModeleOk les refuse).
              pool.noteOk(membre.nom, membre.modele);
              resoudreAlertes();
              return texte;
            }
            derniereErreur = new Error('Reponse vide');
            break;
          } catch (e) {
            derniereErreur = e;
            if (e && e.statusCode === 429) marquerQuota();
            loggerErreur(
              'ia',
              'pool: ' +
                membre.nom +
                ' (' +
                membre.modele +
                ') KO: ' +
                e.message +
                (e.fluxEntame ? ' [flux entame, pas de rotation]' : ' [cooldown/DAB]')
            );
            // Un flux deja commence ne peut pas etre rejoue (doublon) : la
            // reduction ne servirait qu'au membre suivant, qui n'existera pas.
            if (e && e.fluxEntame) {
              arret = true;
              break;
            }
            if (!reduitPourCeMembre && doitReduire(e)) {
              reduire(e);
              reduitPourCeMembre = true;
              continue; // meme membre, fenetre plus petite
            }
            if (doitReduire(e)) reduire(e); // membre suivant : payload deja plus petit
            pool.noteEchec(membre.nom, e);
            break;
          }
        }
        if (arret) break;
      }
      // Tous les membres en cooldown : message clair et immediat, sans
      // perdre 30 s x N membres a tours de bras.
      if (!derniereErreur) {
        derniereErreur = new Error('Pool IA : tous les fournisseurs en cooldown');
      }
    } else {
      // Comportement historique : cascade de modeles d'UN fournisseur.
      const modeles = ordreModeles();
      for (const modele of modeles) {
        let reduitPourCeModele = false;
        for (;;) {
          try {
            const texte = await openAIRequete(modele, messages, onDelta, surUsage);
            if (texte) {
              memoriserModeleOk(modele);
              resoudreAlertes();
              return texte;
            }
            derniereErreur = new Error('Reponse vide');
            break;
          } catch (e) {
            derniereErreur = e;
            const delai = delaiIndique(e);
            if (delai || (e && e.statusCode === 429)) marquerQuota();
            loggerErreur('ia', modele + ' KO: ' + e.message);
            if (e && e.fluxEntame) break;
            if (!reduitPourCeModele && doitReduire(e)) {
              reduire(e);
              reduitPourCeModele = true;
              continue; // meme modele, fenetre plus petite
            }
            if (doitReduire(e)) reduire(e); // modele suivant : payload deja plus petit
            break;
          }
        }
      }
    }

    const echec = derniereErreur ? derniereErreur.message : 'Tous les fournisseurs ont echoue';
    alerter(estQuota(derniereErreur) ? 'quota' : 'technique', echec);
    throw new Error(echec);
  }

  return { baseOpenAI, construireMessages, openAIRequete, appelerOpenAI };
}

module.exports = { creerOpenai };
