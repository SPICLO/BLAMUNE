// ====================================================================
//  Push.js - Gestion des notifications push pour la PWA BLAMUNE
// ====================================================================
'use strict';

(function () {
  'use strict';

  const AUTH_CLES = {
    pseudo: 'blamune_pseudo_auth'
  };

  const ETAT_NOTIF = {
    INACTIF: 'inactif',
    ATTENDANT: 'attendant',
    ACTIF: 'actif',
    ERREUR: 'erreur'
  };

  var etat = {
    abonne: false,
    token: null,
    abonnement: null,
    serie: 'mode2',
    intervalle: '1',
    statut: ETAT_NOTIF.INACTIF
  };

  var boutonActiver = document.getElementById('btnActiver');
  var boutonDeactiver = document.getElementById('btnDeactiver');
  var etatNotification = document.getElementById('etatNotifications');
  var etatTexte = document.getElementById('etatTexte');
  var etatWait = document.getElementById('etatWait');
  var etatWaitTexte = document.getElementById('waitTexte');
  var etatErreur = document.getElementById('etatErreur');
  var serieSelect = document.getElementById('serie');
  var intervalSelect = document.getElementById('interval');
  var journal = document.getElementById('journal');

  // ---------------- Diagnostics de base ----------------

  function supportPush() {
    return 'serviceWorker' in navigator && 'PushManager' in window;
  }

  function supportNotifications() {
    return 'Notification' in window;
  }

  function estConnecte() {
    return !!getAuthPseudo();
  }

  function getAuthPseudo() {
    return localStorage.getItem(AUTH_CLES.pseudo) || '';
  }

  // ---------------- Gestion du service worker ----------------

  function getPushManager() {
    return navigator.serviceWorker.ready.then(function (sw) {
      return sw.pushManager;
    });
  }

  // ---------------- Souscription ----------------

  // Cle publique VAPID de l'application, memorisee en localStorage par la
  // page (blamune_push_key) : cache local pour eviter une lecture par appel.
  var _clePubliqueStockee = '';

  function _clePublicAppServer() {
    if (!_clePubliqueStockee) {
      try {
        _clePubliqueStockee = localStorage.getItem('blamune_push_key');
      } catch (e) {}
    }
    return _clePubliqueStockee || '';
  }

  function souscrire() {
    if (!supportPush() || !supportNotifications()) {
      afficherErreur('Pas pris en charge par ce navigateur.');
      return;
    }
    if (!estConnecte()) {
      afficherErreur("Connectez-vous d'abord pour activer les notifications.");
      return;
    }

    boutonActiver.disabled = true;
    boutonActiver.classList.add('en-cours');

    getPushManager()
      .then(function (pm) {
        return pm.subscribe({
          userVisibleOnly: true,
          applicationServerKey: _clePublicAppServer()
        });
      })
      .then(function (sub) {
        etat.abonnement = sub;
        etat.token = sub.endpoint;
        etat.abonne = true;

        return fetch('/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: sub.endpoint,
            serie: serieSelect.value,
            intervalle: intervalSelect.value,
            pseudo: getAuthPseudo()
          })
        })
          .then(function (res) {
            if (!res.ok) {
              return res.json().then(function (e) {
                throw new Error(e.error || 'Erreur serveur');
              });
            }
            afficherJournal('Abonnement envoyé au serveur.');
            return res.json();
          })
          .then(function (data) {
            etat.statut = ETAT_NOTIF.ACTIF;
            afficherEtatActif(data);
          })
          .catch(function (e) {
            etat.statut = ETAT_NOTIF.ERREUR;
            afficherErreur(e.message || "Echec de l'abonnement");
            boutonActiver.disabled = false;
            boutonActiver.classList.remove('en-cours');
          });
      })
      .catch(function (e) {
        etat.statut = ETAT_NOTIF.ERREUR;
        afficherErreur("Impossible de s'abonner: " + e.message);
        boutonActiver.disabled = false;
        boutonActiver.classList.remove('en-cours');
      });
  }

  // ---------------- Affichage ----------------

  function afficherEtatActif(data) {
    etatNotification.style.display = 'block';
    etatWait.style.display = 'none';
    etatErreur.style.display = 'none';
    etatTexte.textContent = data.message || 'Actif';
    boutonActiver.textContent = 'Activé';
    boutonActiver.disabled = false;
    boutonActiver.classList.remove('en-cours');
    boutonDeactiver.disabled = false;
  }

  function afficherErreur(msg) {
    etatTexte.textContent = msg || 'Erreur inconnu.';
    etatNotification.style.display = 'block';
    etatWait.style.display = 'none';
    etatErreur.style.display = 'block';
    boutonActiver.disabled = false;
    boutonActiver.classList.remove('en-cours');
    boutonDeactiver.disabled = true;
  }

  function afficherAttente(msg) {
    etatNotification.style.display = 'block';
    etatWait.style.display = 'block';
    etatWaitTexte.textContent = msg || 'En attente...';
    etatErreur.style.display = 'none';
    etatTexte.textContent = '';
    boutonActiver.disabled = true;
    boutonActiver.classList.add('en-cours');
    boutonDeactiver.disabled = true;
  }

  // ---------------- Journal ----------------

  function afficherJournal(ligne) {
    if (!journal) return;
    var div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent =
      new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }) +
      ' | ' +
      ligne;
    journal.appendChild(div);
    journal.scrollTop = journal.scrollHeight;
  }

  // ---------------- Actions ----------------

  function activer() {
    if (etat.statut === ETAT_NOTIF.ACTIF) return;
    afficherAttente("Demarrage de l'abonnement...");
    souscrire();
  }

  function desactiver() {
    if (!etat.abonnement) return;
    if (etat.abonnement.unsubscribe) {
      etat.abonnement
        .unsubscribe()
        .then(function () {
          return fetch('/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: etat.token, pseudo: getAuthPseudo() })
          });
        })
        .catch(function (e) {
          console.warn('Erreur lors de la suppression:', e);
        });
    }

    etat.abonne = false;
    etat.token = null;
    etat.abonnement = null;
    etat.statut = ETAT_NOTIF.INACTIF;

    boutonActiver.textContent = 'Activer';
    boutonActiver.disabled = false;
    boutonActiver.classList.remove('en-cours');
    boutonDeactiver.disabled = true;
    etatNotification.style.display = 'block';
    etatWait.style.display = 'none';
    etatErreur.style.display = 'none';
    etatTexte.textContent = 'Désactivé';
  }

  // ---------------- Init ----------------

  function init() {
    if (journal) journal.innerHTML = '';

    try {
      var stockage = localStorage.getItem('blamune_notification');
      if (stockage) {
        try {
          etat = JSON.parse(stockage);
        } catch (e) {}
      }
    } catch (e) {}

    affichageEtatCourant();

    if (boutonActiver) {
      boutonActiver.addEventListener('click', activer);
    }
    if (boutonDeactiver) {
      boutonDeactiver.addEventListener('click', desactiver);
    }
    if (serieSelect) {
      serieSelect.addEventListener('change', function () {
        if (etat.statut === ETAT_NOTIF.ACTIF && etat.abonne) {
          fetch('/push/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serie: serieSelect.value,
              intervalle: intervalSelect.value,
              pseudo: getAuthPseudo()
            })
          })
            .then(function (r) {
              return r.json();
            })
            .then(function (d) {
              if (d.ok) {
                etat.serie = serieSelect.value;
                etat.intervalle = intervalSelect.value;
              } else {
                afficherErreur(d.error || 'Echec de la mise a jour');
              }
            })
            .catch(function (e) {
              afficherErreur('Erreur de la requete: ' + e.message);
            });
        }
      });
    }
    if (intervalSelect) {
      intervalSelect.addEventListener('change', function () {
        if (etat.statut === ETAT_NOTIF.ACTIF && etat.abonne) {
          fetch('/push/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serie: serieSelect.value,
              intervalle: intervalSelect.value,
              pseudo: getAuthPseudo()
            })
          })
            .then(function (r) {
              return r.json();
            })
            .then(function (d) {
              if (d.ok) {
                etat.intervalle = intervalSelect.value;
              } else {
                afficherErreur(d.error || 'Echec de la mise a jour');
              }
            });
        }
      });
    }
  }

  function affichageEtatCourant() {
    if (etat.statut === ETAT_NOTIF.ACTIF && etat.abonne) {
      afficherEtatActif({ ok: true, message: 'Actif' });
    } else if (etat.statut === ETAT_NOTIF.ERREUR) {
      afficherErreur(etatTexte.textContent || 'Erreur');
    } else if (etat.abonnement) {
      afficherEtatActif({ ok: true, message: 'Preparé' });
    } else {
      etatNotification.style.display = 'block';
      etatWait.style.display = 'none';
      etatErreur.style.display = 'none';
      etatTexte.textContent = 'Désactivé';
    }
  }

  // ---------------- Export ----------------

  var pushAPI = {
    activer: activer,
    desactiver: desactiver,
    init: init,
    etat: function () {
      return etat;
    },
    support: function () {
      return {
        push: 'serviceWorker' in navigator && 'PushManager' in window,
        notif: 'Notification' in window,
        auth: estConnecte()
      };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.pushAPI = pushAPI;
})();
