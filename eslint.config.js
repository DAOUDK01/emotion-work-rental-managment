import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/coverage/**', 'data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Finnish money formatting uses non-breaking spaces ("1 234,50 €") in strings and comments
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipComments: true, skipTemplates: true, skipRegExps: true },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
