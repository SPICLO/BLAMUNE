// Dashmin - Admin dashboard
var API = '';
var adminToken = null;
var adminPseudo = null;

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
  errEl.classList.add('masquee');
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
    }
  } catch(ex) {
    errEl.textContent = 'Erreur de connexion au serveur.';
    errEl.classList.remove('masquee');
  }
};

function initDashboard() {
  document.getElementById('btnRefresh').onclick = chargerDonnees;
  document.getElementById('btnReload').onclick = function () {
    window.location.reload();
  };
  document.getElementById('btnLogout').onclick = function () {
    localStorage.removeItem('dashmin_token');
    localStorage.removeItem('dashmin_pseudo');
    localStorage.removeItem('dashmin_time');
    window.location.reload();
  };
  chargerDonnees();
}

function setSectionErreur(id, msg) {
  var el = document.getElementById(id);
  if (el) { el.replaceChildren(); var p = document.createElement('p'); p.className = 'vide'; p.textContent = msg; el.appendChild(p); }
}

async function chargerDonnees() {
  var btn = document.getElementById('btnRefresh');
  btn.disabled = true;
  try {
    var headers = {};
    if (adminToken) { headers['X-EGO'] = adminToken; }
    var r = await fetch(API + '/admin/data', { headers: headers });
    if (!r.ok) {
      if (r.status === 403) {
        localStorage.removeItem('dashmin_token');
        localStorage.removeItem('dashmin_pseudo');
        localStorage.removeItem('dashmin_time');
        window.location.reload();
        return;
      }
      document.getElementById('uptime').textContent = 'Erreur serveur (HTTP ' + r.status + ')';
      setSectionErreur('connexionsContenu', 'Erreur serveur');
      setSectionErreur('inscritsContenu', 'Erreur serveur');
      setSectionErreur('tousMessagesContenu', 'Erreur serveur');
      setSectionErreur('profilContenu', 'Erreur serveur');
      setSectionErreur('savoirContenu', 'Erreur serveur');
      setSectionErreur('vocabContenu', 'Erreur serveur');
      setSectionErreur('configContenu', 'Erreur serveur');
      return;
    }
    var j = await r.json();
    if (!j.ok) {
      document.getElementById('uptime').textContent = 'Erreur serveur';
      return;
    }

    // Stats
    var s = j.stats || {};
    document.getElementById('statMessages').textContent = s.messagesTotal || 0;
    document.getElementById('statSessions').textContent = s.sessionsTotal || 0;
    document.getElementById('statDemarrages').textContent = s.demarrages || 0;
    document.getElementById('statTemps').textContent = (s.tempsMoyen || 0) + 'ms';
    document.getElementById('uptime').textContent = 'Bot demarre le ' + (s.demarrage || '?');

    // Utilisateurs
    var connexions = j.connexions || [];
    document.getElementById('statEnLigne').textContent = connexions.length;

    // Utilisateurs inscrits (avec email)
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
      ['Pseudo','Email','Date d\'inscription','Messages'].forEach(function(txt) {
        var th = document.createElement('th');
        th.style.cssText = 'text-align:left;padding:8px;border-bottom:1px solid var(--bordure);color:var(--texte-doux);';
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
      ['Pseudo','Mode','Debut'].forEach(function(txt) {
        var th = document.createElement('th');
        th.style.cssText = 'text-align:left;padding:8px;border-bottom:1px solid var(--bordure);color:var(--texte-doux);';
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
        var tdM = document.createElement('td');
        tdM.style.cssText = 'padding:8px;color:var(--accent);font-size:13px;';
        tdM.textContent = c.mode === '1' ? 'EGO' : 'BLAMUNE';
        var tdD = document.createElement('td');
        tdD.style.cssText = 'padding:8px;color:var(--texte-doux);font-size:12px;';
        tdD.textContent = c.debut || '-';
        tr.appendChild(tdP);
        tr.appendChild(tdM);
        tr.appendChild(tdD);
        tbodyC.appendChild(tr);
      });
      tableC.appendChild(tbodyC);
      connEl.appendChild(tableC);
    }

    // Messages
    var messages = j.messages || [];
    var msgEl = document.getElementById('tousMessagesContenu');
    msgEl.replaceChildren();
    document.getElementById('tousMessagesCount').textContent = '(' + messages.length + ')';
    if (messages.length === 0) {
      var pVideM = document.createElement('p');
      pVideM.className = 'vide';
      pVideM.textContent = 'Aucun message.';
      msgEl.appendChild(pVideM);
    } else {
      var tableM = document.createElement('table');
      tableM.style.width = '100%';
      tableM.style.borderCollapse = 'collapse';
      var theadM = document.createElement('thead');
      var trHM = document.createElement('tr');
      ['Heure','Pseudo','Message','Reponse'].forEach(function(txt) {
        var th = document.createElement('th');
        th.style.cssText = 'text-align:left;padding:8px;border-bottom:1px solid var(--bordure);color:var(--texte-doux);';
        th.textContent = txt;
        trHM.appendChild(th);
      });
      theadM.appendChild(trHM);
      tableM.appendChild(theadM);
      var tbodyM = document.createElement('tbody');
      messages.slice().reverse().forEach(function(m) {
        var tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--bordure)';
        var tdH = document.createElement('td');
        tdH.style.cssText = 'padding:8px;color:var(--texte-doux);font-size:11px;white-space:nowrap;';
        tdH.textContent = m.heure || '-';
        var tdP = document.createElement('td');
        tdP.style.cssText = 'padding:8px;color:var(--texte);font-weight:600;font-size:13px;';
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
    }

    // Profil
    var profil = j.profil || {};
    var profilEl = document.getElementById('profilContenu');
    profilEl.replaceChildren();
    var profilChamps = [
      ['Pseudo', profil.pseudo || '-'],
      ['Surnom', profil.surnom || '-'],
      ['Genre', profil.genre || '-'],
      ['Age', profil.age || '-'],
      ['Langage', profil.langagePrefere || '-'],
      ['Style', profil.styleReponse || '-'],
      ['Favoris', (profil.motsFavoris || []).join(', ') || '-'],
      ['Centre interets', (profil.centresInteret || []).join(', ') || '-'],
      ['Mode', profil.mode || '-']
    ];
    profilChamps.forEach(function(c) {
      var d = document.createElement('div');
      d.className = 'profil-item';
      var k = document.createElement('span');
      k.className = 'cle';
      k.textContent = c[0];
      var val = document.createElement('span');
      val.className = 'valeur' + (c[1] ? '' : ' vide');
      val.textContent = c[1];
      d.appendChild(k);
      d.appendChild(val);
      profilEl.appendChild(d);
    });

    // Savoir
    var savoir = j.savoir || [];
    var savoirEl = document.getElementById('savoirContenu');
    savoirEl.replaceChildren();
    if (savoir.length === 0) {
      var pVide3 = document.createElement('p');
      pVide3.className = 'vide';
      pVide3.textContent = 'Aucune connaissance memorisee.';
      savoirEl.appendChild(pVide3);
    } else {
      savoir.forEach(function(s) {
        var d = document.createElement('div');
        d.style.cssText = 'padding:8px;border-bottom:1px solid var(--bordure);font-size:13px;';
        var topic = document.createElement('strong');
        topic.style.color = 'var(--accent)';
        topic.textContent = (s.topic || '?') + ' : ';
        d.appendChild(topic);
        var cont = document.createElement('span');
        cont.textContent = s.contenu || s.content || '-';
        d.appendChild(cont);
        savoirEl.appendChild(d);
      });
    }

    // Vocabulaire
    var vocab = j.vocabulaire || [];
    var vocabEl = document.getElementById('vocabContenu');
    vocabEl.replaceChildren();
    if (vocab.length === 0) {
      var pVide4 = document.createElement('p');
      pVide4.className = 'vide';
      pVide4.textContent = 'Aucun vocabulaire memorise.';
      vocabEl.appendChild(pVide4);
    } else {
      var tags = document.createElement('div');
      tags.className = 'vocab-tags';
      vocab.forEach(function (v) {
        var tag = document.createElement('span');
        tag.className = 'vocab-tag';
        tag.textContent = v;
        tags.appendChild(tag);
      });
      vocabEl.appendChild(tags);
    }

    // Config API
    var configEl = document.getElementById('configContenu');
    configEl.replaceChildren();
    var cfg = j.config || {};
    var rows = [
      ['Provider', cfg.api_provider || '?', cfg.api_configured ? 'ok' : 'err'],
      ['Mode actif', j.mode === '1' ? 'EGO' : 'BLAMUNE INTELLIGENT', '']
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
    document.getElementById('uptime').textContent = 'Serveur bot eteint';
    setSectionErreur('connexionsContenu', 'Serveur eteint');
    setSectionErreur('inscritsContenu', 'Serveur eteint');
    setSectionErreur('tousMessagesContenu', 'Serveur eteint');
    setSectionErreur('profilContenu', 'Serveur eteint');
    setSectionErreur('savoirContenu', 'Serveur eteint');
    setSectionErreur('vocabContenu', 'Serveur eteint');
    setSectionErreur('configContenu', 'Serveur eteint');
  } finally {
    btn.disabled = false;
  }
}

// ---- INIT ----
if (adminToken && adminPseudo) {
  chargerDonnees();
  setInterval(chargerDonnees, 30000);
}
