// =====================================================================
//  E2E reel : le VRAI server.js purge une invite au bout de INVITE_VIE_MS
// =====================================================================
//  Lancement : node tests/e2e_purge.test.js
//  Faux modele Gemini local : /send est instantane, aucun appel reseau.
//  La duree de vie est comprimee a 1 s et la ronde a 1,5 s : le cycle
//  complet est verifie sur un vrai serveur en quelques secondes —
//  /send 200 avant, puis dossier supprime, 401, pierre tombale
//  et uid-seul refuse apres l'echeance.
// =====================================================================
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const PORT = process.env.PORT_PURGE_E2E || 37777;
const PORT_MOCK = PORT + 1;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blamune-purge-e2e-'));
const mock = http.createServer((req, res) => {
  let d = '';
  req.on('data', (c) => (d += c));
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'reponse test' }] } }] }));
  });
});

function requete(chemin, methode, corps, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: chemin,
        method: methode || 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/x-www-form-urlencoded' },
          headers || {}
        )
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, texte: d }));
      }
    );
    req.on('error', reject);
    if (corps) req.write(corps);
    req.end();
  });
}

const env = Object.assign({}, process.env, {
  PORT: String(PORT),
  ADMIN_MDP: 'mot-de-passe-e2e-purge',
  API_PROVIDER: 'gemini',
  API_KEY: 'cle-de-test',
  API_MODEL: 'mock',
  API_URL: 'http://127.0.0.1:' + PORT_MOCK + '/v1beta',
  BLAMUNE_DATA_DIR: dataDir,
  // Le temps est COMPRESSE : vie d'invite 1 s, ronde 1,5 s — le vrai
  // serveur teste le cycle complet en quelques secondes.
  INVITE_VIE_MS: '1000',
  PURGE_INVITES_MS: '1500',
  RECHERCHE_WEB_AUTO: '0',
  VAPID_PRIVATE_KEY: '',
  PUSH_CHECK_MS: '3600000',
  MAX_CONC: '2'
});
const serveur = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  cwd: path.join(__dirname, '..'),
  env,
  stdio: 'pipe'
});
let journal = '';
serveur.stdout.on('data', (d) => (journal += d));
serveur.stderr.on('data', (d) => (journal += d));

(async () => {
  await new Promise((r) => mock.listen(PORT_MOCK, '127.0.0.1', r));
  for (let i = 0; i < 120; i++) {
    try {
      const r = await requete('/ping', 'GET');
      if (r.status === 200) break;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const inv = JSON.parse((await requete('/invite')).texte);
  assert.ok(inv.ok && /^inv_[0-9a-f]{24}$/.test(inv.uid), 'invite cree avec uid legal');
  const h = { 'X-UID': inv.uid, 'X-Jeton': inv.jeton };
  const avant = await requete('/send', 'POST', 'msg=bonjour', h);
  assert.ok(avant.status === 200, '/send avant l echeance doit passer, recu ' + avant.status);
  const ordi = path.join(dataDir, 'users', inv.uid);
  assert.ok(fs.existsSync(ordi), 'dossier utilisateur cree apres le premier message');
  await new Promise((r) => setTimeout(r, 6000));
  const apres = await requete('/send', 'POST', 'msg=rebonjour', h);
  assert.strictEqual(apres.status, 401, 'apres purge, /send doit refuser (401)');
  assert.ok(!fs.existsSync(ordi), 'dossier supprime par la purge');
  const invites = JSON.parse(fs.readFileSync(path.join(dataDir, 'invites.json'), 'utf8'));
  assert.ok(invites[inv.uid] && invites[inv.uid].s, 'pierre tombale posee dans invites.json');
  const retour = await requete('/send', 'POST', 'msg=sansjeton', { 'X-UID': inv.uid });
  assert.strictEqual(retour.status, 401, 'le uid seul ne ranime pas l invite purgee');
  console.log('E2E purge : ' + inv.uid + ' purge proprement (dossier, jeton+tombstone, refus).');
})()
  .catch((e) => {
    console.log('ECHEC E2E purge : ' + e.message);
    console.log('--- journal serveur ---\n' + journal.slice(-1500));
    process.exitCode = 1;
  })
  .finally(() => {
    serveur.kill();
    mock.close();
    setTimeout(() => process.exit(process.exitCode || 0), 1500);
  });
