// =====================================================================
//  Configuration du fournisseur IA
// =====================================================================
//  Regroupe tout ce qui decide "quel modele, chez qui, avec quelles
//  options" : lecture de l'environnement, repli sur config.json, liste
//  des modeles de secours et memorisation du dernier modele qui a
//  repondu.
//
//  Ordre de precedence : process.env l'emporte TOUJOURS sur config.json.
//  Ce module ne connait ni stats.json ni le journal : la persistance du
//  modele actif est injectee via onModeleOk, appele uniquement quand un
//  modele repond reellement. Injecter un callback (et non l'objet stats)
//  evite au serveur d'avoir a definir son etat avant ce bloc.
//
//  Extrait de server.js.
// =====================================================================
'use strict';

const fs = require('fs');
const path = require('path');

// gemini-2.5-flash n'existe plus pour les nouveaux comptes Google
// ("no longer available to new users") : on le remplace par 3.8-flash.
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.7-flash'];

// Fournisseurs "compatibles OpenAI" : ils exposent POST {base}/chat/completions
// avec le meme format de messages que l'API OpenAI. Brancher Groq, OpenRouter,
// Ollama, LM Studio, vLLM, Mistral, DeepSeek ou Eden AI ne demande alors aucun
// code : il suffit de regler API_PROVIDER / API_URL / API_MODEL.
//
// Eden AI (`edenai`) est une passerelle multi-fournisseurs : une seule cle
// donne acces a 1 100+ modeles (OpenAI, Anthropic, Google, Meta...) via
// https://api.edenai.run/v3. Attention : c'est un service PAYANT, la cle doit
// etre accompagnee de credits sur le compte Eden.
//
// NVIDIA (`nvidia`, NIM) heberge des modeles open-source via
// https://integrate.api.nvidia.com/v1 et offre des credits gratuits a
// l'inscription sur build.nvidia.com. Les identifiants de modele sont de la
// forme "nom_editeur/nom_modele" (ex. "meta/llama-3.1-8b-instruct").
const PROVIDERS_OPENAI = [
  'openai',
  'groq',
  'openrouter',
  'ollama',
  'lmstudio',
  'vllm',
  'together',
  'mistral',
  'deepseek',
  'perplexity',
  'edenai',
  'eden',
  'nvidia',
  'nim'
];

// Modeles de secours du mode compatible OpenAI (API_MODELS, separes par virgule).
const OPENAI_FALLBACK_MODELS = String(process.env.API_MODELS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function creerConfigIA({ racine, onModeleOk, loggerErreur }) {
  const config = {
    api_provider: 'gemini',
    api_key: process.env.API_KEY || '',
    api_model: 'gemini-3.5-flash',
    // Base de l'API : on y ajoute '/models/<modele>:...' selon l'appel.
    // Accepte aussi l'URL complete (ancien format) : voir baseGemini().
    api_url: process.env.API_URL || 'https://generativelanguage.googleapis.com/v1beta',
    // Reponses courtes (1 a 5 phrases nettoyees) : inutile de laisser
    // le modele generer des milliers de tokens, ca rallonge la reponse.
    api_max_tokens: 1024,
    api_temperature: 0.7,
    // Extraction des faits par le modele (tache de fond, apres la reponse) :
    // comprend les formes que les regex ratent, au prix d'un appel modele en
    // plus par message substantiel. MEMOIRE_EXTRACTION=0 pour revenir aux
    // seules regex.
    memoire_extraction: true,
    // Recherche web (grounding Google Search) : activee uniquement quand le
    // message parle d'actualite (heuristique dans mereiteRecherche), pour ne
    // pas facturer une recherche a chaque phrase. RECHERCHE_WEB=0 pour couper.
    recherche_web: process.env.RECHERCHE_WEB !== '0'
  };

  // Dernier modele qui a repondu. Le gaspillage avant : chaque requete
  // recommencait par le modele principal (mort ou en quota) et depensait
  // 2 appels inutiles avant de trouver celui qui repondait vraiment.
  let dernierModeleOk = '';

  function providerOpenAI() {
    return PROVIDERS_OPENAI.indexOf(String(config.api_provider || '').toLowerCase()) >= 0;
  }

  // Tous les modeles utilisables, du principal au fallback.
  // La liste de secours depend du fournisseur (Gemini vs compatible OpenAI).
  function modelesConnus() {
    const secours = providerOpenAI() ? OPENAI_FALLBACK_MODELS : FALLBACK_MODELS;
    return [config.api_model, ...secours.filter((m) => m !== config.api_model)];
  }

  function modeleActif() {
    return dernierModeleOk && modelesConnus().indexOf(dernierModeleOk) >= 0
      ? dernierModeleOk
      : modelesConnus()[0];
  }

  function ordreModeles() {
    const premier = modeleActif();
    return [premier, ...modelesConnus().filter((m) => m !== premier)];
  }

  function memoriserModeleOk(modele) {
    if (!modele || modelesConnus().indexOf(modele) < 0) return;
    if (dernierModeleOk === modele) return;
    dernierModeleOk = modele;
    // La persistance est du ressort du serveur (stats.json, ecrit sur disque
    // tout de suite pour survivre a un redemarrage).
    if (onModeleOk) onModeleOk(modele);
  }

  /**
   * Reprend le dernier modele connu au demarrage ou a la restauration d'une
   * sauvegarde. Meme validation que memoriserModeleOk, mais sans rappeler
   * onModeleOk : on ne veut pas reecrire stats.json qu'on vient de lire.
   */
  function restaureModeleOk(modele) {
    if (!modele || modelesConnus().indexOf(modele) < 0) return;
    dernierModeleOk = modele;
  }

  /** Dernier modele ayant repondu, chaine vide si aucun. */
  function dernierModeleOkConnu() {
    return dernierModeleOk;
  }

  // Champs persistables depuis le panneau admin, avec la variable d'env
  // qui, si elle est definie, ecraserait l'ecriture au prochain boot.
  const CHAMPS_PERSISTANTS = {
    api_key: 'API_KEY',
    api_provider: 'API_PROVIDER',
    api_model: 'API_MODEL',
    api_url: 'API_URL'
  };

  /**
   * Ecrit dans config.json les reglages modifies par le panneau admin.
   *
   * Sans cela, /config-api ne touchait que la RAM : cle, fournisseur et
   * modele oublies a chaque redemarrage, et un admin se retrouvant en
   * coupure IA sans un mot d'explication.
   *
   * Honnetete : un champ fixe par l'ENV n'est PAS ecrit — env reste
   * prioritaire au boot, pret ne serait-ce qu'une fausse reussite
   * persistante. La reponse au panneau dit alors ce qui est parti ou non.
   */
  function persisterConfig(champs) {
    const persistes = [];
    const bloquesEnv = {};
    for (const champ of Object.keys(CHAMPS_PERSISTANTS)) {
      if (!champs || champs[champ] === undefined || champs[champ] === null) continue;
      if (process.env[CHAMPS_PERSISTANTS[champ]]) {
        bloquesEnv[champ] = CHAMPS_PERSISTANTS[champ];
        continue;
      }
      persistes.push(champ);
    }
    if (!persistes.length) return { persistes, bloquesEnv };
    let actuel = {};
    try {
      actuel = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!actuel || typeof actuel !== 'object' || Array.isArray(actuel)) actuel = {};
    } catch (e) {
      actuel = {}; // fichier absent ou corrompu : on repart propre
    }
    for (const champ of persistes) actuel[champ] = champs[champ];
    try {
      const tmp = configPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(actuel, null, 2), 'utf8');
      fs.renameSync(tmp, configPath);
    } catch (e) {
      if (loggerErreur) loggerErreur('config', 'ecriture config.json: ' + e.message);
      return { persistes: [], bloquesEnv };
    }
    return { persistes, bloquesEnv };
  }

  // ---- Environnement, puis repli sur config.json ----
  if (process.env.API_KEY) config.api_key = process.env.API_KEY;
  if (process.env.API_PROVIDER) config.api_provider = process.env.API_PROVIDER;
  if (process.env.API_MODEL) config.api_model = process.env.API_MODEL;
  if (process.env.API_URL) config.api_url = process.env.API_URL;
  if (process.env.API_MAX_TOKENS) config.api_max_tokens = parseInt(process.env.API_MAX_TOKENS);
  if (process.env.API_TEMPERATURE) config.api_temperature = parseFloat(process.env.API_TEMPERATURE);
  if (process.env.MEMOIRE_EXTRACTION)
    config.memoire_extraction = process.env.MEMOIRE_EXTRACTION !== '0';

  const configPath = path.join(racine, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      // process.env reste prioritaire : chaque cle n'est reprise que si la
      // variable correspondante n'est pas definie.
      if (cfg.api_provider && !process.env.API_PROVIDER) config.api_provider = cfg.api_provider;
      if (cfg.api_key && !process.env.API_KEY) config.api_key = cfg.api_key;
      if (cfg.api_model && !process.env.API_MODEL) config.api_model = cfg.api_model;
      if (cfg.api_url && !process.env.API_URL) config.api_url = cfg.api_url;
      if (cfg.api_max_tokens && !process.env.API_MAX_TOKENS)
        config.api_max_tokens = cfg.api_max_tokens;
      if (cfg.api_temperature && !process.env.API_TEMPERATURE)
        config.api_temperature = cfg.api_temperature;
      if (cfg.memoire_extraction !== undefined && !process.env.MEMOIRE_EXTRACTION)
        config.memoire_extraction = !!cfg.memoire_extraction;
    }
  } catch (e) {
    if (loggerErreur) loggerErreur('config', e.message);
  }

  return {
    config,
    providerOpenAI,
    modelesConnus,
    modeleActif,
    ordreModeles,
    memoriserModeleOk,
    restaureModeleOk,
    dernierModeleOkConnu,
    persisterConfig
  };
}

module.exports = { creerConfigIA, PROVIDERS_OPENAI };
