// ====================================================================
//  Tests unitaires : lib/utilitaires.js (source unique)
// ====================================================================
//  Ces fonctions ont longtemps existe en DOUBLE (ici et dans server.js).
//  Les deux copies ont derive, et le correctif du jalon « une semaine » a
//  du etre applique deux fois. Ce fichier fige les sorties REELLES que
//  server.js envoyait au modele : une modification du texte du prompt
//  casse un test, ce qui est exactement le but.
//
//  (tests/int.securite.test.js et tests/run.js verifient deja le chemin
//  complet ; ici, on teste la fonction seule, sans serveur ni reseau.)
// ====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sansAccents,
  intentionDeMessage,
  joursRelation,
  rencontreAnniversaire,
  joursAvantAnniversaire,
  texteHumeur,
  HUMEUR_MAP,
  MOIS_FR,
  blocJalons,
  blocSouvenirsAnniversaires
} = require('../lib/utilitaires');

const BASE = new Date(2026, 10, 10); // 10 novembre 2026

// --------------------------------------------------------------------
// 1. sansAccents
// --------------------------------------------------------------------
test('sansAccents: retire les accents et conserve la casse', () => {
  assert.equal(sansAccents('Prénom Élève'), 'Prenom Eleve');
});

test('sansAccents: tolère null, undefined et le vide', () => {
  // L'ancienne copie de server.js appelait str.normalize directement et
  // levait une TypeError. Un champ lu d'un fichier peut etre vide.
  assert.equal(sansAccents(null), '');
  assert.equal(sansAccents(undefined), '');
  assert.equal(sansAccents(''), '');
});

test('sansAccents: convertit un nombre en chaine au lieu de planter', () => {
  assert.equal(sansAccents(42), '42');
});

// --------------------------------------------------------------------
// 2. intentionDeMessage — le préfixe "\n\n" fait partie du contrat
// --------------------------------------------------------------------
test('intention: un message vide ne produit aucune ligne', () => {
  assert.equal(intentionDeMessage(''), '');
  assert.equal(intentionDeMessage('   '), '');
  assert.equal(intentionDeMessage(null), '');
});

test('intention: chaque consigne commence par DEUX sauts de ligne', () => {
  // Sans ce prefixe, la consigne se colle au bloc precedent du prompt.
  for (const [msg, motCle] of [
    ['non, pas du tout', 'CORRIGE'],
    ['je me sens seul ce soir', 'VENTILE'],
    ['traduis bonjour en anglais', "DEMANDE D'ACTION"],
    ["c'est quoi le foot ?", 'QUESTION'],
    ['ptdr', 'RIGOLE'],
    ['ok', 'MESSAGE COURT']
  ]) {
    const r = intentionDeMessage(msg);
    assert.ok(r.startsWith('\n\n'), msg + ' -> prefixe \\n\\n manquant : ' + JSON.stringify(r));
    assert.ok(r.includes(motCle), msg + ' -> attendu ' + motCle);
  }
});

test('intention: un long message sans signal ne force aucune lecture', () => {
  assert.equal(
    intentionDeMessage('un message long qui ne declenche aucun signal particulier ici'),
    ''
  );
});

// --------------------------------------------------------------------
// 3. joursRelation / rencontreAnniversaire
// --------------------------------------------------------------------
test('joursRelation: compte les jours pleins, -1 sans premier contact', () => {
  assert.equal(joursRelation({ premierContact: 0 }, BASE), -1);
  const ilYa7 = new Date(BASE.getTime() - 7 * 86400000);
  assert.equal(joursRelation({ premierContact: ilYa7.getTime() }, BASE), 7);
});

test('rencontreAnniversaire: seulement le meme jour et le meme mois', () => {
  const memeJour = new Date(2024, 10, 10);
  assert.ok(rencontreAnniversaire({ premierContact: memeJour.getTime() }, BASE));
  const autreJour = new Date(2024, 10, 11);
  assert.equal(rencontreAnniversaire({ premierContact: autreJour.getTime() }, BASE), null);
  assert.equal(rencontreAnniversaire({ premierContact: 0 }, BASE), null);
});

// --------------------------------------------------------------------
// 4. blocJalons — LE bug corrige deux fois
// --------------------------------------------------------------------
test('blocJalons: une semaine pile gagne sur l anniversaire de la rencontre', () => {
  // Scenarii reels ou les DEUX regles parlent : a J-7 exactement ET a
  // J-365 exactement, la date de rencontre tombe sur le meme jour du mois.
  // Avant le correctif, le jalon fixe n'etait calcule QU'APRES
  // l'anniversaire et etait ecrase (« exactement un an » au lieu de
  // « une semaine »).
  for (const jours of [7, 365]) {
    const d = new Date(BASE.getTime() - jours * 86400000);
    const texte = blocJalons({ premierContact: d.getTime(), souvenirs: [] }, BASE);
    const attendu = jours === 7 ? 'exactement une semaine' : 'exactement un an';
    assert.ok(texte.includes(attendu), 'J-' + jours + ' -> ' + attendu + ' ; recu : ' + texte);
  }
});

test('blocJalons: un an pile reste annonce comme un an', () => {
  const ilYa1An = new Date(BASE.getFullYear() - 1, BASE.getMonth(), BASE.getDate());
  const texte = blocJalons({ premierContact: ilYa1An.getTime(), souvenirs: [] }, BASE);
  assert.ok(texte.includes('exactement un an'), 'recu : ' + texte);
});

test('blocJalons: chaque seuil fixe a son libelle', () => {
  const cas = [
    [1, 'exactement un jour'],
    [7, 'exactement une semaine'],
    [14, 'exactement deux semaines'],
    [21, 'exactement trois semaines'],
    [30, 'exactement un mois']
  ];
  for (const [jours, attendu] of cas) {
    const d = new Date(BASE.getTime() - jours * 86400000);
    const texte = blocJalons({ premierContact: d.getTime(), souvenirs: [] }, BASE);
    assert.ok(texte.includes(attendu), jours + ' jours -> ' + attendu + ' ; recu : ' + texte);
  }
});

test('blocJalons: un jour sans jalon ne produit rien', () => {
  const d = new Date(BASE.getTime() - 5 * 86400000);
  assert.equal(blocJalons({ premierContact: d.getTime(), souvenirs: [] }, BASE), '');
  assert.equal(blocJalons({ premierContact: 0, souvenirs: [] }, BASE), '');
});

// --------------------------------------------------------------------
// 5. blocSouvenirsAnniversaires
// --------------------------------------------------------------------
test('blocSouvenirsAnniversaires: annonce le souvenir et son cadre', () => {
  const ts = new Date(BASE.getFullYear() - 1, BASE.getMonth(), BASE.getDate()).getTime();
  const texte = blocSouvenirsAnniversaires(
    { premierContact: ts, souvenirs: [{ ts, texte: 'ses examens' }] },
    BASE
  );
  assert.ok(texte.startsWith('\n\nREVIVRE UN SOUVENIR : '), 'prefixe : ' + JSON.stringify(texte));
  assert.ok(texte.includes('ses examens'));
  assert.ok(texte.includes('Il y a exactement un an'));
});

test('blocSouvenirsAnniversaires: un mois pile est annonce', () => {
  // « Pile un mois » se compte en JOURS DE CALENDRIER (le 10 du mois
  // precedent), pas en 30 x 24 h : c'est la regle que code la fonction.
  const ts = new Date(BASE.getFullYear(), BASE.getMonth() - 1, BASE.getDate()).getTime();
  const texte = blocSouvenirsAnniversaires(
    { premierContact: ts, souvenirs: [{ ts, texte: 'son demenagement' }] },
    BASE
  );
  assert.ok(texte.includes('Il y a exactement un mois'), 'recu : ' + texte);
});

test('blocSouvenirsAnniversaires: rien sans souvenir eligible', () => {
  assert.equal(
    blocSouvenirsAnniversaires({ premierContact: BASE.getTime(), souvenirs: [] }, BASE),
    ''
  );
  const ts = new Date(BASE.getTime() - 3 * 86400000).getTime();
  assert.equal(
    blocSouvenirsAnniversaires({ premierContact: ts, souvenirs: [{ ts, texte: 'x' }] }, BASE),
    ''
  );
});

// --------------------------------------------------------------------
// 6. texteHumeur / HUMEUR_MAP
// --------------------------------------------------------------------
test('texteHumeur: rend un VRAI texte de personnalite, pas une etiquette', () => {
  const t = texteHumeur('joyeux');
  assert.ok(t.startsWith('\n\nTON ETAT INTERIEUR : '));
  assert.ok(t.length > 60, 'texte trop court : ' + t);
  assert.ok(!/^\\n\\nTON ETAT INTERIEUR : joyeux$/.test(t));
});

test('texteHumeur: inconnue ou vide -> chaine vide', () => {
  assert.equal(texteHumeur(''), '');
  assert.equal(texteHumeur('inexistante'), '');
  assert.equal(texteHumeur(null), '');
});

test('HUMEUR_MAP: les six humeurs du produit sont decrites', () => {
  assert.deepEqual(Object.keys(HUMEUR_MAP).sort(), [
    'blagueur',
    'calme',
    'energique',
    'fatigue',
    'joyeux',
    'triste'
  ]);
});

// --------------------------------------------------------------------
// 7. joursAvantAnniversaire
// --------------------------------------------------------------------
test('joursAvantAnniversaire: lit "12 mai", toleré sans accent', () => {
  const texte = '12 mai';
  const n = joursAvantAnniversaire(texte);
  assert.ok(Number.isInteger(n) && n >= 0, 'recu : ' + n);
});

test('joursAvantAnniversaire: illisible -> -1', () => {
  for (const v of ['', 'pas une date', '32 mai', '12 xyz']) {
    assert.equal(joursAvantAnniversaire(v), -1, JSON.stringify(v));
  }
});

test('MOIS_FR: douze mois, sans accent', () => {
  assert.equal(MOIS_FR.length, 12);
  assert.equal(MOIS_FR[1], 'fevrier');
  assert.equal(MOIS_FR[11], 'decembre');
  assert.ok(MOIS_FR.every((m) => sansAccents(m) === m));
});
