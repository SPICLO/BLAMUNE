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
    const f = path.join(RACINE, 'site', icone.src);
    assert.ok(fs.existsSync(f), 'icone absente : ' + icone.src);
  }
});

test('config.json.example : modele aligne sur le defaut du serveur', () => {
  const ex = JSON.parse(lire('config.json.example'));
  assert.strictEqual(ex.api_model, 'gemini-3.5-flash');
});

test('.env.example documente toutes les variables process.env du code', () => {
  const env = lire('.env.example');
  const utilises = new Set();
  for (const f of ['server.js', 'storage.js']) {
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
  for (const f of ['themes.txt', 'themes_manquants.txt', 'node_modules/', 'config.json']) {
    assert.ok(gi.includes(f), '.gitignore doit contenir : ' + f);
  }
});

test('fichiers cles du depot presents', () => {
  for (const f of ['README.md', 'LICENSE', 'CHANGELOG.md', '.env.example', 'Dockerfile', '.nvmrc']) {
    assert.ok(fs.existsSync(path.join(RACINE, f)), 'fichier manquant : ' + f);
  }
});
