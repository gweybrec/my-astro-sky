### WP1.2 — Move pure leaf modules, first pass (Haiku; depends on 1.1; parallel-safe with 1.9 only)

- **Goal:** move every pure module into core, in dependency order, each leaving a one-line shim.
- **Candidate order:**
  - `sky-geometry`, `comet-ephemeris`, `horizon-io`, `gear-presets`, `target-recommender`, `imaging-recipe`
  - `projection`, `sky-axes`, `sky-view-math`, `mosaic`, `sky-map-types`, `frame-orientation`, `frame-geometry`
  - `fov-frame-geometry`, `fov-frame-target`, `frame-interaction`
  - `sky-themes`, `star-render-math`, `star-budget`, `render-budget`, `spatial-index`
  - `region-geometry`, `photo-outline`, `color-utils`, `datetime-local`
  - `dso-selection`, `dso-render-math`, `dso-label`, `dso-label-placement`, `dso-highlight`, `hover-hit-test`, `hover-resolve`
  - `photo-search`, `photo-draw-order`, `version-check`, `capture-fields`, `photo-formats`, `delete-utils`, `canvas-theme`
  - `batch-types`, `batch-utils`, `batch-place`, `batch-photo-edit`
- **Do not attempt** (known blocked): `density-slider` (uses `navigator` at `:82`) and `interaction-lod` (imports it).
- **Rule for each file, in order:**
  1. Read its imports, including `import type`. If any import is **not** already in `packages/core/src/`, **skip the file**, add it to the report's "blocked by import" list with the import name, and continue.
  2. `git mv` it and write the shim.
  3. Run `npm run typecheck:core`. If that fails, **revert this file**, add it to the report's "not pure" list with the error, and continue.
  4. Move its entry in `vitest.config.ts` `coverage.exclude`, if it has one.
  5. Run `npx vitest run --reporter=dot` every ~5 files.
- **Gotcha (important):**
  - Before moving module X, run `grep -rn "vi.mock(.*/X'" tests/`.
  - Core files import their siblings **relatively**, so a test that mocks `../../src/X` no longer intercepts imports made from inside core.
  - If such a mock exists and X is imported by another moved module, change the mock path to `@myastrosky/core/X` and note it in the report.
- **Must NOT:** edit logic, rename exports, rewrite an import to make a file movable, or move anything that imports `i18n`, `api`, `dso-catalog` or `star-catalog`.
- **Acceptance (worker):** `npm run verify` is green. The report lists moved files, "blocked by import" files, "not pure" files and changed mocks.
- **Acceptance (orchestrator):** the sky map renders in `npm run dev` with no console errors.

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
