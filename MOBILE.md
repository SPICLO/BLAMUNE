# BLAMUNE sur le Play Store et l'App Store

Ce document décrit l'application native Capacitor : ce qui est déjà en place,
comment builder, signer et publier, et ce qui reste à faire avant une
soumission.

## 1. Ce qui est en place

- **Capacitor 8.6** avec `appId` `com.blamune.app`, `appName` `BLAMUNE`,
  `webDir` `site/`.
- **Android** ajouté (`android/`), `compileSdk`/`targetSdk` 36, `minSdk` 24.
- **`site/natif.js`** : chargé avant `app.js`, il détecte la WebView native,
  préfixe les `fetch` relatifs vers le serveur de production et désactive le
  service worker.
- **CORS** : le serveur accepte `capacitor://localhost` (iOS) et
  `https://localhost` (Android).
- **PWA** : le bouton « Installer » et les notifications Web Push sont
  désactivés dans l'application native (rien à installer, et le Web Push
  n'existe pas dans une WebView).
- **Icônes et splash** générés depuis `assets/` (icône adaptative Android).
- **Signature de release** préparée : `android/app/build.gradle` lit
  `android/keystore.properties` s'il existe.
- **Suppression de compte in-app** : bouton « Supprimer mon compte » au bas du
  profil, confirmation en deux temps (`DELETE /compte`). Le serveur efface le
  compte, le dossier, le cloud et la mémoire vive, et refuse de supprimer un
  invité ou l'admin.
- **Pages légales** FR/EN aux URLs propres `/confidentialite` et `/conditions`
  (`site/confidentialite.html`, `site/conditions.html`, `site/legal.css`,
  `site/legal.js`), liées depuis l'écran d'authentification et le profil.

> Le code source du site reste **unique** : `site/`. `cap sync` le copie dans
> les plateformes natives. Ne jamais modifier la copie dans `android/`.

## 2. Architecture

```text
site/ (HTML/CSS/JS) --cap sync--> android/app/src/main/assets/public
                                        |
                                  WebView Capacitor
                                        |
                    fetch('/send') -> https://blamune.onrender.com/send
```

- Les assets (HTML, CSS, JS, images) sont **locaux** : l'application démarre
  sans réseau.
- L'API, les comptes et l'historique restent sur **Render**. Sans réseau,
  l'écran s'ouvre mais la conversation ne part pas.
- L'adresse du serveur est dans `site/natif.js` (constante `API`). Si le
  déploiement Render est renommé, il faut la changer **et** redéployer le
  serveur avec la nouvelle origine dans `CORS_ORIGINS` si nécessaire.

## 3. Prérequis

- **Node.js 22+** (le dépôt utilise déjà Node 26).
- **Android Studio** avec le SDK Android 36 et le JDK 21 fourni
  (`Settings > Languages & Frameworks > Android SDK`).
- Un compte **Google Play Console** (25 $ une fois).
- Pour iOS plus tard : un Mac ou un build cloud, et un compte **Apple
  Developer** (99 $/an).

Sans Android Studio, les commandes `npx cap open android` et Gradle ne
peuvent pas builder : `cap add` et `cap sync` fonctionnent, mais pas la
compilation.

## 4. Commandes

```bash
npm install                 # dépendances (Capacitor inclus)
npm run mobile:sync         # copie site/ vers les plateformes natives
npm run mobile:android      # sync + ouvre Android Studio
npm run mobile:assets       # régénère icônes/splash Android depuis assets/
```

Build en ligne de commande, depuis `android/` :

```powershell
cd android
.\gradlew.bat assembleDebug      # APK de test
.\gradlew.bat bundleRelease      # AAB signé pour le Play Store
```

Sorties :

- APK : `android/app/build/outputs/apk/debug/app-debug.apk`
- AAB : `android/app/build/outputs/bundle/release/app-release.aab`

## 5. Signature de release

À faire **une seule fois**, puis conserver la clé et les mots de passe hors
du dépôt (gestionnaire de mots de passe + sauvegarde).

```powershell
keytool -genkeypair -v `
  -keystore android/blamune-release.jks `
  -alias blamune `
  -keyalg RSA -keysize 4096 -validity 10000
```

Créer `android/keystore.properties` (ignoré par git) :

```properties
storeFile=../blamune-release.jks
storePassword=MOT_DE_PASSE_DU_KEYSTORE
keyAlias=blamune
keyPassword=MOT_DE_PASSE_DE_LA_CLE
```

`storeFile` est relatif au module `android/app/` : `../blamune-release.jks`
pointe donc sur `android/blamune-release.jks`.

**Ne jamais perdre cette clé** : sans elle, plus aucune mise à jour de
l'application n'est possible sur le Play Store.

## 6. Versionner

Avant chaque envoi, dans `android/app/build.gradle` :

- `versionCode` : entier, **+1 à chaque upload** (1, 2, 3…).
- `versionName` : version lisible (`1.0.0`, `1.0.1`, `1.1.0`…).

Le premier envoi peut garder `versionCode 1` et `versionName "1.0"`.

## 7. Publier sur le Play Store

1. Créer le compte Play Console et payer les 25 $.
2. Renseigner **App content** :
   - politique de confidentialité :
     `https://blamune.onrender.com/confidentialite` ;
   - CGU (si demandées) : `https://blamune.onrender.com/conditions` ;
   - **Data safety** : déclarer les données collectées (compte, messages,
     mémoire) et leur chiffrement en transit ;
   - classification du contenu et public cible ;
   - suppression de compte : parcours in-app (profil > Supprimer mon compte).
3. Fiche store :
   - nom, description courte (80 caractères), description complète ;
   - icône 512×512 (déjà dans `site/icon-512.png`) ;
   - bannière 1024×500 et au moins 2 captures d'écran téléphone.
4. Créer un test **interne**, puis **fermé**. Un compte personnel récent doit
   réunir **12 testeurs pendant 14 jours** avant la production.
5. Envoyer l'AAB, corriger les avertissements, demander la revue.

## 8. iOS (plus tard)

```bash
npm install --save-dev @capacitor/ios@8.6.2
npx cap add ios
npm run mobile:ios
```

- Build sur Mac (Xcode) ou cloud (Codemagic, EAS Build).
- TestFlight avant la revue.
- Risque principal : **App Store guideline 4.2** (minimum functionality)
  contre une application qui n'est qu'un site web emballé. Les fonctions
  natives (push APNs, partage, biométrie, hors-ligne réel) sont la meilleure
  défense. Le dossier doit être argumenté, pas seulement « c'est une PWA ».

## 9. Ce qui reste à faire avant une soumission

- [x] **Suppression de compte in-app** : bouton dans le profil, confirmation
      en deux temps, `DELETE /compte` côté serveur.
- [x] **Politique de confidentialité et CGU** publiques : `/confidentialite`
      et `/conditions` (FR/EN), liées depuis l'auth et le profil.
- [ ] **Identité de l'éditeur** : les pages légales utilisent encore
      `blamune@project.com` (adresse provisoire reprise de `package.json`).
      Remplacer par une adresse surveillée, et compléter le nom et l'adresse
      de l'éditeur (mentions légales, responsable du traitement).
- [ ] **Notifications natives** APNs/FCM : le Web Push VAPID actuel ne
      fonctionne pas dans une WebView. Prévoir `@capacitor/push-notifications`
      et l'envoi côté serveur.
- [ ] **Render payant** : le plan gratuit met le service en veille. Depuis
      une icône d'application, un démarrage à froid de 30–60 s est rédhibitoire.
- [ ] **Test sur appareil réel** : clavier, safe areas, bouton retour Android,
      rotation, liens externes (le navigateur système doit s'ouvrir).
- [ ] **Captures d'écran** aux formats exigés par chaque store.
- [ ] Vérifier que `com.blamune.app` est disponible ; sinon changer
      `appId` **avant** le premier envoi (et le package Android avec).

## 10. Limites connues de la v1

- Pas de service worker en natif : les assets sont locaux, mais l'API reste
  distante. Le mode hors ligne ne couvre donc pas les messages.
- Pas de notifications push natives.
- L'application charge le site embarqué ; toute correction de `site/` exige
  un `npm run mobile:sync` puis un nouveau build.

## 11. Fiche store : textes prêts à coller

### Description courte (80 caractères max)

FR :

> BLAMUNE, ton confident personnel : discute, souviens-toi, explore.

EN :

> BLAMUNE, your personal confidant: chat, remember, explore.

### Description complète (FR)

> BLAMUNE est un compagnon de conversation qui se souvient de toi.
>
> Tu peux discuter librement, poser des questions, raconter ta journée ou
> préparer un projet. Au fil des échanges, BLAMUNE retient ce que tu lui
> confies — ton prénom, ta ville, tes goûts — pour rendre la conversation plus
> personnelle. Tu gardes le contrôle : chaque souvenir est visible dans ton
> profil et peut être effacé, champ par champ ou en totalité.
>
> Fonctions principales :
> • conversation en français, anglais, espagnol et arabe ;
> • mémoire personnelle consultable et modifiable ;
> • historique de discussion et recherche ;
> • journal public de ce que le bot apprend, en chiffres ;
> • thème clair ou sombre, taille du texte et couleur d'accent ;
> • suppression du compte et des données depuis l'application.
>
> BLAMUNE est une IA : elle peut se tromper. Vérifie les informations
> importantes et ne partage pas de données sensibles.
>
> Service réservé aux personnes de 15 ans et plus. Politique de
> confidentialité : https://blamune.onrender.com/confidentialite
> Conditions d'utilisation : https://blamune.onrender.com/conditions

### Description complète (EN)

> BLAMUNE is a conversational companion that remembers you.
>
> Chat freely, ask questions, talk about your day or plan a project. Over
> time, BLAMUNE remembers what you share — your first name, your city, your
> tastes — to make each conversation more personal. You stay in control:
> every memory is visible in your profile and can be erased, one field at a
> time or all at once.
>
> Main features:
> • conversation in French, English, Spanish and Arabic;
> • a personal memory you can review and edit;
> • chat history and search;
> • a public journal of what the bot learns, in numbers;
> • light or dark theme, text size and accent colour;
> • account and data deletion from inside the app.
>
> BLAMUNE is an AI: it can be wrong. Check important information and do not
> share sensitive data.
>
> For people aged 15 and over. Privacy policy:
> https://blamune.onrender.com/confidentialite
> Terms of use: https://blamune.onrender.com/conditions

### Captures d'écran à préparer

Play Store : au moins 2 captures téléphone (format 9:16, 1080×1920 ou plus).
App Store : 6,7" et 6,1" obligatoires, iPad seulement si l'app le supporte.

1. Écran d'authentification (montre la marque et les liens légaux).
2. Conversation avec un échange personnel.
3. Panneau profil avec quelques souvenirs.
4. Page `/confidentialite` en français.
5. Journal public (`/journal.html`).
6. Thème clair (montre la personnalisation).

Bannière Play Store : 1024×500, sans texte essentiel près des bords.
