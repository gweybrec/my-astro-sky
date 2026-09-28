# CLAUDE.md — `tests/`

Auto-loaded when you touch a file under `tests/`. Cross-cutting rules stay in the root
`CLAUDE.md`.

## Unit Tests

The test suite uses **Vitest 3** + **happy-dom**. Tests live under `tests/` (mainly `tests/unit/`, plus `tests/components/`). Run with `npm test`. To count the test files: `git ls-files 'tests/**/*.test.ts' | wc -l`.

### Testing rule

Before finishing any edit to a `.ts` file in `src/` or `server/`, check `tests/unit/` for a matching test file (e.g. editing `src/affine.ts` → look for `tests/unit/affine.test.ts`). Update or add tests for any changed or new logic. Skip files explicitly excluded in `vitest.config.ts` — they are listed there with comments explaining why (DOM-only, fetch-only, entry points).

A PostToolUse hook (`.claude/hooks/vitest-on-ts-edit.js`) runs `npx vitest run` automatically after any Edit or Write to `src/**/*.ts` or `server/**/*.ts`, so regressions surface immediately.

### Vue component tests

Use `@vue/test-utils` `mount` (not `@testing-library/vue`). Content rendered through a `<Teleport>` lands on `document.body`, not inside the wrapper — query `document.body` for it.

### Fixtures in `tests/fixtures/`

- `solve-field/LDN1235.wcs` and `M1_CCD_siril.wcs` — real WCS files from local solve-field runs
- `astrometry/10796000-*.json` and `10796000-wcs.fits` — real data from nova.astrometry.net job 10796000 (M13 field)
- `stars.test.json` — minimal 6-star catalog for deterministic WCS tests
- `tiff-builders.ts` / `fits-builders.ts` — synthetic TIFF/FITS file builders for `server/raw-decode/` decoder tests (not `.test.ts`, so not collected as a suite)
- `skybot/ngc4438-conesearch.json` — real IMCCE SkyBoT response (top 25 nearest of 1273, trimmed) for a 3′ cone at the `NGC4438-CCD_(18799) 1999 JZ73.fit` test photo's field/epoch; includes asteroid 18799 at rank 1 — the asteroid-identification regression fixture
- `tns/ngc7331-search.csv` — real IAU Transient Name Server CSV export (60′ cone around NGC 7331, discoveries 2024-01-01 → 2026-09-28): SN 2026aaiv and SN 2025rbs (the `test-photos/NGC7331_*` supernovae) plus unclassified AT rows — the supernova-identification regression fixture
- `comets/CometEls-sample.txt` — real lines of the MPC's `CometEls.txt` (epoch 2026-09-28): 10P, C/2024 E1 and C/2025 R2 (the three comet photos of the development database), hyperbolic C/2008 S3, near-parabolic C/2014 R3, fragment 51P-A and 2P — the comet-identification regression fixture

The raw source images those solves came from are in the gitignored `test-photos/` directory (local only) — see `test-photos/CLAUDE.md` if present.

CI runs the full suite on every push/PR via `.github/workflows/test.yml` (Node.js 24).
