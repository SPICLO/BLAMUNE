// ====================================================================
//  Tests unitaires : ordre des taches de fond de /send
// ====================================================================
//  Bug corrige : majResume et extraireAvecModele partagent la MEME memoire
//  (memoire.txt). Lancees cote a cote au meme tour, leurs deux appels
//  modele se croisent et la tache qui ecrit en dernier ecrase le fait
//  appris par l'autre : un fait extrait pouvait manquer au prompt du
//  message suivant (constate par la suite d'integration).
//
//  La regle verifiee ici : l'extraction ne part JAMAIS avant la fin du
//  resume deja lance. C'est ce que peut prouver un test pur, sans vrai
//  serveur, sans disque et sans modele.
// ====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequencerExtraction } = require('../lib/routes/send');

test('extraction : attend la fin du resume en cours', async () => {
  const ordre = [];
  let finirResume;
  const resume = new Promise((r) => {
    finirResume = r;
  });
  const tachesResume = new Map([['u1', resume]]);
  // reporterTache lance immediatement, comme en l'absence de tension.
  const reporterTache = (fn) => fn();

  const fini = sequencerExtraction({
    tachesResume,
    reporterTache,
    uid: 'u1',
    msg: 'c est Maeva',
    extraire: async (uid, msg) => ordre.push('extraction:' + msg)
  });

  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(ordre, [], "l'extraction ne part pas avant la fin du resume");
  finirResume();
  await fini;
  assert.deepEqual(ordre, ['extraction:c est Maeva']);
});

test('extraction : part tout de suite sans resume en cours', async () => {
  const ordre = [];
  await sequencerExtraction({
    tachesResume: new Map(),
    reporterTache: (fn) => fn(),
    uid: 'u2',
    msg: 'bonjour',
    extraire: async () => ordre.push('extraction')
  });
  assert.deepEqual(ordre, ['extraction']);
});

test('extraction : un resume en ECHEC ne bloque pas l extraction', async () => {
  const ordre = [];
  const resume = Promise.reject(new Error('quota'));
  resume.catch(() => {});
  const tachesResume = new Map([['u3', resume]]);

  await sequencerExtraction({
    tachesResume,
    reporterTache: (fn) => fn(),
    uid: 'u3',
    msg: 'j habite Bordeaux',
    extraire: async () => ordre.push('extraction')
  });

  assert.deepEqual(ordre, ['extraction'], "le rejet du resume est traite par l'extraction");
});

test('extraction : chaque envoi est transmis avec son propre message', async () => {
  const vus = [];
  const tachesResume = new Map();
  const extraire = async (uid, msg) => vus.push(uid + ':' + msg);

  await sequencerExtraction({
    tachesResume,
    reporterTache: (fn) => fn(),
    uid: 'a',
    msg: 'm1',
    extraire
  });
  await sequencerExtraction({
    tachesResume,
    reporterTache: (fn) => fn(),
    uid: 'b',
    msg: 'm2',
    extraire
  });

  assert.deepEqual(vus, ['a:m1', 'b:m2']);
});

test('extraction : reporterTache en veille (eco) ne lance rien', async () => {
  let appele = false;
  await sequencerExtraction({
    tachesResume: new Map(),
    // reporterTache jette la tache quand la tension suspend le fond.
    reporterTache: () => {},
    uid: 'u4',
    msg: 'retiens que je suis en eco',
    extraire: async () => {
      appele = true;
    }
  });
  assert.equal(appele, false, 'une tache suspendue ne part pas');
});
