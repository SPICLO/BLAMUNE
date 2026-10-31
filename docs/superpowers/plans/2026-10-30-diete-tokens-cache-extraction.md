# Plan : diete de tokens (saturation) — 2026-10-30

## Objectif

Reduire DRASTIQUEMENT la pression de saturation : moins de tokens factures par
appel de chat, moins d'appels parasites sur le pool, sans toucher a la
personnalite ni a la memorisation.

## Constats de l'audit (faits releves dans le code et la doc Groq)

- Plafond de l'offre : `openai/gpt-oss-120b` = 30 RPM, ~1 000 req/j, ~8 K tokens/min
  (base Doc Groq 2026 ; les limites exactes de l'org sont sur console.groq.com/settings/limits).
- Les tokens CASSES (meme prefixe exact) ne comptent PAS dans les limites Groq :
  prompt cache = gratuit.
- Le prompt mode 2 place la DATE/HEURE variable juste apres la persona
  (server.js, blocSysteme) : le prefixe cache casse a chaque minute → ~0 token cache.
- Fenetre d'historique : HISTO_API_MAX=16 echanges (~2-4 K tokens entree).
- Extraction : batchee 8 s (EXTRACT_PAUSE_MS) et debitee depuis le FOND du pool
  (questionModele -> membreFond(), jamais le principal) mais declenchee pour
  quasi tout message de 6+ mots → gaspille les petits free tiers du fond.
- RESUME : deja seuille a 10 echanges non couverts (RESUME_SEUIL) → aucun chantier.
- Taches de fond : deja hors Groq par design (membreFond) → aucun chantier.

## Chantiers

1. **P1 - Prompt cachable (server.js)**
   - getPromptBLAMUNE() : persona STABLE sans etat interieur.
   - blocSysteme() : ordre final = persona → TON ETAT INTERIEUR → profil →
     humeurUser → lien → jalons/rituels/anniversaires → promesses → resume →
     savoir → souvenirs → **CONTEXTE TEMPS REEL + duree + image (en fin)** →
     intention (toujours en dernier, comme avant).
   - Gain : le prefixe persona (+ profil/resume d'une session) devient cache →
     ~1-2 K tokens gratuits par appel, toute session.
2. **P2 - Historique 16 → 10 (lib/ia/gemini.js)**
   - HISTO_API_MAX 16→10 ; eco reste a 6. Test gardiens mis a jour (10↔6).
3. **P3 - Extraction sur indices (lib/memoire.js + lib/routes/send.js)**
   - nouvel utilitaire pur `indiceMemoire(msg)` : vrai si le message porte des
     indices de memoire (identite, age, lieu, famille, gouts, activites,
     etudes, sante, animal, anniversaire, retiens/rappelle...).
   - La tache d'extraction ne part que si indices (file de batch => rien ne
     se pert ; les messages sans indices ne consomment rien).

## Verification

- npm run test:unit (tests gardiens : eco 10↔6 ; nouveaux tests indiceMemoire).
- npm run lint (0/0) ; prettier.
- npm test (integration) : le site repond, la prompt reste coherente.
- push → verif live (/health chat par Groq, tension a 0) + supervision des
  durees :diag.
