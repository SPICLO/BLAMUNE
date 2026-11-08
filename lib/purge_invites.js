// =====================================================================
//  Purge automatique des invites apres INVITE_VIE_MS (defaut 48 h)
// =====================================================================
//  Un compte d'invitation (inv_..., cree par POST /invite) n'est pas un
//  compte : c'est un espace d'essai. Sans purge, chaque bref visiteur
//  laisse un dossier disque, des historiques cloud et un jeton qui ne
//  servent plus a personne.
//
//  Regle (decidee par le proprietaire, docs/superpowers/specs/
//  2026-11-04-purge-invites-48h-design.md) : la duree court depuis la
//  CREATION de l'invitation, sans report sur activite — un invite qui
//  veut rester cree un compte (/register).
//
//  La suppression reprend la meme mecanique que /admin/supprimer-compte :
//  dossier disque, copie cloud, RAM. La donnee en plus : le jeton de
//  l'invite est remplace par une PIERRE TOMBALE { s: <ts> }. Sans elle,
//  un uid purge (sans enregistrement de jeton) passerait par le meme
//  chemin de migration que les vieilles invitations et serait reutilisable
//  sans aucun jeton : lire extraireAuth sur "Pas d'enregistrement".
// =====================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const MOTIF_INVITE = /^inv_[0-9a-f]{24}$/;

function creerPurgeInvites(deps) {
  const {
    usersDir,
    lireJetonsInvites,
    marquerInviteSupprimee,
    supprimerToutCloud,
    purgerRamUtilisateur,
    connexionsActives,
    loggerErreur,
    vieInviteMs,
    intervalleMs
  } = deps;

  /**
   * Age du dossier utilisateur, en date fiable (0..now). C'est le repli
   * pour les invites d'AVANT les jetons : une invitation moderne porte
   * toujours son champ c (pose a /invite, avant le premier message, donc
   * plus ancien que toute ecriture du dossier). Le mtime sert d'horloge :
   * c'est la date du dernier message recu de l'invite, et utimesSync
   * permet aux tests de le vieillir sans jouer sur le temps reel.
   */
  function naissanceDossier(uid, now) {
    let stat = null;
    try {
      stat = fs.statSync(path.join(usersDir, uid));
    } catch (e) {
      return null;
    }
    const t = stat.mtime ? stat.mtime.getTime() : 0;
    if (!(t > 0)) return null;
    return t > now ? now : t;
  }

  /**
   * Les candidats a la purge : invites dont la CREATION date de plus de
   * vieInviteMs. Creation = le champ c du jeton s'il existe, sinon le
   * dossier (invites d'avant les jetons). Les pierres tombales (e.s)
   * sont hors course : deja purgees.
   *
   * ORPHELINS (correctif A) : la chasse des 30 jours de `ecrireInvites`
   * oublie un enregistrement JAUNE (invitation encore vive), mais le dossier
   * `users/<uid>/` reste sur disque. Avec le repli permissif retire de
   * `extraireAuth`, ce dossier ne sert plus a rien et personne ne pouvait
   * le reprendre : la purge le traite comme son invitation (mourir a 48 h)
   * plutot que d'en laisser l'accumulation.
   */
  function candidats(now, vie) {
    const jetons = lireJetonsInvites ? lireJetonsInvites() : {};
    const tous = new Set();
    for (const uid of Object.keys(jetons)) {
      const e = jetons[uid];
      if (e && !e.s && MOTIF_INVITE.test(uid)) tous.add(uid);
    }
    try {
      if (fs.existsSync(usersDir)) {
        for (const nom of fs.readdirSync(usersDir)) {
          if (MOTIF_INVITE.test(nom)) tous.add(nom);
        }
      }
    } catch (e) {
      if (loggerErreur) loggerErreur('purge', 'liste des dossiers: ' + e.message);
    }

    const heres = [];
    for (const uid of tous) {
      const e = jetons[uid];
      if (e && e.s) continue;
      // Sans enregistrement, c'est le dossier qui donne la date (il n'y a
      // pas d'autre horloge, et le repli sans jeton n'existe plus).
      const creation = e && typeof e.c === 'number' ? e.c : naissanceDossier(uid, now);
      if (creation != null && now - creation > vie) heres.push(uid);
    }
    return heres;
  }

  /**
   * Supprime TOUT ce qui porte ce uid : dossier, cloud, RAM, jeton (qui
   * devient une pierre tombale). Chaque etage est blinde : un echec
   * local ne doit pas empecher le suivant, la ronde suivante les rattrape.
   */
  function purgerInvite(uid) {
    const motif = 'invite purgee ' + uid + ' (' + vieInviteMs + ' ms)';
    try {
      fs.rmSync(path.join(usersDir, uid), { recursive: true, force: true });
    } catch (e) {
      if (loggerErreur) loggerErreur('purge', 'dossier: ' + e.message);
    }
    try {
      if (connexionsActives) delete connexionsActives[uid];
    } catch (e) {}
    try {
      if (purgerRamUtilisateur) purgerRamUtilisateur(uid);
    } catch (e) {
      if (loggerErreur) loggerErreur('purge', 'RAM: ' + e.message);
    }
    try {
      if (supprimerToutCloud) supprimerToutCloud(uid);
    } catch (e) {
      if (loggerErreur) loggerErreur('purge', 'cloud: ' + e.message);
    }
    try {
      if (marquerInviteSupprimee) marquerInviteSupprimee(uid);
    } catch (e) {
      if (loggerErreur) loggerErreur('purge', 'tombstone: ' + e.message);
    }
    return motif;
  }

  /** Une ronde : purge les invites perimees, renvoie leurs uids. */
  function ronde() {
    const maintenant = Date.now();
    const heres = candidats(maintenant, vieInviteMs);
    for (const uid of heres) purgerInvite(uid);
    if (heres.length && loggerErreur) {
      loggerErreur('purge', heres.length + ' invite(s) supprimee(s) : dossier, cloud, RAM, jeton');
    }
    return heres;
  }

  /** Demarre la ronde periodique. Retourne un handle, ou null si desactivee. */
  function demarrer() {
    if (!intervalleMs || intervalleMs <= 0) return null;
    // Premiere passe : au plus 60 s apres le boot (le temps que la charge
    // du bin cloud soit finie), ou plus vite si la ronde elle-meme est
    // rapide (tests d'integration du cycle de vie sur un vrai serveur).
    const premier = setTimeout(
      () => {
        try {
          ronde();
        } catch (e) {
          if (loggerErreur) loggerErreur('purge', 'premiere ronde: ' + e.message);
        }
      },
      Math.min(60000, intervalleMs)
    );
    const tour = setInterval(() => {
      try {
        ronde();
      } catch (e) {
        if (loggerErreur) loggerErreur('purge', 'ronde: ' + e.message);
      }
    }, intervalleMs);
    return { premier, tour };
  }

  return { candidats, purgerInvite, ronde, demarrer, MOTIF_INVITE };
}

module.exports = { creerPurgeInvites };
