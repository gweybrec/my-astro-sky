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

The raw source images those solves came from are in the gitignored `test-photos/` directory (local only) — see `test-photos/CLAUDE.md` if present.

CI runs the full suite on every push/PR via `.github/workflows/test.yml` (Node.js 24).
