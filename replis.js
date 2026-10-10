// BLAMUNE - Banque de repli hors ligne (français).
//
// Rôle : quand l'IA est injoignable (quota, panne, réseau coupé, clé
// absente), le serveur ne renvoie plus « Désolé, j'ai eu un problème
// technique » mais une réponse de BLAMUNE tirée dans replis.txt.
//
// Pourquoi un fichier plutôt qu'une API distante :
//   - zéro latence (lecture en mémoire, aucun appel réseau) ;
//   - zéro quota, aucun compte, aucune clé ;
//   - aucune panne possible : le fichier est dans le dépôt, donc déployé
//     avec le reste et disponible 24 h/24 même si le PC du créateur est
//     éteint ;
//   - cohérent avec le ton de BLAMUNE (ces API sont toutes en anglais).
//
// Format de replis.txt :  situation|variante1;;variante2;;variante3
//   - une situation par ligne, sansaccent, en minuscules ;
//   - une variante par « ;; » ; le choix est fait au hasard ;
//   - une variante vide est ignorée.
//
// Règle de conception : BLAMUNE ne doit JAMAIS inventer une réponse factuelle.
// Sur une question, le repli avoue son ignorance et relance la conversation.
const fs = require('fs');
const path = require('path');

// ---------- Détection de la situation ----------

function sansAccents(s) {
  return String(s == null ? '' : s).normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Ordre = priorité. Les premiers tests sont les plus spécifiques.
const REGLES = [
  ['blague', /(ptdr|mdr|\blol\b|ahaha|haha+|hihi|je rigole|blague|drôle|drole|funny)/],
  // « c'est gentil » = remerciement ; « t'es gentil » = compliment. D'où
  // l'ancre obligatoire sur "c'est" pour ne pas tout mélanger.
['remerciement', /(merci|merci beaucoup|remercie|thanks|thx|c'est gentil|c'est gentille|t merci|gentiment)/],
  ['au_revoir', /(au revoir|a bientot|bisou|bonne journee|bonne soiree|a demain|on se parle plus tard|ciao|salut a toi)/],
  // Salutation : ancrée sur le DÉBUT du message seulement, sinon
  // « salut, comment ça va ? » serait classé « question » et répondrait
  // « je ne sais pas » au lieu d'accuser réception.
  ['salut', /^(salut|bonjour|bonsoir|hello|hey|coucou|salutation|yo)\b\s*(?![a-z]{4,})|^(ca va|comment ca va|comment vas tu|comment allez vous|salut a tous)\b/],
  ['question_bot', /(qui es tu|qui est ce|qui es-ce|t es qui|t'es qui|tu es qui|c est quoi blamune|qu es ce que tu es|tu es quoi|t es quoi|ton nom|comment tu t appelles)/],
  ['colere', /(je suis en colere|je m enerve|ca m agace|ca me saoule|c'est horrible|j'en peux plus|je rage|ras le bol)/],
  ['tristesse', /(je suis triste|je me sens mal|je pleure|je suis seul|j'ai besoin de parler|desole|pas bien|je m'ennuie|perdu|abattu)/],
  ['fatigue', /(je suis (fatigue|creve|epuise)|je suis fatigue|creve|epuise|fatigue|e puise|j'ai pas d'energie|besoin de dormir|a dormir|c est long|trop long)/],
  ['complement', /(t es gentil|t es bien|je t'aime|j'adore ce que tu fais|tu es awesome|tu gères|bravo pour|t'es intelligent)/],
  ['encouragement', /(je dois mais j ai pas envie|je sens que je vais pas y arriver|aide moi a|je veux mais|je bloque|je m enfonce)/],
  ['question', /[?]\s*$|^(pourquoi|c est quoi|cest quoi|comment|comment je|est ce que|qu est ce que|ou |quand |qui |quel |quelle )/],
  ['vide', /^[?.!,;:]*$|^[a-z]{1,2}$/]
];

// Détecte la situation d'un message. Retourne '' si rien de reconnu.
function detecterSituation(msg) {
  const brut = String(msg || '').trim();
  if (!brut) return 'vide';
  const m = sansAccents(brut)
    .replace(/[\u2018\u2019]/g, "'")
    // "qui es-tu", "c'est quoi" : le trait d'union et l'apostrophe
    // empechaient les motifs de reconnaitre la question.
    .replace(/[-_/]/g, ' ')
    .replace(/[''`]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  // L'apostrophe a été remplacée par un espace ci-dessus : on cherche donc
  // « je m appelle », pas « je m'appelle ».
  const presentation = /\b(je m appelle|je m.appelle|je me nomme|mon prenom|je suis [a-z])/.test(m);
  for (const [situation, re] of REGLES) {
    if (situation === 'salut' && presentation) continue;
    if (re.test(m)) return situation;
  }
  // Message court sans ponctuation : reaction, pas demande.
  const mots = m.split(/[^a-z0-9']+/).filter(Boolean);
  if (mots.length > 0 && mots.length <= 3 && !/[.!?]/.test(brut)) return 'court';
  return 'generique';
}

// Moment de la journée : sert à varier le ton sans dépendre de l'IA.
function momentJournee(heure) {
  if (heure === undefined) heure = new Date().getHours();
  if (heure < 0 || heure > 23) return 'nuit';
  if (heure >= 5 && heure < 12) return 'matin';
  if (heure >= 12 && heure < 18) return 'apresmidi';
  if (heure >= 18 && heure < 23) return 'soir';
  return 'nuit';
}

// ---------- Banque ----------

class BanqueReplis {
  constructor(repertoire, fichier) {
    this.repertoire = repertoire;
    this.fichier = fichier || path.join(repertoire, 'replis.txt');
    this.bank = new Map();
    this.mtime = 0;
    this.dernierParSituation = new Map();
    this.charger();
  }

  charger() {
    try {
      const st = fs.statSync(this.fichier);
      if (st.mtimeMs === this.mtime && this.bank.size) return;
      const texte = fs.readFileSync(this.fichier, 'utf8');
      const bank = new Map();
      for (const ligne of texte.split('\n')) {
        const pos = ligne.indexOf('|');
        if (pos <= 0) continue;
        const cle = sansAccents(ligne.substring(0, pos).trim());
        if (!cle) continue;
        const variantes = ligne.substring(pos + 1)
          .split(';;')
          .map(v => v.trim())
          .filter(Boolean);
        if (variantes.length) bank.set(cle, variantes);
      }
      this.bank = bank;
      this.mtime = st.mtimeMs;
    } catch (e) {
      if (!this.bank.size) this.bank = new Map();
    }
  }

  taille() {
    return this.bank.size;
  }

  // Tirage d'une variante, en évitant de répéter celle de tout à l'heure.
  tirer(situation) {
    this.charger();
    const variantes = this.bank.get(situation);
    if (!variantes || !variantes.length) return '';
    if (variantes.length === 1) return variantes[0];
    const precedents = this.dernierParSituation.get(situation) || [];
    const disponibles = variantes.filter(v => precedents.indexOf(v) < 0);
    const choix = (disponibles.length ? disponibles : variantes)[
      Math.floor(Math.random() * (disponibles.length ? disponibles.length : variantes.length))
    ];
    // On garde les 3 derniers pour ne pas répéter sur les 3 prochains.
    const memoire = [choix].concat(precedents).slice(0, 3);
    this.dernierParSituation.set(situation, memoire);
    return choix;
  }

  // Chaîne de repli complète : situation détectée → erreur_ia → générique.
  // `situationForcee` permet d'ignorer la détection (utilisé pour "question",
  // où l'on ne veut surtout pas une vanne hors sujet).
  repli(message, situationForcee) {
    const situation = situationForcee || detecterSituation(message);
    return this.tirer(situation) || this.tirer('erreur_ia') || this.tirer('generique') || '';
  }

  // Variante adaptée à l'heure, si la banque en propose une.
  repliMoment(message) {
    const base = this.repli(message);
    const nuit = this.tirer(momentJournee());
    return base || nuit || '';
  }
}

module.exports = { BanqueReplis, detecterSituation, momentJournee, sansAccents };