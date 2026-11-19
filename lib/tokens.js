// =====================================================================
//  Budget de contexte : estimation locale des tokens
// =====================================================================
//  La fenetre envoyee au modele etait comptee en MESSAGES (10), jamais en
//  tokens. Dix messages peuvent valoir 300 tokens... ou 6 000 si le
//  visiteur colle un texte et que la reponse precedente etait longue.
//  Sous un plafond TPM (Groq 8 000/min, Gemini gratuit), c'est ce pic qui
//  provoque les 429, puis les replis qui re-facturent tout le prompt.
//
//  Ici on estime (aucun tokenizer a installer) et on coupe la fenetre par
//  BUDGET. Le bloc systeme (persona + resume + sources web) n'est jamais
//  retire : c'est l'histoire ancienne qui saute la premiere.
//
//  Chiffres utilises : le francais tourne autour de 3,6 caracteres par
//  token ; une ecriture CJK (chinois/japonais/coreen) vaut ~1 token par
//  caractere. C'est volontairement prudent : mieux vaut sous-remplir un
//  peu que depasser le plafond du fournisseur.
// =====================================================================
'use strict';

const CAR_PAR_TOKEN = 3.6;
// Enveloppe de role ("user"/"assistant") et separateurs : quelques tokens
// par message, non visibles dans le texte.
const MARGE_MESSAGE = 4;
// Un seul message plus gros que ca est tronque meme s'il tient dans le
// budget : au-dela, le modele noie la question et le TPM explose.
const MESSAGE_MAX_CAR = 12000;

function entierPositif(valeur, defaut) {
  const n = parseInt(valeur || '', 10);
  return Number.isInteger(n) && n > 0 ? n : defaut;
}

// Budgets d'entree par requete. Les transporteurs (Gemini et compatibles
// OpenAI) lisent ces valeurs au demarrage, comme les autres reglages.
const BUDGET_ENTREE_TOKENS = entierPositif(process.env.BUDGET_ENTREE_TOKENS, 5000);
const BUDGET_ENTREE_ECO_TOKENS = entierPositif(process.env.BUDGET_ENTREE_ECO_TOKENS, 3000);
// Plancher de secours : apres plusieurs reductions, on ne descend pas plus
// bas, sinon le modele perd la question elle-meme.
const BUDGET_ENTREE_MIN = 1200;

// ---------------------------------------------------------------------
//  Elagage des vieux messages
// ---------------------------------------------------------------------
//  Les trois derniers echanges de l'assistant partent verbatim (le fil
//  immediat en depend). Au-dela, une reponse est coupee a 400 caracteres :
//  son contenu est deja porte par les tours recents et par le resume, et
//  garder 2 000 caracteres de vieille reponse verbatim ne sert qu'a
//  remplir la fenetre a la place de messages plus utiles.
const HISTO_ELAGUE_TOURS = entierPositif(process.env.HISTO_ELAGUE_TOURS, 3);
const HISTO_ELAGUE_CAR = entierPositif(process.env.HISTO_ELAGUE_CAR, 400);

// ---------------------------------------------------------------------
//  Plafond de SORTIE adaptatif
// ---------------------------------------------------------------------
//  config.api_max_tokens (1024 par defaut) est un plafond de securite
//  rarement utile : le prompt impose "1 a 3 phrases". Mais c'est aussi la
//  taille qu'une generation qui derive peut atteindre, et certains
//  fournisseurs comptent la reservation de sortie dans leur quota. On
//  adapte donc le plafond a la demande :
//    - CHAT (defaut) : 384 tokens (~1 300 caracteres), large pour 1 a 3
//      phrases ;
//    - MOYEN : 768 quand la demande appelle un developpement (expliquer,
//      lister, comparer, detailler des etapes) ;
//    - LONG : le plafond configure, pour un livrable (texte, code,
//      traduction, poeme, lettre).
//  Un faux positif ne coute rien : le modele s'arrete tout seul bien avant
//  le plafond. La detection penche donc du cote genereux. Le plafond
//  configure reste un MAXIMUM (API_MAX_TOKENS=100 baisse tout, jamais
//  l'inverse).
const SORTIE_CHAT_TOKENS = 384;
const SORTIE_MOYEN_TOKENS = 768;

/**
 * Estimation d'un texte. CJK compte 1 token par caractere, le reste
 * ~3,6 caracteres par token.
 */
function estimerTexte(texte) {
  const t = typeof texte === 'string' ? texte : '';
  if (!t) return 0;
  const cjk = (t.match(/[\u3000-\u9fff\uac00-\ud7af\u3040-\u30ff]/g) || []).length;
  const autres = t.length - cjk;
  return Math.ceil(autres / CAR_PAR_TOKEN) + cjk;
}

/** Texte d'un message, quel que soit le format (content ou parts Gemini). */
function texteMessage(message) {
  if (!message) return '';
  if (typeof message === 'string') return message;
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.parts)) {
    return message.parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('\n');
  }
  return '';
}

/** Estimation d'un message, enveloppe comprise. */
function estimerMessage(message) {
  return estimerTexte(texteMessage(message)) + MARGE_MESSAGE;
}

/** Estimation d'une liste de messages. */
function estimerMessages(liste) {
  if (!Array.isArray(liste)) return 0;
  let total = 0;
  for (const m of liste) total += estimerMessage(m);
  return total;
}

function tronquerMessage(message, maxCar) {
  const max = entierPositif(maxCar, MESSAGE_MAX_CAR);
  const texte = texteMessage(message);
  if (texte.length <= max) return message;
  const coupe = texte.slice(0, max).trimEnd() + ' [...]';
  if (typeof message === 'string') return coupe;
  if (typeof message.content === 'string') return Object.assign({}, message, { content: coupe });
  if (Array.isArray(message.parts)) {
    return Object.assign({}, message, { parts: [{ text: coupe }] });
  }
  return coupe;
}

/**
 * Elague les vieilles reponses de l'assistant : les `tours` dernieres
 * restent verbatim, les plus anciennes sont coupees a `maxCar`.
 *
 * Ne mute JAMAIS l'historique recu (il est relu du disque a chaque
 * message) : les messages modifies sont des copies. Les messages touches
 * gardent leurs champs prives (_lastTs...) ; ceux qui n'ont pas besoin
 * d'etre coupes sont rendus tels quels.
 */
function elaguerVieux(liste, tours, maxCar) {
  if (!Array.isArray(liste) || !liste.length) return liste;
  const gardes = entierPositif(tours, HISTO_ELAGUE_TOURS);
  const max = entierPositif(maxCar, HISTO_ELAGUE_CAR);
  const positions = [];
  for (let i = 0; i < liste.length; i++) {
    if (liste[i] && liste[i].role === 'assistant') positions.push(i);
  }
  // Les tours recents restent intacts : ce sont eux qui portent le fil.
  const intactes = new Set(positions.slice(Math.max(0, positions.length - gardes)));
  let copie = null;
  for (const i of positions) {
    if (intactes.has(i)) continue;
    const m = liste[i];
    if (texteMessage(m).length <= max) continue;
    if (!copie) copie = liste.slice();
    copie[i] = tronquerMessage(m, max);
  }
  return copie || liste;
}

/**
 * Fenetre envoyee au modele, bornee par un budget de tokens.
 *
 * Regles :
 *  - les messages systeme sont TOUJOURS conserves (persona, memoire, web) ;
 *  - on empile depuis la fin (les plus recents d'abord) ;
 *  - une conversation doit commencer par un message utilisateur ;
 *  - le dernier message utilisateur est toujours garde, meme s'il
 *    depasse : il est alors tronque a MESSAGE_MAX_CAR ;
 *  - les vieilles reponses de l'assistant sont elaguees AVANT le calcul
 *    du budget : ce qu'elles liberent profite a des messages plus utiles.
 *
 * `histo` porte parfois des champs prives (_lastTs, _debut...) : les
 * messages non touches sont rendus tels quels, un message elague est une
 * copie — l'historique d'origine n'est jamais modifie.
 */
function choisirFenetre(histo, budget) {
  if (!Array.isArray(histo) || !histo.length) return histo || [];
  const limite = entierPositif(budget, BUDGET_ENTREE_TOKENS);
  const systeme = [];
  const conversation = [];
  for (const h of histo) {
    if (!h) continue;
    if (h.role === 'system') systeme.push(h);
    else conversation.push(h);
  }
  // L'elagage se fait sur la conversation entiere, puis la fenetre est
  // prise depuis la fin : les tours recents gardes verbatim sont donc les
  // memes dans l'historique complet et dans la fenetre.
  const convo = elaguerVieux(conversation);
  let reste = Math.max(0, limite - estimerMessages(systeme));
  const gardes = [];
  for (let i = convo.length - 1; i >= 0; i--) {
    const cout = estimerMessage(convo[i]);
    // Au moins le message courant est garde, quitte a le tronquer ensuite.
    if (gardes.length && cout > reste) break;
    gardes.unshift(convo[i]);
    reste -= cout;
  }
  // Une requete doit commencer par un tour utilisateur : sinon on jette
  // d'eventuelles reponses orphelines.
  while (gardes.length > 1 && gardes[0].role !== 'user') gardes.shift();
  if (gardes.length && gardes[gardes.length - 1].role === 'user') {
    gardes[gardes.length - 1] = tronquerMessage(gardes[gardes.length - 1], MESSAGE_MAX_CAR);
  }
  return systeme.concat(gardes);
}

/** Budget a appliquer maintenant (mode eco = fenetre plus courte). */
function budgetCourant(enTension) {
  return enTension ? BUDGET_ENTREE_ECO_TOKENS : BUDGET_ENTREE_TOKENS;
}

/**
 * Budget suivant apres un refus "quota de tokens" : 40 % de moins, jamais
 * sous BUDGET_ENTREE_MIN. Rejouer le MEME payload est exactement ce qui
 * multiplie la facture en saturation ; on reduit avant de reessayer.
 */
function budgetReduit(budget) {
  const b = entierPositif(budget, BUDGET_ENTREE_TOKENS);
  return Math.max(BUDGET_ENTREE_MIN, Math.round(b * 0.6));
}

// Plafond absolu si l'appelant n'en fournit pas (meme valeur que
// config.api_max_tokens par defaut).
const SORTIE_MAX_TOKENS = 1024;
// Une question de plus de 600 caracteres merite souvent plus qu'une
// phrase : sans marqueur explicite, on lui laisse au moins SORTIE_MOYEN.
const SEUIL_QUESTION_LONGUE = 600;

// Marqueurs d'une demande de LIVRABLE : la reponse peut legitimement
// depasser trois phrases (texte a ecrire, code, traduction, poeme...).
const DEMANDE_LONGUE =
  /\b(ecris|ecrire|redige|rediger|compose|composer|traduis|traduire|corrige|corriger|correction|reformule|reformuler|developpe|developper|detaille|detaillee|raconte|invente|genere|programme|algorithme|script|poeme|chanson|histoire|conte|lettre|discours|article|dissertation|rapport|recette|code|html|css|json|sql|en \d+ mots|en \d+ lignes)\b/;

// Demande de developpement sans livrable : une reponse structuree de
// quelques paragraphes suffit.
const DEMANDE_MOYENNE =
  /\b(explique|expliquer|comment|pourquoi|compare|comparer|difference|differences|etapes|pas a pas|liste|lister|exemple|exemples|plan|conseil|conseils|avantages|inconvenients|resume|resumer|detail|details)\b/;

/** Minuscules, sans accents, espaces normalises : la detection ne doit
 *  pas dependre de la facon d'ecrire du visiteur. */
function normaliserDemande(texte) {
  return String(texte || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Plafond de sortie pour CE message. `plafondMax` (config.api_max_tokens)
 * reste un maximum : la valeur adaptative ne peut que le baisser.
 */
function plafondSortie(texte, plafondMax) {
  const max = entierPositif(plafondMax, SORTIE_MAX_TOKENS);
  const brut = String(texte || '');
  const t = normaliserDemande(brut);
  if (!t) return Math.min(max, SORTIE_CHAT_TOKENS);
  // Un bloc de code colle dans le message annonce deja le livrable.
  if (brut.indexOf('```') >= 0 || DEMANDE_LONGUE.test(t)) return max;
  if (DEMANDE_MOYENNE.test(t) || t.length > SEUIL_QUESTION_LONGUE) {
    return Math.min(max, SORTIE_MOYEN_TOKENS);
  }
  return Math.min(max, SORTIE_CHAT_TOKENS);
}

/**
 * Copie de l'historique SANS le bloc de recherche web. Les sources sont
 * ajoutees en fin de message systeme (voir lib/routes/send.js) : c'est le
 * plus gros poste d'entree, et le premier a sacrifier quand le fournisseur
 * refuse la taille. Les autres champs ne sont pas touches.
 */
function retirerBlocWeb(histo) {
  if (!Array.isArray(histo)) return histo;
  const marque = '\n\nRECHERCHE WEB (effectuee le ';
  let change = false;
  const copie = histo.map((h) => {
    if (!h || h.role !== 'system' || typeof h.content !== 'string') return h;
    const i = h.content.indexOf(marque);
    if (i < 0) return h;
    change = true;
    return Object.assign({}, h, { content: h.content.slice(0, i) });
  });
  return change ? copie : histo;
}

module.exports = {
  CAR_PAR_TOKEN,
  MARGE_MESSAGE,
  MESSAGE_MAX_CAR,
  BUDGET_ENTREE_TOKENS,
  BUDGET_ENTREE_ECO_TOKENS,
  BUDGET_ENTREE_MIN,
  HISTO_ELAGUE_TOURS,
  HISTO_ELAGUE_CAR,
  SORTIE_CHAT_TOKENS,
  SORTIE_MOYEN_TOKENS,
  SORTIE_MAX_TOKENS,
  SEUIL_QUESTION_LONGUE,
  estimerTexte,
  estimerMessage,
  estimerMessages,
  texteMessage,
  tronquerMessage,
  elaguerVieux,
  choisirFenetre,
  budgetCourant,
  budgetReduit,
  plafondSortie,
  retirerBlocWeb
};
