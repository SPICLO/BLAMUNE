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
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
    s.on('error', rej);
  });
}

function requete(port, chemin, methode, entetes) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: chemin,
        method: methode || 'GET',
        headers: entetes || {}
      },
      (res) => {
        let corps = '';
        res.on('data', (d) => (corps += d));
        res.on('end', () =>
          resolve({ code: res.statusCode, type: res.headers['content-type'] || '', corps })
        );
      }
    );
    req.on('error', (e) => resolve({ code: 0, type: '', corps: String(e) }));
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
    NODE_ENV: 'test',
    PORT: String(port),
    BLAMUNE_DATA_DIR: dataDir
  });
  const srv = spawn(process.execPath, [path.join(RACINE, 'server.js')], {
    cwd: RACINE,
    env,
    stdio: 'pipe'
  });
  let journal = '';
  srv.stdout.on('data', (d) => (journal += d));
  srv.stderr.on('data', (d) => (journal += d));

  // Attente du serveur
  let pret = false;
  for (let i = 0; i < 60 && !pret; i++) {
    const r = await requete(port, '/ping', 'GET');
    pret = r.code === 200;
    if (!pret) await new Promise((r) => setTimeout(r, 250));
  }
  if (!pret) {
    console.log('ECHEC : le serveur ne demarre pas.\n' + journal);
    srv.kill();
    process.exit(1);
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
    ['/savoir.db', 'GET', 'bloque', 'base refusee']
  ];

  let ok = 0,
    ko = [];
  for (const [chemin, methode, attendu, libelle] of CAS) {
    const r = await requete(port, chemin, methode);
    let bon = false;
    if (attendu === 'json') bon = r.type.includes('application/json');
    else if (attendu === 'html') bon = r.type.includes('text/html');
    else if (attendu === 'js') bon = r.type.includes('javascript');
    else if (attendu === '404') bon = r.code === 404 && /introuvable/i.test(r.corps);
    else if (attendu === 'bloque') bon = r.code === 404 && /Non autorise/i.test(r.corps);
    if (bon) {
      ok++;
      console.log('  [OK ] ' + libelle.padEnd(36) + chemin);
    } else {
      ko.push(libelle + ' (' + chemin + ')');
      console.log(
        '  [KO ] ' +
          libelle.padEnd(36) +
          chemin +
          ' -> ' +
          r.code +
          ' ' +
          r.type +
          ' | ' +
          r.corps.slice(0, 70).replace(/\s+/g, ' ')
      );
    }
  }

  // ------------------------------------------------------------------
  // 2e partie : ACCES AUTHENTIFIE.
  //
  // La premiere partie prouve que chaque chemin atteint le bon handler, mais
  // en sans identite : elle ne traverse que les branches "refuse". Une route
  // dont le corps aurait ete casse derriere l'authentification passerait
  // inapercue. On cree donc un vrai compte, puis un vrai compte admin, et on
  // exige que la route s'execute reellement (statut different de 401/403).
  // ------------------------------------------------------------------
  async function poster(chemin, corps, entetes) {
    const h = Object.assign({}, entetes || {}, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(JSON.stringify(corps))
    });
    return new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: chemin, method: 'POST', headers: h },
        (res) => {
          let t = '';
          res.on('data', (d) => (t += d));
          res.on('end', () =>
            resolve({ code: res.statusCode, type: res.headers['content-type'] || '', corps: t })
          );
        }
      );
      req.on('error', (e) => resolve({ code: 0, type: '', corps: String(e) }));
      req.write(JSON.stringify(corps));
      req.end();
    });
  }

  const enTete = (ego, uid) => ({ 'X-EGO': ego || '', 'X-UID': uid || '' });
  const session = (corps) => {
    try {
      const d = JSON.parse(corps);
      return { ego: d.ego, uid: d.uid };
    } catch (e) {
      return {};
    }
  };

  const compte = await poster(
    '/register',
    { pseudo: 'testeur', mdp: 'motdepasse1', email: 'testeur@exemple.fr' },
    {}
  );
  const u = session(compte.corps);
  const hUtilisateur = enTete(u.ego, u.uid);

  // Le serveur cree lui-meme un compte "admin" au premier demarrage
  // (server.js, serverListen). On recupere donc ses identifiants depuis
  // comptes.json plutot que d inscrire un second compte admin, qui serait
  // refuse avec 409, et plutot que de recopier le mot de passe par defaut
  // dans un autre fichier.
  function compteAdmin() {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(dataDir, 'comptes.json'), 'utf8'));
      const pseudoAdmin = String(process.env.ADMIN_PSEUDO || 'admin').toLowerCase();
      for (const cle of Object.keys(c)) {
        if (String(c[cle].pseudo || '').toLowerCase() === pseudoAdmin) return c[cle];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  const adminCompte = compteAdmin();
  const hAdmin = enTete(adminCompte && adminCompte.ego, adminCompte && adminCompte.uid);

  // chemin, methode, entetes, corps, libelle
  const AUTH = [
    ['/mode', 'POST', hUtilisateur, { m: '1' }, 'mode : passage en EGO'],
    ['/mode', 'POST', hUtilisateur, { m: '2' }, 'mode : retour en BLAMUNE'],
    ['/profil', 'POST', hUtilisateur, { champ: 'ville', valeur: 'Bordeaux' }, 'profil : ecriture'],
    ['/profil', 'POST', hUtilisateur, { champ: 'ville', valeur: 'Lyon' }, 'profil : reecriture'],
    [
      '/profil',
      'POST',
      hUtilisateur,
      { champ: 'ville', valeur: '' },
      'profil : valeur vide refusee'
    ],
    [
      '/profil',
      'POST',
      hUtilisateur,
      { champ: 'inexistant', valeur: 'x' },
      'profil : champ inconnu'
    ],
    ['/profil', 'GET', hUtilisateur, null, 'profil : lecture'],
    ['/historique', 'GET', hUtilisateur, null, 'historique (session reelle)'],
    ['/stats-perso', 'GET', hUtilisateur, null, 'stats perso (session reelle)'],
    ['/tous-les-messages', 'GET', hUtilisateur, null, 'messages du demandeur'],
    ['/connexions', 'GET', hAdmin, null, 'connexions (admin)'],
    ['/admin/users', 'GET', hAdmin, null, 'liste utilisateurs (admin)'],
    ['/admin/data', 'GET', hAdmin, null, 'donnees admin'],
    ['/admin/logs', 'GET', hAdmin, null, 'journal (admin)'],
    ['/admin/backup', 'GET', hAdmin, null, 'sauvegarde (admin)'],
    ['/stats', 'GET', hAdmin, null, 'stats (admin)'],
    ['/config-api', 'POST', hAdmin, { api_model: 'modele-test' }, 'config API (admin)'],
    [
      '/admin/change-mdp',
      'POST',
      hAdmin,
      { nouveau_mdp: 'nouveaumdp1' },
      'changement de mdp (admin)'
    ],
    ['/admin/change-mdp', 'POST', hAdmin, { nouveau_mdp: 'court' }, 'mdp admin trop court refuse'],
    ['/admin/restore', 'POST', hAdmin, {}, 'restauration refusee : corps vide'],
    ['/logout', 'POST', hUtilisateur, {}, 'deconnexion'],
    ['/logout', 'POST', hUtilisateur, {}, 'deconnexion repetee']
  ];

  console.log('');
  console.log('  -- acces authentifie --');
  if (!u.ego) {
    console.log('  [KO ] inscription utilisateur impossible : ' + compte.corps.slice(0, 90));
    ko.push('inscription');
  } else if (!adminCompte) {
    console.log('  [KO ] compte admin absent de comptes.json');
    ko.push('compte admin');
  } else {
    for (const [chemin, methode, entetes, corps, libelle] of AUTH) {
      const r =
        methode === 'GET'
          ? await requete(port, chemin, 'GET', entetes)
          : await poster(chemin, corps, entetes);
      // La route doit s'executer : ni refus d'authentification, ni erreur
      // serveur. Un 400 metier reste acceptable (corps volontairement vide).
      const executee =
        r.type.includes('application/json') && r.code !== 401 && r.code !== 403 && r.code !== 500;
      if (executee) {
        ok++;
        console.log('  [OK ] ' + libelle.padEnd(36) + methode + ' ' + chemin + ' -> ' + r.code);
      } else {
        ko.push(libelle + ' (' + methode + ' ' + chemin + ')');
        console.log(
          '  [KO ] ' +
            libelle.padEnd(36) +
            methode +
            ' ' +
            chemin +
            ' -> ' +
            r.code +
            ' ' +
            r.type +
            ' | ' +
            r.corps.slice(0, 70).replace(/\s+/g, ' ')
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // 3e partie : SUPPRESSION DE COMPTE (route destructive).
  //
  // C'est la route la plus puissante du serveur : registre, dossier
  // utilisateur, copie cloud et RAM partent d'un seul appel. En l'absence
  // de test, une regression supprimerait plus (ou moins) en silence.
  // Decorde fourni : d'abord les trois refus, puis le vrai effacement,
  // verifie AU SYSTEME DE FICHIERS, puis l'obsolence de la cible.
  // ------------------------------------------------------------------
  console.log('');
  console.log('  -- suppression de compte (route destructive) --');
  let extra = 0;
  const verif = (bon, libelle, detail) => {
    extra++;
    if (bon) {
      ok++;
      console.log('  [OK ] ' + libelle.padEnd(36) + (detail || ''));
    } else {
      ko.push('suppression compte : ' + libelle);
      console.log('  [KO ] ' + libelle.padEnd(36) + (detail || ''));
    }
  };
  if (u.ego && adminCompte) {
    const rHorsAdmin = await poster('/admin/supprimer-compte', { uid: u.uid }, hUtilisateur);
    verif(rHorsAdmin.code === 403, 'refusee hors admin (403)', '-> HTTP ' + rHorsAdmin.code);
    const rCibleAdmin = await poster('/admin/supprimer-compte', { uid: adminCompte.uid }, hAdmin);
    verif(
      rCibleAdmin.code === 400,
      'compte admin non supprimable (400)',
      '-> HTTP ' + rCibleAdmin.code
    );
    const rUidInvalide = await poster('/admin/supprimer-compte', { uid: '../fuyard' }, hAdmin);
    verif(
      rUidInvalide.code === 400,
      'uid hors format refuse (400)',
      '-> HTTP ' + rUidInvalide.code
    );
    const dossierCible = path.join(dataDir, 'users', u.uid);
    const rSupprime = await poster('/admin/supprimer-compte', { uid: u.uid }, hAdmin);
    verif(rSupprime.code === 200, 'suppression reussie (200)', '-> HTTP ' + rSupprime.code);
    verif(!fs.existsSync(dossierCible), 'dossier utilisateur efface du disque');
    const rIntrouvable = await poster('/admin/supprimer-compte', { uid: u.uid }, hAdmin);
    verif(
      rIntrouvable.code === 404,
      'compte deja partie -> introuvable (404)',
      '-> HTTP ' + rIntrouvable.code
    );
  } else {
    verif(false, 'conditions du test réunies (compte + admin)');
  }

  // Attendre la FIN du processus avant de nettoyer : SQLite garde le fichier
  // ouvert, et un rm dans la foulée echoue en EBUSY.
  const termine = new Promise((r) => srv.on('exit', r));
  srv.kill();
  await termine;
  await new Promise((r) => setTimeout(r, 300));
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch (e) {
    console.log('  (nettoyage du dossier temporaire ignore : ' + e.code + ')');
  }

  console.log('');
  const total = CAS.length + (u.ego ? AUTH.length : 1) + extra;
  console.log(ok + '/' + total + ' controles reussis');
  if (ko.length) {
    console.log('PROBLEMES :');
    for (const k of ko) console.log('  - ' + k);
    process.exit(1);
  }
  console.log('Aucun decrochage : aucune route n est capturee par un wildcard.');
})();
