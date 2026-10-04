# WP2.4b — Pin the plan and photo routes more tightly before they move

Model: sonnet · Depends on: WP2.5a · Parallel-safe with: nothing · Needs device: no · Needs browser: no

## Goal

The plan and photo routes are the two largest domains still to move into services (cards WP2.3f to WP2.3h). `tests/unit/server-app.test.ts` covers their main paths but leaves many branches untested. This card adds those cases, recording today's behaviour, so that the service cards have a real safety net. **No product code changes.**

## Step 0

Check `git branch --show-current` is `mobile/phase-2`, that `git status --short` shows no modified tracked files, and that `npx vitest run tests/unit/server-app.test.ts tests/unit/server-backup.test.ts` passes. If not, stop.

## Read first

`tests/CLAUDE.md`, `tests/unit/server-app.test.ts` (its harness and style), `server/routes/plans.ts`, `server/routes/photos.ts`, `server/routes/shared.ts`.

## What to add

Create `tests/unit/server-app-plans-photos.test.ts`, with the same harness as `server-app.test.ts` (copy what you need, or move shared helpers to `tests/helpers/` without changing any existing assertion). For every case: send the request through the real app and assert the status and the exact body. **Record, do not judge:** if a response looks like a bug, assert it as it is, mark it `// KNOWN GAP:` with one sentence, and list it in the report.

### Plans

1. `PUT /api/plans/:id`: blank name; `lat` out of range and not finite; `lon` out of range; unknown `sortBy` (the message lists the keys); a body with none of the recognised keys; settings where `lat` is a string (stored as null); `nightOf` and `setupId` cleared by an empty string. After each accepted request, read the plan back.
2. `POST /api/plans/:id/entries`: neither `dsoId` nor numeric `ra`/`dec`; `dsoId` not a string; a custom entry with `paDeg`; the duplicate 409 body with its code; a duplicate against a mosaic tile of the same object.
3. `PATCH /api/plans/:id/entries/:entryId`: each key with a wrong type (`paDeg`, `ra`, `dec`, `mosaicWDeg`, `mosaicHDeg`, `dsoId`, `observationWindows`); no recognised key; an unknown entry id; a body with `notes` only.
4. Observation windows through that `PATCH`: reversed bounds are swapped; values outside 0..1 are clamped; a window narrower than the minimum is widened; a long filter and colour are cut; `frameSeconds` not above zero becomes null; `snap` not boolean becomes false; a missing id gets one (assert its form with a pattern); unknown keys are dropped; non-objects and non-numeric bounds are skipped.
5. `PUT /api/plans/:id/entries/order`: `ids` not an array; ids of another plan are ignored; an unknown id is ignored; a partial list leaves the others where they were.
6. `DELETE /api/plans/:id/entries/:entryId`: unknown entry.
7. Mosaics: each rejection of the body (`centerRa`/`centerDec`, empty `tiles`, a tile without numbers); defaults when `cols`, `rows`, `overlapPct`, `paDeg` are absent; `cols` and `rows` below 1; creating a mosaic for an object that already has a standalone entry removes that entry; `replaceEntryIds` removes the listed entries; `PUT` and `DELETE` with a mosaic id of another plan and with an unknown id; updating a mosaic replaces its tiles; a tile's id form.
8. Deleting a plan removes its entries and mosaics: delete, recreate a plan, check the lists hold nothing of the old one (use what the API exposes).
9. Positions: create three plans, delete the first, create a fourth, and record the positions and the order that `GET /api/plans` returns.
10. Requests with no body at all on `POST /api/plans`, `POST …/entries`, `PUT …/entries/order`, `PATCH …/entries/:id`: record the status and body.

### Photos

11. `POST /api/photos`: extension not allowed; `correspondences` not JSON; fewer than two; more than the maximum; each per-item rejection with its code (`pointIndex`, `photoX`, `photoY`, `starHip` zero without coordinates, `starHip` invalid); a file that is not an image (a text buffer named `.png`): the probe rejection; a MIME type the upload filter refuses; `displayName` given and absent; an unreadable `manualPlacement` field (ignored); a JPEG with EXIF orientation 6 made with `sharp` (assert the stored width and height, the correspondences returned, and the dimensions of the stored file read back with `sharp`); two correspondences with the same `pointIndex` (record the status, the body, and whether files are left in the uploads folder).
12. `PATCH /api/photos/:id/metadata`: each field with a wrong type; `notes` longer than the limit; `originalName` blank and too long; `observationDate` omitted after having been set (record what happens to the stored date); integration rows with invalid entries (zero, negative, non-integer, empty filter): assert exactly what `GET /api/photos` returns afterwards; points of interest with an out-of-range coordinate, an empty name, a missing category; capture details with unknown keys and non-finite numbers; `gearSetupId` too long.
13. `PATCH /api/photos/:id/manual-placement`: clearing it with `null`; an arbitrary object is stored as given.
14. `PATCH /api/photos/order`: duplicates; a list missing a photo; an empty list with photos present and with none; a non-string element.
15. `DELETE /api/photos` (bulk): `ids` not an array; a mix of known, unknown and non-string ids; files removed for the known ones; the `deleted` count.
16. `DELETE /api/photo-metadata`: rows gone, correspondences gone, and record what is left in the uploads folder.
17. `GET /api/photos` when a photo's file was removed from the uploads folder by the test: `fileSize`. `DELETE /api/photos/:id` for that photo.
18. The upload rate limit is not tested (it needs 200 uploads).

Keep the file under 40 seconds. No network.

## Must NOT

- Change any file under `server/`, `packages/` or `src/`, or any assertion of an existing test.
- Add a dependency.

## Acceptance (worker)

- `npx vitest run tests/unit/server-app-plans-photos.test.ts` passes three times in a row; give its duration and its test count.
- `npx vitest run tests/unit/server-app.test.ts tests/unit/server-backup.test.ts` pass.
- `npm run verify` is green.

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit**, with files staged by explicit path. Before committing, check `git branch --show-current` is `mobile/phase-2`.
- Message: `test: cover the remaining branches of the plan and photo routes`.
- **Never add a `Co-Authored-By` line or any AI attribution.**

## Always forbidden

- Do not start a dev server. Do not kill any process you did not start (ports 5173 and 3001 may be in use by the user's own app; another agent may run a server on port 3199).
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create.

## Report

Files created · the number of cases per numbered item · every `KNOWN GAP` with its exact behaviour · acceptance output · deviations · open questions.
