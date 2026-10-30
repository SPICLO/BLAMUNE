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
const { estQuota, retryApresDepuisEnTete } = require('./gemini');

function creerOpenai({
  getConfig, // () => config vivant (proprietes mutees, objet jamais reassigne)
  getPool, // () => pool multi-fournisseur
  requeter, // transport http/https fourni par lib/ia/gemini.js
  limiterHisto, // troncature de l'historique envoye au modele
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

  // Un appel unique. onDelta optionnel : fourni = reponse en flux (SSE).
  // membreOuModele accepte deux formes :
  //   - un STRING (nom de modele) : l'URL et la cle viennent de config
  //     (chemin historique : cascade de modeles d'UN fournisseur) ;
  //   - un MEMBRE de pool { nom, url, cle, modele } : tout vient du membre
  //     (cascade MULTI-fournisseur).
  // En cas d'echec, err.fluxEntame indique si le client a deja recu du texte :
  // pas de rotation possible alors, le client afficherait deux reponses.
  function openAIRequete(membreOuModele, messages, onDelta) {
    const membre =
      typeof membreOuModele === 'string'
        ? { nom: 'principal', url: baseOpenAI(), cle: config.api_key, modele: membreOuModele }
        : membreOuModele;
    const url = String(membre.url || '').replace(/\/+$/, '') + '/chat/completions';
    const enFlux = typeof onDelta === 'function';
    const corps = JSON.stringify({
      model: membre.modele,
      messages,
      max_tokens: config.api_max_tokens,
      temperature: config.api_temperature,
      stream: enFlux
    });
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
              const choix = (json.choices && json.choices[0]) || {};
              resolve((choix.message && choix.message.content) || choix.text || '');
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
            resolve(texte);
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
  async function appelerOpenAI(message, histo, onDelta, imageParts) {
    // Symetrie d'API avec appelerGemini (l'histo porte deja le message) :
    // on garde le parametre pour que les deux cassettes restent interchangeables.
    // En tension, nbEchanges() rend 6 echanges au lieu de 16 : le prompt
    // envoye est le quota depense, allons au plus court pour repartir.
    const nbEchangesPourCetteRequete =
      typeof nbEchanges === 'function' ? nbEchanges() : HISTO_API_MAX;
    const messages = construireMessages(
      limiterHisto(histo, nbEchangesPourCetteRequete),
      imageParts
    );
    const pool = getPool();

    let derniereErreur = null;

    if (pool.aSecours()) {
      for (const membre of pool.ordre()) {
        try {
          const texte = await openAIRequete(membre, messages, onDelta);
          if (texte) {
            // Nom + MODELE du membre : le :diag du client pourra dire qui
            // a vraiment repondu, meme quand la voie pool ne passe pas par
            // la liste API_MODEL/API_MODELS (memoriserModeleOk les refuse).
            pool.noteOk(membre.nom, membre.modele);
            resoudreAlertes();
            return texte;
          }
          derniereErreur = new Error('Reponse vide');
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
          if (e && e.fluxEntame) break;
          pool.noteEchec(membre.nom, e);
        }
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
        try {
          const texte = await openAIRequete(modele, messages, onDelta);
          if (texte) {
            memoriserModeleOk(modele);
            resoudreAlertes();
            return texte;
          }
          derniereErreur = new Error('Reponse vide');
        } catch (e) {
          derniereErreur = e;
          const delai = delaiIndique(e);
          if (delai || (e && e.statusCode === 429)) marquerQuota();
          loggerErreur('ia', modele + ' KO: ' + e.message);
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
