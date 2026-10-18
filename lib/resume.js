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

// On replie quand il reste au moins SEUIL echanges non couverts, par
// blocs de BLOC : le resume progresse donc de 10 en 10.
const RESUME_SEUIL = 10;
const RESUME_BLOC = 10;

function creerResume({
  dossierUser,
  cheminHistorique,
  questionModele,
  nettoyerReponse,
  loggerErreur
}) {
  // Un resume par (utilisateur, mode) : deux modes ne doivent pas melanger
  // leurs contextes.
  const enCours = {};

  function cheminResume(uid, mode) {
    return path.join(dossierUser(uid), 'resume_mode' + mode + '.json');
  }

  function lireResume(uid, mode) {
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
    try {
      fs.writeFileSync(cheminResume(uid, mode), JSON.stringify(r), 'utf8');
    } catch (e) {}
  }

  function supprimerResume(uid, mode) {
    try {
      fs.unlinkSync(cheminResume(uid, mode));
    } catch (e) {}
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
      if (hist.length - resume.couverts < RESUME_SEUIL) return;
      const debut = resume.couverts;
      // Le seuil garantit un bloc plein, donc slice() suffit et renvoie
      // exactement RESUME_BLOC elements.
      const bout = hist.slice(debut, debut + RESUME_BLOC);
      const anterieur = resume.texte ? resume.texte + '\n\n' : '';
      const donnees = bout
        .map(
          (e) => (e && e.qui === 'moi' ? 'Utilisateur : ' : 'BLAMUNE : ') + ((e && e.texte) || '')
        )
        .join('\n');
      const consigne =
        'RESUME-CONVERSATION\n' +
        'Tu resumes une conversation entre BLAMUNE et un utilisateur. Reponds UNIQUEMENT par le resume, ' +
        "en francais, 60 mots maximum, sans liste a puces, sans guillemets, sans phrase d'intro.\n" +
        (anterieur
          ? "Resume deja etabli (le completer sans rien perdre d'important) :\n" +
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

module.exports = { creerResume };
