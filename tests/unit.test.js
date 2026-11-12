// Tests unitaires / coherence (runner natif node:test, aucune dependance).
//   node --test tests/unit.test.js     ou     npm run test:unit
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.resolve(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');

test('package.json : JSON valide et champs de publication presents', () => {
  const pkg = JSON.parse(lire('package.json'));
  assert.ok(pkg.name, 'name manquant');
  assert.ok(pkg.version, 'version manquante');
  assert.strictEqual(typeof pkg.license, 'string', 'license manquant');
  assert.ok(pkg.author, 'author manquant');
  assert.ok(pkg.repository, 'repository manquant');
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.length, 'keywords manquant');
  assert.ok(pkg.scripts['test:unit'], 'script test:unit manquant');
});

test('manifest.json : PWA complete (id, scope, lang, icones 192 et 512)', () => {
  const m = JSON.parse(lire('site/manifest.json'));
  assert.ok(m.id, 'id manquant');
  assert.ok(m.scope, 'scope manquant');
  assert.ok(m.lang, 'lang manquant');
  const tailles = m.icons.map((i) => i.sizes);
  assert.ok(tailles.includes('192x192'), 'icone 192x192 manquante');
  assert.ok(tailles.includes('512x512'), 'icone 512x512 manquante');
});

test('manifest.json : chaque icone declaree existe sur le disque', () => {
  const m = JSON.parse(lire('site/manifest.json'));
  for (const icone of m.icons) {
    // Les src peuvent porter un cache-buster (« icon-512.png?v=16 ») : le
    // fichier sur disque, c'est la partie avant le « ? ».
    const f = path.join(RACINE, 'site', icone.src.split('?')[0]);
    assert.ok(fs.existsSync(f), 'icone absente : ' + icone.src);
  }
});

test('installation PWA : bouton Installer + aide iOS branches dans la page', () => {
  const html = lire('site/index.html');
  assert.ok(html.includes('id="btnInstaller"'), 'bouton Installer absent');
  assert.ok(html.includes('id="aideInstallation"'), "boite d'aide a l'installation absente");
  // Les deux libelles doivent passer par le systeme de traduction.
  assert.ok(html.includes('data-i18n="Installer"'), 'libelle Installer non traduit');
  const app = lire('site/app.js');
  assert.ok(app.includes('beforeinstallprompt'), 'beforeinstallprompt non capture');
  assert.ok(app.includes("'appinstalled'"), 'evenement appinstalled non ecoute');
  assert.ok(app.includes('display-mode: standalone'), 'detection standalone absente');
});

test('installation PWA : textes disponibles dans les 4 langues', () => {
  const langues = lire('site/langues.js');
  const cles = [
    'Installer:',
    "Installer l'application sur cet appareil",
    'Installer BLAMUNE',
    "Sur iPhone : bouton Partager, puis Sur l'ecran d'accueil.",
    'Application installee.'
  ];
  for (const cle of cles) {
    // La cle francaise sert de repli : elle doit exister dans les 3
    // dictionnaires traduits (en, es, ar), donc au moins 3 fois.
    const occurrences = langues.split(cle).length - 1;
    assert.ok(occurrences >= 3, 'traduction manquante pour : ' + cle);
  }
});

test('config.json.example : modele aligne sur le defaut du serveur', () => {
  const ex = JSON.parse(lire('config.json.example'));
  assert.strictEqual(ex.api_model, 'gemini-3.5-flash');
});

test('.env.example documente toutes les variables process.env du code', () => {
  const env = lire('.env.example');
  const utilises = new Set();
  for (const f of [
    'server.js',
    'storage.js',
    'lib/rate_limit.js',
    'lib/memoire.js',
    'lib/historique.js',
    'lib/resume.js'
  ]) {
    const re = /process\.env\.([A-Z0-9_]+)/g;
    let m;
    while ((m = re.exec(lire(f))) !== null) utilises.add(m[1]);
  }
  const manquants = [...utilises].filter((nom) => !env.includes(nom));
  assert.deepStrictEqual(manquants, [], 'variables non documentees : ' + manquants.join(', '));
});

test('configuration locale : .env est pris en compte dans server.js', () => {
  const code = lire('server.js');
  const pkg = JSON.parse(lire('package.json'));
  assert.ok(code.includes("require('dotenv').config"), 'server.js ne charge pas .env');
  assert.ok(pkg.dependencies?.dotenv, 'dotenv absent de package.json');
});

test('.gitignore ignore les sorties volumineuses et les secrets', () => {
  const gi = lire('.gitignore');
  for (const f of [
    'themes.txt',
    'themes_manquants.txt',
    'node_modules/',
    'config.json',
    'local/'
  ]) {
    assert.ok(gi.includes(f), '.gitignore doit contenir : ' + f);
  }
});

test('.env et les secrets ne sont PAS suivis par git', () => {
  // L'entree dans .gitignore ne suffit pas : un fichier ajoute avant
  // d'etre ignore reste suivi pour toujours. Seul l'index fait foi.
  const { execSync } = require('child_process');
  const suivis = execSync('git ls-files', { cwd: RACINE, encoding: 'utf8' }).split(/\r?\n/);
  for (const f of ['.env', 'comptes.json', 'config.json', 'bot.exe', 'savoir.db']) {
    assert.ok(!suivis.includes(f), f + ' ne doit jamais etre suivi par git');
  }
});

test('CORS : domaines exacts, jamais de wildcard de plateforme', () => {
  // Historique : /.onrender.com$/ acceptait aussi evil.onrender.com —
  // un sous-domaine gratuit reservable par n'importe qui sur le meme
  // PaaS. La allowlist doit rester du domaine exact (+ local), reglable
  // par CORS_ORIGINS.
  const srv = lire('server.js');
  assert.ok(srv.includes('CORS_ORIGINS'), 'CORS_ORIGINS doit piloter la allowlist');
  assert.ok(
    !/\\\.vercel\\\.app\$/.test(srv) && !/\\\.onrender\\\.com\$/.test(srv),
    'les wildcards de plateforme (.vercel.app, .onrender.com) ont ete retires'
  );
  assert.ok(
    /localhost\|127/.test(srv) || /\(localhost\|127/.test(srv),
    'local reste autorise pour le developpement'
  );
});

test('fichiers cles du depot presents', () => {
  for (const f of [
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    '.env.example',
    'Dockerfile',
    '.nvmrc'
  ]) {
    assert.ok(fs.existsSync(path.join(RACINE, f)), 'fichier manquant : ' + f);
  }
});
