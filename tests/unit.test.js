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

test('profil : les champs proposes par le site existent cote serveur', () => {
  // Regression : l'interface proposait prenom/metier/gouts, trois cles que
  // /profil refuse (« Champ inconnu ») tout en affichant « Profil sauvegarde ».
  const app = lire('site/app.js');
  const blocUi = app.match(/var CHAMPS_PROFIL = \[([\s\S]*?)\];/);
  assert.ok(blocUi, 'CHAMPS_PROFIL introuvable');
  const clesUi = [...blocUi[1].matchAll(/cle:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(clesUi.length >= 5, 'grille de profil trop petite');
  const blocServeur = lire('lib/memoire.js').match(/const CHAMPS_MEMOIRE = \[([\s\S]*?)\];/);
  assert.ok(blocServeur, 'CHAMPS_MEMOIRE introuvable');
  // Les commentaires contiennent des apostrophes (« l'utilisateur ») : on les
  // retire avant d'extraire les cles, sinon le motif attrape des bouts de
  // commentaire a la place des noms de champs.
  const sansCommentaires = blocServeur[1].replace(/\/\/[^\n]*/g, '');
  const clesServeur = [...sansCommentaires.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const inconnus = clesUi.filter((c) => !clesServeur.includes(c));
  assert.deepStrictEqual(inconnus, [], 'champs refuses par /profil : ' + inconnus.join(', '));
});

test('profil : la sauvegarde n envoie pas de champ vide', () => {
  // Regression : « Enregistrer » envoyait les 7 champs, vides compris.
  // /profil refuse une valeur vide (`ecrireMemoire` renvoie ok:false), donc
  // sauvegarder un profil incomplet affichait « Certains champs n'ont pas
  // pu etre enregistres » et laissait le badge de comptage fige.
  const app = lire('site/app.js');
  const debut = app.indexOf('async function sauverProfil');
  const fin = app.indexOf('async function oublierProfil');
  assert.ok(debut !== -1 && fin > debut, 'sauverProfil introuvable');
  const bloc = app.slice(debut, fin);
  assert.ok(bloc.includes('if (!valeur) continue;'), 'les champs vides doivent etre ignores');
  assert.ok(
    bloc.includes("encodeURIComponent(cle) + '&valeur=' + encodeURIComponent(valeur)"),
    'la valeur filtree doit etre envoyee a /profil'
  );
  assert.ok(bloc.includes('majCompteProfil(remplis)'), 'le badge doit suivre la sauvegarde');
});

test('interface : les elements masques par .cache sont geres par la classe', () => {
  // .cache vaut display:none !important : vider style.display ne reaffiche
  // rien. Ce test garde la lecon (boutons Quitter/Notifications et apercu
  // photo etaient invisibles en production).
  const app = lire('site/app.js');
  for (const attendu of [
    "btnDeconnexion.classList.remove('cache')",
    "btn.classList.remove('cache')",
    "ap.classList.remove('cache')",
    "ap.classList.add('cache')"
  ]) {
    assert.ok(app.includes(attendu), 'gestion par classe manquante : ' + attendu);
  }
});

test("interface : l'inscription s'affiche via .cache, jamais par style.display", () => {
  // Regression du 2026-11-14 : le formulaire d'inscription porte .cache
  // (display:none !important). La bascule ne vidait que style.display :
  // la connexion disparaissait, l'inscription ne venait jamais.
  const app = lire('site/app.js');
  const debut = app.indexOf('function basculerForm');
  const fin = app.indexOf('function initAuth');
  assert.ok(debut !== -1 && fin > debut, 'basculerForm introuvable');
  const bloc = app.slice(debut, fin);
  assert.ok(bloc.includes("depuis.classList.contains('cache')"), 'etat de depart lu par classe');
  assert.ok(bloc.includes("depuis.classList.add('cache')"), 'forme sortante masquee par classe');
  assert.ok(bloc.includes("cible.classList.remove('cache')"), 'forme entrante affichee par classe');
  assert.ok(!bloc.includes('depuis.style.display'), 'style.display ne bat pas un .cache !important');
  assert.ok(!bloc.includes('cible.style.display'), 'style.display ne bat pas un .cache !important');

  const auth = app.slice(app.indexOf('function afficherAuth'), app.indexOf('async function authRegister'));
  assert.ok(auth.includes("reg.classList.add('cache')"), 'inscription masquee par classe au retour');
  assert.ok(auth.includes("login.classList.remove('cache')"), 'connexion affichee par classe au retour');
});

test('langue : le selecteur reste disponible une fois connecte', () => {
  const html = lire('site/index.html');
  assert.ok(html.includes('id="choixLangueApp"'), "selecteur de langue de l'app absent");
  assert.ok(
    /<select[\s\S]{0,200}id="choixLangueApp"/.test(html),
    'choixLangueApp doit etre un select'
  );
  const app = lire('site/app.js');
  assert.ok(app.includes("brancher('choixLangueApp')"), 'selecteur non branche dans app.js');
  // Les actions du header doivent porter leur cle de traduction : sans
  // data-i18n, elles restaient en francais apres un changement de langue.
  for (const cle of ['Mon profil', 'Rechercher', 'Export', 'Notifications', 'Journal']) {
    assert.ok(html.includes('data-i18n="' + cle + '"'), 'data-i18n manquant pour : ' + cle);
  }
});

test('profil : le message d echec de sauvegarde est traduit', () => {
  const langues = lire('site/langues.js');
  const cle = "Certains champs n'ont pas pu etre enregistres.";
  const occurrences = langues.split(cle).length - 1;
  assert.ok(occurrences >= 3, 'traduction manquante pour : ' + cle);
});

test('notifications : libelles du bouton traduits dans les 4 langues', () => {
  const langues = lire('site/langues.js');
  for (const cle of ['Activer les notifications', 'Notifications OK']) {
    const occurrences = langues.split(cle).length - 1;
    assert.ok(occurrences >= 3, 'traduction manquante pour : ' + cle);
  }
});

test('installation : le bouton est visible sans beforeinstallprompt', () => {
  // Regression : sur telephone, beforeinstallprompt n'arrive pas toujours
  // (premiere visite, navigateur integre). Le bouton restait alors cache et
  // l'utilisateur concluait « on ne peut pas le telecharger ».
  const app = lire('site/app.js');
  assert.ok(app.includes('montrerBouton();'), 'montrerBouton jamais appele');
  const avantEvenement = app.indexOf("addEventListener('beforeinstallprompt'");
  const appelInitial = app.indexOf('montrerBouton();');
  assert.ok(
    appelInitial !== -1 && appelInitial < avantEvenement,
    'montrerBouton doit etre appele a l initialisation, avant l evenement'
  );
  for (const attendu of ['estNavigateurIntegre', 'texteAideInstallation', 'estAndroid']) {
    assert.ok(app.includes(attendu), 'detection manquante : ' + attendu);
  }
});

test('installation : chaque mode d emploi est traduit dans les 4 langues', () => {
  const langues = lire('site/langues.js');
  const cles = [
    'Ouvre ce lien dans Chrome (Android) ou Safari (iPhone) : le navigateur integre a une application ne peut pas installer BLAMUNE.',
    "Sur iPhone, seul Safari installe l'application : ouvre cette page dans Safari, bouton Partager, puis Sur l'ecran d'accueil.",
    "Dans Chrome : menu ⋮ en haut a droite, puis Installer l'application (ou Ajouter a l'ecran d'accueil).",
    "Dans la barre d'adresse : icone Installer, ou menu ⋮ puis Installer BLAMUNE."
  ];
  for (const cle of cles) {
    const occurrences = langues.split(cle).length - 1;
    assert.ok(occurrences >= 3, 'traduction manquante pour : ' + cle);
  }
});

test('installation : le texte d aide n est pas fige par data-i18n', () => {
  // Le mode d'emploi depend de l'appareil et est ecrit en JS. Un data-i18n
  // sur ce paragraphe le reecrirait a chaque changement de langue et
  // effacerait le message adapte (navigateur integre, Android, ordinateur).
  const html = lire('site/index.html');
  const bloc = html.match(/<p[^>]*id="aideInstallationTexte"[^>]*>/);
  assert.ok(bloc, 'paragraphe aideInstallationTexte introuvable');
  assert.ok(!bloc[0].includes('data-i18n='), 'aideInstallationTexte ne doit pas porter data-i18n');
});

test("installation : l'entree existe AVANT la connexion", () => {
  // Le bouton Installer vivait dans #appContenu (display:none avant
  // connexion) : mesure sur le site en ligne, il faisait 0x0 px sur
  // l'ecran d'accueil. Un visiteur ne pouvait donc pas installer sans
  // creer un compte, ni meme savoir que c'etait possible.
  const html = lire('site/index.html');
  const invite = html.indexOf('id="btnInvite"');
  const cta = html.indexOf('id="btnInstallerAccueil"');
  const app = html.indexOf('id="appContenu"');
  assert.ok(invite !== -1 && cta !== -1, "CTA d'installation d'accueil absent");
  assert.ok(
    cta > invite && cta < app,
    "le CTA doit etre dans l'ecran d'accueil, apres « Continuer en tant qu'invite »"
  );

  const ouverture = html.slice(html.lastIndexOf('<button', cta), html.indexOf('>', cta) + 1);
  assert.ok(!ouverture.includes('data-i18n='), 'le bouton ne doit pas porter data-i18n (il effacerait l icone)');
  const bouton = html.slice(cta, html.indexOf('</button>', cta));
  assert.ok(bouton.includes('<svg'), 'icone du bouton absente');
  assert.ok(
    bouton.includes('<span data-i18n="Installer BLAMUNE">'),
    'le libelle doit etre traduit dans un span'
  );
});

test('installation : un seul parcours pour les deux boutons', () => {
  const app = lire('site/app.js');
  assert.ok(app.includes('async function demanderInstallation'), 'parcours partage absent');
  assert.ok(app.includes("getElementById('btnInstallerAccueil')"), 'CTA accueil non branche');
  assert.ok(app.includes("getElementById('btnInstaller')"), 'bouton du menu non branche');
  const debut = app.indexOf('function initInstallation');
  const fin = app.indexOf("addEventListener('load'");
  const bloc = app.slice(debut, fin > debut ? fin : app.length);
  assert.ok(
    bloc.includes("addEventListener('click', demanderInstallation)"),
    'les deux entrees doivent appeler demanderInstallation'
  );
  assert.ok(bloc.includes('installPromptDiffere = e;'), 'beforeinstallprompt non memorise');
});

test('installation : Android sans prompt propose Ouvrir dans Chrome', () => {
  const app = lire('site/app.js');
  assert.ok(app.includes("'intent://'"), 'lien intent absent');
  assert.ok(app.includes('package=com.android.chrome'), 'paquet Chrome absent');
  assert.ok(app.includes('^android-app:\\/\\/'), 'Chrome Custom Tabs non detectees');
  assert.ok(app.includes("getElementById('btnOuvrirChrome')"), 'bouton Ouvrir dans Chrome non branche');
});

test('installation : un refus est memorise 7 jours', () => {
  const app = lire('site/app.js');
  assert.ok(
    app.includes("var CLE_REFUS_INSTALL = 'blamune_install_refus';"),
    'cle de refus absente'
  );
  assert.ok(app.includes('var REFUS_INSTALL_JOURS = 7;'), 'duree de 7 jours absente');
  assert.ok(
    app.includes('REFUS_INSTALL_JOURS * 24 * 60 * 60 * 1000'),
    'conversion en millisecondes absente'
  );
  const debut = app.indexOf('function fermerAideInstallation');
  const fin = app.indexOf('async function demanderInstallation');
  const bloc = app.slice(debut, fin > debut ? fin : app.length);
  assert.ok(bloc.includes('memoriserRefusInstall();'), 'la fermeture doit memoriser le refus');
  assert.ok(bloc.includes('montrerBouton();'), 'les entrees doivent se rafraichir');
});

test("installation : la boite d'aide est accessible au clavier", () => {
  const html = lire('site/index.html');
  const app = lire('site/app.js');
  assert.ok(/id="aideInstallation"[\s\S]{0,220}aria-modal="true"/.test(html), 'aria-modal manquant');
  assert.ok(html.includes('aria-describedby="aideInstallationTexte"'), 'description non reliee');
  assert.ok(html.includes('id="btnFermerAideInstallationX"'), 'bouton fermer visible absent');
  assert.ok(app.includes("e.key === 'Escape'"), 'fermeture par Echap absente');
  assert.ok(app.includes("e.key !== 'Tab'"), 'piege de Tab absent');
});

test('installation : les nouvelles cles sont traduites dans les 4 langues', () => {
  const langues = lire('site/langues.js');
  const cles = [
    'Ouvrir dans Chrome',
    "Acces direct depuis ton ecran d'accueil, comme une app.",
    'Partager',
    "Sur l'ecran d'accueil"
  ];
  for (const cle of cles) {
    const occurrences = langues.split(cle).length - 1;
    assert.ok(occurrences >= 3, 'traduction manquante pour : ' + cle);
  }
});

test("auth : les deux formulaires tiennent sans ascenseur", () => {
  // Mesure du 2026-11-14 : la carte d'inscription faisait 799 px de haut
  // sur un telephone et 781 px sur une fenetre courte — l'ascenseur
  // apparaissait avant meme les boutons du bas.
  const css = lire('site/style.css');
  assert.ok(
    css.includes('@media (max-width: 600px), (max-height: 800px)'),
    'palier compact absent'
  );
  assert.ok(css.includes('@media (max-height: 700px)'), 'palier ecran court absent');
  assert.ok(css.includes('@media (max-height: 580px)'), 'palier tres court absent');
  assert.ok(
    /@media \(max-height: 700px\) \{[\s\S]*?\.auth-sous \{\s*display: none;/.test(css),
    "l'accroche doit s'effacer sur un ecran court"
  );
  assert.ok(
    css.includes('padding: env(safe-area-inset-top)'),
    'zones sures (encoche) non respectees'
  );

  const html = lire('site/index.html');
  assert.strictEqual(html.split('id="authLangue"').length - 1, 1, 'un seul bloc langue');
  assert.strictEqual(html.split('id="choixLangue"').length - 1, 1, 'un seul selecteur de langue');
  assert.ok(html.includes('id="authLangue"'), 'selecteur de langue introuvable');
  assert.ok(
    html.indexOf('id="authLangue"') > html.indexOf('id="btnInstallerAccueil"'),
    'la langue doit rester en bas de la carte'
  );
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
