// =====================================================================
//  Tests de la purge automatique des invites (lib/purge_invites.js)
// =====================================================================
//  Lancement : node --test tests/purge_invites.test.js
//  Aucun reseau, aucune vraie donnee perdue : fixtures dans un dossier
//  temporaire, jetons en memoire, cloud et RAM = enregistreurs.
// =====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { creerPurgeInvites } = require('../lib/purge_invites');

const VIE = 48 * 3600000; // 48 h, defaut de production (86400000 = un JOUR)
const VIEUX_JETON = Date.now() - 3 * 86400000; // il y a 3 jours
const FRAIS_JETON = Date.now() - 3600000; // il y a 1 h

// Invites hex 24 caracteres exactement (motif ^inv_[0-9a-f]{24}$) :
const VIEILLE = 'inv_' + 'a'.repeat(24);
const FRAICHE = 'inv_' + '1'.repeat(24);
const SANS_DOSSIER = 'inv_' + '2'.repeat(24);
const MORTE = 'inv_' + 'f'.repeat(24);
const COMPTE_REEL = 'u' + 'a'.repeat(12); // compte enregistre : jamais vise

function fabrique({ jetons = {}, conns = {} } = {}) {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-inv-'));
  const cloud = [];
  const tombstones = [];
  const ram = [];
  const journal = [];
  const purge = creerPurgeInvites({
    usersDir,
    lireJetonsInvites: () => jetons,
    marquerInviteSupprimee: (uid) => tombstones.push(uid),
    supprimerToutCloud: (uid) => cloud.push(uid),
    purgerRamUtilisateur: (uid) => ram.push(uid),
    connexionsActives: conns,
    loggerErreur: (duree, msg) => journal.push(duree + ':' + msg),
    vieInviteMs: VIE,
    intervalleMs: 3600000
  });
  const dossier = (uid) => {
    const d = path.join(usersDir, uid);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'memoire.txt'), 'x', 'utf8');
    return d;
  };
  // L'age du dossier se lit sur son mtime : utimesSync le vieillit sans
  // toucher au temps reel (birthtime reste fres, mais le module ne s'en
  // sert pas : c'est le champ c du jeton qui date la creation).
  const vieux = (uid, jours) => {
    const d = dossier(uid);
    const t = new Date(Date.now() - jours * 86400000);
    fs.utimesSync(d, t, t);
    return d;
  };
  return { purge, usersDir, jetons, conns, dossier, vieux, cloud, tombstones, ram, journal };
}

test('dossier vieux sans jeton : purge dossier, cloud, RAM, tombstone', () => {
  const f = fabrique();
  f.vieux(VIEILLE, 3);
  assert.deepStrictEqual(f.purge.ronde(), [VIEILLE]);
  assert.ok(f.tombstones.includes(VIEILLE), 'pierre tombale posee');
  assert.ok(f.cloud.includes(VIEILLE), 'cloud purge');
  assert.ok(f.ram.includes(VIEILLE), 'RAM purge');
  assert.ok(!fs.existsSync(path.join(f.usersDir, VIEILLE)), 'dossier efface');
});

test('jeton et dossier frais : invite epargnee, aucun effet de bord', () => {
  const f = fabrique({ jetons: { [FRAICHE]: { h: 'x', c: FRAIS_JETON } } });
  f.dossier(FRAICHE);
  assert.deepStrictEqual(f.purge.ronde(), []);
  assert.deepStrictEqual(f.tombstones, []);
  assert.deepStrictEqual(f.cloud, []);
  assert.deepStrictEqual(f.ram, []);
  assert.ok(fs.existsSync(path.join(f.usersDir, FRAICHE)), 'dossier intact');
});

test("jeton vieux sans dossier : purge meme si l'invite n'a jamais discute", () => {
  const f = fabrique({ jetons: { [SANS_DOSSIER]: { h: 'x', c: VIEUX_JETON } } });
  assert.deepStrictEqual(f.purge.ronde(), [SANS_DOSSIER]);
  assert.ok(f.tombstones.length === 1);
});

// Decision du proprietaire : 48 h comptent depuis la CREATION (jeton c),
// l'activite ne reporte rien. Un dossier tout frais ne protege pas.
test('jeton vieux, dossier frais : purge (48h depuis la creation, sans report)', () => {
  const f = fabrique({ jetons: { [VIEILLE]: { h: 'x', c: VIEUX_JETON } } });
  f.dossier(VIEILLE); // mtime = maintenant : « encore en conversation »
  assert.deepStrictEqual(f.purge.ronde(), [VIEILLE]);
  assert.ok(f.tombstones.includes(VIEILLE));
});

test('les comptes reels (u...) ne sont jamais vises, meme tres vieux', () => {
  const f = fabrique();
  f.vieux(COMPTE_REEL, 30);
  assert.deepStrictEqual(f.purge.ronde(), []);
  assert.ok(fs.existsSync(path.join(f.usersDir, COMPTE_REEL)));
});

test('pierre tombale existante : hors course, aucun double marquage', () => {
  const f = fabrique({ jetons: { [MORTE]: { s: VIEUX_JETON } } });
  f.vieux(MORTE, 3);
  assert.deepStrictEqual(f.purge.ronde(), []);
  assert.deepStrictEqual(f.tombstones, [], 'pas de double marquage');
  assert.deepStrictEqual(f.cloud, [], 'pas de purge redite');
  // Le dossier d'une invite deja purgee est hors de la ronde (elle avait
  // ete effacee au moment du marquage ; aucun reunlink n'est retonne).
  assert.ok(fs.existsSync(path.join(f.usersDir, MORTE)), 'dossier intact');
});

test('deux candidates : purgent ensemble, un seul message de synthese', () => {
  const f = fabrique({ jetons: { [VIEILLE]: { h: 'x', c: VIEUX_JETON } } });
  f.jetons[SANS_DOSSIER] = { h: 'x', c: VIEUX_JETON };
  assert.deepStrictEqual(f.purge.ronde().length, 2);
  const messages = f.journal.filter((l) => l.startsWith('purge:'));
  assert.ok(messages.length === 1, 'un seul message de synthese');
  assert.ok(messages[0].includes('2 invite(s)'), 'message : ' + messages[0]);
});

// Correctif A : la chasse des 30 jours de /invite peut oublier un jeton
// encore valide ; le dossier reste, or plus aucun repli ne le reprend.
// La purge le traite comme son invitation (elle meurt a 48 h).
test('dossier orphelin (jeton oublie, aucun enregistrement) : purge a 48 h', () => {
  const f = fabrique();
  const orphelin = 'inv_' + 'e'.repeat(24);
  f.vieux(orphelin, 3);
  assert.deepStrictEqual(f.purge.ronde(), [orphelin]);
  assert.ok(!fs.existsSync(path.join(f.usersDir, orphelin)), 'dossier efface');
  assert.deepStrictEqual(f.tombstones, [orphelin], 'pierre tombale posee');
});

test('dossier orphelin FRAIS (moins de 48 h) : epargne, la re-inscription reste possible', () => {
  const f = fabrique();
  const orphelin = 'inv_' + 'd'.repeat(24);
  f.vieux(orphelin, 1);
  assert.deepStrictEqual(f.purge.ronde(), []);
  assert.ok(fs.existsSync(path.join(f.usersDir, orphelin)));
});

test('uid non fabrique par le serveur dans users/ : non vise et sans casse', () => {
  const f = fabrique();
  f.vieux('inv_nope', 3); // 6 hex seulement : pas une invite legale
  assert.deepStrictEqual(f.purge.ronde(), []);
  assert.ok(fs.existsSync(path.join(f.usersDir, 'inv_nope')), 'intact');
});

test('demarrer() desactive si intervalleMs = 0', () => {
  const f = fabrique();
  const desactive = creerPurgeInvites({
    usersDir: f.usersDir,
    lireJetonsInvites: () => f.jetons,
    marquerInviteSupprimee: () => {},
    supprimerToutCloud: () => {},
    purgerRamUtilisateur: () => {},
    connexionsActives: {},
    loggerErreur: () => {},
    vieInviteMs: VIE,
    intervalleMs: 0
  });
  assert.strictEqual(desactive.demarrer(), null);
});
