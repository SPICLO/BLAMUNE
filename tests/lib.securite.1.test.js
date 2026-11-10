// ====================================================================
//  Tests unitaires : lib/securite.js (partie 1)
// ====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { estBloque } = require('../lib/securite');

// ------------------------------------------------------------------
// 1. estBloque()
// ------------------------------------------------------------------
test('securite.estBloque()', () => {
  assert.ok(estBloque('.env'));
  assert.ok(estBloque('.env.example'));
  assert.ok(estBloque('.env.securise'));
});

test('bloque des extensions exÃ©cutables', () => {
  assert.ok(estBloque('script.ps1'));
  assert.ok(estBloque('start.bat'));
  assert.ok(estBloque('run.cmd'));
  assert.ok(estBloque('app.exe'));
  assert.ok(estBloque('lib.dll'));
  assert.ok(estBloque('lib.so'));
});

test('bloque les bases de donnÃ©es et logs', () => {
  assert.ok(estBloque('savoir.db'));
  assert.ok(estBloque('savoir.sqlite'));
  assert.ok(estBloque('logs/app.log'));
  assert.ok(estBloque('temp.tmp'));
  assert.ok(estBloque('backup.bak'));
});

test('bloque les certificats ou clÃ©s', () => {
  assert.ok(estBloque('key.pem'));
  assert.ok(estBloque('cert.key'));
  assert.ok(estBloque('cert.crt'));
  assert.ok(estBloque('cert.pfx'));
});

test('bloque les fichiers de configuration sensibles', () => {
  assert.ok(estBloque('comptes.json'));
  assert.ok(estBloque('config.json'));
  assert.ok(estBloque('storage.json'));
  assert.ok(estBloque('storage.json.bak'));
});

test('bloque les fichiers de contrÃ´le de projet', () => {
  assert.ok(estBloque('.gitignore'));
  assert.ok(estBloque('.dockerignore'));
  assert.ok(estBloque('SECURITY.md'));
  assert.ok(estBloque('CONTRIBUTING.md'));
  assert.ok(estBloque('CHANGELOG.md'));
  assert.ok(estBloque('DESIGN.md'));
  assert.ok(estBloque('PRODUCT.md'));
  assert.ok(estBloque('CLOUD.md'));
  assert.ok(estBloque('KEEPALIVE.md'));
});

test('ne bloque pas des fichiers HTML/CSS/JS', () => {
  assert.ok(!estBloque('index.html'));
  assert.ok(!estBloque('style.css'));
  assert.ok(!estBloque('app.js'));
  assert.ok(!estBloque('admin.html'));
});
