'use strict';
// =====================================================================
//  Comparaison en temps constant des secrets (jetons, ego)
// =====================================================================
//  Un `===` natif s'arrete au premier octet different : en mesurant le
//  temps de reponse, un attaquant peut theoriquement deviner un secret
//  octet par octet. crypto.timingSafeEqual supprime ce signal, mais
//  EXIGE des longueurs egales (sinon exception). On normalise donc les
//  deux cotes par un sha256 avant comparaison : le resultat compare fait
//  toujours 32 octets, quelle que soit l'entree, et rien ne fuit.
// =====================================================================

const crypto = require('crypto');

function egaleTimingSafe(a, b) {
  const bufA = crypto
    .createHash('sha256')
    .update(String(a == null ? '' : a))
    .digest();
  const bufB = crypto
    .createHash('sha256')
    .update(String(b == null ? '' : b))
    .digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { egaleTimingSafe };
