// Tests du budget de contexte (lib/tokens.js) et du compteur de tokens
// (lib/compteur_tokens.js) : fenetre par tokens au lieu du nombre de
// messages, et mesure reelle des appels.
//   node --test tests/tokens.test.js
const test = require('node:test');
const assert = require('node:assert');

const {
  estimerTexte,
  estimerMessage,
  estimerMessages,
  choisirFenetre,
  budgetCourant,
  budgetReduit,
  retirerBlocWeb,
  tronquerMessage,
  elaguerVieux,
  plafondSortie,
  MESSAGE_MAX_CAR,
  BUDGET_ENTREE_MIN,
  HISTO_ELAGUE_TOURS,
  HISTO_ELAGUE_CAR,
  SORTIE_CHAT_TOKENS,
  SORTIE_MOYEN_TOKENS
} = require('../lib/tokens');
const { creerCompteurTokens } = require('../lib/compteur_tokens');
const {
  normaliserUsage,
  texteDepuisReponse,
  estQuotaTokens,
  creerGemini
} = require('../lib/ia/gemini');

// ============================ ESTIMATION ============================

test('estimation : texte vide, francais et CJK', () => {
  assert.strictEqual(estimerTexte(''), 0);
  assert.strictEqual(estimerTexte(null), 0);
  // 360 caracteres francais ~ 100 tokens (3,6 car/token).
  assert.strictEqual(estimerTexte('a'.repeat(360)), 100);
  // CJK : 1 token par caractere, jamais sous-estime par la division 3,6.
  assert.strictEqual(estimerTexte('漢字'), 2);
  assert.ok(estimerTexte('漢字'.repeat(100)) >= 200);
});

test('estimation : les deux formats de message (content et parts)', () => {
  const a = estimerMessage({ role: 'user', content: 'a'.repeat(360) });
  const b = estimerMessage({ role: 'user', parts: [{ text: 'a'.repeat(360) }] });
  assert.strictEqual(a, b, 'les deux formats pesent pareil');
  assert.ok(a > 100, 'enveloppe de role incluse');
  assert.strictEqual(estimerMessages([]), 0);
  assert.strictEqual(
    estimerMessages([{ content: 'a'.repeat(36) }, { content: 'a'.repeat(36) }]),
    estimerMessage({ content: 'a'.repeat(36) }) * 2
  );
});

// ========================= BUDGET DE FENETRE =========================

function histo(n, taille) {
  const h = [{ role: 'system', content: 'PERSONA' }];
  for (let i = 0; i < n; i++) {
    h.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: (i % 2 === 0 ? 'question ' : 'reponse ') + 'x'.repeat(taille)
    });
  }
  return h;
}

test('fenetre : le bloc systeme est TOUJOURS conserve', () => {
  const h = histo(30, 400);
  const f = choisirFenetre(h, 100); // budget ridiculement petit
  assert.strictEqual(f[0].role, 'system');
  assert.strictEqual(f[0].content, 'PERSONA');
  // Au moins le message courant est garde, meme hors budget.
  assert.ok(f.length >= 2);
});

test('fenetre : coupe les plus anciens jusqu au budget', () => {
  const h = histo(30, 400); // ~30 messages de ~115 tokens
  const f = choisirFenetre(h, 1200);
  const convo = f.filter((m) => m.role !== 'system');
  assert.ok(convo.length < 30, 'la fenetre a bien ete reduite');
  assert.ok(estimerMessages(f) <= 1200 + 200, 'budget respecte (marge du dernier message)');
  // Les recents sont gardes : le dernier message est celui de l'historique.
  assert.strictEqual(convo[convo.length - 1].content, h[h.length - 1].content);
});

test('fenetre : commence par un tour utilisateur', () => {
  const h = [
    { role: 'system', content: 's' },
    { role: 'assistant', content: 'vieux' },
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' }
  ];
  const f = choisirFenetre(h, 10000);
  assert.strictEqual(f[0].role, 'system');
  assert.strictEqual(f[1].role, 'user');
});

test('fenetre : un message geant est tronque, pas envoye entier', () => {
  const geant = 'x'.repeat(50000);
  const f = choisirFenetre(
    [
      { role: 'system', content: 's' },
      { role: 'user', content: geant }
    ],
    5000
  );
  const dernier = f[f.length - 1];
  assert.ok(dernier.content.length < geant.length, 'message tronque');
  assert.ok(dernier.content.length <= MESSAGE_MAX_CAR + 10);
  assert.ok(/\[\.\.\.\]$/.test(dernier.content), 'marque de troncature visible');
});

test('troncature : ne touche pas un message dans la limite', () => {
  const m = { role: 'user', content: 'court' };
  assert.strictEqual(tronquerMessage(m, 100), m);
});

test('budget : normal et eco', () => {
  assert.ok(budgetCourant(false) > budgetCourant(true), 'le mode eco coupe plus court');
  assert.ok(budgetCourant(false) > 0);
});

// ========================= COMPTEUR DE TOKENS =========================

test('compteur : fenetre glissante de 60 s et totaux du jour', () => {
  let t = 1000000;
  const compteur = creerCompteurTokens({ maintenant: () => t, fenetreMs: 60000 });

  compteur.noter('u1', { entree: 100, sortie: 20 });
  t += 1000;
  compteur.noter('u1', { entree: 200, sortie: 30 });

  let r = compteur.pourUtilisateur('u1');
  assert.deepStrictEqual(r.fenetre, { ms: 60000, entree: 300, sortie: 50, appels: 2 });
  assert.strictEqual(r.jour.entree, 300);
  assert.strictEqual(r.total.appels, 2);

  // Apres 61 s, la fenetre est vide mais les totaux restent.
  t += 61000;
  r = compteur.pourUtilisateur('u1');
  assert.strictEqual(r.fenetre.entree, 0);
  assert.strictEqual(r.jour.entree, 300);
  assert.strictEqual(r.total.entree, 300);

  // Changement de jour : le "jour" repart a zero, le total non.
  t += 86400000;
  r = compteur.pourUtilisateur('u1');
  assert.strictEqual(r.jour.entree, 0);
  assert.strictEqual(r.total.entree, 300);
});

test('compteur : resume global, top consommateurs, remise a zero', () => {
  let t = 0;
  const compteur = creerCompteurTokens({ maintenant: () => t });
  compteur.noter('a', { entree: 100, sortie: 10 });
  compteur.noter('b', { entree: 500, sortie: 50 });
  compteur.noter('b', { entree: 500, sortie: 50 });

  const r = compteur.resume();
  assert.strictEqual(r.utilisateurs, 2);
  assert.strictEqual(r.jour.entree, 1100);
  assert.strictEqual(r.jour.sortie, 110);
  assert.strictEqual(r.jour.appels, 3);
  assert.strictEqual(r.top[0].uid, 'b', 'le plus gros consommateur en tete');
  assert.strictEqual(r.fenetre.utilisateurs, 2);

  compteur.remiseAZero('b');
  assert.strictEqual(compteur.resume().utilisateurs, 1);
  compteur.remiseAZero();
  assert.strictEqual(compteur.resume().utilisateurs, 0);
});

test('compteur : usage absent ignore, valeurs negatives bornees', () => {
  const compteur = creerCompteurTokens({ maintenant: () => 0 });
  compteur.noter('u', null);
  compteur.noter('u', {});
  const r = compteur.pourUtilisateur('u');
  assert.strictEqual(r.jour.appels, 1, 'un appel sans usage reste compte comme appel');
  assert.strictEqual(r.jour.entree, 0);

  compteur.noter('u', { entree: -50, sortie: -10 });
  assert.strictEqual(compteur.pourUtilisateur('u').total.entree, 0);
});

// ========================== USAGE FOURNISSEUR ==========================

test('usage : Gemini et OpenAI produisent la meme forme', () => {
  assert.deepStrictEqual(normaliserUsage({ promptTokenCount: 120, candidatesTokenCount: 30 }), {
    entree: 120,
    sortie: 30,
    total: 150
  });
  assert.deepStrictEqual(normaliserUsage({ prompt_tokens: 90, completion_tokens: 12 }), {
    entree: 90,
    sortie: 12,
    total: 102
  });
  assert.strictEqual(normaliserUsage(null), null);
  assert.strictEqual(normaliserUsage({}), null, 'un objet vide ne compte pas');
});

test('usage : texteDepuisReponse transmet usageMetadata sans casser le texte', () => {
  const corps = JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'bonjour' }, { text: ' toi' }] } }],
    usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 40, totalTokenCount: 540 }
  });
  let recu = null;
  const texte = texteDepuisReponse(corps, (u) => {
    recu = u;
  });
  assert.strictEqual(texte, 'bonjour toi');
  assert.deepStrictEqual(recu, { entree: 500, sortie: 40, total: 540 });
});

// ======================= REPLI SANS REPAYER (P3) =======================

test('quota de tokens : TPM/TPD reconnus, quota de requetes non', () => {
  // Groq et les passerelles OpenAI-compatibles nomment le plafond TPM.
  assert.strictEqual(
    estQuotaTokens({
      statusCode: 429,
      message: 'Rate limit reached for model on tokens per minute (TPM): Limit 8000, Used 7500'
    }),
    true
  );
  assert.strictEqual(estQuotaTokens({ message: 'token rate exceeded' }), true);
  assert.strictEqual(estQuotaTokens({ message: 'requested 4200 tokens' }), true);
  assert.strictEqual(estQuotaTokens({ message: 'tokens per day (TPD)' }), true);
  // Un quota de REQUETES n'a rien a gagner a couper le contexte.
  assert.strictEqual(
    estQuotaTokens({ message: 'Rate limit reached for requests per minute (RPM)' }),
    false
  );
  assert.strictEqual(estQuotaTokens({ message: 'Resource has been exhausted' }), false);
  assert.strictEqual(estQuotaTokens(null), false);
});

test('budget reduit : -40 %, jamais sous le plancher', () => {
  assert.strictEqual(budgetReduit(5000), 3000);
  assert.strictEqual(budgetReduit(3000), 1800);
  assert.strictEqual(budgetReduit(1800), BUDGET_ENTREE_MIN, 'plancher atteint');
  assert.strictEqual(budgetReduit(500), BUDGET_ENTREE_MIN, 'valeur absurde bornee');
  assert.strictEqual(budgetReduit(0), budgetReduit(budgetCourant(false)), '0 = budget courant');
});

test('retirerBlocWeb : coupe le bloc de recherche, garde le reste', () => {
  const systeme = {
    role: 'system',
    content: 'PERSONA\n\nRECHERCHE WEB (effectuee le 17/11/2026)\n--- source : bla'
  };
  const histo = [systeme, { role: 'user', content: 'question' }];
  const sans = retirerBlocWeb(histo);
  assert.strictEqual(sans[0].content, 'PERSONA');
  assert.strictEqual(sans[1], histo[1], 'les autres messages ne sont pas recopies');
  assert.strictEqual(histo[0].content.indexOf('RECHERCHE WEB') > 0, true, 'original intact');
  // Sans bloc : la liste est rendue TELLE QUELLE (aucune copie inutile).
  const simple = [{ role: 'system', content: 'PERSONA' }];
  assert.strictEqual(retirerBlocWeb(simple), simple);
  assert.strictEqual(retirerBlocWeb(null), null);
});

test('fenetrerHisto : un budget explicite remplace celui du mode courant', () => {
  const gemini = creerGemini({ getConfig: () => ({}), providerOpenAI: () => false });
  const h = [{ role: 'system', content: 's' }];
  for (let i = 0; i < 30; i++)
    h.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'm'.repeat(400) });
  const serre = gemini.fenetrerHisto(h, 800);
  const large = gemini.fenetrerHisto(h, 5000);
  assert.ok(serre.length < large.length, 'un budget plus petit garde moins de messages');
  assert.ok(estimerMessages(serre) <= 800 + 200, 'budget serre respecte');
});

// ===================== ELAGAGE DES VIEUX MESSAGES =====================

/** Conversation de `tours` echanges : chaque reponse fait `taille` car. */
function conversation(tours, taille) {
  const h = [{ role: 'system', content: 'PERSONA' }];
  for (let i = 0; i < tours; i++) {
    h.push({ role: 'user', content: 'question ' + i + ' ' + 'u'.repeat(80) });
    h.push({ role: 'assistant', content: 'reponse ' + i + ' ' + 'a'.repeat(taille) });
  }
  return h;
}

test('elagage : les 3 dernieres reponses restent verbatim, les autres sont coupees', () => {
  const h = conversation(5, 1000);
  const assistants = h.filter((m) => m.role === 'assistant');
  const e = elaguerVieux(h);
  const gardees = e.filter((m) => m.role === 'assistant');
  assert.strictEqual(gardees.length, 5);
  assert.strictEqual(HISTO_ELAGUE_TOURS, 3);
  for (let i = 0; i < 2; i++) {
    assert.ok(
      gardees[i].content.length <= HISTO_ELAGUE_CAR + 6,
      'vieille reponse coupee : ' + gardees[i].content.length
    );
    assert.ok(gardees[i].content.endsWith(' [...]'), 'troncature visible');
  }
  for (let i = 2; i < 5; i++) {
    assert.strictEqual(gardees[i], assistants[i], 'les 3 derniers tours sont intacts');
  }
});

test('elagage : l historique d origine n est jamais modifie', () => {
  // Il est relu du disque a chaque message : le muter abimerait la source.
  const h = conversation(5, 1000);
  const avant = h.map((m) => m.content);
  const e = elaguerVieux(h);
  assert.notStrictEqual(e, h, 'une copie est rendue quand quelque chose change');
  assert.deepStrictEqual(
    h.map((m) => m.content),
    avant,
    "l'historique recu doit rester intact"
  );
});

test('elagage : messages utilisateur et reponses courtes inchanges', () => {
  const h = [
    { role: 'user', content: 'u'.repeat(3000) },
    { role: 'assistant', content: 'court' },
    { role: 'user', content: 'ok' },
    { role: 'assistant', content: 'r2' },
    { role: 'user', content: 'ok2' },
    { role: 'assistant', content: 'r3' },
    { role: 'user', content: 'ok3' },
    { role: 'assistant', content: 'r4' }
  ];
  const e = elaguerVieux(h);
  assert.strictEqual(e[0], h[0], "un message utilisateur n'est jamais elague");
  assert.strictEqual(e[0].content.length, 3000);
  assert.strictEqual(e[1], h[1], 'une reponse courte est rendue telle quelle');
});

test('elagage : sans rien a couper, la liste est rendue TELLE QUELLE', () => {
  const h = conversation(2, 100);
  assert.strictEqual(elaguerVieux(h), h, 'aucune copie inutile');
  assert.strictEqual(elaguerVieux(null), null);
});

test('fenetre : l elagage rend la place a des messages plus utiles', () => {
  const h = conversation(6, 1200);
  const f = choisirFenetre(h, 2000);
  const convo = f.filter((m) => m.role !== 'system');
  assert.ok(convo.length >= 7, 'plus de messages tiennent dans le budget : ' + convo.length);
  const elagues = convo.filter(
    (m) => m.role === 'assistant' && m.content.length <= HISTO_ELAGUE_CAR + 6
  );
  assert.ok(elagues.length >= 1, 'au moins une vieille reponse a ete elaguee');
});

// ====================== PLAFOND DE SORTIE ADAPTATIF ======================

test('plafond de sortie : chat, demande structuree, livrable', () => {
  assert.strictEqual(SORTIE_CHAT_TOKENS, 384);
  assert.strictEqual(SORTIE_MOYEN_TOKENS, 768);
  // Chat du quotidien : 1 a 3 phrases, le plafond bas suffit.
  assert.strictEqual(plafondSortie('salut ca va ?', 1024), SORTIE_CHAT_TOKENS);
  // Demande de developpement : quelques paragraphes.
  assert.strictEqual(plafondSortie('explique-moi la photosynthese', 1024), SORTIE_MOYEN_TOKENS);
  // Livrable : le plafond configure (1024 par defaut).
  assert.strictEqual(plafondSortie('ecris-moi un poeme sur la pluie', 1024), 1024);
  assert.strictEqual(plafondSortie('```js\nconsole.log(1)\n```', 1024), 1024);
});

test('plafond de sortie : insensible aux accents et a la casse', () => {
  assert.strictEqual(plafondSortie('ÉCRIS UNE LETTRE À MA MÈRE', 1024), 1024);
  assert.strictEqual(plafondSortie('Explique en détail', 1024), SORTIE_MOYEN_TOKENS);
});

test('plafond de sortie : le plafond configure reste un maximum', () => {
  // API_MAX_TOKENS=100 : la valeur adaptative ne peut pas le relever.
  assert.strictEqual(plafondSortie('ecris un article', 100), 100);
  assert.strictEqual(plafondSortie('salut', 100), 100);
  assert.strictEqual(plafondSortie('', 1024), SORTIE_CHAT_TOKENS);
  assert.strictEqual(plafondSortie(null, 1024), SORTIE_CHAT_TOKENS);
});

test('plafond de sortie : une question tres longue merite au moins le palier moyen', () => {
  assert.strictEqual(plafondSortie('mot '.repeat(200), 1024), SORTIE_MOYEN_TOKENS);
});

test('corpsGemini : maxOutputTokens suit la demande, pas une constante', () => {
  const gemini = creerGemini({
    getConfig: () => ({ api_max_tokens: 1024, api_temperature: 0.7 }),
    providerOpenAI: () => false
  });
  const court = JSON.parse(
    gemini.corpsGemini([{ role: 'user', parts: [{ text: 'salut' }] }], false, false)
  );
  assert.strictEqual(court.generationConfig.maxOutputTokens, SORTIE_CHAT_TOKENS);
  const livrable = JSON.parse(
    gemini.corpsGemini([{ role: 'user', parts: [{ text: 'ecris un poeme' }] }], false, false)
  );
  assert.strictEqual(livrable.generationConfig.maxOutputTokens, 1024);
});

// ====================== CACHE DE PROMPT (systemInstruction) ======================

function geminiDeTest() {
  return creerGemini({
    getConfig: () => ({ api_max_tokens: 1024, api_temperature: 0.7 }),
    providerOpenAI: () => false
  });
}

test('cache de prompt : le bloc systeme part dans systemInstruction, pas dans contents', () => {
  const gemini = geminiDeTest();
  const contents = gemini.construireContenus([
    { role: 'system', content: 'PERSONA STABLE' },
    { role: 'user', content: 'salut' },
    { role: 'assistant', content: 'bonjour' },
    { role: 'user', content: 'ca va ?' }
  ]);
  const corps = JSON.parse(gemini.corpsGemini(contents, false, false));
  assert.deepStrictEqual(corps.systemInstruction, { parts: [{ text: 'PERSONA STABLE' }] });
  assert.ok(
    corps.contents.every((c) => c.role !== 'system'),
    'aucun role system ne doit rester dans contents'
  );
  assert.strictEqual(corps.contents.length, 3);
  assert.strictEqual(corps.contents[0].role, 'user');
  assert.strictEqual(corps.contents[0].parts[0].text, 'salut', 'le 1er message reste intact');
});

test('cache de prompt : plusieurs blocs systeme sont joints dans un seul prefixe', () => {
  const gemini = geminiDeTest();
  const corps = JSON.parse(
    gemini.corpsGemini(
      [
        { role: 'system', parts: [{ text: 'PERSONA' }] },
        { role: 'system', parts: [{ text: 'PROFIL' }] },
        { role: 'user', parts: [{ text: 'salut' }] }
      ],
      false,
      false
    )
  );
  assert.strictEqual(corps.systemInstruction.parts[0].text, 'PERSONA\n\nPROFIL');
  assert.strictEqual(corps.contents.length, 1);
});

test('cache de prompt : systemInstruction refuse -> repli dans le 1er message utilisateur', () => {
  const gemini = geminiDeTest();
  const contents = [
    { role: 'system', parts: [{ text: 'PERSONA' }] },
    { role: 'user', parts: [{ text: 'salut' }] }
  ];
  const refus = gemini.refusChamp(400, false, false, 'Unknown name "systemInstruction"');
  assert.ok(refus && refus.systeme, 'le 400 nommant systemInstruction doit etre reconnu');
  const corps = JSON.parse(gemini.corpsGemini(contents, false, false));
  assert.strictEqual(corps.systemInstruction, undefined, 'plus de champ refuse');
  assert.strictEqual(corps.contents[0].parts[0].text, 'PERSONA\n\nsalut');
});

test('cache de prompt : un 400 sans rapport ne coupe pas systemInstruction', () => {
  const gemini = geminiDeTest();
  assert.strictEqual(gemini.refusChamp(400, false, false, 'API key not valid'), null);
  assert.strictEqual(gemini.refusChamp(500, false, false, 'systemInstruction'), null);
  const corps = JSON.parse(
    gemini.corpsGemini(
      [
        { role: 'system', parts: [{ text: 'PERSONA' }] },
        { role: 'user', parts: [{ text: 'salut' }] }
      ],
      false,
      false
    )
  );
  assert.ok(corps.systemInstruction, 'le prefixe reste separe');
});

test('usage : les tokens servis par le cache sont signales, sans changer les autres formes', () => {
  const c1 = normaliserUsage({
    promptTokenCount: 900,
    candidatesTokenCount: 40,
    cachedContentTokenCount: 700
  });
  assert.strictEqual(c1.cache, 700);
  const c2 = normaliserUsage({
    prompt_tokens: 900,
    completion_tokens: 40,
    prompt_tokens_details: { cached_tokens: 600 }
  });
  assert.strictEqual(c2.cache, 600);
  // Fournisseur muet : la cle n'apparait pas du tout.
  const sans = normaliserUsage({ promptTokenCount: 900, candidatesTokenCount: 40 });
  assert.strictEqual('cache' in sans, false);
});

test('compteur : les tokens en cache sont cumules et exposes', () => {
  let t = 1000;
  const c = creerCompteurTokens({ maintenant: () => t, fenetreMs: 60000 });
  c.noter('u', { entree: 900, sortie: 40, cache: 700 });
  const r = c.pourUtilisateur('u');
  assert.strictEqual(r.fenetre.cache, 700);
  assert.strictEqual(r.jour.cache, 700);
  assert.strictEqual(r.total.cache, 700);
  // Un fournisseur muet ne fait pas apparaitre la cle.
  c.noter('v', { entree: 100, sortie: 10 });
  assert.strictEqual('cache' in c.pourUtilisateur('v').total, false);
  t += 61000;
  const apres = c.pourUtilisateur('u');
  assert.strictEqual('cache' in apres.fenetre, false, 'la fenetre glissante oublie le cache');
  assert.strictEqual(apres.jour.cache, 700, 'le jour le garde');
});
