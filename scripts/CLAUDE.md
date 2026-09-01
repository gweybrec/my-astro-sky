# CLAUDE.md — `scripts/`

Auto-loaded when you touch a file under `scripts/`. Cross-cutting rules stay in the root
`CLAUDE.md`.

## DSO catalog regeneration

After editing `scripts/dso-metadata-overrides.json` or `scripts/generate-dso.mjs`:

```bash
npm run dso:generate   # generate-dso.mjs && add-constellations.mjs && add-ratings.mjs
```

This single command rebuilds `public/data/dso.json`, recomputes constellations, and
(re)computes the four derived columns — `rating`, `difficulty`, `containerId`,
`priority` — via `scripts/add-ratings.mjs`. The runtime DSO density gate ranks by
**intrinsic quality** (`dsoImportance` = rating/brightness, in `src/dso-catalog.ts`),
area-weighted so on-screen density tracks the true sky (Milky Way denser) with the
stereographic projection bias removed — it no longer uses the blue-noise `priority`
column, which is retained but currently only informational. `tests/unit/dso-json-schema.test.ts`
still asserts the committed `dso.json` has all these columns fully populated, so CI
catches it if the generation chain is ever broken apart again.

`add-ratings.mjs` is idempotent: it strips any derived columns from a prior run before
recomputing, so it's also safe to run standalone (`node scripts/add-ratings.mjs`) after
changing its rating/difficulty/containment/priority logic, without a manual reset step.

To correct a DSO's name, type, coordinates, or rating, edit
`scripts/dso-metadata-overrides.json` — the `override-dso-metadata` skill walks through it.

## Filter catalog colours

`npm run filters:seed` (`scripts/seed-filter-colors.mjs`) seeds the per-entry `color`
on `resources/filters.json`; it only fills entries missing a valid `#rrggbb`, so hand
overrides survive. Run it after appending filters to the catalog. Filters are served at
`GET /api/filters` and consumed via `src/gear-catalog.ts` (they are **not** part of a
gear setup — picked per integration row / observation window).
