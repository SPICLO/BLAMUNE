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
var _animEntree = false;
var authEnCours = false;

// Consoles (Xbox/PlayStation/Switch) : interface pilotee au pad, pas a la
// souris. On desactive le serpent voleur et on allege les animations pour
// eviter les saccades GPU qui font vibrer/defiler la page.
var estConsole = /xbox|playstation|nintendo/i.test((navigator.userAgent || ''));
if (estConsole) document.documentElement.classList.add('console');

// ---------------- OUTILS D'ANIMATION ----------------

function delai(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Serpent lumineux autour de la carte de connexion ('actif' | 'ok' | 'off')
function serpentEtat(etat) {
  var e = document.getElementById('ecranAuth');
  if (!e) return;
  e.classList.remove('serpent-actif', 'serpent-ok');
  if (etat === 'actif') e.classList.add('serpent-actif');
  else if (etat === 'ok') e.classList.add('serpent-ok');
}

// Serpent vif : suit le curseur pendant la requete, puis revient se refermer
// sur la carte (il "mange sa queue") avant de tourner sur lui-meme via la ring.
var serpentElem = null;
var dernierCurseur = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

function serpentSuivre(on) {
  if (!estConsole) rampeTourne(!!on);
  if (estConsole) return;
  if (on) {
    if (!serpentElem) {
      serpentElem = document.createElement('div');
      serpentElem.id = 'serpent';
      serpentElem.setAttribute('aria-hidden', 'true');
      document.body.appendChild(serpentElem);
    }
    serpentElem.classList.remove('mange');
    serpentElem.style.left = dernierCurseur.x + 'px';
    serpentElem.style.top = dernierCurseur.y + 'px';
    serpentElem.classList.add('suivre');
  } else if (serpentElem) {
    serpentElem.classList.remove('suivre');
  }
}

// Serpent de fond : pendant la connexion/inscription il tourne sur lui-meme,
// glisse au centre (transition) et tourne sur place. Le changement d'animation
// coupe proprement la traversal (pas de conflit de duree).
function rampeTourne(on) {
  var rampe = document.getElementById('rampe');
  if (!rampe) return;
  rampe.classList.toggle('tourne', !!on);
}

function serpentMangerQueue() {
  rampeTourne(false);
  if (!serpentElem) return;
  serpentElem.classList.remove('suivre');
  var centre = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  var carte = document.querySelector('.auth-box');
  if (carte) {
    var r = carte.getBoundingClientRect();
    centre.x = r.left + r.width / 2;
    centre.y = r.top + r.height / 2;
  }
  serpentElem.style.left = centre.x + 'px';
  serpentElem.style.top = centre.y + 'px';
  serpentElem.classList.add('mange');
  setTimeout(function () { serpentElem.classList.remove('mange'); }, 1000);
}

// ------------- Serpent de fond : reaction au curseur / souris / doigt -------------
// Quand le pointeur (ou le doigt) passe pres de lui, sa tete se tourne vers lui,
// il sort la langue et s'accelere. Distance de proximite en pixels.
var RAMPE_PORTEE = 240;

function rampeInteragir(x, y) {
  if (estConsole) return;
  var rampe = document.getElementById('rampe');
  if (!rampe) return;
  var r = rampe.getBoundingClientRect();
  var cx = r.left + r.width / 2;
  var cy = r.top + r.height / 2;
  var dx = x - cx;
  var dy = y - cy;
  var dist = Math.sqrt(dx * dx + dy * dy);
  var tete = rampe.querySelector('.rampe-tete');
  if (dist < RAMPE_PORTEE) {
    rampe.classList.add('interagit');
    var angle = (Math.atan2(-dy, dx) * 180 / Math.PI) * 0.45;
    if (tete) tete.style.transform = 'rotate(' + angle + 'deg)';
  } else {
    rampe.classList.remove('interagit');
    if (tete) tete.style.transform = '';
  }
}

function rampeRelacher() {
  var rampe = document.getElementById('rampe');
  if (!rampe) return;
  rampe.classList.remove('interagit');
  var tete = rampe.querySelector('.rampe-tete');
  if (tete) tete.style.transform = '';
}

// Pilule glissante EGO / BLAMUNE
function deplacerPilule(mode, instant) {
  var btn = document.getElementById(mode === '1' ? 'mode1' : (mode === '2' ? 'mode2' : null));
  var pill = document.getElementById('piluleMode');
  if (!btn || !pill) return;
  var x = btn.offsetLeft;
  var w = btn.offsetWidth;
  if (!w) return; // panneau masque : on attendra le prochain passage
  if (instant) { pill.style.transition = 'none'; }
  pill.style.left = x + 'px';
  pill.style.width = w + 'px';
  if (instant) { void pill.offsetWidth; pill.style.transition = ''; }
}

// Remet les boutons de mode sur BLAMUNE (2) apres une deconnexion
function reinitaliserModeUI() {
  var mode1Btn = document.getElementById('mode1');
  var mode2Btn = document.getElementById('mode2');
  if (mode1Btn) { mode1Btn.classList.remove('actif'); mode1Btn.setAttribute('aria-pressed', 'false'); }
  if (mode2Btn) { mode2Btn.classList.add('actif'); mode2Btn.setAttribute('aria-pressed', 'true'); }
  sauverProfilLocal('mode', '2');
  deplacerPilule('2', true);
}

// Cascade des messages a l'entree du chat
function animerEntreeChat() {
  var msgs = document.querySelectorAll('#chat .msg:not(.attente), #chat .accueil');
  for (var i = 0; i < msgs.length; i++) {
    msgs[i].style.animation = 'cascadeIn 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both';
    msgs[i].style.animationDelay = (80 + i * 70) + 'ms';
  }
}

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
  serpentSuivre(false);
  serpentEtat('off');
  if (ecranAuth) ecranAuth.style.display = 'none';
  if (appContenu) { appContenu.style.display = 'flex'; appContenu.style.flexDirection = 'column'; }
  finaliserAffichageApp();
}

function finaliserAffichageApp() {
  var pseudo = getAuthPseudo();
  var noteInvite = document.getElementById('noteInvite');
  var btnDeconnexion = document.getElementById('btnDeconnexion');
  if (pseudo) {
    if (noteInvite) noteInvite.style.display = 'none';
    if (btnDeconnexion) btnDeconnexion.style.display = '';
  } else {
    if (noteInvite) noteInvite.style.display = '';
    if (btnDeconnexion) { btnDeconnexion.style.display = ''; btnDeconnexion.textContent = 'Quitter'; }
  }
  charger();
}

// ---------------- ANIMATIONS CONNEXION / DECONNEXION ----------------

function forcerReflow(el) {
  if (el) { void el.offsetWidth; }
}

function afficherToastDeco(texte, type) {
  var ancien = document.querySelector('.deco-toast');
  if (ancien) ancien.remove();
  var d = document.createElement('div');
  d.className = 'deco-toast' + (type === 'ok' ? ' deco-toast-ok' : '');
  d.textContent = texte;
  document.body.appendChild(d);
  setTimeout(function () { if (d && d.parentNode) d.parentNode.removeChild(d); }, 2300);
}

// Joue le check anime + le fondu vers l'app. Utilisee apres connexion,
// inscription et mode invite : meme animation, message personnalise.
function jouerTransitionConnexion(message) {
  var ecranAuth = document.getElementById('ecranAuth');
  var appContenu = document.getElementById('appContenu');
  var principal = document.getElementById('authPrincipal');
  var success = document.getElementById('authSuccess');
  var successTexte = document.getElementById('authSuccessTexte');

  serpentEtat('ok');
  serpentMangerQueue();
  if (successTexte) successTexte.textContent = message || 'Connexion reussie !';
  if (principal) principal.style.display = 'none';
  if (success) {
    success.classList.remove('actif');
    forcerReflow(success);
    success.classList.add('actif');
  }

  // Laisse admirer le check un instant, puis bascule vers l'app :
  // l'ecran auth se floute/zoome en sortie pendant que l'app apparait en fondu.
  setTimeout(function () {
    _animEntree = true;
    if (ecranAuth) {
      ecranAuth.classList.remove('sortie-auth');
      forcerReflow(ecranAuth);
      ecranAuth.classList.add('sortie-auth');
    }
    if (appContenu) {
      appContenu.style.display = 'flex';
      appContenu.style.flexDirection = 'column';
      appContenu.classList.remove('entree-app');
      forcerReflow(appContenu);
      appContenu.classList.add('entree-app');
    }
    finaliserAffichageApp();

    setTimeout(function () {
      if (ecranAuth) { ecranAuth.style.display = 'none'; ecranAuth.classList.remove('sortie-auth'); }
      serpentEtat('off');
      if (success) success.classList.remove('actif');
      if (principal) principal.style.display = '';
    }, 560);
  }, 950);
}

// Fondu de l'app vers l'ecran d'authentification, avec un petit toast.
function jouerTransitionDeconnexion() {
  var ecranAuth = document.getElementById('ecranAuth');
  var appContenu = document.getElementById('appContenu');

  serpentSuivre(false);
  serpentEtat('off');
  afficherToastDeco('A bientot !');

  if (appContenu) {
    appContenu.classList.remove('sortie-app');
    forcerReflow(appContenu);
    appContenu.classList.add('sortie-app');
  }
  if (ecranAuth) {
    ecranAuth.style.display = '';
    ecranAuth.classList.remove('entree-auth');
    forcerReflow(ecranAuth);
    ecranAuth.classList.add('entree-auth');
  }

  setTimeout(function () {
    if (appContenu) {
      appContenu.style.display = 'none';
      appContenu.classList.remove('sortie-app');
      appContenu.classList.remove('entree-app');
    }
  }, 460);
}

function afficherAuth() {
  var ecranAuth = document.getElementById('ecranAuth');
  var appContenu = document.getElementById('appContenu');
  serpentSuivre(false);
  serpentEtat('off');
  if (ecranAuth) ecranAuth.style.display = '';
  if (appContenu) appContenu.style.display = 'none';
}

async function authRegister() {
  if (authEnCours) return;
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
  if (!marquerChamp(pseudoEl, pseudo.length >= 2, true) ||
      !marquerChamp(emailEl, email.indexOf('@') >= 0, true) ||
      !marquerChamp(mdpEl, mdp.length >= 6, true)) {
    errEl.textContent = 'Des champs sont invalides.';
    return;
  }
  authEnCours = true;
  btnRegister.disabled = true;
  btnRegister.textContent = 'Creation...';
  serpentSuivre(true);
  try {
    var body = 'pseudo=' + encodeURIComponent(pseudo) + '&email=' + encodeURIComponent(email) + '&mdp=' + encodeURIComponent(mdp);
    var req = fetch('/register', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    var j = (await Promise.all([req, delai(1500)]))[0];
    if (j.ok) {
      setAuthInfo(j.ego, j.pseudo, j.uid);
      jouerTransitionConnexion('Bienvenue' + (j.pseudo ? ', ' + j.pseudo : '') + ' !');
    } else {
      serpentSuivre(false);
      serpentEtat('off');
      marquerChamp(pseudoEl, false, true);
      marquerChamp(emailEl, false, true);
      marquerChamp(mdpEl, false, true);
      errEl.textContent = j.message || 'Erreur.';
    }
  } catch (e) {
    serpentSuivre(false);
    serpentEtat('off');
    errEl.textContent = 'Serveur injoignable.';
  }
  btnRegister.disabled = false;
  btnRegister.textContent = 'Creer mon compte';
  authEnCours = false;
}

async function authLogin() {
  if (authEnCours) return;
  var emailEl = document.getElementById('authEmail');
  var mdpEl = document.getElementById('authMdp');
  var errEl = document.getElementById('authErrLogin');
  var btnLogin = document.getElementById('btnLogin');
  if (!emailEl || !mdpEl || !errEl || !btnLogin) return;
  var email = emailEl.value.trim();
  var mdp = mdpEl.value;
  errEl.textContent = '';
  if (!marquerChamp(emailEl, email.indexOf('@') >= 0, true) ||
      !marquerChamp(mdpEl, mdp.length >= 1, true)) {
    errEl.textContent = 'Des champs sont invalides.';
    return;
  }
  authEnCours = true;
  btnLogin.disabled = true;
  btnLogin.textContent = 'Connexion...';
  serpentSuivre(true);
  try {
    var body = 'email=' + encodeURIComponent(email) + '&mdp=' + encodeURIComponent(mdp);
    var req = fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    var j = (await Promise.all([req, delai(1400)]))[0];
    if (j.ok) {
      setAuthInfo(j.ego, j.pseudo, j.uid);
      jouerTransitionConnexion('Content de te revoir' + (j.pseudo ? ', ' + j.pseudo : '') + ' !');
    } else {
      serpentSuivre(false);
      serpentEtat('off');
      marquerChamp(emailEl, false, true);
      marquerChamp(mdpEl, false, true);
      errEl.textContent = j.message || 'Erreur.';
    }
  } catch (e) {
    serpentSuivre(false);
    serpentEtat('off');
    errEl.textContent = 'Serveur injoignable.';
  }
  btnLogin.disabled = false;
  btnLogin.textContent = 'Se connecter';
  authEnCours = false;
}

async function authInvite() {
  if (authEnCours) return;
  var btnInvite = document.getElementById('btnInvite');
  if (!btnInvite) return;
  authEnCours = true;
  btnInvite.disabled = true;
  serpentSuivre(true);
  try {
    var req = fetch('/invite', { method: 'POST' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    var j = (await Promise.all([req, delai(1200)]))[0];
    if (j.ok) {
      localStorage.removeItem(AUTH_CLES.ego);
      localStorage.removeItem(AUTH_CLES.pseudo);
      localStorage.setItem(AUTH_CLES.userId, j.uid);
      jouerTransitionConnexion('Mode invite active !');
    } else {
      serpentSuivre(false);
      serpentEtat('off');
    }
  } catch (e) {
    // Fallback local si le serveur est injoignable
    serpentSuivre(false);
    localStorage.removeItem(AUTH_CLES.ego);
    localStorage.removeItem(AUTH_CLES.pseudo);
    if (!localStorage.getItem(AUTH_CLES.userId)) {
      localStorage.setItem(AUTH_CLES.userId, genererUserId());
    }
    jouerTransitionConnexion('Mode invite active !');
  }
  btnInvite.disabled = false;
  authEnCours = false;
}

function marquerChamp(el, ok, retrembler) {
  if (!el) return false;
  var champ = el.closest ? el.closest('.champ') : null;
  if (!champ) return ok;
  if (ok) {
    champ.classList.remove('faux');
    champ.classList.add('vrai');
  } else {
    champ.classList.remove('vrai');
    champ.classList.add('faux');
    if (retrembler) {
      var input = el;
      input.style.animation = 'none';
      void input.offsetWidth;
      input.style.animation = '';
    }
  }
  return ok;
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

  // Validation en direct : tremblement rouge si invalide, ✓ qui se dessine
  // quand c'est bon, avec un petit delai de stabilite (confiance).
  var CHAMPS = [
    { id: 'authPseudoReg', valide: function (v) { return v.trim().length >= 2; } },
    { id: 'authEmailReg', valide: function (v) { return v.indexOf('@') >= 0; } },
    { id: 'authMdpReg', valide: function (v) { return v.length >= 6; } },
    { id: 'authEmail', valide: function (v) { return v.indexOf('@') >= 0; } },
    { id: 'authMdp', valide: function (v) { return v.length >= 1; } }
  ];
  CHAMPS.forEach(function (def) {
    var el = document.getElementById(def.id);
    if (!el) return;
    var delaiValidation = null;
    el.addEventListener('input', function () {
      if (delaiValidation) clearTimeout(delaiValidation);
      delaiValidation = setTimeout(function () {
        marquerChamp(el, def.valide(el.value));
      }, 450);
    });
  });

  if (authShowRegister) {
    authShowRegister.onclick = function(e) {
      e.preventDefault();
      var authFormLogin = document.getElementById('authFormLogin');
      var authFormRegister = document.getElementById('authFormRegister');
      if (authFormLogin) { authFormLogin.style.display = 'none'; authFormLogin.classList.remove('glisser'); }
      if (authFormRegister) {
        authFormRegister.classList.remove('glisser');
        forcerReflow(authFormRegister);
        authFormRegister.classList.add('glisser');
        authFormRegister.style.display = '';
      }
    };
  }
  if (authShowLogin) {
    authShowLogin.onclick = function(e) {
      e.preventDefault();
      var authFormLogin = document.getElementById('authFormLogin');
      var authFormRegister = document.getElementById('authFormRegister');
      if (authFormRegister) { authFormRegister.style.display = 'none'; authFormRegister.classList.remove('glisser'); }
      if (authFormLogin) {
        authFormLogin.classList.remove('glisser');
        forcerReflow(authFormLogin);
        authFormLogin.classList.add('glisser');
        authFormLogin.style.display = '';
      }
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
      reinitaliserModeUI();
      jouerTransitionDeconnexion();
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

  // Position initiale de la pilule EGO / BLAMUNE
  setTimeout(function () {
    deplacerPilule(chargerProfilLocal().mode === '1' ? '1' : '2', true);
  }, 50);

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
      var headers = authHeaders();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      fetch('/logout', { method: 'POST', headers: headers, body: '', keepalive: true }).catch(function(){});
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
  if (qui === 'bot') { var logo = document.createElement('img'); logo.src = 'logo.png'; logo.alt = ''; avatar.appendChild(logo); }
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
    var logo = document.createElement('img');
    logo.src = 'logo.png';
    logo.alt = '';
    av.appendChild(logo);
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

function majMode(mode, animer) {
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
  deplacerPilule(mode === '1' ? '1' : '2', !animer);
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
  var grosLogo = document.createElement('img');
  grosLogo.src = 'logo.png';
  grosLogo.alt = 'BLAMUNE';
  gros.appendChild(grosLogo);
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
    if (_animEntree) {
      _animEntree = false;
      animerEntreeChat();
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

  // Animation de bascule (delai visuel garanti + rotation de l'avatar)
  var appContenu = document.getElementById('appContenu');
  if (appContenu) {
    appContenu.classList.remove('mode-bascule');
    forcerReflow(appContenu);
    appContenu.classList.add('mode-bascule');
  }
  try {
    var abortCtrl = new AbortController();
    var abortTimer = setTimeout(function () { abortCtrl.abort(); }, 120000);
    var req = fetch('/mode', { method: 'POST', headers: Object.assign({}, authHeaders(), { 'Content-Type': 'application/x-www-form-urlencoded' }), body: 'm=' + m, signal: abortCtrl.signal })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    var j = (await Promise.all([req, delai(1100)]))[0];
    clearTimeout(abortTimer);
    majMode(String(j.mode || '2'), true);
    majStatut(j.etat);
    afficherToastDeco('Mode ' + (String(j.mode) === '1' ? 'EGO' : 'BLAMUNE') + ' actif !', 'ok');
  } catch (e) {
    majStatut('horsligne', 'Serveur injoignable');
  }
  attente(false);
  actionEnCours = false;
  if (_chargerInterval) { clearTimeout(_chargerInterval); _chargerInterval = null; }
  if (appContenu) {
    setTimeout(function () { appContenu.classList.remove('mode-bascule'); }, 700);
  }
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
  document.addEventListener('mousemove', function (e) {
    dernierCurseur.x = e.clientX;
    dernierCurseur.y = e.clientY;
    rampeInteragir(e.clientX, e.clientY);
    var s = document.getElementById('serpent');
    if (s && s.classList.contains('suivre')) {
      s.style.left = e.clientX + 'px';
      s.style.top = e.clientY + 'px';
    }
  });
  document.addEventListener('touchmove', function (e) {
    var t = e.touches && e.touches[0];
    if (!t) return;
    dernierCurseur.x = t.clientX;
    dernierCurseur.y = t.clientY;
    rampeInteragir(t.clientX, t.clientY);
    var s = document.getElementById('serpent');
    if (s && s.classList.contains('suivre')) {
      s.style.left = t.clientX + 'px';
      s.style.top = t.clientY + 'px';
    }
  });
  document.addEventListener('touchstart', function (e) {
    var t = e.touches && e.touches[0];
    if (!t) return;
    rampeInteragir(t.clientX, t.clientY);
    var s = document.getElementById('serpent');
    if (s && s.classList.contains('suivre')) {
      s.style.left = t.clientX + 'px';
      s.style.top = t.clientY + 'px';
    }
  });
  document.addEventListener('touchend', function () {
    rampeRelacher();
  });
  document.addEventListener('touchcancel', function () {
    rampeRelacher();
  });
  window.addEventListener('pointerup', function () {
    rampeRelacher();
  });
});
