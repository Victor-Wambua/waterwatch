import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'coverage', 'public/vendor', 'data', 'playwright-report', 'test-results', 'design', 'tools', 'scripts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: { window: 'readonly', document: 'readonly', navigator: 'readonly', fetch: 'readonly', indexedDB: 'readonly', localStorage: 'readonly', URL: 'readonly', FormData: 'readonly', Blob: 'readonly', File: 'readonly', Image: 'readonly', self: 'readonly', caches: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', crypto: 'readonly', HTMLElement: 'readonly', Event: 'readonly', CustomEvent: 'readonly', L: 'readonly', URLSearchParams: 'readonly', Promise: 'readonly', Response: 'readonly', Request: 'readonly', location: 'readonly', confirm: 'readonly', requestAnimationFrame: 'readonly', createImageBitmap: 'readonly', OffscreenCanvas: 'readonly', MutationObserver: 'readonly', IntersectionObserver: 'readonly' } }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      eqeqeq: ['error', 'always']
    }
  }
);
