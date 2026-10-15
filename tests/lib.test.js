// Tests unitaires des modules extraits dans lib/ (runner natif node:test).
//   node --test tests/lib.test.js
//
// Ces modules sont injectes : on peut les instancier avec un dossier
// temporaire et un faux storage, sans toucher aux donnees reelles ni
// demarrer le serveur.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { checkRateLimit, checkUserRateLimit, purger } = require('../lib/rate_limit');
const { creerMemoire } = require('../lib/memoire');
const { creerHistorique } = require('../lib/historique');
const { creerResume } = require('../lib/resume');

// Storage cloud desactive : ces tests ne doivent toucher aucun service.
const storageFaux = { estConfigure: () => false, setMemoire() {}, setHistorique() {} };

function dossierTmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blamune-lib-'));
  t.after(() => { fs.rmSync(d, { recursive: true, force: true }); });
  return d;
}

// ============================ RATE LIMIT ============================

test('rate limit : autorise jusqu a la limite, puis refuse', () => {
  const cle = 'test:' + Math.random();
  assert.strictEqual(checkRateLimit(cle, 3), true);
  assert.strictEqual(checkRateLimit(cle, 3), true);
  assert.strictEqual(checkRateLimit(cle, 3), true);
  assert.strictEqual(checkRateLimit(cle, 3), false, '4e appel doit etre refuse');
});

test('rate limit : les cles sont independantes', () => {
  const a = 'a:' + Math.random();
  const b = 'b:' + Math.random();
  checkRateLimit(a, 1);
  assert.strictEqual(checkRateLimit(a, 1), false);
  assert.strictEqual(checkRateLimit(b, 1), true, 'une autre cle ne doit pas etre affectee');
});

test('rate limit : le quota IP et le quota utilisateur sont distincts', () => {
  const uid = 'u_' + Math.random().toString(36).slice(2);
  const ip = 'ip:' + Math.random();
  // Meme cle logique, deux files : saturer l'IP ne doit pas epuiser l'uid.
  checkRateLimit('send:' + ip, 1);
  assert.strictEqual(checkRateLimit('send:' + ip, 1), false);
  assert.strictEqual(checkUserRateLimit(uid, 5), true);
});

test('rate limit : purger ne casse pas les quotas actifs', () => {
  const cle = 'purge:' + Math.random();
  checkRateLimit(cle, 10);
  purger();
  assert.strictEqual(checkRateLimit(cle, 10), true);
});

// ============================= MEMOIRE ==============================

test('dossierUser : un uid trop court part dans _invalid', (t) => {
  const { dossierUser } = creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  assert.ok(dossierUser('ab').endsWith(path.join('_invalid')), 'uid trop court accepte');
  assert.ok(dossierUser('').endsWith(path.join('_invalid')), 'uid vide accepte');
});

test('dossierUser : un uid normal cree son dossier', (t) => {
  const root = dossierTmp(t);
  const { dossierUser } = creerMemoire({ usersDir: root, storage: storageFaux });
  const d = dossierUser('u_test123');
  assert.strictEqual(d, path.join(root, 'u_test123'));
  assert.ok(fs.existsSync(d), 'dossier non cree');
});

test('memoire : lecture d un utilisateur inconnu rend tous les champs vides', (t) => {
  const { lireMemoire } = creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  const mem = lireMemoire('u_inconnu1');
  assert.strictEqual(mem.nom, '');
  assert.deepStrictEqual(mem.motsFavoris, [], 'motsFavoris doit etre un tableau');
});

test('memoire : ecrire puis relire un champ', (t) => {
  const { lireMemoire, ecrireMemoire } = creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  assert.strictEqual(ecrireMemoire('u_abc123', 'ville', 'Bordeaux'), true);
  assert.strictEqual(lireMemoire('u_abc123').ville, 'Bordeaux');
});

test('memoire : un champ inconnu ou une valeur vide est refuse', (t) => {
  const { ecrireMemoire } = creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  assert.strictEqual(ecrireMemoire('u_abc123', 'champInexistant', 'x'), false);
  assert.strictEqual(ecrireMemoire('u_abc123', 'ville', '   '), false, 'valeur vide acceptee');
});

test('memoire : motsFavoris reste une liste a travers un aller-retour', (t) => {
  const { lireMemoire, sauvegarderMemoireComplete } =
    creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  sauvegarderMemoireComplete('u_abc123', { nom: 'Theo', motsFavoris: ['chat', 'nuit'] });
  const mem = lireMemoire('u_abc123');
  assert.deepStrictEqual(mem.motsFavoris, ['chat', 'nuit']);
  assert.strictEqual(mem.nom, 'Theo');
});

test('memoire : un ancien fichier a 9 lignes reste lisible', (t) => {
  const root = dossierTmp(t);
  const d = path.join(root, 'u_ancien01');
  fs.mkdirSync(d, { recursive: true });
  // Format d'avant le commit 6af5d88 : les 9 premiers champs sont
  // nom, plat, hobby, motsFavoris, genre, aime, aimePas, age, humeur.
  // Les champs ajoutes ensuite (humeurUser, ville...) sont en fin de liste,
  // donc pas de decalage : les 9 lignes se lisent a l'identique.
  fs.writeFileSync(path.join(d, 'memoire.txt'),
    'Theo\npizza\nfoot\nmot,mot2\nmasculin\nchat\nfroid\n25\njoyeux', 'utf8');
  const { lireMemoire } = creerMemoire({ usersDir: root, storage: storageFaux });
  const mem = lireMemoire('u_ancien01');
  assert.strictEqual(mem.nom, 'Theo');
  assert.strictEqual(mem.plat, 'pizza');
  assert.strictEqual(mem.age, '25');
  assert.strictEqual(mem.humeur, 'joyeux', 'la 9e ligne reste humeur');
  assert.deepStrictEqual(mem.motsFavoris, ['mot', 'mot2']);
  // Champs ajoutes ensuite : absents du fichier, donc vides.
  assert.strictEqual(mem.humeurUser, '');
  assert.strictEqual(mem.ville, '');
});

// ============================ HISTORIQUE ============================

test('historique : le chemin depend du mode', (t) => {
  const { dossierUser } = creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  const { cheminHistorique } = creerHistorique({ dossierUser, storage: storageFaux });
  assert.ok(cheminHistorique('u_abc123', '1').endsWith('historique_mode1.json'));
  assert.ok(cheminHistorique('u_abc123', '2').endsWith('historique_mode2.json'));
  assert.ok(cheminHistorique('u_abc123', '').endsWith('historique.json'));
});

test('historique : aller-retour ecriture / lecture', (t) => {
  const { dossierUser } = creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  const { chargerHistorique, sauvegarderHistorique } =
    creerHistorique({ dossierUser, storage: storageFaux });
  assert.deepStrictEqual(chargerHistorique('u_abc123', '2'), [], 'historique absent != []');
  const h = [{ qui: 'moi', texte: 'salut' }, { qui: 'blamune', texte: 'coucou' }];
  sauvegarderHistorique('u_abc123', '2', h);
  assert.deepStrictEqual(chargerHistorique('u_abc123', '2'), h);
});

test('historique : un historique corrompu ne leve pas', (t) => {
  const { dossierUser, } = creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  const { cheminHistorique, chargerHistorique } = creerHistorique({ dossierUser, storage: storageFaux });
  fs.writeFileSync(cheminHistorique('u_abc123', '2'), '{pas du json', 'utf8');
  assert.deepStrictEqual(chargerHistorique('u_abc123', '2'), []);
});

test('historique : sans uid on renvoie un tableau vide', (t) => {
  const { dossierUser } = creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  const { chargerHistorique } = creerHistorique({ dossierUser, storage: storageFaux });
  assert.deepStrictEqual(chargerHistorique('', '2'), []);
});

// ============================== RESUME ==============================

function resumeDeTest(t, questionModele) {
  const { dossierUser } = creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  const { cheminHistorique, sauvegarderHistorique } = creerHistorique({ dossierUser, storage: storageFaux });
  const resume = creerResume({
    dossierUser, cheminHistorique,
    questionModele: questionModele || (async () => 'resume test'),
    nettoyerReponse: (t2) => t2,
    loggerErreur: () => {},
  });
  return { resume, sauvegarderHistorique };
}

test('resume : lecture d un resume absent rend des valeurs neutres', (t) => {
  const { resume } = resumeDeTest(t);
  assert.deepStrictEqual(resume.lireResume('u_abc123', '2'), { texte: '', couverts: 0 });
});

test('resume : ecrire puis relire', (t) => {
  const { resume } = resumeDeTest(t);
  resume.ecrireResume('u_abc123', '2', { texte: 'On avait parle foot', couverts: 10 });
  assert.deepStrictEqual(resume.lireResume('u_abc123', '2'), { texte: 'On avait parle foot', couverts: 10 });
});

test('resume : supprimer un resume absent ne leve pas', (t) => {
  const { resume } = resumeDeTest(t);
  resume.supprimerResume('u_abc123', '2');
});

test('resume : sous le seuil, rien n est replie', async (t) => {
  let appels = 0;
  const { resume, sauvegarderHistorique } = resumeDeTest(t, async () => { appels++; return 'x'; });
  sauvegarderHistorique('u_abc123', '2', [{ qui: 'moi', texte: 'a' }]);
  await resume.majResume('u_abc123', '2');
  assert.strictEqual(appels, 0, 'le modele ne doit pas etre appele sous le seuil');
  assert.strictEqual(resume.lireResume('u_abc123', '2').couverts, 0);
});

test('resume : au seuil, le bloc est replie et couvert', async (t) => {
  const { resume, sauvegarderHistorique } = resumeDeTest(t);
  const h = Array.from({ length: 10 }, (_, i) => ({ qui: i % 2 ? 'blamune' : 'moi', texte: 'msg' + i }));
  sauvegarderHistorique('u_abc123', '2', h);
  await resume.majResume('u_abc123', '2');
  const r = resume.lireResume('u_abc123', '2');
  assert.strictEqual(r.couverts, 10, 'les 10 premiers echanges doivent etre couverts');
  assert.ok(r.texte.length > 0, 'le resume doit etre enregistre');
});

test('resume : le resume est incremental, jamais repare depuis le debut', async (t) => {
  const { resume, sauvegarderHistorique } = resumeDeTest(t);
  const h = Array.from({ length: 20 }, (_, i) => ({ qui: 'moi', texte: 'msg' + i }));
  sauvegarderHistorique('u_abc123', '2', h);
  await resume.majResume('u_abc123', '2');
  assert.strictEqual(resume.lireResume('u_abc123', '2').couverts, 10);
  await resume.majResume('u_abc123', '2');
  assert.strictEqual(resume.lireResume('u_abc123', '2').couverts, 20);
});

test('resume : un historique raccourci invalide le resume', async (t) => {
  const { resume, sauvegarderHistorique } = resumeDeTest(t);
  resume.ecrireResume('u_abc123', '2', { texte: 'ancien', couverts: 30 });
  sauvegarderHistorique('u_abc123', '2', [{ qui: 'moi', texte: 'seul' }]);
  await resume.majResume('u_abc123', '2');
  assert.deepStrictEqual(resume.lireResume('u_abc123', '2'), { texte: '', couverts: 0 },
    'le resume obsolete aurait du etre purge');
});

test('resume : deux appels concurrents ne replient qu une fois', async (t) => {
  let appels = 0;
  const { resume, sauvegarderHistorique } = resumeDeTest(t, async () => {
    appels++;
    await new Promise(r => setTimeout(r, 20));
    return 'resume';
  });
  sauvegarderHistorique('u_abc123', '2',
    Array.from({ length: 10 }, (_, i) => ({ qui: 'moi', texte: 'msg' + i })));
  await Promise.all([resume.majResume('u_abc123', '2'), resume.majResume('u_abc123', '2')]);
  assert.strictEqual(appels, 1, 'le repliement a ete declenche deux fois');
});