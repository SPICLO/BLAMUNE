// BLAMUNE - interface du chat (charge par index.html).
// Toutes les donnees passent par l'API JSON du serveur (/send, /historique,
// /relancer, /mode, /profil, /stats). Le texte est toujours insere via
// textContent : jamais de HTML brut provenant du bot ou de l'utilisateur.

var actionEnCours = false;
var chargerEnCours = false;
var arretSignale = false;
var dernierQui = null;
var dernierEpoch = 0;
var nbErreursConnexion = 0;
var nbPollsDemarrage = 0;
var MAX_POLLS_DEMARRAGE = 40;
var modeEnCours = false;
var _chargerInterval = null;
var dernierModeCharge = null;

var _chargerPending = false;

function genererUserId() {
  return 'u' + Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

// ---------------- AUTHENTIFICATION ----------------

var AUTH_CLES = {
  ego: 'blamune_ego',
  pseudo: 'blamune_pseudo_auth',
  userId: 'blamune_userId'
};

function getAuthEgo() { return localStorage.getItem(AUTH_CLES.ego) || ''; }
function getAuthPseudo() { return localStorage.getItem(AUTH_CLES.pseudo) || ''; }
function getAuthUserId() {
  var uid = localStorage.getItem(AUTH_CLES.userId);
  return uid || '';
}
function setAuthInfo(ego, pseudo, uid) {
  localStorage.setItem(AUTH_CLES.ego, ego);
  localStorage.setItem(AUTH_CLES.pseudo, pseudo);
  localStorage.setItem(AUTH_CLES.userId, uid);
}
function clearAuth() {
  localStorage.removeItem(AUTH_CLES.ego);
  localStorage.removeItem(AUTH_CLES.pseudo);
  localStorage.removeItem(AUTH_CLES.userId);
}
function estAuth() { return !!getAuthEgo(); }
function estInvite() { return !estAuth(); }

function authHeaders() {
  var h = {};
  var e = getAuthEgo();
  if (e) h['X-EGO'] = e;
  h['X-UID'] = getAuthUserId();
  return h;
}

function authBody() {
  var p = {};
  var e = getAuthEgo();
  if (e) p.ego = e;
  p.uid = getAuthUserId();
  return p;
}

function afficherApp() {
  var ecranAuth = document.getElementById('ecranAuth');
  var appContenu = document.getElementById('appContenu');
  if (ecranAuth) ecranAuth.style.display = 'none';
  if (appContenu) { appContenu.style.display = 'flex'; appContenu.style.flexDirection = 'column'; }
  var pseudo = getAuthPseudo();
  var noteInvite = document.getElementById('noteInvite');
  var btnDeconnexion = document.getElementById('btnDeconnexion');
  if (pseudo) {
    if (noteInvite) noteInvite.style.display = 'none';
    if (btnDeconnexion) btnDeconnexion.style.display = '';
  } else {
    if (noteInvite) noteInvite.style.display = '';
    if (btnDeconnexion) btnDeconnexion.style.display = 'none';
  }
  charger();
}

function afficherAuth() {
  var ecranAuth = document.getElementById('ecranAuth');
  var appContenu = document.getElementById('appContenu');
  if (ecranAuth) ecranAuth.style.display = '';
  if (appContenu) appContenu.style.display = 'none';
}

async function authRegister() {
  var pseudoEl = document.getElementById('authPseudoReg');
  var emailEl = document.getElementById('authEmailReg');
  var mdpEl = document.getElementById('authMdpReg');
  var errEl = document.getElementById('authErrRegister');
  var btnRegister = document.getElementById('btnRegister');
  if (!pseudoEl || !emailEl || !mdpEl || !errEl || !btnRegister) return;
  var pseudo = pseudoEl.value.trim();
  var email = emailEl.value.trim();
  var mdp = mdpEl.value;
  errEl.textContent = '';
  if (pseudo.length < 2) { errEl.textContent = 'Pseudo trop court (2 min).'; return; }
  if (!email || email.indexOf('@') < 0) { errEl.textContent = 'Email invalide.'; return; }
  if (mdp.length < 6) { errEl.textContent = 'Mot de passe trop court (6 min).'; return; }
  btnRegister.disabled = true;
  btnRegister.textContent = 'Creation...';
  try {
    var body = 'pseudo=' + encodeURIComponent(pseudo) + '&email=' + encodeURIComponent(email) + '&mdp=' + encodeURIComponent(mdp);
    var r = await fetch('/register', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var j = await r.json();
    if (j.ok) {
      setAuthInfo(j.ego, j.pseudo, j.uid);
      afficherApp();
    } else {
      errEl.textContent = j.message || 'Erreur.';
    }
  } catch (e) {
    errEl.textContent = 'Serveur injoignable.';
  }
  btnRegister.disabled = false;
  btnRegister.textContent = 'Creer mon compte';
}

async function authLogin() {
  var emailEl = document.getElementById('authEmail');
  var mdpEl = document.getElementById('authMdp');
  var errEl = document.getElementById('authErrLogin');
  var btnLogin = document.getElementById('btnLogin');
  if (!emailEl || !mdpEl || !errEl || !btnLogin) return;
  var email = emailEl.value.trim();
  var mdp = mdpEl.value;
  errEl.textContent = '';
  if (!email || !mdp) { errEl.textContent = 'Remplis tous les champs.'; return; }
  btnLogin.disabled = true;
  btnLogin.textContent = 'Connexion...';
  try {
    var body = 'email=' + encodeURIComponent(email) + '&mdp=' + encodeURIComponent(mdp);
    var r = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var j = await r.json();
    if (j.ok) {
      setAuthInfo(j.ego, j.pseudo, j.uid);
      afficherApp();
    } else {
      errEl.textContent = j.message || 'Erreur.';
    }
  } catch (e) {
    errEl.textContent = 'Serveur injoignable.';
  }
  btnLogin.disabled = false;
  btnLogin.textContent = 'Se connecter';
}

async function authInvite() {
  var btnInvite = document.getElementById('btnInvite');
  if (btnInvite) btnInvite.disabled = true;
  try {
    var r = await fetch('/invite', { method: 'POST' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var j = await r.json();
    if (j.ok) {
      localStorage.removeItem(AUTH_CLES.ego);
      localStorage.removeItem(AUTH_CLES.pseudo);
      localStorage.setItem(AUTH_CLES.userId, j.uid);
      afficherApp();
    }
  } catch (e) {
    // Fallback local si le serveur est injoignable
    localStorage.removeItem(AUTH_CLES.ego);
    localStorage.removeItem(AUTH_CLES.pseudo);
    if (!localStorage.getItem(AUTH_CLES.userId)) {
      localStorage.setItem(AUTH_CLES.userId, genererUserId());
    }
    afficherApp();
  }
  if (btnInvite) btnInvite.disabled = false;
}

function initAuth() {
  var btnLogin = document.getElementById('btnLogin');
  var btnRegister = document.getElementById('btnRegister');
  var btnInvite = document.getElementById('btnInvite');
  var authShowRegister = document.getElementById('authShowRegister');
  var authShowLogin = document.getElementById('authShowLogin');
  var authMdp = document.getElementById('authMdp');
  var authMdpReg = document.getElementById('authMdpReg');
  var envoyerBtn = document.getElementById('envoyer');
  var mode1Btn = document.getElementById('mode1');
  var mode2Btn = document.getElementById('mode2');
  var zoneEl = document.getElementById('zone');

  if (btnLogin) btnLogin.onclick = authLogin;
  if (btnRegister) btnRegister.onclick = authRegister;
  if (btnInvite) btnInvite.onclick = authInvite;
  if (authShowRegister) {
    authShowRegister.onclick = function(e) {
      e.preventDefault();
      var authFormLogin = document.getElementById('authFormLogin');
      var authFormRegister = document.getElementById('authFormRegister');
      if (authFormLogin) authFormLogin.style.display = 'none';
      if (authFormRegister) authFormRegister.style.display = '';
    };
  }
  if (authShowLogin) {
    authShowLogin.onclick = function(e) {
      e.preventDefault();
      var authFormLogin = document.getElementById('authFormLogin');
      var authFormRegister = document.getElementById('authFormRegister');
      if (authFormLogin) authFormLogin.style.display = '';
      if (authFormRegister) authFormRegister.style.display = 'none';
    };
  }
  if (authMdp) {
    authMdp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') authLogin();
    });
  }
  if (authMdpReg) {
    authMdpReg.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') authRegister();
    });
  }

  // Enter key sur les champs email
  var authEmail = document.getElementById('authEmail');
  var authEmailReg = document.getElementById('authEmailReg');
  if (authEmail) {
    authEmail.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') authLogin();
    });
  }
  if (authEmailReg) {
    authEmailReg.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') authRegister();
    });
  }

  // Bouton deconnexion
  var btnDeconnexion = document.getElementById('btnDeconnexion');
  if (btnDeconnexion) {
    btnDeconnexion.onclick = function() {
      fetch('/logout', { method: 'POST', headers: authHeaders() }).catch(function(){});
      clearAuth();
      viderChat();
      afficherAuth();
    };
  }

  // Boutons mode et envoi
  if (envoyerBtn) envoyerBtn.onclick = envoyer;
  if (mode1Btn) mode1Btn.onclick = function () { changerMode(1); };
  if (mode2Btn) mode2Btn.onclick = function () { changerMode(2); };
  if (zoneEl) {
    zoneEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); envoyer(); }
    });
  }

  // Quand l'onglet redevient visible, on verifie l'etat du serveur.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { charger(); }
  });

  if (estAuth()) {
    fetch('/historique', { headers: authHeaders() }).then(function(r) { return r.json(); }).then(function(j) {
      if (j.ok !== false) afficherApp();
      else { clearAuth(); afficherAuth(); }
    }).catch(function() {
      afficherAuth();
    });
  } else {
    afficherAuth();
  }

  // Deconnexion automatique a la fermeture de l'onglet
  window.addEventListener('beforeunload', function () {
    if (estAuth()) {
      var uid = getAuthUserId();
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/logout', false);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      if (getAuthEgo()) xhr.setRequestHeader('X-EGO', getAuthEgo());
      xhr.setRequestHeader('X-UID', uid);
      try { xhr.send(); } catch (e) {}
    }
  });
}

function getUserId() { return getAuthUserId(); }

// ---------------- LOCALSTORAGE : PROFIL UTILISATEUR ----------------

var PROFIL_CLES = {
  pseudo: 'blamune_pseudo',
  mode: 'blamune_mode',
  theme: 'blamune_theme'
};

function chargerProfilLocal() {
  var p = {};
  for (var k in PROFIL_CLES) {
    p[k] = localStorage.getItem(PROFIL_CLES[k]) || '';
  }
  if (!p.mode) p.mode = '2';
  p.userId = getUserId();
  return p;
}

function sauverProfilLocal(cle, valeur) {
  if (PROFIL_CLES[cle]) {
    localStorage.setItem(PROFIL_CLES[cle], valeur);
  }
}

// ---------------- CONSTRUCTION DES MESSAGES ----------------

function conteneur() {
  var chat = document.getElementById('chat');
  if (!chat) return null;
  var c = chat.querySelector('.conteneur');
  if (!c) { c = document.createElement('div'); c.className = 'conteneur'; chat.appendChild(c); }
  return c;
}

function heureDepuis(epoch) {
  var d = epoch ? new Date(epoch * 1000) : new Date();
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function defilerSiEnBas() {
  var chat = document.getElementById('chat');
  if (!chat) return;
  var proche = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 140;
  if (proche) {
    requestAnimationFrame(function () {
      chat.scrollTop = chat.scrollHeight;
    });
  }
}

function ajouterMessage(qui, texte, confiance, epoch) {
  var t = epoch ? epoch * 1000 : Date.now();
  var d = document.createElement('div');
  d.className = 'msg ' + qui;
  if (qui === dernierQui && t - dernierEpoch < 300000) d.classList.add('groupe');
  dernierQui = qui;
  dernierEpoch = t;

  var avatar = document.createElement('div');
  avatar.className = 'avatar ' + (qui === 'bot' ? 'avatar-bot' : 'avatar-moi');
  if (qui === 'bot') avatar.textContent = 'B';
  else { var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'currentColor'); svg.setAttribute('aria-hidden', 'true'); var path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'); svg.appendChild(path); avatar.appendChild(svg); }

  var corps = document.createElement('div');
  corps.className = 'corps';

  var bulle = document.createElement('div');
  bulle.className = 'bulle';
  bulle.textContent = texte;
  corps.appendChild(bulle);

  // Indicateur de confiance pour les reponses du bot
  if (qui === 'bot' && confiance && confiance !== 'haute') {
    var badge = document.createElement('span');
    badge.className = 'confiance confiance-' + confiance;
    if (confiance === 'basse') badge.textContent = '⚠ je ne suis pas sur';
    else badge.textContent = '💡 je pense que...';
    corps.appendChild(badge);
  }

  var heure = document.createElement('span');
  heure.className = 'heure';
  heure.textContent = heureDepuis(epoch);
  corps.appendChild(heure);

  if (qui === 'moi') { d.appendChild(corps); d.appendChild(avatar); }
  else { d.appendChild(avatar); d.appendChild(corps); }

  var c = conteneur();
  if (!c) return null;
  c.appendChild(d);
  defilerSiEnBas();
  return d;
}

function ajouterSysteme(texte) {
  var d = document.createElement('div');
  d.className = 'msg systeme';
  var s = document.createElement('span');
  s.textContent = texte;
  d.appendChild(s);
  var c = conteneur();
  if (c) c.appendChild(d);
  defilerSiEnBas();
  dernierQui = null;
}

function ajouterInfo(texte) {
  var d = document.createElement('div');
  d.className = 'msg info';
  var b = document.createElement('div');
  b.className = 'bulle';
  b.textContent = texte;
  d.appendChild(b);
  var c = conteneur();
  if (c) c.appendChild(d);
  defilerSiEnBas();
  dernierQui = null;
}

function attente(on) {
  var c = conteneur();
  if (!c) return;
  var a = c.querySelector('.attente');
  if (a) a.remove();
  if (on) {
    var d = document.createElement('div');
    d.className = 'msg bot attente';
    var av = document.createElement('div');
    av.className = 'avatar avatar-bot';
    av.textContent = 'B';
    var corps = document.createElement('div');
    corps.className = 'corps';
    var bulle = document.createElement('div');
    bulle.className = 'bulle';
    var pts = document.createElement('span');
    pts.className = 'points';
    var p1 = document.createElement('i'); var p2 = document.createElement('i'); var p3 = document.createElement('i');
    pts.appendChild(p1); pts.appendChild(p2); pts.appendChild(p3);
    bulle.appendChild(pts);
    corps.appendChild(bulle);
    d.appendChild(av);
    d.appendChild(corps);
    c.appendChild(d);
    requestAnimationFrame(function () { // FIX #3: scroll after DOM update
      var chat = document.getElementById('chat');
      if (chat) chat.scrollTop = chat.scrollHeight;
    });
  }
}

function viderChat() {
  var c = conteneur();
  if (c) c.replaceChildren();
  dernierQui = null;
  dernierEpoch = 0;
}

// ---------------- ETAT DU BOT / SERVEUR ----------------

function majStatut(etat, texte) {
  var p = document.getElementById('pointStatut');
  var t = document.getElementById('texteStatut');
  if (!p || !t) return;
  switch (etat) {
    case 'pret':
      p.className = 'point enligne';
      t.textContent = 'En ligne';
      break;
    case 'demarrage':
      p.className = 'point demarrage';
      t.textContent = texte || 'Demarrage...';
      break;
    case 'arrete':
    case 'erreur':
      p.className = 'point horsligne';
      t.textContent = texte || 'Hors ligne';
      break;
    case 'pense':
      p.className = 'point pense';
      t.textContent = 'Reflechit...';
      break;
    case 'horsligne':
      p.className = 'point horsligne';
      t.textContent = texte || 'Serveur injoignable';
      break;
    default:
      p.className = 'point horsligne';
      t.textContent = texte || 'Statut inconnu';
  }
}

function signalerArret() {
  if (arretSignale) return;
  var c = conteneur();
  if (!c) return;
  var enfants = c.children;
  for (var i = enfants.length - 1; i >= 0 && i >= enfants.length - 3; i--) {
    var txt = enfants[i].textContent.toLowerCase();
    if (txt.indexOf('arrete') >= 0 || txt.indexOf('relancer') >= 0) return;
  }
  arretSignale = true;
  var d = document.createElement('div');
  d.className = 'msg info';
  var b = document.createElement('div');
  b.className = 'bulle';
  b.textContent = 'Le bot est arrete. ';
  var btn = document.createElement('button');
  btn.textContent = 'Relancer';
  btn.style.cssText = 'display:inline;color:var(--accent);font-weight:600;text-decoration:underline;background:none;border:none;cursor:pointer;font-size:inherit;margin-left:4px;';
  btn.onclick = function () {
    var m = (chargerProfilLocal().mode === '1') ? 1 : 2;
    changerMode(m);
  };
  b.appendChild(btn);
  d.appendChild(b);
  c.appendChild(d);
  defilerSiEnBas();
  dernierQui = null;
}

function majMode(mode) {
  // FIX #6: validate mode values (only '1', '2', or '3')
  if (mode !== '1' && mode !== '2' && mode !== '3') mode = '2';
  var m1 = document.getElementById('mode1');
  var m2 = document.getElementById('mode2');
  if (m1) {
    m1.classList.toggle('actif', mode === '1');
    m1.setAttribute('aria-pressed', mode === '1');
  }
  if (m2) {
    m2.classList.toggle('actif', mode === '2');
    m2.setAttribute('aria-pressed', mode === '2');
  }
  sauverProfilLocal('mode', mode);
}

// ---------------- ECRAN D'ACCUEIL ----------------

function afficherAccueil() {
  // FIX #2: reset all chat state
  actionEnCours = false;
  arretSignale = false;
  dernierQui = null;
  dernierEpoch = 0;
  nbErreursConnexion = 0;
  nbPollsDemarrage = 0;
  var z = document.getElementById('zone');
  if (z) z.value = '';
  desactiver(false);

  var c = conteneur();
  if (!c) return;
  c.replaceChildren();
  var a = document.createElement('div');
  a.className = 'accueil';
  var gros = document.createElement('div');
  gros.className = 'gros-avatar';
  gros.textContent = 'B';
  var titre = document.createElement('h2');
  titre.textContent = 'Bienvenue !';
  var sous = document.createElement('p');
  sous.textContent = 'Je suis BLAMUNE. Discute avec moi, pose-moi des questions, ou apprends-moi des choses que je retiendrai.';
  var s = document.createElement('div');
  s.className = 'suggestions';
  var chips = [
    'Salut, comment ça va ?',
    'Pose-moi une question',
    "Je t'apprends que la lune est un satellite de la terre"
  ];
  chips.forEach(function (txt) {
    var b = document.createElement('button');
    b.textContent = txt;
    b.onclick = function () {
      var z = document.getElementById('zone');
      if (z) { z.value = txt; z.focus(); }
    };
    s.appendChild(b);
  });
  a.appendChild(gros);
  a.appendChild(titre);
  a.appendChild(sous);
  a.appendChild(s);
  c.appendChild(a);
}

// ---------------- CHARGEMENT DE L'HISTORIQUE ----------------

function programmerChargementApresAction() {
  if (_chargerInterval) return;
  _chargerInterval = setTimeout(function () {
    _chargerInterval = null;
    charger();
  }, 500);
}

async function charger() {
  // FIX #5: guard against missing UID
  if (!getAuthUserId()) return;
  if (chargerEnCours || actionEnCours) {
    _chargerPending = true;
    return;
  }
  chargerEnCours = true;
  try {
    var abortCtrl = new AbortController();
    var abortTimer = setTimeout(function () { abortCtrl.abort(); }, 120000);
    var r = await fetch('/historique', { headers: authHeaders(), signal: abortCtrl.signal });
    clearTimeout(abortTimer);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var j = await r.json();
    if (j.ok === false) { chargerEnCours = false; return; }
    if (_chargerInterval) { clearTimeout(_chargerInterval); _chargerInterval = null; }
    nbErreursConnexion = 0;
    majMode(j.mode || '2');
    majStatut(j.etat);
    if (j.etat === 'pret' || j.etat === 'demarrage') arretSignale = false;
    if (j.etat === 'pret' || j.etat === 'arrete' || j.etat === 'erreur') nbPollsDemarrage = 0;
    var hist = j.historique || [];
    var c = conteneur();
    if (!c) { chargerEnCours = false; return; }
    var modeChange = (dernierModeCharge !== null && dernierModeCharge !== j.mode);
    dernierModeCharge = j.mode;
    var existants = c.querySelectorAll('.msg:not(.attente)');
    var nbExistants = existants.length;
    var nbHistorique = hist.length;
    if (modeChange || nbExistants !== nbHistorique) {
      viderChat();
      if (nbHistorique > 0) {
        var accueilEl = c.querySelector('.accueil');
        if (accueilEl) accueilEl.remove();
        hist.forEach(function (h) {
          if (h.qui === 'systeme') ajouterSysteme(h.texte);
          else if (h.qui === 'bot' || h.qui === 'moi') ajouterMessage(h.qui, h.texte, undefined, h.t);
          else ajouterInfo(h.texte);
        });
      } else if (j.etat === 'pret' || j.etat === 'demarrage') {
        afficherAccueil();
      }
    } else if (nbHistorique === 0 && !c.querySelector('.accueil') && (j.etat === 'pret' || j.etat === 'demarrage')) {
      afficherAccueil();
    }
    if (j.etat === 'arrete' || j.etat === 'erreur') signalerArret();
    else if (j.etat === 'demarrage') {
      nbPollsDemarrage++;
      if (nbPollsDemarrage < MAX_POLLS_DEMARRAGE) setTimeout(charger, 1500);
      else majStatut('erreur', 'Demarrage trop long');
    }
    chargerEnCours = false;
    if (_chargerPending) { _chargerPending = false; setTimeout(charger, 100); }
  } catch (e) {
    chargerEnCours = false;
    if (_chargerPending) { _chargerPending = false; setTimeout(charger, 100); }
    nbErreursConnexion++;
    majStatut('horsligne', 'Serveur injoignable');
    if (nbErreursConnexion < 30) setTimeout(charger, Math.min(4000 + nbErreursConnexion * 1000, 30000));
  }
}

// ---------------- ACTIONS ----------------

function desactiver(on) {
  var envoyerBtn = document.getElementById('envoyer');
  var mode1Btn = document.getElementById('mode1');
  var mode2Btn = document.getElementById('mode2');
  if (envoyerBtn) envoyerBtn.disabled = on;
  if (mode1Btn) mode1Btn.disabled = on;
  if (mode2Btn) mode2Btn.disabled = on;
}

async function envoyer() {
  if (!getAuthUserId()) return;
  var z = document.getElementById('zone');
  if (!z) return;
  var m = z.value.trim();
  if (!m || actionEnCours) return;
  actionEnCours = true;
  desactiver(true);
  majStatut('pense');
  var msgNode = ajouterMessage('moi', m);
  attente(true);
  try {
    var profil = chargerProfilLocal();
    var modeServ = dernierModeCharge || profil.mode || '2';
    var body = 'msg=' + encodeURIComponent(m) + '&mode=' + encodeURIComponent(modeServ);
    var headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    var ah = authHeaders();
    for (var k in ah) headers[k] = ah[k];
    var abortCtrl = new AbortController();
    var abortTimer = setTimeout(function () { abortCtrl.abort(); }, 120000);
    var r = await fetch('/send', { method: 'POST', headers: headers, body: body, signal: abortCtrl.signal });
    clearTimeout(abortTimer);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var j = await r.json();
    attente(false);
    z.value = '';
    majStatut(j.etat);
    if (j.reponses && j.reponses.length > 0) {
      j.reponses.forEach(function (rep) { ajouterMessage('bot', rep, j.confiance); });
      if (j.etat === 'arrete' || j.etat === 'erreur') signalerArret();
    }
  } catch (e) {
    attente(false);
    if (msgNode) msgNode.remove();
    z.value = m;
    majStatut('horsligne', 'Serveur injoignable');
    ajouterInfo('Envoi echoue : le serveur ne repond pas (timeout 120s). Reessaie.');
  }
  actionEnCours = false;
  if (_chargerInterval) { clearTimeout(_chargerInterval); _chargerInterval = null; }
  desactiver(false);
  z.focus();
  setTimeout(function () { charger(); }, 500);
}

async function changerMode(m) {
  if (m !== 1 && m !== 2 && m !== 3) return;
  if (modeEnCours) return;
  modeEnCours = true;
  if (actionEnCours) { modeEnCours = false; return; }
  actionEnCours = true;
  desactiver(true);
  arretSignale = false;
  majStatut('demarrage', 'Changement de mode...');
  attente(true);
  try {
    var abortCtrl = new AbortController();
    var abortTimer = setTimeout(function () { abortCtrl.abort(); }, 120000);
    var r = await fetch('/mode', { method: 'POST', headers: authHeaders(), body: 'm=' + m, signal: abortCtrl.signal });
    clearTimeout(abortTimer);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var j = await r.json();
    majMode(j.mode || '2');
    majStatut(j.etat);
  } catch (e) {
    majStatut('horsligne', 'Serveur injoignable');
  }
  attente(false);
  actionEnCours = false;
  if (_chargerInterval) { clearTimeout(_chargerInterval); _chargerInterval = null; }
  modeEnCours = false;
  try { await charger(); } catch (_) {}
  desactiver(false);
  var z = document.getElementById('zone');
  if (z) z.focus();
}

window.addEventListener('load', function () {
  var profil = chargerProfilLocal();
  if (profil.mode === '3') {
    sauverProfilLocal('mode', '2');
  }
  initAuth();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function() {});
  }
});
