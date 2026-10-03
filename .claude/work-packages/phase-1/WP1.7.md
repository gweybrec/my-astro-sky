### WP1.7 — Server decoders to `Uint8Array` (Sonnet; depends on 1.7a)

- **Steps:**
  1. Move the pure parts of `server/wcs-reader.ts` to `packages/core/src/wcs.ts`: `parseFITSHeader` (225), `extractFITSHeaderFromFITS` (348), `extractFITSHeaderFromTIFF` (281), `extractWCS` (710), `wcsToCorrespondencesWithCatalog`, `CAPTURE_FITS_MAP` (62).
  2. `server/wcs-reader.ts` keeps `loadServerCatalog` (161) and the `wcsToCorrespondences` wrapper, and re-exports the rest.
  3. Move `server/raw-decode/{fits-decoder,tiff-ifd,tiff-decoder,linear-map,codec/*}` to `packages/core/src/raw-decode/`. **Leave a shim at every old path**: 7 test imports target them. `server/raw-decode/index.ts` (sharp) stays.
  4. Replace `Buffer` with `Uint8Array` + `DataView`:
     - build the `DataView` with the array's `byteOffset` and `byteLength`;
     - use `subarray`, never `slice`;
     - `getUint16(o, true)` for little-endian; FITS data is big-endian, so pass `false`.
  5. Replace `toString('ascii', a, b)` with `new TextDecoder('latin1').decode(sub)`.
  6. Replace `zlib.inflateSync` (`tiff-decoder.ts:40`) with `fflate.unzlibSync`. Add `fflate` as a dependency of `packages/core`.
  7. Server files were never compiled under `erasableSyntaxOnly`. Rewrite parameter properties as plain fields (a mechanical change, authorised here).
- **Gotchas:**
  - `Buffer` is a `Uint8Array` subclass, so existing tests passing Buffers must still pass **unchanged**.
  - Apply the `vi.mock` gotcha from WP1.2.
- **Acceptance (worker):** `npm run verify` is green.
- **Acceptance (orchestrator):** the `test-placement` skill: upload a FITS/TIFF with WCS in the dev app and check its placement.
- **Escalate if:** a test has to change beyond a mock path.

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
