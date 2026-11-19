// =====================================================================
//  Resume de conversation
// =====================================================================
//  L'API ne recoit qu'un fenetre reduite des derniers echanges : au-dela,
//  le debut de la discussion etait perdu pour toujours. On replie donc
//  periodiquement les anciens echanges dans un resume persistant, relu a
//  chaque message.
//
//  L'appel au modele se fait APRES la reponse, en tache de fond : zero
//  latence ajoutee pour l'utilisateur.
//
//  Extrait de server.js. Tout ce qui touche au reste du serveur
//  (dossier utilisateur, historique, appel modele, journal) est injecte.
// =====================================================================
'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------
//  Reglages
// ---------------------------------------------------------------------
//  QUAND replier : au moins SEUIL echanges non couverts, OU au moins
//  SEUIL_CAR caracteres non couverts. Le second declencheur rattrape les
//  conversations ou quatre messages tres longs suffisent a sortir de la
//  fenetre : sans lui, la memoire attendait le dixieme message et le
//  debut etait perdu.
//
//  COMBIEN replier : jusqu'a BLOC echanges d'un coup. Le bloc est plus
//  large que le seuil parce que le repli est paye (un appel modele) et
//  rare (TACHE_RESUME_MIN_MS cote serveur) : mieux vaut couvrir large
//  quand on paie que repasser pour 10 de plus.
//
//  COMBIEN GARDER : le resume est injecte a CHAQUE message (bloc
//  "CE QUE VOUS AVIEZ DIT AVANT"). Il est donc borne dur par MAX_CAR :
//  au-dela, le resume deviendrait le premier poste de tokens de la
//  requete, exactement ce qu'on cherche a eviter.
const RESUME_SEUIL = 10;
const RESUME_SEUIL_CAR = 3000;
const RESUME_BLOC = 20;
const RESUME_MAX_CAR = 1100;
// Consigne au modele : 140 mots tiennent dans MAX_CAR avec les libelles
// QUI / FIL / PROMIS / TON. Le plafond de caracteres reste la seule
// garantie dure — un modele bavard ne peut pas le franchir.
const RESUME_MAX_MOTS = 140;
const RESUME_MARQUE_COUPE = ' [...]';

/** Coupe un resume trop long sur une frontiere de mot, sans jamais
 *  depasser maxCar (marque de troncature incluse). */
function bornerResume(texte, maxCar) {
  const t = String(texte == null ? '' : texte);
  if (t.length <= maxCar) return t;
  const place = maxCar - RESUME_MARQUE_COUPE.length;
  if (place <= 0) return t.slice(0, maxCar);
  const coupe = t.slice(0, place);
  // Ne pas laisser un demi-mot : on recule jusqu'au dernier espace. Si la
  // coupe etait deja dans un mot tres long, on garde la tranche brute.
  const propre = coupe.replace(/\s+\S*$/, '');
  return (propre.length >= Math.floor(place / 2) ? propre : coupe) + RESUME_MARQUE_COUPE;
}

function creerResume({
  dossierUser,
  cheminHistorique,
  questionModele,
  nettoyerReponse,
  loggerErreur,
  ecritures,
  // Seuils injectables : les tests ont besoin de declencher un repli sans
  // fabriquer 10 messages de 400 caracteres.
  seuil = RESUME_SEUIL,
  seuilVolume = RESUME_SEUIL_CAR,
  bloc = RESUME_BLOC,
  maxCar = RESUME_MAX_CAR
}) {
  // Cache en mémoire pour eviter de lire un fichier qui vient d'etre modifie
  // mais pas encore flush sur disque par ecritures.differer().
  const cacheMemoire = new Map();

  function cleCache(uid, mode) {
    return String(uid) + '_' + String(mode);
  }

  // Un resume par (utilisateur, mode) : deux modes ne doivent pas melanger
  // leurs contextes.
  const enCours = {};

  function cheminResume(uid, mode) {
    return path.join(dossierUser(uid), 'resume_mode' + mode + '.json');
  }

  function lireResume(uid, mode) {
    // Si le contenu est en cache (ecriture differee pas encore flush), le
    // retourner immediatement sans toucher le disque.
    const cle = cleCache(uid, mode);
    if (cacheMemoire.has(cle)) return cacheMemoire.get(cle);
    try {
      const f = cheminResume(uid, mode);
      if (!fs.existsSync(f)) return { texte: '', couverts: 0 };
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      return {
        texte: typeof d.texte === 'string' ? d.texte : '',
        couverts: typeof d.couverts === 'number' ? d.couverts : 0
      };
    } catch (e) {
      return { texte: '', couverts: 0 };
    }
  }

  function ecrireResume(uid, mode, r) {
    const cle = cleCache(uid, mode);
    // Le plafond est applique a l'ecriture, pas seulement au repli : quel
    // que soit l'appelant, ce qui sera relu et injecte reste borne.
    const borne = {
      ...r,
      texte: bornerResume(r && r.texte, maxCar)
    };
    // Mettre a jour le cache immediatement pour que la prochaine lecture
    // voie la modification sans attendre le flush disque.
    cacheMemoire.set(cle, borne);
    if (ecritures) {
      ecritures.differer('resume:' + cle, cheminResume(uid, mode), JSON.stringify(borne));
    } else {
      try {
        fs.writeFileSync(cheminResume(uid, mode), JSON.stringify(borne), 'utf8');
      } catch (e) {
        // Un resume qui ne s'ecrit pas est refait a chaque demarrage (appel
        // modele paye) et l'utilisateur perd le fil ancien de la conversation.
        loggerErreur('resume', 'ecriture impossible: ' + ((e && e.message) || e));
      }
    }
  }

  function supprimerResume(uid, mode) {
    const cle = cleCache(uid, mode);
    cacheMemoire.delete(cle);
    try {
      fs.unlinkSync(cheminResume(uid, mode));
    } catch (e) {
      // ENOENT est normal (aucun resume encore ecrit) : on ne signale que
      // les vrais echecs, sinon chaque effacement d'historique ferait du bruit.
      if (e && e.code !== 'ENOENT') {
        loggerErreur('resume', 'suppression impossible: ' + ((e && e.message) || e));
      }
    }
  }

  /** Replie les anciens echanges. Silencieux : c'est une tache de fond. */
  async function majResume(uid, mode) {
    const cle = uid + '_' + mode;
    // Un seul repliement a la fois par couple (uid, mode).
    if (enCours[cle]) return;
    enCours[cle] = true;
    try {
      const f = cheminHistorique(uid, mode);
      if (!fs.existsSync(f)) return;
      const hist = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!Array.isArray(hist)) return;
      const resume = lireResume(uid, mode);
      // Historique efface entre temps : le resume ne decrit plus rien de vrai.
      if (resume.couverts > hist.length) {
        supprimerResume(uid, mode);
        return;
      }
      // Deux declencheurs : le nombre d'echanges (cas normal) et le volume
      // en caracteres (quelques messages tres longs sortent de la fenetre
      // avant d'atteindre 10 echanges).
      const nonCouverts = hist.slice(resume.couverts);
      const carNonCouverts = nonCouverts.reduce(
        (n, e) => n + String((e && e.texte) || '').length,
        0
      );
      if (nonCouverts.length < seuil && carNonCouverts < seuilVolume) return;
      const debut = resume.couverts;
      const bout = nonCouverts.slice(0, bloc);
      const anterieur = resume.texte ? resume.texte + '\n\n' : '';
      const donnees = bout
        .map(
          (e) => (e && e.qui === 'moi' ? 'Utilisateur : ' : 'BLAMUNE : ') + ((e && e.texte) || '')
        )
        .join('\n');
      // Le prompt demande une REECRITURE complete avec une structure fixe.
      // L'ancien format (60 mots plats, "complete sans rien perdre") poussait
      // au collage bout a bout : au bout de trois replis, le resume etait une
      // liste de redites qui grossissait sans jamais se reorganiser. Une
      // structure QUI / FIL / PROMIS / TON oblige a choisir ce qui compte.
      const consigne =
        'RESUME-CONVERSATION\n' +
        "Tu tiens la memoire longue d'une conversation entre BLAMUNE et un utilisateur.\n" +
        'Reecris le resume COMPLET de ce qui compte : une vraie reecriture, jamais un ajout a la suite.\n' +
        'En francais, ' +
        RESUME_MAX_MOTS +
        " mots maximum, sans phrase d'intro, sans guillemets, sans liste a puces.\n" +
        'Quatre lignes, une par libelle, dans cet ordre :\n' +
        'QUI : qui est la personne (nom, age, metier, ville, ce qu\'elle aime) ; "inconnu" si rien.\n' +
        "FIL : les faits et l'etat de la conversation (projets, evenements, sujets ouverts).\n" +
        'PROMIS : ce que BLAMUNE a promis de retenir ou de faire ; "rien" si rien.\n' +
        'TON : le registre entre eux (blagueur, intime, taquin, serieux) et ce qui le fait basculer.\n' +
        'Laisse de cote les salutations, les hesitations et les details techniques.\n' +
        (anterieur
          ? "Resume deja etabli (a reecrire, pas a recopier tel quel ; ne perds rien d'important) :\n" +
            anterieur +
            '\n\n'
          : '') +
        'Suite de la conversation :\n' +
        donnees;
      const brut = await questionModele(consigne);
      const propre = nettoyerReponse(String(brut || '')).trim();
      if (propre && propre !== '...') {
        ecrireResume(uid, mode, { texte: propre, couverts: debut + bout.length });
      }
    } catch (e) {
      loggerErreur('resume', e.message);
    } finally {
      enCours[cle] = false;
    }
  }

  return { cheminResume, lireResume, ecrireResume, supprimerResume, majResume };
}

module.exports = {
  creerResume,
  bornerResume,
  RESUME_SEUIL,
  RESUME_SEUIL_CAR,
  RESUME_BLOC,
  RESUME_MAX_CAR,
  RESUME_MAX_MOTS,
  RESUME_MARQUE_COUPE
};
