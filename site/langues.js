// =====================================================================
//  I18N du site (fr, en, es, ar)
// =====================================================================
//  Le bot parle deja 4 langues ; les boutons et menus du site aussi.
//  Principe VOLONTAIREMENT petit :
//   - un dictionnaire par langue, une cle par texte de l'INTERFACE.
//     Les NIEMES textes du chat ne traduisent pas ici : c'est le bot
//     qui choisit sa langue (regle deja en place dans les prompts).
//   - la cle par defaut EST la phrase francaise : t('En ligne') renvoie
//     le texte FR si la langue n'a pas la cle (ou si le module manque).
//  Langue choisie : localStorage 'blamune_langue', sinon la langue du
//  navigateur (fr, en, es, ar), sinon le francais. Le choix persiste.
//  Arabe : la direction passe a RTL (document.dir), le CSS le supporte
//  via les proprietes sans gauche/droite.
// =====================================================================
'use strict';

(function () {
  var CLE = 'blamune_langue';

  var DICT = {
    en: {
      /* ecran d'authentification */
      'Bienvenue sur BLAMUNE': 'Welcome to BLAMUNE',
      'Connecte-toi pour garder ton historique et personnaliser ton experience.':
        'Log in to keep your history and personalise your experience.',
      'Ton email': 'Your email',
      'Mot de passe': 'Password',
      'Se connecter': 'Log in',
      'Pas encore de compte ?': 'No account yet?',
      'Creer un compte': 'Create an account',
      'Choisis un pseudo': 'Choose a username',
      'Creer mon compte': 'Create my account',
      'Deja un compte ?': 'Already have an account?',
      ou: 'or',
      "Continuer en tant qu'invite": 'Continue as guest',
      "L'invite ne sauvegarde pas tes messages.": 'The guest mode does not save your messages.',
      'Connexion reussie !': 'Logged in!',
      /* header / statut */
      'En ligne': 'Online',
      'Demarrage...': 'Starting...',
      'Hors ligne': 'Offline',
      'Reflechit...': 'Thinking...',
      'Serveur injoignable': 'Server unreachable',
      'Statut inconnu': 'Unknown status',
      Rechercher: 'Search',
      Notifications: 'Notifications',
      Export: 'Export',
      Clair: 'Light',
      Sombre: 'Dark',
      Deconnexion: 'Log out',
      Quitter: 'Leave',
      'Mode invite': 'Guest mode',
      'Mon profil': 'My profile',
      Fermer: 'Close',
      /* ecran profil */
      'Ce que BLAMUNE sait de toi': 'What BLAMUNE knows about you',
      Enregistrer: 'Save',
      'Tout oublier': 'Forget everything',
      'Profil sauvegarde.': 'Profile saved.',
      'Profil oublie.': 'Profile forgotten.',
      'Charger le profil...': 'Loading profile...',
      'Rien, pour le moment. BLAMUNE apprend en te parlant.':
        'Nothing yet. BLAMUNE learns by talking with you.',
      /* profil : champs + boutons */
      Nom: 'Name',
      Prenom: 'First name',
      Age: 'Age',
      Ville: 'City',
      Metier: 'Job',
      Gouts: 'Likes',
      'Anniversaire (JJ-MM)': 'Birthday (DD-MM)',
      'Effacer tout ce que BLAMUNE a retenu de toi ?':
        'Erase everything BLAMUNE remembers about you?',
      'Profil indisponible pour le moment.': 'Profile unavailable right now.',
      /* voix */
      'Lire a voix haute': 'Read aloud',
      '▶ lire': '▶ read',
      '⏹ stop': '⏹ stop',
      /* selecteur de langue */
      Langue: 'Language',
      /* statuts divers */
      'Passer en mode sombre': 'Switch to dark mode',
      'Passer en mode clair': 'Switch to light mode',
      'Retirer la photo': 'Remove the photo',
      'Envoyer une photo': 'Send a photo',
      'Envoyer (Entrée)': 'Send (Enter)',
      "Voir ce que BLAMUNE enregistre sur toi (et l'oublier)":
        'See what BLAMUNE remembers about you (and forget it)',
      "Rechercher dans l'historique": 'Search your history',
      'Recevoir les messages de BLAMUNE hors du site':
        "Receive BLAMUNE's messages outside the site",
      "Exporter l'historique (fichier texte, il reste chez toi)":
        'Export your history (text file, it stays with you)',
      'Revenir au fil de la conversation': 'Back to the conversation',
      'Autres actions': 'Other actions',
      'Mode vocal : dicter tes messages et entendre les reponses':
        'Voice mode: dictate your messages and hear the replies',
      'Mode vocal': 'Voice mode',
      Conversation: 'Conversation',
      'Aller au contenu principal': 'Skip to main content',
      /* page journal.html (liens + libelles des cartes) */
      'Journal du bot': 'Bot journal',
      'Les bonnes surprises du jour': "Today's good surprises",
      JournalNote:
        'Numbers only: what visitors tell the bot stays private. Here we celebrate how much it learns, never the content.',
      'faits appris au total': 'facts learned in total',
      'appris cette semaine': 'learned this week',
      'messages échangés': 'messages exchanged',
      'réponses notées 👍/👎': 'answers rated 👍/👎',
      'réponses jugées bonnes': 'answers rated good',
      "jours d'activité": 'active days',
      'membres inscrits': 'registered members',
      'Journal indisponible pour le moment.': 'Journal unavailable right now.',
      '← Discuter avec BLAMUNE': '← Chat with BLAMUNE',
      Journal: 'Journal',
      "Voir le journal public du bot (ce qu'il apprend, en chiffres)":
        "See the bot's public journal (what it learns, in numbers)",
      /* recherche + bas de page */
      'Retrouver une phrase de ton historique...': 'Find a sentence from your history...',
      'Écris un message...': 'Write a message...',
      'Pas de resultat.': 'No result.',
      'Aucun message transporte avant la connexion.': ''
    },
    es: {
      'Bienvenue sur BLAMUNE': 'Bienvenido a BLAMUNE',
      'Connecte-toi pour garder ton historique et personnaliser ton experience.':
        'Inicia sesion para guardar tu historial y personalizar tu experiencia.',
      'Ton email': 'Tu correo',
      'Mot de passe': 'Contraseña',
      'Se connecter': 'Iniciar sesion',
      'Pas encore de compte ?': '¿Aun sin cuenta?',
      'Creer un compte': 'Crear una cuenta',
      'Choisis un pseudo': 'Elige un seudónimo',
      'Creer mon compte': 'Crear mi cuenta',
      'Deja un compte ?': '¿Ya tienes cuenta?',
      ou: 'o',
      "Continuer en tant qu'invite": 'Continuar como invitado',
      "L'invite ne sauvegarde pas tes messages.": 'El modo invitado no guarda tus mensajes.',
      'Connexion reussie !': '¡Sesion iniciada!',
      'En ligne': 'En linea',
      'Demarrage...': 'Arrancando...',
      'Hors ligne': 'Desconectado',
      'Reflechit...': 'Pensando...',
      'Serveur injoignable': 'Servidor inaccesible',
      'Statut inconnu': 'Estado desconocido',
      Rechercher: 'Buscar',
      Notifications: 'Notificaciones',
      Export: 'Exportar',
      Clair: 'Claro',
      Sombre: 'Oscuro',
      Deconnexion: 'Salir',
      Quitter: 'Salir',
      'Mode invite': 'Modo invitado',
      'Mon profil': 'Mi perfil',
      Fermer: 'Cerrar',
      'Ce que BLAMUNE sait de toi': 'Lo que BLAMUNE sabe de ti',
      Enregistrer: 'Guardar',
      'Tout oublier': 'Olvidar todo',
      'Profil sauvegarde.': 'Perfil guardado.',
      'Profil oublie.': 'Perfil olvidado.',
      'Charger le profil...': 'Cargando el perfil...',
      'Rien, pour le moment. BLAMUNE apprend en te parlant.':
        'Nada por el momento. BLAMUNE aprende hablando contigo.',
      Nom: 'Nombre',
      Prenom: 'Nombre de pila',
      Age: 'Edad',
      Ville: 'Ciudad',
      Metier: 'Trabajo',
      Gouts: 'Gustos',
      'Anniversaire (JJ-MM)': 'Cumpleaños (DD-MM)',
      'Effacer tout ce que BLAMUNE a retenu de toi ?':
        '¿Borrar todo lo que BLAMUNE recuerda de ti?',
      'Profil indisponible pour le moment.': 'Perfil no disponible por el momento.',
      'Lire a voix haute': 'Leer en voz alta',
      '▶ lire': '▶ leer',
      '⏹ stop': '⏹ parar',
      Langue: 'Idioma',
      'Passer en mode sombre': 'Cambiar a modo oscuro',
      'Passer en mode clair': 'Cambiar a modo claro',
      'Retirer la photo': 'Quitar la foto',
      'Envoyer une photo': 'Enviar una foto',
      'Envoyer (Entrée)': 'Enviar (Entrar)',
      "Voir ce que BLAMUNE enregistre sur toi (et l'oublier)":
        'Ver lo que BLAMUNE guarda de ti (y olvidarlo)',
      "Rechercher dans l'historique": 'Buscar en el historial',
      'Recevoir les messages de BLAMUNE hors du site':
        'Recibir los mensajes de BLAMUNE fuera del sitio',
      "Exporter l'historique (fichier texte, il reste chez toi)":
        'Exportar el historial (archivo de texto, se queda contigo)',
      'Revenir au fil de la conversation': 'Volver a la conversación',
      'Autres actions': 'Otras acciones',
      'Mode vocal : dicter tes messages et entendre les reponses':
        'Modo voz: dicta tus mensajes y escucha las respuestas',
      'Mode vocal': 'Modo voz',
      Conversation: 'Conversación',
      'Aller au contenu principal': 'Ir al contenido principal',
      /* page journal.html */
      'Journal du bot': 'Diario del bot',
      'Les bonnes surprises du jour': 'Las buenas sorpresas del día',
      JournalNote:
        'Solo números: lo que los visitantes confían al bot queda privado. Aquí celebramos cuánto aprende, nunca el contenido.',
      'faits appris au total': 'hechos aprendidos en total',
      'appris cette semaine': 'aprendidos esta semana',
      'messages échangés': 'mensajes intercambiados',
      'réponses notées 👍/👎': 'respuestas valoradas 👍/👎',
      'réponses jugées bonnes': 'respuestas juzgadas buenas',
      "jours d'activité": 'días activos',
      'membres inscrits': 'miembros inscritos',
      'Journal indisponible pour le moment.': 'Diario no disponible por el momento.',
      '← Discuter avec BLAMUNE': '← Hablar con BLAMUNE',
      Journal: 'Diario',
      "Voir le journal public du bot (ce qu'il apprend, en chiffres)":
        'Ver el diario publico del bot (lo que aprende, en cifras)',
      'Retrouver une phrase de ton historique...': 'Encuentra una frase de tu historial...',
      'Écris un message...': 'Escribe un mensaje...',
      'Pas de resultat.': 'Sin resultados.'
    },
    ar: {
      'Bienvenue sur BLAMUNE': 'مرحبا بك في BLAMUNE',
      'Connecte-toi pour garder ton historique et personnaliser ton experience.':
        'سجّل الدخول للاحتفاظ بسجلك وتخصيص تجربتك.',
      'Ton email': 'بريدك الالكتروني',
      'Mot de passe': 'كلمة المرور',
      'Se connecter': 'تسجيل الدخول',
      'Pas encore de compte ?': 'ليس لديك حساب؟',
      'Creer un compte': 'انشاء حساب',
      'Choisis un pseudo': 'اختر اسما مستعارا',
      'Creer mon compte': 'انشاء حسابي',
      'Deja un compte ?': 'لديك حساب بالفعل؟',
      ou: 'أو',
      "Continuer en tant qu'invite": 'المتابعة كزائر',
      "L'invite ne sauvegarde pas tes messages.": 'وضع الزائر لا يحفظ رسائلك.',
      'Connexion reussie !': 'تم تسجيل الدخول!',
      'En ligne': 'على الخط',
      'Demarrage...': 'جار التشغيل...',
      'Hors ligne': 'غير متصل',
      'Reflechit...': 'يفكر...',
      'Serveur injoignable': 'الخادم غير متاح',
      'Statut inconnu': 'حالة مجهولة',
      Rechercher: 'بحث',
      Notifications: 'الاشعارات',
      Export: 'تصدير',
      Clair: 'فاتح',
      Sombre: 'داكن',
      Deconnexion: 'خروج',
      Quitter: 'خروج',
      'Mode invite': 'وضع الزائر',
      'Mon profil': 'ملفي الشخصي',
      Fermer: 'اغلاق',
      'Ce que BLAMUNE sait de toi': 'ما يعرفه BLAMUNE عنك',
      Enregistrer: 'حفظ',
      'Tout oublier': 'نسيان كل شيء',
      'Profil sauvegarde.': 'تم حفظ الملف.',
      'Profil oublie.': 'تم نسيان الملف.',
      'Charger le profil...': 'جار تحميل الملف...',
      'Rien, pour le moment. BLAMUNE apprend en te parlant.':
        'لا شيء بعد. يتعلم BLAMUNE عبر الحديث معك.',
      Nom: 'الاسم',
      Prenom: 'الاسم الأول',
      Age: 'العمر',
      Ville: 'المدينة',
      Metier: 'المهنة',
      Gouts: 'الاهتمامات',
      'Anniversaire (JJ-MM)': 'عيد الميلاد (يوم-شهر)',
      'Effacer tout ce que BLAMUNE a retenu de toi ?': 'هل تريد محو كل ما يتذكره BLAMUNE عنك؟',
      'Profil indisponible pour le moment.': 'الملف غير متاح حاليا.',
      'Lire a voix haute': 'قراءة بصوت عال',
      '▶ lire': '▶ قراءة',
      '⏹ stop': '⏹ إيقاف',
      Langue: 'اللغة',
      'Passer en mode sombre': 'التبديل إلى الوضع الداكن',
      'Passer en mode clair': 'التبديل إلى الوضع الفاتح',
      'Retirer la photo': 'إزالة الصورة',
      'Envoyer une photo': 'إرسال صورة',
      'Envoyer (Entrée)': 'إرسال (Enter)',
      "Voir ce que BLAMUNE enregistre sur toi (et l'oublier)": 'شاهد ما يحفظه BLAMUNE عنك (وانسه)',
      "Rechercher dans l'historique": 'البحث في السجل',
      'Recevoir les messages de BLAMUNE hors du site': 'استلام رسائل BLAMUNE خارج الموقع',
      "Exporter l'historique (fichier texte, il reste chez toi)":
        'تصدير السجل (ملف نصي، يبقى عندك)',
      'Revenir au fil de la conversation': 'العودة إلى المحادثة',
      'Autres actions': 'إجراءات أخرى',
      'Mode vocal : dicter tes messages et entendre les reponses':
        'الوضع الصوتي: أمِل رسائلك واسمع الردود',
      'Mode vocal': 'الوضع الصوتي',
      Conversation: 'المحادثة',
      'Aller au contenu principal': 'الانتقال إلى المحتوى الرئيسي',
      /* page journal.html */
      'Journal du bot': 'سجل البوت',
      'Les bonnes surprises du jour': 'مفاجآت اليوم الجميلة',
      JournalNote:
        'أرقام فقط: ما يبوح به الزوار للبوت يبقى خاصا. هنا نحتفل بحجم ما يتعلمه، وليس بمحتواه.',
      'faits appris au total': 'معلومة تعلمها في المجموع',
      'appris cette semaine': 'تعلمها هذا الأسبوع',
      'messages échangés': 'رسالة متبادلة',
      'réponses notées 👍/👎': 'رد قُيّم 👍/👎',
      'réponses jugées bonnes': 'رد اعتُبر جيدا',
      "jours d'activité": 'يوما نشاط',
      'membres inscrits': 'عضو مسجل',
      'Journal indisponible pour le moment.': 'السجل غير متاح حاليا.',
      '← Discuter avec BLAMUNE': '← تحدث مع BLAMUNE',
      Journal: 'السجل',
      "Voir le journal public du bot (ce qu'il apprend, en chiffres)":
        'شاهد سجل البوت العام (ما يتعلمه، بالأرقام)',
      'Retrouver une phrase de ton historique...': 'ابحث عن جملة من سجلك...',
      'Écris un message...': 'اكتب رسالة...',
      'Pas de resultat.': 'لا نتائج.'
    }
  };

  var NORMALISATION = {
    fr: 'fr',
    en: 'en',
    es: 'es',
    ar: 'ar'
  };

  function detecter() {
    var stocke = '';
    try {
      stocke = localStorage.getItem(CLE) || '';
    } catch (e) {}
    if (NORMALISATION[stocke]) return stocke;
    var l = (navigator.language || 'fr').toLowerCase();
    var deux = l.substring(0, 2);
    return NORMALISATION[deux] || 'fr';
  }

  var langue = detecter();

  function t(cle) {
    var d = DICT[langue];
    if (d && d[cle] !== undefined && d[cle] !== '') return d[cle];
    return cle;
  }

  function appliquer() {
    // data-i18n = texte, data-i18n-ph = placeholder, data-i18n-title =
    // title + aria-label (meme phrase dans les deux).
    var elus = document.querySelectorAll('[data-i18n], [data-i18n-ph], [data-i18n-title]');
    for (var i = 0; i < elus.length; i++) {
      var el = elus[i];
      var cle = el.getAttribute('data-i18n');
      if (cle) el.textContent = t(cle);
      var ph = el.getAttribute('data-i18n-ph');
      if (ph) el.setAttribute('placeholder', t(ph));
      var ti = el.getAttribute('data-i18n-title');
      if (ti) {
        el.setAttribute('title', t(ti));
        el.setAttribute('aria-label', t(ti));
      }
    }
    document.documentElement.lang = langue;
    document.documentElement.dir = langue === 'ar' ? 'rtl' : 'ltr';
  }

  function changer(l) {
    if (!NORMALISATION[l]) return;
    langue = l;
    try {
      localStorage.setItem(CLE, langue);
    } catch (e) {}
    appliquer();
    // Les autres modules peuvent reagir (menu des langues deja affiche).
    if (window.dispatchEvent) window.dispatchEvent(new Event('blamune:langue'));
  }

  window.I18N = {
    t: t,
    appliquer: appliquer,
    changer: changer,
    get: function () {
      return langue;
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', appliquer);
  } else {
    appliquer();
  }
})();
