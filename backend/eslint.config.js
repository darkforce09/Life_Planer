import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

/**
 * Flat ESLint config (ESLint v9+/v10).
 *
 * Pragmatic ruleset: the noisy stylistic rules are warnings so the existing
 * codebase passes CI, while genuinely useful checks stay enabled. Tighten over
 * time by promoting warnings to errors.
 */
export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'drizzle/**',
      // Local scratch / debug experiments (not part of the shipped app).
      'src/scripts/debug-*.ts',
      'src/dump-cookies.ts',
      'src/debug-canvas-*.ts',
      'src/analyze-html*.ts',
    ],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  prettier,
];
