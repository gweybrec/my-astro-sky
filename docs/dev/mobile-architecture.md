# Mobile Architecture

This document describes the architecture for the Android app and the shared code strategy.

## 3. Target architecture

The desktop app **stays at the repo root** (`src/`, `server/`, `electron/` do not move). This avoids rewriting every config, hook, skill and doc path. New code goes into workspaces.

```
src/, server/, electron/        Desktop + server + Electron — unchanged locations, gradually thinned.
packages/core/                  Pure TS. tsconfig lib ["ES2022"], types [] → compiler-enforced purity.
                                A hand-written env.d.ts declares only: console, TextEncoder/TextDecoder, timers.
                                astronomy, projection, affine, mosaic, recommender, identify, WCS/FITS/TIFF/XISF decoders,
                                domain types, i18n (platform injected), CATALOG REGISTRIES (state + lookups),
                                Backend + port interfaces, SERVICES, migrations.
packages/render/                Canvas 2D painters + scene + Pointer-Events gesture controller (theme injected).
packages/backend-http/          HttpBackend(baseUrl, token?) — today's api.ts behind the Backend interface.
packages/backend-local/         LocalBackend = core services + ports (adapters supplied by the shell).
packages/app-state/             Shared Pinia stores that depend only on Backend + PrefsStore + core registries.
apps/mobile/                    Capacitor + Ionic Vue. LocalBackend (standalone) or HttpBackend (LAN connect).
```

### Dependency rules

These are enforced by an ESLint `no-restricted-imports` rule set to _error_, plus the tsconfig `lib` setting:

- `core` imports nothing: no vue, pinia, `@capacitor/*`, `node:*`, `src/` or `server/`.
- `render` imports `core` only.
- `app-state` imports `core` plus vue and pinia.
- Apps import packages and never each other.
- `server` imports `core` only.

### Catalog registries

The DSO and star catalogs get a home in core:

- `core/catalog/dso-registry.ts` and `core/catalog/star-registry.ts` hold the state, a setter (`setDsoCatalog(json, overrides, lang)`) and all lookups.
- Each shell keeps only a loader, which fetches the data through `CatalogSource` and calls the setter.
- This is what lets `dso-render-select`, `sky-hit-test`, `photo-placement` and the painters move into shared packages.

### Ports (platform adapters)

Signatures were validated against the code.

| Port                                                                    | Desktop / server                  | Mobile                                         |
| ----------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------- |
| `SqlDb` (`query/get/run/exec/batch/transaction`, mutex)                 | better-sqlite3                    | @capacitor-community/sqlite (`executeSet`)     |
| `BlobStore` (`put/get/exists/remove/url`)                               | fs `uploads/`                     | Filesystem + `convertFileSrc`                  |
| `ImageCodec` (`probe/bakeOrientation/thumbnail/encodePng/decodePngRaw`) | sharp                             | `createImageBitmap`/OffscreenCanvas + fast-png |
| `HttpClient`                                                            | Node fetch                        | CapacitorHttp                                  |
| `SecretStore`                                                           | AES in DB (existing)              | Android Keystore                               |
| `BundleReader` / `ExportBundle`                                         | unzipper / archiver               | fflate + Filesystem + Share                    |
| `CatalogSource` (gear, stars, DSOs)                                     | `resources/*.json`, `public/data` | bundled assets                                 |
| `PrefsStore` (the localStorage-only state)                              | localStorage                      | Capacitor Preferences                          |
| `LocationProvider`, `I18nPlatform`                                      | navigator / Electron IPC          | GPS / Preferences                              |
| `Clock`, `IdGenerator`, `Logger`                                        | Date / uuid / `server/logger.ts`  | Date / `crypto.randomUUID` / console           |

### `SqlDb` details

- The port lives in `packages/core/src/ports/sql-db.ts`; the server adapter is `server/sqlite-adapter.ts` (`createBetterSqliteDb(getConnection())`).
- Transaction rule: `SqlDb.transaction(body)` may only await calls on its `tx`; a `setImmediate` watchdog rolls back a body that awaits anything else, and transactions do not nest. Inside a transaction body, use only `tx`; calls on the outer `SqlDb` are rejected, and a function that must work in both places takes a `SqlTx` parameter (`SqlDb` is one).
- Error codes (exported by the port): `SQL_TX_AWAITED_NON_DB`, `SQL_TX_NESTED`, `SQL_TX_OUTER_CALL`, `SQL_LEGACY_CALL_IN_TX`.
- Old synchronous `server/db.ts` functions throw `SQL_LEGACY_CALL_IN_TX` if called while a service transaction is open (`server/db-tx-guard.ts`).
- `getConnection()` in `db.ts` returns the raw, unguarded better-sqlite3 handle; only the adapter should use it.

### Backend interface types

The interface lives in core, so it cannot use browser types:

- `FileInput { name; type; bytes(): Promise<Uint8Array> }` replaces `File`.
- A progress callback replaces `XMLHttpRequest` progress, and a `CancelToken` replaces `AbortSignal`.
- The `api.ts` facade adapts browser types to these.

### Services in core

Each service throws a `DomainError`. Its kinds are `invalid`, `notFound`, `conflict`, `rateLimited` and `upstream`, and it keeps the existing `code` strings that `parseServerError` (`api.ts:23`) translates. Long-running work returns a job handle, not an error.

**Two rules for every service method.** (1) Group the database calls: on the phone each call costs about 35 ms, so a method never awaits a call inside a loop; several reads are one query and several writes are one `batch`. Its test states its round trips with `countingSqlDb` (`tests/helpers/counting-sql-db.ts`) as a fixed number. (2) Every `DomainError` has a required, stable upper-snake-case `code`, which the phone translates; the HTTP body does not change (`body` carries today's exact body).

| Service                                                        | Responsibility                                                           | Note                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `PlanService`                                                  | Plans, entries, mosaics                                                  | Absorbs the row mappers and `parseMosaicBody`                       |
| `GearService`                                                  | Catalog merge, custom gear, setups                                       |                                                                     |
| `PhotoService`                                                 | Upload pipeline, metadata, placement, order                              | Settles `sanitizeIntegrationRows`                                   |
| `SolvedImportService`                                          | `/api/solve-wcs` and `/api/photos/convert`: read WCS from FITS/TIFF/XISF | The heart of "import already-solved files"                          |
| `NovaSolveService`                                             | nova submit, poll, submissions list, reuse                               | Jobs persisted, so they resume after the app is suspended           |
| `StarSearchService`                                            | `/api/stars/search`, `nearby`, `:hip`                                    | Runs over the star registry                                         |
| `IdentifyService`                                              | SkyBoT, TNS, MPC comets                                                  | Keeps the existing caches and rate limits                           |
| `HorizonService`                                               | Terrain tiles + Overpass peaks, cached                                   | Needs raw PNG decoding (`ImageCodec.decodePngRaw`)                  |
| `SettingsService`                                              | Settings                                                                 | Uses `SecretStore`                                                  |
| `DsoOverrideService`, `PoiCategoryService`, `SkyRegionService` | CRUD                                                                     |                                                                     |
| `BackupService`                                                | Export, import preview, import apply                                     | Atomic; manifest versioned; **now includes the `PrefsStore` state** |
| `VersionService`                                               | Latest GitHub release                                                    |                                                                     |

Services already moved into `packages/core/src/services/` (built in `server/services.ts`, errors turned into responses by `sendError` in `server/routes/http-errors.ts`):

| Service              | File                                           | What it owns                                                                                                                                                                                                                                                                                    | Routes that use it                                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DsoOverrideService` | `packages/core/src/services/dso-overrides.ts`  | DSO override rows, id and RA/Dec checks, `dso_overrides` SQL                                                                                                                                                                                                                                    | `GET/PUT/DELETE /api/dso-overrides[/:id]`, `POST /api/export` and `POST /api/import` (`backup.ts`)                                                                                                                      |
| `SkyRegionService`   | `packages/core/src/services/sky-regions.ts`    | Alt/Az polygon regions, name and vertex checks, `sky_regions` SQL                                                                                                                                                                                                                               | `GET/POST/PATCH/DELETE /api/sky-regions[/:id]`, `POST /api/export` and `POST /api/import` (`backup.ts`)                                                                                                                 |
| `PoiCategoryService` | `packages/core/src/services/poi-categories.ts` | POI categories, name check, `poi_categories` SQL, the five default rows (`ensureDefaults`, called by `createApp`)                                                                                                                                                                               | `GET/POST/PATCH/DELETE /api/poi-categories[/:id]`, `DELETE /api/poi-categories`, `POST /api/export` and `POST /api/import` (`backup.ts`)                                                                                |
| `SettingsService`    | `packages/core/src/services/settings.ts`       | Solver and API settings rows, the secret API key (encrypted through the `SecretCodec` port, environment value first), `settings` SQL                                                                                                                                                            | `GET/PUT /api/settings`, `DELETE /api/settings/astrometry-api-key`; the solver modules still use the old `getSetting` of `server/db.ts`                                                                                 |
| `GearService`        | `packages/core/src/services/gear.ts`           | Built-in plus custom gear catalogue, custom gear, named gear setups, the checks of their routes, `custom_gear` and `gear_setups` SQL; the built-in lists are passed in (`server/gear-catalog.ts` reads them)                                                                                    | `GET /api/telescopes`, `cameras`, `accessories`, `filters`; `POST/DELETE /api/custom-gear[/:id]`; `GET/POST/PUT/PATCH/DELETE /api/gear-setups[/:id[/enabled]]`; `POST /api/export` and `POST /api/import` (`backup.ts`) |
| `PlanService`        | `packages/core/src/services/plans.ts`          | Night plans, entries and mosaics, the sort-key list, the observation-window sanitiser, `plans`/`plan_entries`/`plan_mosaics` SQL, one-plan backup import                                                                                                                                        | `/api/plans` (12 routes), `POST /api/export` and `POST /api/import` (`backup.ts`)                                                                                                                                       |
| `PhotoService`       | `packages/core/src/services/photos.ts`         | Photo rows and star correspondences, the upload-form checks and metadata parsing, metadata, placement and draw-order rules, the one `sanitizeIntegrationRows` and `sanitizePois`, `photos`/`star_correspondences` SQL, backup photo import. Image and file work stays in the route until WP2.3h | `/api/photos` (8 routes), `POST /api/export` and `POST /api/import` (`backup.ts`)                                                                                                                                       |

ASTAP and solve-field stay server-only and are exposed through **capabilities**.

### The seam is `api.ts`

- It keeps its exported names as a facade over `getBackend()`, set once with a module-level `setBackend()`.
- All 39 importers and every `vi.mock('../api')` keep working unchanged while the stores live in `src/`.
- When a store moves to `app-state` (card 3.5), its test is updated to mock the backend, not `src/api`.
- A new `photoUrl(name)` replaces the hard-coded `/uploads/` paths.
- `export()` returns bytes instead of downloading.

### SQL portability

The schema already avoids `RETURNING`, `json_*` and `STRICT`. The mobile adapter must:

- pass `transaction:false` when it manages the transaction itself;
- set `PRAGMA foreign_keys=ON` explicitly;
- keep WAL on the server only;
- run migrations through our own runner, from a merged v0 baseline.

The schema is defined once in `packages/core/src/db/schema.ts` (`BASELINE_SCHEMA` at `SCHEMA_VERSION`, plus `MIGRATIONS` from version 15 and `initSchema`); migrations 1 to 14 stay frozen in `server/db-migrations.ts`.
New migrations (version 15 and above) are SQL statements added to `MIGRATIONS`, and `BASELINE_SCHEMA` and `SCHEMA_VERSION` are updated in the same commit; `tests/unit/schema-baseline.test.ts` fails otherwise.

On mobile, write as read-then-`batch()`: each bridge round-trip costs 1–5 ms.

### Transaction safety rule during the transition

While old synchronous `db.ts` code and new services share one connection:

- inside `SqlDb.transaction()`, only `tx` calls may be awaited — never sharp, file or zip work;
- card 2.2 adds a test that proves a legacy statement cannot run inside an open service transaction.

---

## 4. Mobile-specific engineering

### Sky map on touch

- A gesture controller in `render/`, built on Pointer Events:
  - pan with fling;
  - pinch zoom about the centroid (`sky-view-math.ts`);
  - tap to select, with a larger hit radius;
  - long-press to open a sheet;
  - `touch-action:none` on the canvas.
- Desktop gets touchscreen support from the same controller.
- **Catalog:** decided by spike WP0.2. The likely outcome is a compact binary catalog with tiered loading.
- Cap the DPR at 2, render on demand, and pause the timers while backgrounded.

### Photos on the canvas

- The reusable part is `computePhotoMatrixForView` (`photo-placement.ts:177`). The export routine in `export-render.ts` is **not** a frame painter: it loads a full-resolution image on every call.
- A new canvas photo layer is needed, with its own ImageBitmap cache, level-of-detail selection and eviction.
- These parts of `photo-overlay.ts` do not carry over and are redesigned for mobile:
  - level-of-detail by swapping `img.src`;
  - hiding photos while panning (`.photos-frozen`) — a canvas must redraw them every frame;
  - manual repositioning, which reads the transform back from the DOM (`:2469-2483`) and drags with window mouse events;
  - the layer order: sky canvas, then photos, then the overlay canvas.
- Spike WP0.2 measures this before any commitment.

### Touch equivalents

These desktop interactions have no touch equivalent yet. Design round D1 must decide each one:

- hover tooltips (`requestHover`);
- right-click clears the selection (`sky-map-events.ts:177`) — on Android a long-press fires the same event, which collides with "long-press opens a sheet";
- freehand region drawing uses press-and-drag, which collides with panning;
- keyboard shortcuts, including the time controls;
- gallery controls that appear on mouse move;
- FOV-frame handles sized for a mouse.

A Sonnet card (WP5.0) produces the full inventory from the code, as input to D1.

### Field use

- A night-vision **red theme**, for both the UI tokens and `SKY_THEME`.
- Keep the screen awake during sessions.
- GPS location.
- Offline except for solving and identification.

### Photos and solving on the device

**Import already-solved files** through core decoders (`Uint8Array`/`DataView`, fflate):

- FITS, TIFF, **XISF** (new) and **`.wcs` sidecars** (new).
- Desktop gets XISF and sidecars too.

**nova.astrometry.net** through `NovaSolveService` + CapacitorHttp:

- downscale to about 2,000 px before upload;
- API key stored in the Keystore;
- the plan target is used as the solve hint;
- jobs resume after the app is suspended.

**Getting files in:**

- a file picker that accepts any MIME type (FITS, XISF);
- an **Android "Share to MyAstroSky" intent**, for files from the Seestar, ASIAIR or Gallery apps;
- the camera roll.

**Memory:** decode with `createImageBitmap(resize*)` and keep only a display copy plus a thumbnail.

### LAN connect

- The phone uses `HttpBackend(baseUrl, token)` against the desktop or Docker server.
- Server side:
  - an opt-in "Allow LAN devices" setting;
  - a CORS allowlist for `https://localhost` and `capacitor://localhost`;
  - a QR pairing token;
  - an `/api/capabilities` endpoint.
- Android side: `network_security_config` for private IPs, and `photoUrl()` returns absolute URLs.
- **Bonus:** while connected, the phone can run **ASTAP or solve-field on the desktop**.

### Information architecture

(A starting point; the design phase decides)

- Bottom tabs: **Sky · Targets · Plans · Library · Settings**.
- **Sky:** a full-screen canvas, search, a time scrubber, and an object bottom sheet (peek, half, full).
- **Targets:** filter chips plus a filter sheet, and cards with an altitude sparkline.
- **Plans:** plan detail, a framing editor with FOV-frame gestures, and mosaics.
- **Library:** a grid, a photo detail view with metadata and identification, and an import flow (pick, then solved or online solve, then place).
- **Settings:** gear setups, location, language (FR/EN/ES/DE), theme and night mode, astrometry key, LAN pairing, export/import.
