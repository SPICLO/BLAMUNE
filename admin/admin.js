// Dashmin - Admin dashboard
var API = '';
var adminToken = null;
var adminPseudo = null;
var refreshInterval = null;
var dashboardInit = false;

// ---- LOGIN ----
(function() {
  var stored = localStorage.getItem('dashmin_token');
  var storedPseudo = localStorage.getItem('dashmin_pseudo');
  var storedTime = localStorage.getItem('dashmin_time');
  if (stored && storedTime && (Date.now() - parseInt(storedTime)) > 86400000) {
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

document.getElementById('loginAdminForm').onsubmit = async function(e) {
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
  if (btn) { btn.disabled = true; btn.textContent = 'Connexion...'; }
  try {
    var r = await fetch(API + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'pseudo=' + encodeURIComponent(pseudo) + '&mdp=' + encodeURIComponent(mdp)
    });
    var j = await r.json();
    if (j.ok) {
      if (j.pseudo !== 'admin') {
        errEl.textContent = 'Ce compte n\'est pas admin.';
        errEl.classList.remove('masquee');
        if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
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
      if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
    }
  } catch(ex) {
    errEl.textContent = 'Erreur de connexion au serveur.';
    errEl.classList.remove('masquee');
    if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
  }
};

function initDashboard() {
  if (!dashboardInit) {
    document.getElementById('btnRefresh').onclick = chargerDonnees;
    document.getElementById('btnReload').onclick = function() { window.location.reload(); };
    document.getElementById('btnLogout').onclick = function() {
      localStorage.removeItem('dashmin_token');
      localStorage.removeItem('dashmin_pseudo');
      localStorage.removeItem('dashmin_time');
      if (refreshInterval) clearInterval(refreshInterval);
      dashboardInit = false;
      window.location.reload();
    };
    dashboardInit = true;
  }
  chargerDonnees();
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(chargerDonnees, 30000);
}

function setSectionErreur(id, msg) {
  var el = document.getElementById(id);
  if (el) { el.replaceChildren(); var p = document.createElement('p'); p.className = 'vide'; p.textContent = msg; el.appendChild(p); }
}

function afficherErreur(msg) {
  document.getElementById('uptime').textContent = msg;
  setSectionErreur('connexionsContenu', msg);
  setSectionErreur('inscritsContenu', msg);
  setSectionErreur('tousMessagesContenu', msg);
  setSectionErreur('profilContenu', msg);
  setSectionErreur('savoirContenu', msg);
  setSectionErreur('vocabContenu', msg);
  setSectionErreur('configContenu', msg);
}

async function chargerDonnees() {
  var btn = document.getElementById('btnRefresh');
  if (btn) btn.disabled = true;
  try {
    var headers = {};
    if (adminToken) { headers['X-EGO'] = adminToken; }
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
    try { j = await r.json(); } catch(e) { afficherErreur('Reponse invalide du serveur'); return; }
    if (!j.ok) { afficherErreur('Erreur serveur'); return; }

    // Stats
    var s = j.stats || {};
    document.getElementById('statMessages').textContent = s.messagesTotal || 0;
    document.getElementById('statSessions').textContent = s.sessionsTotal || 0;
    document.getElementById('statDemarrages').textContent = s.demarrages || 0;
    document.getElementById('statTemps').textContent = (s.tempsMoyen || 0) + 'ms';
    document.getElementById('uptime').textContent = 'Demarre le ' + (s.demarrage || '?');

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
      ['Pseudo','Email','Date','Msg'].forEach(function(txt) {
        var th = document.createElement('th');
        th.style.cssText = 'text-align:left;padding:8px;border-bottom:1px solid var(--bordure);color:var(--texte-doux);font-size:12px;';
        th.textContent = txt;
        trHU.appendChild(th);
      });
      theadU.appendChild(trHU);
      tableU.appendChild(theadU);
      var tbodyU = document.createElement('tbody');
      users.forEach(function(u) {
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
        tdMsg.style.cssText = 'padding:8px;color:var(--texte-doux);font-size:12px;text-align:right;';
        tdMsg.textContent = u.messages || 0;
        tr.appendChild(tdPseudo);
        tr.appendChild(tdEmail);
        tr.appendChild(tdCree);
        tr.appendChild(tdMsg);
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
      ['Pseudo','UID','Debut'].forEach(function(txt) {
        var th = document.createElement('th');
        th.style.cssText = 'text-align:left;padding:8px;border-bottom:1px solid var(--bordure);color:var(--texte-doux);font-size:12px;';
        th.textContent = txt;
        trHC.appendChild(th);
      });
      theadC.appendChild(trHC);
      tableC.appendChild(theadC);
      var tbodyC = document.createElement('tbody');
      connexions.forEach(function(c) {
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
      ['Heure','Qui','Message','Reponse'].forEach(function(txt) {
        var th = document.createElement('th');
        th.style.cssText = 'text-align:left;padding:8px;border-bottom:1px solid var(--bordure);color:var(--texte-doux);font-size:12px;';
        th.textContent = txt;
        trHM.appendChild(th);
      });
      theadM.appendChild(trHM);
      tableM.appendChild(theadM);
      var tbodyM = document.createElement('tbody');
      afficher.forEach(function(m) {
        var tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--bordure)';
        var tdH = document.createElement('td');
        tdH.style.cssText = 'padding:8px;color:var(--texte-doux);font-size:11px;white-space:nowrap;';
        tdH.textContent = m.heure || '-';
        var tdP = document.createElement('td');
        tdP.style.cssText = 'padding:8px;color:var(--texte);font-weight:600;font-size:12px;white-space:nowrap;';
        tdP.textContent = m.pseudo || m.uid || '?';
        var tdMsg = document.createElement('td');
        tdMsg.style.cssText = 'padding:8px;color:var(--texte);font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        tdMsg.textContent = m.message || '';
        var tdR = document.createElement('td');
        tdR.style.cssText = 'padding:8px;color:var(--accent);font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
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
      ['Plat prefere', profil.plat || '-'],
      ['Hobby', profil.hobby || '-'],
      ['Aime', profil.aime || '-'],
      ['Aime pas', profil.aimePas || '-'],
      ['Mots favoris', (profil.motsFavoris || []).join(', ') || '-']
    ];
    profilChamps.forEach(function(c) {
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
      afficherSavoir.forEach(function(s) {
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
        pLimite2.textContent = 'Affichage des 100 premiers sur ' + savoir.length + ' connaissances.';
        pLimite2.style.marginTop = '8px';
        savoirEl.appendChild(pLimite2);
      }
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
      afficherVocab.forEach(function(v) {
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
    rows.forEach(function(r) {
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

  } catch(e) {
    afficherErreur('Serveur eteint');
  } finally {
    if (btn) btn.disabled = false;
  }
}
