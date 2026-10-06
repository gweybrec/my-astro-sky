# WP2.8 — The backup service (export, import preview, import)

Model: sonnet · Depends on: WP2.7h · Parallel-safe with: nothing · Needs device: no · Needs browser: no

## Goal

`server/routes/backup.ts` is the last feature whose logic lives in a route. It is also the bridge between a user's devices: a backup made on the phone must restore on the desktop and the other way round. Move the logic into `packages/core/src/services/backup.ts`, behind two small ports for reading and writing the archive, so that the phone runs the same code. **No behaviour changes:** `tests/unit/server-backup.test.ts` pins these routes and must pass **unedited**, with `tests/unit/server-app.test.ts` and `tests/unit/server-app-plans-photos.test.ts`.

## Read first

- `.claude/work-packages/phase-2/WP2.3-first-services.md`: the pattern, including "Rules added on 2026-10-05". Its "Must NOT", "Acceptance" and "Escalate if" apply here.
- `server/routes/backup.ts` (all of it), `server/import-utils.ts`, `packages/core/src/domain/backup.ts`, `tests/unit/server-backup.test.ts`, `tests/unit/import-export.test.ts`, `tests/unit/import-setup-actions.test.ts`.
- Model to copy: `packages/core/src/services/photos.ts` (a service with ports), `server/create-services.ts`.

## Step 0

Check `git branch --show-current` is `mobile/phase-2`, that `git status --short` shows no modified tracked files, and that the three pinning tests pass. If not, stop.

## Steps

1. **Ports**, in `packages/core/src/ports/bundle.ts`:

   ```ts
   /** Writes the files of a backup archive, one after the other. */
   export interface BundleWriter {
     add(name: string, bytes: Uint8Array): Promise<void>;
   }
   /** Reads a backup archive. */
   export interface BundleReader {
     /** The names of the files in the archive. */
     names(): Promise<string[]>;
     /** The bytes of one file, or null when the archive has no such file. */
     read(name: string): Promise<Uint8Array | null>;
     /** The uncompressed size of one file, or null. */
     size(name: string): Promise<number | null>;
   }
   ```

   Server adapters in `server/bundle-zip.ts`: a writer over `archiver` that streams to the HTTP response as today (same archive options, same entry names and order), and a reader over `unzipper` as today (same limits and path checks: keep `isValidZipEntryPath` and the size limits where they are enforced now). A plain JSON import (the route accepts a JSON array as well as a ZIP: check) keeps working: give the service a second entry point or a reader over that JSON, whichever reproduces today's behaviour.

2. **`packages/core/src/services/backup.ts`**, `createBackupService({ photos, plans, gear, dsoOverrides, poiCategories, skyRegions, blobs, newId })` (it uses the other services and the blob store; it does not touch the database directly unless a read is needed that no service offers: then add that read to the owning service):
   - `exportTo(writer, options)`: what `POST /api/export` writes today, in the same order, with the same `manifest.json` (version included) and data files;
   - `preview(reader)`: what `POST /api/import/preview` returns today;
   - `importFrom(reader, selection)`: what `POST /api/import` does today, in the same order, including the plan-setup rules (`planSetupImportActions`), the image-file rule (files only for the photos imported), the thumbnail regeneration, the per-item failure list (`failed`), and the same response.
     The pure helpers of `server/import-utils.ts` that the service needs move to core (next to the service or in `packages/core/src/domain/backup.ts`); `server/import-utils.ts` re-exports them so that existing tests keep their imports. Types of the options, the selection, the preview and the result live in `packages/core/src/domain/backup.ts`.
3. **Round trips.** An import writes many rows. Each item (one plan, one setup, one photo with its correspondences) is one grouped write through its service, as those services already do; the backup service must not add per-row calls of its own. Assert in the service test, with the counting double, that the number of database round trips of an import grows with the number of **items**, not with the number of rows inside an item (state the formula).
4. **Route:** `server/routes/backup.ts` keeps multer, the response headers and streaming, and calls the service. Register the service in `createServices`.
5. **Tests:** `tests/unit/backup-service.test.ts` runs export, preview and import with in-memory fakes of the two ports and of the blob store and codec, on both database adapters: a full round trip between two service sets; a partial import; an item that fails (the others arrive; `failed` lists it); a bundle with a missing data file; a manifest of an unknown version (record today's behaviour). The cases of `tests/unit/import-export.test.ts` that test helpers keep passing unedited.
6. **Docs:** the services table of `docs/dev/mobile-architecture.md`, and the two ports in its ports table (server: archiver and unzipper; phone: to be decided, fflate).
7. **What is left.** Report what remains in `server/routes/backup.ts`, and confirm that `server/db.ts` only opens the database, creates the schema and exposes the connection.

## Must NOT

- Change the archive format, the manifest, any entry name, or any response.
- Buffer a whole export in memory on the server (the writer streams, as today).
- Touch the frontend.

## Escalate if

- `server-backup.test.ts` would have to change.
- The service needs something from the HTTP request that cannot be expressed as options or a reader (say what).
- Streaming cannot be kept with the writer port as specified (propose the smallest change to the port).

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit**, with files staged by explicit path, including this card's row in the status table at the end of `.claude/work-packages/README.md` (the row named "Backup service"). Before committing, check `git branch --show-current` is `mobile/phase-2`.
- Message: `internal(refactor): move export and import into a core service`.
- **Never add a `Co-Authored-By` line or any AI attribution.**

## Always forbidden

- Do not start a dev server or use a browser. Do not kill any process you did not start.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create (`.claude/work-packages/mobile-review-2026-10-04.md` is the user's: never stage it).

## Report

Files changed and created · the service's method list with signatures and the final text of the port file · the round-trip formula of an import · what is left in `server/routes/backup.ts` and `server/db.ts` · tests rewritten · acceptance output · "Seen, not fixed" · deviations · open questions.
