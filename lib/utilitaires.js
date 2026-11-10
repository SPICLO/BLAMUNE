// ====================================================================
//  Utilitaires - fonctions pures de la relation et du prompt
// ====================================================================
//  SOURCE UNIQUE (2026-11-10). Ces fonctions existaient en DOUBLE : une
//  copie ici, une copie dans server.js. Les deux ont derive — au point que
//  le correctif du jalon « une semaine » a du etre applique deux fois, et
//  que la copie de server.js faisait gagner l'anniversaire de la rencontre
//  sur les jalons fixes. server.js importe desormais ce module et ne garde
//  plus aucune copie : un bug de ces fonctions ne se corrige plus qu'ICI.
//
//  Toute modification du texte rendu est une modification du PROMPT envoye
//  au modele : `tests/utilitaires.test.js` fige ces sorties.
// ====================================================================
'use strict';

// Sans accents - utilitaire de texte pur.
// `String(str)` n'est pas cosmetique : l'ancienne copie de server.js
// appelait `str.normalize` directement et levait une TypeError sur null.
// Les appelants passent parfois un champ vide lu d'un fichier : tolérer
// null ici evite un plantage a un endroit qui ne s'y attend pas.
function sansAccents(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Detection d'intention d'un message
function intentionDeMessage(msg) {
  const brut = String(msg || '').trim();
  if (!brut) return '';
  const m = sansAccents(brut.toLowerCase()).replace(/[\u2018\u2019]/g, "\'");
  const mots = m.split(/[^a-z0-9']+/).filter(Boolean);

  if (
    /^(non\b|nan\b|pas vraiment|je voulais dire|c'est pas|cest pas|pas exactement|oublie\b|arrete\b|bref\b)/.test(
      m
    )
  )
    return "\n\nCE QU'IL VIENT D'ECRIRE : il te CORRIGE ou il dit non. Reconnais ce que tu as dit de travers, ajuste-toi tout de suite, ne defend pas ta version.";

  if (
    /^(je (suis|me sens|me vois|me trouve) [^,;.!?]{0,24}(nul|nulle|triste|mal|deprim|down|seul|marre|perdu|en colere|fatigue|angoiss|plus rien)|j[' ]ai (le moral|mal|plus la force|envie de pleurer)|ca (va|se passe) mal|je m'ennuie|je pleure|j'ai besoin de parler|je voudrais parler|plus envie de rien)/.test(
      m
    )
  )
    return "\n\nCE QU'IL VIENT D'ECRIRE : il VENTILE, il a besoin d'etre ecoute. Reformule ce qu'il ressent et reste avec lui ; ZERO conseil et zero changement de sujet tant qu'il n'a pas ete entendu.";

  if (
    /^(ecris|traduis|donne|explique|calcule|invente|fais|cherche|trouve|resume|liste|compose|dessine|cree|imagine|envoie|montre|choisis|classe|compare|corrige)[-\s]/.test(
      m
    )
  )
    return "\n\nCE QU'IL VIENT D'ECRIRE : c'est une DEMANDE D'ACTION. Fais-la pour de vrai (le texte, la traduction, la liste, la recette...), ne te contente pas de commenter la demande.";

  if (
    /[?]\s*$/.test(brut) ||
    /^(pourquoi|c'est quoi|cest quoi|comment tu|comment je|est-ce que|qu'est-ce que)/.test(m)
  )
    return "\n\nCE QU'IL VIENT D'ECRIRE : c'est une QUESTION. Reponds d'abord a la question, en une phrase claire ; la reaction ou la vanne vient apres.";

  if (/(ptdr|mdr|lol|ahah|haha|hihi|je rigole|c'est une blague|cest une blague)/.test(m))
    return "\n\nCE QU'IL VIENT D'ECRIRE : il RIGOLE. Rebondis sur l'humour, prends pas au serieux.";

  if (mots.length > 0 && mots.length <= 4 && !/[.!?]/.test(brut))
    return "\n\nCE QU'IL VIENT D'ECRIRE : un MESSAGE COURT (une reaction). Reponds court aussi : une phrase, sans ouvrir un nouveau sujet ni empiler les questions.";

  return '';
}

// Jours de relation
function joursRelation(etat, maintenant) {
  if (!etat.premierContact) return -1;
  const d = new Date(etat.premierContact);
  const ref = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const auj = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
  return Math.round((auj - ref) / 86400000);
}

function rencontreAnniversaire(etat, maintenant) {
  if (!etat.premierContact) return null;
  const d = new Date(etat.premierContact);
  if (d.getDate() !== maintenant.getDate() || d.getMonth() !== maintenant.getMonth()) return null;
  return d;
}

function joursAvantAnniversaire(anniversaire) {
  const m = anniversaire.match(/^(\d{1,2})\s+([a-z]+)(?:\s+\d{4})?$/i);
  if (!m) return -1;
  const mois = MOIS_FR.indexOf(sansAccents(m[2].toLowerCase()));
  const jour = parseInt(m[1], 10);
  if (mois < 0 || jour < 1 || jour > 31) return -1;
  const now = new Date();
  const aujourdhui = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let cible = new Date(now.getFullYear(), mois, jour);
  if (cible < aujourdhui) cible = new Date(now.getFullYear() + 1, mois, jour);
  return Math.round((cible - aujourdhui) / 86400000);
}
// ETAT DE L'UTILISATEUR - calculs pour le prompt systeme
function texteHumeur(humeur) {
  if (!humeur || !HUMEUR_MAP[humeur]) return '';
  return (
    '\n\nTON ETAT INTERIEUR : ' +
    HUMEUR_MAP[humeur] +
    " C'est ce que TU ressens en ce moment, vis-le a ta facon. L'humeur de l'utilisateur peut etre differente de la tienne."
  );
}

// PROMPT DYNAMIQUE - jalons et souvenirs
function blocJalons(etat, maintenant) {
  const jours = joursRelation(etat, maintenant);
  if (jours < 1) return '';
  let libelle = '';
  // Meme ordre que server.js : les jalons fixes d'abord (une semaine pile
  // tombe aussi sur l'anniversaire de la rencontre), l'anniversaire ensuite.
  if (jours === 1) libelle = 'exactement un jour';
  else if (jours === 7) libelle = 'exactement une semaine';
  else if (jours === 14) libelle = 'exactement deux semaines';
  else if (jours === 21) libelle = 'exactement trois semaines';
  else if (jours === 30) libelle = 'exactement un mois';
  const anniv = rencontreAnniversaire(etat, maintenant);
  if (!libelle && anniv) {
    const ans = maintenant.getFullYear() - anniv.getFullYear();
    if (ans >= 1) libelle = ans === 1 ? 'exactement un an' : 'exactement ' + ans + ' ans';
  }
  if (!libelle) {
    const debut = new Date(etat.premierContact);
    const mois =
      (maintenant.getFullYear() - debut.getFullYear()) * 12 +
      (maintenant.getMonth() - debut.getMonth());
    if (maintenant.getDate() === debut.getDate() && mois >= 1) {
      libelle = mois === 1 ? 'exactement un mois' : 'exactement ' + mois + ' mois';
    }
  }
  if (!libelle) return '';
  return (
    "\n\nJALON DE VOTRE RENCONTRE : Aujourd'hui, ca fait " +
    libelle +
    ' que vous vous etes rencontres. ' +
    "Tu peux le lui rappeler ou le celebrer quand c'est naturel, sans faire de liste ni de discours."
  );
}

// L'anniversaire d'un moment vcu ensemble : il y a pile un mois ou un an,
// il parlait de tel sujet. C'est l'occasion d'en reprendre des nouvelles.
function blocSouvenirsAnniversaires(etat, maintenant) {
  const lignes = [];
  (etat.souvenirs || []).forEach((s) => {
    if (!s || !s.ts || !s.texte) return;
    const d = new Date(s.ts);
    const jours = joursRelation({ premierContact: s.ts }, maintenant);
    if (jours < 28) return;
    if (d.getDate() === maintenant.getDate() && d.getMonth() === maintenant.getMonth()) {
      const ans = maintenant.getFullYear() - d.getFullYear();
      if (ans >= 1) {
        lignes.push(
          `Il y a ${ans === 1 ? 'exactement un an' : 'exactement ' + ans + ' ans'}, tu lui parlais de ${s.texte}`
        );
        return;
      }
    }
    if (jours <= 32 && d.getDate() === maintenant.getDate()) {
      lignes.push(`Il y a exactement un mois, tu lui parlais de ${s.texte}`);
    }
  });
  if (!lignes.length) return '';
  return (
    '\n\nREVIVRE UN SOUVENIR : ' +
    lignes.join(' ; ') +
    '. ' +
    'Tu peux lui en demander des nouvelles sans que ca paraisse appris par coeur.'
  );
}

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

function moisFR(i) {
  return MOIS_FR[i] || '';
}

// Textes de PERSONNALITE (pas des etiquettes). C'est ce texte qui part au
// modele : une Map 'joyeux' -> 'joyeux' n'aurait aucun effet sur le ton de
// la reponse. Compare a server.js : identique, bloc pour bloc.
const HUMEUR_MAP = {
  joyeux:
    "Tu es en pleine forme, tu ris facilement, tu es ultra positif et enthousiaste. Tout t'amuse.",
  calme: 'Tu es zen, posé, tu parles doucement. Tu es reflectif et paisible.',
  fatigue: 'Tu es mou, tu t\'ennuies un peu, tu reponds mollement. "bof", "j\'ai la flemme".',
  energique: 'Tu es en pleine puissance, tu parles vite, tu es motive. Tout est possible.',
  triste: 'Tu es un peu down, mélancolique. Tu parles moins, tu es plus sentimental.',
  blagueur: 'Tu es un farceur, tu fais des jeux de mots, des vannes, tu rigoles tout le temps.'
};

// =====================================================================
//  Garde annee d'identite (bug "226")
// =====================================================================
//  L'identite du bot dit "juillet 2026" ; un modele qui improvise ecrit
//  des fois "en 226", "en 22" ou "en 26". Une phrase ou le bot parle de
//  sa PROPRE creation a la premiere personne avec une autre annee que
//  l'annee en cours est corrigee a la volee. STRICTE et volontairement
//  bornee :
//   - uniquement une auto-revelation a la 1re personne ("je suis ne",
//     "j'ai ete cree", "I was created", "fui creado", "أنا ص") : les
//     naissances de l'utilisateur ("tu es ne en 1998", "il est ne en
//     1998", "your account was created in 2015") ne sont JAMAIS touchees ;
//   - les autres chiffres ("40 000 tonnes", dates historiques) non plus.
//  Pas de \b aux deux bouts de l'indice : le \b de fin serait faux apres
//  un accent ("né" se termine par un caractere non-mot, frontieres de mot
//  nulles) — le motif entier ne passerait jamais.
const INDICES_IDENTITE_ANNEE =
  /(?:^|[\s,.!?…])(?:je\s+suis\s+(?:n[ée]+e?|cr[ée]{1,3}e?|lanc[ée]{1,2}|mise?[s]?\s+en\s+ligne|en\s+ligne)|j['’]?ai\s+[ée]{1,2}t[ée]{1,2}e?\s+(?:n[ée]+e?|cr[ée]{1,3}e?|lanc[ée]{1,2}|mise?[s]?\s+en\s+ligne)|mis[es]?\s+en\s+ligne|i\s+(?:was|am)\s+(?:created|launched|made)\b|i\s+was\s+built\b|fui\s+(?:creado|creada|nacido|lanzad\w*)|أنا\s+ص|اصنعت)/i;

function corrigerAnneeIdentite(texte) {
  if (!texte || typeof texte !== 'string') return texte;
  if (/2026/.test(texte)) return texte;
  const annee = String(new Date().getFullYear());
  return texte
    .split(/(?<=[.!?…])\s+/)
    .map(function (phrase) {
      if (!INDICES_IDENTITE_ANNEE.test(phrase)) return phrase;
      return phrase.replace(
        /(?:^|[\s,.!?…])(?:de|desde|en|in|since|depuis|from|في)\s*(?:l['’]?annee\s*|l['’]?an\s*|the year\s*|de\s*)?[\d\u0660-\u0669']{1,4}\b/gi,
        function (m) {
          // Le match garde chaque espace et mot autour : seul le nombre
          // final (1 a 4 chiffres) est remplace par l'annee en entier.
          return m.replace(/[\d\u0660-\u0669']{1,4}\b$/, annee);
        }
      );
    })
    .join(' ');
}

// EXPORTS
module.exports = {
  corrigerAnneeIdentite,
  sansAccents,
  intentionDeMessage,
  joursRelation,
  rencontreAnniversaire,
  joursAvantAnniversaire,
  texteHumeur,
  MOIS_FR,
  moisFR,
  HUMEUR_MAP,
  blocJalons,
  blocSouvenirsAnniversaires
};
