// ====================================================================
//  Tests unitaires : lib/securite.js (partie 3)
// ====================================================================
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { SCRYPT_PARAMS, uidValide } = require('../lib/securite');

test('SCRYPT_PARAMS: les parametres scrypt sont corrects', () => {
  assert.equal(SCRYPT_PARAMS.cost, 16384);
  assert.equal(SCRYPT_PARAMS.blockSize, 8);
  assert.equal(SCRYPT_PARAMS.parallelization, 1);
  assert.ok(SCRYPT_PARAMS.maxmem >= 64 * 1024 * 1024);
});

test('uidValide: accepte des caracteres speciaux valides', () => {
  assert.ok(uidValide('u' + '0'.repeat(12)));
  assert.ok(uidValide('u' + 'a'.repeat(12)));
  assert.ok(uidValide('inv_' + '0'.repeat(24)));
});

test('uidValide: refuse les caracteres unicode', () => {
  assert.ok(!uidValide('u' + 'é'.repeat(12)));
  assert.ok(!uidValide('inv_' + 'ñ'.repeat(24)));
});
