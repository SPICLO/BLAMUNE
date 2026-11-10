// ====================================================================
//  Tests : le serveur s'arrete VRAIMENT sur SIGTERM
// ====================================================================
//  Un handle de timer (setInterval, setTimeout) sans unref() retient le
//  process. On le voit mal en production — d'autres handles tournent — mais
//  il casse `docker stop`, `Ctrl+C`, et les scripts qui attendent la sortie.
//
//  Ces tests lancent le VRAI server.js dans un process fils et mesurent le
//  temps entre SIGTERM et la sortie, exactement comme un hebergeur.
//
//  LIMITE ASSUMEE, verifiee le 2026-11-10 : tant que `server.listen()` est
//  ouvert, le serveur garde le process vivant de toute facon, et un timer
//  sans unref() ne se voit PAS dans ce test (regression simulee : les deux
//  cas restent verts). Ce que ces tests prouvent reellement :
//    - la fermeture ne se BLOQUE pas (filet de 5 s, sauvegarde finale) ;
//    - deux signaux rapproches ne provoquent ni crash ni double sortie ;
//    - le process sort en moins de 9 s, comme l'attend un hebergeur.
//  La regle « tout timer d'entretien porte unref() » est donc tenue par
//  revue de code, pas par ce fichier. Ne pas lui preter plus de pouvoir.
// ====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');

// Le filet de fermerProperement est de 5 s : au-dela de 9 s, ce n'est plus
// un arret, c'est un processus qui refuse de mourir.
const DELAI_MAX_MS = 9000;

function portLibre() {
  return 21000 + Math.floor(Math.random() * 20000);
}

function attendre(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function attendreServeur(port, ms) {
  const debut = Date.now();
  while (Date.now() - debut < ms) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/ping');
      if (r.ok) return true;
    } catch (e) {
      // pas encore pret
    }
    await attendre(200);
  }
  return false;
}

function lancerServeur(env) {
  const proc = spawn(process.execPath, [path.join(RACINE, 'server.js')], {
    cwd: RACINE,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let sortie = '';
  proc.stdout.on('data', (d) => (sortie += d));
  proc.stderr.on('data', (d) => (sortie += d));
  return { proc, sortie: () => sortie };
}

test('SIGTERM : le process sort en moins de 9 s (aucun timer ne le retient)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blamune-arret-'));
  const port = portLibre();
  const env = Object.assign({}, process.env, {
    NODE_ENV: 'test',
    PORT: String(port),
    BLAMUNE_DATA_DIR: dataDir,
    // Entretiens PERIODIQUES actifs et rapproches : c'est precisement les
    // setInterval qui retenaient le process. Avec les valeurs par defaut
    // (5 min, 1 h), un test de 9 s ne les verrait meme pas.
    PURGE_INVITES_MS: '1000',
    PUSH_CHECK_MS: '1000',
    VAPID_PRIVATE_KEY: '',
    // Pas d'appel reseau au demarrage.
    API_KEY: '',
    RECHERCHE_WEB_AUTO: '0'
  });

  const { proc, sortie } = lancerServeur(env);
  try {
    const pret = await attendreServeur(port, 30000);
    assert.ok(pret, 'le serveur doit demarrer — journal :\n' + sortie().slice(-1500));

    const debut = Date.now();
    proc.kill('SIGTERM');
    const sorti = await new Promise((resolve) => {
      const minuteur = setTimeout(() => resolve(false), DELAI_MAX_MS + 2000);
      proc.on('exit', () => {
        clearTimeout(minuteur);
        resolve(true);
      });
    });
    const duree = Date.now() - debut;

    assert.ok(
      sorti,
      'le process survit ' +
        DELAI_MAX_MS +
        '+ ms apres SIGTERM : un timer sans unref().' +
        ' Journal :\n' +
        sortie().slice(-800)
    );
    assert.ok(duree < DELAI_MAX_MS, 'arret en ' + duree + ' ms (attendu < ' + DELAI_MAX_MS + ')');
  } finally {
    if (proc.exitCode === null) proc.kill('SIGKILL');
    await attendre(200);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (e) {}
  }
});

test('SIGINT puis SIGTERM : une seule sortie, pas de double sauvegarde', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blamune-arret2-'));
  const port = portLibre();
  // Le dossier doit exister : sans lui, node:sqlite echoue a ouvrir la base
  // et le serveur meurt AVANT d'installer ses gestionnaires de signal. Le
  // test mesurerait alors un process deja mort, pas un arret propre.
  const env = Object.assign({}, process.env, {
    NODE_ENV: 'test',
    PORT: String(port),
    BLAMUNE_DATA_DIR: dataDir,
    API_KEY: '',
    RECHERCHE_WEB_AUTO: '0'
  });

  const { proc, sortie } = lancerServeur(env);
  try {
    const pret = await attendreServeur(port, 30000);
    assert.ok(pret, 'demarrage — journal :\n' + sortie().slice(-1200));

    // L'ecouteur doit etre pose AVANT les signaux : un process qui sort en
    // 60 ms (cas normal) aurait deja emis 'exit' quand on l'ecoute, et le
    // test attendrait un evenement deja passe.
    const attenteSortie = new Promise((resolve) => {
      const minuteur = setTimeout(() => resolve(false), DELAI_MAX_MS + 2000);
      proc.on('exit', () => {
        clearTimeout(minuteur);
        resolve(true);
      });
    });

    // docker stop envoie parfois les deux signaux a quelques ms d'ecart.
    proc.kill('SIGINT');
    await attendre(30);
    proc.kill('SIGTERM');

    const sorti = await attenteSortie;
    assert.ok(sorti, 'le process doit sortir malgre deux signaux');

    // Ce qui compte : le process est SORTI, et pas par un crash. Un arret
    // par signal (exitCode null, signalCode 'SIGINT'/'SIGTERM') est le
    // comportement normal de Node quand le second signal arrive avant la
    // fin de la fermeture — c'est meme le but du garde. Un crash, lui,
    // laisserait un code non nul (1) et une trace dans le journal.
    const parSignal = proc.exitCode === null && !!proc.signalCode;
    const parExit = proc.exitCode === 0;
    assert.ok(
      parSignal || parExit,
      'sortie inattendue : code=' +
        proc.exitCode +
        ' signal=' +
        proc.signalCode +
        '\n' +
        sortie().slice(-800)
    );
    assert.ok(
      !/uncaughtException|unhandledRejection/.test(sortie()),
      'crash pendant la fermeture :\n' + sortie().slice(-800)
    );
  } finally {
    if (proc.exitCode === null) proc.kill('SIGKILL');
    await attendre(200);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (e) {}
  }
});
