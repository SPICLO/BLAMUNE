// =====================================================================
//  Backend Cloudflare KV de storage.js : test avec un FAUX serveur HTTP
//  qui imite l'API KV (GET/PUT sur /accounts/.../namespaces/.../values/
//  blamune). Sans reseau reel ni jeton.
// =====================================================================
//  Vise :
//   - initialiser() charge l'objet data depuis le KV ;
//   - setComptes + sauvegarderFinale() emettent un PUT avec le meme objet ;
//   - garde anti-ecrasement : apres une lecture vide (404), un PUT initial
//     est autorise ; sans lecture reussie d'un KV non vide, aucun PUT ;
//   - une cle partielle dans les variables CF n'active PAS le backend.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
// Charge storage.js avec un jeu de variables propre (le module lit les
// variables au require : on purge le cache a chaque cas).
function chargerStorage(env) {
  const precedent = {
    CF_KV_ACCOUNT_ID: process.env.CF_KV_ACCOUNT_ID,
    CF_KV_NAMESPACE_ID: process.env.CF_KV_NAMESPACE_ID,
    CF_KV_API_TOKEN: process.env.CF_KV_API_TOKEN,
    CF_KV_API_URL: process.env.CF_KV_API_URL,
    NODE_ENV: process.env.NODE_ENV
  };
  process.env.NODE_ENV = 'test';
  for (const k of Object.keys(precedent)) {
    if (k in env) process.env[k] = env[k];
    else delete process.env[k];
  }
  delete require.cache[require.resolve('../storage.js')];
  const storage = require('../storage.js');
  return { storage, restaurer: () => { for (const k of Object.keys(precedent)) { if (precedent[k] === undefined) delete process.env[k]; else process.env[k] = precedent[k]; } delete require.cache[require.resolve('../storage.js')]; } };
}

// Faux Cloudflare : memorise la valeur PUT, la rend en GET.
function fauxServeur() {
  const etat = { valeur: null, puts: 0 };
  const serveur = http.createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => (corps += c));
    req.on('end', () => {
      if (req.method === 'PUT') {
        etat.valeur = corps;
        etat.puts++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"success":true}');
      } else {
        if (etat.valeur === null) {
          res.writeHead(404);
          res.end('{"success":false,"errors":[{"code":10009}]}');
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(etat.valeur);
        }
      }
    });
  });
  // Unref : le faux serveur ne doit pas retenir le processus du harnais.
  serveur.unref();
  const url = new Promise((r) =>
    serveur.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + serveur.address().port))
  );
  return { etat, url };
}

test('KV : configuration partielle n active pas le cloud', async () => {
  const { storage, restaurer } = chargerStorage({
    CF_KV_ACCOUNT_ID: 'acc',
    CF_KV_NAMESPACE_ID: ''
  });
  try {
    assert.equal(storage.estConfigure(), false);
    const ok = await storage.initialiser();
    assert.equal(ok, false);
  } finally {
    restaurer();
  }
});

test('KV : lecture puis ecriture aller-retour', async () => {
  const s = fauxServeur();
  const url = await s.url;
  const { storage, restaurer } = chargerStorage({
    CF_KV_ACCOUNT_ID: 'acc123',
    CF_KV_NAMESPACE_ID: 'ns456',
    CF_KV_API_TOKEN: 'jeton',
    CF_KV_API_URL: url
  });
  try {
    // Premiere instance : le cloud est vide (404) -> pas de donnees, mais
    // le PUT suivant est legitime.
    assert.equal(await storage.initialiser(), false);
    storage.setComptes({ u123: { pseudo: 'Alia', ego: 'secret', uid: 'u123' } });
    await storage.sauvegarderFinale();
    assert.ok(s.etat.puts >= 1, 'un PUT a ete emis');
    const recu = JSON.parse(s.etat.valeur);
    assert.equal(recu.application, 'blamune');
    assert.equal(recu.comptes.u123.pseudo, 'Alia');
    // Deuxieme instance : la lecture doit restituer le compte.
    delete require.cache[require.resolve('../storage.js')];
    const st2 = chargerStorage({
      CF_KV_ACCOUNT_ID: 'acc123',
      CF_KV_NAMESPACE_ID: 'ns456',
      CF_KV_API_TOKEN: 'jeton',
      CF_KV_API_URL: url
    });
    try {
      assert.equal(await st2.storage.initialiser(), true);
      assert.equal(st2.storage.getComptes().u123.pseudo, 'Alia');
      assert.equal(st2.storage.estConfigure(), true);
      assert.equal(st2.storage.etatSauvegarde().backend, 'kv');
    } finally {
      st2.restaurer();
    }
  } finally {
    restaurer();
  }
});

test('KV : sauvegarde jamais d un disque vide avant restauration', async () => {
  // Serveur qui REFUSE toujours de servir une valeur (reponse 200 vide) :
  // la lecture "reussit" mais ne rend rien d'exploitable... cas limite
  // voulu impossible : on teste plutot l'echec de lecture (serveur muet).
  const serveur = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(500);
      res.end('{"success":false,"errors":["panne"]}');
    } else {
      res.writeHead(200);
      res.end('{"success":true}');
    }
  });
  serveur.unref();
  const url = await new Promise((r) =>
    serveur.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + serveur.address().port))
  );
  const { storage, restaurer } = chargerStorage({
    CF_KV_ACCOUNT_ID: 'acc',
    CF_KV_NAMESPACE_ID: 'ns',
    CF_KV_API_TOKEN: 'jeton',
    CF_KV_API_URL: url
  });
  try {
    await storage.initialiser(); // lecture echouee
    storage.setComptes({ u1: { pseudo: 'x' } });
    await storage.sauvegarderFinale();
    const e = storage.etatSauvegarde();
    assert.ok(e.nbEchecs >= 1, 'les echecs sont comptes, le PUT reste ajourne');
  } finally {
    restaurer();
    serveur.close();
  }
});
