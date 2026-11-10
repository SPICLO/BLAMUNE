// =====================================================================
//  Auto-test d'identite (tache de fond quotidienne)
// =====================================================================
//  Chaque jour, le bot SE POSE ses questions d'identite dans 4 langues
//  (celles verifiees a la main : fr, en, es, ar) et verifie les reponses :
//   - le createur cite est BLAMUNE, jamais OpenAI ni un autre nom de
//     modele ou entreprise ;
//   - la date de mise en ligne est juillet 2026 (juillet/July/julio/يوليو).
//  Resultat : tests_identite.json a la racine, lu par /admin/test-identite
//  et inclus dans la sauvegarde cloud. Un echec d'identite est ALARME (log
//  d'erreur dedie + push admin si dispo) ; un echec du pool sature (429,
//  timeout) est compte "hors ligne" et n'alarme pas : ce n'est pas une
//  faute du bot, c'est un test qui n'a pas pu tourner.
//
//  Pourquoi une tache de fond : une identite fausse vaut un bug numerote.
//  Elle peut revenir a tout moment (nouveau modele du pool, prompt modifie,
//  RAG qui pollue). Le visiteur ne doit jamais la decouvrir le premier.
// =====================================================================
'use strict';

const fs = require('fs');
const path = require('path');

// 12 questions exactes, 3 par langue (createur + date + annee, chiffre ENTIER).
// createurRe : la reponse DOIT nommer BLAMUNE ; dateRe : fragment d'une
// date de mise en ligne acceptee (espaces souples pour la ponctuation).
// La troisieme question verifie le bug "226" : l'annee demandee nue doit
// ressortir 2026 EN ENTIER, jamais abregee.
const QUESTIONS = [
  ['fr', "Qui t'a créé ?", /blamune/i, 'juillet\\s*2026'],
  ['fr', 'Depuis quand es-tu en ligne ?', /blamune/i, 'juillet\\s*2026'],
  ['fr', 'En quelle année as-tu été créé ?', /blamune|2026/i, '20\\s*26'],
  ['en', 'Who created you?', /blamune/i, 'july\\s*2026'],
  ['en', 'Since when are you online?', /blamune/i, 'july\\s*2026'],
  ['en', 'What year were you created?', /blamune|2026/i, '2026'],
  ['es', '¿Quién te creó?', /blamune/i, 'julio\\s*(?:de\\s*)?2026'],
  ['es', '¿Desde cuándo estás en línea?', /blamune/i, 'julio\\s*(?:de\\s*)?2026'],
  ['es', '¿En qué año fuiste creado?', /blamune|2026/i, '2026'],
  ['ar', 'من صنعك؟', /blamune/i, 'يوليو\\s*2026'],
  ['ar', 'منذ متى أنت على الإنترنت؟', /blamune/i, 'يوليو\\s*2026'],
  ['ar', 'في أي سنة خلقت؟', /blamune|2026/i, '2026']
];

// Les noms qu'AUCUNE reponse d'identite n'a le droit de contenir (le
// createur n'est jamais un modele ni une autre entreprise).
const NOMS_INTERDITS = /openai|gpt|chatgpt|anthropic|claude|gemini|deepseek/gi;

// Est-ce une erreur du POOL (429, timeout...) plutot qu'une faute du bot ?
function erreurDePool(reponse, erreurMessage) {
  const indice = [erreurMessage || '', String(reponse || '')].join(' ').toLowerCase();
  return /429|insufficient|invalid api key|rate limit|timeout|timed out|fetch failed|econn|enotfound|no credits/.test(
    indice
  );
}

function creerAutoTestIdentite(deps) {
  const {
    racine,
    questionModeleFond, // async (messages) => texte brut du membre de fond
    promptBLAMUNE, // () => le prompt systeme ACTUEL du mode BLAMUNE
    loggerErreur,
    envoyerAAdmin // optionnel : async (texte) => push de notification a l'admin
  } = deps;

  const chemin = path.join(racine, 'tests_identite.json');
  let enCours = false;

  function etat() {
    try {
      return JSON.parse(fs.readFileSync(chemin, 'utf8'));
    } catch (e) {
      return { actif: true, jamais: 'le premier test tourne 5 min apres le boot' };
    }
  }

  function ecrireRapport(rapport) {
    try {
      fs.writeFileSync(chemin, JSON.stringify(rapport, null, 2));
    } catch (e) {
      loggerErreur('identite-auto', 'ecriture: ' + (e && e.message));
    }
  }

  async function tester() {
    if (enCours) return etat();
    enCours = true;
    const echecs = [];
    let horsLigne = 0;
    const debut = Date.now();
    try {
      for (const [lang, q, createurRe, dateRe] of QUESTIONS) {
        let brut = '';
        try {
          brut = await questionModeleFond([
            { role: 'system', content: promptBLAMUNE() },
            { role: 'user', content: q }
          ]);
        } catch (e) {
          loggerErreur('identite-auto', 'pool (' + lang + '): ' + (e && e.message));
          horsLigne++;
          await new Promise((r) => setTimeout(r, 15000));
          continue;
        }
        const reponse = String(brut || '').trim();
        NOMS_INTERDITS.lastIndex = 0;
        const nomInterdit = NOMS_INTERDITS.exec(reponse);
        let faute = null;
        if (!reponse || erreurDePool(reponse, '')) horsLigne++;
        else if (nomInterdit) faute = 'cite "' + nomInterdit[0] + '" comme createur';
        else if (!createurRe.test(reponse)) faute = 'BLAMUNE absent de la reponse';
        else if (!new RegExp(dateRe, 'i').test(reponse))
          faute = 'date de mise en ligne absente (' + dateRe.replace(/\\s\*/g, ' ') + ')';
        if (faute) {
          echecs.push({ lang, q, remarque: faute, reponse: reponse.substring(0, 300) });
          loggerErreur(
            'identite-auto',
            'FAUTE (' + lang + '): ' + faute + ' -> ' + reponse.substring(0, 150)
          );
        }
        // Respiration : le membre de fond porte aussi les taches du
        // serveur (extractions, resumes). Aller plus vite le degrade
        // et peut satureurer le pool aux yeux du chat des visiteurs.
        await new Promise((r) => setTimeout(r, 15000));
      }
    } finally {
      enCours = false;
    }
    const rapport = {
      actif: true,
      date: new Date().toISOString(),
      dureeMs: Date.now() - debut,
      total: QUESTIONS.length,
      reussis: QUESTIONS.length - echecs.length - horsLigne,
      horsLigne,
      ok: echecs.length === 0,
      echecs
    };
    ecrireRapport(rapport);
    if (echecs.length) {
      loggerErreur(
        'identite-auto',
        'ECHEC ' +
          echecs.length +
          '/' +
          QUESTIONS.length +
          ' : ' +
          echecs.map((x) => x.lang + ' -> ' + x.remarque).join(' ; ')
      );
      if (typeof envoyerAAdmin === 'function') {
        envoyerAAdmin(
          '⚠ Test d identite : ' +
            echecs.length +
            ' echec(s) sur ' +
            QUESTIONS.length +
            ' (' +
            echecs[0].lang +
            ' : ' +
            echecs[0].remarque +
            ')'
        ).catch(() => {});
      }
    }
    return rapport;
  }

  return { lancer: tester, etat };
}

module.exports = { creerAutoTestIdentite, QUESTIONS };
