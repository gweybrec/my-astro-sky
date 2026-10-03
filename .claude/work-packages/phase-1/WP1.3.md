### WP1.3 — Shared domain types + dedupe (Sonnet; depends on 1.2; not parallel with 1.2 or 1.7)

- **Why sequential:** this card edits files that 1.2 moves (`comet-ephemeris`, `horizon-io`) and a file that 1.7 splits (`server/wcs-reader.ts`).
- **Steps:**
  1. Move these interfaces from `src/api.ts` into `packages/core/src/domain/{plans,gear,settings,backup,solve,stars}.ts`: `LatestRelease`, `StarSearchResult`, `ConvertRawPhotoResult`, `AstrometrySubmission`, `Export*`, `Import*`, `ServerSettings`, `SolverAvailability`, `GearSetupData`, `SkyRegionData`, `ObservationWindow`, `PlanEntry`, `PlanMosaic`, `MosaicTileInput`, `MosaicParams`, `PlanSortKey`, `Plan`. Their lines in `api.ts` are 34, 86, 278, 554, 592–734, 745, 886, 1010, 1074–1160.
  2. `StarMultiplicity` exists in both `api.ts:81` and core `types.ts`. Keep the `types.ts` one and re-export it from `api.ts`.
  3. Make `api.ts` re-export all of them with `export type {…} from '@myastrosky/core/domain/…'`, so importers stay unchanged.
  4. Annotate the return types of the server mappers with these types: `planEntryToApi` (`index.ts:2232`), `planMosaicToApi` (`2254`), `poiCategoryToApi` (`1775`), `skyRegionToApi` (`1988`), `rowToPhoto` (`db.ts:322`).
  5. Unify `CometElements` (`server/comets.ts:19` / core `comet-ephemeris`) and `HorizonSummit` (`server/horizon.ts:23` / core `horizon-io`) on the core definition.
  6. Dedupe `normalizeRA` (`server/star-search.ts:87`, `server/wcs-reader.ts:155`, `src/star-catalog.ts:22`) into `packages/core/src/angles.ts`.
  7. Dedupe the angular distance helpers (`dso-catalog.ts:136`, `light-solve.ts:130`, `ui.ts:59`, and `angularDistDeg` at `fov-overlay.ts:64`) into the existing `angularSeparationDeg` (`sky-geometry.ts:54`).
  8. Steps 6 and 7 apply **only where the implementations are semantically identical**: same units, same range, same formula.
  9. In `plan-sort.ts` and `observation-windows.ts`, repoint the **type-only** imports from `./api` to the core domain files. Nothing else in those files changes.
- **Escalate if:**
  - a mapper's actual output doesn't match the client type, beyond optional fields;
  - the dedupe candidates differ in semantics. List the differences; don't pick one.

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
