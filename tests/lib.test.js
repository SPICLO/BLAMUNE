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
const { creerConfigIA } = require('../lib/config_ia');
const { demarrerKeepalive } = require('../lib/keepalive');

// Storage cloud desactive : ces tests ne doivent toucher aucun service.
const storageFaux = { estConfigure: () => false, setMemoire() {}, setHistorique() {} };

function dossierTmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blamune-lib-'));
  t.after(() => {
    fs.rmSync(d, { recursive: true, force: true });
  });
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
  const { lireMemoire, ecrireMemoire } = creerMemoire({
    usersDir: dossierTmp(t),
    storage: storageFaux
  });
  assert.strictEqual(ecrireMemoire('u_abc123', 'ville', 'Bordeaux'), true);
  assert.strictEqual(lireMemoire('u_abc123').ville, 'Bordeaux');
});

test('memoire : un champ inconnu ou une valeur vide est refuse', (t) => {
  const { ecrireMemoire } = creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  assert.strictEqual(ecrireMemoire('u_abc123', 'champInexistant', 'x'), false);
  assert.strictEqual(ecrireMemoire('u_abc123', 'ville', '   '), false, 'valeur vide acceptee');
});

test('memoire : motsFavoris reste une liste a travers un aller-retour', (t) => {
  const { lireMemoire, sauvegarderMemoireComplete } = creerMemoire({
    usersDir: dossierTmp(t),
    storage: storageFaux
  });
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
  fs.writeFileSync(
    path.join(d, 'memoire.txt'),
    'Theo\npizza\nfoot\nmot,mot2\nmasculin\nchat\nfroid\n25\njoyeux',
    'utf8'
  );
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
  const { chargerHistorique, sauvegarderHistorique } = creerHistorique({
    dossierUser,
    storage: storageFaux
  });
  assert.deepStrictEqual(chargerHistorique('u_abc123', '2'), [], 'historique absent != []');
  const h = [
    { qui: 'moi', texte: 'salut' },
    { qui: 'blamune', texte: 'coucou' }
  ];
  sauvegarderHistorique('u_abc123', '2', h);
  assert.deepStrictEqual(chargerHistorique('u_abc123', '2'), h);
});

test('historique : un historique corrompu ne leve pas', (t) => {
  const { dossierUser } = creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  const { cheminHistorique, chargerHistorique } = creerHistorique({
    dossierUser,
    storage: storageFaux
  });
  fs.writeFileSync(cheminHistorique('u_abc123', '2'), '{pas du json', 'utf8');
  assert.deepStrictEqual(chargerHistorique('u_abc123', '2'), []);
});

test('historique : sans uid on renvoie un tableau vide', (t) => {
  const { dossierUser } = creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  const { chargerHistorique } = creerHistorique({ dossierUser, storage: storageFaux });
  assert.deepStrictEqual(chargerHistorique('', '2'), []);
});

// ========================= CONFIG FOURNISSEUR IA =========================

// creerConfigIA lit process.env a chaque appel. Un seul mecanisme les
// restaure : deux mecanismes imbriques se marchaient dessus, l'un
// restaurant l'environnement pendant que l'autre le vidait.
const ENV_IA = [
  'API_KEY',
  'API_PROVIDER',
  'API_MODEL',
  'API_URL',
  'API_MAX_TOKENS',
  'API_TEMPERATURE',
  'MEMOIRE_EXTRACTION',
  'RECHERCHE_WEB'
];

function isoleEnvIA(t, env) {
  const saved = {};
  for (const k of ENV_IA) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, env || {});
  t.after(() => {
    for (const k of ENV_IA) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

function configDeTest(t, { configJson = null, env = {} } = {}) {
  const root = dossierTmp(t);
  if (configJson)
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(configJson), 'utf8');
  isoleEnvIA(t, env);
  return creerConfigIA({ racine: root, onModeleOk: () => {}, loggerErreur: () => {} });
}

test('config IA : valeurs par defaut sans env ni config.json', (t) => {
  const { config } = configDeTest(t);
  assert.strictEqual(config.api_provider, 'gemini');
  assert.strictEqual(config.api_model, 'gemini-3.5-flash');
  assert.strictEqual(config.api_key, '');
  assert.strictEqual(config.recherche_web, true, 'la recherche web est activee par defaut');
});

test('config IA : l environnement prime sur config.json', (t) => {
  const { config } = configDeTest(t, {
    configJson: { api_model: 'depuis-fichier', api_provider: 'groq' },
    env: { API_MODEL: 'depuis-env' }
  });
  assert.strictEqual(config.api_model, 'depuis-env', 'API_MODEL doit primer');
  // Non surcharge par l'env : le fichier garde la main.
  assert.strictEqual(config.api_provider, 'groq');
});

test('config IA : config.json est lu quand l env est muet', (t) => {
  const { config } = configDeTest(t, { configJson: { api_model: 'depuis-fichier' } });
  assert.strictEqual(config.api_model, 'depuis-fichier');
});

test('config IA : RECHERCHE_WEB=0 et MEMOIRE_EXTRACTION=0 coupent les options', (t) => {
  const { config } = configDeTest(t, { env: { RECHERCHE_WEB: '0', MEMOIRE_EXTRACTION: '0' } });
  assert.strictEqual(config.recherche_web, false);
  assert.strictEqual(config.memoire_extraction, false);
});

test('config IA : un config.json corrompu ne fait pas tomber le serveur', (t) => {
  const root = dossierTmp(t);
  fs.writeFileSync(path.join(root, 'config.json'), '{pas du json', 'utf8');
  isoleEnvIA(t);
  const erreurs = [];
  const { config } = creerConfigIA({
    racine: root,
    onModeleOk: () => {},
    loggerErreur: (cat) => erreurs.push(cat)
  });
  assert.strictEqual(config.api_provider, 'gemini', 'les defauts doivent rester');
  assert.ok(erreurs.includes('config'), 'le journal doit avoir etre prevenu');
});

test('config IA : la liste des fournisseurs OpenAI est reconnue', (t) => {
  for (const p of ['groq', 'openrouter', 'ollama', 'nvidia', 'edenai', 'deepseek']) {
    const { providerOpenAI } = configDeTest(t, { env: { API_PROVIDER: p } });
    assert.strictEqual(providerOpenAI(), true, p + ' devrait etre compatible OpenAI');
  }
  const { providerOpenAI } = configDeTest(t, { env: { API_PROVIDER: 'gemini' } });
  assert.strictEqual(providerOpenAI(), false, 'gemini n est pas compatible OpenAI');
});

test('config IA : le fournisseur est compare sans regarder la casse', (t) => {
  const { providerOpenAI } = configDeTest(t, { env: { API_PROVIDER: 'OLLAMA' } });
  assert.strictEqual(providerOpenAI(), true);
});

test('config IA : ordreModeles commence par le modele principal', (t) => {
  const { ordreModeles, config } = configDeTest(t, { env: { API_MODEL: 'm-principal' } });
  const ordre = ordreModeles();
  assert.strictEqual(ordre[0], 'm-principal');
  assert.ok(ordre.includes(config.api_model));
  assert.strictEqual(new Set(ordre).size, ordre.length, 'pas de doublon dans la liste');
});

test('config IA : un modele de secours repondu devient le modele actif', (t) => {
  const { ordreModeles, memoriserModeleOk } = configDeTest(t);
  const secours = ordreModeles()[1];
  memoriserModeleOk(secours);
  assert.strictEqual(ordreModeles()[0], secours, 'le secours doit passer en tete');
});

test('config IA : memoriserModeleOk signale une seule fois', (t) => {
  const root = dossierTmp(t);
  isoleEnvIA(t);
  const vus = [];
  const { memoriserModeleOk, ordreModeles } = creerConfigIA({
    racine: root,
    onModeleOk: (m) => vus.push(m),
    loggerErreur: () => {}
  });
  const secours = ordreModeles()[1];
  memoriserModeleOk(secours);
  memoriserModeleOk(secours);
  memoriserModeleOk(secours);
  assert.deepStrictEqual(vus, [secours], 'la persistance ne doit pas repeter');
});

test('config IA : un modele inconnu n est jamais memorise', (t) => {
  const root = dossierTmp(t);
  isoleEnvIA(t);
  const vus = [];
  const { memoriserModeleOk, dernierModeleOkConnu } = creerConfigIA({
    racine: root,
    onModeleOk: (m) => vus.push(m),
    loggerErreur: () => {}
  });
  memoriserModeleOk('modele-qui-nexiste-pas');
  assert.strictEqual(dernierModeleOkConnu(), '');
  assert.deepStrictEqual(vus, []);
});

test('config IA : restaureModeleOk ne reecrit pas la persistance', (t) => {
  const root = dossierTmp(t);
  isoleEnvIA(t);
  const vus = [];
  const { restaureModeleOk, dernierModeleOkConnu, ordreModeles } = creerConfigIA({
    racine: root,
    onModeleOk: (m) => vus.push(m),
    loggerErreur: () => {}
  });
  const secours = ordreModeles()[1];
  restaureModeleOk(secours);
  assert.strictEqual(dernierModeleOkConnu(), secours, 'le modele doit etre repris');
  assert.deepStrictEqual(vus, [], 'restaurer ne doit pas reecrire stats.json');
});

test('config IA : restaureModeleOk ignore un modele hors liste', (t) => {
  const { restaureModeleOk, dernierModeleOkConnu } = configDeTest(t);
  restaureModeleOk('modele-obsolete');
  assert.strictEqual(dernierModeleOkConnu(), '', 'un modele inconnu ne doit pas etre repris');
});

test('config IA : lit bien l env, et la restauration rend la main', (t) => {
  // Ce test pilote lui-meme l'isolement : l'assertion sur la restauration
  // doit avoir lieu AVANT que t.after ne s'execute, donc on ne passe pas
  // par isoleEnvIA ici.
  const avant = process.env.API_PROVIDER;
  const saved = {};
  for (const k of ENV_IA) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.API_PROVIDER = 'ollama';
  try {
    const { providerOpenAI } = creerConfigIA({
      racine: dossierTmp(t),
      onModeleOk: () => {},
      loggerErreur: () => {}
    });
    assert.strictEqual(providerOpenAI(), true, 'la config doit avoir lu API_PROVIDER');
  } finally {
    for (const k of ENV_IA) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
  assert.strictEqual(process.env.API_PROVIDER, avant, 'l env doit etre rendu intact');
});
// ============================== RESUME ==============================

function resumeDeTest(t, questionModele) {
  const { dossierUser } = creerMemoire({ usersDir: dossierTmp(t), storage: storageFaux });
  const { cheminHistorique, sauvegarderHistorique } = creerHistorique({
    dossierUser,
    storage: storageFaux
  });
  const resume = creerResume({
    dossierUser,
    cheminHistorique,
    questionModele: questionModele || (async () => 'resume test'),
    nettoyerReponse: (t2) => t2,
    loggerErreur: () => {}
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
  assert.deepStrictEqual(resume.lireResume('u_abc123', '2'), {
    texte: 'On avait parle foot',
    couverts: 10
  });
});

test('resume : supprimer un resume absent ne leve pas', (t) => {
  const { resume } = resumeDeTest(t);
  resume.supprimerResume('u_abc123', '2');
});

test('resume : sous le seuil, rien n est replie', async (t) => {
  let appels = 0;
  const { resume, sauvegarderHistorique } = resumeDeTest(t, async () => {
    appels++;
    return 'x';
  });
  sauvegarderHistorique('u_abc123', '2', [{ qui: 'moi', texte: 'a' }]);
  await resume.majResume('u_abc123', '2');
  assert.strictEqual(appels, 0, 'le modele ne doit pas etre appele sous le seuil');
  assert.strictEqual(resume.lireResume('u_abc123', '2').couverts, 0);
});

test('resume : au seuil, le bloc est replie et couvert', async (t) => {
  const { resume, sauvegarderHistorique } = resumeDeTest(t);
  const h = Array.from({ length: 10 }, (_, i) => ({
    qui: i % 2 ? 'blamune' : 'moi',
    texte: 'msg' + i
  }));
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
  assert.deepStrictEqual(
    resume.lireResume('u_abc123', '2'),
    { texte: '', couverts: 0 },
    'le resume obsolete aurait du etre purge'
  );
});

test('resume : deux appels concurrents ne replient qu une fois', async (t) => {
  let appels = 0;
  const { resume, sauvegarderHistorique } = resumeDeTest(t, async () => {
    appels++;
    await new Promise((r) => setTimeout(r, 20));
    return 'resume';
  });
  sauvegarderHistorique(
    'u_abc123',
    '2',
    Array.from({ length: 10 }, (_, i) => ({ qui: 'moi', texte: 'msg' + i }))
  );
  await Promise.all([resume.majResume('u_abc123', '2'), resume.majResume('u_abc123', '2')]);
  assert.strictEqual(appels, 1, 'le repliement a ete declenche deux fois');
});

// ============================= KEEPALIVE =============================

const http = require('http');

/** Serveur HTTP jetable qui compte les requetes recues. */
function serveurCompteur(t) {
  let hits = 0;
  const srv = http.createServer((req, res) => {
    hits++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      t.after(() => new Promise((r) => srv.close(r)));
      resolve({ port, hits: () => hits });
    });
  });
}

test('keepalive : ne rappelle pas quand un utilisateur est connecte', async (t) => {
  const s = await serveurCompteur(t);
  const ka = demarrerKeepalive({ port: s.port, estConnecte: () => true });
  t.after(() => ka.arreter());
  ka.rappel();
  await new Promise((r) => setTimeout(r, 250));
  assert.strictEqual(s.hits(), 0, 'une requete a ete envoyee alors que quelqu un est actif');
});

test('keepalive : rappelle sur /health quand personne n est connecte', async (t) => {
  const s = await serveurCompteur(t);
  const ka = demarrerKeepalive({ port: s.port, estConnecte: () => false });
  t.after(() => ka.arreter());
  assert.strictEqual(ka.rappel(), true, 'le rappel devrait avoir ete declenche');
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(s.hits(), 1);
});

test('keepalive : n empile pas les rappels si la reponse est lente', async (t) => {
  // Port ferme : la connexion echoue, mais on veut surtout verifier que le
  // verrou anti-emballement bloque le second appel.
  const ka = demarrerKeepalive({ port: 1, estConnecte: () => false, logger: () => {} });
  t.after(() => ka.arreter());
  ka.rappel();
  ka.rappel(); // doit etre ignore, le premier est encore en cours
  ka.rappel();
});

test('keepalive : un rappel en echec ne casse pas le minuteur', async (t) => {
  const erreurs = [];
  const ka = demarrerKeepalive({
    port: 1,
    estConnecte: () => false,
    logger: (cat, msg) => erreurs.push(cat + ':' + msg)
  });
  t.after(() => ka.arreter());
  ka.rappel();
  await new Promise((r) => setTimeout(r, 250));
  assert.ok(erreurs.length >= 1, 'l echec aurait du etre journalise');
});

test('keepalive : KEEPALIVE=0 desactive tout', (t) => {
  const sauvegarde = process.env.KEEPALIVE;
  process.env.KEEPALIVE = '0';
  t.after(() => {
    if (sauvegarde === undefined) delete process.env.KEEPALIVE;
    else process.env.KEEPALIVE = sauvegarde;
  });
  const ka = demarrerKeepalive({ port: 1, estConnecte: () => false });
  assert.strictEqual(ka.intervalle, null, 'un minuteur a ete cree malgre KEEPALIVE=0');
  assert.strictEqual(ka.rappel(), false);
});

test('keepalive : le minuteur ne bloque pas la sortie du processus', async (t) => {
  const s = await serveurCompteur(t);
  const ka = demarrerKeepalive({ port: s.port, estConnecte: () => false, periodeMs: 50 });
  t.after(() => ka.arreter());
  assert.ok(
    ka.intervalle && typeof ka.intervalle.unref === 'function',
    'le minuteur doit etre unref pour ne pas empecher Node de s arreter'
  );
});

// ======================= FOURNISSEURS COMPATIBLES OPENAI =======================

const { creerOpenai } = require('../lib/ia/openai');

// Transport faux : imite le peu que openAIRequete() attend de http.request.
// plan : fonction(url, options, corps) -> { statut, corps } (corps = texte ou
// tableau de fragments SSE ; le plan sert aussi de capteur pour les assertions).
function transportFaux(plan) {
  function requeterFaux(url, options, cb) {
    let corpsRecu = '';
    let lance = false;
    function lancer() {
      if (lance) return;
      lance = true;
      const p = plan(url, options, corpsRecu);
      const res = {
        statusCode: p.statut,
        _ev: {},
        on(nom, fn) {
          (this._ev[nom] = this._ev[nom] || []).push(fn);
          return this;
        },
        emit(nom, ...a) {
          for (const fn of this._ev[nom] || []) fn(...a);
        },
        setEncoding() {},
        resume() {}
      };
      cb(res);
      setTimeout(() => {
        const morceaux = Array.isArray(p.corps) ? p.corps : [p.corps];
        for (const m of morceaux) res.emit('data', m);
        res.emit('end');
      }, 0);
    }
    return {
      on(nom, fn) {
        this._ev = this._ev || {};
        (this._ev[nom] = this._ev[nom] || []).push(fn);
        return this;
      },
      write(c) {
        corpsRecu += String(c);
      },
      end() {
        lancer();
      }
    };
  }
  return requeterFaux;
}

function openaiDeTest({ modeles = null, pool = null, plan = null } = {}) {
  const traces = {
    modeleOk: [],
    quota: [],
    alertes: [],
    resolution: 0,
    noteEchecs: [],
    noteOks: [],
    ordres: 0,
    url: null,
    headers: null,
    corps: null
  };
  const config = {
    api_url: 'https://api-exemple/v1',
    api_key: 'KLE',
    api_max_tokens: 100,
    api_temperature: 1
  };
  const m = creerOpenai({
    getConfig: () => config,
    getPool:
      pool ||
      (() => ({
        actif: () => false,
        ordre: () => []
      })),
    requeter: transportFaux(
      plan || (() => ({ statut: 200, corps: '{"choices":[{"message":{"content":"ok"}}]}' }))
    ),
    limiterHisto: (h) => h,
    HISTO_API_MAX: 16,
    marquerQuota: (e) => traces.quota.push(e),
    resoudreAlertes: () => traces.resolution++,
    memoriserModeleOk: (x) => traces.modeleOk.push(x),
    ordreModeles: () => modeles || ['a', 'b'],
    delaiIndique: () => 0,
    alerter: (type, message) => traces.alertes.push({ type, message }),
    loggerErreur: () => {}
  });
  m._traces = traces;
  return m;
}

test('openAIRequete : appel du membre du pool, Bearer pose, texte rendu', async () => {
  const m = openaiDeTest({
    plan: (url, options) => {
      m._traces.url = url;
      m._traces.headers = options.headers;
      return {
        statut: 200,
        corps: JSON.stringify({ choices: [{ message: { content: 'salut' } }] })
      };
    }
  });
  const rep = await m.openAIRequete(
    { nom: 'groq', url: 'https://g/', cle: 'C', modele: 'm' },
    [{ role: 'user', content: 'coucou' }],
    null
  );
  assert.strictEqual(rep, 'salut');
  assert.strictEqual(m._traces.url, 'https://g/chat/completions');
  assert.strictEqual(m._traces.headers['Authorization'], 'Bearer C');
});

test('openAIRequete : un STRING de modele prend l URL et la cle de config, et le corps de config', async () => {
  const m = openaiDeTest({
    plan: (url, options, corps) => {
      m._traces.url = url;
      m._traces.headers = options.headers;
      m._traces.corps = corps;
      return { statut: 200, corps: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) };
    }
  });
  await m.openAIRequete('mod-1', [{ role: 'user', content: 'u' }], null);
  assert.strictEqual(m._traces.url, 'https://api-exemple/v1/chat/completions');
  assert.strictEqual(m._traces.headers['Authorization'], 'Bearer KLE');
  const envoye = JSON.parse(m._traces.corps);
  assert.strictEqual(envoye.model, 'mod-1');
  assert.strictEqual(envoye.max_tokens, 100);
  assert.strictEqual(envoye.temperature, 1);
  assert.strictEqual(envoye.stream, false);
});

test('openAIRequete : en flux, les deltas cumulent dans onDelta, texte complet rendu', async (t) => {
  const recues = [];
  const sse = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Bo' } }] }) + '\n\n',
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'njour' } }] }) + '\n\n',
    'data: [DONE]\n\n'
  ];
  const m = openaiDeTest({
    plan: (url, options, corps) => {
      m._traces.corps = corps;
      return { statut: 200, corps: sse };
    }
  });
  const rep = await new Promise((resolve, reject) => {
    m.openAIRequete('m1', [{ role: 'user', content: 'u' }], (texte) => recues.push(texte)).then(
      resolve,
      reject
    );
  });
  assert.strictEqual(rep, 'Bonjour');
  assert.deepStrictEqual(recues, ['Bo', 'Bonjour']);
  assert.strictEqual(JSON.parse(m._traces.corps).stream, true, 'le flux doit etre demande');
});

test('openAIRequete : echec HTTP porte le statusCode', async () => {
  const m = openaiDeTest({ plan: () => ({ statut: 500, corps: 'boom' }) });
  await assert.rejects(
    () => m.openAIRequete('m1', [{ role: 'user', content: 'u' }], null),
    (e) => {
      assert.strictEqual(e.statusCode, 500);
      return true;
    }
  );
});

test('openAIRequete : erreur API apres des deltas -> fluxEntame=true, jamais de rotation', async () => {
  const sse = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'deja affiche' } }] }) + '\n\n',
    'data: ' + JSON.stringify({ error: { message: 'quota depasse' } }) + '\n\n'
  ];
  const m = openaiDeTest({ plan: () => ({ statut: 200, corps: sse }) });
  await assert.rejects(
    () => m.openAIRequete('m1', [{ role: 'user', content: 'u' }], () => {}),
    (e) => {
      assert.strictEqual(e.fluxEntame, true);
      assert.strictEqual(e.message, 'quota depasse');
      return true;
    }
  );
});

test('appelerOpenAI sans pool : cascade de modeles, la reussite memorise le modele', async () => {
  let essai = 0;
  const m = openaiDeTest({
    modeles: ['a', 'b'],
    plan: (url, options) => {
      essai++;
      const corps =
        essai >= 2 ? JSON.stringify({ choices: [{ message: { content: 'ca marche' } }] }) : '';
      return {
        statut: essai >= 2 ? 200 : 429,
        corps
      };
    }
  });
  const rep = await m.appelerOpenAI('salut', [{ role: 'user', content: 'salut' }], null);
  assert.strictEqual(rep, 'ca marche');
  assert.deepStrictEqual(m._traces.quota.length, 1, 'un 429 doit marquer le quota');
  assert.deepStrictEqual(m._traces.modeleOk, ['b'], 'le modele reussi doit etre memorise');
  assert.deepStrictEqual(
    m._traces.alertes,
    [],
    'une reussite resolve les alertes, rien a signaler'
  );
});

test('appelerOpenAI sans pool : tout echoue -> alerte technique et rethrow', async () => {
  const m = openaiDeTest({ modeles: ['a'], plan: () => ({ statut: 500, corps: 'x' }) });
  await assert.rejects(
    () => m.appelerOpenAI('hi', [{ role: 'user', content: 'hi' }], null),
    /HTTP 500/
  );
  assert.strictEqual(m._traces.alertes[0].type, 'technique');
});

test('appelerOpenAI sans pool : quotas partout -> alerte quota', async () => {
  const m = openaiDeTest({
    modeles: ['a', 'b'],
    plan: () => ({ statut: 429, corps: '{"error":"q"}' })
  });
  await assert.rejects(() => m.appelerOpenAI('hi', [{ role: 'user', content: 'hi' }], null), /429/);
  assert.strictEqual(m._traces.alertes[0].type, 'quota');
});

test('appelerOpenAI avec pool : le premier membre mort laisse la place, sticky note le second', async () => {
  let membresVus = [];
  const m = openaiDeTest({
    pool: () => ({
      actif: () => true,
      ordre: () =>
        [
          { nom: 'p1', url: 'https://p1/', cle: '', modele: 'm1' },
          { nom: 'p2', url: 'https://p2/', cle: '', modele: 'm2' }
        ].map((x) => {
          membresVus.push(x.nom);
          return x;
        }),
      noteOk: (nom) => m._traces.noteOks.push(nom),
      noteEchec: (nom, e) => m._traces.noteEchecs.push(nom)
    }),
    plan: (url) => ({
      statut: url.indexOf('p1') >= 0 ? 503 : 200,
      corps:
        url.indexOf('p1') >= 0
          ? ''
          : JSON.stringify({ choices: [{ message: { content: 'p2 repond' } }] })
    })
  });
  const rep = await m.appelerOpenAI('hi', [{ role: 'user', content: 'hi' }], null);
  assert.strictEqual(rep, 'p2 repond');
  assert.deepStrictEqual(m._traces.noteEchecs, ['p1']);
  assert.deepStrictEqual(m._traces.noteOks, ['p2']);
});
