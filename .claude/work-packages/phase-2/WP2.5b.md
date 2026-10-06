# WP2.5b — An import writes image files only for the photos it imports

Model: sonnet · Depends on: WP2.3e · Parallel-safe with: nothing · Needs device: no · Needs browser: no

## Goal

Decided by the user on 2026-10-04: **if no image is imported, no image file is written.** `tests/unit/server-backup.test.ts` recorded that `POST /api/import`, when the form field `selectedImages` is absent, writes every image and thumbnail of the ZIP into the uploads folder even when no photo is imported (for example an import of plans only). The app itself always sends the field when the bundle has images, so users of the app are not affected; the route must still not leave files that belong to no photo.

## Step 0

Check `git branch --show-current` is `mobile/phase-2`, that `git status --short` shows no modified tracked files, and that `npx vitest run tests/unit/server-app.test.ts tests/unit/server-backup.test.ts` passes. If not, stop.

## Read first

`server/routes/backup.ts`, the import route: how `importMetadata` and `selectedImages` are read, where photo records are created from `manifest.json`, and where image and thumbnail files are written (near the `selectedImages !== null && !selectedImages.has(baseName)` test). `src/api.ts` `importData` and `src/components/modals/ImportModal.vue` to see what the app sends.

## The rule to implement

An image file (and its thumbnail) of the bundle is written to the uploads folder **only if its photo record is imported by the same request**. Work out from the route which requests import a photo record today, and make the file writing follow exactly that. In particular:

- `selectedImages` absent and no photo record imported (no `importMetadata`, or a bundle without a manifest): no file is written;
- `selectedImages` absent and photo records imported: as today (all photos);
- `selectedImages` present: as today.

If, after reading the route, you find a request that today imports photo records without `importMetadata` (or files that are legitimately written without a record), stop and report: the rule would need the Planner's decision.

## Tests

`tests/unit/server-backup.test.ts`: this card may change this file **only** to replace the `KNOWN GAP` about files written by a plans-only import with the assertion that the uploads folder stays empty, and to add: an import with `importMetadata` and no `selectedImages` still imports all photos and their files; an import with `selectedImages` empty writes nothing. The round trip between instances A and B must pass as before.

## Must NOT

- Change the export, the preview, the frontend, or any other part of the import.

## Acceptance (worker)

- `npx vitest run tests/unit/server-backup.test.ts tests/unit/server-app.test.ts` pass; `server-backup.test.ts` passes three times in a row.
- `npm run swagger:generate` leaves `public/swagger.json` unchanged.
- `npm run verify` is green.

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user asked for this fix on 2026-10-04**, on the `mobile/phase-2` branch. Never push.
- **One commit**, with files staged by explicit path. Before committing, check `git branch --show-current` is `mobile/phase-2`.
- Message: `fix: write image files only for the photos an import brings in`.
- **Never add a `Co-Authored-By` line or any AI attribution.**

## Always forbidden

- Do not start a dev server. Do not kill any process you did not start (port 3001 may be in use by the user's own app).
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create.

## Report

Files changed · which requests import photo records, as you found them in the route · the test cases added or changed · acceptance output · deviations · open questions.
