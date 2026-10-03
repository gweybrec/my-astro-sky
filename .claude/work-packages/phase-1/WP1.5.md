### WP1.5 — DSO catalog registry (Sonnet; depends on 1.4)

- **Steps:**
  1. Create `packages/core/src/catalog/dso-registry.ts`. Move into it, from `src/dso-catalog.ts`:
     - the columnar JSON → `DSO[]` build and the override overlay;
     - `displayName` resolution, taking `lang` as a parameter;
     - `dsoImportance`, `DSO_CATALOGS_ALL`;
     - the module Maps (`:9`, `:33-34`) and every lookup (`getDSOs`, `getDSOById`, `getDSOImportanceRank`, …);
     - a setter `setDsoCatalog(json, overrides, lang)`.
  2. `src/dso-catalog.ts` keeps only the loader: `fetch('/data/dso.json')` (`:146`), `getDsoOverrides()` (`:116`), then `setDsoCatalog(...)`. It re-exports everything else from the registry.
- **Must NOT:** change the density-gate behaviour (see `src/CLAUDE.md`).
- **Acceptance (worker):** `npm run verify` is green.
- **Acceptance (orchestrator):** the sky map plus a DSO search work in the dev app.

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
