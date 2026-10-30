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
// souris. On allege les animations pour eviter les saccades GPU qui font
// vibrer/defiler la page.
var estConsole = /xbox|playstation|nintendo/i.test(navigator.userAgent || '');
if (estConsole) document.documentElement.classList.add('console');

// ---------------- OUTILS D'ANIMATION ----------------

function delai(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// Pilule glissante EGO / BLAMUNE
function deplacerPilule(mode, instant) {
  var btn = document.getElementById(mode === '1' ? 'mode1' : mode === '2' ? 'mode2' : null);
  var pill = document.getElementById('piluleMode');
  if (!btn || !pill) return;
  var x = btn.offsetLeft;
  var w = btn.offsetWidth;
  if (!w) return; // panneau masque : on attendra le prochain passage
  if (instant) {
    pill.style.transition = 'none';
  }
  pill.style.left = x + 'px';
  pill.style.width = w + 'px';
  if (instant) {
    void pill.offsetWidth;
    pill.style.transition = '';
  }
}

// Remet les boutons de mode sur BLAMUNE (2) apres une deconnexion
function reinitaliserModeUI() {
  var mode1Btn = document.getElementById('mode1');
  var mode2Btn = document.getElementById('mode2');
  if (mode1Btn) {
    mode1Btn.classList.remove('actif');
    mode1Btn.setAttribute('aria-pressed', 'false');
  }
  if (mode2Btn) {
    mode2Btn.classList.add('actif');
    mode2Btn.setAttribute('aria-pressed', 'true');
  }
  sauverProfilLocal('mode', '2');
  deplacerPilule('2', true);
}

// Cascade des messages a l'entree du chat
function animerEntreeChat() {
  var msgs = document.querySelectorAll('#chat .msg:not(.attente), #chat .accueil');
  for (var i = 0; i < msgs.length; i++) {
    msgs[i].style.animation = 'cascadeIn 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both';
    msgs[i].style.animationDelay = 80 + i * 70 + 'ms';
  }
}

function genererUserId() {
  return 'u' + Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

// ---------------- AUTHENTIFICATION ----------------

var AUTH_CLES = {
  ego: 'blamune_ego',
  pseudo: 'blamune_pseudo_auth',
  userId: 'blamune_userId',
  jeton: 'blamune_invite_jeton'
};

function getAuthEgo() {
  return localStorage.getItem(AUTH_CLES.ego) || '';
}
function getAuthPseudo() {
  return localStorage.getItem(AUTH_CLES.pseudo) || '';
}
function getAuthUserId() {
  var uid = localStorage.getItem(AUTH_CLES.userId);
  return uid || '';
}
function getAuthJeton() {
  return localStorage.getItem(AUTH_CLES.jeton) || '';
}
function setAuthInfo(ego, pseudo, uid) {
  localStorage.setItem(AUTH_CLES.ego, ego);
  localStorage.setItem(AUTH_CLES.pseudo, pseudo);
  localStorage.setItem(AUTH_CLES.userId, uid);
  // Un compte classique n'a pas besoin du jeton invite.
  localStorage.removeItem(AUTH_CLES.jeton);
}
function clearAuth() {
  localStorage.removeItem(AUTH_CLES.ego);
  localStorage.removeItem(AUTH_CLES.pseudo);
  localStorage.removeItem(AUTH_CLES.userId);
  localStorage.removeItem(AUTH_CLES.jeton);
}
function estAuth() {
  return !!getAuthEgo();
}

// L'identite voyage dans les entetes (X-EGO / X-UID / X-Jeton). Le serveur
// les lit avant le corps et le query string : un "authBody" qui recopierait
// les memes valeurs dans le corps n aurait donc jamais ete utilise. Il a ete
// supprime avec estInvite(), qui n etait appele nulle part non plus.
function authHeaders() {
  var h = {};
  var e = getAuthEgo();
  if (e) h['X-EGO'] = e;
  h['X-UID'] = getAuthUserId();
  var j = getAuthJeton();
  if (j) h['X-Jeton'] = j;
  return h;
}

// Migration des invites creees avant les jetons : elles n'ont que leur uid.
// Une fois par chargement, on l'envoie au serveur qui rend un jeton ; a partir
// de la, le uid seul n'est plus accepte. Echec silencieux (hors ligne) :
// on continue en mode legacy, le serveur accepte encore le uid sans record.
async function migrerJetonInvite() {
  var uid = getAuthUserId();
  if (!uid || uid.indexOf('inv_') !== 0 || getAuthJeton()) return;
  try {
    var ctrl = new AbortController();
    var minuteur = setTimeout(function () {
      ctrl.abort();
    }, 8000);
    var r = await fetch('/invite/jeton', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-UID': uid },
      body: 'uid=' + encodeURIComponent(uid),
      signal: ctrl.signal
    });
    clearTimeout(minuteur);
    if (!r.ok) return;
    var j = await r.json();
    if (j && j.ok && j.jeton) localStorage.setItem(AUTH_CLES.jeton, j.jeton);
  } catch (e) {}
}

function afficherApp() {
  var ecranAuth = document.getElementById('ecranAuth');
  var appContenu = document.getElementById('appContenu');
  majEchec(false);
  if (ecranAuth) ecranAuth.style.display = 'none';
  if (appContenu) {
    appContenu.style.display = 'flex';
    appContenu.style.flexDirection = 'column';
  }
  finaliserAffichageApp();
  // L'etat interieur de BLAMUNE (pastille) suit chaque entree dans l'app :
  // chargement initial, (re)connexion, sorties d'invite.
  actualiserEtatIA();
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
    if (btnDeconnexion) {
      btnDeconnexion.style.display = '';
      btnDeconnexion.textContent = 'Quitter';
    }
  }
  charger();
  // Sonde proactif : uniquement pour un compte enregistre (les invites n'ont
  // pas de vie persistante, inutile de leur faire ecrire BLAMUNE en premier).
  if (estAuth()) demarrerProactif();
}

// ---------------- ANIMATIONS CONNEXION / DECONNEXION ----------------

function forcerReflow(el) {
  if (el) {
    void el.offsetWidth;
  }
}

function afficherToastDeco(texte, type) {
  var ancien = document.querySelector('.deco-toast');
  if (ancien) ancien.remove();
  var d = document.createElement('div');
  d.className = 'deco-toast' + (type === 'ok' ? ' deco-toast-ok' : '');
  d.textContent = texte;
  document.body.appendChild(d);
  setTimeout(function () {
    if (d && d.parentNode) d.parentNode.removeChild(d);
  }, 2300);
}

// Joue le check anime + le fondu vers l'app. Utilisee apres connexion,
// inscription et mode invite : meme animation, message personnalise.
function jouerTransitionConnexion(message) {
  var ecranAuth = document.getElementById('ecranAuth');
  var appContenu = document.getElementById('appContenu');
  var principal = document.getElementById('authPrincipal');
  var success = document.getElementById('authSuccess');
  var successTexte = document.getElementById('authSuccessTexte');

  majEchec(false);
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
      if (ecranAuth) {
        ecranAuth.style.display = 'none';
        ecranAuth.classList.remove('sortie-auth');
      }
      if (success) success.classList.remove('actif');
      if (principal) principal.style.display = '';
    }, 560);
  }, 950);
}

// Fondu de l'app vers l'ecran d'authentification, avec un petit toast.
function jouerTransitionDeconnexion() {
  var ecranAuth = document.getElementById('ecranAuth');
  var appContenu = document.getElementById('appContenu');

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
  majEchec(false);
  // Un swap en cours laisserait ses timers allumes : ils re-afficheraient
  // le mauvais formulaire juste apres. On coupe tout avant de remettre a zero.
  annulerSwap();
  // Retour propre sur le formulaire de connexion (carte a sa taille normale)
  var boite = document.querySelector('.auth-box');
  var login = document.getElementById('authFormLogin');
  var reg = document.getElementById('authFormRegister');
  if (boite) boite.classList.remove('large');
  if (reg) reg.style.display = 'none';
  if (login) login.style.display = '';
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
  if (
    !marquerChamp(pseudoEl, pseudo.length >= 2, true) ||
    !marquerChamp(emailEl, email.indexOf('@') >= 0, true) ||
    !marquerChamp(mdpEl, mdp.length >= 6, true)
  ) {
    errEl.textContent = 'Des champs sont invalides.';
    majEchec(true);
    return;
  }
  majEchec(false);
  fermerClavier(); // le clavier se ferme avant la transition
  authEnCours = true;
  btnRegister.disabled = true;
  btnRegister.textContent = 'Creation...';
  try {
    var body =
      'pseudo=' +
      encodeURIComponent(pseudo) +
      '&email=' +
      encodeURIComponent(email) +
      '&mdp=' +
      encodeURIComponent(mdp);
    var req = fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    }).then(function (r) {
      // Un 4xx ("pseudo deja pris", "mot de passe trop court") est une
      // reponse JSON voulue : l'ancien throw la noyait dans le catch, qui
      // affichait le faux "Serveur injoignable." pour une erreur connue.
      // Seul un vrai echec reseau (ou un corps illisible) bascule le catch.
      return r.json().catch(function () {
        return { ok: false, message: 'Reponse du serveur illisible.' };
      });
    });
    var j = (await Promise.all([req, delai(1500)]))[0];
    if (j.ok) {
      majEchec(false);
      setAuthInfo(j.ego, j.pseudo, j.uid);
      jouerTransitionConnexion('Bienvenue' + (j.pseudo ? ', ' + j.pseudo : '') + ' !');
    } else {
      marquerChamp(pseudoEl, false, true);
      marquerChamp(emailEl, false, true);
      marquerChamp(mdpEl, false, true);
      majEchec(true);
      errEl.textContent = j.message || 'Erreur.';
    }
  } catch (e) {
    majEchec(true);
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
  if (
    !marquerChamp(emailEl, email.indexOf('@') >= 0, true) ||
    !marquerChamp(mdpEl, mdp.length >= 1, true)
  ) {
    errEl.textContent = 'Des champs sont invalides.';
    majEchec(true);
    return;
  }
  majEchec(false);
  fermerClavier(); // le clavier se ferme avant la transition
  authEnCours = true;
  btnLogin.disabled = true;
  btnLogin.textContent = 'Connexion...';
  try {
    var body = 'email=' + encodeURIComponent(email) + '&mdp=' + encodeURIComponent(mdp);
    var req = fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    }).then(function (r) {
      // Meme regle que /register : un 4xx est une reponse voulue, pas une
      // panne. "Identifiants invalides" doit s'afficher tel quel.
      return r.json().catch(function () {
        return { ok: false, message: 'Reponse du serveur illisible.' };
      });
    });
    var j = (await Promise.all([req, delai(1400)]))[0];
    if (j.ok) {
      majEchec(false);
      setAuthInfo(j.ego, j.pseudo, j.uid);
      jouerTransitionConnexion('Content de te revoir' + (j.pseudo ? ', ' + j.pseudo : '') + ' !');
    } else {
      marquerChamp(emailEl, false, true);
      marquerChamp(mdpEl, false, true);
      majEchec(true);
      errEl.textContent = j.message || 'Erreur.';
    }
  } catch (e) {
    majEchec(true);
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
  try {
    var req = fetch('/invite', { method: 'POST' }).then(function (r) {
      // JSON des 4xx aussi : un refus annonce (quota, invitations fermees)
      // doit se voir tel quel. L'ancienne version passait tout au catch,
      // qui clamait "Mode invite actif !" sans un mot du refus.
      return r.json().catch(function () {
        return null;
      });
    });
    var j = (await Promise.all([req, delai(1200)]))[0];
    if (j && j.ok) {
      localStorage.removeItem(AUTH_CLES.ego);
      localStorage.removeItem(AUTH_CLES.pseudo);
      localStorage.setItem(AUTH_CLES.userId, j.uid);
      if (j.jeton) localStorage.setItem(AUTH_CLES.jeton, j.jeton);
      jouerTransitionConnexion('Mode invite active !');
    } else if (j) {
      // Serveur vivant mais refuse : pas de faux "Mode invite actif !".
      afficherToastDeco(j.message || 'Invitation refusee.', '');
    } else {
      // Reellement injoignable : on retombe sur un uid local (fallback).
      localStorage.removeItem(AUTH_CLES.ego);
      localStorage.removeItem(AUTH_CLES.pseudo);
      if (!localStorage.getItem(AUTH_CLES.userId)) {
        localStorage.setItem(AUTH_CLES.userId, genererUserId());
      }
      jouerTransitionConnexion('Mode invite active !');
    }
  } catch (e) {
    // Le fetch lui-meme a echoue (reseau mort) : fallback local, meme code.
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
    // Plus de ✓ vert : on efface simplement l'etat d'erreur.
    champ.classList.remove('faux');
  } else {
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

// Echec : tout le fond de l'ecran d'authentification vire au rouge.
function majEchec(on) {
  var e = document.getElementById('ecranAuth');
  if (!e) return;
  if (on) {
    e.classList.add('echec');
    if (majEchec._t) clearTimeout(majEchec._t);
    majEchec._t = setTimeout(function () {
      majEchec(false);
    }, 6000);
  } else {
    e.classList.remove('echec');
    if (majEchec._t) {
      clearTimeout(majEchec._t);
      majEchec._t = null;
    }
  }
}

function fermerClavier() {
  var actif = document.activeElement;
  if (actif && typeof actif.blur === 'function') actif.blur();
}

// Bascule connexion <-> inscription en "swap" : la forme active sort en
// faisant un demi-tour 3D, puis l'autre entre dans l'autre sens. La carte
// s'elargit pour que l'inscription profite de tout l'espace.
var swapEnCours = false;
var swapT1 = null;
var swapT2 = null;

// coupe un swap en cours et remet les deux formes dans leur etat normal
function annulerSwap() {
  if (swapT1) {
    clearTimeout(swapT1);
    swapT1 = null;
  }
  if (swapT2) {
    clearTimeout(swapT2);
    swapT2 = null;
  }
  swapEnCours = false;
  var login = document.getElementById('authFormLogin');
  var reg = document.getElementById('authFormRegister');
  if (login) login.classList.remove('sortie-swap', 'entree-swap');
  if (reg) reg.classList.remove('sortie-swap', 'entree-swap');
}

function basculerForm(vers) {
  // Pas de swap pendant une requete : l'erreur irait dans un formulaire
  // masquee. Pas de swap pendant un swap non plus.
  if (swapEnCours || authEnCours) return;
  var login = document.getElementById('authFormLogin');
  var reg = document.getElementById('authFormRegister');
  var boite = document.querySelector('.auth-box');
  if (!login || !reg) return;
  var depuis = vers === 'register' ? login : reg;
  var cible = vers === 'register' ? reg : login;
  if (depuis.style.display === 'none') return;
  swapEnCours = true;
  majEchec(false);

  var champs = depuis.querySelectorAll('.champ');
  for (var i = 0; i < champs.length; i++) champs[i].classList.remove('faux');
  var ancienErr = depuis.querySelector('.auth-err');
  if (ancienErr) ancienErr.textContent = '';

  if (boite) boite.classList.toggle('large', vers === 'register');

  depuis.classList.add('sortie-swap');
  swapT1 = setTimeout(function () {
    swapT1 = null;
    depuis.classList.remove('sortie-swap');
    depuis.style.display = 'none';
    cible.style.display = '';
    forcerReflow(cible);
    cible.classList.add('entree-swap');
    swapT2 = setTimeout(function () {
      swapT2 = null;
      cible.classList.remove('entree-swap');
      swapEnCours = false;
    }, 380);
  }, 200);
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

  // Validation en direct : tremblement rouge si invalide (plus de ✓ vert).
  // Taper = l'utilisateur corrige, donc le fond rouge disparait.
  var CHAMPS = [
    {
      id: 'authPseudoReg',
      valide: function (v) {
        return v.trim().length >= 2;
      }
    },
    {
      id: 'authEmailReg',
      valide: function (v) {
        return v.indexOf('@') >= 0;
      }
    },
    {
      id: 'authMdpReg',
      valide: function (v) {
        return v.length >= 6;
      }
    },
    {
      id: 'authEmail',
      valide: function (v) {
        return v.indexOf('@') >= 0;
      }
    },
    {
      id: 'authMdp',
      valide: function (v) {
        return v.length >= 1;
      }
    }
  ];
  CHAMPS.forEach(function (def) {
    var el = document.getElementById(def.id);
    if (!el) return;
    var delaiValidation = null;
    el.addEventListener('input', function () {
      majEchec(false);
      if (delaiValidation) clearTimeout(delaiValidation);
      delaiValidation = setTimeout(function () {
        marquerChamp(el, def.valide(el.value));
      }, 450);
    });
  });

  if (authShowRegister) {
    authShowRegister.onclick = function (e) {
      e.preventDefault();
      basculerForm('register');
    };
  }
  if (authShowLogin) {
    authShowLogin.onclick = function (e) {
      e.preventDefault();
      basculerForm('login');
    };
  }

  if (authMdp) {
    authMdp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') authLogin();
    });
  }
  if (authMdpReg) {
    authMdpReg.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') authRegister();
    });
  }

  // Enter key sur les champs email
  var authEmail = document.getElementById('authEmail');
  var authEmailReg = document.getElementById('authEmailReg');
  if (authEmail) {
    authEmail.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') authLogin();
    });
  }
  if (authEmailReg) {
    authEmailReg.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') authRegister();
    });
  }

  // Bouton deconnexion
  var btnDeconnexion = document.getElementById('btnDeconnexion');
  if (btnDeconnexion) {
    btnDeconnexion.onclick = function () {
      fetch('/logout', { method: 'POST', headers: authHeaders() }).catch(function () {});
      clearAuth();
      arreterProactif();
      retirerPhotoChoisie();
      viderChat();
      reinitaliserModeUI();
      jouerTransitionDeconnexion();
    };
  }

  // Boutons mode et envoi
  if (envoyerBtn) envoyerBtn.onclick = envoyer;
  if (mode1Btn)
    mode1Btn.onclick = function () {
      changerMode(1);
    };
  if (mode2Btn)
    mode2Btn.onclick = function () {
      changerMode(2);
    };

  // Bouton photo : choix d'un fichier, apercu dans la barre, envoi avec le
  // prochain message (ou seul, le serveur accepte un message vide + image).
  var btnImage = document.getElementById('btnImage');
  var fichierImage = document.getElementById('fichierImage');
  if (btnImage && fichierImage) {
    btnImage.onclick = function () {
      if (actionEnCours) return;
      fichierImage.click();
    };
    fichierImage.onchange = function () {
      choisirImage(fichierImage.files && fichierImage.files[0]);
    };
    var apX = document.getElementById('apercuPhotoAnnuler');
    if (apX) apX.onclick = retirerPhotoChoisie;
  }

  if (zoneEl) {
    zoneEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        envoyer();
      }
    });
  }

  initialiserRecherche();
  initialiserNotifications();
  initialiserMenuMobile();

  // Position initiale de la pilule EGO / BLAMUNE
  setTimeout(function () {
    deplacerPilule(chargerProfilLocal().mode === '1' ? '1' : '2', true);
  }, 50);

  // Quand l'onglet redevient visible, on verifie l'etat du serveur
  // ET les messages que BLAMUNE aurait pu ecrire pendant notre absence.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      charger();
      verifierProactif();
    }
  });

  if (estAuth()) {
    fetch('/historique', { headers: authHeaders() })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j.ok !== false) afficherApp();
        else {
          clearAuth();
          afficherAuth();
        }
      })
      .catch(function () {
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
      fetch('/logout', { method: 'POST', headers: headers, body: '', keepalive: true }).catch(
        function () {}
      );
    }
  });
}

function getUserId() {
  return getAuthUserId();
}

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
  if (!c) {
    c = document.createElement('div');
    c.className = 'conteneur';
    chat.appendChild(c);
  }
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
  if (qui === 'bot') {
    var logo = document.createElement('img');
    logo.src = 'logo-repos.svg';
    logo.alt = '';
    avatar.appendChild(logo);
  } else {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'
    );
    svg.appendChild(path);
    avatar.appendChild(svg);
  }

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

  if (qui === 'moi') {
    d.appendChild(corps);
    d.appendChild(avatar);
  } else {
    d.appendChild(avatar);
    d.appendChild(corps);
  }

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
    logo.src = 'logo-repos.svg';
    logo.alt = '';
    av.appendChild(logo);
    var corps = document.createElement('div');
    corps.className = 'corps';
    var bulle = document.createElement('div');
    bulle.className = 'bulle';
    var pts = document.createElement('span');
    pts.className = 'points';
    var p1 = document.createElement('i');
    var p2 = document.createElement('i');
    var p3 = document.createElement('i');
    pts.appendChild(p1);
    pts.appendChild(p2);
    pts.appendChild(p3);
    bulle.appendChild(pts);
    corps.appendChild(bulle);
    d.appendChild(av);
    d.appendChild(corps);
    c.appendChild(d);
    requestAnimationFrame(function () {
      // FIX #3: scroll after DOM update
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
  btn.style.cssText =
    'display:inline;color:var(--accent);font-weight:600;text-decoration:underline;background:none;border:none;cursor:pointer;font-size:inherit;margin-left:4px;';
  btn.onclick = function () {
    var m = chargerProfilLocal().mode === '1' ? 1 : 2;
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
  grosLogo.src = 'logo-repos.svg';
  grosLogo.alt = 'BLAMUNE';
  gros.appendChild(grosLogo);
  var titre = document.createElement('h2');
  titre.textContent = 'Bienvenue !';
  var sous = document.createElement('p');
  sous.textContent =
    'Je suis BLAMUNE. Discute avec moi, pose-moi des questions, ou apprends-moi des choses que je retiendrai.';
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
      if (z) {
        z.value = txt;
        z.focus();
      }
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
  // Une recherche en cours n'est pas le fil : les resultats affiches ne
  // doivent pas etre ecrases par un rechargement arrive pendant la lecture.
  if (rechercheActive()) return;
  if (chargerEnCours || actionEnCours) {
    _chargerPending = true;
    return;
  }
  chargerEnCours = true;
  try {
    var abortCtrl = new AbortController();
    var abortTimer = setTimeout(function () {
      abortCtrl.abort();
    }, 120000);
    var r = await fetch('/historique', { headers: authHeaders(), signal: abortCtrl.signal });
    clearTimeout(abortTimer);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var j = await r.json();
    if (j.ok === false) {
      chargerEnCours = false;
      return;
    }
    if (_chargerInterval) {
      clearTimeout(_chargerInterval);
      _chargerInterval = null;
    }
    nbErreursConnexion = 0;
    majMode(j.mode || '2');
    majStatut(j.etat);
    if (j.etat === 'pret' || j.etat === 'demarrage') arretSignale = false;
    if (j.etat === 'pret' || j.etat === 'arrete' || j.etat === 'erreur') nbPollsDemarrage = 0;
    var hist = j.historique || [];
    _histFil = hist; // memorise : sert a restaurer le fil a la fermeture de recherche
    var c = conteneur();
    if (!c) {
      chargerEnCours = false;
      return;
    }
    var modeChange = dernierModeCharge !== null && dernierModeCharge !== j.mode;
    dernierModeCharge = j.mode;
    var existants = c.querySelectorAll('.msg:not(.attente)');
    var nbExistants = existants.length;
    var nbHistorique = hist.length;
    if (modeChange || nbExistants !== nbHistorique) {
      afficherFil(hist);
      if (nbHistorique === 0 && (j.etat === 'pret' || j.etat === 'demarrage')) {
        afficherAccueil();
      }
    } else if (
      nbHistorique === 0 &&
      !c.querySelector('.accueil') &&
      (j.etat === 'pret' || j.etat === 'demarrage')
    ) {
      afficherAccueil();
    }
    if (_animEntree) {
      _animEntree = false;
      animerEntreeChat();
    }
    if (j.etat === 'arrete' || j.etat === 'erreur') signalerArret();
    else if (j.etat === 'demarrage') {
      nbPollsDemarrage++;
      if (nbPollsDemarrage < MAX_POLLS_DEMARRAGE) _chargerInterval = setTimeout(charger, 1500);
      else majStatut('erreur', 'Demarrage trop long');
    }
    chargerEnCours = false;
    if (_chargerPending) {
      _chargerPending = false;
      _chargerInterval = setTimeout(charger, 100);
    }
  } catch (e) {
    chargerEnCours = false;
    if (_chargerPending) {
      _chargerPending = false;
      _chargerInterval = setTimeout(charger, 100);
    }
    nbErreursConnexion++;
    majStatut('horsligne', 'Serveur injoignable');
    if (nbErreursConnexion < 30)
      _chargerInterval = setTimeout(charger, Math.min(4000 + nbErreursConnexion * 1000, 30000));
  }
}

// ---------------- RECHERCHE DANS L'HISTORIQUE (sprint E) ----------------

// Dernier fil normal charge (hors recherche) : c'est lui qu'on re-affiche
// quand la recherche se ferme, sans attendre le reseau.
var _histFil = [];

function afficherFil(hist) {
  var c = conteneur();
  if (!c) return;
  viderChat();
  (hist || []).forEach(function (h) {
    if (h.qui === 'systeme') ajouterSysteme(h.texte);
    else if (h.qui === 'bot' || h.qui === 'moi') {
      // Photo envoyee : seul le marqueur revient du serveur (pas de
      // base64 dans l'historique), donc un simple emoji dans la bulle.
      var texteAffiche = h.image
        ? (h.texte || '') + (h.texte || '' ? ' ' : '') + '\ud83d\udcf7'
        : h.texte;
      ajouterMessage(h.qui, texteAffiche, undefined, h.t);
    } else ajouterInfo(h.texte);
  });
}

// La recherche est active tant que le panneau est ouvert avec un motif
// de deux caracteres ou plus : charger() s'abstient tant qu'on lit.
function rechercheActive() {
  var z = document.getElementById('zoneRecherche');
  if (!z || z.style.display === 'none') return false;
  var champ = document.getElementById('champRecherche');
  return !!champ && String(champ.value || '').trim().length >= 2;
}

// sansCharger : true quand on ferme juste avant d'envoyer un message
// (envoyer()), pour ne pas demeler le rendu qui suit le flux.
function fermerRecherche(sansCharger) {
  var z = document.getElementById('zoneRecherche');
  var champ = document.getElementById('champRecherche');
  var note = document.getElementById('noteRecherche');
  if (z) z.style.display = 'none';
  if (champ) champ.value = '';
  if (note) note.textContent = '';
  afficherFil(_histFil);
  if (!sansCharger) charger();
}

var _delaiRecherche = null;

async function lancerRecherche(q) {
  q = String(q || '').trim();
  var note = document.getElementById('noteRecherche');
  if (q.length < 2) {
    if (note) note.textContent = '';
    afficherFil(_histFil);
    return;
  }
  try {
    var r = await fetch('/historique?q=' + encodeURIComponent(q), {
      headers: authHeaders()
    });
    if (!r.ok) return;
    var j = await r.json();
    if (j.ok === false) return;
    afficherFil(j.historique || []);
    if (note) note.textContent = j.total + ' correspondance' + (j.total <= 1 ? '' : 's');
  } catch (e) {}
}

// ---------------- MENU MOBILE (header, < 600px) ----------------
// Sur telephone les boutons secondaires vivent dans le panneau
// #menuMobile, ouvert par le bouton 3 barres. Ici : ouverture, fermeture
// (clic sur une action, clic dehors, onglet redevient visible) et
// l'etat actif du bouton. Sur PC le panneau est transparent (display:
// contents) : rien ne se passe visiblement, aucun risque.
function initialiserMenuMobile() {
  var menu = document.getElementById('menuMobile');
  var btnMenu = document.getElementById('btnMenuMobile');
  if (!menu || !btnMenu) return;

  function basculer(ouvrir) {
    menu.classList.toggle('menu-ouvert', !!ouvrir);
    btnMenu.classList.toggle('actif', !!ouvrir);
    btnMenu.setAttribute('aria-expanded', ouvrir ? 'true' : 'false');
  }
  function estOuvert() {
    return menu.classList.contains('menu-ouvert');
  }

  btnMenu.addEventListener('click', function (e) {
    // On arrete la propagation : le clic dehors document fermerait
    // aussitot le panneau qu'on vient d'ouvrir.
    e.stopPropagation();
    basculer(!estOuvert());
  });

  // Un clic sur une action referme le panneau : on a fait notre choix.
  menu.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('button')) basculer(false);
  });

  // Un clic n'importe ou ailleurs referme aussi.
  document.addEventListener('click', function (e) {
    if (!estOuvert()) return;
    if (menu.contains(e.target) || btnMenu.contains(e.target)) return;
    basculer(false);
  });
}

function initialiserRecherche() {
  var z = document.getElementById('zoneRecherche');
  var btn = document.getElementById('btnRechercher');
  var champ = document.getElementById('champRecherche');
  var fermer = document.getElementById('btnFermerRecherche');
  if (!z || !btn || !champ || !fermer) return;
  btn.addEventListener('click', function () {
    var ouvert = z.style.display !== 'none';
    if (ouvert) fermerRecherche();
    else {
      z.style.display = 'flex';
      lancerRecherche(champ.value);
      champ.focus();
    }
  });
  fermer.addEventListener('click', function () {
    fermerRecherche();
  });
  champ.addEventListener('input', function () {
    if (_delaiRecherche) clearTimeout(_delaiRecherche);
    var v = champ.value;
    _delaiRecherche = setTimeout(function () {
      _delaiRecherche = null;
      lancerRecherche(v);
    }, 300);
  });
}

// ---------------- ETAT DE BLAMUNE VISIBLE (sprint E) ----------------
// L'humeur de BLAMUNE et ce qu'elle a note de l'utilisateur vivent dans la
// memoire, mais etaient invisibles hors du profil complet. Une pastille dis-
// crete sous le statut les rend visibles, seulement quand il y a quelque
// chose a dire : pas d'humeur, pas d'humeur detectee, aucune promesse en
// cours -> la pastille se retire.

var LIBELLES_HUMEUR = {
  calme: 'au calme',
  joyeux: 'joyeuse',
  triste: 'triste',
  energique: 'energique'
};
var LIBELLES_HUMEUR_USER = {
  calme: 'au calme',
  joyeux: 'joyeux ou joyeuse',
  triste: 'triste',
  fatigue: 'fatigue(e)',
  energique: "plein(e) d'energie"
};

function majEtatIA(j) {
  var el = document.getElementById('etatIA');
  if (!el) return;
  var b = j && j.blamune;
  var morceaux = [];
  if (b && b.humeur) {
    morceaux.push('BLAMUNE se sent ' + (LIBELLES_HUMEUR[b.humeur] || b.humeur));
  }
  if (b && b.humeurUser) {
    morceaux.push('Tu sembles ' + (LIBELLES_HUMEUR_USER[b.humeurUser] || b.humeurUser));
  }
  if (b && b.promesses && b.promesses.length) {
    morceaux.push(
      'Promesse en cours : ' +
        b.promesses.slice(0, 2).join(', ') +
        (b.promesses.length > 2 ? '...' : '')
    );
  }
  var texte = morceaux.join(' \u00b7 ');
  if (!texte) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.textContent = texte;
  el.style.display = 'block';
}

async function actualiserEtatIA() {
  if (!getAuthUserId()) return;
  try {
    var r = await fetch('/stats-perso', { headers: authHeaders() });
    if (!r.ok) return;
    var j = await r.json();
    if (j.ok) majEtatIA(j);
  } catch (e) {}
}

// ---------------- NOTIFICATIONS PUSH (sprint E) ----------------
// Un seul bouton, une seule decision : /push/config dit si le serveur est
// capable d'envoyer (VAPID configure). Bouton cache sinon. L'abonnement
// n'est pas regenere a chaque visite : on le relit, on l'envoie une fois,
// puis le bouton passe a l'etat label repose.
function clesDeApplicationServerKey(b64url) {
  var pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  var brut = window.atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  var octets = new Uint8Array(brut.length);
  for (var i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i);
  return octets;
}

async function initialiserNotifications() {
  var btn = document.getElementById('btnNotifications');
  if (!btn) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    var rc = await fetch('/push/config');
    if (!rc.ok) return;
    var cfg = await rc.json();
    if (!cfg || cfg.ok === false || !cfg.actif || !cfg.cle) return;
    // Le bouton est masque par defaut dans index.html (feature eteinte) :
    // la config OK est le seul endroit qui le demasque.
    btn.style.display = '';
    var reg = (await navigator.serviceWorker.getRegistration()) || null;
    var sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      btn.textContent = 'Notifications OK';
      btn.disabled = true;
      return;
    }
    btn.textContent = 'Activer les notifications';
    btn.addEventListener('click', async function () {
      try {
        var permission =
          window.Notification && window.Notification.requestPermission
            ? await window.Notification.requestPermission()
            : 'granted';
        if (permission !== 'granted') {
          ajouterInfo(
            'Notifications refusees — active-les dans les reglages du site si tu changes d avis.'
          );
          return;
        }
        var pret = await navigator.serviceWorker.ready;
        var ab = await pret.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: clesDeApplicationServerKey(cfg.cle)
        });
        var envoi = await fetch('/push/abonnement', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify({ abonnement: ab.toJSON ? ab.toJSON() : ab })
        });
        var reponse = await envoi.json();
        if (reponse.ok) {
          btn.textContent = 'Notifications OK';
          btn.disabled = true;
          ajouterInfo(
            'Notifications activees : BLAMUNE pourra t ecrire meme quand le site est ferme.'
          );
        } else {
          ajouterInfo('L abonnement a ete refuse : ' + (reponse.message || 'raison inconnue'));
        }
      } catch (e) {
        ajouterInfo("Les notifications n'ont pas pu s activer sur cet appareil.");
      }
    });
  } catch (e) {}
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

// Rebuild du fil de conversation pour l'IA de secours directe : les bulles deja
// affichees dans le DOM font office d'historique (le serveur est justement
// injoignable, /historique ne repondra pas). Les messages systeme/info
// (.msg.systeme / .msg.info) et la bulle d'attente sont ignores.
function historiquePourIA() {
  var noeuds = document.querySelectorAll('#chat .msg.moi, #chat .msg.bot');
  var out = [];
  var bulles = [];
  for (var i = 0; i < noeuds.length; i++) {
    var b = noeuds[i].querySelector('.bulle');
    var t = b ? b.textContent.trim() : '';
    if (!t) continue;
    bulles.push({
      role: noeuds[i].classList.contains('moi') ? 'user' : 'assistant',
      content: t
    });
  }
  // 10 derniers echanges, en garantissant que le tour commence par un user
  // (le modele exige un historique coherent).
  var fin = bulles.slice(-10);
  while (fin.length && fin[0].role !== 'user') fin.shift();
  for (var k = 0; k < fin.length; k++) out.push({ role: fin[k].role, content: fin[k].content });
  return out;
}

// Palier EN LIGNE depuis la page : serveur BLAMUNE injoignable, mais
// internet encore la → une IA libre sans cle est appelee directement par le
// navigateur (gpt-oss via text.pollinations.ai, quota 1 / 30 s par IP).
async function tenterIAEnLigne(surDelta) {
  if (!window.IA_Secours || typeof IA_Secours.repondreEnLigne !== 'function')
    return { fait: false };
  if (navigator.onLine === false) return { fait: false };
  if (imageChoisie) return { fait: false };
  var hist = historiquePourIA();
  if (hist.length === 0) return { fait: false };
  majStatut('pense', 'IA en ligne (repli direct)...');
  try {
    await IA_Secours.repondreEnLigne(hist, surDelta);
    majStatut('horsligne', 'Serveur injoignable - IA directe');
    return { fait: true };
  } catch (e) {
    majStatut('horsligne', 'Serveur injoignable');
    return { fait: false, erreur: e };
  }
}

// Lecture d'une reponse en flux (SSE) : le texte du bot s'ecrit au fur et a
// mesure de la generation au lieu d'attendre la fin. Chaque evenement porte
// le texte entier (absolu), donc un repli/relance ne cree jamais de doublon.
function lireFlux(reponse, surDelta, surFin) {
  var lecteur = reponse.body.getReader();
  var decodeur = new TextDecoder();
  var tampon = '';

  function traiterBloc(bloc) {
    var lignes = bloc.split('\n');
    for (var i = 0; i < lignes.length; i++) {
      var ligne = lignes[i];
      if (ligne.substring(0, 5) !== 'data:') continue;
      var brut = ligne.substring(5).trim();
      if (!brut) continue;
      var d;
      try {
        d = JSON.parse(brut);
      } catch (e) {
        continue;
      }
      if (d.fin) {
        surFin(d);
      } else if (typeof d.t === 'string') {
        surDelta(d.t);
      }
    }
  }

  return lecteur.read().then(function suite(res) {
    if (res.done) {
      // Dernier bloc non suivi d'une ligne vide : on le traite quand meme.
      tampon += decodeur.decode();
      if (tampon.trim()) traiterBloc(tampon);
      return;
    }
    tampon += decodeur.decode(res.value, { stream: true });
    var blocs = tampon.split('\n\n');
    tampon = blocs.pop();
    for (var i = 0; i < blocs.length; i++) traiterBloc(blocs[i]);
    return lecteur.read().then(suite);
  });
}

// ---------------- PHOTOS ----------------
// Une photo par data URL, redimensionnee avant envoi (1280 px, jpeg 0.82) :
// ~200-400 ko au lieu de plusieurs Mo. L'historique ne garde qu'un marqueur
// (pas de base64 dans le cloud).
var imageChoisie = null;

function retirerPhotoChoisie() {
  imageChoisie = null;
  var ap = document.getElementById('apercuPhoto');
  var f = document.getElementById('fichierImage');
  if (ap) ap.style.display = 'none';
  if (f) f.value = '';
}

function choisirImage(fichier) {
  if (!fichier) return;
  if (!/^image\//.test(fichier.type)) {
    ajouterInfo("Ce fichier n'est pas une image.");
    return;
  }
  var lecteur = new FileReader();
  lecteur.onload = function (ev) {
    var img = new Image();
    img.onload = function () {
      var max = 1280;
      var l = img.width,
        h = img.height;
      if (l > max || h > max) {
        if (l >= h) {
          h = Math.round((h * max) / l);
          l = max;
        } else {
          l = Math.round((l * max) / h);
          h = max;
        }
      }
      var c = document.createElement('canvas');
      c.width = l;
      c.height = h;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, l, h);
      var dataUrl;
      try {
        dataUrl = c.toDataURL('image/jpeg', 0.82);
      } catch (e) {
        dataUrl = ev.target.result;
      }
      if (dataUrl.length > 9000000) {
        ajouterInfo('Photo trop lourde (7 Mo max).');
        return;
      }
      imageChoisie = dataUrl;
      var ap = document.getElementById('apercuPhoto');
      var apImg = document.getElementById('apercuPhotoImg');
      var apNom = document.getElementById('apercuPhotoNom');
      if (apImg) apImg.src = dataUrl;
      if (apNom) apNom.textContent = fichier.name || 'photo.jpg';
      if (ap) ap.style.display = 'flex';
      var z = document.getElementById('zone');
      if (z) z.focus();
    };
    img.onerror = function () {
      ajouterInfo('Image illisible.');
    };
    img.src = ev.target.result;
  };
  lecteur.readAsDataURL(fichier);
}

// La photo dans la bulle envoyee (l'historique, lui, ne remet qu'un marqueur).
function ajouterPhotoBubble(node, src) {
  if (!node || !src) return;
  var corps = node.querySelector('.corps');
  if (!corps) return;
  var img = document.createElement('img');
  img.className = 'photo-envoyee';
  img.loading = 'lazy';
  img.src = src;
  img.alt = 'Photo envoyee';
  var bulle = corps.querySelector('.bulle');
  if (bulle && bulle.nextSibling) corps.insertBefore(img, bulle.nextSibling);
  else corps.appendChild(img);
}

// ---------------- COMMANDES PERSO ----------------
// /aide, /stats, /oublie : traitees cote client, jamais envoyees au modele.
async function traiterCommande(m) {
  var z = document.getElementById('zone');
  var mot = m.split(/\s+/)[0].toLowerCase();
  if (mot === '/aide' || mot === '/help') {
    if (z) z.value = '';
    ajouterSysteme(
      'Commandes : /cherche (BLAMUNE cherche sur le web et te repond avec ses sources), /stats (ta vie avec BLAMUNE), /oublie (effacer la conversation, profil conserve), /aide (cette liste). Le bouton photo envoie une image.'
    );
    return;
  }
  if (mot === '/stats') {
    if (z) z.value = '';
    try {
      var r = await fetch('/stats-perso', { headers: authHeaders() });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var j = await r.json();
      if (!j.ok) throw new Error('refus');
      var lignes =
        'Messages echanges : ' + j.messages + ' (conversation n\u00b0' + j.sessions + ')';
      if (j.jours <= 0) lignes += "\nVous vous connaissez depuis aujourd'hui.";
      else
        lignes +=
          '\nVous vous connaissez depuis ' + j.jours + ' jour' + (j.jours > 1 ? 's' : '') + '.';
      if (j.dernierContact) {
        var ecart = Math.floor((Date.now() - j.dernierContact) / 86400000);
        lignes +=
          ecart <= 0
            ? "\nDernier contact : aujourd'hui."
            : '\nDernier contact : il y a ' + ecart + ' jour' + (ecart > 1 ? 's' : '') + '.';
      }
      if (j.anniversaire) {
        lignes +=
          '\nAnniversaire : ' +
          j.anniversaire +
          (j.joursAnniversaire === 0
            ? " (aujourd'hui !)"
            : j.joursAnniversaire > 0
              ? ' (dans ' +
                j.joursAnniversaire +
                ' jour' +
                (j.joursAnniversaire > 1 ? 's' : '') +
                ')'
              : '');
      }
      // Etat interieur (sprint E) : la memoire emotionnelle, en clair.
      var b = j.blamune || {};
      if (b.humeur) {
        lignes += '\nHumeur de BLAMUNE : ' + (LIBELLES_HUMEUR[b.humeur] || b.humeur) + '.';
      }
      if (b.humeurUser) {
        lignes +=
          "\nCe qu'elle a note chez toi : tu sembles " +
          (LIBELLES_HUMEUR_USER[b.humeurUser] || b.humeurUser) +
          '.';
      }
      if (b.promesses && b.promesses.length) {
        lignes += '\nPromesses en cours : ' + b.promesses.join(' ; ');
      }
      ajouterSysteme(lignes);
      majEtatIA(j);
    } catch (e) {
      ajouterInfo('Stats indisponibles pour le moment.');
    }
    return;
  }
  if (mot === '/oublie') {
    if (z) z.value = '';
    var ok = window.confirm(
      'Effacer toute la conversation ? Ton profil (nom, souvenirs) est conserve.'
    );
    if (!ok) return;
    try {
      var r2 = await fetch('/historique', { method: 'DELETE', headers: authHeaders() });
      if (!r2.ok) throw new Error('HTTP ' + r2.status);
      viderChat();
      afficherAccueil();
      afficherToastDeco('Conversation effac\u00e9e.', 'ok');
    } catch (e2) {
      ajouterInfo('Effacement impossible pour le moment.');
    }
    return;
  }
  if (z) z.value = '';
  ajouterInfo('Commande inconnue : tape /aide pour la liste.');
}

// ---------------- MESSAGES PROACTIFS ----------------
// BLAMUNE ecrit le premier : on sonde /proactif en arriere-plan, la bulle
// arrive comme une vraie reponse (et l'historique serveur la contient deja,
// donc aucun doublon au rechargement).
var minuterieProactif = null;
var proactifEnCours = false;

function demarrerProactif() {
  if (minuterieProactif) return;
  minuterieProactif = setInterval(verifierProactif, 90000);
  setTimeout(verifierProactif, 20000);
}

function arreterProactif() {
  if (minuterieProactif) {
    clearInterval(minuterieProactif);
    minuterieProactif = null;
  }
}

async function verifierProactif() {
  if (proactifEnCours || actionEnCours || !estAuth() || !getAuthUserId()) return;
  proactifEnCours = true;
  try {
    var ctrl = new AbortController();
    var t = setTimeout(function () {
      ctrl.abort();
    }, 10000);
    var r = await fetch('/proactif', { headers: authHeaders(), signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return;
    var j = await r.json();
    if (j && j.ok && j.message && j.message.texte) {
      ajouterMessage('bot', j.message.texte, undefined, j.message.t);
      afficherToastDeco('BLAMUNE t\u2019a ecrit !', 'ok');
      defilerSiEnBas();
    }
  } catch (e) {}
  proactifEnCours = false;
}

async function envoyer() {
  if (!getAuthUserId()) return;
  // Une recherche ouverte va etre ecrasee par les bulles qui arrivent :
  // on restaure le fil avant d'envoyer (sans recharger, le flux s'en charge).
  if (rechercheActive()) fermerRecherche(true);
  var z = document.getElementById('zone');
  if (!z) return;
  var m = z.value.trim();
  // Le texte TEL QU'IL ETAIT au moment de l'envoi : si l'utilisateur tape
  // pendant la generation, la fin de la reponse ne doit pas lui ecraser
  // le clavier (l'ancienne version vidait le champ inconditionnellement).
  var texteEnvoye = z.value;
  if (m.charAt(0) === '/') {
    if (/^\/cherche\b/i.test(m)) {
      var csuj = m.replace(/^\/cherche\b/i, '').trim();
      if (!csuj) {
        if (z) z.value = '';
        ajouterInfo(
          'Usage : /cherche ce-que-tu-cherches. BLAMUNE fait la recherche sur le web puis te repond avec ses sources.'
        );
        return;
      }
      // La commande part TELLE QUE : c'est le serveur qui recherche
      // (DuckDuckGo sans cle) avant de repondre ; la suite du flux est
      // le chemin normal de /send (bulle, flux SSE, historique...).
    } else {
      traiterCommande(m);
      return;
    }
  }
  if ((!m && !imageChoisie) || actionEnCours) return;
  actionEnCours = true;
  desactiver(true);
  majStatut('pense');
  var msgNode = ajouterMessage('moi', m || '');
  if (imageChoisie) ajouterPhotoBubble(msgNode, imageChoisie);
  attente(true);

  // Bulle du bot : creee des le premier fragment recu.
  var bulleBot = null;
  var termine = false; // une fois la reponse finalisee, plus aucun fragment

  // Vide le champ seulement si l'utilisateur n'y a rien retape depuis
  // l'envoi ; sinon son brouillon en cours est conserve.
  function viderSiIntact() {
    if (z.value === texteEnvoye) z.value = '';
  }

  function direct(texte) {
    if (termine || !texte) return;
    if (!bulleBot) {
      attente(false);
      bulleBot = ajouterMessage('bot', texte);
      defilerSiEnBas();
    } else {
      var b = bulleBot.querySelector('.bulle');
      if (b && b.textContent !== texte) {
        b.textContent = texte;
        defilerSiEnBas();
      }
    }
  }

  function finaliser(j) {
    if (termine) return;
    termine = true;
    attente(false);
    viderSiIntact();
    majStatut(j.etat);
    var reps = j.reponses || [];
    if (reps.length > 0) {
      if (bulleBot) {
        var b = bulleBot.querySelector('.bulle');
        if (b) b.textContent = reps[0]; // version nettoyee par le serveur
        for (var i = 1; i < reps.length; i++) ajouterMessage('bot', reps[i], j.confiance);
        bulleBot = null;
      } else {
        reps.forEach(function (rep) {
          ajouterMessage('bot', rep, j.confiance);
        });
      }
      if (j.etat === 'arrete' || j.etat === 'erreur') signalerArret();
      lireVoix(reps[0]);
    } else if (bulleBot) {
      bulleBot.remove();
      bulleBot = null;
    }
  }

  // Le chrono couvre TOUTE la requete, corps de flux compris : avant, il
  // s'arretait des les en-tetes et un flux qui s'arrete gelait l'application
  // (bouton d'envoi bloque, plus aucun rafraichissement).
  var abortCtrl = new AbortController();
  var abortTimer = setTimeout(function () {
    abortCtrl.abort();
  }, 120000);

  try {
    var profil = chargerProfilLocal();
    var modeServ = dernierModeCharge || profil.mode || '2';
    var body =
      'msg=' + encodeURIComponent(m) + '&mode=' + encodeURIComponent(modeServ) + '&stream=1';
    if (imageChoisie) body += '&image=' + encodeURIComponent(imageChoisie);
    var headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    var ah = authHeaders();
    for (var k in ah) headers[k] = ah[k];
    var r = await fetch('/send', {
      method: 'POST',
      headers: headers,
      body: body,
      signal: abortCtrl.signal
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    viderSiIntact();
    retirerPhotoChoisie();
    var ct = r.headers.get('content-type') || '';
    if (ct.indexOf('text/event-stream') >= 0 && r.body && r.body.getReader) {
      var recuFin = false;
      await lireFlux(r, direct, function (d) {
        recuFin = true;
        finaliser(d);
      });
      if (!recuFin) throw new Error('Flux interrompu');
    } else if (ct.indexOf('text/event-stream') >= 0) {
      // Flux annonce mais non lisible : on ne peut pas faire mieux que d'echouer.
      throw new Error('Flux non supporte par ce navigateur');
    } else {
      // Serveur ancien (pas de flux) : on garde l'ancien chemin JSON.
      finaliser(await r.json());
    }
  } catch (e) {
    attente(false);
    if (bulleBot) {
      // Une partie de la reponse est deja arrivee : on la garde.
      viderSiIntact();
      majStatut('horsligne', 'Connexion interrompue');
    } else {
      // Serveur injoignable : le seul palier restant est une IA libre
      // appelee DIRECTEMENT par la page (si l'internet vit) ; sinon,
      // message d'echec honnete, sans invention.
      var local = await tenterIAEnLigne(direct);
      if (local.fait) {
        var texteLocal = bulleBot ? (bulleBot.querySelector('.bulle') || {}).textContent || '' : '';
        bulleBot = null;
        ajouterInfo(
          'Reponse generee DIRECTEMENT par ton navigateur (IA libre en ligne, sans serveur BLAMUNE).'
        );
        lireVoix(texteLocal);
      } else {
        if (msgNode) msgNode.remove();
        // Message remis dans le champ pour pouvoir le renvoyer — sauf si
        // l'utilisateur a deja commence autre chose pendant l'attente.
        if (z.value === texteEnvoye) z.value = m;
        majStatut('horsligne', 'Serveur injoignable');
        ajouterInfo('Envoi echoue : le serveur ne repond pas (timeout 120s). Reessaie.');
        if (local.erreur && /30 s/i.test(local.erreur.message || '')) {
          ajouterInfo(local.erreur.message + '.');
        }
      }
    }
  } finally {
    clearTimeout(abortTimer);
    actionEnCours = false;
    if (_chargerInterval) {
      clearTimeout(_chargerInterval);
      _chargerInterval = null;
    }
    desactiver(false);
    z.focus();
    setTimeout(function () {
      charger();
      // L'apprentissage vient de tourner : l'etat affiche peut avoir change
      // (humeur, promesse). On rafraichit apres le rechargement du fil.
      setTimeout(actualiserEtatIA, 600);
    }, 500);
  }
}

async function changerMode(m) {
  if (m !== 1 && m !== 2 && m !== 3) return;
  if (modeEnCours) return;
  modeEnCours = true;
  if (actionEnCours) {
    modeEnCours = false;
    return;
  }
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
    var abortTimer = setTimeout(function () {
      abortCtrl.abort();
    }, 120000);
    var req = fetch('/mode', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {
        'Content-Type': 'application/x-www-form-urlencoded'
      }),
      body: 'm=' + m,
      signal: abortCtrl.signal
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
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
  if (_chargerInterval) {
    clearTimeout(_chargerInterval);
    _chargerInterval = null;
  }
  if (appContenu) {
    setTimeout(function () {
      appContenu.classList.remove('mode-bascule');
    }, 700);
  }
  modeEnCours = false;
  try {
    await charger();
  } catch (_) {}
  desactiver(false);
  var z = document.getElementById('zone');
  if (z) z.focus();
}

// ---------------- MODE VOCAL ----------------
// Un seul bouton dans la barre : il ecoute (dictee vocale), il lit les
// reponses (synthese vocale), et en mode actif la conversation tourne toute
// seule : BLAMUNE parle, puis il ecoute la reponse, puis il recommence.
// La langue du micro suit celle du navigateur (anglais, francais...).
var voixOn = false;
var reco = null;
var recoEnCours = false;
var langueVoix = navigator.language || 'fr-FR';

function eteindreVoix() {
  voixOn = false;
  var b = document.getElementById('btnVoix');
  if (b) {
    b.classList.remove('actif');
    b.setAttribute('aria-pressed', 'false');
  }
  try {
    if (reco) reco.stop();
  } catch (e) {}
  recoEnCours = false;
  try {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  } catch (e) {}
}

function ecouterVoix() {
  if (!voixOn || recoEnCours || actionEnCours) return;
  if (!reco) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    reco = new SR();
    reco.lang = langueVoix;
    reco.interimResults = true;
    reco.continuous = false;
    reco.maxAlternatives = 1;
    var entendu = ''; // ce qui a deja ete tranche par le navigateur
    reco.onresult = function (ev) {
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i];
        if (res.isFinal) entendu += res[0].transcript;
        else interim += res[0].transcript;
      }
      var z = document.getElementById('zone');
      if (z) z.value = (entendu + ' ' + interim).trim();
    };
    reco.onerror = function (ev) {
      recoEnCours = false;
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        eteindreVoix();
        afficherToastDeco('Micro refuse : mode vocal eteint.');
      }
    };
    reco.onend = function () {
      recoEnCours = false;
      if (!voixOn) return;
      var z = document.getElementById('zone');
      var texte = z ? z.value.trim() : '';
      if (texte) {
        var attendreEnvoi = function () {
          if (!voixOn) return;
          if (!actionEnCours) {
            envoyer();
            return;
          }
          setTimeout(attendreEnvoi, 600);
        };
        attendreEnvoi();
        return;
      }
      // Silence : on garde l'oreille ouverte tant que le mode est actif.
      if (!actionEnCours) setTimeout(ecouterVoix, 600);
    };
  }
  try {
    recoEnCours = true;
    reco.start();
  } catch (e) {
    recoEnCours = false;
  }
}

function lireVoix(texte) {
  if (!voixOn || !('speechSynthesis' in window) || !texte) return;
  try {
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(texte);
    u.lang = langueVoix;
    u.rate = 1;
    u.onend = function () {
      if (voixOn) setTimeout(ecouterVoix, 500);
    };
    u.onerror = function () {
      if (voixOn) setTimeout(ecouterVoix, 500);
    };
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

(function initBoutonVoix() {
  var b = document.getElementById('btnVoix');
  if (!b) return;
  var sr = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!sr && !('speechSynthesis' in window)) {
    b.style.display = 'none';
    return;
  }
  b.addEventListener('click', function () {
    if (voixOn) {
      eteindreVoix();
      afficherToastDeco('Mode vocal eteint.');
      return;
    }
    if (!sr) {
      afficherToastDeco('Ce navigateur ne gere pas la dictee vocale.');
      return;
    }
    voixOn = true;
    b.classList.add('actif');
    b.setAttribute('aria-pressed', 'true');
    afficherToastDeco('Mode vocal : je t\u2019ecoute.', 'ok');
    ecouterVoix();
  });
})();

// ---------------- THEME : clair / sombre ----------------
// Le choix vive dans le navigateur (blamune_theme) : aucun aller-retour
// serveur, il s'applique des le premier rendu, ecran de connexion compris.
// Le <meta name="theme-color"> suit : c'est lui qui colore la barre du
// navigateur mobile (PWA).
function appliquerTheme(nom) {
  var clair = nom === 'clair';
  document.documentElement.setAttribute('data-theme', clair ? 'clair' : 'sombre');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', clair ? '#eef2f9' : '#0b1020');
  var b = document.getElementById('btnTheme');
  if (b) {
    // Le libelle annonce le mode d'arrivee, pas celui d'aujourd'hui.
    b.textContent = clair ? 'Sombre' : 'Clair';
    b.title = clair ? 'Passer en mode sombre' : 'Passer en mode clair';
  }
}

(function initBoutonTheme() {
  var b = document.getElementById('btnTheme');
  if (!b) return;
  appliquerTheme(localStorage.getItem('blamune_theme') || 'sombre');
  b.addEventListener('click', function () {
    var suivant = localStorage.getItem('blamune_theme') === 'clair' ? 'sombre' : 'clair';
    localStorage.setItem('blamune_theme', suivant);
    sauverProfilLocal('theme', suivant);
    appliquerTheme(suivant);
  });
})();

// ---------------- EXPORT DE L'HISTORIQUE ----------------
// Ce que tu as dit t'appartient. Un clic, et l'historique du mode courant
// (les 100 dernieres bulles que le serveur garde en affichage) part dans
// un fichier .txt lisible, telecharge LOCALEMENT : rien n'est renvoye
// nulle part, aucun compte, aucun service tiers.
function exporterHistorique() {
  fetch('/historique', { headers: authHeaders() })
    .then(function (r) {
      return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status));
    })
    .then(function (j) {
      var liste = (j && j.historique) || [];
      if (!liste.length) {
        afficherToastDeco('Rien a exporter : historique vide.');
        return;
      }
      var lignes = [
        'Historique BLAMUNE - exporte le ' + new Date().toLocaleString('fr-FR'),
        'Mode : ' +
          ((j.mode || '2') === '1' ? 'EGO' : 'BLAMUNE') +
          ' (les bulles affichees sont gardees cote serveur, 100 derniers echanges)',
        ''
      ];
      // Format fichier de l'historique : { qui: 'moi'|'bot', texte, t }
      // (t en secondes), identique pour les deux modes.
      for (var i = 0; i < liste.length; i++) {
        var m = liste[i] || {};
        var role = m.qui === 'moi' ? 'Toi' : (j.mode || '2') === '1' ? 'EGO' : 'BLAMUNE';
        var quand = m.t ? new Date(m.t * 1000).toLocaleString('fr-FR') : '';
        lignes.push('[' + quand + '] ' + role);
        lignes.push(String(m.texte || '').trim());
        lignes.push('');
      }
      var blob = new Blob([lignes.join('\n')], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'BLAMUNE-conversation-' + new Date().toISOString().substring(0, 10) + '.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        try {
          URL.revokeObjectURL(a.href);
        } catch (e) {}
      }, 1000);
      afficherToastDeco('Historique exporte : ' + liste.length + ' bulles.', 'ok');
    })
    .catch(function () {
      afficherToastDeco('Export impossible pour le moment.');
    });
}

(function initBoutonExport() {
  var b = document.getElementById('btnExport');
  if (!b) return;
  b.addEventListener('click', exporterHistorique);
})();

window.addEventListener('load', async function () {
  var profil = chargerProfilLocal();
  if (profil.mode === '3') {
    sauverProfilLocal('mode', '2');
  }
  // Theme DES LA PREMIERE SECONDE : l'ecran de connexion aussi est colore,
  // et on ne re-render pas au brusque passage sombre->clair au login.
  appliquerTheme(localStorage.getItem('blamune_theme') || 'sombre');
  // Avant la premiere requete : l'invite legacy echange son uid contre un
  // jeton, pour ne pas se faire refuser des la seconde appelee.
  try {
    await migrerJetonInvite();
  } catch (e) {}
  initAuth();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
});
