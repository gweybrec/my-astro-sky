# WP2.0a — An app factory, and a test that pins what the routes do today

Model: sonnet · Depends on: nothing · Parallel-safe with: nothing · Needs device: no · Needs browser: no

## Goal

`server/index.ts` (5,753 lines) builds the Express app, registers 76 routes and starts listening, all at import time, and no test covers any
route. Before the routes are split into files (WP2.0b to WP2.0j), this card makes the app importable without listening, and adds a test that
records the current behaviour of the routes. That test is the safety net for the whole of Phase 2.

## Step 0

Check `git branch --show-current` is `mobile/phase-2` and that `git status --short` shows no modified tracked files. If not, stop.

## Context (verified on 2026-10-04; re-check line numbers before relying on them)

- `server/index.ts`: line 1 is `import 'dotenv/config'`. `__dirname`, `UPLOADS_DIR` and `RESOURCES_DIR` are at 129-131, `DIST_DIR` at 310.
  `const app = express()` is at 227. `mkdirSync(UPLOADS_DIR)` runs at 223-225. `startServer()` (5695-5751) registers the dev-only Swagger UI
  (dynamic `import('swagger-ui-express')`, reads `../public/swagger.json`), the SPA fallback, the global error handler, then calls
  `app.listen(PORT)`. `startServer();` is called at 5753. The file exports nothing.
- `electron/main.ts:206` does `await import('../server/index.js')` after setting `PORT`, `UPLOADS_DIR`, `DB_PATH` and other env vars, then
  waits for the port. `package.json` (`dev`, `dev:server`) and `Dockerfile:63` run `server/index.ts`. **These must keep working unchanged.**
- `server/db.ts` opens the database when it is imported, from `process.env.DB_PATH`. Existing tests get a fresh database with
  `vi.resetModules()`, `vi.stubEnv('DB_PATH', ':memory:')`, then a dynamic `import()`.
- `scripts/swagger-docs.mjs:22` has `apis: ['server/*.ts']`. `public/swagger.json` is committed.
- `vitest.config.ts` excludes `server/index.ts` from coverage.

## Steps

1. **Baseline for Swagger.** Run `npm run swagger:generate` on the untouched tree. If `git status` then shows `public/swagger.json` as modified,
   restore it (`git restore public/swagger.json`) and note "baseline drift" in the report. Keep a copy of the generated JSON outside the repo.
2. **Paths module.** Create `server/server-paths.ts` (directly in `server/`, so the `..` path maths stays the same). It exports `SERVER_DIR`
   (what `__dirname` is today), `UPLOADS_DIR`, `RESOURCES_DIR`, `DIST_DIR` and `SWAGGER_JSON_PATH`, with exactly today's expressions and env
   overrides.
3. **Rename, keeping history.** `git mv server/index.ts server/app.ts`.
4. **In `server/app.ts`:**
   - remove `import 'dotenv/config'`;
   - import the path constants from `./server-paths.js` in place of the local definitions;
   - replace `startServer` with `export async function createApp(): Promise<express.Express>`. It registers the Swagger UI, the SPA fallback and
     the error handler exactly as `startServer` does today, in the same order, and returns `app`. It does **not** listen;
   - remove the `startServer();` call. Everything else stays where it is, byte for byte.
5. **New `server/index.ts`** (the entry point, about 15 lines): `import 'dotenv/config';` as the **first** import, then
   `import { createApp } from './app.js';`, then a `startServer` function that awaits `createApp()`, reads `PORT` the same way as today and
   calls `listen` with the same log line, then the same `startServer();` call.
6. `scripts/swagger-docs.mjs`: change `apis` to `['server/*.ts', 'server/routes/*.ts']`.
7. `vitest.config.ts`: next to `'server/index.ts'` in `coverage.exclude`, add `'server/app.ts'` and `'server/routes/**'`.
8. **The test: `tests/unit/server-app.test.ts`.**
   - Setup, once for the file: `vi.resetModules()`; stub `DB_PATH` to `':memory:'`, `UPLOADS_DIR` to a fresh temp folder (`fs.mkdtempSync`)
     and `ENABLE_SWAGGER` to `'false'`; dynamic-import `../../server/app.js`; `const app = await createApp()`; `app.listen(0)` and read the port.
     Teardown: close the server, call `closeDatabase()` from `server/db.js`, delete the temp folder.
   - Requests: try `// @vitest-environment node` at the top of the file and Node's own `fetch`. If the global setup file
     (`tests/setup/platform.ts`) fails under the node environment, keep the default environment and send requests with a small helper built on
     `node:http` (the default environment replaces `fetch` with a browser-like one).
   - **Part 1: route table.** Write a helper that lists every registered route as `"METHOD /path"`, walking nested routers
     (Express 5: `app.router.stack`; a layer has either `.route` or a `.handle.stack`). Prove the helper on a tiny synthetic app with one nested
     router. Then assert that the sorted list for the real app, limited to paths starting with `/api/`, equals the 76 entries in "Route list"
     below, sorted. Also assert these orders in the unsorted list: `PUT /api/plans/order` before `PUT /api/plans/:id`; `GET /api/stars/search`
     and `GET /api/stars/nearby` before `GET /api/stars/:hip`.
   - **Part 2: behaviour, recorded as it is today.** For each request, assert the status and the shape of the body (array or object, key names,
     and values where they are deterministic). **Record, do not judge:** if a response looks like a bug, make the test match it and list it in
     your report.
     1. Lists on an empty database: `GET` `/api/photos`, `/api/plans`, `/api/gear-setups`, `/api/poi-categories` (5 seeded defaults),
        `/api/sky-regions`, `/api/dso-overrides`, `/api/settings`, `/api/config`, `/api/telescopes`, `/api/cameras`, `/api/accessories`,
        `/api/filters`.
     2. Stars: `search` for a bright star by name, `nearby`, and one `:hip`; read the handlers for the parameter names.
     3. One full round trip per domain, reading each handler for its body format: plans (create, list, rename with `PUT`, add an entry, reorder
        entries, patch the entry, create and delete a mosaic, delete the entry, `PUT /api/plans/order`, delete); gear setups (create, update,
        `PATCH enabled`, delete); custom gear (create, see it in the matching catalog list, delete); POI categories (create, patch, delete);
        sky regions (create, patch, delete); DSO overrides (put, list, delete); settings (put one editable string setting, read it back,
        `DELETE /api/settings/astrometry-api-key`).
     4. One rejected request per domain above (a `400` or whatever today's code returns), asserting the status and the error body's keys.
     5. Photos: upload one small PNG generated in the test with `sharp` through `POST /api/photos` (multipart, field name as in the handler),
        then list, `PATCH metadata`, `PATCH manual-placement`, `PATCH /api/photos/order`, `DELETE`, and check the file is gone from the temp
        uploads folder.
     6. An unknown `/api/…` path: assert whatever comes back today.
   - **Never call from the test** (they reach the network, a solver or the file system outside the temp folder): `/api/version/latest`,
     `/api/horizon`, the three `/api/settings/probe-*` routes, `/api/skybot/*`, `/api/tns/*`, `/api/comets/*`, every `/api/solve-*` route,
     `/api/photos/convert`, `/api/astrometry/*`, `/api/export`, `/api/import*`. They are in the route table check only.
   - The whole file must run in under 20 seconds.

## Route list (76)

```
POST /api/photos
GET /api/version/latest
GET /api/config
GET /api/settings
PUT /api/settings
DELETE /api/settings/astrometry-api-key
GET /api/horizon
POST /api/settings/probe-astap
POST /api/settings/probe-solve-field
POST /api/settings/probe-data-dir
GET /api/photos
PATCH /api/photos/order
GET /api/dso-overrides
PUT /api/dso-overrides/:id
DELETE /api/dso-overrides/:id
DELETE /api/dso-overrides
GET /api/telescopes
GET /api/cameras
GET /api/accessories
GET /api/filters
POST /api/custom-gear
DELETE /api/custom-gear/:id
DELETE /api/custom-gear
GET /api/gear-setups
POST /api/gear-setups
PUT /api/gear-setups/:id
PATCH /api/gear-setups/:id/enabled
DELETE /api/gear-setups/:id
DELETE /api/gear-setups
GET /api/poi-categories
POST /api/poi-categories
PATCH /api/poi-categories/:id
DELETE /api/poi-categories/:id
DELETE /api/poi-categories
GET /api/sky-regions
POST /api/sky-regions
PATCH /api/sky-regions/:id
DELETE /api/sky-regions/:id
GET /api/plans
POST /api/plans
PUT /api/plans/order
PUT /api/plans/:id
DELETE /api/plans/:id
POST /api/plans/:id/entries
PUT /api/plans/:id/entries/order
DELETE /api/plans/:id/entries/:entryId
PATCH /api/plans/:id/entries/:entryId
POST /api/plans/:id/mosaics
PUT /api/plans/:id/mosaics/:mosaicId
DELETE /api/plans/:id/mosaics/:mosaicId
POST /api/export
POST /api/import/preview
POST /api/import
DELETE /api/photos/:id
DELETE /api/photos
DELETE /api/photo-metadata
PATCH /api/photos/:id/manual-placement
PATCH /api/photos/:id/metadata
POST /api/solve-wcs
POST /api/photos/convert
POST /api/solve-astap
GET /api/solve-astap/:jobId
DELETE /api/solve-astap/:jobId
POST /api/solve-field
GET /api/solve-field/:jobId
DELETE /api/solve-field/:jobId
POST /api/solve-plate
GET /api/solve-plate/:id
GET /api/astrometry/submissions
POST /api/astrometry/reuse
POST /api/skybot/conesearch
POST /api/tns/conesearch
GET /api/comets/elements
GET /api/stars/search
GET /api/stars/nearby
GET /api/stars/:hip
```

If the real table differs from this list, the list is wrong, not the code: correct the list in the test and say so in the report.

## Must NOT

- Change any handler, middleware, limit, message or log line. This card moves the start-up code only.
- Add a dependency (no `supertest`).
- Call the network from the test, or write outside the temp folder.
- Start `npm run dev` or any long-running server. The test's own `listen(0)` is the only server.
- Touch `electron/`, `Dockerfile`, `package.json` scripts, or anything under `src/` and `packages/`.

## Acceptance (worker)

- `npx vitest run tests/unit/server-app.test.ts` passes, and its duration is in the report.
- `npm run swagger:generate` produces a `public/swagger.json` equal to the baseline of step 1 (compare the two files; they should be identical
  byte for byte at this stage). Commit nothing in `public/` if it is unchanged.
- Start check without a browser: run `npx tsx server/index.ts` with `PORT=3099`, `DB_PATH=:memory:` and `UPLOADS_DIR` set to a temp folder, set
  for that command only, with a timeout of 20 seconds; request `http://localhost:3099/api/config` once and check a `200`; then stop that process
  by its PID and confirm port 3099 is free. If port 3099 is busy before you start, use another free port.
- `npm run verify` is green.

## Gotchas

- The working tree has CRLF line endings.
- ES imports run in order: `dotenv/config` must stay the first import of `server/index.ts` so that `.env` is loaded before `server/app.ts` and
  `server/server-paths.ts` read `process.env`.
- `server/app.ts` reads `resources/*.json` at import time and creates the uploads folder; the test's `UPLOADS_DIR` stub must be set before the
  dynamic import.
- The API rate limiter allows 300 requests a minute per address; keep the test well under that.
- The vitest hook runs the tests related to each edited server file; after this card, that includes the new test.

## Escalate if

- `electron/main.ts`, the Dockerfile or a `package.json` script would have to change.
- The app cannot be built twice in one process, or the test cannot isolate the database and the uploads folder.
- Neither request method works in the test environment.
- The photo upload cannot be made to pass after a reasonable effort: leave photos out of part 2, and say so. Do not weaken other checks.
- Any existing test fails.

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new
  branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit** for this card, made when its acceptance passes, with files staged by explicit path.
- Before committing, check `git branch --show-current`. If it is not `mobile/phase-2`, stop and report.
- Message: `internal(refactor): make the server app importable and pin its routes with a test`.
- **Never add a `Co-Authored-By` line or any AI attribution.** The root `CLAUDE.md` forbids it, and that rule overrides the harness default.

## Always forbidden

- Do not kill any process you did not start.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash` or `git reset --hard`.
- Do not touch untracked files that you did not create.

## Report

Files changed and created · acceptance output (test count and duration, verify result) · behaviours that look like bugs and were recorded as
they are · deviations from the card · open questions.
