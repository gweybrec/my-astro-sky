# WP2.7a to WP2.7h — Fixes, then the remaining services

Model: sonnet for all · One sub-card at a time, in order · Depends on: WP2.3h · Needs device: no · Needs browser: no

Each sub-card is run by its own worker and makes **one commit**. The worker's prompt is this whole file plus the line "Run sub-card WP2.7x only".

## Read first

- `.claude/work-packages/phase-2/WP2.3-first-services.md`: the pattern, including "Rules added on 2026-10-05" (grouped database calls with asserted round-trip counts, a code on every error, typed parameters, registration in `createServices`, tests on both adapters, your status row in your own commit). Its "Must NOT", "Acceptance" and "Escalate if" apply here.
- Models to copy: `packages/core/src/services/photos.ts` with `server/routes/photos.ts` (a service with ports), `server/create-services.ts`, `server/routes/http-errors.ts`, `tests/helpers/` (the counting double, the asynchronous adapter).
- The pinning tests `tests/unit/server-app.test.ts`, `tests/unit/server-app-plans-photos.test.ts` and `tests/unit/server-backup.test.ts` pass **unedited**, except for an assertion a sub-card names.

## Step 0 (every sub-card)

Check `git branch --show-current` is `mobile/phase-2`, that `git status --short` shows no modified tracked files, and that the three pinning tests pass. If not, stop.

## Rules for the services that reach the network (WP2.7d, e, f, g, h)

1. **Port.** WP2.7d creates `packages/core/src/ports/http-client.ts`:

   ```ts
   export interface HttpRequest {
     method: 'GET' | 'POST';
     url: string;
     headers?: Readonly<Record<string, string>>;
     /** A text body, or a multipart form (the phone sends a file this way; see `docs/dev/mobile/spike-results.md`). */
     body?:
       | string
       | {
           form: ReadonlyArray<
             | { name: string; value: string }
             | { name: string; fileName: string; type: string; bytes: Uint8Array }
           >;
         };
     timeoutMs?: number;
   }
   export interface HttpResponse {
     status: number;
     headers: Readonly<Record<string, string>>;
     text(): Promise<string>;
     bytes(): Promise<Uint8Array>;
   }
   export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;
   ```

   and the server adapter `server/http-client.ts` over Node's `fetch`. Later sub-cards reuse both.

2. **Pin first, in the same commit.** These routes are not exercised by the pinning tests because they reach the network. Before moving a route, add to `tests/unit/server-app-network.test.ts` (created by WP2.7d, extended by the others) cases that run the real route with the outgoing requests answered by recorded fixtures: intercept at the lowest level the route uses today (stub `globalThis.fetch`, or mock the module that does the request), assert the outgoing request (URL, method, headers that matter, body) and the route's response for a success, an upstream failure and each rejection of the input. Run them on the untouched code first; they must pass unchanged after the move, apart from the interception point if it had to move to the `HttpClient` (say so).
3. **Clock and caches.** A service that caches or rate-limits takes `now: () => number` as a dependency and keeps its cache in the service instance, not in a module variable.
4. **No file system in the service.** Data files are read by the server and passed in.

---

## WP2.7a — Three fixes found by the pinning tests

`tests/unit/server-app-plans-photos.test.ts` recorded these as `KNOWN GAP`. Fix each in the service, and update exactly the assertions that recorded the old behaviour (list them in the report).

1. **`DELETE /api/photo-metadata` leaves every image file on disk.** It must remove the images and thumbnails of the photos it deletes (through the blob store), like the other photo deletions.
2. **A photo upload whose database insert fails leaves its image and thumbnail on disk** (for example two correspondences with the same point number). When the insert fails, the service removes the files it stored for that upload, then reports the error as today. In addition, reject two correspondences with the same `pointIndex` during validation, with a 400 and a code, before any file is written.
3. **`replaceEntryIds` of a mosaic request can delete entries of another plan.** The deletion is limited to entries of the plan named in the route.

Commit: `fix: clean up image files and keep mosaic changes inside their plan`.

## WP2.7b — Backup import reports what failed

Today, when one item of an import fails (a plan, a setup, a custom gear item, a photo), the error is swallowed and the response reports success. Keep importing the other items, and add to the response of `POST /api/import` a `failed` array (`{ kind, name }` per failed item; empty when nothing failed). In the desktop import window (`src/components/modals/ImportModal.vue`, `src/api.ts`), when `failed` is not empty, the existing result message is followed by one line listing the names that failed, in the four languages. No other change to the window. Add cases to `tests/unit/server-backup.test.ts` (an item made to fail; the others arrive; the response lists it) and to `tests/components/ImportModal.test.ts`. No browser session: the component test and `npm run verify` are the check; say so in the report.

Commit: `fix: report the items a backup import could not restore`.

## WP2.7c — Star search

`server/routes/stars.ts` and `server/star-search.ts` (which reads the star catalogue file lazily). Service `createStarSearchService({ stars })` in core, taking the already-loaded catalogue (or a loader function); methods for search, nearby and by-HIP, reproducing the three routes. The scoring and labelling code moves to core. The server loads the catalogue as today and passes it in. These routes are already pinned by `server-app.test.ts`.

Commit: `internal(refactor): move star search into a core service`.

## WP2.7d — Identification (asteroids, supernovae, comets), with the HTTP port

`server/routes/identify.ts`, `server/skybot.ts`, `server/tns.ts`, `server/comets.ts`. Create the `HttpClient` port and adapter (rule 1). Service `createIdentifyService({ http, now })` with one method per route; the caches and the TNS rate limit become instance state. The TNS User-Agent and the request formats stay exactly as they are (the spike proved them from the phone).

Commit: `internal(refactor): move object identification into a core service`.

## WP2.7e — Horizon

`server/routes/horizon.ts`, `server/horizon.ts`, `server/overpass.ts`, and the horizon cache functions of `server/db.ts`. Service `createHorizonService({ db, http, images, now })`. Terrain tiles are PNG images decoded to raw pixels: add `decode(bytes: Uint8Array): Promise<{ width: number; height: number; channels: 1 | 3 | 4; data: Uint8Array }>` to the `ImageCodec` port and to the `sharp` adapter, and use it. The cache key and version stay as they are. Delete the horizon functions from `server/db.ts`.

Commit: `internal(refactor): move the horizon computation into a core service`.

## WP2.7f — Already-solved files (FITS, TIFF with coordinates)

`server/routes/solved-import.ts` (`POST /api/solve-wcs`, `POST /api/photos/convert`), `server/raw-decode/index.ts` (the `sharp` part), `server/wcs-reader.ts`. Service `createSolvedImportService({ images, stars })`: reading the coordinates from the file's header and turning them into correspondences is already core code (`packages/core/src/wcs.ts`, `raw-decode/`); turning the decoded pixels into a picture goes through `ImageCodec.encode`. The server's catalogue loader for correspondences passes the catalogue in. Pin these two routes first (rule 2 without the network part: use small synthetic FITS and TIFF fixtures from `tests/fixtures/`).

Commit: `internal(refactor): move the import of solved files into a core service`.

## WP2.7g — Online solving (astrometry.net)

`server/routes/nova-solve.ts`, `server/astrometry.ts` (module-level session and job state). Service `createNovaSolveService({ http, settings, images, now })`: login, upload (multipart with the file part, as the spike validated), status polling, the list of past submissions and reuse. Session and job state become instance state. The API key is read through the settings service. `server/astrometry.ts` no longer calls the legacy `getSetting`; update `tests/unit/astrometry-http.test.ts` to the new seam, keeping its assertions.

Commit: `internal(refactor): move online solving into a core service`.

## WP2.7h — Version check, local solvers on the settings service, and the end of the old settings functions

1. `GET /api/version/latest`: a small `createVersionService({ http, now })` (the cache becomes instance state); `server/github-release.ts` moves to core if it is pure.
2. The local solvers stay on the server (`server/astap.ts`, `server/solve-field.ts`, `server/routes/local-solve.ts`): the phone has none. Make them read their settings through the settings service (asynchronously) in place of the legacy `getSetting`; update `tests/unit/astap.test.ts` and `tests/unit/solve-field.test.ts` to the new seam, keeping their assertions.
3. Delete `getSetting`, `setSetting`, `deleteSetting` from `server/db.ts`; rewrite `tests/unit/settings-security.test.ts` to run its cases against the settings service with the real codec (same assertions), and give `tests/unit/sqlite-adapter.test.ts` another legacy function for its guard case if one still exists; if `server/db.ts` no longer has any function that runs SQL, remove the guard case and the legacy guard module, and say so.
4. Report what is left in `server/db.ts` and in `server/routes/` that is not yet behind a service (the backup routes are expected: they are the next card).

Commit: `internal(refactor): move the version check and the last settings readers to services`.

---

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit per sub-card**, with files staged by explicit path, including the card's row in the status table at the end of `.claude/work-packages/README.md`. Before committing, check `git branch --show-current` is `mobile/phase-2`.
- **Never add a `Co-Authored-By` line or any AI attribution.**

## Always forbidden

- Do not start a dev server or use a browser. Do not call the real network from a test. Do not kill any process you did not start.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create.

## Report (every sub-card)

Files changed and created · the service's method list with signatures · round-trip counts where a database is used · functions deleted from `server/db.ts` or kept with the reason · pinned assertions updated, with the reason · existing tests rewritten · acceptance output · "Seen, not fixed" · deviations · open questions.
