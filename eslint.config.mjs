// Configuration ESLint (flat config, ESLint 9+).
// Installation (optionnelle, hors production) : npm i -D eslint
// Lancement : npx eslint .
export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        URL: 'readonly',
        // Runtime Node >= 18 (deja requis pour le pool et push) : le
        // chercheur web lib/recherche_web.js compte dessus.
        fetch: 'readonly',
        AbortController: 'readonly',
        TextDecoder: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-redeclare': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }]
    }
  },
  {
    // Code navigateur (site/, admin/, blamune-site/) : globales du DOM.
    files: ['site/**/*.js', 'admin/**/*.js', 'blamune-site/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        // site/, admin/, blamune-site/ : animations d'apparition au scroll
        IntersectionObserver: 'readonly',
        fetch: 'readonly',
        self: 'readonly',
        caches: 'readonly',
        location: 'readonly',
        EventSource: 'readonly',
        requestAnimationFrame: 'readonly',
        AbortController: 'readonly',
        TextDecoder: 'readonly',
        FileReader: 'readonly',
        Image: 'readonly',
        SpeechSynthesisUtterance: 'readonly',
        Event: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        Headers: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        // IA_Secours : global pose par site/ia-secours.js (script classique
        // charge avant app.js, voir index.html).
        IA_Secours: 'readonly'
      }
    }
  },
  {
    // Tests unitaires node:test (tests/*.test.js) : describe/it/test/suite et
    // before/after sont des globales fournies par `node --test` (les fichiers
    // ne les importent pas). Sans ca, no-undef les signale.
    files: ['tests/**/*.test.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        suite: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly'
      }
    }
  },
  {
    // vitrine/app.js : PROJETS est pose par vitrine/projets.js (script
    // classique charge AVANT app.js, cf. vitrine/index.html).
    files: ['vitrine/app.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        PROJETS: 'readonly',
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        location: 'readonly'
      }
    }
  },
  {
    // vitrine/projets.js : declare lui-meme PROJETS, pas de global a
    // prefetcher ; le varsIgnorePattern couvre l'absence d'usage local.
    files: ['vitrine/projets.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        document: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^PROJETS$' }
      ]
    }
  },
  {
    // node_modules par defaut, plus :
    //  - deepproxy/ : projet externe clone (FreeDeepseekAPI-EN), avec ses
    //    propres regles et un .gitignore dedie ;
    //  - OpenMontage/ : projet python de montage video dispose a la racine
    //    (non suivi par git), avec son propre outillage et son venv ;
    //  - agent/, .agents/, .claude/, .codex/ : configurateurs locaux
    //    d'agents IA (skills copies, nothing to lint) ;
    //  - .github/agents|hooks|skills : outillage importe (les scripts js
    //    des skills imposent du lint que le projet ne juge pas) ; les
    //    bundles vendus en .umd.js sortent pour tous les dossiers.
    ignores: [
      'node_modules/**',
      'build/**',
      '*.min.js',
      '*.umd.js',
      'deepproxy/**',
      'OpenMontage/**',
      'motion-design/**',
      'videos/**',
      'agent/**',
      '.agents/**',
      '.claude/**',
      '.codex/**',
      '.github/skills/**'
    ]
  }
];
