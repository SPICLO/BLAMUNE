// ====================================================================
//  Validation — Schemas et sanitisation des entrees
// ====================================================================
// Validation stricte du corps JSON et des parametres pour les routes
// mutantes (/send, /login, /register, /admin/*...).
// Rejecte tout champ inattendu, limite les tailles, sanitise.
// ====================================================================
'use strict';

const { uidValide } = require('./securite');

// ------------------------------------------------------------------
// Tailles maximales (en caracteres)
// ------------------------------------------------------------------
const TAILLE_MAX_MESSAGE = 4000;
const TAILLE_MAX_UID = 64;
const TAILLE_MAX_PSEUDO = 32;
const TAILLE_MAX_MDP = 128;
const TAILLE_MAX_CHAMP_LIBRE = 500;

// ------------------------------------------------------------------
// Champs autorises sur /send (body JSON)
// ------------------------------------------------------------------
const CHAMPS_SEND_AUTORISES = new Set(['message', 'msg', 'stream', 'mode', 'image']);

function validerSend(body) {
  const erreurs = [];

  if (!body || typeof body !== 'object') {
    return { ok: false, erreurs: ['Corps de requete invalide'] };
  }

  // Rejecte tout champ non autorise
  const champsInattendus = Object.keys(body).filter((k) => !CHAMPS_SEND_AUTORISES.has(k));
  if (champsInattendus.length > 0) {
    erreurs.push('Champs non autorises : ' + champsInattendus.join(', '));
  }

  // message : obligatoire SAUF avec une photo seule ("vois ca" sans texte
  // est un usage normal : send.js remplace alors par '(photo)').
  // Accepte "msg" (ancien champ) ou "message" (nouveau champ)
  const msg = body.msg !== undefined ? body.msg : body.message;
  const avecPhoto = typeof body.image === 'string' && /^data:image\//.test(body.image);
  if (msg === undefined || msg === null) {
    if (!avecPhoto) erreurs.push('Champ "message" requis');
  } else {
    const trimmed = String(msg).trim();
    if (typeof msg !== 'string') {
      erreurs.push('"message" doit etre une chaine');
    } else if (trimmed.length === 0) {
      if (!avecPhoto) erreurs.push('"message" ne peut pas etre vide');
    } else if (trimmed.length > TAILLE_MAX_MESSAGE) {
      erreurs.push('"message" trop long (max ' + TAILLE_MAX_MESSAGE + ')');
    }
  }

  // stream : optionnel, boolean — MAIS le site envoie un formulaire
  // (application/x-www-form-urlencoded) ou "stream=1" arrive en CHAINE.
  // BUG CORRIGE (2026-11-12) : la validation n'acceptait que le booleen
  // JSON, donc TOUT message du site repondait 400 « "stream" doit etre un
  // boolean » — la page croyait alors le serveur injoignable. On accepte
  // les deux formes : booleen (API JSON) et chaine de formulaire.
  let streamDemande = false;
  if (body.stream !== undefined) {
    const brut = body.stream;
    if (typeof brut === 'boolean') {
      streamDemande = brut;
    } else if (typeof brut === 'string') {
      const s = brut.trim().toLowerCase();
      if (s === '1' || s === 'true' || s === 'on') streamDemande = true;
      else if (s === '0' || s === 'false' || s === 'off' || s === '') streamDemande = false;
      else erreurs.push('"stream" doit etre un boolean');
    } else {
      erreurs.push('"stream" doit etre un boolean');
    }
  }

  // image : optionnel. DEUX formes reelles :
  //   - une data URL (site/app.js envoie `image=data:image/png;base64,...`) ;
  //   - un booleen (anciens clients/outils qui disaient seulement "il y a
  //     une photo").
  // BUG CORRIGE (2026-11-10) : la validation n'acceptait QUE le booleen, donc
  // TOUTE photo jointe depuis le site repondait 400 "image doit etre un
  // boolean" — alors que send.js sait parfaitement la decoder et que la
  // suite d'integration le verifie. La forme exacte (mime, taille) est
  // controlee plus loin, dans /send (7 Mo max, jpeg/png/webp/gif).
  if (
    body.image !== undefined &&
    typeof body.image !== 'boolean' &&
    typeof body.image !== 'string'
  ) {
    erreurs.push('"image" doit etre une data URL ou un boolean');
  }

  // mode : optionnel, doit etre '1' ou '2'
  if (body.mode !== undefined && body.mode !== '1' && body.mode !== '2') {
    erreurs.push('"mode" doit valoir "1" ou "2"');
  }

  return {
    ok: erreurs.length === 0,
    erreurs,
    message: typeof msg === 'string' ? msg : undefined,
    stream: streamDemande,
    mode: body.mode || '2'
  };
}

// ------------------------------------------------------------------
// Validation d'un uid (parametre de requete ou header)
// ------------------------------------------------------------------
function validerUid(uid) {
  if (!uidValide(uid)) {
    return { ok: false, erreur: 'UID invalide' };
  }
  return { ok: true, uid };
}

// ------------------------------------------------------------------
// Validation d'un pseudo (inscription / profil)
// ------------------------------------------------------------------
function validerPseudo(pseudo) {
  const erreurs = [];
  if (!pseudo || typeof pseudo !== 'string') {
    erreurs.push('Pseudo requis');
    return { ok: false, erreurs };
  }
  const p = pseudo.trim();
  if (p.length < 3 || p.length > TAILLE_MAX_PSEUDO) {
    erreurs.push('Pseudo trop court (min 3 caracteres)');
  }
  if (!/^[A-Za-z0-9_.\-]+$/.test(p)) {
    erreurs.push('Pseudo : seulement lettres, chiffres, _, ., -');
  }
  if (p.toLowerCase() === 'admin') {
    erreurs.push('Pseudo reserve');
  }
  return {
    ok: erreurs.length === 0,
    erreurs,
    pseudo: p
  };
}

// ------------------------------------------------------------------
// Validation d'un mot de passe
// ------------------------------------------------------------------
function validerMotDePasse(mdp) {
  const erreurs = [];
  if (!mdp || typeof mdp !== 'string') {
    erreurs.push('Mot de passe requis');
    return { ok: false, erreurs };
  }
  if (mdp.length < 8) {
    erreurs.push('Mot de passe trop court (min 8 caracteres)');
  }
  if (mdp.length > TAILLE_MAX_MDP) {
    erreurs.push('Mot de passe trop long (max ' + TAILLE_MAX_MDP + ')');
  }
  return { ok: erreurs.length === 0, erreurs };
}

// ------------------------------------------------------------------
// Sanitisation d'une valeur de champ memoire (nom, ville, etc.)
// ------------------------------------------------------------------
function sanitiserValeurChamp(valeur) {
  if (typeof valeur !== 'string') return '';
  return valeur
    .trim()
    .substring(0, TAILLE_MAX_CHAMP_LIBRE)
    .replace(/[\r\n]+/g, ' '); // pas de sauts de ligne dans un champ plat
}

// ------------------------------------------------------------------
// Validation d'un tableau de mots favoris
// ------------------------------------------------------------------
function validerMotsFavoris(mots) {
  if (!Array.isArray(mots)) return { ok: false, erreur: 'motsFavoris doit etre un tableau' };
  if (mots.length > 5) return { ok: false, erreur: 'max 5 mots favoris' };
  const nettoyes = mots
    .map((m) =>
      String(m || '')
        .trim()
        .toLowerCase()
    )
    .filter(Boolean)
    .slice(0, 5);
  return { ok: true, motsFavoris: nettoyes };
}

// ------------------------------------------------------------------
// EXPORTS
// ------------------------------------------------------------------
module.exports = {
  TAILLE_MAX_MESSAGE,
  TAILLE_MAX_UID,
  TAILLE_MAX_PSEUDO,
  TAILLE_MAX_MDP,
  TAILLE_MAX_CHAMP_LIBRE,
  CHAMPS_SEND_AUTORISES,
  validerSend,
  validerUid,
  validerPseudo,
  validerMotDePasse,
  sanitiserValeurChamp,
  validerMotsFavoris
};
