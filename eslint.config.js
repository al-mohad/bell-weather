import js from '@eslint/js';
import tseslint from 'typescript-eslint';
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
