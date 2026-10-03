### WP1.8 — XISF + `.wcs` sidecar decoding (Sonnet; depends on 1.7)

- **XISF:** in `packages/core/src/raw-decode/xisf.ts`:
  - parse the `XISF0100` signature, the 4-byte little-endian header length and the XML header;
  - read `FITSKeyword` elements into the existing FITS header shape;
  - read the `Image` geometry, `sampleFormat` and an `attachment:` location.
- **Sidecar:** `.wcs` sidecars (ASTAP `.wcs`, astrometry.net `wcs.fits`) are FITS headers. Add `parseWcsSidecar(bytes)` that reuses `parseFITSHeader`.
- **Tests:** synthetic fixtures only, built like the existing FITS builders in `tests/fixtures/`. There are no real XISF files in `test-photos/`.
- **Known limit, written in the module header:** XISF files whose astrometric solution is stored only as XISF Properties (`PCL:AstrometricSolution:*`), not as FITS keywords, are not handled. That needs a real sample from you.
- **Must NOT:** add upload UI. That is a separate desktop card in Phase 6/W4.

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
