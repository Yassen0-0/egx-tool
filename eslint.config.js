// Lint for the screens (bundle/src), the host API and the tests. no-undef is the important rule:
// every name a screen uses must be imported, so a missing helper fails here, not in the app.
import globals from 'globals'

export default [
  {
    files: ['bundle/src/**/*.{js,mjs}'],
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
    files: ['bundle/host/**/*.mjs', 'bundle/test/**/*.mjs', 'bundle/build-client.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] },
  },
]
