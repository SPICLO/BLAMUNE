// Verification comportementale du refactor des routes.
// Demarre le VRAI server.js puis interroge chaque route : le test cherche a
// detecter une routeCapturee par un wildcard (le catcher app.get('*') doit
// rester le dernier). Un registre qui renvoie du HTML ou "Page introuvable"
// la ou on attend du JSON signale une route ombriquee.
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');

function librePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

function requete(port, chemin, methode, entetes) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port, path: chemin, method: methode || 'GET', headers: entetes || {},
    }, (res) => {
      let corps = '';
      res.on('data', d => corps += d);
      res.on('end', () => resolve({ code: res.statusCode, type: res.headers['content-type'] || '', corps }));
    });
    req.on('error', e => resolve({ code: 0, type: '', corps: String(e) }));
    req.end();
  });
}

(async () => {
  const port = await librePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blamune-smoke-'));
  // Les fichiers statiques sont servis depuis RACINE (= BLAMUNE_DATA_DIR).
  // Sans cette recopie, site/ et admin/ seraient absents du dossier de test
  // et les assertions sur les assets tomberaient a tort.
  fs.cpSync(path.join(RACINE, 'site'), path.join(dataDir, 'site'), { recursive: true });
  fs.cpSync(path.join(RACINE, 'admin'), path.join(dataDir, 'admin'), { recursive: true });
  const env = Object.assign({}, process.env, {
    NODE_ENV: 'test', PORT: String(port), BLAMUNE_DATA_DIR: dataDir,
  });
  const srv = spawn(process.execPath, [path.join(RACINE, 'server.js')],
    { cwd: RACINE, env, stdio: 'pipe' });
  let journal = '';
  srv.stdout.on('data', d => journal += d);
  srv.stderr.on('data', d => journal += d);

  // Attente du serveur
  let pret = false;
  for (let i = 0; i < 60 && !pret; i++) {
    const r = await requete(port, '/ping', 'GET');
    pret = r.code === 200;
    if (!pret) await new Promise(r => setTimeout(r, 250));
  }
  if (!pret) {
    console.log('ECHEC : le serveur ne demarre pas.\n' + journal);
    srv.kill(); process.exit(1);
  }

  // Chaque cas : chemin, methode, ce qu on attend du corps.
  // "json"  -> la route a bien ete atteinte (reponse JSON)
  // "html"  -> la route statique a bien ete atteinte
  // "404"   -> le catcher a repondu
  // "bloque"-> extension sensible refusee
  const CAS = [
    ['/ping', 'GET', 'json', 'health check'],
    ['/health', 'GET', 'json', 'keep-alive'],
    ['/connexions', 'GET', 'json', 'connexions (admin, refuse sans auth)'],
    ['/admin/data', 'GET', 'json', 'admin data (refuse sans auth)'],
    ['/admin/users', 'GET', 'json', 'admin users'],
    ['/admin/logs', 'GET', 'json', 'admin logs'],
    ['/admin/backup', 'GET', 'json', 'admin backup'],
    ['/tous-les-messages', 'GET', 'json', 'tous les messages'],
    ['/register', 'POST', 'json', 'register'],
    ['/login', 'POST', 'json', 'login'],
    ['/invite', 'POST', 'json', 'invite'],
    ['/invite/jeton', 'POST', 'json', 'migration jeton invite'],
    ['/savoir', 'POST', 'json', 'push savoir du bot local'],
    ['/logout', 'POST', 'json', 'logout'],
    ['/send', 'POST', 'json', 'envoi de message'],
    ['/historique', 'GET', 'json', 'lecture historique'],
    ['/proactif', 'GET', 'json', 'message proactif'],
    ['/stats-perso', 'GET', 'json', 'stats perso'],
    ['/mode', 'POST', 'json', 'changement de mode'],
    ['/profil', 'GET', 'json', 'profil GET'],
    ['/profil', 'POST', 'json', 'profil POST'],
    ['/stats', 'GET', 'json', 'stats admin'],
    ['/config-api', 'POST', 'json', 'config API'],
    ['/admin/restore', 'POST', 'json', 'restauration'],
    ['/admin/change-mdp', 'POST', 'json', 'changement de mdp admin'],
    ['/admin', 'GET', 'html', 'panneau admin'],
    ['/admin/admin.js', 'GET', 'js', 'asset du panneau admin'],
    ['/', 'GET', 'html', 'accueil du site'],
    ['/app.js', 'GET', 'js', 'asset du site'],
    ['/nexiste_pas', 'GET', '404', 'catcher : page inconnue'],
    ['/protection.ps1', 'GET', 'bloque', 'extension sensible refusee'],
    ['/savoir.db', 'GET', 'bloque', 'base refusee'],
  ];

  let ok = 0, ko = [];
  for (const [chemin, methode, attendu, libelle] of CAS) {
    const r = await requete(port, chemin, methode);
    let bon = false;
    if (attendu === 'json') bon = r.type.includes('application/json');
    else if (attendu === 'html') bon = r.type.includes('text/html');
    else if (attendu === 'js') bon = r.type.includes('javascript');
    else if (attendu === '404') bon = r.code === 404 && /introuvable/i.test(r.corps);
    else if (attendu === 'bloque') bon = r.code === 404 && /Non autorise/i.test(r.corps);
    if (bon) { ok++; console.log('  [OK ] ' + libelle.padEnd(36) + chemin); }
    else {
      ko.push(libelle + ' (' + chemin + ')');
      console.log('  [KO ] ' + libelle.padEnd(36) + chemin +
        ' -> ' + r.code + ' ' + r.type + ' | ' + r.corps.slice(0, 70).replace(/\s+/g, ' '));
    }
  }

  // Attendre la FIN du processus avant de nettoyer : SQLite garde le fichier
  // ouvert, et un rm dans la foulée echoue en EBUSY.
  const termine = new Promise(r => srv.on('exit', r));
  srv.kill();
  await termine;
  await new Promise(r => setTimeout(r, 300));
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {
    console.log('  (nettoyage du dossier temporaire ignore : ' + e.code + ')');
  }

  console.log('');
  console.log(ok + '/' + CAS.length + ' routes atteignent la bonne route');
  if (ko.length) {
    console.log('PROBLEMES :');
    for (const k of ko) console.log('  - ' + k);
    process.exit(1);
  }
  console.log('Aucun decrochage : aucune route n est capturee par un wildcard.');
})();