### WP1.6 — Second pass of leaf moves (Haiku; depends on 1.5b)

- Run the WP1.2 rule on the files that are now unblocked:
  - `dso-render-select`, `sky-hit-test`, `multiple-stars`, `batch-wcs`
  - `poi`, `format-utils`, `sky-trajectory`
  - `asteroid-identify`, `comet-identify`, `supernova-identify`
  - `plan-sort`
- **Expected to stay blocked — report, don't fix:**
  - `observation-windows` (imports `filterCssKey` from the DOM module `chip-utils`);
  - `photo-placement` (imports `error-reporter`, which uses `window`);
  - `setup-info` (imports `gear-catalog`, which fetches);
  - `frame-controller` (imports `TILE_TRASH_R` from `sky-draw` and uses `requestAnimationFrame`).
- The Planner turns that report into small Sonnet cards (inject a logger, move a constant) at the start of Phase 3.

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
