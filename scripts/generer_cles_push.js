#!/usr/bin/env node
// ============================================================
//  Generateur de cles VAPID pour le Web Push de BLAMUNE.
//
//  Une commande, un couple de valeurs a poser dans .env :
//    VAPID_PRIVATE_KEY  (obligatoire) — active les notifications
//    VAPID_SUBJECT      (recommande) — mailto:contact@...
//
//  La cle publique n'a PAS besoin d'etre configuree : le serveur la
//  derive de la privee et l'expose par GET /push/config.
//
//  Usage :   node scripts/generer_cles_push.js
//  Format :  P-256 (prime256v1), 32 octets, base64url — la norme VAPID
//            ne sait pas faire autrement.
// ============================================================
'use strict';

const crypto = require('crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1'
});

// d = coordonnee privee brute (32 octets) ; x, y = point public.
const jwk = privateKey.export({ format: 'jwk' });

console.log('');
console.log('Ajoute cette ligne dans ton .env (et redemarre le serveur) :');
console.log('');
console.log('  VAPID_PRIVATE_KEY=' + jwk.d);
console.log('  VAPID_SUBJECT=mailto:contact@ton-domaine');
console.log('');
console.log('Cle publique derivee (informatif, le serveur la recalcule) :');
const spki = publicKey.export({ type: 'spki', format: 'der' });
console.log('  ' + spki.slice(spki.length - 65).toString('base64url'));
console.log('');
