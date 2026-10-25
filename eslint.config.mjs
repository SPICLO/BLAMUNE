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
        __dirname: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
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
    // Code navigateur (site/, admin/) : globales du DOM.
    files: ['site/**/*.js', 'admin/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
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
    // node_modules par defaut, plus :
    //  - deepproxy/ : projet externe clone (FreeDeepseekAPI-EN), avec ses
    //    propres regles et un .gitignore dedie.
    ignores: ['node_modules/**', 'build/**', '*.min.js', 'deepproxy/**']
  }
];
