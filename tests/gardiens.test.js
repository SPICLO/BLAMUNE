// Tests unitaires des gardiens anti-saturation : concurrence (file),
// tension (429 + eco), plafond global /send et cache du chercheur web.
//   node --test tests/gardiens.test.js
//
// 100 % hors reseau : les gardiens d'etat ne touchent que de la memoire,
// le rechercheur remplace le fetch global par un aiguillage local.
const test = require('node:test');
const assert = require('node:assert');

const concurrence = require('../lib/concurrence');
const tension = require('../lib/tension');
const plafondGlobal = require('../lib/plafond_global');
const recherche = require('../lib/recherche_web');

// Attente reelle (timers Node) : les tests de file laissent le vrai
// setTimeout decider, valeurs tres courtes.
function attendre(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================ CONCURRENCE ============================

test('concurrence : places immediates, file FIFO, liberation ordonnee', async () => {
  concurrence.reinitialiser();
  concurrence.configurer({ max: 2, attenteMs: 5000 });
  const p1 = await concurrence.demanderPlace();
  const p2 = await concurrence.demanderPlace();
  assert.strictEqual(concurrence.etat().enCours, 2, '2 places actives');
  assert.strictEqual(concurrence.etat().file, 0);

  // Le 3e et le 4e s'inscrivent dans la file : leurs promesses attendent.
  let p3Recu = null;
  let p4Recu = null;
  const p3 = concurrence.demanderPlace().then((pl) => (p3Recu = pl));
  const p4 = concurrence.demanderPlace().then((pl) => (p4Recu = pl));
  await attendre(30);
  assert.strictEqual(concurrence.etat().file, 2, '3e et 4e en file');
  assert.strictEqual(p3Recu, null, '3e pas encore servi');

  const ordre = [];
  p1.liberrer();
  await p3;
  ordre.push(3);
  p2.liberrer();
  await p4;
  ordre.push(4);

  assert.deepStrictEqual(ordre, [3, 4], 'FIFO : le 3e entre avant le 4e');
  assert.ok(p3Recu.liberrer, 'place servie a le liberrer');
  p3Recu.liberrer();
  p4Recu.liberrer();
  assert.strictEqual(concurrence.etat().enCours, 0, 'plus rien en cours');
  assert.strictEqual(concurrence.etat().debordements, 0, 'aucun debordement');
});

test('concurrence : debordement fail-open apres attente max, jamais null', async () => {
  concurrence.reinitialiser();
  concurrence.configurer({ max: 1, attenteMs: 60 });
  const p1 = await concurrence.demanderPlace();
  const t0 = Date.now();
  const p2 = await concurrence.demanderPlace();
  const duree = Date.now() - t0;
  assert.ok(duree >= 40, 'attente reelle observee : ' + duree + 'ms');
  assert.ok(p2 && typeof p2.liberrer === 'function', 'fantome lisible (jamais null)');
  assert.strictEqual(p2.debordement, true, 'fantome marque debordement');
  assert.ok(p2.attenteMs >= 40, 'temps file enregistre (' + p2.attenteMs + 'ms)');
  p2.liberrer(); // fantome : no-op, ne cree pas de place
  assert.strictEqual(concurrence.etat().enCours, 1, 'le fantome ne compte pas');
  assert.strictEqual(concurrence.etat().debordements, 1);
  p1.liberrer();
  const p3 = await concurrence.demanderPlace();
  assert.strictEqual(concurrence.etat().enCours, 1, 'une seule place re-affermie');
  assert.strictEqual(p3.debordement, undefined);
  p3.liberrer();
});

test('concurrence : liberrer idempotent, etat honnete', async () => {
  concurrence.reinitialiser();
  concurrence.configurer({ max: 2, attenteMs: 5000 });
  const p1 = await concurrence.demanderPlace();
  const p2 = await concurrence.demanderPlace();
  p1.liberrer();
  p1.liberrer(); // double liberation sans effet
  p2.liberrer();
  const e = concurrence.etat();
  assert.strictEqual(e.enCours, 0, 'pas de place fantome residuelle');
});

test('concurrence : filePleine refuse net a l admission (plafond MAX_FILE)', async () => {
  concurrence.reinitialiser();
  concurrence.configurer({ max: 1, attenteMs: 5000, maxFile: 2 });
  assert.strictEqual(concurrence.filePleine(), false, 'file vide au depart');
  const p1 = await concurrence.demanderPlace(); // occupe la seule place
  const p2 = concurrence.demanderPlace();
  const p3 = concurrence.demanderPlace(); // file : 2 demandeurs (maxFile)
  await attendre(30);
  assert.strictEqual(concurrence.etat().file, 2, '2 en file');
  assert.strictEqual(concurrence.filePleine(), true, 'file pleine : admission refusee');
  assert.strictEqual(concurrence.etat().maxFile, 2, 'plafond expose a /admin');
  // Un demandeur de plus attendrait le fail-open : la route ne lui envoie
  // JAMAIS (429 des filePleine). Ici on verifie la borne, pas le routeur.
  p1.liberrer();
  const place2 = await p2;
  place2.liberrer();
  const place3 = await p3;
  place3.liberrer();
  assert.strictEqual(concurrence.filePleine(), false, 'des places liberees : admission reouverte');
});

// ====================== PLAFOND GLOBAL /SEND ======================

test('plafond global : fenetre glissante d une heure, refus au-dela du max', () => {
  plafondGlobal.reinitialiser();
  plafondGlobal.configurer({ max: 3 });
  const t0 = Date.now();
  // Trois messages passent, la fenetre est pleine au 4e.
  assert.ok(plafondGlobal.tenterPlace(t0), '1er message accepte');
  assert.ok(plafondGlobal.tenterPlace(t0 + 1), '2e message accepte');
  assert.ok(plafondGlobal.tenterPlace(t0 + 2), '3e message accepte');
  assert.strictEqual(plafondGlobal.tenterPlace(t0 + 3), false, '4e refuse (fenetre pleine)');
  const e = plafondGlobal.etat();
  assert.strictEqual(e.dansFenetre, 3, 'trois messages comptes dans la fenetre');
  assert.strictEqual(e.refusJour, 1, 'le refus est compte du jour');
  assert.strictEqual(e.refus, 1, 'le refus est compte au total');
  // Une heure et 3 secondes plus tard, la fenetre est balayee : de
  // nouveau accepte (une heure pile laisse la note a la frontiere).
  assert.ok(plafondGlobal.tenterPlace(t0 + 60 * 60 * 1000 + 3000), 'fenetre balayee : re-accepte');
  const e2 = plafondGlobal.etat();
  assert.strictEqual(e2.dansFenetre, 1, 'les vieilles notes sont sorties');
  // Nouveau jour UTC : compteur du jour re-arme.
  const lendemain = t0 + 24 * 60 * 60 * 1000;
  assert.ok(plafondGlobal.tenterPlace(lendemain), 'lendemain accepte');
  assert.strictEqual(plafondGlobal.etat().refusJour, 0, 'refus du jour re-arme a minuit');
  plafondGlobal.reinitialiser();
});

// ============================== TENSION ==============================

test('tension : declenchement au seuil, eco tenu jusqu au calme + sejour min', async () => {
  tension.reinitialiser();
  const t0 = 1_000_000;
  // Deux 429 : sous le seuil de 3, pas de tension.
  tension.noter(t0);
  tension.noter(t0 + 1000);
  assert.strictEqual(tension.enTension(t0 + 2000), false, 'sous le seuil, pas de tension');
  // 3e 429 : arme l'eco.
  tension.noter(t0 + 3000);
  assert.strictEqual(tension.enTension(t0 + 4000), true, 'seuil atteint : eco');
  // Calme regex 9 min plus tard : encore AVANT le sejour minimum (10 min),
  // la fenetre est vide mais l'eco tient (pas de clignotement).
  assert.strictEqual(tension.enTension(t0 + 9 * 60 * 1000), true, 'eco tient avant le sejour min');
  // Apres 10.5 min totalement calme : sortie naturelle.
  assert.strictEqual(tension.enTension(t0 + 10.5 * 60 * 1000), false, 'calme + sejour : sortie');
  // Re-arme : il faut de NOUVEAUX 429.
  tension.noter(t0 + 11 * 60 * 1000);
  tension.noter(t0 + 11 * 60 * 1000 + 1);
  assert.strictEqual(tension.enTension(t0 + 11 * 60 * 1000 + 2), false);
  tension.noter(t0 + 11 * 60 * 1000 + 3);
  assert.strictEqual(tension.enTension(t0 + 11 * 60 * 1000 + 4), true);
});

test('tension : eco PREEMPTIF s arme sur la pression locale (sans attendre un 429)', async () => {
  tension.reinitialiser();
  concurrence.reinitialiser();
  assert.strictEqual(tension.enTension(), false, 'calme total : pas de tension');
  // Pression locale : file qui grossit (35 demandeurs, pas de fail-open
  // avant longtemps). Pas UN SEUL 429 : l'eco doit s'armer quand meme.
  concurrence.configurer({ max: 1, attenteMs: 60000, maxFile: 200 });
  const p1 = await concurrence.demanderPlace();
  const enAttente = [];
  for (let i = 0; i < 35; i++) enAttente.push(concurrence.demanderPlace());
  await attendre(20);
  assert.ok(concurrence.etat().file >= 30, 'file surchargee en place');
  assert.strictEqual(tension.enTension(), true, 'eco PREEMPTIF sur file chargee');
  // P3-3 : l'eco est LISIBLE comme eco (pas seulement `preemptif`), avec
  // sa cause et son heure d'entree — c'est ce que le client affiche.
  const etatPre = tension.etat();
  assert.strictEqual(etatPre.preemptif, true, 'preemptif visible pour /admin');
  assert.strictEqual(etatPre.eco, true, 'le preemptif compte comme eco');
  assert.strictEqual(etatPre.cause, 'file', 'cause lue : la file');
  assert.ok(etatPre.ecoDepuis > 0, 'heure d entree datable');
  assert.strictEqual(etatPre.entrees.file, 1, 'une entree eco par cause');
  // Debordement seul (etait le 2e signal) : fenetre des debords.
  assert.strictEqual(concurrence.etat().debordementsFenetre, 0, 'aucun debordement encore');
  // Retour au calme : la file se vide, le sejour PREEMPTIF tient 90 s
  // (anti-clignotement), puis retombe.
  p1.liberrer();
  for (const promesse of enAttente) {
    const pl = await promesse;
    pl.liberrer();
  }
  assert.strictEqual(concurrence.filePleine(), false, 'file videe');
  assert.strictEqual(tension.enTension(), true, 'sejour pre-emptif tient apres le calme');
  tension.reinitialiser();
  concurrence.reinitialiser();
  assert.strictEqual(tension.enTension(), false, 'tout ok apres remise a zero');
});

// ====================== CACHE DE REPONSES ======================

const cache = require('../lib/cache_reponses');

test('cache reponses : hit sans modele, non-cacheables exclus, reponse nommee jamais cachee', () => {
  cache.reinitialiser();
  const opts = { indiceMemoire: (m) => /mon nom|je m'appelle/i.test(m) };
  // Meme question, casse/ponctuation differentes : meme cle.
  const k1 = cache.cle('2', 'Ca va ?', opts);
  const k2 = cache.cle('2', '  ca va ?', opts);
  const k3 = cache.cle('2', 'CA VA !!!', opts);
  assert.ok(k1 && k1 === k2 && k2 === k3, 'variantes egales : une seule cle');
  // Reponse a une question du bot : le contexte fait partie de la cle.
  // Deux "oui" repondant a deux questions differentes ne se partagent pas.
  const ouiA = cache.cle('2', 'oui', { avant: 'Tu veux entendre une blague ?' });
  const ouiB = cache.cle('2', 'oui', { avant: 'On apprend ton sport prefere ?' });
  const ouiA2 = cache.cle('2', 'OUI !!!', { avant: 'tu veux entendre une blague' });
  assert.ok(ouiA && ouiB, 'reponses cacheables');
  assert.notStrictEqual(ouiA, ouiB, 'un "oui" par question : cles distinctes');
  assert.strictEqual(ouiA, ouiA2, 'meme question : meme cle (casse et ponctuation egales)');
  // Non-cacheables :
  assert.strictEqual(cache.cle('2', '(photo)', { imageParts: {} }), null, 'photo refusee');
  assert.strictEqual(cache.cle('2', '/cherche meteo', opts), null, 'commande refusee');
  assert.strictEqual(
    cache.cle('2', "je m'appelle Maeva", opts),
    null,
    'indice memoire : reponse personnelle'
  );
  assert.strictEqual(
    cache.cle('2', 'ca va', { rechercheBloc: 'SOURCES...' }),
    null,
    'bloc web : pas de cache'
  );
  const long = 'mot '.repeat(20).trim();
  assert.strictEqual(cache.cle('2', long, opts), null, 'message trop long : vraie conversation');
  // Hit et miss :
  const reponse = 'Ca va super, merci ! Et toi ?';
  assert.strictEqual(cache.repondre(k1), null, 'pas encore en cache');
  assert.ok(cache.retenir(k1, reponse), 'retention acceptee');
  assert.strictEqual(cache.repondre(k1), reponse, '2e visite : servie du cache');
  const e = cache.etat();
  assert.strictEqual(e.coups, 1, 'un hit');
  assert.ok(e.entrees >= 1, 'une entree');
  // Une reponse qui nomme le pseudo ne se partage jamais :
  assert.strictEqual(
    cache.retenir(k1, 'Salut Maeva, moi c est BLAMUNE !', { pseudo: 'Maeva' }),
    false,
    'reponse personnalisee : pas de cache'
  );
  // Trop courte ou vide : pas de retention.
  assert.strictEqual(cache.retenir(k1, 'ok'), false, 'trop courte : pas de cache');
  assert.strictEqual(cache.retenir(k1, ''), false, 'vide : pas de cache');
  cache.reinitialiser();
  assert.strictEqual(cache.etat().entrees, 0, 'zero apres remise a zero');
});

// P3-2 : le niveau STABLE (question sans contexte) doit servir une
// conversation NEUVE — c'est exactement le cas que le cache contextuel
// ratait toujours (cle videe par `avant`).
test('cache stable : une conversation neuve est servie sans modele (P3-2)', () => {
  cache.reinitialiser();
  assert.strictEqual(cache.estStable('Bonjour !'), true, 'salutation reconnue');
  assert.strictEqual(cache.estStable('ça va ?'), true, 'accent et ponctuation ignores');
  assert.strictEqual(
    cache.estStable('c est quoi ton nom ?'),
    true,
    'identite : question sans contexte'
  );
  assert.strictEqual(cache.estStable('et toi ?'), false, 'question contextuelle exclue');
  assert.strictEqual(cache.estStable('bonjour, tu as vu le match ?'), false, 'texte libre exclu');
  // Deux conversations neuves : aucune phrase precedente du bot.
  const a = cache.cle('2', 'Bonjour', {});
  const b = cache.cle('2', 'bonjour !', {});
  assert.ok(a && a === b, 'meme cle stable pour deux variantes');
  // Meme question APRES un message du bot : c'est le niveau contextuel,
  // jamais le stable (et inversement : une cle ne change pas de famille).
  const contextuel = cache.cle('2', 'Bonjour', { avant: 'Tu veux une blague ?' });
  assert.ok(contextuel && contextuel !== a, 'en milieu de fil : autre cle');
  assert.ok(cache.retenir(a, 'Salut ! Bon retour parmi nous.'), 'retenu');
  assert.ok(cache.retenir(contextuel, 'Salut ! Tu voulais une blague ?'), 'retenu aussi');
  assert.strictEqual(cache.repondre(b), 'Salut ! Bon retour parmi nous.', 'hit stable');
  assert.strictEqual(
    cache.repondre(contextuel),
    'Salut ! Tu voulais une blague ?',
    'hit contextuel'
  );
  const e = cache.etat();
  assert.strictEqual(e.coupsStable, 1, 'un coup stable');
  assert.strictEqual(e.coupsContextuel, 1, 'un coup contextuel');
  // Verdict (decision du proprietaire) : utile des le premier coup ;
  // jamais "aSupprimer" avant la fin de la fenetre de 14 jours.
  assert.strictEqual(e.observation.verdict, 'utile');
  cache.reinitialiser();
  assert.strictEqual(
    cache.etat().observation.verdict,
    'indetermine',
    'zero coup : fenetre en cours'
  );
});

test('tension : les notes vieillissent (fenetre 5 min), du jour re-arme', async () => {
  tension.reinitialiser();
  const t0 = 2_000_000;
  tension.noter(t0);
  tension.noter(t0 + 10);
  const e1 = tension.etat(t0 + 20);
  assert.strictEqual(e1.nb429Fenetre, 2);
  assert.strictEqual(e1.nb429Jour, 2);
  // Fenetre balayee : une note balaiee des qu'elle depasse STRICTEMENT
  // 5 min (5 min pile survit, comme la borne d'une fenetre glissante).
  const e2 = tension.etat(t0 + 5 * 60 * 1000 + 30);
  assert.strictEqual(e2.nb429Fenetre, 0, 'fenetre vieillie vide');
  assert.strictEqual(e2.nb429Jour, 2, 'le total du jour n oublie pas');
  // Nouveau jour UTC : compteur du jour re-arme.
  const lendemain = t0 + 24 * 60 * 60 * 1000;
  tension.noter(lendemain);
  const e3 = tension.etat(lendemain);
  assert.strictEqual(e3.nb429Jour, 1, 'compteur du jour re-arme a minuit');
});

// ====================== RETRY-AFTER + HISTORIQUE ECO ======================

const { creerGemini } = require('../lib/ia/gemini');
const gemini = creerGemini({ getConfig: () => ({}), providerOpenAI: () => false });

test('retryApresDepuisEnTete : secondes -> ms, absent/invalide -> 0, date -> temps restant', () => {
  assert.strictEqual(gemini.retryApresDepuisEnTete('45.4'), 45400, 'second flottant');
  assert.strictEqual(gemini.retryApresDepuisEnTete('60'), 60000, 'second entier');
  assert.strictEqual(gemini.retryApresDepuisEnTete(''), 0, 'chaine vide : 0');
  assert.strictEqual(gemini.retryApresDepuisEnTete(undefined), 0, 'absent : 0');
  assert.strictEqual(gemini.retryApresDepuisEnTete(' pas-un-nombre '), 0, 'invalide : 0');
  const ms = gemini.retryApresDepuisEnTete(new Date(Date.now() + 5000).toUTCString());
  assert.ok(ms > 2500 && ms <= 5000, 'date HTTP ms restants (recu ' + ms + 'ms)');
});

test('delaiIndique : e.retryAfterMs prioritaire, texte du message en base de secours', () => {
  assert.strictEqual(gemini.delaiIndique({ retryAfterMs: 9000 }), 9000, 'champ en-tete gagne');
  assert.strictEqual(
    gemini.delaiIndique({ message: 'Please retry in 45.411629042s' }),
    45412,
    'parsing texte conserve'
  );
  assert.strictEqual(
    gemini.delaiIndique({ retryAfterMs: 9000, message: 'Please retry in 45.4s' }),
    9000,
    'en-tete prioritaire sur texte'
  );
  assert.strictEqual(gemini.delaiIndique(null), 0, 'pas de crash sans erreur');
});

test('historique eco : nbEchanges=10 hors tension, 6 sous tension, systeme conserve', () => {
  const histo = [{ role: 'system', content: 'sys' }];
  for (let i = 0; i < 20; i++)
    histo.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'm' + i });
  tension.reinitialiser();
  const hors = gemini.limiterHisto(histo, gemini.nbEchanges());
  assert.strictEqual(hors.filter((h) => h.role !== 'system').length, 10, 'hors tension : 10');
  // Arme l'eco (seuil : 3 x 429 dans la fenetre, horloge reelle).
  tension.noter();
  tension.noter();
  tension.noter();
  const eco = gemini.limiterHisto(histo, gemini.nbEchanges());
  assert.strictEqual(eco.filter((h) => h.role !== 'system').length, 6, 'en eco : 6');
  assert.strictEqual(eco[0].role, 'system', 'le message systeme reste en tete');
  assert.strictEqual(eco[1].role, 'user', 'reprise sur un echange utilisateur');
  tension.reinitialiser();
});

// ========================= CACHE DU CHERCHEUR =========================

// Fixture DDG minimale (meme structure que tests/recherche_web.test.js) :
// un resultat, extrait assez long pour etre retenu.
const FIXTURE_DDG =
  '<div class="result">' +
  '<h2 class="result__title"><a rel="nofollow" class="result__a" ' +
  'href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexemple.org%2Ftokyo&amp;rut=x1">' +
  'Tokyo, capitale du Japon</a></h2>' +
  '<a rel="nofollow" class="result__snippet" href="x">La ville de Tokyo est la capitale du Japon depuis 1869, sur l ile de Honshu.</a>' +
  '</div>';

// fetch simule : chaque appel note son URL dans le journal ; la demande
// DuckDuckGo recoit FIXTURE_DDG, une page lue recoit assez de texte pour
// passer le seuil des 400 caracteres. `echoue` simule une panne reseau.
// Renvoie une fonction qui restaure le vrai fetch.
function avecFetchSimule(journal, opts) {
  const vrai = globalThis.fetch;
  const echoue = !!(opts && opts.echoue);
  globalThis.fetch = async function (url) {
    const u = String(url);
    journal.push(u);
    if (echoue) throw new Error('reseau coupe');
    const texte =
      u.indexOf('https://html.duckduckgo.com') === 0
        ? FIXTURE_DDG
        : 'page ' + u + ' ' + 'une page lue'.repeat(60);
    const lecteur = {
      pas: 0,
      read: async () => {
        lecteur.pas++;
        if (lecteur.pas === 1) return { done: false, value: Buffer.from(texte, 'utf8') };
        return { done: true, value: undefined };
      },
      cancel: function () {}
    };
    return {
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      body: { getReader: () => lecteur }
    };
  };
  return function arreter() {
    globalThis.fetch = vrai;
  };
}

test('cache recherche : meme sujet = 1 seul telechargement, hits comptes', async () => {
  const journal = [];
  const arreter = avecFetchSimule(journal);
  let inst = 1_000_000;
  const horloge = () => inst;
  const w = recherche.creerRechercheWeb({
    cacheMs: 30 * 60 * 1000,
    maintenant: horloge
  });
  try {
    const r1 = await w.rechercheWeb('marche du foot', { nb: 5, lire: 0 });
    assert.ok(r1.sources && r1.sources.length, 'recherche fixture a abouti');
    const ddg = () => journal.filter((u) => u.indexOf('https://html.duckduckgo.com') === 0).length;
    assert.strictEqual(ddg(), 1, 'premiere fois : 1 telechargement DDG');

    inst += 1000;
    const r2 = await w.rechercheWeb('  marche   du   foot  ', { nb: 5, lire: 0 });
    assert.strictEqual(ddg(), 1, '2e fois : cache, 0 telechargement DDG');
    assert.strictEqual(r2, r1, 'meme objet servi (date d origine conservee)');
    const etat = w.etatCache();
    assert.strictEqual(etat.coupsCache, 1, 'un hit');
    assert.strictEqual(etat.raterCache, 1, 'un miss');

    // Options differentes (lire 4 = /cherche) = autre recherche.
    inst += 1000;
    await w.rechercheWeb('marche du foot', { nb: 5, lire: 4 });
    assert.strictEqual(ddg(), 2, 'lire=4 : nouvelle recherche DDG');

    // Expiration du TTL : le meme clef repart au reseau.
    inst += 30 * 60 * 1000 + 1;
    await w.rechercheWeb('marche du foot', { nb: 5, lire: 0 });
    assert.strictEqual(ddg(), 3, 'TTL depasse : re-telecharge');
  } finally {
    arreter();
  }
});

test('cache recherche : echecs non caches, TTL a zero desactive', async () => {
  // cacheMs: 0 = desactive (chaque demande repart au reseau, meme echec).
  const journal = [];
  const arreter = avecFetchSimule(journal, { echoue: true });
  let inst = 2_000_000;
  const horloge = () => inst;
  const w = recherche.creerRechercheWeb({ cacheMs: 0, maintenant: horloge });
  try {
    const r1 = await w.rechercheWeb('sujet offline', { nb: 3, lire: 0 });
    assert.ok(r1.remarque, 'echec honnete : ' + r1.remarque);
    await w.rechercheWeb('sujet offline', { nb: 3, lire: 0 });
    assert.strictEqual(journal.length, 2, 'cache desactive : chaque demande part au reseau');
    assert.strictEqual(w.etatCache().entrees, 0);
  } finally {
    arreter();
  }

  // Avec cache actif, un echec (marque remarque) n'y entre JAMAIS.
  const journal2 = [];
  const arreter2 = avecFetchSimule(journal2, { echoue: true });
  const w2 = recherche.creerRechercheWeb({
    cacheMs: 30 * 60 * 1000,
    maintenant: horloge
  });
  try {
    const r3 = await w2.rechercheWeb('sujet offline 2', { nb: 3, lire: 0 });
    assert.ok(r3.remarque);
    const r4 = await w2.rechercheWeb('sujet offline 2', { nb: 3, lire: 0 });
    assert.ok(r4.remarque);
    assert.strictEqual(journal2.length, 2, 'echec jamais servi du cache');
    assert.strictEqual(w2.etatCache().entrees, 0, 'taille honnete : 0');
  } finally {
    arreter2();
  }
});

// ============================ TENSION : JOURNAL ============================
// Phase 3, P3-3 : l'eco ne s'arme plus en silence. Une ligne a l'ENTREE,
// une a la SORTIE, jamais une par message.

function capturerJournal() {
  const lignes = [];
  tension.configurerJournal((m) => lignes.push(m));
  return lignes;
}

test('tension : le journal ecrit UNE entree et UNE sortie, pas plus', () => {
  concurrence.reinitialiser();
  tension.reinitialiser();
  const t0 = 1700000000000;
  tension.noter(t0);
  tension.noter(t0 + 1);
  tension.noter(t0 + 2);
  const lignes = capturerJournal();
  // 3 429 dans la fenetre : une seule transition (entree).
  assert.strictEqual(tension.enTension(t0 + 10), true);
  assert.strictEqual(tension.enTension(t0 + 20), true, 'toujours en eco');
  assert.strictEqual(
    lignes.filter((l) => l.indexOf('eco active') === 0).length,
    1,
    'une seule entree journalisee : ' + JSON.stringify(lignes)
  );
  // La fenetre se vide et le sejour passe : sortie, une seule fois.
  assert.strictEqual(
    tension.enTension(t0 + 5 * 60 * 1000 + 10 * 60 * 1000 + 100000),
    false,
    'eco levable apres sejour et fenetre vide'
  );
  assert.strictEqual(tension.enTension(t0 + 5 * 60 * 1000 + 10 * 60 * 1000 + 200000), false);
  assert.strictEqual(
    lignes.filter((l) => l.indexOf('eco levee') === 0).length,
    1,
    'une seule sortie journalisee'
  );
  tension.configurerJournal(null);
});

test('tension : etat() expose la cause et les entrees par cause, sans journaliser', () => {
  tension.reinitialiser();
  concurrence.reinitialiser();
  concurrence.configurer({ max: 1, attenteMs: 40 });
  tension.configurerJournal(() => {});
  tension.enTension();
  assert.ok(tension.etat().entrees && typeof tension.etat().entrees === 'object');
  tension.configurerJournal(null);
  concurrence.reinitialiser();
  tension.reinitialiser();
});
