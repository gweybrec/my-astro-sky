# Architecture

**MyAstroSky** is a web app for overlaying astrophotographs onto an interactive sky map. The frontend renders stars on an HTML5 Canvas using stereographic polar projection, while uploaded photos are positioned as DOM elements using CSS `transform: matrix()` computed from affine registration (3-point manual or automatic plate solving). A Targets tab recommends DSOs to image tonight based on gear, location, and sky conditions.

## Frontend (`src/`)

- **Canvas layer** (`sky-map.ts`): Renders ~5000 stars with B-V color, 12,000+ DSOs with type-specific styling, constellation lines/names, RA/Dec grid. Handles zoom (wheel) and pan (drag). Fires `onViewChange` callback on every view update for photo transform recomputation.
- **Photo layer** (`photo-overlay.ts`): Each photo is an `<img>` with absolute positioning and CSS matrix transform. On view change, all photo transforms are recomputed so they track the canvas. LOD: when a photo's rendered pixel width (derived from the affine matrix scale × `photo.width`) is below 300 px and a server thumbnail exists, `img.src` is swapped to `/uploads/{thumbFilename}`; swapped back to the full-res URL when the photo renders larger. `photo.width` (authoritative DB value) is always used for matrix math — never `imgEl.naturalWidth` — so LOD swaps do not disturb hit-testing or transform accuracy. Manages:
  - `openManualIdentifyModal()` — the manual star-identification sub-modal launched per-card from the batch upload flow (user clicks photo pixel → searches for matching star / enters RA-Dec / picks on map; "Validate" enabled at 2+ identified points). No solve buttons or metadata — those live in the batch card. Resolves with correspondences, a free-drag hand-off, or cancel.
  - Manual placement mode (`openManualPlacement()`: drag photo, rotate/zoom sliders, mirror X/Y toggles)
  - Photo repositioning (re-enter manual placement for existing photo, extracts current transform)
- **Photo upload UI** (`components/modals/BatchUploadModal.vue`, `BatchCard.vue`, `BatchSolveStatus.vue`): The single unified "add photos" entry. Multi-select file picker → one card per photo. Each card offers the 4 auto-solve methods (WCS companion, astrometry.net online, solve-field local, ASTAP local), a per-card **Manual** button (→ `openManualIdentifyModal`), reuse-online, hints, and a metadata editor. Solving runs concurrently with a parallel-slot queue; rich per-card status/error messages mirror the old single modal.
- **Gallery view** (`gallery.ts`): Grid view of all photos. Click photo → navigate to map location. Smart sorting by catalog name (M1, M31, M100, M101...). Lazy-loads images: grid items are built as shells first; an `IntersectionObserver` sets `img.src` (using `thumbFilename` when available, else full-res `filename`) only when the item enters the scroll container viewport. The observer is recreated on each render; the previous one is always disconnected first.
- **Targets view** (`targets-view.ts`): Full-screen panel for DSO target recommendations. Features:
  - Gear preset selector (telescope + camera combos defined in `gear-presets.ts`)
  - Location input (decimal or DMS) with browser geolocation
  - Date picker for the observation night
  - Collapsible filter form: DSO type, horizon direction chips, rating/difficulty/catalog chips, include oversized toggle
  - "Best targets" button (sorted by composite score) and "Random targets" button (shuffled pool)
  - Paginated results grid (page size dropdown + `« ‹ [pages] › »` navigation)
  - Sort bar: score, altitude, transit time, magnitude, size, FOV fit, name, rating, difficulty
  - Each result card shows: object name, type chip, constellation, magnitude, size, rating stars, difficulty dots, imaging recipe (filters + integration time estimate), max altitude, transit time
  - Each result card has an Edit button wired to `onEditDSO: ((dso: DSO) => void) | null` callback (opens the DSO editor modal)
- **Projection** (`projection.ts`): Stereographic polar projection with North Celestial Pole at center, celestial equator at r=1. `project(ra°, dec°)` → `(x, y)` in projection space; viewport transform converts to canvas pixels.
- **Affine** (`affine.ts`): Solves affine transforms from correspondences:
  - 3-point exact: 3×3 system for 6-DOF transform (rotation, scale, translation, shear)
  - N-point least squares: Overdetermined system for N≥4 points (minimizes residuals)
- **Star catalog** (`star-catalog.ts`): Loads d3-celestial JSON from `public/data/`, indexes stars by HIP number for fast lookup.
- **DSO catalog** (`dso-catalog.ts`): Loads 12,000+ DSOs (OpenNGC + Messier + IC + Sharpless SH2 + LBN + LDN + vdB) from `public/data/dso.json`. Type-specific rendering. Exports `DSO_CATALOGS_ALL` constant. Manages a **user override system** for runtime DSO metadata edits:
  - On load, captures a `DSOBaseValues` snapshot (ra, dec, names, constellation, rating, difficulty, type) for every DSO into an in-memory `baseValues` map.
  - Loads any persisted server-side overrides via `getDsoOverrides()` and applies them immediately.
  - `applyAndStoreSingleOverride(id, override)` — applies a `DSOUserOverride` in-memory and records it locally.
  - `resetDsoToBaseValues(id)` — reverts a DSO to its catalog snapshot.
  - `getDSOCatalogBaseValues(id)` — returns the original catalog values for a DSO (used to pre-fill the editor form on reset).
  - `reloadUserOverrides()` — re-fetches all overrides from the server and re-applies them (called after import).
- **DSO editor** (`dso-editor.ts`): Modal for editing any DSO metadata field at runtime — names (FR/EN/ES/DE), RA, Dec, constellation, rating (1–5), difficulty (1–5), type. Saves the override to the server via `upsertDsoOverride` and applies it in-memory immediately. The "Reset to defaults" button fills the form with the original catalog values without closing; clicking Save then deletes the override.
- **Target recommender** (`target-recommender.ts`): `recommendTargets(dsos, preset, location, dateNight, limit, options)` scores and filters DSOs for a given night:
  - 45% altitude score (linear above 30°, best at 70°+)
  - 35% FOV fit score (best when object spans 15–70% of the short FOV axis)
  - 20% brightness score (margin below gear limiting magnitude)
  - Pre-filters by magnitude limit, minimum altitude 30°, declination quick-filter
  - `options.ignoreFovFit = true` bypasses FOV fit scoring (for oversized objects)
- **Gear presets** (`gear-presets.ts`): Defines `GearPreset` interface and `GEAR_PRESETS` array. Each preset encodes aperture, focal length, sensor size, pixel size, mono flag. Exports `fovDeg()`, `pixelScaleArcsec()`, `limitingMag()`.
- **Imaging recipe** (`imaging-recipe.ts`): `recommendRecipe(dso, preset)` returns heuristic filter + integration time recommendations (LRGB vs narrowband, sub-exposure length, sub count).
  - **Total integration time** is driven by `dso.difficulty` (1–5), independent of filter choice. Reference aperture is 200 mm; aperture scaling uses exponent 1.5 (softer than physical quadratic). Base hours at 200 mm: difficulty 1 → 0.25 h, 2 → 0.75 h, 3 → 2.5 h, 4 → 5 h, 5 → 12 h. Clamped to [0.15 h, 12 h]. Falls back to magnitude-band estimate when `difficulty` is null.
  - **Filter choice** is separate: emission types (EN/PN/SNR) → Ha+OIII(+SII for non-PN); others → LRGB. Color/built-in cameras always use RGB. `totalHours` is distributed proportionally across the chosen filters.
- **Mosaic geometry** (`mosaic.ts`): Pure tangent-plane (gnomonic) mosaic math backing the mosaic planner — `planGrid()`, `tileCenters()`, `mosaicBounds()`, `autoRegionForDso()`, `framePointToSky()`/`skyToFrameOffset()` (offset round-trip), `mosaicShapeFromOffsets()`, `addCandidateOffsets()`. Mosaics render as one interactive "outline" frame (`mosaic:<plan>:<id>`) plus faint tile frames (plan entries tagged with `mosaic_id`); interactions route through the standard frame code in `fov-frames` store + `sky-map.ts`.
- **Astro time** (`astro-time.ts`): Pure-JS astronomical time utilities (Meeus). `dateToJD()`, `gmstHours()`, `lstHours()`, `twilightWindow()` (astronomical twilight start/end for a given night/location).
- **Sky geometry** (`sky-geometry.ts`): `altAzFromRaDec()`, `maxAltDuringWindow()`, `mightBeVisible()` — altitude/azimuth computation, transit time search, declination pre-filter.
- **Spatial index** (`spatial-index.ts`): 2D spatial bucketing for fast nearest-DSO lookup on canvas clicks.
- **Search** (`search.ts`): Unified fuzzy search for both stars and DSOs by name, with scoring and brightness boost.
- **Thumbnail worker** (`thumbnail-worker.ts`): Vite web worker. Receives `{ id, file, maxWidth }`, uses `createImageBitmap` + `OffscreenCanvas` to resize the image off the main thread, posts back `{ id, blob }`. Instantiated lazily via `getWorker()` inside `src/lazy-image.ts` so the module loads cleanly in Vitest/happy-dom where `Worker` is not defined.
- **Lazy image helper** (`lazy-image.ts`): Two exports used across the app. `generateThumbnail(file, maxWidth)` posts to the thumbnail worker and returns a blob URL promise. `createLazyObserver({ scrollRoot, rootMargin, onVisible, onHidden })` wraps `IntersectionObserver` for viewport-based lazy loading.
- **Toast** (`toast.ts`): Lightweight toast notification system.
- **API client** (`api.ts`): HTTP client for backend API. Functions: `uploadPhoto()`, `getPhotos()`, `deletePhotoAPI()`, `solveWCS()`, `solveASTAP()`, `submitAstrometryJob()`, `pollAstrometryJob()`. DSO override functions: `getDsoOverrides()` (fetch all), `upsertDsoOverride(id, data)`, `deleteDsoOverride(id)`. Export/import: `exportData(options: ExportOptions, ids: string[])` builds a ZIP with configurable content; `importData(file, strategy, overrides?, skipDsoOverrides?)` uploads a bundle. `ExportOptions`: `{ includeImages?, includeMetadata?, includeDsoOverrides? }`. `parseServerError(data, fallbackKey)` — translates a server `{ code, error }` response into a user-facing string: first tries `t('serverErrors.' + code)` (i18n key); if the code has no translation it falls back to `data.error`; if neither is present it falls back to `t(fallbackKey)`.
- **UI** (`ui.ts`): Side panel with sections:
  - Photos section: Photo list with thumbnails, visibility toggles, gear popup (opacity, z-order, reposition, delete)
  - Search section: Unified star/DSO search with dropdown results, navigate to object
  - Display section: All toggles (stars, DSOs, constellations, grid, labels, tooltips) and sliders (magnitude, opacity, counts)
  - View mode toggle: Switch between Map, Gallery, and Targets modes
  - DSO info panel (shown on canvas click): Edit button opens the DSO editor modal
  - Export modal: content checkboxes (photo metadata, DSO metadata overrides) + per-photo image selection; images are included for every checked photo
  - Import modal: conflict strategy radio buttons + "Skip DSO metadata overrides" checkbox
- **View modes** (`types.ts`): Three modes — `'skymap'` (default), `'gallery'` (photo grid), `'targets'` (recommendation panel).

## Backend (`server/`)

Express 5 server with multiple modules:

- **`index.ts`**: Main routes:
  - `POST /api/photos` — Upload + resize via Sharp to max 2048 px, generate `{uuid}_thumb.jpg` (400 px, JPEG q75) via Sharp, scale correspondences proportionally, store in SQLite + disk; returns `thumbFilename` in response. Sharp errors on invalid/corrupt image files return **HTTP 400** with `{ code: 'INVALID_IMAGE' }` rather than 500.
  - `GET /api/photos` — List all photos with correspondences
  - `DELETE /api/photos/:id` — Delete photo file and its `_thumb.jpg` sibling
  - `PATCH /api/photos/:id/manual-placement` — Update manual placement parameters for photo repositioning
  - `POST /api/solve-wcs` — Extract WCS metadata from FITS/TIFF headers
  - `POST /api/solve-astap` — Run ASTAP local plate solver
  - `POST /api/solve-plate` — Submit job to astrometry.net
  - `GET /api/solve-plate/:jobId` — Poll astrometry.net job status
  - `GET /api/stars/search?q=...` — Deep star search (server catalog mag ≤14)
  - `GET /api/dso-overrides` — Return all user DSO overrides as `{ [id]: DSOUserOverride }`
  - `PUT /api/dso-overrides/:id` — Upsert a single DSO override; validates RA ∈ [0, 360) and Dec ∈ [−90, 90], returning HTTP 400 with `{ code: 'INVALID_DSO_RA' }` or `{ code: 'INVALID_DSO_DEC' }` if out of range
  - `DELETE /api/dso-overrides/:id` — Delete a single DSO override
  - `POST /api/export` — Build and stream a ZIP with configurable content (images + their `_thumb.jpg` siblings when present, photo metadata JSON, `dso-overrides.json`). The photo metadata manifest uses format `{ manifestVersion: 1, photos: [...] }` (see [Export manifest versioning](#export-manifest-versioning) below).
  - `POST /api/import` — Import a `.zip` or `.json` bundle; reads `thumbFilename` from manifest; regenerates any missing `_thumb.jpg` files with Sharp after import; respects `strategy` (skip/replace) and `skipDsoOverrides` flag. Accepts both the legacy bare array manifest and the new versioned manifest.
  - Static file serving for uploads and SPA fallback

#### Rate limiting

Express in-memory rate limits protect all API routes (global) and the `POST /api/photos` upload route (stricter). Two env-var controls:

- **`TRUST_PROXY=1`** (or `true`): call `app.set('trust proxy', 1)` so Express resolves the real client IP from `X-Forwarded-For`. Required when running behind a reverse proxy (Docker Compose with Nginx, etc.). Without it, every request would appear to come from `127.0.0.1` and the rate limiter would treat all users as one.
- **Electron**: when the Express server is loaded inside the Electron main process (`process.versions.electron` is set), rate limiting is disabled entirely. The app is single-user/local so limits would only hurt the user.

- **`db.ts`**: SQLite (better-sqlite3, WAL mode) with tables:
  - `photos`: id, filename, originalName, width, height, displayOrder, createdAt, thumb_filename
  - `star_correspondences`: id, photoId, pointIndex, photoX, photoY, starHip, starName, starRa, starDec
  - `dso_overrides`: id (TEXT PRIMARY KEY), data (TEXT — JSON-serialised `DSOUserOverride`)
  - `schema_version`: single-row table tracking the migration version (see `db-migrations.ts`)
  - Photo + correspondences inserted in transaction
  - DSO override CRUD: `getDsoOverride(id)`, `getAllDsoOverrides()`, `upsertDsoOverride(id, data)`, `deleteDsoOverride(id)`
- **`db-migrations.ts`**: Exports `applyMigrations(db)`. Creates the `schema_version` table on first run, then executes each pending migration in version order and updates the row after each. All historical `ALTER TABLE` additions are consolidated in migration 1 (idempotent via try/catch). Future schema changes go in as migration 2, 3, etc. Accepts any `Database.Database` instance so it can be tested against an in-memory DB without side effects.
- **`astap.ts`**: ASTAP CLI integration — spawns subprocess, writes temp file, parses .ini solution, generates correspondences from WCS. Sets `LC_ALL=C` and `LANG=C` in the subprocess environment to normalise the decimal separator (prevents comma-vs-dot locale issues in parsed coordinates). Logs the ASTAP binary version (`-v`) once per binary path on first use.
- **`solve-field.ts`**: solve-field (Astrometry.net local) integration — same locale normalisation (`LC_ALL=C`, `LANG=C`) and one-shot version logging (`--version`) per binary path.
- **`astrometry.ts`**: Astrometry.net online API wrapper — job submission with hints (position, FOV), polling with exponential backoff, calibration parsing
- **`wcs-reader.ts`**: WCS metadata extraction from FITS/TIFF — parses headers (CRPIX, CRVAL, CD/PC matrix, CDELT, CROTA), transforms pixel→RA/Dec using WCS formulas, generates correspondences by matching to star catalog
- **`import-utils.ts`**: Shared helpers for the import/export pipeline. `parseManifestPhotos(parsed)` accepts both the legacy bare-array manifest and the versioned `{ manifestVersion, photos }` object; returns an empty array for unrecognised input. `validateDsoOverrideCoords(data)` checks RA/Dec ranges and returns an `{ error, code }` object or `null`.
- **`star-search.ts`**: Server-side deep catalog search (stars.14.json, ~118k stars, mag ≤14) for sparse fields (galaxies, high declination)

### Export manifest versioning

The `POST /api/export` route wraps the photo array in a versioned envelope:

```json
{ "manifestVersion": 1, "photos": [ ... ] }
```

This allows `POST /api/import` to distinguish future format changes from the original bare-array manifests produced by older exports. `parseManifestPhotos(parsed)` in `server/import-utils.ts` handles both:

- **Legacy format** (bare array `[...]`) — returns the array directly
- **Versioned format** (`{ manifestVersion, photos: [...] }`) — returns `photos`
- **Unrecognised input** — returns `[]` (import proceeds with zero photos rather than crashing)

`manifestVersion` is intentionally a plain integer with no semver meaning. When the schema changes incompatibly in the future, increment it and add a new branch to `parseManifestPhotos`.

## Electron vs. web mode

The app ships in two forms: a **web app** (`npm run dev` / Docker) and an **Electron desktop package** (`npm run electron:make`). The same frontend and Express server code runs in both, but several behaviours differ based on runtime detection.

### Detection mechanism

| Context                        | How detected                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Electron (renderer / frontend) | `(window as any).electronAPI` is defined — set by `contextBridge.exposeInMainWorld` in `electron/preload.ts` |
| Electron (Express / backend)   | `!!process.versions.electron` is `true` — set automatically by the Electron runtime                          |
| Web / dev mode                 | Both are absent / falsy                                                                                      |

### Features visible only in Electron

| Feature                             | Where                     | Details                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **IP-based geolocation hint**       | Targets tab, location row | A `<span class="targets-loc-hint">` reading `"IP-based (ip-api.com)"` is appended next to the location button only when `window.electronAPI` is set. In web mode the button shows alone.                                 |
| **Privacy modal geolocation block** | Settings → Privacy        | A second warning block ("Exception : géolocalisation par adresse IP") is injected only in Electron, explaining that ip-api.com is called for location. Absent in web mode where `navigator.geolocation` is used instead. |

### Behaviour differences between Electron and web

| Area                        | Electron                                                                                                                                                                                      | Web (`npm run dev` / Docker)                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Geolocation**             | `window.electronAPI.getLocation()` → IPC → main process → `fetch('http://ip-api.com/json/')`. `navigator.geolocation` is not used (no Google Maps key / no real browser engine in Electron).  | `navigator.geolocation.getCurrentPosition()` — uses the browser's native geolocation.                                       |
| **Rate limiting**           | Disabled (`isElectron` guard in `server/index.ts`). Single-user local app; limits would only hurt the user.                                                                                   | Active. Global limiter + stricter per-upload limiter.                                                                       |
| **Settings encryption key** | Auto-provisioned via `electron.safeStorage`: generated once, encrypted with the OS keychain, stored in `userData/settings-encryption-key.bin`. Available on every launch without user action. | Must be injected as `SETTINGS_ENCRYPTION_KEY` env var (Docker secret / `.env`). If absent, settings are stored unencrypted. |
| **Data directories**        | `UPLOADS_DIR` and `DB_PATH` point to `app.getPath('userData')` (OS user-data folder). Data survives app updates because it lives outside the `.asar` archive.                                 | Defaults: `./uploads/` and `./data.db` relative to the process working directory (or overridden via env vars).              |
| **Express port**            | `findFreePort(3001)` scans for the first free TCP port ≥ 3001. The `BrowserWindow` loads `http://localhost:{port}`. Port 3001 is not guaranteed.                                              | Fixed at `3001` (or `PORT` env var).                                                                                        |
| **Application menu**        | Removed with `Menu.setApplicationMenu(null)`.                                                                                                                                                 | N/A (browser chrome).                                                                                                       |

### Electron startup sequence

The Electron entry point (`electron/main.ts`) runs as follows:

1. `app.whenReady()` — wait for Electron to initialise.
2. `initSettingsEncryptionKey()` — provision or load the settings encryption key via `safeStorage`.
3. `findFreePort(3001)` — find a free port and set `process.env.PORT`.
4. Set data-directory env vars (`UPLOADS_DIR`, `DB_PATH`, `PUBLIC_DATA_DIR`, etc.) **if** `app.isPackaged`. In dev Electron (`npm start`), defaults are used, same as the web dev server.
5. `await import('../server/index.js')` — dynamically import the Express server **after** env vars are set (static ESM imports would be hoisted before the env vars are ready).
6. `waitForPort(port)` — poll until Express accepts connections.
7. Open `BrowserWindow` and load `http://localhost:{port}`.

### Dependency note: archiver

`archiver` is pinned to `^7.0.1`. archiver v8.0.0 (May 2026) is a breaking major release:

- Package became **ESM-only** (`"type": "module"`) — cannot be loaded via `createRequire`
- Callable API `archiver('zip', options)` replaced by named classes: `new ZipArchive(options)`

To migrate to v8 when `@types/archiver` publishes v8 types:

1. Remove the `createRequire` block and add `import { ZipArchive } from 'archiver'`
2. Replace `archiver('zip', { zlib: { level: 1 } })` with `new ZipArchive({ zlib: { level: 1 } })`
3. Bump `"archiver"` to `"^8.0.0"` and drop `@types/archiver` (types will be bundled)

## Performance Architecture

Three distinct optimisations address the app's main performance pain points.

### Off-thread thumbnail generation (batch upload modal)

The batch upload modal builds card shells synchronously with no `img.src` set. An `IntersectionObserver` (created via `createLazyObserver` in `src/lazy-image.ts`) watches the `.batch-list` scroll container. When a card enters the viewport:

1. `generateThumbnail(item.file, 240)` is called — this posts the raw `File` to the thumbnail Web Worker (`src/thumbnail-worker.ts`).
2. The worker uses `createImageBitmap` + `OffscreenCanvas` to resize and encode off the main thread.
3. The resolved blob URL is set as `img.src`.

Blob URLs are revoked when a card is removed (trash button) and when the modal closes. The state machine (`null` = not requested, `''` = pending, non-empty = loaded) prevents duplicate worker requests when a card re-enters the viewport after scrolling away.

### Viewport-only lazy loading (gallery)

`Gallery.render()` (re)builds all `<div class="gallery-item">` shells immediately but does not set `img.src`. A fresh `IntersectionObserver` is attached to the `#gallery-container` scroll element. On intersection, each `<img>` gets `src` set to `/uploads/{thumbFilename}` if a server thumbnail exists, or `/uploads/{filename}` otherwise. The previous observer is always disconnected before the rebuild.

### Sky map pan/zoom freeze + LOD

**Pan/zoom debounce:** `main.ts` listens to `skyMap.setOnViewChange()`. On the first callback of an interaction, it adds `.photos-frozen` to `#photo-layer`, hiding all `.photo-overlay-img` elements via `visibility: hidden`. A 100 ms debounce timer removes the class after interaction ends. This prevents full-res images from repainting on every animation frame during pan or wheel zoom while still allowing transform recomputation to proceed.

**Level-of-detail swap:** Inside `PhotoOverlay.applyTransform()`, the rendered pixel width is estimated as `Math.sqrt(matrix.a² + matrix.b²) × photo.width`. When this value drops below 300 px and `photo.thumbFilename` is set, `img.src` is switched to the thumbnail URL. When it rises above 300 px, it is switched back. `photo.width` (the authoritative database value) is always used for all matrix calculations — `imgEl.naturalWidth` is never used — so swapping `src` between full-res and thumbnail does not affect hit-testing, outline drawing, or transform accuracy.

### DSO render selection (priority + spread + container gating)

When the viewport holds more DSOs than the render budget (`maxDSOCount`, the "display few/many objects" setting), the map must choose which to draw. `SkyMap.selectRenderedDSOs()` (`src/sky-map.ts`) is the **single source of truth** for that choice, consumed by all three places that need it — `renderDSOs()` (shapes), `renderDSOLabels()` (labels), and `isDSORendered()` (hover/click hit-test gating). Keeping one selection guarantees drawing and hit-testing always agree (previously three copies of the logic could drift).

The selection is:

1. **Filter** — type/catalog/magnitude/viewport/hemisphere, as before.
2. **Container gate** — an object with a `containerId` (see [dso-catalog.md](/dev/dso-catalog.md#containment-containerid)) is skipped while its container renders smaller than `DSO_CONTAINER_VISIBLE_RADIUS_PX` (18 px radius). This hides inner objects (e.g. those inside the Orion complex) until the container is large enough on screen to be clean and clickable. Bypassed when the object — or its container — is the highlighted/searched DSO.
3. **Budget** — the remaining candidates are sorted by the precomputed `priority` (rating-weighted blue-noise spread, baked into the catalog at build time — see [dso-catalog.md → Render priority](/dev/dso-catalog.md#render-priority-spatial-spread)), highlighted pinned first, then sliced to `maxDSOCount`. This is `selectDSOsToRender()` in `src/dso-selection.ts` (pure, unit-tested). No per-frame spatial computation: the spread is precomputed, so this is just a sort + slice.

**Why the container gate can't be precomputed:** unlike `priority`/`containerId`, it depends on the container's _current on-screen pixel size_ (zoom), so it is evaluated each frame.

**Caching:** the result is cached on the instance and invalidated at the top of `render()` (every state change calls `render()`), so the three consumers within a frame share one computation. Hover, which fires between frames against an unchanged view, reuses the cache (rebuilding lazily if absent). This is a net reduction vs. the old code, where `isDSORendered` re-scanned all DSOs on every hover.

### Server-side thumbnail generation

On every upload, `server/index.ts` runs Sharp twice: once to resize the original to max 2048 px (stored as `{uuid}.jpg`) and once to produce `{uuid}_thumb.jpg` (width 400 px, JPEG quality 75). The thumbnail filename is stored in `photos.thumb_filename` and returned in `GET /api/photos` so every frontend module can use the server thumb without regenerating it client-side.

**Export/import:** The export ZIP includes `_thumb.jpg` files alongside their full-res counterparts. The import route reads `thumbFilename` from the bundle manifest and, after inserting photos, regenerates any missing thumbnails with Sharp so the LOD system works immediately after import.

---

## Data Flow: Photo Upload with Auto-Solve

1. User clicks "Ajouter des photos" → multi-select file picker → batch upload modal opens with one card per photo
2. On a card, user picks an auto-solve method (WCS / Online / solve-field / ASTAP), or **Manual** to identify stars by hand
3. For ASTAP/online/solve-field: User can optionally enter target object name (M31, NGC7000, etc.) for position hint → unified search finds RA/Dec
4. Card sends file + hints to backend endpoint (manual identification skips the backend and uses the user-supplied correspondences directly)
5. Backend routes to appropriate solver:
   - **WCS**: Parse FITS/TIFF headers → extract WCS → transform pixels to RA/Dec → match to catalog → return correspondences
   - **ASTAP**: Write temp file → spawn `astap_cli` with hints → parse .ini solution → generate correspondences from WCS
   - **solve-field**: Write temp file → spawn `solve-field` with index files → parse WCS output → generate correspondences
   - **Online**: Upload to astrometry.net → poll job status → parse calibration → generate correspondences
6. Backend returns correspondences array with photoX/photoY + starRa/starDec (and starHip if catalog match found)
7. Frontend receives correspondences → calls `computeAffineTransform()` with correspondence pairs
8. Affine transform computed (3-point exact or N-point least squares)
9. CSS `matrix()` applied to `<img>` element for GPU-accelerated positioning
10. Photo stored in SQLite with correspondences, file saved to `uploads/` with UUID name
11. On zoom/pan, `SkyMap` fires `onViewChange` → `PhotoOverlay.updateTransforms()` recomputes all CSS matrices to track canvas viewport

## Data Flow: Photo Repositioning

1. User clicks gear icon on photo → "Reposition" button
2. `PhotoOverlay.startRepositioning(photoId)` called
3. Extract current CSS `transform: matrix(a,b,c,d,e,f)` from photo element
4. Decompose matrix to rotation, scale, centerRa/Dec using inverse projection formulas
5. Enter manual placement mode with photo at current position
6. User adjusts with drag, rotate slider, zoom slider, mirror toggles
7. On "Place on map", generate synthetic correspondences from manual placement params
8. Send `PATCH /api/photos/:id/manual-placement` with new parameters
9. Backend updates correspondences in database
10. Frontend recomputes affine transform with new correspondences, updates photo display

## Key Types (`types.ts`)

- `Star`: hip, ra, dec, mag, bv, name, bayer, constellation, properName, catalogIds
- `DSO`: id, ra, dec, type, majAxis, minAxis, pa, mag, nameFr, nameEn, catalogs, emissionLines, constellation, rating, difficulty, displayName
- `DSOUserOverride`: names? (`fr/en/es/de`), ra?, dec?, constellation?, rating?, difficulty?, type? — persisted in `dso_overrides` SQLite table and applied as an in-memory overlay
- `Photo`: id, filename, originalName, width, height, displayOrder, createdAt, thumbFilename?, correspondences[]
- `PhotoCorrespondence`: pointIndex, photoX, photoY, starHip?, starName?, starRa, starDec
- `AffineMatrix`: a, b, c, d, e, f (CSS matrix coefficients)
- `ViewState`: centerX, centerY, scale, width, height
- `ViewMode`: 'skymap' | 'gallery' | 'targets'
- `GearPreset`: id, nameKey, apertureMm, focalLengthMm, sensorWidthMm, sensorHeightMm, pixelSizeUm, mono, builtIn
- `TargetSuggestion`: dso, maxAltDeg, bestTimeUtc, score, fovFitScore, altScore, brightnessScore
- `ExportOptions`: includeImages?, includeMetadata?, includeDsoOverrides?
