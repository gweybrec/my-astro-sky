### WP1.4 — i18n platform injection (Sonnet; depends on 1.7)

- **Steps:**
  1. `git mv src/i18n/{index,fr,en,es,de}.ts` into `packages/core/src/i18n/`.
  2. Leave shims at the old paths. The dictionaries use **default exports** (`import fr from './fr'`), so each shim is `export { default } from '@myastrosky/core/i18n/fr';`. The index shim is `export * from '@myastrosky/core/i18n/index';`.
  3. In the core `index.ts`:
     - Add `export interface I18nPlatform { storedLang(): string|null; storeLang(l: Lang): void; preferredLanguages(): readonly string[]; reload(): void; onMissingKey?(k: string): void }`.
     - Add `configureI18n(p)`, which sets the platform and resets `currentLang`.
     - The default platform returns `null` and `[]`, and its reload is a no-op.
     - Replace `localStorage`, `navigator`, `location` and `import.meta.env.DEV` at lines 14, 18, 38, 39, 60 with platform calls.
  4. Create `src/platform-init.ts`. It configures the browser platform; `onMissingKey` calls `console.warn` only when `import.meta.env.DEV` is set.
  5. Make it the **first import** in `src/main.ts`.
  6. Add `test.setupFiles: ['tests/setup/platform.ts']` (which imports `src/platform-init`) to `vitest.config.ts`.
  7. Move `affine.ts` (it only uses `t`) with a shim.
- **Gotcha (important):** 21 tests use `vi.mock('../../src/i18n')`. After this card, core modules import `./i18n` relatively and bypass that mock. For each of those tests, check whether the module under test is now in core; if so, change the mock path to `@myastrosky/core/i18n/index`. List every changed test in the report.
- **Acceptance (worker):** `npm run verify` is green, including the i18n parity test.
- **Acceptance (orchestrator):** in the dev app, switching the language to EN reloads in English.

## Commits

- `CLAUDE.md` forbids committing without your explicit permission. **You gave it on 2026-10-03: commits are allowed on the new branches only.**
  That means the `mobile/*` and `spike/*` branches created from `dev` for this work. Never on `master` or `dev`. Never push.
- **One commit per card**, made by the worker when its acceptance passes, with files staged by explicit path.
- Before committing, the worker checks `git branch --show-current`. If it is not a `mobile/*` or `spike/*` branch, it stops and reports.
- Message format: Conventional Commits. Use `internal(refactor): …` for moves and plumbing, `internal(mobile): …` for spikes.
- **Never add a `Co-Authored-By` line or any AI attribution.** The root `CLAUDE.md` forbids it, and that rule overrides the harness default.
- Never push.

## Always forbidden

- Do not start a dev server. Do not kill any process.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not add Co-Authored-By or any AI attribution.
- Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash` or `git reset --hard`.
- Do not touch untracked files that you did not create.
