// Tests d'integration BLAMUNE.
// Lance le VRAI server.js avec :
//   - un faux modele Gemini local (aucun appel internet, aucune cle requise),
//   - un dossier de donnees temporaire (aucune touche aux vraies donnees).
//
//   node tests/run.js        ou    npm test
//
// Couvre : decouverte du modele (URL), apprentissage mode 2, extraction par
// le modele, resume de conversation, anniversaire, promesses, reprise sur
// quota (429), historique compact, journal des erreurs, ancien API_URL.

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
const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

let appels = 0;
let nbExtractions = 0;
let failProchain = false;
let failQuota = false;   // 429 style Google ("retry in 45s") sur le prochain chat
let modeleQuota = null;  // modele qui a recu ce 429
let modeleReponse = null; // modele qui a fini par repondre
// Trois types de requetes distinctes, on garde la derniere de chaque.
let dernierChat = null;       // message de conversation (prompt BLAMUNE)
let derniereExtraction = null; // tache d'extraction de faits
let dernierResume = null;      // pliage du resume de conversation
const journalExtractions = []; // debug : dernieres consignes d'extraction recues

function librePort() {
  return 20000 + Math.floor(Math.random() * 20000);
}

function attendre(ms) { return new Promise(r => setTimeout(r, ms)); }

// Attends qu'une condition soit vraie (taches de fond : jamais de delai fige).
async function condition(fn, ms, message) {
  const debut = Date.now();
  while (Date.now() - debut < ms) {
    if (fn()) return;
    await attendre(100);
  }
  throw new Error('trop long : ' + message);
}

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

function repondre(res, texte) {
  const paquet = { candidates: [{ content: { parts: [{ text: texte }] } }] };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(paquet));
}

// ---- Faux Gemini : repond selon la nature de la requete ----
const mock = http.createServer((req, res) => {
  let data = '';
  req.on('data', c => data += c);
  req.on('end', () => {
    appels++;
    let corps = null;
    try { corps = JSON.parse(data); } catch (e) {}
    const demande = corps && corps.contents ? JSON.stringify(corps.contents) : '';
    // Les taches de fond (extraction, resume) ne doivent jamais absorber le
    // 429 injecte : seul un appel de conversation doit le consommer.
    const tacheDeFond = demande.indexOf('EXTRACTION-FACTS') >= 0 ||
      demande.indexOf('RESUME-CONVERSATION') >= 0;
    const modeleVu = ((req.url || '').match(/models\/([^/:]+)/) || [])[1] || '?';
    if (failProchain && !tacheDeFond) {
      failProchain = false;
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'quota depasse (test)' } }));
      return;
    }
    // Quota reel Google : il indique la vraie duree d'attente dans le message.
    if (failQuota && !tacheDeFond) {
      failQuota = false;
      modeleQuota = modeleVu;
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: ' + modeleVu + ' Please retry in 45.411629042s.' } }));
      return;
    }

    // Tache de fond d'extraction : le serveur attend un objet JSON de faits.
    // Le modele "invente" un fait uniquement si le message en contient un
    // (sinon il repond {} comme le demandait la consigne).
    if (demande.indexOf('EXTRACTION-FACTS') >= 0) {
      derniereExtraction = corps;
      nbExtractions++;
      journalExtractions.push(Date.now() + ' ...' + demande.substring(demande.length - 260));
      return repondre(res, demande.indexOf('Maeva') >= 0
        ? '{"nom":"Maeva","ville":"Bordeaux"}' : '{}');
    }
    // Pliage du resume : le serveur attend une phrase de resume.
    if (demande.indexOf('RESUME-CONVERSATION') >= 0) {
      dernierResume = corps;
      return repondre(res, 'Tous deux ont parle de foot et de son anniversaire.');
    }
    if (demande.indexOf('CONSCIENCE DE SOI') >= 0) { dernierChat = corps; modeleReponse = modeleVu; }

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

function envoiFils(pid) {
  return new Promise(resolve => {
    if (!pid || pid.exitCode !== null) return resolve();
    pid.on('exit', () => resolve());
    pid.kill();
    setTimeout(resolve, 3000);
  });
}

function promptTexte() {
  return dernierChat && dernierChat.contents ? JSON.stringify(dernierChat.contents) : '';
}

// Reecrit l'etat interieur pour tester les dates de la relation
// (premierContact, dernierContact, souvenirs) sans attendre le temps reel.
function ecrireEtat(dirUid, champs) {
  const base = { premierContact: 0, dernierContact: 0, sessions: 4, souvenirs: [], messages: 12 };
  fs.writeFileSync(path.join(dirUid, 'etat_blamune.json'),
    JSON.stringify(Object.assign(base, champs)), 'utf8');
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
    const dirUid = path.join(dataDir, 'users', uid);
    ok.push('invite ' + uid);

    const envoyer = (msg) => requete(PORT_APP, '/send', 'POST', 'msg=' + encodeURIComponent(msg) + '&mode=2', h);

    // 2. Premier message : prompt de personnalite + contexte temps reel
    const m1 = await envoyer("je m'appelle Theo");
    assert.strictEqual(m1.status, 200, 'envoi 1 en 200');
    assert(m1.json.reponses && m1.json.reponses[0].indexOf('Reponse test') >= 0, 'reponse du modele presente');
    assert(promptTexte().indexOf('CONSCIENCE DE SOI') >= 0, 'prompt BLAMUNE present');
    assert(promptTexte().indexOf('CONTEXTE TEMPS REEL') >= 0, 'contexte temps reel present');
    ok.push('prompt mode 2 construit');

    // 3. Apprentissage : le prenom dit il y a 2s est deja dans le prompt,
    //    ainsi que le compteur de messages partages.
    const m2 = await envoyer('tu te souviens de mon nom ?');
    assert.strictEqual(m2.status, 200);
    assert(promptTexte().indexOf('Theo') >= 0, 'nom appris injecte dans le prompt');
    assert(promptTexte().indexOf('INFOS SUR L\'UTILISATEUR') >= 0, 'bloc profil present');
    assert(promptTexte().indexOf('Vous vous etes deja echanges 2 messages') >= 0, 'compteur de messages');
    ok.push('apprentissage immediat + compteur de messages');

    // 3bis. Une question sur le nom ne doit pas ecraser le nom appris
    await envoyer("comment je m'appelle deja ?");
    assert(promptTexte().indexOf('Theo') >= 0, 'nom preserve apres une question');
    assert(promptTexte().indexOf('Deja') < 0, 'mot de question jamais pris pour un nom');
    ok.push('question sur le nom : nom preserve');

    // 4. Historique compact
    const fHist = path.join(dirUid, 'historique_mode2.json');
    assert(fs.existsSync(fHist), 'historique ecrit sur disque');
    const brut = fs.readFileSync(fHist, 'utf8');
    assert(brut.indexOf('\n  {') < 0, 'historique compact (sans indentation)');
    assert(JSON.parse(brut).length >= 3, 'historique lisible');
    ok.push('historique compact');

    // 5. Anniversaire : appris au meme message, annonce si proche
    const dans10 = new Date(Date.now() + 10 * 86400000);
    await envoyer('mon anniversaire est le ' + dans10.getDate() + ' ' + MOIS[dans10.getMonth()]);
    assert(promptTexte().indexOf('ANNIVERSAIRE') >= 0, 'anniversaire detecte et annonce');
    assert(promptTexte().indexOf('dans 10 jours') >= 0, 'denombrement des jours');
    ok.push('anniversaire (dans 10 jours)');

    // 5bis. Rituels et jalons de la relation
    const ilYa7 = Date.now() - 7 * 86400000;
    ecrireEtat(dirUid, { premierContact: ilYa7, dernierContact: Date.now() - 3600000 });
    await envoyer('un petit test de date');
    assert(promptTexte().indexOf('JALON DE VOTRE RENCONTRE') >= 0, 'jalon annonce au prompt');
    assert(promptTexte().indexOf('exactement une semaine') >= 0,
      'libelle du jalon: ' + JSON.stringify(promptTexte().match(/JALON[^\"]{0,120}/)));
    ok.push('jalon relation (une semaine)');

    const ilYa1an = new Date();
    ilYa1an.setFullYear(ilYa1an.getFullYear() - 1);
    ecrireEtat(dirUid, { premierContact: ilYa1an.getTime(), dernierContact: Date.now() - 3600000 });
    await envoyer('un deuxieme test de date');
    assert(promptTexte().indexOf('exactement un an') >= 0, 'jalon d\'un an');
    ok.push('jalon relation (un an)');

    ecrireEtat(dirUid, {
      premierContact: ilYa1an.getTime(), dernierContact: Date.now() - 3600000,
      souvenirs: [{ ts: ilYa1an.getTime(), texte: 'ses examens ou resultats' }]
    });
    await envoyer('tu te souviens de mes revisions de l annee derniere');
    assert(promptTexte().indexOf('REVIVRE UN SOUVENIR') >= 0, 'anniversaire du souvenir annonce');
    assert(promptTexte().indexOf('ses examens') >= 0, 'sujet du souvenir present');
    ok.push('anniversaire d\'un souvenir');

    ecrireEtat(dirUid, {
      premierContact: Date.now() - 2 * 86400000,
      dernierContact: Date.now() - 26 * 3600000, souvenirs: []
    });
    await envoyer('bonjour toi');
    assert(promptTexte().indexOf('RITUELS') >= 0, 'rituel annonce au premier echange du jour');
    await envoyer('un deuxieme message de la journee');
    assert(promptTexte().indexOf('RITUELS') < 0, 'rituel absent du deuxieme message du jour');
    ok.push('rituel du jour (present puis absent)');

    // 6. Promesse : "rappelle-moi de..." est retenu et injecte
    await envoyer("rappelle-moi de t'envoyer ma photo demain");
    assert(promptTexte().indexOf('PROMESSES') >= 0, 'promesse retenue');
    assert(promptTexte().indexOf('photo') >= 0, 'contenu de la promesse');
    ok.push('promesse retenue');

    // 7. Extraction par le modele (regex seules : aucune correspondance)
    const avantExtraction = nbExtractions;
    await envoyer("au fait je crois que je ne t'ai pas dit, c'est Maeva");
    // Tache de fond : la requete part juste apres la reponse, puis l'ecriture
    // de la memoire suit. On attend la condition, pas un delai au hasard.
    await condition(() => nbExtractions > avantExtraction, 4000,
      'appel d\'extraction envoye au modele');
    const fMemoire = path.join(dirUid, 'memoire.txt');
    await condition(() => fs.existsSync(fMemoire) &&
      fs.readFileSync(fMemoire, 'utf8').indexOf('Bordeaux') >= 0, 4000,
      'fait extrait ecrit dans memoire.txt');
    ok.push('extraction par le modele (appel + ecriture)');
    await envoyer('super, et tu as bien tout retenu ?');
    const memoireTexte = fs.existsSync(fMemoire) ? fs.readFileSync(fMemoire, 'utf8') : '(absent)';
    assert(promptTexte().indexOf('Maeva') >= 0,
      'fait extrait par le modele injecte â€” memoire: ' + JSON.stringify(memoireTexte));
    assert(promptTexte().indexOf('Bordeaux') >= 0,
      'second fait extrait â€” memoire: ' + JSON.stringify(memoireTexte));
    ok.push('extraction par le modele (Maeva, Bordeaux)');

    // 8. Resume de conversation : les anciens echanges sont plies puis relus
    await condition(() => dernierResume, 4000, 'pliage du resume demande au modele');
    const fResume = path.join(dirUid, 'resume_mode2.json');
    await condition(() => fs.existsSync(fResume), 4000, 'fichier resume cree');
    const resume = JSON.parse(fs.readFileSync(fResume, 'utf8'));
    assert(resume.couverts >= 10, 'au moins 10 echanges plies, recu: ' + resume.couverts);
    assert(resume.texte && resume.texte.length > 10, 'texte du resume non vide');
    await envoyer('tu te souviens de tout ce qu on s est dit ?');
    assert(promptTexte().indexOf('CE QUE VOUS AVIEZ DIT AVANT') >= 0, 'resume injecte dans le prompt');
    assert(promptTexte().indexOf('foot') >= 0, 'contenu du resume present');
    ok.push('resume de conversation (couverts=' + resume.couverts + ')');

    // 9. Mode 1 (EGO) fonctionne aussi
    const e1 = await requete(PORT_APP, '/send', 'POST', 'msg=salut&mode=1', h);
    assert.strictEqual(e1.status, 200);
    ok.push('mode 1 EGO ok');

    // 10. Reprise sur quota : 429 puis succes. Place ici (et non au debut) :
    //     un 429 met les taches de fond en veille 60 s, on ne veut pas
    //     bloquer les tests d'extraction et de resume qui viennent avant.
    const avant = appels;
    failProchain = true;
    const m3 = await envoyer('ca va ?');
    assert.strictEqual(m3.status, 200, 'reponse apres 429');
    assert(m3.json.reponses && m3.json.reponses[0].indexOf('Reponse test') >= 0, 'texte present apres reprise');
    assert(appels - avant >= 2, 'la requete a ete retentee');
    ok.push('reprise sur 429 (2 appels)');

    // 11. Quota reel Google : on ne patiente pas 45 s, la cascade change
    //       de modele (chaque modele a son propre quota).
    failQuota = true;
    const q1 = await envoyer('bonjour une deuxieme fois');
    assert.strictEqual(q1.status, 200, 'reponse malgre le quota du modele principal');
    assert(q1.json.reponses && q1.json.reponses[0].indexOf('Reponse test') >= 0,
      'texte present apres cascade: ' + q1.texte.substring(0, 150));
    assert(modeleQuota && modeleReponse && modeleQuota !== modeleReponse,
      'autre modele utilise (quota=' + modeleQuota + ', reponse=' + modeleReponse + ')');
    ok.push('quota Google : cascade sur ' + modeleReponse + ' sans attendre 45 s');

    // 12. Les taches de fond attendent le rechargement de la fenetre de
    //        quota au lieu de crever le quota une seconde fois.
    const avantExtQuota = nbExtractions;
    await envoyer('un petit nom pour ce joli oiseau bleu');
    await attendre(1500);
    assert.strictEqual(nbExtractions, avantExtQuota,
      'extraction en veille apres quota (recues=' + nbExtractions + ')');
    ok.push('taches de fond en veille apres un 429');

    // 13. Journal des erreurs : visible par l'admin
    const login = await requete(PORT_APP, '/login', 'POST', 'pseudo=admin&mdp=%40clotaire%232012');
    assert(login.json && login.json.ok, 'login admin: ' + login.texte.substring(0, 120));
    const logs = await requete(PORT_APP, '/admin/logs', 'GET', null,
      { 'X-UID': login.json.uid, 'X-EGO': login.json.ego });
    assert.strictEqual(logs.status, 200, 'lecture des logs admin');
    assert(Array.isArray(logs.json.lignes), 'logs en tableau');
    ok.push('journal erreurs: ' + logs.json.lignes.length + ' ligne(s)'
      + (logs.json.lignes.length ? ' -> ' + JSON.stringify(logs.json.lignes[0]) : ''));

    // 14. Fichiers sensibles non servis
    const fuite = await requete(PORT_APP, '/logs/erreurs.log', 'GET');
    assert.strictEqual(fuite.status, 404, 'logs non servis en public');
    ok.push('logs non exposes publiquement');

    // 15. Compat : ancien format API_URL (URL complete avec :generateContent)
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
    if (journalExtractions.length) {
      console.error('\n--- extractions recues (' + journalExtractions.length + ', nbExtractions=' + nbExtractions + ') ---');
      journalExtractions.forEach((j, i) => console.error('[' + i + '] ' + j));
    }
    process.exitCode = 1;
  } finally {
    await envoiFils(serveur);
    mock.close();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
  }
}

main();
