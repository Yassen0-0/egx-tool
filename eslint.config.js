// Lint for the plugins: their screens (plugins/*/src, plugins/shared), the host API, the build and
// the tests. no-undef is the important rule: every name a screen uses must be imported, so a missing
// helper fails here, not in the app.
import globals from 'globals'

export default [
  { ignores: ['plugins/*/client.js', 'plugins/*/vendor/**', 'plugins/*/assets/**'] },
  {
    files: ['plugins/shared/**/*.{js,mjs}', 'plugins/*/src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
    },
  },
  {
    files: ['plugins/*/index.js', 'plugins/*/host/**/*.mjs', 'plugins/test/**/*.mjs', 'plugins/build.mjs', 'plugins/new-plugin.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] },
  },
]
