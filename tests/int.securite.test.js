const test = require('node:test');
// ====================================================================
//  Tests d'integration securite â€” node:test
//  Lance le VRAI server.js et verifie que les mesures de securite
//  fonctionnent ensemble.
// ====================================================================
('use strict');

const assert = require('node:assert/strict');
const http = require('http');
const path = require('node:path');

const RACINE = path.resolve(__dirname, '..');

// ------------------- Helpers -------------------
function librePort() {
  return 21000 + Math.floor(Math.random() * 10000);
}

function attendre(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function req(method, urlPath, port, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    };
    const rq = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    rq.on('error', reject);
    if (body) rq.write(JSON.stringify(body));
    rq.end();
  });
}

// ------------------- Tests -------------------

test('headers de securite presentes sur toute reponse', async () => {
  const port = librePort();
  const { spawn } = require('child_process');
  const proc = spawn('node', ['server.js'], {
    cwd: RACINE,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }
  });
  await attendre(4000);
  try {
    const r = await req('GET', '/', port);
    assert.ok(r.headers['x-frame-options'], 'X-Frame-Options manquant');
    assert.ok(r.headers['x-content-type-options'], 'X-Content-Type-Options manquant');
    assert.ok(r.headers['content-security-policy'], 'CSP manquant');
    assert.ok(r.headers['strict-transport-security'], 'HSTS manquant');
    assert.ok(r.headers['referrer-policy'], 'Referrer-Policy manquant');
  } finally {
    proc.kill();
  }
});

test('fichier .env bloque (404)', async () => {
  const port = librePort();
  const { spawn } = require('child_process');
  const proc = spawn('node', ['server.js'], {
    cwd: RACINE,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }
  });
  await attendre(4000);
  try {
    const r = await req('GET', '/.env', port);
    assert.equal(r.status, 404, '.env devrait etre bloque');
  } finally {
    proc.kill();
  }
});

test('fichier comptes.json bloque (404)', async () => {
  const port = librePort();
  const { spawn } = require('child_process');
  const proc = spawn('node', ['server.js'], {
    cwd: RACINE,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }
  });
  await attendre(4000);
  try {
    const r = await req('GET', '/comptes.json', port);
    assert.equal(r.status, 404, 'comptes.json devrait etre bloque');
  } finally {
    proc.kill();
  }
});

test('/send sans authentification refuse (401)', async () => {
  const port = librePort();
  const { spawn } = require('child_process');
  const proc = spawn('node', ['server.js'], {
    cwd: RACINE,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }
  });
  await attendre(4000);
  try {
    const r = await req('POST', '/send', port, { msg: 'test', prix: 42 });
    assert.ok(r.status === 401, 'devrait etre refuse sans auth (401)');
  } finally {
    proc.kill();
  }
});

test('rate limit /login declenche un 429', async () => {
  const port = librePort();
  const { spawn } = require('child_process');
  const proc = spawn('node', ['server.js'], {
    cwd: RACINE,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }
  });
  await attendre(4000);
  try {
    let nbRefus = 0;
    for (let i = 0; i < 15; i++) {
      const r = await req('POST', '/login', port, { pseudo: 'test', mdp: 'wrong' });
      if (r.status === 429) nbRefus++;
    }
    assert.ok(nbRefus > 0, 'rate limit /login devrait declencher un 429');
  } finally {
    proc.kill();
  }
});
