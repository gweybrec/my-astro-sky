# WP2.3f to WP2.3h — The plan service and the photo service

Model: sonnet for all · One sub-card at a time, in order · Depends on: WP2.4b · Needs device: no · Needs browser: no

Each sub-card is run by its own worker and makes **one commit**. The worker's prompt is this whole file plus the line "Run sub-card WP2.3x only".

## Read first

`.claude/work-packages/phase-2/WP2.3-first-services.md`: its sections "Goal", "The pattern", "Must NOT", "Acceptance" and "Escalate if" apply here word for word, with these additions:

- **Three tests pin the behaviour and must pass unedited:** `tests/unit/server-app.test.ts`, `tests/unit/server-app-plans-photos.test.ts` and `tests/unit/server-backup.test.ts`. The only exceptions are the ones a sub-card names.
- Models to copy: `packages/core/src/services/gear.ts` with `server/routes/gear.ts` (a service with backup helpers and a transaction), `server/services.ts`, `server/routes/http-errors.ts`.
- A handler that logs with `console.error` or `console.log` today keeps that log, in the route, for the same cases.
- A `DomainError` carries the exact body of today's response in `body` whenever that body is more than `{ error: message }` (the French messages with a `code`).
- Inside a `db.transaction` body, only `tx` calls are awaited. Image and file work happens before or after it, never inside.
- Rule 6 of the pattern applies to `server/routes/backup.ts` too: it must call the service; the old `server/db.ts` functions are deleted when nothing uses them.

## Step 0 (every sub-card)

Check `git branch --show-current` is `mobile/phase-2`, that `git status --short` shows no modified tracked files, and that the three pinning tests pass before you change anything. If not, stop.

---

## WP2.3f — Plans

### What exists (verified 2026-10-04; re-check line numbers)

- `server/routes/plans.ts` (12 routes), the mappers `planEntryToApi`, `planMosaicToApi` and the list `PLAN_SORT_KEYS` in `server/routes/mappers.ts`, `parseMosaicBody` in the route file, and about 25 functions in `server/db.ts` (from `getPlans` to `reorderPlanEntries`), including `sanitizeObservationWindows` and the three transactions `deletePlan`, `createPlanMosaic`, `updatePlanMosaic`, `deletePlanMosaic`, `reorderPlans`, `reorderPlanEntries`.
- There is no tile table: a mosaic tile is a `plan_entries` row with `mosaic_id` set and the id `tile-<mosaicId>-<position>`. There are no foreign keys between the plan tables: every cascade is explicit.
- The API types are in `packages/core/src/domain/plans.ts` (`Plan`, `PlanEntry`, `PlanMosaic`, `ObservationWindow`, `MosaicTileInput`, `MosaicParams`, `PlanSortKey`).
- `server/routes/backup.ts` exports plans (it calls `getPlans`, `getAllPlanEntries`, `getAllPlanMosaics` and the two mappers) and imports them (per selected plan: delete the plans of the same name, delete the plan of the same id, `createPlan`, `addPlanEntry` per entry, `addPlanMosaic` per mosaic, inside a `forEach` whose errors are swallowed; `setupId` goes through the remap that `planSetupImportActions` returns).

### Steps

1. `packages/core/src/services/plans.ts`, `createPlanService({ db, newId })`. One method per route, each reproducing its route (status, body, order of the checks): `list()`, `create(body)`, `reorder(body)`, `update(id, body)`, `remove(id)`, `addEntry(planId, body)`, `reorderEntries(planId, body)`, `removeEntry(entryId)`, `updateEntry(entryId, body)`, `createMosaic(planId, body)`, `updateMosaic(planId, mosaicId, body)`, `removeMosaic(planId, mosaicId)`. The id forms stay (`plan-`, `pe-`, `mo-` followed by `newId()`, and `tile-<mosaicId>-<position>`).
2. Move into the service: the two mappers, `parseMosaicBody`, `sanitizeObservationWindows` (it may keep `Date.now()` and `Math.random()`: both exist in the core package), and all the SQL. `PLAN_SORT_KEYS` moves to `packages/core/src/domain/plans.ts`, next to `PlanSortKey`, as the single list (derive the type from it, or check with a type-level test that they agree).
3. **Transactions.** Every operation that writes several rows is one `db.transaction`: the ones that are transactions today, plus `addEntry` (the duplicate check, the position read and the insert) and `update` (see next point).
4. **One deliberate change in `update` (`PUT /api/plans/:id`):** today the name, the settings and the sort key are checked and written one after the other, so a request with a valid name and an invalid latitude answers 400 but has already renamed the plan. The service checks everything first, in today's order (so the same request gets the same 400), then writes in one transaction. If `server-app-plans-photos.test.ts` recorded the half-applied state as a `KNOWN GAP`, update that one assertion and say so in the report. No other behaviour changes.
5. **Backup:** add what the backup routes need, named for what they do: for example `exportAll()` (the API shape that `plans.json` holds today), `listNames()`, and `importPlan(plan, { replaceIds, setupId })`, which does the deletes and the inserts of one plan **in one transaction** and validates as the route does today (the entries that are skipped, `sortBy` checked against the list, the windows sanitised). The route keeps its loop over the selected plans and its swallowing of errors per plan; the `forEach` becomes a `for … of` with `await`.
6. Delete from `server/db.ts` every plan function, statement and row type that nothing uses any more (`getPlanEntries`, `deleteAllPlans`, `updatePlanEntryPA` are already unused: delete them too).
7. Tests: `tests/unit/plan-service.test.ts` (pattern rule 7; cover every method and every rule, including each sanitiser rule and each transaction's all-or-nothing behaviour); the cases of `tests/unit/import-export.test.ts` that call the deleted functions are rewritten to call the service, keeping their assertions.

Commit: `internal(refactor): move plans into a core service`.

---

## WP2.3g — Photos, the data part

This sub-card moves everything about photos that is data. Image and file work stays in the route for now; WP2.3h moves it behind ports.

### What exists (verified 2026-10-04; re-check line numbers)

- `server/routes/photos.ts` (8 routes) and, in `server/db.ts`: `createPhoto` (16 positional arguments; one transaction: the photo row and one row per correspondence), `getAllPhotos`, `getPhotoById`, `deletePhoto`, `getPhotoFilename`, `updatePhotoManualPlacement`, `updatePhotoMetadata`, `createPhotoWithId` (used by the backup import), `updatePhotoDrawOrder`, `checkPhotosExist` (unused), `checkPhotosExistByName`, `deleteAllPhotoMetadata`, `sanitizePois`, `rowToPhoto`, and the private helpers around them.
- **Two functions are named `sanitizeIntegrationRows`.** The one in `server/routes/shared.ts` maps each row and keeps invalid ones as zeros; the one in `server/db.ts` (private) maps and then drops invalid rows, and it runs on every write and on every read. So what is stored and returned is always the `db.ts` result.
- `sanitizeCaptureDetails` is already in core (`packages/core/src/wcs.ts`). The photo types are in `packages/core/src/types.ts` (`Photo`, `PhotoCorrespondence`, `PhotoIntegration`, `PointOfInterest`, `CaptureDetails`, `ManualPlacement`).
- `star_correspondences` has `ON DELETE CASCADE` on `photo_id` and `UNIQUE(photo_id, point_index)`.
- `server/routes/backup.ts` uses `getAllPhotos`, `deletePhoto`, `createPhotoWithId`, `checkPhotosExistByName`, `sanitizePois` and the `shared.ts` `sanitizeIntegrationRows`.

### Steps

1. `packages/core/src/services/photos.ts`, `createPhotoService({ db })`, with the data methods:
   - `list(): Promise<Photo[]>` and `get(id)` (no `fileSize`: the route adds it from the file, as today);
   - `fileNameOf(id): Promise<string | undefined>`;
   - `insert(input: NewPhotoInput): Promise<Photo>`: one object in place of the 16 arguments; the photo row and its correspondences in one transaction; the display order rule of today;
   - `validateUpload(fields)`: the pure checks that `POST /api/photos` does before it touches the image (extension, the `correspondences` field: presence, JSON, count, each item), in today's order, each throwing a `DomainError` with today's exact body; and `readUploadMetadata(fields)`: the parsing and sanitising of the other form fields (`dsoIds`, `labels`, `pointsOfInterest`, `integrations`, `notes`, `observationDate`, `captureDetails`, `gearSetupId`, `displayName`, `manualPlacement`). The route calls them around its image work;
   - `updateMetadata(id, body)`, `setManualPlacement(id, body)`, `setOrder(body)`, each with today's checks and bodies;
   - `removeRow(id): Promise<boolean>`, `removeRows(ids)`, `removeAllRows(): Promise<number>` (rows only; the route still deletes the files, in today's order: files first, then the row);
   - for the backup: `findByOriginalNames(names)`, `importPhoto(photo, strategy)` (today's `createPhotoWithId`).
2. `sanitizePois` moves into the service file and is exported; `tests/unit/sanitize-pois.test.ts` imports it from there (its assertions do not change).
3. **One `sanitizeIntegrationRows`.** Keep the `db.ts` behaviour (invalid rows are dropped), exported from the service file. Before deleting the two old ones, add to the new service test a table of at least twenty inputs (valid rows, zeros, negatives, non-integers, numeric strings, empty and blank filters, non-objects, non-arrays) and assert that the new function returns exactly what the old pair returned (the route function followed by the `db.ts` function, and the `db.ts` function alone). Then delete both old functions and make `server/routes/backup.ts` use the new one.
4. The route keeps: multer, the rate limit, `sharp`, the file writes and deletes, and its logs. Everything else calls the service.
5. Delete from `server/db.ts` the photo functions, statements and helpers that nothing uses any more.
6. Tests: `tests/unit/photo-service.test.ts` (pattern rule 7); `tests/unit/db-photo-serialization.test.ts` and the photo cases of `tests/unit/import-export.test.ts` are rewritten to call the service, keeping their assertions.

Commit: `internal(refactor): move photo data into a core service`.

---

## WP2.3h — Photos, the image and file ports

The phone will store files and resize images with its own means. This sub-card puts the upload, the listing and the deletion of photos entirely in the service, behind two ports that the server implements with `sharp` and the file system.

### Steps

1. **Ports**, in `packages/core/src/ports/`:

   ```ts
   // image-codec.ts
   export interface ImageInfo {
     width: number;
     height: number;
     /** EXIF orientation 1..8, when present. */ orientation?: number;
   }
   export interface ImageCodec {
     /** Reads the size and the orientation. Rejects when the bytes are not a readable image. */
     probe(bytes: Uint8Array): Promise<ImageInfo>;
     /** Re-encodes in the same format with the EXIF orientation applied to the pixels. `ext` is the lower-case file extension, with its dot. */
     bakeOrientation(bytes: Uint8Array, ext: string): Promise<Uint8Array>;
     /** A JPEG no larger than `maxSize` on its longer side (never enlarged), at the given quality. */
     thumbnail(bytes: Uint8Array, maxSize: number, quality: number): Promise<Uint8Array>;
   }

   // blob-store.ts
   export interface BlobStore {
     put(name: string, bytes: Uint8Array): Promise<void>;
     get(name: string): Promise<Uint8Array | null>;
     /** Size in bytes, or null when there is no such blob. */
     size(name: string): Promise<number | null>;
     /** Removes the blob; a missing one is not an error. */
     remove(name: string): Promise<void>;
   }
   ```

2. **Server adapters:** `server/image-codec.ts` (`createSharpImageCodec()`), with exactly the `sharp` calls the route makes today (`metadata()`; `rotate()` for the orientation; `resize` then `jpeg({ quality })` for the thumbnail), and `server/blob-store.ts` (`createFsBlobStore(dir)`) over `UPLOADS_DIR`. A thumbnail made from the baked bytes must be byte-identical to today's, which is made from the saved file: prove it in a test on two images (one with EXIF orientation 6).
3. **The service** (`createPhotoService({ db, newId, images, blobs })`) gains:
   - `upload(file: { name: string; bytes: Uint8Array }, fields): Promise<Photo>`: the whole of today's pipeline in today's order (the pure checks; the probe, with today's 400 body when it fails; the size and the swap for orientations 5 to 8; the baked file stored as `<id><ext>`, with today's 400 body when that fails; the correspondences and the manual placement as today; the thumbnail stored as `<id>_thumb.jpg`, a failure being reported to the caller as a warning and not as an error; then the insert). Image and file work never happens inside the transaction;
   - `listWithSizes()`: the list with `fileSize` from `blobs.size`;
   - `remove(id)` and `removeMany(ids)`: today's order (the image and its thumbnail, then the row), today's thumbnail name rule;
   - the constants `THUMB_SIZE`, the thumbnail quality and `MAX_CORRESPONDENCES` live in the service.
4. **The route** keeps multer, the rate limit and the logs, and calls the service. A warning returned by `upload` (thumbnail failure) is logged with today's `console.warn`.
5. **Backup import:** it regenerates thumbnails with the same constants in its own copy of the code. Make it call the service or the codec, so that the constants exist once.
6. `server/services.ts` passes `createSharpImageCodec()` and `createFsBlobStore(UPLOADS_DIR)`.
7. Tests: the service test gains the upload, list and delete cases with a fake codec and an in-memory blob store (each failure point: probe, bake, thumbnail, insert; what is left in the store after each); a test of the two adapters on real small images; the byte-identity test of step 2.
8. `docs/dev/mobile-architecture.md`: the two ports in the ports table, with what the server uses and what the phone will use.

### Escalate if (in addition)

- The stored image or the thumbnail cannot be kept byte-identical to today's.
- `server-app-plans-photos.test.ts` recorded files left behind after a failed insert: say what the service does now (it must not leave more than today; removing the stored files when the insert fails is allowed, and is then the one assertion you may update).

Commit: `internal(refactor): move photo upload and files behind image and blob ports`.

---

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit per sub-card**, made when its acceptance passes, with files staged by explicit path. Before committing, check `git branch --show-current` is `mobile/phase-2`.
- Message: the one given in the sub-card.
- **Never add a `Co-Authored-By` line or any AI attribution.**

## Always forbidden

- Do not start a dev server. Do not kill any process you did not start (ports 5173 and 3001 may be in use by the user's own app; another agent may run a server on port 3199).
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create.

## Report (every sub-card)

Files changed and created · the service's method list with signatures · functions deleted from `server/db.ts`, and any kept with the reason · existing tests rewritten (file, what changed) · any pinned assertion updated, with the reason · acceptance output · "Seen, not fixed" · deviations · open questions.
