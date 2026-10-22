// =====================================================================
//  AUTO-APPRENTISSAGE BLAMUNE
// =====================================================================
//  Extrait de server.js. Au fil du message, BLAMUNE capte ce que son
//  interlocuteur livre en clair (nom, age, ville, gouts, anniversaire,
//  promesses, faits du type "retiens que tokyo est la capitale du japon")
//  et l'ecrit tout de suite dans la memoire utilisateur et le savoir,
//  sans attendre l'extraction par modele.
//
//  Fabrique : les dependances sont injectees pour rester testable
//  (faux memoire, faux etat interieur, faux savoir dans tests/lib.test.js).
// =====================================================================
'use strict';

// sansAccents : utilitaire local (meme implementation que server.js,
// replis.js, savoir_db.js — convention du projet, aucune dependance).
function sansAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Evenements marquants que BLAMUNE garde pour les conversations futures :
// les motifs sont compares sur le message sans accents. Utilise uniquement
// par autoApprentissage ci-dessous.
// Evenements marquants que BLAMUNE capte et garde en memoire. (Patterns sans accents :
// on compare toujours sur le message "deaccentue".)
const SOUVENIRS_PATTERNS = [
  {
    re: /\b(bac|brevet|permis|concours|resultats?|exam(ens?|in)?|epreuves?|oral)\b/i,
    texte: 'ses examens ou resultats'
  },
  { re: /\banniversaire\b/i, texte: 'son anniversaire' },
  { re: /\b(demenage|nouvel(?:le)?\s+appart|nouvelle\s+maison)\b/i, texte: 'son demenagement' },
  { re: /\b(entretien|rendez[- ]vous|rdv)\b/i, texte: 'un entretien ou rdv important' },
  { re: /\b(vacances|voyage|je\s+pars|on\s+part)\b/i, texte: 'des vacances ou un voyage' },
  {
    re: /\b(promu|promue|promotion|embauche|embauchee|licenc\w*|change\s+de\s+boulot|nouveau\s+travail|nouvelle\s+embauche|perdu\s+(?:mon|le)\s+travail)\b/i,
    texte: 'des changements au travail'
  },
  { re: /\b(hopital|hospitalis|malade|maladie)\b/i, texte: 'un souci de sante' },
  { re: /\b(separe|separes|rupture|quittes?|dispute)\b/i, texte: 'un moment difficile' },
  { re: /\b(marie|mariee|fiance|fiancee|en\s+couple)\b/i, texte: 'sa vie sentimentale' },
  // Ajouts : la vie de tous les jours compte aussi pour une conscience.
  { re: /\b(note|devoir|dictee|controle)\b/i, texte: 'une note ou un devoir scolaire' },
  { re: /\b(permis|examen\s+de\s+conduire|conduire)\b/i, texte: 'son permis de conduire' },
  {
    re: /\b(nouveau\s+(?:chat|chien|animal|minou|canard)|j['\u2019]ai\s+un\s+nouvel?\s+animal)\b/i,
    texte: 'un nouvel animal'
  },
  {
    re: /\b(amoureux|amoureuse|il\s+me\s+plait|elle\s+me\s+plait|je\s+le\s+aime|je\s+l['\u2019]aime)\b/i,
    texte: 'une personne qui lui plait'
  },
  { re: /\b(enterrement|deces|est\s+mort|a\s+quitte\s+ce\s+monde)\b/i, texte: 'une perte' },
  {
    re: /\b(resultat|c['\u2019]est\s+reussi|j['\u2019]ai\s+reussi|admis|recu)\b/i,
    texte: 'une reussite'
  },
  {
    re: /\b(changement\s+de\s+ville|je\s+demenage|nouvelle\s+ecole|je\s+change\s+d['\u2019]ecole)\b/i,
    texte: 'un changement d\u2019ecole ou de ville'
  },
  {
    re: /\b(je\s+me\s+marie|je\s+fais\s+un\s+enfant|je\s+vais\s+etre\s+(?:papa|maman))\b/i,
    texte: 'une grande nouvelle de vie'
  }
];
function detecterSouvenirs(etat, lower) {
  const propre = sansAccents(lower);
  let ajoute = false;
  for (const p of SOUVENIRS_PATTERNS) {
    if (!p.re.test(propre)) continue;
    const now = Date.now();
    const dernier = etat.souvenirs[etat.souvenirs.length - 1];
    // MÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âªme souvenir dÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©jÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â  notÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â© il y a moins de 3 h : on ne le rajoute pas.
    if (dernier && now - dernier.ts < 10800000 && dernier.texte === p.texte) continue;
    if (etat.souvenirs.some((s) => s.texte === p.texte && now - s.ts < 86400000)) continue;
    etat.souvenirs.push({ ts: now, texte: p.texte });
    ajoute = true;
  }
  if (etat.souvenirs.length > 10) etat.souvenirs = etat.souvenirs.slice(-10);
  return ajoute;
}

// =====================================================================
//  Fabrique. Cible dans server.js APRES le savoir (savoirEnregistrer
//  existe deja) : un fait appris en message est enregistre en base de
//  connaissances en plus de la memoire utilisateur.
// =====================================================================
function creerAutoApprentissage(deps) {
  const { lireMemoire, sauvegarderMemoireComplete, lireEtat, sauvegarderEtat, savoirEnregistrer } =
    deps;
  // Une capture regex est gourmande : "je joue au foot et j'ecoute du rap"
  // donnerait "foot et j'ecoute du rap". On coupe au premier delimiteur.
  function nettoyerValeur(v) {
    if (!v) return '';
    let t = String(v);
    t = t.split(/[,;!?]/)[0];
    t = t.split(/\s+et\s+/)[0];
    t = t.split(/\s+(?:mais|puis|ensuite|donc|aussi)\s+/)[0];
    t = t
      .replace(/[.!?]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length > 30) t = t.substring(0, 30).trim();
    return t;
  }

  // Des mots qui ne sont jamais un prenom : "je suis triste" ne doit pas
  // ecraser le vrai nom appris avant.
  const PAS_UN_NOM = [
    'un',
    'une',
    'le',
    'la',
    'les',
    'des',
    'du',
    'de',
    'en',
    'avec',
    'sans',
    'pour',
    'contre',
    'ici',
    'la',
    'meme',
    'seul',
    'daccord',
    'ok',
    'mieux',
    'grave',
    'ne',
    'nee',
    'nes',
    'nees',
    'petit',
    'petite',
    'content',
    'contente',
    // mots de question : "comment je m'appelle deja ?" ne doit pas apprendre "deja"
    'deja',
    'quoi',
    'comment',
    'pourquoi',
    'ou',
    'qui',
    'quand',
    'combien',
    'tel'
  ];
  const MOOD_MOTS =
    /^(?:triste|content|contente|heureux|heureuse|fatigue|fatiguee|creve|calme|energique|bien|mal|chaud|froid|partout|loin|serieux|serieuse|mou|moue|las|zen|down|deprime|motive|motivee)$/i;

  const MOIS_FR = [
    'janvier',
    'fevrier',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'aout',
    'septembre',
    'octobre',
    'novembre',
    'decembre'
  ];
  function autoApprentissage(uid, msg) {
    const mem = lireMemoire(uid);
    const lower = msg.toLowerCase();
    let changed = false;

    // Nom: "je m'appelle X", "mon nom c'est X", "appelle-moi X",
    // "je suis X" seulement en fin de phrase (sinon on confond avec un etat).
    let m = lower.match(
      /(?:je m['\u2019]appelle|mon nom c['\u2019]est|mon prenom c['\u2019]est|appelle[- ]moi)\s+([a-z\u00e0-\u00fc]{2,20})/
    );
    if (!m) m = lower.match(/je suis\s+([a-z\u00e0-\u00fc]{2,15})(?=\s*[.!?]?\s*$)/);
    // Une question ("je m'appelle deja ?") ne donne pas de nom : le mot capture
    // est suivi d'un point d'interrogation.
    const poseQuestion = m && /^\s*\?/.test(lower.slice(m.index + m[0].length));
    if (m && m[1] && !poseQuestion && PAS_UN_NOM.indexOf(m[1]) < 0 && !MOOD_MOTS.test(m[1])) {
      mem.nom = m[1].charAt(0).toUpperCase() + m[1].slice(1);
      changed = true;
    }

    // Age: "j'ai X ans", "j'ai environ X ans", "j'ai a peu pres X ans"
    m = lower.match(/j'ai\s+(?:environ\s+|a\s+peu\s+pres\s+|a\s+peu\s+de\s+)?(\d{1,3})\s+ans/);
    if (m && m[1]) {
      mem.age = m[1];
      changed = true;
    }

    // Plat prefere: "mon plat prefere c'est X", "j'adore X", "j'aime manger X", "j'aime X" (context plat)
    m = lower.match(/mon plat\s+(?:prefere|favori)\s+(?:c'est|est)\s+(.{2,30})/);
    if (!m) m = lower.match(/(?:j'adore|m'aime bien manger|j'aime manger)\s+(.{2,30})/);
    if (!m) m = lower.match(/(?:ma bouffe preferee c'est|mon plat c'est)\s+(.{2,30})/);
    if (m && m[1]) {
      mem.plat = nettoyerValeur(m[1]);
      changed = !!mem.plat;
    }

    // Sport: "je joue au foot", "mon sport c'est X", "je fais de la boxe"
    let sportDetecte = '';
    m = lower.match(/mon sport\s+(?:prefere|favori)?\s*(?:c'est|est)\s+(.{2,25})/);
    if (!m) m = lower.match(/je joue\s+(?:au|a la|a l'|aux)\s+(.{2,25})/);
    if (!m) m = lower.match(/je fais\s+(?:de\s+l['\u2019]|du |de la |des )(.{2,25})/);
    if (m && m[1]) {
      sportDetecte = nettoyerValeur(m[1]);
      if (sportDetecte && sportDetecte !== mem.sport) {
        mem.sport = sportDetecte;
        changed = true;
      }
    }

    // Hobby: "je fais du/de la X", "je pratique X", "mon hobby c'est X", "mon passe-temps c'est X"
    m = lower.match(/(?:je pratique|mon hobby c'est|mon passe[- ]temps c'est)\s+(.{2,30})/);
    if (!m) m = lower.match(/(?:je fais du|je fais de la|je fais des)\s+(.{2,30})/);
    if (m && m[1]) {
      const valeur = nettoyerValeur(m[1]);
      // evite de stocker deux fois la meme chose si on vient de capter le sport
      if (valeur && sansAccents(valeur) !== sansAccents(sportDetecte)) {
        mem.hobby = valeur;
        changed = true;
      }
    }

    // Genre: "je suis un garcon/fille/homme/femme/meuf/mec"
    m = lower.match(/je suis\s+(un\s+)?(garcon|fille|homme|meuf|femme|mec)/);
    if (m && m[2]) {
      mem.genre = m[2];
      changed = true;
    }

    // Ville: "j'habite a Paris", "je vis a Lyon", "je suis de Marseille", "je viens de Nice"
    m = lower.match(
      /(?:j['\u2019]habite|je vis|je suis de|je viens de)\s+(?:a |au |en |l['\u2019]|d['\u2019])?([a-z\u00e0-\u00fc'\- ]{2,25})/
    );
    if (m && m[1]) {
      const ville = nettoyerValeur(m[1]);
      if (ville && ville !== mem.ville) {
        mem.ville = ville.charAt(0).toUpperCase() + ville.slice(1);
        changed = true;
      }
    }

    // Travail / ecole: "je travaille chez X", "je bosse dans X", "je suis etudiant en X",
    // "je vais au lycee", "je suis en terminale", "je suis eleve"
    m = lower.match(/(?:je travaille|je bosse)\s+(?:chez|dans|a|au|pour)\s+(.{2,30})/);
    if (!m)
      m = lower.match(
        /je suis\s+(?:etudiant|etudiante|eleve|stagiaire|apprenti|apprentie|en\s+)(.{2,30})/
      );
    if (!m) m = lower.match(/je vais\s+au[xy]?\s+(.{2,30})/);
    if (m && m[1]) {
      const t = nettoyerValeur(m[1]);
      if (t && t !== mem.travail) {
        mem.travail = t;
        changed = true;
      }
    }

    // Musique: "j'ecoute X", "ma musique preferee c'est X", "mon groupe prefere c'est X"
    m = lower.match(
      /(?:j['\u2019]ecoute|ma musique preferee c'est|mon groupe prefere c'est|je suis fan de)\s+(.{2,30})/
    );
    if (m && m[1]) {
      const t = nettoyerValeur(m[1]);
      if (t && t !== mem.musique) {
        mem.musique = t;
        changed = true;
      }
    }

    // Serie / film / jeu: "ma serie preferee c'est X", "mon film prefere", "je regarde X"
    m = lower.match(/ma serie preferee c'est\s+(.{2,30})/);
    if (!m) m = lower.match(/mon (?:film|jeu|anime|manga) prefere c'est\s+(.{2,30})/);
    if (!m) m = lower.match(/je regarde\s+(?:en ce moment\s+)?(.{2,30})/);
    if (m && m[1]) {
      const t = nettoyerValeur(m[1]);
      if (t && t !== mem.serie) {
        mem.serie = t;
        changed = true;
      }
    }

    // Reve / objectif de vie: "mon reve c'est X", "je veux devenir X", "plus tard je veux X"
    m = lower.match(
      /(?:mon reve|mon objectif|ma reussite|mon but)\s*(?:dans la vie)?\s*(?:c'est|est)\s+(.{2,40})/
    );
    if (!m)
      m = lower.match(/(?:je veux devenir|je dream de devenir|plus tard je veux)\s+(.{2,40})/);
    if (m && m[1]) {
      const t = nettoyerValeur(m[1]);
      if (t && t !== mem.reve) {
        mem.reve = t;
        changed = true;
      }
    }

    // Anniversaire: "mon anniversaire c'est le 12 mai", "je suis ne le 3 mai 2005"
    // (on compare sans accents : "fevrier" / "fÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©vrier" marchent)
    const clair = sansAccents(lower);
    const RECHERCHE_MOIS =
      'janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre';
    m = clair.match(
      new RegExp(
        "(?:mon anniversaire|mon jour de naissance)\\s*(?:c'est|est|:)?\\s*(?:le\\s+)?(\\d{1,2})\\s+(?:de\\s+)?(" +
          RECHERCHE_MOIS +
          ')(?:\\s+(?:en\\s+)?(19\\d{2}|20\\d{2}))?'
      )
    );
    if (!m)
      m = clair.match(
        new RegExp(
          'je\\s+(?:suis\\s+)?ne(?:e)?\\s+le\\s+(\\d{1,2})\\s+(' +
            RECHERCHE_MOIS +
            ')(?:\\s+(?:en\\s+)?(19\\d{2}|20\\d{2}))?'
        )
      );
    if (m) {
      const jour = parseInt(m[1], 10);
      if (jour >= 1 && jour <= 31 && MOIS_FR.indexOf(m[2]) >= 0) {
        const valeur = jour + ' ' + m[2] + (m[3] ? ' ' + m[3] : '');
        if (valeur !== mem.anniversaire) {
          mem.anniversaire = valeur;
          changed = true;
        }
        // Une annee de naissance donne aussi son age, sans qu'il ait a le dire
        if (m[3]) {
          const age = new Date().getFullYear() - parseInt(m[3], 10);
          if (age >= 3 && age <= 110 && String(age) !== mem.age) {
            mem.age = String(age);
            changed = true;
          }
        }
      }
    }

    // Promesses: "rappelle-moi de...", "n'oublie pas que..."
    // C'est ce qu'il a explicitement demande de retenir : jamais perdu.
    m = clair.match(/rappelle[-\s]?moi\s+(?:de\s+|que\s+|d')\s*(.{5,60})/);
    if (!m) m = clair.match(/n['\u2019]oublie pas\s+(?:de\s+|que\s+)(.{5,60})/);
    if (m && m[1]) {
      const p = nettoyerValeur(m[1]);
      if (p && p.length >= 4) {
        const liste = (mem.promesses || '').split('|').filter(Boolean);
        if (!liste.some((x) => sansAccents(x) === sansAccents(p))) {
          liste.push(p);
          while (liste.length > 3) liste.shift();
          mem.promesses = liste.join('|');
          changed = true;
        }
      }
    }

    // Enseignement explicite du savoir : "retiens que tokyo est la capitale
    // du japon", "apprends que ...", "sache que ...". La cle est le sujet
    // (sans l'article), la reponse la phrase entiere : elle repond
    // naturellement a "c'est quoi tokyo ?" le jour suivant. Reste strict :
    // le sujet se coupe sur "est / c'est / veut dire / se dit", jamais un
    // pronom, jamais un message a la premiere personne (nom, age et co. ont
    // leurs propres regles ci-dessus). Un fait mal compose est pire qu'un
    // fait manque.
    m = clair.match(/\b(?:retiens|apprends|sache)\s+que\s+(.{5,140})/);
    if (m && m[1] && !/^\s*(je\b|j['\u2019]|on\b)/.test(m[1])) {
      const colle = m[1]
        .replace(/\s+/g, ' ')
        .replace(/[.!?;,]+\s*$/, '')
        .trim();
      const couper = colle.match(
        /^(.{2,60}?)\s+(?:est|sont|veut dire|se dit|c['\u2019]est)\s+(.{3,120})$/
      );
      if (couper) {
        const cleFait = couper[1]
          .trim()
          .replace(/^(le|la|les|l['\u2019]|un|une|des|mon|ma|mes|ton|ta|tes)\s+/, '')
          .trim();
        const PRONOMS = ['je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles'];
        if (cleFait.length >= 2 && PRONOMS.indexOf(cleFait) < 0) {
          if (savoirEnregistrer(cleFait, colle, null, 'auto')) changed = true;
        }
      }
    }

    // Ce qu'il aime: "ce que j'aime c'est X", "j'aime X" (exclure "j'aime pas")
    m = lower.match(/ce que j'aime c'est\s+(.{2,40})/);
    if (!m) m = lower.match(/j'aime\s+(?!pas\s|point\s)(.{2,40})/);
    if (m && m[1]) {
      mem.aime = nettoyerValeur(m[1]);
      changed = !!mem.aime;
    }

    // Ce qu'il n'aime pas: "je n'aime pas X", "j'aime pas X", "je deteste X"
    m = lower.match(/(?:je n'aime pas|j'aime pas|je deteste|j'deteste)\s+(.{2,40})/);
    if (m && m[1]) {
      mem.aimePas = nettoyerValeur(m[1]);
      changed = !!mem.aimePas;
    }

    // Mots favoris: detecte les mots repetes ou expressions caracteristiques
    const motsSignificatifs = lower.match(
      /\b(grave|ptdr|mdr|tkt|ouais|wesh|frero|mec|meuf|la?|bro|bg)\b/g
    );
    if (motsSignificatifs && motsSignificatifs.length >= 2) {
      const uniques = [...new Set(motsSignificatifs)].slice(0, 5);
      if (!mem.motsFavoris || mem.motsFavoris.length === 0) {
        mem.motsFavoris = uniques;
        changed = true;
      }
    }

    // Humeur DE L'UTILISATEUR : c'est ce qu'IL ressent, pas ce que BLAMUNE ressent.
    // On la garde a part pour que BLAMUNE puisse reagir sans perdre la sienne.
    if (
      /(?:je suis|on est|je me sens|j['\u2019]me sens)\s*(?:trop\s+)?(content|heureux|joyeux|bien|cool|heureuse)/i.test(
        lower
      ) ||
      /\b(haha|mdr|ptdr|lol)\b/.test(lower)
    ) {
      if (mem.humeurUser !== 'joyeux') {
        mem.humeurUser = 'joyeux';
        changed = true;
      }
    } else if (
      /(?:je suis|on est|je me sens|j['\u2019]me sens)\s*(?:trop\s+)?(fatigue|creve|las|mou|epuise)/i.test(
        lower
      ) ||
      /j'ai la flemme/i.test(lower)
    ) {
      if (mem.humeurUser !== 'fatigue') {
        mem.humeurUser = 'fatigue';
        changed = true;
      }
    } else if (
      /(?:je suis|on est|je me sens|j['\u2019]me sens)\s*(?:trop\s+)?(triste|down|deprime|melancolique|mal|va pas bien)/i.test(
        lower
      )
    ) {
      if (mem.humeurUser !== 'triste') {
        mem.humeurUser = 'triste';
        changed = true;
      }
    } else if (
      /(?:je suis|on est|je me sens|j['\u2019]me sens)\s*(?:trop\s+)?(calme|zen|tranquille|paisible)/i.test(
        lower
      )
    ) {
      if (mem.humeurUser !== 'calme') {
        mem.humeurUser = 'calme';
        changed = true;
      }
    } else if (
      /(?:je suis|on est|je me sens|j['\u2019]me sens)\s*(?:trop\s+)?(energique|motive|pousse)/i.test(
        lower
      )
    ) {
      if (mem.humeurUser !== 'energique') {
        mem.humeurUser = 'energique';
        changed = true;
      }
    }

    // Commande sur l'ETAT INTERNE de BLAMUNE : "sois joyeux", "met-toi en mode calme",
    // "mode triste". Seules ces formes changent SA propre humeur.
    m = lower.match(
      /(?:^|[\s,.!?])(?:sois|met[- ]toi\s+(?:en\s+mode|comme)|eteins[- ]toi|remets[- ]toi)\s+(en\s+)?(joyeux|calme|fatigue|triste|energique|blagueur)/
    );
    if (!m) m = lower.match(/\bmode\s+(joyeux|calme|fatigue|triste|energique|blagueur)\b/);
    if (m) {
      const humeur = m[2] || m[1];
      if (humeur && mem.humeur !== humeur) {
        mem.humeur = humeur;
        changed = true;
      }
    }
    if (
      /(?:enleve|supprime|enlever|retire|enl[eÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨]ve)\s+(?:la\s+|l['\u2019\u0027]?\s*|les\s+)?humeur/i.test(
        lower
      )
    ) {
      mem.humeur = '';
      changed = true;
    }

    // Souvenirs : moments marquants que BLAMUNE garde pour les conversations futures
    try {
      const etatBL = lireEtat(uid);
      if (detecterSouvenirs(etatBL, lower)) sauvegarderEtat(uid, etatBL);
    } catch (e) {}

    if (changed) {
      sauvegarderMemoireComplete(uid, mem);
    }
    return changed;
  }
  return { autoApprentissage, nettoyerValeur, PAS_UN_NOM, MOOD_MOTS, MOIS_FR };
}

module.exports = { creerAutoApprentissage };
