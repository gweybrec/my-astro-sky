# WP3.5 — The local backend, proven by the same contract tests

Model: sonnet · Depends on: WP3.4 · Needs device: no · Needs browser: no

## Goal

Write the backend the phone will use: the same `Backend`, made of the services themselves, with no server. Prove it with the contract suite of WP3.3: the HTTP backend and the local backend must pass the same cases.

## Steps

1. **`packages/backend-local/src/local-backend.ts`**: `createLocalBackend(deps): Backend` with

   ```ts
   deps = {
     services: Services; // the object `createServices` returns; move the `Services` type and `createServices`
     //                     itself to core if they import nothing from the server (see step 2)
     files: { url(fileName: string): string };
     starCatalogUrl: string;
     /** Opens a ZIP archive held in memory. */
     openZip(bytes: Uint8Array): Promise<BundleReader>;
     /** Builds a ZIP archive in memory. */
     newZip(): { writer: BundleWriter; finish(): Promise<Uint8Array> };
     /** Hands a file to the user (the share sheet on the phone). */
     saveFile(name: string, bytes: Uint8Array): Promise<void>;
     now: () => Date;
   };
   ```

   - Every member of `Backend` that is a `Pick` of a service is that service, as it is (`plans: services.plans`…). Do not copy methods one by one.
   - The members that take a `FileSource` read it and call the service: `photos.upload` (returns the result's `photo`; calls `onProgress(1)` when given), `solvedImport.solveWcs` and `convert` (a `cancel` signal already aborted rejects with the same `DOMException`-like error as the HTTP backend: use `Object.assign(new Error('Aborted'), { name: 'AbortError' })`, core has no `DOMException`; make the HTTP backend's contract case accept either), `novaSolve.submit` and `reuse`, `backup.preview` and `restore` (through `previewFile`/`importFile` of WP3.1 with `deps.openZip`), `backup.exportToUser` (`exportTo` into `deps.newZip()`, then `deps.saveFile(backupFileName(now()), bytes)`).
   - `capabilities.localSolvers` is `false`; `localSolvers` is absent.
   - No import from `@capacitor/*` in this file: everything of the platform arrives through `deps`. (`capacitor-sqlite-db.ts`, already in the package, stays the only file that knows the plugin.)

2. **`createServices` for the phone.** The phone needs the same wiring as the server. If `server/create-services.ts` imports only from core, move it to `packages/core/src/services/create-services.ts` and leave a one-line re-export at the old path. If it imports server modules, move the wiring and keep in the server file only the creation of the server's adapters. The server keeps working unchanged.

3. **ZIP in memory**: `packages/backend-local/src/bundle-fflate.ts`, `openZip` and `newZip` over `fflate` (already a dependency of core; add it to this package's `package.json`). Same entry names, same path checks (`isValidZipEntryPath`) and the same size limits as `server/bundle-zip.ts`. Test: an archive written by the server's writer is read by this reader, and the other way round (`tests/unit/bundle-fflate.test.ts`).

4. **Run the contract suite on the local backend**: `tests/unit/backend-local-contract.test.ts`. Services on a `better-sqlite3` database in memory through `createBetterSqliteDb`, **and a second run** on the asynchronous test adapter of `tests/helpers/` (the phone's database is asynchronous). Blob store and image codec: the in-memory fakes the service tests already use (or the server's real `sharp` codec if the contract's photo cases need real thumbnails: the two backends must be given the same codec, since the suite compares complete values). The outgoing network is answered from the same recorded fixtures as in the HTTP run.

5. **Both runs must pass the same cases.** Where a case passes on one backend and fails on the other, the difference is a defect: fix it in the service, the route or the HTTP backend, whichever is wrong, and list every such fix in the report. A case may be skipped on one backend only when it tests something that backend does not have (the local solvers), with the reason in the test.

6. **Round trips.** The phone pays about 19 ms per database call. With the counting database of `tests/helpers/counting-sql-db.ts`, record in the report the number of database calls of: listing the plans, listing the photos with sizes, adding one entry to a plan, uploading one photo, restoring a backup of 3 plans and 2 photos. Do not optimise in this card; flag anything above 10 calls for a single user action.

7. **Docs**: complete the section "How a screen reaches its data" of `docs/dev/mobile-architecture.md` (the local backend, what the phone's shell must supply: database, blob store, image codec, HTTP client, secret codec, the ZIP functions, file addresses, file saving), and the table of ports (ZIP on the phone: fflate, done).

## Must NOT

- Touch `src/` or any route's behaviour (except a defect found by step 5, reported).
- Add a Capacitor plugin or build anything for the phone: the phone's adapters and the test on the real device are the next card, with the user's phone plugged in.

## Escalate if

- The contract suite needs different expected values for the two backends for a reason that is not a defect (name the case).
- `createServices` cannot move without dragging server code into core.

## Commit

`internal(mobile): add the local backend and run the backend contract on it`

## Report, in addition to the common items

The cases run on each backend, and those skipped with the reason · every difference found between the two backends and its fix · the round-trip counts · what the phone's shell still has to supply.

## Additions after the review of WP3.3 (2026-10-06): they override the text above where they differ

WP3.1 and WP3.3 found places where a route still does something the service does not. Each is a difference between the two backends. Settle them in this card, in the service, so that the route becomes a plain call and its responses do not change:

1. **Default values read by the routes**: the horizon's `radiusKm` (40) and the star search limits (10 for a name, 20 nearby) are applied by the routes. Apply them in the services when the value is absent; the routes pass what they received.
2. **Online solving without a key**: the route of the past submissions answers 400 and the route of "reuse" checks the key first, while the services do not. `listSubmissions()` and `reuse()` reject with `ASTROMETRY_NOT_CONFIGURED` (kind `invalid`) when no key is configured; the routes drop their own checks. Their responses stay the same (compare with the pinning tests; if a body would change, keep the route's body through the error's `body` option).
3. **`reuse` and the object list**: the route drops the optional `dsoIds` of the service's result. Leave the route; the contract case compares the fields the route sends.
4. **The limit of TNS**: the route's code is `RATE_LIMITED`, the service's is `TNS_RATE_LIMITED`; the HTTP backend already maps one to the other. Leave it.
5. **A picture refused for its type**: over HTTP the refusal comes from the upload filter with no code; locally it comes from the service with `INVALID_EXTENSION`. Make the server's error handler send the code the filter attaches (the test that records its absence as a `KNOWN GAP` is updated: this is the one pinned assertion this card may edit), and add the contract case that both backends refuse a `.txt` file renamed with no picture extension with a code that has a message.
6. **Continuous integration**: `.github/workflows/ci.yml` has a type-check step for `packages/backend-http` but none for `packages/backend-local`, although the root `typecheck` script runs both. Add the missing step and update `docs/dev/ci.md`.
7. After WP3.4, `LocalSolverApi` has no `solve` method any more.
