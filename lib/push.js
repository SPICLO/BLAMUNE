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
// éphémère du SENDER) + les records chiffrés AES-128-GCM. Le récepteur
// reconstitue tout à partir de SA clé privée — d'où un roundtrip
// vérifiable en test sans aucun réseau.
//
// Limitation : FCM (et la plupart des services) refusent un corps de
// 4096 octets ou plus. Remplir un record a sa taille max donne un corps
// de rs + 85 octets (86 d'entete + rs - 1 de chiffre) : au-dessus de la
// limite. La norme l'autorise : seul
// le DERNIER record peut être plus court — ce que font les vrais
// navigateurs. On applique donc un padding minimal au dernier record ; les
// records intermédiaires restent remplis (framing : le récepteur lit rs
// octets à la suite, sans pouvoir deviner la fin d'un record non final).
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
  const nonceBase = hkdf(salt, prk, infoAes128gcm('Content-Encoding: nonce'), 12);

  // Texte clair : contenu + padding (zeros) + delimiteur (0x01 = record
  // non final, 0x02 = dernier). Capacité : rs - 16 de clair par record
  // (le tag GCM occupe 16 des rs octets chiffrés). Un record non final
  // deserialize exactement rs octets CHIFFRÉS (rs - 16 de clair) : le
  // récepteur sait où commence le suivant. Le dernier, court, n'est
  // borné que par son delimiteur. Un record non final se lit comme rs
  // octets chiffrés consécutifs.
  const placeMax = rs - 16;
  const contenu = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const morceauMax = placeMax - 1; // chaque record réserve son délimiteur
  const morceaux = [];
  if (contenu.length === 0) {
    morceaux.push({ texte: Buffer.alloc(0), final: true });
  } else {
    for (let depart = 0; depart < contenu.length; depart += morceauMax) {
      morceaux.push({
        texte: contenu.slice(depart, Math.min(depart + morceauMax, contenu.length)),
        final: depart + morceauMax >= contenu.length
      });
    }
  }

  // Nonce par record : nonceBase XOR le numero du record (little-endian
  // sur 12 octets, RFC 8188 §2.2) — le record 0 invoque la base telle
  // quelle.
  function chiffrerRecord(clair, numero) {
    let nonce = nonceBase;
    if (numero > 0) {
      const n = Buffer.from(nonceBase);
      const c = Buffer.alloc(12);
      c.writeUInt32LE(numero, 0);
      for (let i = 0; i < 12; i++) n[i] ^= c[i];
      nonce = n;
    }
    const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
    return Buffer.concat([cipher.update(clair), cipher.final(), cipher.getAuthTag()]);
  }

  const chiffres = morceaux.map((m, i) => {
    if (m.final) {
      const clair = Buffer.alloc(m.texte.length + 1); // padding minimal : 0
      m.texte.copy(clair, 0);
      clair[clair.length - 1] = 2;
      return chiffrerRecord(clair, i);
    }
    const clair = Buffer.alloc(placeMax);
    m.texte.copy(clair, 0);
    clair[clair.length - 1] = 1;
    return chiffrerRecord(clair, i);
  });

  const taille = Buffer.alloc(4);
  taille.writeUInt32BE(rs, 0);
  const entete = Buffer.concat([salt, taille, Buffer.from([clePubSender.length]), clePubSender]);
  return Buffer.concat([entete].concat(chiffres));
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
    // Le corps du service (FCM...) explique souvent le refus en une
    // ligne : remonte a la route d'essai pour qu'elle dise POURQUOI,
    // pas seulement « refuse ».
    return {
      ok: ok2xx,
      statut: reponse.statut,
      detail: ok2xx ? null : reponse.corps.slice(0, 200)
    };
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
