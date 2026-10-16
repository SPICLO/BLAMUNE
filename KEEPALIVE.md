# BLAMUNE - Keep-Alive (supprime les interruptions)

## Probleme

Render.com met le service gratuit en veille apres environ 15 minutes sans
requete entrante. Au reveil, la premiere requete met 5 a 30 secondes a
repondre : le visiteur croit que le site est casse.

## Ce qui est deja en place

Deux rappel automatiques. Aucun compte a creer.

| Mecanisme | Ou | Garantit |
|---|---|---|
| Rappel interne | `lib/keepalive.js`, cable dans `server.js` | Maintient l'instance eveillee **tant que le processus tourne** |
| Rappel externe | `.github/workflows/keepalive.yml` | Maintient **et reveille** l'instance |

### Rappel interne

Toutes les 2 min 30, le serveur appelle sa propre route `/health`, mais
**uniquement si personne n'est connecte** : quand quelqu'un discute, ses
messages empechent deja la mise en veille, le rappel ne serait qu'une
requete inutile.

Pour le desactiver (developpement, tests) : `KEEPALIVE=0`.

### Rappel externe

Workflow GitHub Actions planifie, toutes les 5 minutes, avec trois
tentatives espacees de 10 secondes.

Pour changer l'URL : **Settings > Secrets and variables > Actions >
Variables > BLAMUNE_URL**. Sans elle, le repli est
`https://blamune.onrender.com`.

## Deux limites, dites franchement

**Le rappel interne ne reveille pas une instance arretee.** Un minuteur
interne ne s'execute pas quand le processus dort. C'est le rappel externe
qui fait les deux offices, et lui seul.

**Le rappel externe peut avoir du retard.** Les workflows planifies de GitHub
Actions sont parfois decales de plusieurs minutes aux heures de pointe. Et
cron n'accepte pas moins de 5 minutes : les 2 ou 3 minutes demandes ne sont
pas atteignables par ce mecanisme. Cinq minutes reste tres en deca des 15
minutes de Render.

**GitHub desactive les workflows planifies d'un depot inactif depuis 60
jours.** Un depot sans commit ni issue pendant deux mois voit ses planifications
mises en pause, silencieusement. Le rappel interne continue de tourner, mais
l'externe ne part plus. C'est un argument de plus pour UptimeRobot si le
projet peut rester inactif longtemps.

Si tu veux une regularite garantie, il faut un service externe de
monitoring — voir plus bas. Le workflow GitHub couvre le cas courant,
UptimeRobot couvre le cas exigeant.

## Option externe, pour aller plus loin

### UptimeRobot (le plus fiable)

1. Compte gratuit sur <https://uptimerobot.com>
2. **Add New Monitor** -> type **HTTP(s)**
3. URL : `https://TON_URL_ON_RENDER/health`
4. Intervalle : **5 minutes** (minimum du plan gratuit)

### cron-job.org (intervalle plus court)

1. Compte gratuit sur <https://cron-job.org>
2. **Create schedule** -> URL `https://TON_URL_ON_RENDER/health`
3. Intervalle : **Every 2 minutes**, methode **GET**

### Render payant (~7 $/mois)

Zero delai, service toujours actif. Supprime la question.

## Verification

1. Ouvre <https://blamune.onrender.com/health> : doit repondre `{"ok":true,...}`
2. Attends 20 minutes sans aucune interaction
3. Recharge la page et envoie un message : la reponse doit etre immediate
4. Dans GitHub, onglet **Actions > Keep-alive** : les executions doivent
   regularly reussir

Si le site met toujours 5 secondes a repondre apres 20 minutes, c'est que
le rappel externe ne tourne pas : verifie que le workflow **Keep-alive** est
actif (onglet Actions) et que les executions ne sont pas toutes en echec.