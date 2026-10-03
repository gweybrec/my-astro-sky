### WP1.0 — Workspace skeleton + first two modules (Sonnet, high care)

- **Goal:** prove that the workspace package works in every toolchain on two trivial modules.
- **Steps:**
  1. In the root `package.json`, add `"workspaces": ["packages/*"]`. **Do not add a dependency entry**: npm links workspaces into `node_modules` by itself.
  2. Create `packages/core/package.json`: name `@myastrosky/core`, private, `"type":"module"`, `"exports": {"./*": "./src/*.ts"}`, no dependencies.
  3. Create `packages/core/tsconfig.json`: `target` ES2022, `module` ESNext, `moduleResolution` bundler, **`lib: ["ES2022"]`, `types: []`**, strict, `verbatimModuleSyntax`, `erasableSyntaxOnly`, noEmit, include `src`.
  4. Create `packages/core/src/env.d.ts` declaring **only**: `console` (log, warn, error), `TextEncoder`, `TextDecoder`, `setTimeout`, `clearTimeout`. Do not add the `DOM` or `WebWorker` libs.
  5. Move the first module and leave a shim:
     - `git mv src/astro-time.ts packages/core/src/astro-time.ts`
     - new `src/astro-time.ts` containing `export * from '@myastrosky/core/astro-time';`
  6. `git mv server/exif-utils.ts packages/core/src/exif-utils.ts`, with a shim at `server/exif-utils.ts`. This proves the server and Electron paths.
  7. Run `npm install`. Check that `node_modules/@myastrosky/core` is a link and that the `package-lock.json` diff contains only the workspace entry.
  8. Add the script `"typecheck:core": "tsc --noEmit -p packages/core/tsconfig.json"` and append it to `typecheck`.
  9. In `.github/workflows/ci.yml`, add a `typecheck:core` step after the two existing typecheck steps (`:24`, `:27`).
  10. In `.github/workflows/test.yml`, add `dev` to both branch lists, so pull requests to `dev` run the tests.
  11. In `.github/workflows/docker.yml`, add `packages/**` to the path filter.
  12. In `vitest.config.ts`, add `packages/**/*.ts` to `coverage.include`.
  13. In `eslint.config.js`:
      - add `packages/**/*.ts` to the TS file glob at line 62;
      - add `./packages/core/tsconfig.json` to the type-aware `project` list at line 69 (without it, core files produce parser errors, which fail CI);
      - add a block for `packages/core/**` with `no-restricted-imports` at **error**, banning `vue`, `pinia`, `@capacitor/*`, `node:*`, `fs`, `path`, `url`, `crypto`, `**/src/**` and `**/server/**`;
      - give `packages/core/**` neither the browser globals block (line 106) nor the Node globals block (line 110).
  14. In the `Dockerfile`, add `COPY packages/ packages/` **before** `npm ci` in both stages.
  15. Create `packages/core/CLAUDE.md`. Rules: no DOM, Node or Vite globals; tests for core modules stay in `tests/unit/` and import through the shims. Add a row for it to the root `CLAUDE.md` table.
  16. Update `docs/dev/ci.md` for the three workflow changes.
- **Acceptance (worker):**
  - `npm run verify` is green.
  - `npm run typecheck:core` is green.
  - `npm run electron:package` succeeds, and `.vite/build/main.js` contains `rawToBrowserCoords`.
  - The packaged app folder contains no dangling `@myastrosky` link (list `out/**/node_modules/@myastrosky`).
  - Then `npm run clean`.
- **Acceptance (orchestrator):** `npm run dev`; a Playwright screenshot shows the sky map with no console errors.
- **Pending CI:** the Docker change is verified by `docker.yml` on the pull request to `master`.
- **Gotchas:**
  - `export *` does not re-export `default`. If a module has `export default`, also add `export { default } from …`.
  - `electron:package` runs `npm run clean` first, which deletes `dist`, `.vite` and `out`. Check that no dev server is running before starting it.
- **Escalate if:**
  - tsx or Vite cannot resolve `@myastrosky/core/*` `.ts` exports;
  - the lockfile diff contains unrelated lines (for example dropped Linux optional dependencies);
  - the packager fails on, or copies, the workspace link;
  - any test needs changes beyond import paths.

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
