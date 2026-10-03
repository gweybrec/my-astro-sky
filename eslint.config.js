// Flat ESLint config (ESLint 10 + typescript-eslint 8 + eslint-plugin-vue 10).
//
// Adopted in WARN-ONLY mode: the high-value rules below are set to `warn`, and any
// noisy `recommended` rule that would flood the report is downgraded to `warn`/`off`
// here. The goal is a guardrail against *new* issues, not a big-bang cleanup — so
// `npm run lint` is expected to exit 0 (warnings only) and never block CI. Promote a
// rule to `error` once its existing warnings have been paid down. See CLAUDE.md.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    // Anything generated, vendored, or non-source. Mirrors .prettierignore.
    ignores: [
      'node_modules/**',
      'dist/**',
      'out/**',
      'build/**',
      '.vite/**',
      'coverage/**',
      'uploads/**',
      'public/data/**',
      'public/swagger.json',
      'resources/**',
      'other-resources/**',
      '.claude/**',
      'spikes/**',
      '**/android/**',
      '**/ios/**',
      '**/*.min.*',
      'Trace-*.json',
    ],
  },

  // Base JS + TS (syntactic; no type information required).
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Vue SFCs — strongly-recommended rule set (formatting rules are switched off by
  // eslint-config-prettier at the end).
  ...vue.configs['flat/recommended'],

  // Point the <script> block of .vue files at the TS parser. `no-undef` is turned
  // off (as typescript-eslint already does for .ts) because the type-checker, not
  // ESLint, resolves identifiers — including browser globals and Vite `define` consts.
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      'no-undef': 'off',
    },
  },

  // Type-aware linting, scoped to the directories that existing tsconfigs cover
  // (tsconfig.json → src incl. .vue, tsconfig.server.json → server, tsconfig.test.json
  // → src/server/tests). This is what makes `no-floating-promises` possible.
  {
    files: ['src/**/*.{ts,vue}', 'server/**/*.ts', 'tests/**/*.ts', 'packages/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // Explicit list rather than `projectService` — the repo has one root
        // tsconfig.json (src only) plus separate server/test configs, which
        // project-service auto-discovery does not pick up.
        project: [
          './tsconfig.json',
          './tsconfig.server.json',
          './tsconfig.test.json',
          './packages/core/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
    },
  },

  // Highest-value rules (review §3.4) — all `warn` so they never fail the build.
  {
    files: ['**/*.{ts,tsx,mts,cts,vue,mjs,js}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Warn-mode adoption: these `recommended` rules already fire on existing code. Keep
  // them non-blocking (`warn`) so lint never fails CI today; promote to `error` once
  // each has been paid down. This block, not the fixes, is the deliberate carve-out.
  {
    rules: {
      'vue/no-mutating-props': 'warn',
      'prefer-const': 'warn',
      'no-empty': 'warn',
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
    },
  },

  // Environment globals per area (browser for the frontend, node for the rest).
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['server/**/*.ts', 'electron/**/*.ts', 'tests/**/*.ts', '*.config.{ts,js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },

  // @myastrosky/core must stay platform-neutral (browser, worker, Node, Electron, Capacitor):
  // no framework, no Node built-ins, and no imports back into the app. This block gets neither
  // the browser nor the Node globals above. `error`, not `warn`: a violation must fail CI.
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['fs', 'path', 'url', 'crypto'].map((name) => ({
            name,
            message: 'core must not depend on Node built-ins.',
          })),
          patterns: [
            { group: ['vue', 'vue/*'], message: 'core must not depend on Vue.' },
            { group: ['pinia', 'pinia/*'], message: 'core must not depend on Pinia.' },
            { group: ['@capacitor/*'], message: 'core must not depend on Capacitor.' },
            { group: ['node:*'], message: 'core must not depend on Node built-ins.' },
            { group: ['**/src/**', '**/server/**'], message: 'core must not import from the app.' },
            {
              group: ['@myastrosky/core', '@myastrosky/core/*'],
              message: 'core must import itself with relative paths.',
            },
          ],
        },
      ],
    },
  },

  // Build/CLI scripts: plain ES modules, no type information, and console output is
  // their whole job — so silence `no-console` here.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Must be last: turns off every ESLint/Vue rule that conflicts with Prettier so
  // Prettier is the sole authority on formatting.
  prettier,
);
