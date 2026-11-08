// Dashmin - Admin dashboard
var API = '';
var adminToken = null;
var adminPseudo = null;
var refreshInterval = null;
var dashboardInit = false;

// ---- LOGIN ----
(function () {
  var stored = localStorage.getItem('dashmin_token');
  var storedPseudo = localStorage.getItem('dashmin_pseudo');
  var storedTime = localStorage.getItem('dashmin_time');
  if (stored && storedTime && Date.now() - parseInt(storedTime) > 86400000) {
    localStorage.removeItem('dashmin_token');
    localStorage.removeItem('dashmin_pseudo');
    localStorage.removeItem('dashmin_time');
    stored = null;
  }
  if (stored && storedPseudo) {
    adminToken = stored;
    adminPseudo = storedPseudo;
    document.getElementById('loginScreen').classList.add('masquee');
    document.getElementById('dashboard').classList.remove('masquee');
    initDashboard();
  } else {
    document.getElementById('loginScreen').classList.remove('masquee');
    document.getElementById('dashboard').classList.add('masquee');
  }
})();

document.getElementById('loginAdminForm').onsubmit = async function (e) {
  e.preventDefault();
  var pseudo = document.getElementById('loginPseudo').value.trim();
  var mdp = document.getElementById('loginMdp').value;
  var errEl = document.getElementById('loginErreur');
  var btn = document.querySelector('#loginAdminForm button[type="submit"]');
  errEl.classList.add('masquee');
  if (!pseudo || !mdp) {
    errEl.textContent = 'Remplis tous les champs.';
    errEl.classList.remove('masquee');
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Connexion...';
  }
  try {
    var r = await fetch(API + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'pseudo=' + encodeURIComponent(pseudo) + '&mdp=' + encodeURIComponent(mdp)
    });
    var j = await r.json();
    if (j.ok) {
      if (j.pseudo !== 'admin') {
        errEl.textContent = "Ce compte n'est pas admin.";
        errEl.classList.remove('masquee');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Se connecter';
        }
        return;
      }
      adminToken = j.ego;
      adminPseudo = j.pseudo;
      localStorage.setItem('dashmin_token', adminToken);
      localStorage.setItem('dashmin_pseudo', adminPseudo);
      localStorage.setItem('dashmin_time', Date.now().toString());
      document.getElementById('loginScreen').classList.add('masquee');
      document.getElementById('dashboard').classList.remove('masquee');
      initDashboard();
    } else {
      errEl.textContent = j.message || 'Identifiants incorrects.';
      errEl.classList.remove('masquee');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Se connecter';
      }
    }
  } catch (ex) {
    errEl.textContent = 'Erreur de connexion au serveur.';
    errEl.classList.remove('masquee');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Se connecter';
    }
  }
};

function initDashboard() {
  if (!dashboardInit) {
    document.getElementById('btnRefresh').onclick = chargerDonnees;
    document.getElementById('btnReload').onclick = function () {
      window.location.reload();
    };
    document.getElementById('btnLogout').onclick = function () {
      localStorage.removeItem('dashmin_token');
      localStorage.removeItem('dashmin_pseudo');
      localStorage.removeItem('dashmin_time');
      if (refreshInterval) clearInterval(refreshInterval);
      dashboardInit = false;
      window.location.reload();
    };
    document.getElementById('btnChangeMdp').onclick = async function () {
      var input = document.getElementById('nouveauMdp');
      var msgEl = document.getElementById('mdpMessage');
      var btn = this;
      var mdp = input.value.trim();
      if (!mdp || mdp.length < 8) {
        msgEl.textContent = '8 caracteres minimum.';
        msgEl.style.color = 'var(--danger)';
        return;
      }
      btn.disabled = true;
      msgEl.textContent = 'En cours...';
      msgEl.style.color = 'var(--texte-doux)';
      try {
        var r = await fetch(API + '/admin/change-mdp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-EGO': adminToken },
          body: 'nouveau_mdp=' + encodeURIComponent(mdp)
        });
        var j = await r.json();
        if (j.ok) {
          msgEl.textContent = 'Mot de passe change !';
          msgEl.style.color = 'var(--ok)';
          input.value = '';
        } else {
          msgEl.textContent = j.message || 'Erreur.';
          msgEl.style.color = 'var(--danger)';
        }
      } catch (e) {
        msgEl.textContent = 'Erreur reseau.';
        msgEl.style.color = 'var(--danger)';
      }
      btn.disabled = false;
    };
    document.getElementById('btnBackup').onclick = async function () {
      var msg = document.getElementById('backupMessage');
      var btn = this;
      btn.disabled = true;
      msg.style.color = 'var(--texte-doux)';
      msg.textContent = 'Preparation...';
      try {
        var r = await fetch(API + '/admin/backup', { headers: { 'X-EGO': adminToken } });
        if (!r.ok) {
          var j = null;
          try {
            j = await r.json();
          } catch (e) {}
          msg.style.color = 'var(--danger)';
          msg.textContent = (j && j.message) || 'Erreur ' + r.status;
          return;
        }
        var blob = await r.blob();
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'blamune-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
        }, 5000);
        msg.style.color = 'var(--ok)';
        msg.textContent = 'Sauvegarde telechargee.';
      } catch (e) {
        msg.style.color = 'var(--danger)';
        msg.textContent = 'Erreur reseau.';
      }
      btn.disabled = false;
    };
    document.getElementById('btnRestore').onclick = function () {
      document.getElementById('fichierRestore').click();
    };
    document.getElementById('fichierRestore').onchange = async function () {
      var fichier = this.files && this.files[0];
      this.value = '';
      if (!fichier) return;
      var msg = document.getElementById('backupMessage');
      if (
        !window.confirm(
          'Restaurer cette sauvegarde ? Les fichiers actuels seront remplaces par ceux du fichier.'
        )
      )
        return;
      msg.style.color = 'var(--texte-doux)';
      msg.textContent = 'Restauration...';
      try {
        var texte = await fichier.text();
        var donnees = JSON.parse(texte);
        var r = await fetch(API + '/admin/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-EGO': adminToken },
          body: JSON.stringify(donnees)
        });
        var out = null;
        try {
          out = await r.json();
        } catch (e) {}
        if (r.ok && out && out.ok) {
          msg.style.color = 'var(--ok)';
          msg.textContent = 'Restauration reussie : ' + out.fichiers + ' fichier(s).';
          chargerDonnees();
        } else {
          msg.style.color = 'var(--danger)';
          msg.textContent = (out && out.message) || 'Erreur ' + r.status;
        }
      } catch (e) {
        msg.style.color = 'var(--danger)';
        msg.textContent = 'Fichier invalide.';
      }
    };
    // Enregistrer un fait depuis le panneau (phase 3, P3-6) : c'est la fin
    // du parcours "un 👎 -> une correction". Le fait arrive dans SQLite (la
    // source de verite) et sert des le message suivant, sans deploy.
    var btnMettre = document.getElementById('btnSavoirMettre');
    if (btnMettre) {
      btnMettre.onclick = async function () {
        var elCle = document.getElementById('savoirMettreCle');
        var elRep = document.getElementById('savoirMettreReponse');
        var elMsg = document.getElementById('savoirMettreMessage');
        var cle = elCle ? elCle.value.trim() : '';
        var reponse = elRep ? elRep.value.trim() : '';
        if (!cle || !reponse) {
          if (elMsg) {
            elMsg.textContent = 'Cle et reponse obligatoires.';
            elMsg.style.color = 'var(--danger)';
          }
          return;
        }
        btnMettre.disabled = true;
        try {
          var r = await fetch(API + '/admin/savoir/mettre', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-EGO': adminToken },
            body: JSON.stringify({ cle: cle, reponse: reponse })
          });
          var out = null;
          try {
            out = await r.json();
          } catch (e) {}
          if (elMsg) {
            elMsg.style.color = r.ok && out && out.ok ? 'var(--ok)' : 'var(--danger)';
            elMsg.textContent =
              r.ok && out && out.ok
                ? 'Fait enregistre.'
                : (out && out.message) || 'Erreur ' + r.status;
          }
          if (r.ok && elRep) elRep.value = '';
        } catch (e) {
          if (elMsg) {
            elMsg.textContent = 'Erreur reseau.';
            elMsg.style.color = 'var(--danger)';
          }
        }
        btnMettre.disabled = false;
      };
    }
    dashboardInit = true;
  }
  chargerDonnees();
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(chargerDonnees, 30000);
}

// Valide ou supprime un fait propose par un invite (phase 3, P3-5).
// Une seule issue serveur au refus possible : l'erreur est affichee DANS la
// ligne, la file reste en place (on ne recharge pas une page pour montrer
// qu'une ecriture a echoue).
async function traiterProposition(route, cle, ligne) {
  var boutons = ligne.getElementsByTagName('button');
  for (var i = 0; i < boutons.length; i++) boutons[i].disabled = true;
  try {
    var r = await fetch(API + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EGO': adminToken },
      body: JSON.stringify({ cle: cle })
    });
    if (r.ok) {
      ligne.remove();
      return;
    }
    var out = null;
    try {
      out = await r.json();
    } catch (e) {}
    var err = document.createElement('div');
    err.style.color = 'var(--danger)';
    err.textContent = (out && out.message) || 'Erreur ' + r.status;
    ligne.appendChild(err);
  } catch (e) {
    var errR = document.createElement('div');
    errR.style.color = 'var(--danger)';
    errR.textContent = 'Erreur reseau.';
    ligne.appendChild(errR);
  }
  for (var j = 0; j < boutons.length; j++) boutons[j].disabled = false;
}

// Verdict du niveau STABLE du cache (P3-2), dit en clair : "utile",
// "a supprimer dans N jours" ou "a supprimer maintenant".
function gprTexte(o) {
  if (!o) return '';
  if (o.verdict === 'utile') return '   |   utile';
  if (o.verdict === 'aSupprimer') return '   |   A SUPPRIMER (0 coup en 14 jours)';
  return '   |   fenetre : ' + (o.reste || 0) + ' jour(s) restant(s)';
}

function setSectionErreur(id, msg) {
  var el = document.getElementById(id);
  if (el) {
    el.replaceChildren();
    var p = document.createElement('p');
    p.className = 'vide';
    p.textContent = msg;
    el.appendChild(p);
  }
}

function afficherErreur(msg) {
  document.getElementById('uptime').textContent = msg;
  setSectionErreur('connexionsContenu', msg);
  setSectionErreur('inscritsContenu', msg);
  setSectionErreur('tousMessagesContenu', msg);
  setSectionErreur('profilContenu', msg);
  setSectionErreur('savoirContenu', msg);
  setSectionErreur('savoirAttente', msg);
  setSectionErreur('avisContenu', msg);
  setSectionErreur('vocabContenu', msg);
  setSectionErreur('configContenu', msg);
  var bann = document.getElementById('alerteBanniere');
  if (bann) {
    bann.style.display = 'none';
    bann.textContent = '';
  }
}

// Duree lisible depuis une date ISO ("12 s", "4 min", "2 h").
function depuis(iso) {
  var s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (!isFinite(s)) return '?';
  if (s < 60) return s + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  return Math.floor(s / 86400) + ' j';
}

// Banniere rouge quand tout casse (quota / plus aucun modele) : l'info arrive
// sur le dashboard au lieu de rester enfouie dans /admin/logs.
function afficherAlertes(j) {
  var bann = document.getElementById('alerteBanniere');
  if (!bann) return;
  var al = j.alertes || {};
  var texte = '';
  if (al.quota) {
    texte =
      'ALERTE QUOTA : tous les modeles satur\u00e9s depuis ' +
      depuis(al.quota.debut) +
      ' (' +
      (al.quota.compteur || 1) +
      ' fois)';
  } else if (al.technique) {
    texte = 'ALERTE MODELE : plus aucune reponse depuis ' + depuis(al.technique.debut);
  } else if (
    al.derniereResolution &&
    Date.now() - Date.parse(al.derniereResolution.fin) < 86400000
  ) {
    texte =
      'Incident ' +
      (al.derniereResolution.type === 'quota' ? 'quota' : 'modele') +
      ' resolu a ' +
      new Date(al.derniereResolution.fin).toLocaleTimeString('fr-FR');
  }
  var alerteActive = !!(al.quota || al.technique);
  bann.className = 'banniere-alerte' + (alerteActive ? '' : ' banniere-ok');
  bann.style.display = texte ? 'block' : 'none';
  bann.textContent = texte;
}

// Retour discret de la section inscrits (suppression de compte, etc.).
function messageInscrits(texte, danger) {
  var z = document.getElementById('inscritsMessage');
  if (!z) return;
  z.textContent = texte;
  z.style.display = 'block';
  z.style.color = danger ? 'var(--danger)' : 'var(--ok)';
}

// Suppression d'un compte : destructive et definitive (memoire, resumes,
// historiques, profil, copie cloud). Vise les comptes de test et les
// faux comptes ; les comptes admin sont refuses cote serveur.
async function supprimerCompte(uid, pseudo, btn) {
  var certain = window.confirm(
    'Supprimer le compte "' +
      pseudo +
      '" ?\n\nMemoire, resumes, historiques et profil seront effaces (cloud inclus). Definitif.'
  );
  if (!certain) return;
  btn.disabled = true;
  btn.textContent = '...';
  try {
    var r = await fetch(API + '/admin/supprimer-compte', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EGO': adminToken },
      body: JSON.stringify({ uid: uid })
    });
    var j = await r.json().catch(function () {
      return { ok: false, message: 'Reponse invalide du serveur' };
    });
    if (r.status === 403 || r.status === 401) {
      messageInscrits('Non autorise (session admin expiree ?).', true);
      btn.disabled = false;
      btn.textContent = 'Supprimer';
      return;
    }
    if (j.ok) {
      chargerDonnees();
      messageInscrits(j.message || 'Compte supprime.', false);
    } else {
      messageInscrits(j.message || 'Suppression impossible.', true);
      btn.disabled = false;
      btn.textContent = 'Supprimer';
    }
  } catch (ex) {
    messageInscrits('Erreur serveur pendant la suppression.', true);
    btn.disabled = false;
    btn.textContent = 'Supprimer';
  }
}

async function chargerDonnees() {
  var btn = document.getElementById('btnRefresh');
  if (btn) btn.disabled = true;
  var inscritsMsgEl = document.getElementById('inscritsMessage');
  if (inscritsMsgEl) inscritsMsgEl.style.display = 'none';
  try {
    var headers = {};
    if (adminToken) {
      headers['X-EGO'] = adminToken;
    }
    var r = await fetch(API + '/admin/data', { headers: headers });
    if (!r.ok) {
      if (r.status === 403 || r.status === 401) {
        localStorage.removeItem('dashmin_token');
        localStorage.removeItem('dashmin_pseudo');
        localStorage.removeItem('dashmin_time');
        if (refreshInterval) clearInterval(refreshInterval);
        dashboardInit = false;
        window.location.reload();
        return;
      }
      afficherErreur('Erreur serveur (HTTP ' + r.status + ')');
      return;
    }
    var j;
    try {
      j = await r.json();
    } catch (e) {
      afficherErreur('Reponse invalide du serveur');
      return;
    }
    if (!j.ok) {
      afficherErreur('Erreur serveur');
      return;
    }

    // Stats
    var s = j.stats || {};
    document.getElementById('statMessages').textContent = s.messagesTotal || 0;
    document.getElementById('statSessions').textContent = s.sessionsTotal || 0;
    document.getElementById('statDemarrages').textContent = s.demarrages || 0;
    document.getElementById('statTemps').textContent = (s.tempsMoyen || 0) + 'ms';
    document.getElementById('uptime').textContent = 'Demarre le ' + (s.demarrage || '?');

    // Modele qui repond vraiment + alertes quota/modele
    var md = j.modele || {};
    var elModele = document.getElementById('statModele');
    if (elModele) elModele.textContent = md.actif || md.principal || '-';
    afficherAlertes(j);

    // Gardiens anti-saturation (file de concurrence, tension 429 / eco,
    // cache recherche) : lecture seule, aucune action ici.
    var g = j.gardiens || {};
    var gc = g.concurrence || {};
    var gt = g.tension || {};
    var gcr = g.cacheRecherche || {};
    var gpg = g.plafondGlobal || {};
    var gpt = g.cacheReponses || {};
    var elGardiens = document.getElementById('gardiensContenu');
    if (elGardiens) {
      elGardiens.replaceChildren();
      var lignesG = [
        'Appels IA en cours : ' +
          (gc.enCours || 0) +
          ' / ' +
          (gc.max || '?') +
          '   |   File d attente : ' +
          (gc.file || 0) +
          '   |   Debordements aujourd hui : ' +
          (gc.debordementsJour || 0) +
          ' (total ' +
          (gc.debordements || 0) +
          ')',
        '429 quota : ' +
          (gt.nb429Fenetre || 0) +
          ' dans la fenetre de ' +
          Math.round((gt.fenetreMs || 300000) / 60000) +
          ' min' +
          '   |   Aujourd hui : ' +
          (gt.nb429Jour || 0) +
          '   |   Eco ' +
          (gt.eco ? 'ACTIF' : 'inactif') +
          (gt.eco && gt.cause ? '(' + gt.cause + ')' : '') +
          (gt.entrees && (gt.entrees.debordements || gt.entrees.file)
            ? '   |   Entrees eco depuis le demarrage : 429=' +
              (gt.entrees['429'] || 0) +
              ' debordements=' +
              (gt.entrees.debordements || 0) +
              ' file=' +
              (gt.entrees.file || 0)
            : '') +
          (gt.tachesSuspendues ? '   |   Taches de fond suspendues : ' + gt.tachesSuspendues : ''),
        'Cache recherche : ' +
          (gcr.entrees || 0) +
          ' sujet(s) en memoire' +
          (gcr.coupsCache || gcr.raterCache
            ? '   |   Deja servis du cache : ' +
              (gcr.coupsCache || 0) +
              ' sur ' +
              ((gcr.coupsCache || 0) + (gcr.raterCache || 0)) +
              ' recherches'
            : ''),
        'Plafond global /h : ' +
          (gpg.dansFenetre || 0) +
          ' / ' +
          (gpg.maxHeure || '?') +
          ' messages' +
          (gpg.refusJour || gpg.refus
            ? '   |   Refus aujourd hui : ' +
              (gpg.refusJour || 0) +
              ' (total ' +
              (gpg.refus || 0) +
              ')'
            : ''),
        'Cache reponses (small talk sans appel IA) : ' +
          (gpt.entrees || 0) +
          ' entree(s)' +
          (gpt.coups || gpt.rater
            ? '   |   Servies sans modele : ' +
              (gpt.coups || 0) +
              ' / ' +
              ((gpt.coups || 0) + (gpt.rater || 0)) +
              ' messages'
            : ''),
        // Deux niveaux mesures SEPAREMENT (P3-2) : stable = question sans
        // contexte ("bonjour"), contextuel = meme question apres le meme
        // message du bot. Le verdict est la decision du proprietaire, dite
        // avant l'echeance et pas apres.
        'Cache stable (questions sans contexte) : ' +
          (gpt.coupsStable || 0) +
          ' coup(s)' +
          gprTexte(gpt.observation),
        'Cache contextuel : ' + (gpt.coupsContextuel || 0) + ' coup(s)'
      ];
      lignesG.forEach(function (texte) {
        var p = document.createElement('p');
        p.textContent = texte;
        p.style.margin = '4px 0';
        elGardiens.appendChild(p);
      });
    }

    // Utilisateurs en ligne
    var connexions = j.connexions || [];
    document.getElementById('statEnLigne').textContent = connexions.length;

    // Utilisateurs inscrits
    var rUsers = await fetch(API + '/admin/users', { headers: headers });
    var jUsers = rUsers.ok ? await rUsers.json() : { users: [] };
    var users = jUsers.users || [];
    document.getElementById('statUtilisateurs').textContent = users.length;

    // Inscrits
    var inscritsEl = document.getElementById('inscritsContenu');
    inscritsEl.replaceChildren();
    document.getElementById('inscritsCount').textContent = '(' + users.length + ')';
    if (users.length === 0) {
      var pVideU = document.createElement('p');
      pVideU.className = 'vide';
      pVideU.textContent = 'Aucun utilisateur inscrit.';
      inscritsEl.appendChild(pVideU);
    } else {
      var tableU = document.createElement('table');
      tableU.style.width = '100%';
      tableU.style.borderCollapse = 'collapse';
      var theadU = document.createElement('thead');
      var trHU = document.createElement('tr');
      ['Pseudo', 'Email', 'Date', 'Msg', 'Action'].forEach(function (txt) {
        var th = document.createElement('th');
        th.style.cssText =
          'text-align:left;padding:8px;border-bottom:1px solid var(--bordure);color:var(--texte-doux);font-size:12px;';
        th.textContent = txt;
        trHU.appendChild(th);
      });
      theadU.appendChild(trHU);
      tableU.appendChild(theadU);
      var tbodyU = document.createElement('tbody');
      users.forEach(function (u) {
        var tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--bordure)';
        var tdPseudo = document.createElement('td');
        tdPseudo.style.cssText = 'padding:8px;color:var(--texte);font-weight:600;';
        tdPseudo.textContent = u.pseudo || '-';
        var tdEmail = document.createElement('td');
        tdEmail.style.cssText = 'padding:8px;color:var(--accent);font-size:13px;';
        tdEmail.textContent = u.email ? u.email.replace(/^(.)(.*?)(@.*)$/, '$1***$3') : '-';
        var tdCree = document.createElement('td');
        tdCree.style.cssText = 'padding:8px;color:var(--texte-doux);font-size:12px;';
        tdCree.textContent = u.cree || '-';
        var tdMsg = document.createElement('td');
        tdMsg.style.cssText =
          'padding:8px;color:var(--texte-doux);font-size:12px;text-align:right;';
        tdMsg.textContent = u.messages || 0;
        var tdDel = document.createElement('td');
        tdDel.style.cssText = 'padding:4px 8px;text-align:right;';
        var btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.textContent = 'Supprimer';
        btnDel.style.cssText =
          'font-size:11px;color:var(--danger);background:transparent;border:1px solid var(--danger);border-radius:6px;padding:3px 8px;cursor:pointer;';
        btnDel.onclick = function () {
          supprimerCompte(u.uid || '', u.pseudo || '-', btnDel);
        };
        tdDel.appendChild(btnDel);
        tr.appendChild(tdPseudo);
        tr.appendChild(tdEmail);
        tr.appendChild(tdCree);
        tr.appendChild(tdMsg);
        tr.appendChild(tdDel);
        tbodyU.appendChild(tr);
      });
      tableU.appendChild(tbodyU);
      inscritsEl.appendChild(tableU);
    }

    // Connexions actives
    var connEl = document.getElementById('connexionsContenu');
    connEl.replaceChildren();
    document.getElementById('connexionsCount').textContent = '(' + connexions.length + ')';
    if (connexions.length === 0) {
      var pVideC = document.createElement('p');
      pVideC.className = 'vide';
      pVideC.textContent = 'Aucune connexion active.';
      connEl.appendChild(pVideC);
    } else {
      var tableC = document.createElement('table');
      tableC.style.width = '100%';
      tableC.style.borderCollapse = 'collapse';
      var theadC = document.createElement('thead');
      var trHC = document.createElement('tr');
      ['Pseudo', 'UID', 'Debut'].forEach(function (txt) {
        var th = document.createElement('th');
        th.style.cssText =
          'text-align:left;padding:8px;border-bottom:1px solid var(--bordure);color:var(--texte-doux);font-size:12px;';
        th.textContent = txt;
        trHC.appendChild(th);
      });
      theadC.appendChild(trHC);
      tableC.appendChild(theadC);
      var tbodyC = document.createElement('tbody');
      connexions.forEach(function (c) {
        var tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--bordure)';
        var tdP = document.createElement('td');
        tdP.style.cssText = 'padding:8px;color:var(--texte);font-weight:600;';
        tdP.textContent = c.pseudo || c.uid || '?';
        var tdU = document.createElement('td');
        tdU.style.cssText = 'padding:8px;color:var(--accent);font-size:12px;font-family:monospace;';
        tdU.textContent = c.uid || '-';
        var tdD = document.createElement('td');
        tdD.style.cssText = 'padding:8px;color:var(--texte-doux);font-size:12px;';
        tdD.textContent = c.debut ? new Date(c.debut).toLocaleString('fr-FR') : '-';
        tr.appendChild(tdP);
        tr.appendChild(tdU);
        tr.appendChild(tdD);
        tbodyC.appendChild(tr);
      });
      tableC.appendChild(tbodyC);
      connEl.appendChild(tableC);
    }

    // Messages (limite a 50)
    var messages = j.messages || [];
    var msgEl = document.getElementById('tousMessagesContenu');
    msgEl.replaceChildren();
    var totalMsg = messages.length;
    document.getElementById('tousMessagesCount').textContent = '(' + totalMsg + ')';
    if (totalMsg === 0) {
      var pVideM = document.createElement('p');
      pVideM.className = 'vide';
      pVideM.textContent = 'Aucun message.';
      msgEl.appendChild(pVideM);
    } else {
      var afficher = messages.slice(-50).reverse();
      var tableM = document.createElement('table');
      tableM.style.width = '100%';
      tableM.style.borderCollapse = 'collapse';
      var theadM = document.createElement('thead');
      var trHM = document.createElement('tr');
      ['Heure', 'Qui', 'Message', 'Reponse'].forEach(function (txt) {
        var th = document.createElement('th');
        th.style.cssText =
          'text-align:left;padding:8px;border-bottom:1px solid var(--bordure);color:var(--texte-doux);font-size:12px;';
        th.textContent = txt;
        trHM.appendChild(th);
      });
      theadM.appendChild(trHM);
      tableM.appendChild(theadM);
      var tbodyM = document.createElement('tbody');
      afficher.forEach(function (m) {
        var tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--bordure)';
        var tdH = document.createElement('td');
        tdH.style.cssText =
          'padding:8px;color:var(--texte-doux);font-size:11px;white-space:nowrap;';
        tdH.textContent = m.heure || '-';
        var tdP = document.createElement('td');
        tdP.style.cssText =
          'padding:8px;color:var(--texte);font-weight:600;font-size:12px;white-space:nowrap;';
        tdP.textContent = m.pseudo || m.uid || '?';
        var tdMsg = document.createElement('td');
        tdMsg.style.cssText =
          'padding:8px;color:var(--texte);font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        tdMsg.textContent = m.message || '';
        var tdR = document.createElement('td');
        tdR.style.cssText =
          'padding:8px;color:var(--accent);font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        tdR.textContent = m.reponse || '';
        tr.appendChild(tdH);
        tr.appendChild(tdP);
        tr.appendChild(tdMsg);
        tr.appendChild(tdR);
        tbodyM.appendChild(tr);
      });
      tableM.appendChild(tbodyM);
      msgEl.appendChild(tableM);
      if (totalMsg > 50) {
        var pLimite = document.createElement('p');
        pLimite.className = 'vide';
        pLimite.textContent = 'Affichage des 50 derniers sur ' + totalMsg + ' messages.';
        pLimite.style.marginTop = '8px';
        msgEl.appendChild(pLimite);
      }
    }

    // Profil
    var profil = j.profil || {};
    var profilEl = document.getElementById('profilContenu');
    profilEl.replaceChildren();
    var profilChamps = [
      ['Nom', profil.nom || '-'],
      ['Age', profil.age || '-'],
      ['Genre', profil.genre || '-'],
      ['Ville', profil.ville || '-'],
      ['Travail / etudes', profil.travail || '-'],
      ['Plat prefere', profil.plat || '-'],
      ['Hobby', profil.hobby || '-'],
      ['Sport', profil.sport || '-'],
      ['Musique', profil.musique || '-'],
      ['Serie / film / jeu', profil.serie || '-'],
      ['Reve / objectif', profil.reve || '-'],
      ['Aime', profil.aime || '-'],
      ['Aime pas', profil.aimePas || '-'],
      ['Mots favoris', (profil.motsFavoris || []).join(', ') || '-'],
      ['Humeur de BLAMUNE', profil.humeur || 'neutre'],
      ["Humeur de l'utilisateur", profil.humeurUser || 'inconnue']
    ];
    profilChamps.forEach(function (c) {
      var d = document.createElement('div');
      d.className = 'profil-item';
      var k = document.createElement('span');
      k.className = 'cle';
      k.textContent = c[0];
      var val = document.createElement('span');
      val.className = 'valeur' + (c[1] && c[1] !== '-' ? '' : ' vide');
      val.textContent = c[1];
      d.appendChild(k);
      d.appendChild(val);
      profilEl.appendChild(d);
    });

    // Savoir (limite a 100)
    var savoir = j.savoir || [];
    var savoirEl = document.getElementById('savoirContenu');
    savoirEl.replaceChildren();
    document.getElementById('savoirCount').textContent = '(' + savoir.length + ')';
    if (savoir.length === 0) {
      var pVide3 = document.createElement('p');
      pVide3.className = 'vide';
      pVide3.textContent = 'Aucune connaissance memorisee.';
      savoirEl.appendChild(pVide3);
    } else {
      var afficherSavoir = savoir.slice(0, 100);
      afficherSavoir.forEach(function (s) {
        var d = document.createElement('div');
        d.style.cssText = 'padding:8px;border-bottom:1px solid var(--bordure);font-size:13px;';
        var topic = document.createElement('strong');
        topic.style.color = 'var(--accent)';
        topic.textContent = (s.topic || '?') + ' : ';
        d.appendChild(topic);
        var cont = document.createElement('span');
        cont.textContent = s.contenu || '-';
        d.appendChild(cont);
        savoirEl.appendChild(d);
      });
      if (savoir.length > 100) {
        var pLimite2 = document.createElement('p');
        pLimite2.className = 'vide';
        pLimite2.textContent =
          'Affichage des 100 premiers sur ' + savoir.length + ' connaissances.';
        pLimite2.style.marginTop = '8px';
        savoirEl.appendChild(pLimite2);
      }
    }

    // File de validation du savoir (phase 3, P3-5) : un invite peut PROPOSER
    // un fait via /savoir ; rien n'est servi avant l'accord d'un humain.
    // On montre ici le texte exact propose, avec les deux seules issues :
    // valider (le fait rejoint le savoir partage) ou supprimer (il disparait).
    try {
      var rAtt = await fetch(API + '/admin/savoir', { headers: headers });
      var jAtt = rAtt.ok ? await rAtt.json() : { enAttente: [] };
      var attEl = document.getElementById('savoirAttente');
      var attCountEl = document.getElementById('savoirAttenteCount');
      if (attCountEl) attCountEl.textContent = '(' + (jAtt.enAttenteTotal || 0) + ' en attente)';
      if (attEl) {
        attEl.replaceChildren();
        var proposes = jAtt.enAttente || [];
        if (proposes.length === 0) {
          var pVideAtt = document.createElement('p');
          pVideAtt.className = 'vide';
          pVideAtt.textContent = 'Aucun fait propose en attente.';
          attEl.appendChild(pVideAtt);
        }
        proposes.forEach(function (f) {
          var d = document.createElement('div');
          d.style.cssText = 'padding:8px;border-bottom:1px solid var(--bordure);font-size:13px;';
          var topic = document.createElement('strong');
          topic.style.color = 'var(--accent)';
          topic.textContent = (f.cle || '?') + ' : ';
          var cont = document.createElement('span');
          cont.textContent = f.reponse || '-';
          var src = document.createElement('span');
          src.className = 'vide';
          src.style.marginLeft = '6px';
          src.textContent = '(' + (f.source || '?') + ')';
          var bOk = document.createElement('button');
          bOk.type = 'button';
          bOk.textContent = 'Valider';
          bOk.style.margin = '0 4px';
          var bNo = document.createElement('button');
          bNo.type = 'button';
          bNo.textContent = 'Supprimer';
          var ligne = document.createElement('div');
          ligne.appendChild(topic);
          ligne.appendChild(cont);
          ligne.appendChild(src);
          var barre = document.createElement('div');
          barre.style.marginTop = '6px';
          barre.appendChild(bOk);
          barre.appendChild(bNo);
          d.appendChild(ligne);
          d.appendChild(barre);
          bOk.onclick = function () {
            traiterProposition('/admin/savoir/valider', f.cle, d);
          };
          bNo.onclick = function () {
            traiterProposition('/admin/savoir/supprimer', f.cle, d);
          };
          attEl.appendChild(d);
        });
      }
    } catch (e) {}

    // Avis des visiteurs (phase 3, P3-6) : les 👎 sont une file de travail,
    // pas un chiffre. "Corriger" pre-remplit le savoir avec la reponse
    // jugee ; "Ignorer" ferme l'avis (traite).
    try {
      var rAvis = await fetch(API + '/admin/avis', { headers: headers });
      var jAvis = rAvis.ok ? await rAvis.json() : { derniers: [] };
      var avisEl = document.getElementById('avisContenu');
      var avisCountEl = document.getElementById('avisCount');
      if (avisEl) {
        avisEl.replaceChildren();
        var baisse = (jAvis.derniers || []).filter(function (a) {
          return a.avis === 'down';
        });
        if (avisCountEl)
          avisCountEl.textContent =
            '(' + baisse.length + ' 👎, ' + (jAvis.enAttente || 0) + ' a traiter)';
        var enTete = document.createElement('p');
        enTete.className = 'vide';
        enTete.textContent =
          '👍 ' +
          ((jAvis.counters && jAvis.counters.haute) || 0) +
          '   ·   👎 ' +
          ((jAvis.counters && jAvis.counters.basse) || 0) +
          '   ·   ' +
          (jAvis.enAttente || 0) +
          ' 👎 des 7 derniers jours restent a traiter.';
        avisEl.appendChild(enTete);
        if (baisse.length === 0) {
          var pVideA = document.createElement('p');
          pVideA.className = 'vide';
          pVideA.textContent = 'Aucun avis negatif. Bonne nouvelle.';
          avisEl.appendChild(pVideA);
        }
        baisse.slice(0, 30).forEach(function (a) {
          var bloc = document.createElement('div');
          bloc.style.cssText =
            'padding:8px;border-bottom:1px solid var(--bordure);font-size:13px;' +
            (a.traite ? 'opacity:.55;' : '');
          var quand = document.createElement('span');
          quand.style.cssText = 'color:var(--texte-doux);font-size:11px;margin-right:8px;';
          quand.textContent = a.t ? new Date(a.t).toLocaleString('fr-FR') : '-';
          var q = document.createElement('div');
          q.style.color = 'var(--texte)';
          q.textContent = 'Visiteur : ' + (a.msg || '(sans texte)').substring(0, 200);
          var rp = document.createElement('div');
          rp.style.cssText = 'color:var(--accent);margin:4px 0;';
          rp.textContent = 'BLAMUNE : ' + (a.reponse || '').substring(0, 400);
          var bCorr = document.createElement('button');
          bCorr.type = 'button';
          bCorr.textContent = 'Corriger dans le savoir';
          bCorr.style.cssText =
            'font-size:11px;margin-right:6px;background:transparent;border:1px solid var(--accent);color:var(--accent);border-radius:6px;padding:3px 8px;cursor:pointer;';
          bCorr.onclick = function () {
            var tap = document.getElementById('savoirMettreCle');
            var trep = document.getElementById('savoirMettreReponse');
            if (tap) tap.value = (a.msg || '').substring(0, 100);
            if (trep) trep.value = '';
            if (tap) tap.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (trep) trep.focus();
          };
          var bIgn = document.createElement('button');
          bIgn.type = 'button';
          bIgn.textContent = a.traite ? 'Rouvrir' : 'Ignorer';
          bIgn.style.cssText =
            'font-size:11px;background:transparent;border:1px solid var(--bordure);color:var(--texte-doux);border-radius:6px;padding:3px 8px;cursor:pointer;';
          bIgn.onclick = async function () {
            bIgn.disabled = true;
            try {
              await fetch(API + '/admin/avis/traiter', {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
                body: JSON.stringify({ t: a.t, traite: !a.traite })
              });
            } catch (e) {}
            chargerDonnees();
          };
          bloc.appendChild(quand);
          bloc.appendChild(q);
          bloc.appendChild(rp);
          bloc.appendChild(bCorr);
          bloc.appendChild(bIgn);
          avisEl.appendChild(bloc);
        });
      }
    } catch (eAvis) {
      /* section cosmetique : jamais bloquante pour le reste du panneau */
    }

    // Vocabulaire (limite a 100)
    var vocab = j.vocabulaire || [];
    var vocabEl = document.getElementById('vocabContenu');
    vocabEl.replaceChildren();
    document.getElementById('vocabCount').textContent = '(' + vocab.length + ')';
    if (vocab.length === 0) {
      var pVide4 = document.createElement('p');
      pVide4.className = 'vide';
      pVide4.textContent = 'Aucun vocabulaire memorise.';
      vocabEl.appendChild(pVide4);
    } else {
      var tags = document.createElement('div');
      tags.className = 'vocab-tags';
      var afficherVocab = vocab.slice(0, 100);
      afficherVocab.forEach(function (v) {
        var tag = document.createElement('span');
        tag.className = 'vocab-tag';
        tag.textContent = v;
        tags.appendChild(tag);
      });
      vocabEl.appendChild(tags);
      if (vocab.length > 100) {
        var pLimite3 = document.createElement('p');
        pLimite3.className = 'vide';
        pLimite3.textContent = 'Affichage des 100 premiers sur ' + vocab.length + ' mots.';
        pLimite3.style.marginTop = '8px';
        vocabEl.appendChild(pLimite3);
      }
    }

    // Config API
    var configEl = document.getElementById('configContenu');
    configEl.replaceChildren();
    var cfg = j.config || {};
    var modeStr = j.mode === '1' ? 'EGO (Gemini)' : 'BLAMUNE (Gemini)';
    var rows = [
      ['Provider', cfg.api_provider || '?', cfg.api_configured ? 'ok' : 'err'],
      ['Mode actif', modeStr, '']
    ];
    rows.forEach(function (r) {
      var d = document.createElement('div');
      d.className = 'config-row';
      var k = document.createElement('span');
      k.className = 'cle';
      k.textContent = r[0];
      var v = document.createElement('span');
      v.className = 'val' + (r[2] ? ' ' + r[2] : '');
      v.textContent = r[1];
      d.appendChild(k);
      d.appendChild(v);
      configEl.appendChild(d);
    });
  } catch (e) {
    afficherErreur('Serveur eteint');
  } finally {
    if (btn) btn.disabled = false;
  }
}
