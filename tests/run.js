// Tests d'integration BLAMUNE.
// Lance le VRAI server.js avec :
//   - un faux modele Gemini local (aucun appel internet, aucune cle requise),
//   - un dossier de donnees temporaire (aucune touche aux vraies donnees).
//
//   node tests/run.js        ou    npm test
//
// Couvre : decouverte du modele (URL), apprentissage mode 2, reprise sur
// quota (429), historique compact, journal des erreurs, compat ancien API_URL.

const assert = require('assert');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const PORT_APP = librePort();
const PORT_MOCK = librePort();
const BASE_MOCK = `http://127.0.0.1:${PORT_MOCK}/v1beta`;

let appels = 0;
let failProchain = false;
let derniereRequete = null;

function librePort() {
  return 20000 + Math.floor(Math.random() * 20000);
}

function attendre(ms) { return new Promise(r => setTimeout(r, ms)); }

function requete(port, chemin, methode, corps, headers) {
  return new Promise((resolve, reject) => {
    const options = {
      host: '127.0.0.1', port, path: chemin, method: methode || 'POST',
      headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {})
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, texte: data, json });
      });
    });
    req.on('error', reject);
    if (corps) req.write(corps);
    req.end();
  });
}

async function attendreServeur(port, essais) {
  for (let i = 0; i < (essais || 60); i++) {
    try {
      const r = await requete(port, '/ping', 'GET');
      if (r.status === 200) return true;
    } catch (e) {}
    await attendre(250);
  }
  throw new Error('Le serveur ne repond pas sur le port ' + port);
}

// ---- Faux Gemini : renvoie un texte simple et note le prompt recu ----
const mock = http.createServer((req, res) => {
  let data = '';
  req.on('data', c => data += c);
  req.on('end', () => {
    appels++;
    if (failProchain) {
      failProchain = false;
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'quota depasse (test)' } }));
      return;
    }
    try { derniereRequete = JSON.parse(data); } catch (e) {}
    const texte = 'Reponse test ' + appels;
    const paquet = { candidates: [{ content: { parts: [{ text: texte }] } }] };
    if ((req.url || '').indexOf('streamGenerateContent') >= 0) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify(paquet) + '\n\n');
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(paquet));
    }
  });
});

function envoiFils(pid, code) {
  return new Promise(resolve => {
    if (!pid || pid.exitCode !== null) return resolve();
    pid.on('exit', () => resolve());
    pid.kill();
    setTimeout(resolve, 3000);
  });
}

function promptTexte() {
  return derniereRequete && derniereRequete.contents
    ? JSON.stringify(derniereRequete.contents) : '';
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blamune-test-'));
  await new Promise(r => mock.listen(PORT_MOCK, '127.0.0.1', r));

  const env = Object.assign({}, process.env, {
    PORT: String(PORT_APP),
    API_KEY: 'cle-de-test',
    API_PROVIDER: 'gemini',
    API_MODEL: 'modele-test',
    API_URL: BASE_MOCK,
    BLAMUNE_DATA_DIR: dataDir
  });
  const serveur = spawn(process.execPath, [path.join(RACINE, 'server.js')],
    { cwd: RACINE, env, stdio: 'pipe' });
  let journal = '';
  serveur.stdout.on('data', d => journal += d);
  serveur.stderr.on('data', d => journal += d);

  const ok = [];
  try {
    await attendreServeur(PORT_APP);
    ok.push('serveur demarre (modele=' + BASE_MOCK + ')');

    // 1. Invitation : uid inv_ de 96 bits
    const inv = await requete(PORT_APP, '/invite', 'POST', '');
    assert(inv.json && inv.json.ok, 'invite doit reussir');
    assert(/^inv_[0-9a-f]{24}$/.test(inv.json.uid), 'uid invite = inv_ + 96 bits, recu: ' + inv.json.uid);
    const uid = inv.json.uid;
    const h = { 'X-UID': uid };
    ok.push('invite ' + uid);

    // 2. Premier message : prompt de personnalite + contexte temps reel
    const m1 = await requete(PORT_APP, '/send', 'POST', 'msg=je%20m%27appelle%20Theo&mode=2', h);
    assert.strictEqual(m1.status, 200, 'envoi 1 en 200');
    assert(m1.json.reponses && m1.json.reponses[0].indexOf('Reponse test') >= 0, 'reponse du modele presente');
    assert(promptTexte().indexOf('CONSCIENCE DE SOI') >= 0, 'prompt BLAMUNE present');
    assert(promptTexte().indexOf('CONTEXTE TEMPS REEL') >= 0, 'contexte temps reel present');
    ok.push('prompt mode 2 construit');

    // 3. Apprentissage : le prénom dit il y a 2s est deja dans le prompt
    const m2 = await requete(PORT_APP, '/send', 'POST',
      'msg=tu%20te%20souviens%20de%20mon%20nom%20%3F&mode=2', h);
    assert.strictEqual(m2.status, 200);
    assert(promptTexte().indexOf('Theo') >= 0, 'nom appris injecte dans le prompt');
    assert(promptTexte().indexOf('INFOS SUR L\'UTILISATEUR') >= 0, 'bloc profil present');
    ok.push('apprentissage immediat (Theo dans le prompt)');

    // 4. Reprise sur quota : 429 puis succes
    const avant = appels;
    failProchain = true;
    const m3 = await requete(PORT_APP, '/send', 'POST', 'msg=ca%20va%20%3F&mode=2', h);
    assert.strictEqual(m3.status, 200, 'reponse apres 429');
    assert(m3.json.reponses && m3.json.reponses[0].indexOf('Reponse test') >= 0, 'texte present apres reprise');
    assert(appels - avant >= 2, 'la requete a ete retentee');
    ok.push('reprise sur 429 (2 appels)');

    // 5. Historique compact
    const fHist = path.join(dataDir, 'users', uid, 'historique_mode2.json');
    assert(fs.existsSync(fHist), 'historique ecrit sur disque');
    const brut = fs.readFileSync(fHist, 'utf8');
    assert(brut.indexOf('\n  {') < 0, 'historique compact (sans indentation)');
    assert(JSON.parse(brut).length >= 3, 'historique lisible');
    ok.push('historique compact');

    // 6. Mode 1 (EGO) fonctionne aussi
    const e1 = await requete(PORT_APP, '/send', 'POST', 'msg=salut&mode=1', h);
    assert.strictEqual(e1.status, 200);
    ok.push('mode 1 EGO ok');

    // 7. Journal des erreurs : visible par l'admin
    const login = await requete(PORT_APP, '/login', 'POST', 'pseudo=admin&mdp=%40clotaire%232012');
    assert(login.json && login.json.ok, 'login admin: ' + login.texte.substring(0, 120));
    const logs = await requete(PORT_APP, '/admin/logs', 'GET', null,
      { 'X-UID': login.json.uid, 'X-EGO': login.json.ego });
    assert.strictEqual(logs.status, 200, 'lecture des logs admin');
    assert(Array.isArray(logs.json.lignes), 'logs en tableau');
    ok.push('journal erreurs: ' + logs.json.lignes.length + ' ligne(s)');

    // 8. Fichiers sensibles non servis
    const fuite = await requete(PORT_APP, '/logs/erreurs.log', 'GET');
    assert.strictEqual(fuite.status, 404, 'logs non servis en public');
    ok.push('logs non exposes publiquement');

    // 9. Compat : ancien format API_URL (URL complete avec :generateContent)
    const port2 = librePort();
    const env2 = Object.assign({}, env, { PORT: String(port2),
      API_URL: BASE_MOCK + '/models/modele-test:generateContent' });
    const serveur2 = spawn(process.execPath, [path.join(RACINE, 'server.js')],
      { cwd: RACINE, env: env2, stdio: 'pipe' });
    try {
      await attendreServeur(port2);
      const inv2 = await requete(port2, '/invite', 'POST', '');
      const m4 = await requete(port2, '/send', 'POST', 'msg=bonjour&mode=2',
        { 'X-UID': inv2.json.uid });
      assert.strictEqual(m4.status, 200, 'ancien API_URL accepte');
      assert(m4.json.reponses && m4.json.reponses[0].indexOf('Reponse test') >= 0);
      ok.push('ancien API_URL (URL complete) accepte');
    } finally {
      await envoiFils(serveur2);
    }

    console.log('\nOK  ' + ok.length + ' verifications :');
    ok.forEach(l => console.log('  - ' + l));
    console.log('');
  } catch (e) {
    console.error('\nECHEC : ' + e.message);
    if (journal) console.error('\n--- journal serveur ---\n' + journal.slice(-3000));
    process.exitCode = 1;
  } finally {
    await envoiFils(serveur);
    mock.close();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
  }
}

main();
