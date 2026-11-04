# Purge automatique des invites apres 48 h — design

Date : 2026-11-04. Decision du proprietaire (conversation du 2026-11-04) :
la duree de 48 h court **depuis la creation de l'invitation**, sans
report sur activite — « il n'a qu'a creer un compte » s'il veut rester.

## Intent

Un compte d'invitation (`inv_…`, cree par `POST /invite`) n'est pas un
compte reel : c'est un espace d'essai. Sans purge, chaque bref visiteur
laisse derriere lui un dossier disque, des historiques cloud et un jeton :
l'instance paye un stockage qui ne sert a plus personne.

## Regle

Une invite est supprimee quand son **plus ancien artefact** date de plus
de `INVITE_VIE_MS` (defaut 48 h) :

- si un jeton existe dans `invites.json` : le champ `c` (creation du
  jeton = creation de l'invitation) ;
- sinon (invitation d'avant les jetons) : la date de naissance du
  dossier `users/<uid>/` (birthtime, mtime en repli).

La ronde tourne toutes les `PURGE_INVITES_MS` millisecondes (defaut :
3 600 000 = 1 h, `0` = ronde desactivee). Elle s'execute une premiere
fois 60 s apres le boot.

## Ce qui est supprime (par uid)

1. dossier disque `users/<uid>/` (memoire, historiques, etat, resume) ;
2. copie cloud JSONBin (`storage.supprimerTout`) : historiques + memoire ;
3. RAM : `purgerRamUtilisateur(uid)` (file d'extraction, mode prefere,
   historique API tronque, connexions actives) ;
4. le jeton de `invites.json` est **remplace par une pierre tombale**
   `{ s: <ts> }`, jamais oubliee par la chasse des 30 jours : sans elle,
   le uid purge redeviendrait utilisable sans jeton par le meme chemin
   de migration des vieilles invitations.

## Ce qui n'est PAS supprime

- les comptes reels (`u…` de `/register`) : jamais vises, la ronde ne
  regarde que les uids qui repondent a `^inv_[0-9a-f]{24}$` (meme garde
  que la suppression admin) ;
- le savoir (`savoir.db` / `savoir.txt`) : les faits appris sont globaux,
  pas la propriete d'un utilisateur ;
- `stats.json` : compteurs globaux du serveur.

## Approches considerees

1. **Taches de fond dans server.js** (rejete) : server.js ne doit definir
   plus aucun metier, c'est l'assembleur ; les modules gagnent leurs
   tests par injection.
2. **`lib/purge_invites.js` injectable + ronde periodique** (retenu,
   conforme a l'architecture : meme modele que `lib/keepalive.js`).
3. **Delete-cascade au clic sur une session expiree** (rejete) : rien ne
   garantit qu'une session expirera jamais ; la ronde se rattrape.

## Variables

- `INVITE_VIE_MS` — duree de vie d'une invitation (defaut 172800000) ;
- `PURGE_INVITES_MS` — intervalle de la ronde (defaut 3600000, 0 = desactive).

## Reste a l'implementateur

- le test unitaire `tests/purge_invites.test.js` (cas : dossier vieux,
  jeton vieux, invite fraiche epargnee, compte `u…` epargne, marqueur
  RAM/cloud/tombstone) ; l'ajouter au script `test:unit` ;
- ne pas toucher `extraireAuth` au-dela du refus de la pierre tombale
  (l'ancien chemin sans enregistrement continue de migrer les invites
  legitimes, les purges les bloquent).
