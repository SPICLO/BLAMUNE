# BLAMUNE - Guide Keep-Alive (supprime les interruptions)

## Probleme
Render.com met le serveur en veille apres 15 min d'inactivite.
Resultat : 5 sec de delai au prochain message.

## Solution : Keep-alive gratuit

### Option 1 : UptimeRobot (RECOMMANDE - le plus simple)

1. Va sur https://uptimerobot.com
2. Crée un compte gratuit
3. Clique "Add New Monitor"
4. Type : "HTTP(s)"
5. URL : `https://TON_URL_ON_RENDER/health`
6. Interval : 5 minutes
7. Clique "Create Monitor"

**C'est tout !** UptimeRobot ping ton serveur toutes les 5 minutes.
Le serveur ne se met jamais en veille = AUCUNE interruption.

### Option 2 : cron-job.org

1. Va sur https://cron-job.org
2. Crée un compte gratuit
3. Clique "Create schedule"
4. URL : `https://TON_URL_ON_RENDER/health`
5. Schedule : "Every 10 minutes"
6. Method : GET
7. Clique "Save"

### Option 3 : Render.com payant ($7/mois)

Si tu veux zero delai, Render.com offre un plan payant
qui garde le serveur toujours actif.

## Resultat

| Avant | Apres |
|-------|-------|
| 5 sec de delai apres 15 min | AUCUN delai |
| Interruption toutes les 15 min | Conversation fluide 24/7 |
| Se endort si personne parle | Reste toujours reveille |

## Verification

Pour tester que ca marche :
1. Envoie un message
2. Attends 20 minutes
3. Envoie un autre message
4. Si la reponse est instantanee = ca marche !
