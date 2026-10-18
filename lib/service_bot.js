// =====================================================================
//  Service du bot C++ (local sous Windows, conteneur sous Linux)
// =====================================================================
//  Sur le serveur cloud, le bot C++ tourne dans un conteneur voisin
//  expose sur BOT_SERVICE_URL. Il repond avec son moteur de regles local
//  quand l'IA (Ollama ou fournisseur en ligne) est indisponible ou trop
//  lente. Communication en HTTP direct sur le reseau Docker interne :
//  aucun aller-retour public, donc aucune latence ajoutee.
//
//  requeterHttp : promesse de corps complet (par opposition au transport
//  en flux de lib/ia/gemini.js). Il est partage : les embeddings Gemini
//  (lib/ia/embeddings.js) et le service bot l'utilisent tous les deux,
//  c'est pourquoi il vit a ce niveau et non dans un des deux modules.
//
//  Le cache LRU evite de redemander les memes reponses toutes faites
//  ("salut", "merci", "ca va") au meme moteur de regles : le premier
//  rappel part du disque, les suivants ne coutent rien.
// =====================================================================
'use strict';

const http = require('http');
const https = require('https');

function creerServiceBot({ loggerErreur }) {
  const BOT_SERVICE_URL = String(process.env.BOT_SERVICE_URL || '').replace(/\/+$/, '');
  const BOT_SERVICE_TIMEOUT = parseInt(process.env.BOT_SERVICE_TIMEOUT_MS || '', 10) || 6000;

  // Petit cache : les messages identiques recurrents (salut, merci, ca va)
  // redemandent systematiquement la meme reponse au bot local.
  const cacheBot = new Map();
  const CACHE_BOT_MAX = 500;
  const CACHE_BOT_VIE_MS = 300000;

  function cacheBotLire(cle) {
    const entree = cacheBot.get(cle);
    if (!entree) return '';
    if (Date.now() - entree.date > CACHE_BOT_VIE_MS) {
      cacheBot.delete(cle);
      return '';
    }
    cacheBot.set(cle, { date: Date.now(), rep: entree.rep }); // rafraichit le LRU
    return entree.rep;
  }

  function cacheBotEcrire(cle, rep) {
    if (!cle || !rep) return;
    if (cacheBot.size >= CACHE_BOT_MAX) {
      // Eviction du plus ancien element insere (la Map garde l'ordre).
      const premier = cacheBot.keys().next().value;
      cacheBot.delete(premier);
    }
    cacheBot.set(cle, { date: Date.now(), rep });
  }

  function requeterHttp(url, options, timeoutMs) {
    return new Promise((resolve, reject) => {
      const cible = new URL(url);
      const mod = cible.protocol === 'https:' ? https : http;
      const req = mod.request(
        {
          protocol: cible.protocol,
          hostname: cible.hostname,
          port: cible.port || (cible.protocol === 'https:' ? 443 : 80),
          path: cible.pathname + cible.search,
          method: options.method || 'GET',
          headers: options.headers || {}
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              const err = new Error('HTTP ' + res.statusCode);
              err.statusCode = res.statusCode;
              return reject(err);
            }
            resolve(data);
          });
        }
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Timeout'));
      });
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  // Interroge le bot C++ local. Renvoie "" si le service est absent ou muet :
  // l'appelant garde alors son propre repli.
  async function appelerBotLocal(message) {
    if (!BOT_SERVICE_URL || !message) return '';
    const cle = String(message).toLowerCase().trim().slice(0, 300);
    const cache = cacheBotLire(cle);
    if (cache) return cache;
    try {
      const corps = JSON.stringify({ message: String(message).slice(0, 2000) });
      const brut = await requeterHttp(
        BOT_SERVICE_URL + '/respond',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(corps)
          },
          body: corps
        },
        BOT_SERVICE_TIMEOUT
      );
      const json = JSON.parse(brut);
      const rep = json && typeof json.reponse === 'string' ? json.reponse.trim() : '';
      if (rep) cacheBotEcrire(cle, rep);
      return rep;
    } catch (e) {
      loggerErreur('bot-local', e.message);
      return '';
    }
  }

  return {
    configurer: BOT_SERVICE_URL,
    cacheTaille: () => cacheBot.size,
    cacheLire: cacheBotLire,
    requeterHttp,
    appelerBotLocal
  };
}

module.exports = { creerServiceBot };
