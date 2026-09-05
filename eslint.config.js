import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // results/ holds committed benchmark artifacts and generated flow code. It is
    // data, not source: linting it would invite editing it, and an edited result is
    // not a result.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.bellwether/**',
      'results/**',
      'coverage/**',
      'docs/**',
      '**/*.md',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Plain .mjs build scripts get their globals from the Node runtime rather than
    // from @types/node, so they need the environment declared explicitly.
    files: ['**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
);
