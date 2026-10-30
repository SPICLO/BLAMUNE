/* ==========================================================
   BLAMUNE — registre des projets du studio
   ----------------------------------------------------------
   Tous les projets de la vitrine se déclarent ICI, dans cet
   ordre. Pour ajouter un projet : copier un bloc, l'éditer,
   et c'est tout — la page se met à jour elle-même.
   ----------------------------------------------------------
   Champs :
     numero   : numéro d'édition du studio ("Nº 01", "Nº 02"…)
     nom      : nom du projet, tel qu'affiché
     accroche : la promesse du projet, en une phrase
     statut   : "en ligne" | "en atelier" | "a-venir"
     lien     : URL publique (null si pas encore publiée)
     technique: liste courte de technologies réelles du projet
     note     : texte de détail (2-3 phrases), montré au verso
   Aucune donnée ici ne se ment : un projet sans page publique
   reste "a-venir" jusqu'à sa sortie réelle.
   ========================================================== */

const PROJETS = [
  {
    numero: "Nº 01",
    nom: "BLAMUNE",
    accroche: "Ton ami IA. Discute, apprends-lui des choses, garde ton historique.",
    statut: "en ligne",
    lien: "../blamune-site/index.html",
    technique: ["Node.js 22", "C++14", "PWA", "SQLite", "Web Push"],
    note:
      "Un compagnon de conversation entièrement en français, qui apprend ton nom, ta ville " +
      "et tes goûts, et s'en souvient d'une session à l'autre. Deux modes de discussion, " +
      "une mémoire par utilisateur, une recherche web en profondeur et un bot local en C++ " +
      "qui répond même sans clé API ni réseau. Installable depuis le navigateur comme une app.",
  },
  {
    numero: "Nº 02",
    nom: "Projet à venir",
    accroche: "Le prochain chantier de l'atelier.",
    statut: "a-venir",
    lien: null,
    technique: [],
    note:
      "Réservé pour le prochain projet du studio. Remplace ces lignes dans projets.js : " +
      "nom, accroche, statut et lien — la vitrine le publie toute seule.",
  },
  {
    numero: "Nº 03",
    nom: "Projet à venir",
    accroche: "Une place est gardée.",
    statut: "a-venir",
    lien: null,
    technique: [],
    note: "Troisième édition à paraître.",
  },
];
