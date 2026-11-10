// =====================================================================
//  Nettoyage du bin JSONBin : supprime les invites inactives (> 24 h)
//  pour garder le bin sous 100 Ko (plan gratuit).
//
//  UTILISATION :
//    1. Remplacez VOTRE_JSONBIN_API_KEY ci-dessous par votre vraie clé.
//    2. Remplacez VOTRE_BIN_ID par l'ID de votre bin.
//    3. Lancez :  node scripts/nettoyer_jsonbin.js
//
//  Ce script ne fait qu'AFFICHER ce qui serait supprimé (mode securite).
//  Pour vraiment supprimer, changez SUPPRIMER_REELLEMENT en true.
// =====================================================================
'use strict';

const https = require('https');

// ================= CONFIGUREZ ICI =================
const JSONBIN_API_KEY = 'VOTRE_JSONBIN_API_KEY'; // <-- collez votre cle API jsonbin.io
const JSONBIN_BIN_ID  = '6ab91c80ac6210605afae4b8'; // <-- votre bin (deja renseigne)
const SUPPRIMER_REELLEMENT = false; // mettez true pour vraiment supprimer
// =================================================

const API_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;
const VIE_INVITE_MS = 24 * 60 * 60 * 1000; // 24 h

function requete(path, methode, corps) {
  return new Promise((resolve, reject) => {
    const options = {
      method: methode,
      hostname: 'api.jsonbin.io',
      path: path,
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY,
        'X-Bin-Id': JSONBIN_BIN_ID
      },
      timeout: 15000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (corps) req.write(JSON.stringify(corps));
    req.end();
  });
}

async function main() {
  console.log('[nettoyage] Lecture du bin...');
  const reponse = await requete(`/v3/b/${JSONBIN_BIN_ID}`, 'GET');
  const record = reponse && reponse.record !== undefined ? reponse.record : reponse;

  if (!record || typeof record !== 'object') {
    console.error('[nettoyage] Impossible de lire le bin :', JSON.stringify(reponse).slice(0, 200));
    process.exit(1);
  }

  const maintenant = Date.now();
  const supprimes = { historiques: [], memories: [], comptes: [] };

  // --- Nettoyer les historiques des invites (inv_...) ---
  if (record.historiques && typeof record.historiques === 'object') {
    for (const cle of Object.keys(record.historiques)) {
      if (!cle.startsWith('inv_')) continue;
      const hist = record.historiques[cle];
      const dernierTs = hist && hist.length > 0 ? hist[hist.length - 1].t : 0;
      // t est en secondes dans BLAMUNE, convertir en ms
      const dernierMs = dernierTs ? dernierTs * 1000 : 0;
      const age = dernierMs > 0 ? maintenant - dernierMs : Infinity;

      if (age > VIE_INVITE_MS) {
        supprimes.historiques.push({ cle, ageJours: Math.round(age / 86400000) });
        if (SUPPRIMER_REELLEMENT) delete record.historiques[cle];
      }
    }
  }

  // --- Nettoyer les memoires des invites (inv_...) ---
  if (record.memories && typeof record.memories === 'object') {
    for (const cle of Object.keys(record.memories)) {
      if (!cle.startsWith('inv_')) continue;
      supprimes.memories.push(cle);
      if (SUPPRIMER_REELLEMENT) delete record.memories[cle];
    }
  }

  // --- Rapport ---
  console.log(`\n[nettoyage] Invites detectes pour suppression (plus de 24 h inactifs) :`);
  console.log(`  Historiques : ${supprimes.historiques.length}`);
  supprimes.historiques.forEach((h) => console.log(`    ${h.cle} (inactif depuis ${h.ageJours} jours)`));
  console.log(`  Memoires    : ${supprimes.memories.length}`);
  supprimes.memories.forEach((c) => console.log(`    ${c}`));

  if (supprimes.historiques.length === 0 && supprimes.memories.length === 0) {
    console.log('\n[nettoyage] Rien a supprimer. Le bin est deja propre.');
    return;
  }

  if (!SUPPRIMER_REELLEMENT) {
    console.log('\n[nettoyage] MODE SECURITE ACTIF : rien na ete supprime.');
    console.log('[nettoyage] Pour vraiment supprimer, mettez SUPPRIMER_REELLEMENT = true dans ce script.');
    return;
  }

  // --- VRAIE SUPPRESSION ---
  console.log('\n[nettoyage] Envoi de la suppression au cloud...');
  const resultat = await requete(`/v3/b/${JSONBIN_BIN_ID}`, 'PUT', record);
  console.log('[nettoyage] Termine. Reponse :', JSON.stringify(resultat).slice(0, 300));
}

main().catch((e) => {
  console.error('[nettoyage] Erreur :', e.message);
  process.exit(1);
});