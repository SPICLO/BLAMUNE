// =====================================================================
//  WEB PUSH — notifications hors conversation
// =====================================================================
//  Sprint E. Zéro dépendance npm : VAPID (RFC 8292) et le chiffrement
//  aes128gcm (RFC 8188 / 8291) tiennent tout entiers dans le crypto natif
//  de Node — ECDH P-256, HKDF-SHA256, AES-128-GCM, signature ES256.
//
//  Ce que le module donne :
//   - creerPush() : l'objet high-level câblé aux données utilisateur
//     (sauver/retirer/envoyer). Actif SEULEMENT si VAPID_PRIVATE_KEY est
//     configurée : sans elle, tout reste neutre — les routes existent,
//     rien ne part, la pile proactif par sonde continue comme avant.
//   - validerAbonnement() : garde-fou avant toute écriture sur disque.
//   - chiffrerPayload() / creerJetonVAPID() : primitives pures, testées
//     sans réseau dans tests/lib.test.js (roundtrip complet).
//
//  Une endpoint d'abonnement peut être http:// UNIQUEMENT quand NODE_ENV
//  vaut 'test' : les navigateurs fournissent toujours du https ; les tests
//  d'intégration branchent un faux service push local.
// =====================================================================
'use strict';

const crypto = require('crypto');

// ---------------- base64url ----------------

function versB64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function depuisB64url(s) {
  return Buffer.from(String(s || ''), 'base64url');
}

// ---------------- clés VAPID ----------------

// La clé privée arrive de l'env en base64url : exactement 32 octets, la
// coordonnée privée d'une courbe P-256. La clé publique (x, y) est
// dérivée localement par ECDH puis tout passe en JWK vers Node : aucun
// ASN.1 à écrire à la main, et le décodeur fait les vérifications.
function clePriveeDepuisBase64url(crue) {
  const donnees = depuisB64url(crue);
  if (donnees.length !== 32)
    throw new Error('VAPID_PRIVATE_KEY doit etre une cle privee P-256 en base64url (32 octets)');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(donnees);
  const publique = ecdh.getPublicKey(); // 65 octets, non compresse
  return crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: publique.slice(1, 33).toString('base64url'),
      y: publique.slice(33, 65).toString('base64url'),
      d: donnees.toString('base64url')
    },
    format: 'jwk'
  });
}

// La clé publique est DÉRIVÉE de la privée (un seul secret à configurer —
// moins d'erreurs que deux variables d'env à garder cohérentes). Retour :
// le point brut non compressé (65 octets), encodé base64url — le format
// attendu par les navigateurs (applicationServerKey) et par l'entête
// Authorization "k=".
function clePubliqueBrute(clePrivee) {
  const spki = crypto.createPublicKey(clePrivee).export({ type: 'spki', format: 'der' });
  return spki.slice(spki.length - 65);
}

// ---------------- VAPID (RFC 8292) ----------------

// JWT ES256 court vécu : aud = l'origine du service push, sub = un
// mailto: obligatoire, exp ~12 h. La signature est vérifiée par le
// service push au moment de l'envoi.
function creerJetonVAPID(clePrivee, sujet, origine, maintenant) {
  const emporte = maintenant || Date.now();
  const entete = versB64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const charge = versB64url(
    Buffer.from(
      JSON.stringify({
        aud: origine,
        exp: Math.floor(emporte / 1000) + 12 * 3600,
        sub: sujet
      })
    )
  );
  const signature = crypto.sign(null, Buffer.from(entete + '.' + charge), {
    key: clePrivee,
    dsaEncoding: 'ieee-p1363'
  });
  return entete + '.' + charge + '.' + versB64url(signature);
}

// ---------------- abonnement (validation stricte) ----------------

function estLocalhost(url) {
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

function environTest(env) {
  return (env || process.env).NODE_ENV === 'test';
}

// Un abonnement navigateur : endpoint https (ou localhost en test),
// p256dh = point P-256 non compressé (65 octets), auth = 16 octets
// (certaines implémentations anciennes acceptent jusqu'à 255).
function validerAbonnement(ab, env) {
  if (!ab || typeof ab !== 'object') return 'abonnement absent';
  let url;
  try {
    url = new URL(String(ab.endpoint || ''));
  } catch (e) {
    return 'endpoint invalide';
  }
  if (url.protocol !== 'https:' && (!environTest(env) || !estLocalhost(url))) {
    return 'endpoint non https, refuse';
  }
  let p;
  try {
    p = depuisB64url(ab.keys && ab.keys.p256dh);
  } catch (e) {
    p = null;
  }
  if (!p || p.length !== 65) return 'cle p256dh invalide (65 octets attendus)';
  let a;
  try {
    a = depuisB64url(ab.keys && ab.keys.auth);
  } catch (e) {
    a = null;
  }
  if (!a || a.length < 16 || a.length > 255) return 'secret auth invalide (16 octets attendus)';
  return null; // ok
}

// ---------------- chiffrement aes128gcm (RFC 8291) ----------------

// HKDF-SHA256 : extract(salt, ikm) puis expand(info, longueur).
function hkdf(salt, ikm, info, longueur) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, longueur));
}

// Info HKDF du Content-Encoding au format normatif : la chaîne, suivie
// d'un octet nul NE puis du byte de padding-type (0x01 pour aes128gcm).
// S'arrêter après le seul nul casse le déchiffrement côté navigateur.
function infoAes128gcm(texte) {
  return Buffer.concat([Buffer.from(texte, 'utf8'), Buffer.from([0, 1])]);
}

// Corps de requête complet : entete (salt, taille de record, clé publique
// éphémère du SENDER) + 1 record chiffré AES-128-GCM. Le récepteur
// reconstitue tout à partir de SA clé privée — d'où un roundtrip
// vérifiable en test sans aucun réseau.
function chiffrerPayload(clePubRecepteur, secretAuth, payload, options) {
  const opts = options || {};
  const salt = opts.salt || crypto.randomBytes(16);
  const rs = opts.tailleRecord || 4096;
  const eph = crypto.createECDH('prime256v1');
  eph.generateKeys();
  const clePubSender = eph.getPublicKey(); // 65 octets, non compressé

  // Secret partagé + secret d'authentification -> la cle materielle.
  const ikm = Buffer.concat([eph.computeSecret(clePubRecepteur), secretAuth]);
  const prk = hkdf(
    salt,
    ikm,
    Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), clePubRecepteur, clePubSender]),
    32
  );
  const cek = hkdf(salt, prk, infoAes128gcm('Content-Encoding: aes128gcm'), 16);
  const nonce = hkdf(salt, prk, infoAes128gcm('Content-Encoding: nonce'), 12);

  // Texte clair : payload, padding (zeros), delimiteur final (0x02).
  const placeMax = rs - 17; // 16 octets d'auth GCM + le delimiteur
  const contenu = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  if (contenu.length > placeMax - 1)
    throw new Error('payload trop long pour un record aes128gcm de ' + rs + ' octets');
  const clair = Buffer.alloc(placeMax, 0);
  contenu.copy(clair, 0);
  clair[clair.length - 1] = 2;

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const chiffre = Buffer.concat([cipher.update(clair), cipher.final(), cipher.getAuthTag()]);

  const taille = Buffer.alloc(4);
  taille.writeUInt32BE(rs, 0);
  const entete = Buffer.concat([salt, taille, Buffer.from([clePubSender.length]), clePubSender]);
  return Buffer.concat([entete, chiffre]);
}

// ---------------- envoi HTTP ----------------

function envoyerParHTTP(urlStr, corps, entetes, delaiMs) {
  return new Promise((resoudre, rejeter) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch (e) {
      return rejeter(new Error('endpoint push invalide : ' + urlStr));
    }
    const mod = url.protocol === 'https:' ? require('https') : require('http');
    const req = mod.request(
      url,
      {
        method: 'POST',
        headers: Object.assign(
          {
            'Content-Type': 'application/octet-stream',
            'Content-Length': corps.length
          },
          entetes
        ),
        timeout: delaiMs || 30000
      },
      (reponse) => {
        const morceaux = [];
        reponse.on('data', (d) => morceaux.push(d));
        reponse.on('end', () =>
          resoudre({
            statut: reponse.statusCode,
            corps: Buffer.concat(morceaux).toString('utf8').slice(0, 300)
          })
        );
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout du service push')));
    req.on('error', rejeter);
    req.end(corps);
  });
}

// ---------------- fabrique high-level (cablee au serveur) ----------------

function creerPush(deps) {
  const {
    clePrivee: cleCrue,
    sujet,
    lireAbonnement,
    ecrireAbonnement,
    supprimerAbonnement,
    loggerErreur
  } = deps;

  let clePrivee = null;
  if (cleCrue) {
    try {
      clePrivee = clePriveeDepuisBase64url(cleCrue);
    } catch (e) {
      loggerErreur('push', 'VAPID_PRIVATE_KEY refusee : ' + e.message);
    }
  }
  const actif = !!clePrivee;
  const clePublique = actif ? versB64url(clePubliqueBrute(clePrivee)) : '';
  const sujetFinal = sujet || 'mailto:contact@blamune.local';
  // L'environnement sert a la seule exception de validation : endpoint
  // http:// sur localhost quand NODE_ENV=test (faux service push des tests).
  const env = deps.env || process.env;

  function config() {
    return { actif, cle: clePublique, sujet: sujetFinal };
  }

  async function abonnementSauver(uid, ab) {
    const raison = validerAbonnement(ab, env);
    if (raison) throw new Error(raison);
    if (!uid) throw new Error('utilisateur inconnu');
    ecrireAbonnement(uid, ab);
    return true;
  }

  function abonnementRetirer(uid) {
    supprimerAbonnement(uid);
  }

  // Un envoi : entete VAPID, chiffrement aes128gcm du message JSON
  // { titre, corps, url }, POST. 404/410 = abonnement mort (le navigateur
  // a change de cles ou l'utilisateur a purger les notifs) : on retire le
  // fichier pour ne pas retenter a chaque vague.
  async function envoyer(uid, message) {
    const ab = lireAbonnement(uid);
    if (!ab) return { ok: false, raison: 'pas d abonnement' };
    const urlAb = new URL(ab.endpoint);
    const jeton = creerJetonVAPID(clePrivee, sujetFinal, urlAb.origin);
    const charge = Buffer.from(
      JSON.stringify({
        titre: (message && message.titre) || 'BLAMUNE',
        corps: (message && message.corps) || '',
        url: (message && message.url) || '/'
      })
    );
    const corps = chiffrerPayload(depuisB64url(ab.keys.p256dh), depuisB64url(ab.keys.auth), charge);
    const reponse = await envoyerParHTTP(ab.endpoint, corps, {
      'Content-Encoding': 'aes128gcm',
      Authorization: 'vapid t=' + jeton + ', k=' + clePublique,
      TTL: '86400',
      Urgency: message && message.urgent ? 'high' : 'normal'
    });
    const ok2xx = reponse.statut >= 200 && reponse.statut < 300;
    if (!ok2xx && (reponse.statut === 404 || reponse.statut === 410)) {
      abonnementRetirer(uid);
      return { ok: false, statut: reponse.statut, raison: 'abonnement expire (retire)' };
    }
    if (!ok2xx) loggerErreur('push', 'envoi refuse HTTP ' + reponse.statut + ' ' + reponse.corps);
    return { ok: ok2xx, statut: reponse.statut };
  }

  return { actif, config, abonnementSauver, abonnementRetirer, envoyer, lireAbonnement };
}

module.exports = {
  creerPush,
  validerAbonnement,
  chiffrerPayload,
  creerJetonVAPID,
  clePriveeDepuisBase64url,
  clePubliqueBrute
};
