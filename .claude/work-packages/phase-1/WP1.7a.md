### WP1.7a — Inject the catalog into `wcsToCorrespondences` (Sonnet; depends on 1.3)

- **Goal:** remove the hidden `fs` dependency before the move.
- **Steps:**
  1. In `server/wcs-reader.ts`, add a pure function `wcsToCorrespondencesWithCatalog(wcs, catalog, …)` holding today's body, with the catalog as a parameter.
  2. Keep `wcsToCorrespondences(…)` with its **exact current signature** as a thin wrapper that calls `loadServerCatalog()` and then the new function.
  3. Replace the `console.log` at `:474-476` with nothing, or with the injected logger if one exists; do not add new output.
- **Acceptance:** `npm run verify` green, with **no test file changed** (3 tests mock `../../server/wcs-reader`).
- **Escalate if:** any test has to change.

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
