// Tests unitaires du chercheur web serveur (lib/recherche_web.js).
//   node --test tests/recherche_web.test.js
//
// 100 % hors reseau : l'analyse des resultats passe par des fixtures HTML,
// pas par une vraie recherche. Le reseau (DuckDuckGo) reste verifie en
// exploitation reelle, pas en CI (les datacenters sont souvent flagges).
const test = require('node:test');
const assert = require('node:assert');

const mod = require('../lib/recherche_web');

// HTML minimal reproduisant la structure des resultats html.duckduckgo.com :
// result__a (lien du resultat, parfois derriere le redirect /l/?uddg=) puis
// result__snippet (extrait), DANS LE MEME ORDRE.
const FIXTURE = [
  '<div class="result results_links">',
  '  <h2 class="result__title">',
  '    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ffr.wikipedia.org%2Fwiki%2FTokyo&amp;rut=x1">',
  '     Tokyo &amp; le Japon : Wikip\u00e9dia',
  '    </a>',
  '  </h2>',
  '  <a rel="nofollow" class="result__snippet" href="//duckduckgo.com/l/?uddg=x">La <b>ville</b> de Tokyo est la capitale du Japon depuis 1869, sur l\u2019\u00eele de Honshu.</a>',
  '</div>',
  '<div class="result">',
  '  <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://www.visite-japon.fr/page">Guide direct</a></h2>',
  '  <a class="result__snippet" href="x">Extrait deux, long assez pour &eacute;tre retenu.</a>',
  '</div>',
  '<div class="result">',
  '  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=http%3A%2F%2F127.0.0.1%2Fpieges">Resultat prive</a></h2>',
  '  <a class="result__snippet">ce result pointe vers localhost et doit etre REJETE</a>',
  '</div>',
  '<div class="result">',
  '  <h2 class="result__title"><a rel="nofollow" class="result__a" href="javascript:evil()">pi\u00e8ge de protocole</a></h2>',
  '</div>'
].join('\n');

test('analyse des resultats : decode redirect, extrait, refuse prive et non-http', () => {
  const srcs = mod.analyserResultats(FIXTURE);
  assert.strictEqual(srcs.length, 2, '2 sources valides, recu ' + srcs.length);
  assert.strictEqual(srcs[0].url, 'https://fr.wikipedia.org/wiki/Tokyo', 'uddg detortille');
  assert.ok(/Tokyo/.test(srcs[0].titre), 'titre nettoye : ' + srcs[0].titre);
  assert.ok(/capitale du Japon/.test(srcs[0].extrait), 'extrait decode entites');
  assert.strictEqual(srcs[1].url, 'https://www.visite-japon.fr/page', 'url directe pas detournee');
});

test('page blanche / structure inconnue : zero source, pas de crash', () => {
  assert.deepStrictEqual(mod.analyserResultats(''), []);
  assert.deepStrictEqual(mod.analyserResultats('<html><body>rien ici</body></html>'), []);
});

test('garde-fou SSRF : hotes prives refuses, publics passes', () => {
  for (const hote of [
    'localhost',
    '127.0.0.1',
    '10.0.0.7',
    '172.16.4.4',
    '172.31.255.1',
    '192.168.1.2',
    '169.254.169.254',
    '100.64.0.9',
    'sub.localhost',
    'machine.internal'
  ]) {
    assert.strictEqual(mod.hotePrive(hote), true, hote + ' doit etre prive');
  }
  for (const hote of ['fr.wikipedia.org', '8.8.8.8', '172.32.0.1', 'example.com']) {
    assert.strictEqual(mod.hotePrive(hote), false, hote + ' doit etre public');
  }
  assert.strictEqual(mod.urlLisible('javascript:evil()'), false, 'protocole refuse');
  assert.strictEqual(mod.urlLisible('file:///etc/passwd'), false, 'file refuse');
  assert.strictEqual(mod.urlLisible('http://127.0.0.1:9655/'), false, 'boucle locale refusee');
  assert.strictEqual(mod.urlLisible('https://fr.wikipedia.org/wiki/Tokyo'), true, 'public accepte');
});

test('purgerBalises : scripts et styles jetes, entites lues', () => {
  const t = mod.purgerBalises(
    '<div><script>bad()</script><style>b{}</style>Bonjour <b>le</b> monde ?&amp;&eacute;</div>'
  );
  assert.ok(/Bonjour le monde \?&\u00e9/.test(t), 'resultat : ' + t);
});

test('mise en forme du prompt : entete datee, host cite, consignes honnetes', () => {
  const c = mod.creerRechercheWeb();
  const recherche = {
    sujet: 'capitale du Japon',
    date: new Date(2026, 9, 25, 14, 30).toISOString(),
    sources: [
      {
        titre: 'Tokyo — Wikipedia',
        url: 'https://fr.wikipedia.org/wiki/Tokyo',
        extrait: 'Tokyo est la capitale du Japon.'
      },
      { titre: 'court', url: 'https://www.court.fr/x', extrait: '...' }
    ],
    pages: [{ url: 'https://fr.wikipedia.org/wiki/Tokyo', texte: 'Texte de la page lue.' }]
  };
  const bloc = c.pourPrompt(recherche);
  assert.ok(
    bloc.startsWith('RECHERCHE WEB (effectuee le 25/10/2026'),
    'entete : ' + bloc.slice(0, 40)
  );
  assert.ok(/\[fr\.wikipedia\.org\]/.test(bloc), 'hote entre crochets');
  assert.ok(/TEXTE LU SUR/.test(bloc), 'pages lues incluses');
  assert.ok(/honnetement/.test(bloc), 'consigne honnete presente');
  // La marque "RECHERCHE WEB (effectuee le " est un CONTRAT avec
  // lib/ia/gemini.js : elle saute google_search quand elle la voit.
  assert.strictEqual(bloc.indexOf('RECHERCHE WEB (effectuee le '), 0, 'marque en tete de bloc');
  // Bloc plafonne : un texte gigantesque ne gonfle pas la facture de
  // tokens... et surtout ne depasse pas l'attention du modele.
  const gros = c.pourPrompt({
    ...recherche,
    pages: [{ url: 'u', texte: 'x'.repeat(20000) }]
  });
  assert.ok(gros.length < 15000, 'bloc plafonne : ' + gros.length);
});

test('faits a apprendre : 2 max, dedup par site, extraits courts rejetes', () => {
  const c = mod.creerRechercheWeb();
  const recherche = {
    sujet: 'capitale du Japon',
    date: '2026-10-25T12:00:00.000Z',
    sources: [
      {
        titre: 'Tokyo',
        url: 'https://fr.wikipedia.org/wiki/Tokyo',
        extrait: 'Tokyo est la capitale du Japon depuis 1869, plus grande megalopole du monde.'
      },
      {
        titre: 'Complement',
        url: 'https://fr.wikipedia.org/wiki/Autre',
        extrait: 'Un autre fait sur Tokyo avec assez de texte pour etre retenu aussi.'
      },
      {
        titre: 'Second site',
        url: 'https://www.japon-info.fr/page',
        extrait: 'Fait venant d un second site, assez long pour etre retenu comme fait utile.'
      },
      {
        titre: 'Trop court',
        url: 'https://www.trois-court.fr/p',
        extrait: 'cloche'
      }
    ]
  };
  const faits = c.faitsAPrendre(recherche);
  assert.strictEqual(
    faits.length,
    2,
    '2 faits max (meme-site deduplique) : ' + JSON.stringify(faits)
  );
  assert.ok(faits[0].cle === 'capitale du Japon', 'cle = sujet');
  assert.ok(/source: fr\.wikipedia\.org, 2026-10-25/.test(faits[0].reponse), 'fait date et source');
  assert.ok(/japon-info\.fr/.test(faits[1].reponse), 'second site retenu');
  assert.ok(
    faits.every((f) => f.reponse.length <= 340),
    'reponse plafonnee'
  );
});

test('commande /cherche : juste et insensible, jamais de prefixe confondu', () => {
  const c = mod.creerRechercheWeb();
  assert.deepStrictEqual(c.commandeWeb('/cherche la lune'), { sujet: 'la lune' });
  assert.strictEqual(c.commandeWeb('/CHERCHE LA LUNE').sujet, 'LA LUNE');
  assert.strictEqual(c.commandeWeb('/cherche'), null, 'sans sujet : pas une commande');
  assert.strictEqual(c.commandeWeb('/chercheTour'), null, 'prefixe strict');
  assert.strictEqual(c.commandeWeb('cherche la lune'), null, 'sans slash, pas une commande');
  assert.strictEqual(c.commandeWeb(null), null, 'null sur safely null');
});

test('auto-declenchement : actu oui, vie privee non', () => {
  const c = mod.creerRechercheWeb();
  assert.strictEqual(c.demandeWebEvidente('resultats des elections ce soir'), true);
  assert.strictEqual(c.demandeWebEvidente('meteo de demain'), true);
  assert.strictEqual(c.demandeWebEvidente('recherche sur internet comment faire un plat'), true);
  assert.strictEqual(
    c.demandeWebEvidente('je t apprends que la lune est un satellite'),
    false,
    'pronoms : vie privee'
  );
  assert.strictEqual(c.demandeWebEvidente('mon chat a faim'), false, 'mon : vie privee');
  assert.strictEqual(c.demandeWebEvidente('bonjour'), false, 'smalltalk');
  assert.strictEqual(c.demandeWebEvidente('ho'), false, 'trop court');
});
