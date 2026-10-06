# MyAstroSky Mobile — Investigation, Architecture & Execution Plan

_Revision 2. It incorporates two independent reviews: one on architecture and feasibility, one on executability by cheaper models._

## Amendments (read first)

_Last updated 2026-10-05. Where this section and the text below disagree, this section wins. Stretches and the status table are in `README.md`, which replaces the stretch table of §6. The user's decisions are in `design/decisions.md`. The independent review that led to these amendments is `mobile-review-2026-10-04.md`._

**Scope (confirmed by the user on 2026-10-05).** A full port: every feature except the local solvers, in portrait **and landscape**. No reduced first release.

**Mobile UI toolkit (§2, §5).** Ionic Vue is used, and its built-in components are preferred wherever one exists: bottom sheets (modal with breakpoints), tabs and navigation, the Android back button, the keyboard, pickers, alerts, action sheets, toggles, ranges, lists and reorder. Do not rebuild what Ionic provides. The `.mob-*` classes of the design system describe the **look** (tokens, sizes, spacing) that the Ionic components are themed to, and remain for what Ionic has no component for (fact cards, the map overlays). Every per-screen spec maps each element to its Ionic component.

**What the phone stores for a photo (replaces spike decision 6 on this point).** The same as the desktop: the original image (orientation baked in) and a thumbnail. No reduced copy is stored. Decoding a reduced bitmap for display is a drawing concern (the canvas photo layer of Phase 4), not a storage one. A backup made on the phone therefore holds the originals.

**Connection to the computer (§4 "LAN connect").** While connected, a visible switch chooses between two modes: **the computer's gallery and plans**, or **the phone's own photos and plans with only the computer's solvers**. The connection screen explains the two modes in printed text. Every screen shows that the phone is connected and whose data is displayed.

**Icons.** Action buttons whose icon is clear carry no label; the name appears on a long press. An eye means show or hide only; adding is a plus button.

**Service rules added after the review** (details in `phase-2/WP2.3-first-services.md`):

- Database calls are grouped: the phone pays about 35 ms per call. No awaited call inside a loop; several writes are one `batch`; tests assert the number of round trips.
- Every `DomainError` has a `code`.
- **The interface between the UI and the data (the `Backend` of §3) is the set of service interfaces**: `Backend = { plans: PlanService; photos: PhotoService; … }`. The local backend is the services themselves; the HTTP backend implements the same interfaces by calling the routes. Service methods therefore take typed parameters from `packages/core/src/domain` (and still validate at run time), not a raw request body, and return domain values, not HTTP responses.
- Services are built by `createServices(deps)`.
- Every `SqlDb` adapter passes one shared conformance suite, which also runs on an asynchronous test adapter that behaves like the phone's.

**Changes to §8 (later phases).**

| In §8                        | Now                                                                                                                                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.0a–h router split          | Done (WP2.0a–k).                                                                                                                                                                                                                                                           |
| 2.1 database factory         | Replaced by the `SqlDb` port and its adapter (WP2.1, WP2.1b) and `createServices` (WP2.6b). `server/db.ts` disappears as services replace it.                                                                                                                              |
| 2.2 `SqlDb` port, migrations | Done (WP2.1, WP2.2): one schema definition in core.                                                                                                                                                                                                                        |
| 2.3 services                 | In progress: five done; plans and photos next (WP2.3f–h); then solved-file import, nova, star search, identification, horizon, backup, version.                                                                                                                            |
| 2.4 contract-test harness    | Replaced by the pinning tests of the routes (WP2.0a, WP2.4a, WP2.4b) and the adapter conformance suite (WP2.6c). The contract tests on both backends remain in Phase 3.                                                                                                    |
| _new, end of Phase 2_        | **Phone database adapter prototype**: the Capacitor SQLite adapter written against the conformance suite and run on the user's phone (needs the phone plugged in). Moved earlier from 6.0.                                                                                 |
| 3.1 `Backend` interface      | Defined by the rule above; card 3.1 writes the HTTP backend and turns `api.ts` into a facade over it.                                                                                                                                                                      |
| _new, end of Phase 3_        | **Remove the shims**: rewrite imports to `@myastrosky/core/*`, delete the one-line re-export files in `src/` and `server/`, add a lint rule against the old paths.                                                                                                         |
| 4.5 catalogue format         | Dropped: the spike showed the JSON catalogue is fast enough.                                                                                                                                                                                                               |
| 5 design                     | D0 and D1 approved. D2 covers portrait and landscape, the red night theme, the missing states (first run, empty lists, errors, permission refused, pending online solves, comets, saved regions), safe areas, and creates `docs/dev/ui/mobile.md` with the approval table. |
| 6.0 shell                    | Also bundles the fonts (the mockups load them from the web).                                                                                                                                                                                                               |

**Process.** A worker updates its own row of the status table in its card's commit; there are no separate status commits from stretch H on.

## Context

MyAstroSky is a desktop/web app: a Vue 3 + Vite frontend (`src/`, ~64k lines) that depends on a local
Express 5 server (`server/`; `server/index.ts` is 5,750 lines with 78 routes) for **everything**:
SQLite (`better-sqlite3`), image work (`sharp`), the local solvers ASTAP and solve-field (`child_process`),
proxies to nova.astrometry.net, TNS, SkyBoT and MPC, horizon terrain, and the export/import ZIP. Electron runs that server
in-process and opens a window on `localhost`.

**Goal:** an Android app (iOS later), built with a hybrid framework.

- The UI is rewritten for touch.
- Core logic is not duplicated.
- There are no local solvers on the phone: only nova.astrometry.net solving and importing already-solved files.
- Future features must land in both shells without the shells drifting apart.
- Implementation is run by **cheaper models** (Sonnet/Haiku subagents). You **see and approve the design before any UI code is written**.

**Decisions taken with you**

| Topic                | Decision                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Mobile scope         | **Full standalone parity** (everything except local solvers)                                       |
| Data between devices | **Standalone on-device DB + export/import ZIP + "LAN connect" to a desktop/Docker server**         |
| iOS                  | **Android first**, kept iOS-ready (no Mac or Apple account yet)                                    |
| Repo                 | **Monorepo in this repo** (npm workspaces)                                                         |
| Device testing       | **Real devices only, plugged in on request. No emulator, ever** (limited disk space)               |
| Models               | **Opus supervises only** and runs the design rounds. Sonnet orchestrates. Sonnet/Haiku implement   |
| CI                   | **Compile Android (`./gradlew build`) and iOS on every push/PR to `dev` and `master`. No nightly** |

---

## 1. Findings that drive the design

**Already reusable**

- About 10k lines of pure TS with no third-party astronomy library, most of it unit-tested (168 test files: 153 unit, 15 component):
  - Astronomy and geometry: `astro-time`, `sky-geometry`, `projection`, `affine`, `mosaic`, `comet-ephemeris`.
  - Planning and identification: `target-recommender`, `imaging-recipe`, `*-identify`.
  - Rendering decisions and hit-testing: `dso-render-select`, `star-budget`, `spatial-index`, `sky-hit-test`, `frame-geometry`, `horizon-io`.
  - Photo placement maths: `photo-placement.ts` (521 lines), including `computePhotoMatrixForView` (`:177`).
- Server modules that are pure apart from `Buffer`/`zlib`: `server/raw-decode/*` (FITS/TIFF decoders), `exif-utils.ts`, and the
  header parsers of `server/wcs-reader.ts`.
- Canvas 2D painters (~5.9k lines) already take a `SkyScene` with a `ctx` (`sky-scene.ts:35`).
- i18n is hand-rolled and Vue-free. It only touches `localStorage`, `navigator`, `location.reload` and `import.meta.env`.

**Blockers**

- **The backend is not abstracted.**
  - 39 modules import `src/api.ts`, and only 7 of them are stores.
  - `api.ts` exports 71 functions whose signatures use `File`, `FormData`, `AbortSignal` and `XMLHttpRequest`.
  - `gear-catalog.ts:111-141` and `dso-catalog.ts:146` call `fetch` directly.
  - `/uploads/` is hard-coded in about 10 places.
- **Business logic sits in Express handlers:**
  - Validation, plus mappers such as `planEntryToApi` (`index.ts:2232`).
  - The upload pipeline (`359-642`) and the gear merge (`1186-1282`).
  - A 400-line import (`3554-3971`) that is **not transactional**.
- **`server/db.ts` has side effects on import:**
  - It opens the DB as soon as it loads.
  - It holds 72 module-level prepared statements and 12 `db.transaction` calls.
  - It creates the schema in two halves around `applyMigrations` (`:80`).
- **Server modules that look pure but are not:**
  - `wcsToCorrespondences` (`wcs-reader.ts:468`) calls `loadServerCatalog()` internally (`:477`), which reads `fs`.
  - `astrometry.ts` imports `./db.js` (which opens the DB) and keeps module-level session and job state.
- **Catalog state lives in module singletons** inside `src/dso-catalog.ts` and `src/star-catalog.ts`, mixed with `fetch`.
  `dso-render-select`, `sky-hit-test`, `multiple-stars`, `photo-placement`, `stores/fov-frames.ts` and `sky-scene-render` all read them.
- **Duplicated code and types** between `src/` and `server/`: `normalizeRA` ×3, angular distance ×4, `CometElements`, `HorizonSummit`,
  `StarMultiplicity`, the Photo shape.
- **No touch support at all:**
  - Mouse and wheel events only, in `sky-map-events.ts`.
  - A hard-coded 280px panel at `sky-map-events.ts:221-225`.
  - Photos are DOM `<img>` elements positioned with CSS `matrix()`.
  - 61 `@mouse*`/`@keydown` bindings in components.
- **Imperative UIs embed logic the mobile app needs:** `targets-view.ts` (6,011 lines), `photo-overlay.ts`, `fov-overlay.ts`.
- **The star catalog is ~15 MB of JSON** (`public/data/stars.14.json`).
- **Some user state is only in `localStorage`** and never reaches the export ZIP: `fov-frames-v1`, `fov-adhoc-mosaics-v1`,
  `targets-prefs-v3`, `horizon-settings-v1`, `display-settings`, hidden filters. Only keyboard shortcuts are exported today.

**CORS from a WebView** (checked by curl, 2026-10-03)

- Open: MPC, SkyBoT, Terrarium, GitHub, ip-api.
- Blocked: **nova.astrometry.net** and **TNS** (TNS also needs a custom User-Agent). Both need native HTTP.
- Not verified: **Overpass** (used by the horizon feature). Spike WP0.3 checks it.

**Side findings (fix regardless of mobile)**

- `sanitizeIntegrationRows` behaves differently in `index.ts:156` and `db.ts:200`.
- Import is not atomic.
- The nova path skips EXIF orientation correction.
- `plate-solver.ts`, `star-detector.ts` and `light-solve.ts` are dead code; only tests import them.
- Doc drift: `architecture.md` claims a 2048px resize on upload; `distribution.md:207` claims `/api/config` returns `solveFieldAvailable`.
- `test.yml` only runs on `master`/`main`, so pull requests to `dev` run no tests. `ci.yml` never runs the root `typecheck` script.
- `.claude/agents/ui-verify-reviewer.md` tells the reviewer to kill orphaned dev servers, which contradicts the root `CLAUDE.md` rule.

---

## 2. Framework: Capacitor + Vue 3 + Ionic Vue

- **Capacitor** runs the same Vite/Vue/TS build in the system WebView.
  - The core, the canvas renderer, Pinia and i18n run unchanged.
  - It has the strongest plugin ecosystem: SQLite, Filesystem, native HTTP that bypasses CORS, Geolocation, secure storage, share intents, file picker, keep-awake.
- **Ionic Vue** provides the mobile primitives: sheets, navigation, the Android back button, safe areas, keyboard handling, virtual scroll.
  - It is themed by CSS variables, so it maps onto `tokens.css`.
  - This is the main lever against "basic UI issues".
- **Rejected:**
  - React Native / Flutter: they would mean rewriting the UI and the renderer (and the core too, for Flutter).
  - Tauri 2 mobile: thin plugin ecosystem, and native code is in Rust.

---

## 3. Target architecture

The desktop app **stays at the repo root** (`src/`, `server/`, `electron/` do not move). This avoids rewriting
every config, hook, skill and doc path. New code goes into workspaces.

```
src/, server/, electron/   Desktop + server + Electron — unchanged locations, gradually thinned.
packages/core/      Pure TS. tsconfig lib ["ES2022"], types [] → compiler-enforced purity.
                    A hand-written env.d.ts declares only: console, TextEncoder/TextDecoder, timers.
                    astronomy, projection, affine, mosaic, recommender, identify, WCS/FITS/TIFF/XISF decoders,
                    domain types, i18n (platform injected), CATALOG REGISTRIES (state + lookups),
                    Backend + port interfaces, SERVICES, migrations.
packages/render/    Canvas 2D painters + scene + Pointer-Events gesture controller (theme injected).
packages/backend-http/   HttpBackend(baseUrl, token?) — today's api.ts behind the Backend interface.
packages/backend-local/  LocalBackend = core services + ports (adapters supplied by the shell).
packages/app-state/ Shared Pinia stores that depend only on Backend + PrefsStore + core registries.
apps/mobile/        Capacitor + Ionic Vue. LocalBackend (standalone) or HttpBackend (LAN connect).
```

**Dependency rules.** These are enforced by an ESLint `no-restricted-imports` rule set to _error_, plus the tsconfig `lib` setting:

- `core` imports nothing: no vue, pinia, `@capacitor/*`, `node:*`, `src/` or `server/`.
- `render` imports `core` only.
- `app-state` imports `core` plus vue and pinia.
- Apps import packages and never each other.
- `server` imports `core` only.

**Catalog registries (new, from review).** The DSO and star catalogs get a home in core:

- `core/catalog/dso-registry.ts` and `core/catalog/star-registry.ts` hold the state, a setter (`setDsoCatalog(json, overrides, lang)`) and all lookups.
- Each shell keeps only a loader, which fetches the data through `CatalogSource` and calls the setter.
- This is what lets `dso-render-select`, `sky-hit-test`, `photo-placement` and the painters move into shared packages.

**Ports.** Signatures were validated against the code.

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

**Backend interface types.** The interface lives in core, so it cannot use browser types:

- `FileInput { name; type; bytes(): Promise<Uint8Array> }` replaces `File`.
- A progress callback replaces `XMLHttpRequest` progress, and a `CancelToken` replaces `AbortSignal`.
- The `api.ts` facade adapts browser types to these.

**Services in core.** Each throws a `DomainError`. Its kinds are `invalid`, `notFound`, `conflict`, `rateLimited` and `upstream`, and it keeps the
existing `code` strings that `parseServerError` (`api.ts:23`) translates. Long-running work returns a job handle, not an error.

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

ASTAP and solve-field stay server-only and are exposed through **capabilities**.

**The seam is `api.ts`.**

- It keeps its exported names as a facade over `getBackend()`, set once with a module-level `setBackend()`.
- All 39 importers and every `vi.mock('../api')` keep working unchanged while the stores live in `src/`.
- When a store moves to `app-state` (card 3.5), its test is updated to mock the backend, not `src/api`.
- A new `photoUrl(name)` replaces the hard-coded `/uploads/` paths.
- `export()` returns bytes instead of downloading.

**SQL portability.** The schema already avoids `RETURNING`, `json_*` and `STRICT`. The mobile adapter must:

- pass `transaction:false` when it manages the transaction itself;
- set `PRAGMA foreign_keys=ON` explicitly;
- keep WAL on the server only;
- run migrations through our own runner, from a merged v0 baseline.

On mobile, write as read-then-`batch()`: each bridge round-trip costs 1–5 ms.

**Transaction safety rule during the transition.** While old synchronous `db.ts` code and new services share one connection:

- inside `SqlDb.transaction()`, only `SqlDb` calls may be awaited — never sharp, file or zip work;
- card 2.2 adds a test that proves a legacy statement cannot run inside an open service transaction.

---

## 4. Mobile-specific engineering

**Sky map on touch**

- A gesture controller in `render/`, built on Pointer Events:
  - pan with fling;
  - pinch zoom about the centroid (`sky-view-math.ts`);
  - tap to select, with a larger hit radius;
  - long-press to open a sheet;
  - `touch-action:none` on the canvas.
- Desktop gets touchscreen support from the same controller.
- **Catalog:** decided by spike WP0.2. The likely outcome is a compact binary catalog with tiered loading.
- Cap the DPR at 2, render on demand, and pause the timers while backgrounded.

**Photos on the canvas (corrected after review)**

- The reusable part is `computePhotoMatrixForView` (`photo-placement.ts:177`). The export routine in `export-render.ts` is **not** a frame painter: it loads a full-resolution image on every call.
- A new canvas photo layer is needed, with its own ImageBitmap cache, level-of-detail selection and eviction.
- These parts of `photo-overlay.ts` do not carry over and are redesigned for mobile:
  - level-of-detail by swapping `img.src`;
  - hiding photos while panning (`.photos-frozen`) — a canvas must redraw them every frame;
  - manual repositioning, which reads the transform back from the DOM (`:2469-2483`) and drags with window mouse events;
  - the layer order: sky canvas, then photos, then the overlay canvas.
- Spike WP0.2 measures this before any commitment.

**Touch equivalents (from review).** These desktop interactions have no touch equivalent yet. Design round D1 must decide each one:

- hover tooltips (`requestHover`);
- right-click clears the selection (`sky-map-events.ts:177`) — on Android a long-press fires the same event, which collides with "long-press opens a sheet";
- freehand region drawing uses press-and-drag, which collides with panning;
- keyboard shortcuts, including the time controls;
- gallery controls that appear on mouse move;
- FOV-frame handles sized for a mouse.

A Sonnet card (WP5.0) produces the full inventory from the code, as input to D1.

**Field use**

- A night-vision **red theme**, for both the UI tokens and `SKY_THEME`.
- Keep the screen awake during sessions.
- GPS location.
- Offline except for solving and identification.

**Photos and solving on the device**

- **Import already-solved files** through core decoders (`Uint8Array`/`DataView`, fflate):
  - FITS, TIFF, **XISF** (new) and **`.wcs` sidecars** (new).
  - Desktop gets XISF and sidecars too.
- **nova.astrometry.net** through `NovaSolveService` + CapacitorHttp:
  - downscale to about 2,000 px before upload;
  - API key stored in the Keystore;
  - the plan target is used as the solve hint;
  - jobs resume after the app is suspended.
- **Getting files in:**
  - a file picker that accepts any MIME type (FITS, XISF);
  - an **Android "Share to MyAstroSky" intent**, for files from the Seestar, ASIAIR or Gallery apps;
  - the camera roll.
- **Memory:** decode with `createImageBitmap(resize*)` and keep only a display copy plus a thumbnail.

**LAN connect**

- The phone uses `HttpBackend(baseUrl, token)` against the desktop or Docker server.
- Server side:
  - an opt-in "Allow LAN devices" setting;
  - a CORS allowlist for `https://localhost` and `capacitor://localhost`;
  - a QR pairing token;
  - an `/api/capabilities` endpoint.
- Android side: `network_security_config` for private IPs, and `photoUrl()` returns absolute URLs.
- **Bonus:** while connected, the phone can run **ASTAP or solve-field on the desktop**.

**Information architecture** (a starting point; the design phase decides)

- Bottom tabs: **Sky · Targets · Plans · Library · Settings**.
- **Sky:** a full-screen canvas, search, a time scrubber, and an object bottom sheet (peek, half, full).
- **Targets:** filter chips plus a filter sheet, and cards with an altitude sparkline.
- **Plans:** plan detail, a framing editor with FOV-frame gestures, and mosaics.
- **Library:** a grid, a photo detail view with metadata and identification, and an import flow (pick, then solved or online solve, then place).
- **Settings:** gear setups, location, language (FR/EN/ES/DE), theme and night mode, astrometry key, LAN pairing, export/import.

---

## 5. Design: what you see, and how you approve it before any code

**Tools available in this environment (verified)**

- The **"Design" Artifact type**: a design canvas with live artboards, published as a private page on claude.ai.
  - You open the link in your browser and see every screen side by side in phone frames.
  - You can click through interactive flows and leave comments pinned to artboards.
  - I read your comments, revise, and republish to the **same URL**. Each round is labelled ("R1 wireframes", "R2 hi-fi", …).
- The **"Design System" Artifact type**: your account has none yet.
  - It will be built **from the codebase**: `tokens.css`, the UnoCSS shortcuts, the 25 components in `docs/dev/ui/components.md`, and the themes.
  - The mobile designs then use your real colours, type and spacing, not generic ones.

**Approval loop.** Rounds D0–D3 run on Opus (your decision). A Sonnet subagent gathers the inputs from the code first (tokens, components, the touch inventory), so Opus only composes.

| Round                    | What you get                                                                                                                                                           | What you do                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **D0 Design system**     | A Design System artifact made from the repo: tokens, components, plus a mobile layer (48dp touch targets, tab bar, bottom sheet, FAB, safe areas, **night-red** theme) | Check that it "looks like MyAstroSky"; comment              |
| **D1 Wireframes**        | One canvas of grayscale phone-frame artboards for all 5 tabs and the main flows, plus a decision for every item of the touch inventory                                 | Validate the structure and navigation; comment on artboards |
| **D2 Hi-fi**             | Every screen in dark, light and **red**, at Android 412×915 (plus one iOS 390×844 check)                                                                               | Comment on visuals and density                              |
| **D3 Interactive flows** | Clickable prototypes of the 4 hard flows (sky gestures → sheet, framing editor, photo import + solve, plan reorder)                                                    | Approve each flow                                           |

**The approval record.** It must be checkable by a cheap orchestrator, so it is a file, not a chat message.

- File: `docs/dev/ui/mobile.md` holds the binding rules (Ionic components only, tokens only, touch sizes) and an **approval table**.
- Table columns: screen · round · artboard link · exported PNG path · spec path · **status** (`draft` / `approved` / `as-built approved`) · **approved by you on** (date).
- Only the Planner writes `approved`, and only after your explicit message in the chat. The date and your wording are recorded.
- **Workers cannot open a private claude.ai link.** So for each approved screen, the Planner exports into the repo:
  - a PNG of the artboard per theme;
  - a written spec: the component tree mapped to Ionic components, tokens, spacing, states, empty and error states, i18n keys.
- **Hard gate, checked by the orchestrator before dispatch:** a card that touches `apps/mobile/src/**` UI is dispatched only if every screen it names has status `approved` and its PNG and spec files exist.
- **What the gate covers:**
  - All mobile screens.
  - Card 6.0 (the app shell: tab bar, theme, tokens) is gated by D0 and D2.
  - Cards 4.2 and 4.3 change the **desktop** app. They are exempt from this gate and go through the existing desktop `ui-verify` workflow.

**You see the result a second time: the as-built review.** After each mobile wave:

1. Screenshots of the implemented screens are taken from your **real Android device**.
2. A Sonnet subagent places them next to the approved artboards on an "As built — Wn" page of the same Design artifact.
3. You compare them and comment. Differences become fix cards.
4. A wave is merged only when its screens have status `as-built approved` in the table. Until then the wave is in the state `blocked on you`.

**Timing.** Design D0–D3 runs **in parallel with Phases 1–3**, which are backend and refactor work with no UI. Mobile UI coding (Phase 6) starts only after D3.

**Automated UI verification**, which catches regressions between your reviews:

- **L1 — phone-sized browser.** An MCP server `playwright-mobile` (`npx @playwright/mcp@latest --device "Pixel 7" --isolated`) against the mobile dev server.
  This is desktop Chromium with a phone viewport and touch. It is **not** an Android emulator. It reuses the Chromium that the existing Playwright MCP already installed.
- **L2 — the real app on your real device (USB).** Driven by a **Node script** (`playwright-core` `connectOverCDP`), not by an MCP server, so subagents and the orchestrator can run it without a restart:
  1. `adb devices` must show a device in the `device` state. If it doesn't, **stop and ask you to plug one in**.
  2. `adb reverse tcp:5173 tcp:5173`, so live reload works over USB.
  3. `npx cap run android --target <serial> --live-reload --host localhost --port 5173`, wrapped in a timeout. Always pass `--target`.
  4. `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>`
  5. The script connects to `http://localhost:9223`, drives the app and saves screenshots and metrics as files.
  6. `adb exec-out screencap -p` for native overlays (status bar, keyboard).
- **L3 — CI.** Playwright `toHaveScreenshot` baselines per screen, at 2 sizes, in dark, light and red, in the L1 phone-sized browser.
- **Reviewer agent.** A new `mobile-ui-verify-reviewer` agent with this checklist:
  - touch targets ≥48dp;
  - nothing hover-only;
  - input text ≥16px;
  - safe areas respected;
  - landscape works;
  - the keyboard never hides the focused input;
  - scrolling a sheet doesn't pan the canvas;
  - the Android back button closes sheets;
  - main actions within one-hand reach;
  - the screen matches its approved PNG and spec.
- **Hook update.** `ui-verify-guard.js` already matches `apps/mobile/src/**`. It must also accept the new agent type (`:129`) and the `playwright-mobile` screenshot tool (`:173`), or it blocks mobile sessions forever. Stop hooks don't run for subagents, so UI cards state the verification explicitly.

**Device rule (strict; in every device card, in `apps/mobile/CLAUDE.md`, and enforced by permission deny rules)**

- **Never install, create or launch an Android emulator, an AVD or a system image.**
- Never run `sdkmanager` or `avdmanager`.
- **Gradle must not download SDK packages by itself:** every Android project sets `android.builder.sdkDownload=false` in `android/gradle.properties`. If a platform or build-tools version is missing, the build fails with its name, and the worker reports it.
- `ANDROID_HOME` is set **per command** (`$env:ANDROID_HOME = '…\Android\Sdk'`), never globally.
- Never run `cap run` without `--target <serial>`, and always wrap it in a timeout. Without a target it can open an interactive device picker and hang.
- Device steps are **batched into device sessions**: the code is written without a device, then the orchestrator asks you once to plug the phone in and runs all pending device checks in sequence.
- Subagents cannot ask you anything. A worker that needs a device and finds none **escalates** to the orchestrator, which asks you.

---

## 6. Execution model: cheaper models, subagents, task cards

**Roles**

| Role                    | Model                                                                    | Does                                                                                                                                                       | Volume                               |
| ----------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Planner / reviewer**  | Opus                                                                     | Writes each phase's task cards from subagent summaries, decides go/no-go, runs the design rounds, reviews the high-risk cards, answers escalations         | ~1 session per phase + design rounds |
| **Orchestrator**        | **Sonnet** subagent, spawned in the background from this session         | Dispatches ready cards, runs acceptance and device sessions, updates the status table, talks to you. **Never designs** and never improvises outside a card | Throughout                           |
| **Worker (code)**       | `model: "sonnet"` subagent, working on the phase branch in this checkout | Implements one card                                                                                                                                        | Most cards                           |
| **Worker (mechanical)** | `model: "haiku"` subagent                                                | File moves with shims, i18n strings in 4 languages, doc tables, copying cards into files                                                                   | ~30% of cards                        |
| **Verifier**            | `ui-verify-reviewer` (already Sonnet), new `mobile-ui-verify-reviewer`   | UI sign-off                                                                                                                                                | Each UI card                         |

**Opus budget rules: the expensive model supervises and never implements**

- **Opus never** does any of these:
  - writes or edits product code or tests;
  - runs the orchestration loop;
  - does file moves, i18n or docs;
  - re-runs acceptance commands;
  - reads large files itself.
- **Reconnaissance is delegated.** When a card needs facts from the code, a Haiku or Sonnet subagent gathers them and Opus reads only its summary.
- **What Opus does spend tokens on:**
  1. Writing each phase's cards from those summaries: one short session per phase.
  2. The go/no-go **decision** after the spikes. A Sonnet subagent drafts `spike-results.md`; Opus only decides.
  3. Reviewing only the **high-risk cards**: 2.2 (DB port and transactions), 3.1 (backend seam), 4.3 (gestures). Every other review is a Sonnet `/code-review`.
  4. Escalations that the orchestrator cannot resolve.
  5. The design rounds D0–D3 (**your decision: Opus**). They are bounded to 4 rounds plus revisions and start in wireframe mode.
     Sonnet gathers the inputs and builds the "as built" pages.
- **Copying the Phase 0/1 cards from this plan into repo files is a Haiku task** (card WP0.0).
- **This session stays on Opus only as a relay and supervisor.** The orchestrator and all workers are Sonnet or Haiku subagents; Opus takes one short turn per stretch boundary.

**One branch, no worktrees (your decision).** All work happens in this checkout, on one branch per phase created from `dev`
(`mobile/phase-N`), plus the throwaway `spike/mobile` branch for the Phase 0 spikes. This checkout is on `dev` today.

- **Why not worktrees:** each one costs about 0.7 GB and an `npm ci`, lacks the gitignored folders (`test-photos/`, `build/icons`, `data.db`),
  and the review showed there is almost nothing to run in parallel anyway.
- **What it costs:** this checkout is on the phase branch while the orchestrator runs, so you cannot develop on another branch here at the same time.
- **Your untracked files stay in place.** `ARCHITECTURE_REVIEW.md`, `other-resources/` and the others are never added, moved or deleted.
  Workers stage files **by explicit path** (`git add <paths>`), never `git add -A` or `git add .`, and never run `git clean`.

**How many subagents.** I can't quote a fixed harness limit. With one shared checkout, the rule is simple:

- **One code card at a time.** The next worker starts only after the previous card is committed and `npm run verify` is green.
- **One docs-only card may run alongside**, because it touches different files (WP1.9).
- **Two workers may run together only on fully disjoint files**, and each stages only its own paths. This applies mainly to Phase 6 screens.
- Browser checks share one dev-server port pair and one Playwright browser, so they run one at a time.
- Device checks need your phone plugged in, so they are serialized and batched.

| Phase     | Parallelism                                                                                   |
| --------- | --------------------------------------------------------------------------------------------- |
| Phase 0   | 1                                                                                             |
| Phase 1   | 1 code card at a time, plus the docs card alongside                                           |
| Phase 2   | 1; up to 2 for services once each has its own router and service file                         |
| Phase 3/4 | 1                                                                                             |
| Phase 6   | up to 2 (screens in different files; i18n split into per-feature modules to avoid collisions) |

**Disk rules (in the orchestrator protocol)**

- About 20 GB is free on C: (measured 2026-10-03). Measure it (`Get-PSDrive C`) before any Android build or `electron:package`. If it is under 6 GB, stop and report.
- **No local `docker build`.** The `docker.yml` CI job smoke-tests the image on the PR to `master`.
- `npm run clean` deletes `dist`, `.vite` and `out`. Run it after `electron:package`, and only when no dev server is running.
- The first Android build downloads Gradle and its dependencies into `~/.gradle`. Budget **2–4 GB**, once, and report the real figure.

**The command permission list (set up once, before the first run)**

_What it is._ Claude Code asks you "Allow this command?" before running a shell command, unless the command is on a pre-approved list.
That list is a settings file in the project. Today `.claude/settings.json` pre-approves `npm run`, `npm test`, a few `npx` commands and read-only git.
Anything else — `git commit`, `git add`, `npm install`, `adb`, Gradle — triggers a prompt.

_Why it matters here._ The orchestrator and its workers run in the background while you do something else. A prompt nobody answers
stops the run, or the command is refused. So the commands the cards need are pre-approved, and the commands you never want are blocked outright.

_What is added_, in `.claude/settings.local.json` (your local settings file; `.claude/settings.json` is not changed):

- **Allow — runs without a prompt:**
  `git add`, `git commit`, `git switch`, `git branch`, `git mv`, `git restore`, `git revert`, `git status`, `git log`, `npm install`, `adb`, `npx cap`, `gradlew`, `node spikes/…`
- **Deny — refused even if an agent tries, and it overrides any allow rule:**
  `git push`, `git stash`, `git clean`, `git add -A`, `git reset --hard`, `sdkmanager`, `avdmanager`, `emulator`
- The deny list is the technical guard behind your rules: no emulator, no SDK installs, nothing pushed, your untracked files left alone.
  Note that `.claude/settings.json` currently pre-approves `git stash`; the deny rule overrides it for this work.
- Each rule is written for both shells (`Bash(...)` and `PowerShell(...)`).
- I show you the exact lines before writing them, and you can remove them when the mobile work is finished.

**Commits (verbatim block in every card and in your kick-off prompt)**

- `CLAUDE.md` forbids committing without your explicit permission. **You gave it on 2026-10-03: commits are allowed on the new branches only.**
  That means the `mobile/*` and `spike/*` branches created from `dev` for this work. Never on `master` or `dev`. Never push.
- **One commit per card**, made by the worker when its acceptance passes, with files staged by explicit path.
- Before committing, the worker checks `git branch --show-current`. If it is not a `mobile/*` or `spike/*` branch, it stops and reports.
- Message format: Conventional Commits. Use `internal(refactor): …` for moves and plumbing, `internal(mobile): …` for spikes.
- **Never add a `Co-Authored-By` line or any AI attribution.** The root `CLAUDE.md` forbids it, and that rule overrides the harness default.
- Never push.

**How the orchestrator runs: a Sonnet subagent started from this session (your preference).**

Verified in this environment on 2026-10-03: a Sonnet subagent **can** spawn its own subagents and choose their model (it spawned a Haiku child successfully).
It has **no** tool to ask you a question, so everything that needs you goes through this session.

- **You stay in this one conversation.** You tell me "run the next stretch"; I spawn the Sonnet orchestrator in the background; it spawns the Sonnet and Haiku workers.
- **Work is cut into stretches that need nothing from you.** A stretch ends where your input is needed. For Phases 0–1:

  | Stretch | Cards                                                       | Ends because                                                          |
  | ------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
  | A       | 0.0, 0.T, then the spike code (0.1–0.5) and the debug build | Your phone is needed                                                  |
  | B       | The device session                                          | Before it starts, I tell you what to plug in and when to type the key |
  | C       | 0.6: the results draft                                      | Opus decides go/no-go                                                 |
  | D       | 1.0 → 1.6, 1.8, 1.9, with the browser checks                | Phase done, or a card escalated                                       |

- **What it costs in Opus:** one short turn per stretch boundary, to read the orchestrator's report and relay it to you. That is about 4–6 turns
  for Phases 0–1, plus one per escalation. To keep those turns small:
  - the orchestrator's report is limited to 150 words plus the status table;
  - I relay it and do not re-check its work, except for the three high-risk cards.
- **Your commit permission:** given (new branches only). I pass it on in the orchestrator's prompt.
- **Permission prompts:** a background subagent may not be able to wait for you to click "allow". The command permission list above must be in place first.
- **Zero-Opus alternative, if you prefer it later:** open a new conversation, set it to Sonnet with `/model`, and paste the same prompt. That session then talks to you directly and this one is not involved.

**The orchestrator's prompt** (used for the subagent, or pasted into a Sonnet conversation):

```
You are the orchestrator for the MyAstroSky mobile work. Stretch: <A|B|C|D>, cards: <list>.
Read .claude/work-packages/README.md and follow its protocol exactly. Run only the cards listed above, in order.

Rules:
- Do not implement cards yourself. Spawn one subagent per card, with the model named on the card (sonnet or haiku).
- The user has given permission to create mobile/* and spike/* branches from dev and to commit work-package results
  on them. Never commit on master or dev. Never push. Never add Co-Authored-By or any AI attribution.
- Never install, create or launch an Android emulator, AVD or system image. Never run sdkmanager or avdmanager.
- Never use git stash, git clean, git reset --hard or git add -A. Do not touch untracked files.
- You cannot ask the user anything. STOP and return a report when: a device is needed and none is connected;
  a card escalates; npm run verify fails twice; ports 5173 or 3001 are busy; a mobile UI card has no approved
  design; or anything is not covered by a card.
- Final report, 150 words at most: cards done, cards not done and why, what you need from the user, then the status table.
```

**Orchestrator protocol.** It lives in `.claude/work-packages/README.md` with the status table. That folder is not published by docsify.

1. **Start of a phase.**
   - Check that `git status` shows no modified or staged tracked files. If it does, stop and ask you; never stash.
   - Create the branch: `git switch -c mobile/phase-N dev`.
   - Run `npm run verify` once as a baseline. If it already fails (for example on your untracked files), report it and ask before starting.
2. **Pick** the next card whose dependencies are committed. One code card at a time; see the parallelism rule above.
3. **Check gates:** the design gate for UI cards (§5), and device availability for device cards.
4. **Spawn** the worker with `Agent(model per card, prompt = full card text + the Commits block + "Follow the card exactly. Stop and report on any Escalate-if condition.")`. No worktree isolation.
5. **On return:** check that the card made exactly one commit, that `git status` shows no leftover tracked changes, then run `npm run verify`.
6. **Browser acceptance is run by the orchestrator, one card at a time:**
   - first check that ports 5173 and 3001 are free (`Get-NetTCPConnection`);
   - if they are busy, **ask you** — never kill a process you didn't start;
   - stop the dev server you started by killing its full process tree, as the root `CLAUDE.md` describes.
7. **A failure** goes back to the same worker (SendMessage) with the output, at most twice. After that, escalate.
8. **Abandoning a card.** Every worker report lists the files it changed and the files it created.
   - To discard an unfinished card, restore the changed files by path (`git restore --staged --worktree <paths>`) and delete only the created files named in the report.
   - To undo a committed card, use `git revert`, which keeps the history.
   - Never use `git reset --hard`, `git clean` or `git stash`.
9. **`package-lock.json`:** only change it through `npm install`. Escalate if its diff contains lines unrelated to the card.
10. **Status table:** update it and commit it on the phase branch after every state change. States: `todo`, `running`, `done`, `failed`, `escalated`, `blocked on you (device)`, `blocked on you (design)`, `blocked on you (as-built review)`.
11. **After a restart:** rebuild the state from `git log` on the phase branch and the status table.
12. **Phase end:** you open a pull request from `mobile/phase-N` into `dev`, which runs the CI.

**Card template.** Every card follows it, so a cheaper model has everything it needs:

```
# WP-<id> <title>
Model: haiku|sonnet · Depends on: … · Parallel-safe with: … · Needs device: yes|no
## Goal            1–2 sentences.
## Step 0          Check `git branch --show-current` is the phase branch named in the kick-off. If not, stop.
## Context         Only what is needed: files with line numbers, the interfaces to implement verbatim.
## Steps           Numbered, concrete. Exact names/paths/signatures.
## Must NOT        Explicit out-of-scope list. Always includes: start a dev server, kill any process,
##                 install SDK packages or emulators, push, add AI attribution, switch branch,
##                 `git add -A`, `git clean`, `git stash`, `git reset --hard`, touch untracked files.
## Acceptance      Commands the WORKER runs (no browser, no device) + checks the ORCHESTRATOR runs.
## Gotchas         Known traps found during investigation.
## Escalate if     Conditions where the worker STOPS and reports instead of improvising.
## Commits         The verbatim block above.
## Report          Files changed · acceptance output · deviations · open questions.
```

**Why only Phases 0–1 are fully carded below.** Phase 2+ cards depend on spike results and on the code that
Phase 1 produces. Cards written today would be stale and would mislead a cheap model. At the start of each phase, the
Planner writes that phase's cards from the index in §8.

---

## 7. Fully specified cards: Phase 0 and Phase 1

### Prerequisites

Checked on this machine on 2026-10-03:

- **Android SDK:** installed at `C:\Users\guill\AppData\Local\Android\Sdk`, with `adb` on PATH.
- **Java:** `JAVA_HOME` points to `C:\Program Files\Android\Android Studio\jbr`. Gradle uses `JAVA_HOME`.
- **`ANDROID_HOME`:** not set. Cards set it per command and write `sdk.dir` into the gitignored `android/local.properties`.
- **No emulator, ever.** See the device rule in §5.
- **Real device:** you plug in a phone with USB debugging enabled when the orchestrator asks. Each spike report records the device model, Android version and WebView version. If you have several phones, the mid-range one is the reference for performance.
- **Permissions:** the allow/deny list in §6, approved by you.

### WP0.0 — Set up the work-package folder (Haiku; first card on `mobile/phase-1`)

- **Goal:** commit the cards and the status table, and add the ignore rules, before anything else runs.
- **Context:** the files in `.claude/work-packages/` already exist as **untracked** files. They are written right after plan approval,
  by a Haiku subagent spawned from the planning session (see "Next steps"). The orchestrator needs them to exist before its first run.
- **Steps:**
  1. Check that `.claude/work-packages/README.md`, `phase-0/` and `phase-1/` exist. If they don't, stop and report.
  2. Add `spikes/**`, `**/android/**` and `**/ios/**` to the ESLint ignores (`eslint.config.js:17`) and to `.prettierignore`.
  3. Stage `.claude/work-packages/`, `eslint.config.js` and `.prettierignore` by path, and commit.
- **Acceptance:** `npm run lint` and `npm run format:check` pass.

### WP0.T — Make the hooks cheaper and consistent (Sonnet; on `mobile/phase-1`)

- **Goal:** cut the cost of the test hook, and remove a rule conflict.
- **Context:** the existing regex at `.claude/hooks/vitest-on-ts-edit.js:15-16` already matches `packages/core/src/x.ts`, because it only looks for a `src` or `server` path segment. The real problem is that line 21 runs the **full** suite.
- **Steps:**
  1. Replace `execSync('npm run test:dot')` with `execFileSync` running `npx vitest related <filePath> --run --reporter=dot --passWithNoTests`.
  2. Keep the exit code: a non-zero exit is a test failure.
  3. In `.claude/agents/ui-verify-reviewer.md`, replace the instruction to kill orphaned dev servers with: "never kill a process you did not start; if the ports are busy, report it".
  4. In `.claude/hooks/ui-verify-guard.js`, accept the agent type `mobile-ui-verify-reviewer` (`:129`) and any `mcp__playwright*__browser_take_screenshot` tool (`:173`). Update `tests/unit/ui-verify-guard.test.ts`.
- **Acceptance:**
  - Editing a leaf file such as `src/color-utils.ts` runs only its related tests (seen in the hook output).
  - `npm run verify` is green.
- **Gotcha:** files imported almost everywhere (`types.ts`, `api.ts`, `i18n`) still trigger most of the suite. That is expected.
- **Escalate if:** `vitest related` is unavailable in the installed vitest.

### WP0.1–0.5 — Spikes: one Sonnet worker, one branch, in sequence

All five spikes are written by **one** worker on the branch `spike/mobile`, continued with SendMessage. The worker writes code only.
The orchestrator creates that branch from `mobile/phase-1` after WP0.0 and WP0.T are committed, so it has the cards and the ignore rules.
When the device session is over, the orchestrator switches back to `mobile/phase-1`.
The **orchestrator** then runs one device session. The spike branch is throwaway: it is never merged. Only the results document is copied to the phase branch (WP0.6).

**Common rules for the spike worker**

- Create `spikes/mobile/`: a minimal Vite + Vue app with `@capacitor/core`, `@capacitor/cli` and `@capacitor/android`, at the latest stable major. It has its own `package.json`; it is not a workspace.
- Run `npx cap init` and `npx cap add android`.
- Write `sdk.dir=C:\\Users\\guill\\AppData\\Local\\Android\\Sdk` into `android/local.properties`.
- Write `android.builder.sdkDownload=false` into `android/gradle.properties`.
- Create 4 routes, `/perf`, `/http`, `/sqlite` and `/image`, each in its own file.
- Add `playwright-core` as a dev dependency. Measurement scripts live in `spikes/mobile/scripts/*.mjs`, connect with `chromium.connectOverCDP('http://localhost:9223')`, and write JSON into `spikes/mobile/results/`.
- Add `spikes/mobile/scripts/cdp-forward.ps1`. It finds the PID with `adb shell cat /proc/net/unix | Select-String webview_devtools_remote`, then runs `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>`.
- Run `./gradlew assembleDebug` once (set `$env:ANDROID_HOME` for that command). It needs no device. Report the size of `~/.gradle` before and after.
- **Must NOT:** modify anything in `src/` or `server/`; run `cap run`; install SDK packages; read the nova API key from `data.db`.
- **Escalate if:** Gradle names a missing SDK package; a Gradle or JDK error persists after 2 attempts.

**WP0.2 — Performance page**

- Run `npx vite build` at the repo root and copy `dist/` into the spike's `webDir`.
- **Add a `fetch` shim in the spike's `index.html`** that answers 404 for `/api/*` and `/uploads/*`. Without it, Capacitor's local server answers those paths with `index.html` and status 200; `getDsoOverrides` (`api.ts:796-800`) then fails to parse JSON and `main.ts:64-72` stops at the catalog error screen.
- Measurement script, over CDP:
  - the time from navigation to the first sky render;
  - `JSON.parse` time of `stars.14.json` alone;
  - JS heap (`Performance.getMetrics`) after load;
  - fps during a scripted 5 s drag and a wheel zoom (`Input.dispatchMouseEvent`).
- **Photo layer test (new):** on `/perf`, draw 20 bitmaps of 2048 px on a canvas with `setTransform` + `drawImage`, and measure fps during a scripted pan and pinch (`Input.dispatchTouchEvent`). Use the images listed by the WP0.5 header-inspection step.

**WP0.3 — Native HTTP page**

- A text field for the nova API key. **You type the key on the phone during the device session.** The key is never read from `data.db`, never logged, never written to a results file.
- Log in to nova following `server/astrometry.ts:43`.
- Upload a small JPEG two ways, keeping `publicly_visible: 'n'` (`astrometry.ts:103`):
  - (a) `CapacitorHttp`-patched `fetch` with `FormData` + `Blob`;
  - (b) a raw `Uint8Array` multipart body built as in `astrometry.ts:133-170`, with `Buffer` replaced by `Uint8Array`/`TextEncoder`.
- Poll the submission until a job id appears.
- Run the TNS cone search with the User-Agent used in `server/tns.ts`.
- Fetch MPC `CometEls.txt` with plain `fetch`.
- Call Overpass as `server/overpass.ts:73` does, with plain `fetch`, then with CapacitorHttp.
- **Escalate if:** both upload variants fail. A native plugin is then needed; that is the Planner's decision.

**WP0.4 — SQLite page**

- Install `@capacitor-community/sqlite`.
- Copy, for this throwaway spike only, the SQL in this order: `server/db.ts:49-79`, then the statements of `server/db-migrations.ts` v1–14, then `server/db.ts:83-163`. (`applyMigrations` is called at `db.ts:80`, between the two schema halves.)
- Run `PRAGMA foreign_keys=ON`. Verify that deleting a photo cascades to `star_correspondences`.
- Insert 500 photos × 15 correspondences, timing individual `run` calls against one `executeSet`.
- Verify that `null` binds correctly.

**WP0.5 — Image page**

- **Header inspection first (Node, no device):** a script reads every file in `C:\Workspace\MyAstroSky\MyAstroSky\test-photos\` and writes a table: path, format, pixel dimensions, megapixels, bit depth, and whether a WCS is present (using `server/wcs-reader.ts`). The folder is gitignored; it is read, never modified.
- From that table, pick: the JPEG with the most megapixels, one mid-size JPEG, and the FITS with the highest bit depth. Record the choice.
- On the phone: pick the files with `@capawesome/capacitor-file-picker`, decode the JPEGs with `createImageBitmap(file, {resizeWidth: 2048})`, decode the FITS with `server/raw-decode/fits-decoder.ts` (throwaway: the `buffer` npm polyfill is allowed), and measure time and heap peak.
- `adb push` paths contain spaces and parentheses: quote them. Delete the pushed files from the phone at the end.
- There are **no XISF files** in `test-photos/`.

**Device session (orchestrator; you plug the phone in once)**

1. `adb devices` → one device in the `device` state. Record the model, Android version and WebView version (`adb shell getprop`, `dumpsys package com.google.android.webview`).
2. On the `spike/mobile` branch, in `spikes/mobile/`: `npx cap run android --target <serial>` with a timeout.
3. Run `cdp-forward.ps1`, then each measurement script. For WP0.3, ask you to type the API key on the phone.
4. Take one screenshot per page (`adb exec-out screencap -p`).
5. If you can plug in a second, slower phone, repeat steps 1–4.

**WP0.6 — Results and go/no-go**

- A Sonnet subagent drafts `docs/dev/mobile/spike-results.md` from the JSON results: one table per spike, per device.
- The Planner (Opus) reads only that draft and writes the decisions: catalog format, HTTP approach, image size limits, photo-layer feasibility, adapter rules. It adjusts the Phase 1–4 cards if needed.
- The docs row for the new file is added to `docs/CLAUDE.md` and `.github/copilot-instructions.md`.

### WP1.0 — Workspace skeleton + first two modules (Sonnet, high care)

- **Goal:** prove that the workspace package works in every toolchain on two trivial modules.
- **Steps:**
  1. In the root `package.json`, add `"workspaces": ["packages/*"]`. **Do not add a dependency entry**: npm links workspaces into `node_modules` by itself.
  2. Create `packages/core/package.json`: name `@myastrosky/core`, private, `"type":"module"`, `"exports": {"./*": "./src/*.ts"}`, no dependencies.
  3. Create `packages/core/tsconfig.json`: `target` ES2022, `module` ESNext, `moduleResolution` bundler, **`lib: ["ES2022"]`, `types: []`**, strict, `verbatimModuleSyntax`, `erasableSyntaxOnly`, noEmit, include `src`.
  4. Create `packages/core/src/env.d.ts` declaring **only**: `console` (log, warn, error), `TextEncoder`, `TextDecoder`, `setTimeout`, `clearTimeout`. Do not add the `DOM` or `WebWorker` libs.
  5. Move the first module and leave a shim:
     - `git mv src/astro-time.ts packages/core/src/astro-time.ts`
     - new `src/astro-time.ts` containing `export * from '@myastrosky/core/astro-time';`
  6. `git mv server/exif-utils.ts packages/core/src/exif-utils.ts`, with a shim at `server/exif-utils.ts`. This proves the server and Electron paths.
  7. Run `npm install`. Check that `node_modules/@myastrosky/core` is a link and that the `package-lock.json` diff contains only the workspace entry.
  8. Add the script `"typecheck:core": "tsc --noEmit -p packages/core/tsconfig.json"` and append it to `typecheck`.
  9. In `.github/workflows/ci.yml`, add a `typecheck:core` step after the two existing typecheck steps (`:24`, `:27`).
  10. In `.github/workflows/test.yml`, add `dev` to both branch lists, so pull requests to `dev` run the tests.
  11. In `.github/workflows/docker.yml`, add `packages/**` to the path filter.
  12. In `vitest.config.ts`, add `packages/**/*.ts` to `coverage.include`.
  13. In `eslint.config.js`:
      - add `packages/**/*.ts` to the TS file glob at line 62;
      - add `./packages/core/tsconfig.json` to the type-aware `project` list at line 69 (without it, core files produce parser errors, which fail CI);
      - add a block for `packages/core/**` with `no-restricted-imports` at **error**, banning `vue`, `pinia`, `@capacitor/*`, `node:*`, `fs`, `path`, `url`, `crypto`, `**/src/**` and `**/server/**`;
      - give `packages/core/**` neither the browser globals block (line 106) nor the Node globals block (line 110).
  14. In the `Dockerfile`, add `COPY packages/ packages/` **before** `npm ci` in both stages.
  15. Create `packages/core/CLAUDE.md`. Rules: no DOM, Node or Vite globals; tests for core modules stay in `tests/unit/` and import through the shims. Add a row for it to the root `CLAUDE.md` table.
  16. Update `docs/dev/ci.md` for the three workflow changes.
- **Acceptance (worker):**
  - `npm run verify` is green.
  - `npm run typecheck:core` is green.
  - `npm run electron:package` succeeds, and `.vite/build/main.js` contains `rawToBrowserCoords`.
  - The packaged app folder contains no dangling `@myastrosky` link (list `out/**/node_modules/@myastrosky`).
  - Then `npm run clean`.
- **Acceptance (orchestrator):** `npm run dev`; a Playwright screenshot shows the sky map with no console errors.
- **Pending CI:** the Docker change is verified by `docker.yml` on the pull request to `master`.
- **Gotchas:**
  - `export *` does not re-export `default`. If a module has `export default`, also add `export { default } from …`.
  - `electron:package` runs `npm run clean` first, which deletes `dist`, `.vite` and `out`. Check that no dev server is running before starting it.
- **Escalate if:**
  - tsx or Vite cannot resolve `@myastrosky/core/*` `.ts` exports;
  - the lockfile diff contains unrelated lines (for example dropped Linux optional dependencies);
  - the packager fails on, or copies, the workspace link;
  - any test needs changes beyond import paths.

### WP1.1 — Move `types.ts` (Haiku; depends on 1.0)

- **Steps:**
  1. `git mv src/types.ts packages/core/src/types.ts` and add a shim with `export *` (`types.ts` has no imports and no DOM types; already verified).
  2. Run `npm run verify`.
- **Escalate if:** any type error appears.

### WP1.2 — Move pure leaf modules, first pass (Haiku; depends on 1.1; parallel-safe with 1.9 only)

- **Goal:** move every pure module into core, in dependency order, each leaving a one-line shim.
- **Candidate order:**
  - `sky-geometry`, `comet-ephemeris`, `horizon-io`, `gear-presets`, `target-recommender`, `imaging-recipe`
  - `projection`, `sky-axes`, `sky-view-math`, `mosaic`, `sky-map-types`, `frame-orientation`, `frame-geometry`
  - `fov-frame-geometry`, `fov-frame-target`, `frame-interaction`
  - `sky-themes`, `star-render-math`, `star-budget`, `render-budget`, `spatial-index`
  - `region-geometry`, `photo-outline`, `color-utils`, `datetime-local`
  - `dso-selection`, `dso-render-math`, `dso-label`, `dso-label-placement`, `dso-highlight`, `hover-hit-test`, `hover-resolve`
  - `photo-search`, `photo-draw-order`, `version-check`, `capture-fields`, `photo-formats`, `delete-utils`, `canvas-theme`
  - `batch-types`, `batch-utils`, `batch-place`, `batch-photo-edit`
- **Do not attempt** (known blocked): `density-slider` (uses `navigator` at `:82`) and `interaction-lod` (imports it).
- **Rule for each file, in order:**
  1. Read its imports, including `import type`. If any import is **not** already in `packages/core/src/`, **skip the file**, add it to the report's "blocked by import" list with the import name, and continue.
  2. `git mv` it and write the shim.
  3. Run `npm run typecheck:core`. If that fails, **revert this file**, add it to the report's "not pure" list with the error, and continue.
  4. Move its entry in `vitest.config.ts` `coverage.exclude`, if it has one.
  5. Run `npx vitest run --reporter=dot` every ~5 files.
- **Gotcha (important):**
  - Before moving module X, run `grep -rn "vi.mock(.*/X'" tests/`.
  - Core files import their siblings **relatively**, so a test that mocks `../../src/X` no longer intercepts imports made from inside core.
  - If such a mock exists and X is imported by another moved module, change the mock path to `@myastrosky/core/X` and note it in the report.
- **Must NOT:** edit logic, rename exports, rewrite an import to make a file movable, or move anything that imports `i18n`, `api`, `dso-catalog` or `star-catalog`.
- **Acceptance (worker):** `npm run verify` is green. The report lists moved files, "blocked by import" files, "not pure" files and changed mocks.
- **Acceptance (orchestrator):** the sky map renders in `npm run dev` with no console errors.

### WP1.3 — Shared domain types + dedupe (Sonnet; depends on 1.2; not parallel with 1.2 or 1.7)

- **Why sequential:** this card edits files that 1.2 moves (`comet-ephemeris`, `horizon-io`) and a file that 1.7 splits (`server/wcs-reader.ts`).
- **Steps:**
  1. Move these interfaces from `src/api.ts` into `packages/core/src/domain/{plans,gear,settings,backup,solve,stars}.ts`: `LatestRelease`, `StarSearchResult`, `ConvertRawPhotoResult`, `AstrometrySubmission`, `Export*`, `Import*`, `ServerSettings`, `SolverAvailability`, `GearSetupData`, `SkyRegionData`, `ObservationWindow`, `PlanEntry`, `PlanMosaic`, `MosaicTileInput`, `MosaicParams`, `PlanSortKey`, `Plan`. Their lines in `api.ts` are 34, 86, 278, 554, 592–734, 745, 886, 1010, 1074–1160.
  2. `StarMultiplicity` exists in both `api.ts:81` and core `types.ts`. Keep the `types.ts` one and re-export it from `api.ts`.
  3. Make `api.ts` re-export all of them with `export type {…} from '@myastrosky/core/domain/…'`, so importers stay unchanged.
  4. Annotate the return types of the server mappers with these types: `planEntryToApi` (`index.ts:2232`), `planMosaicToApi` (`2254`), `poiCategoryToApi` (`1775`), `skyRegionToApi` (`1988`), `rowToPhoto` (`db.ts:322`).
  5. Unify `CometElements` (`server/comets.ts:19` / core `comet-ephemeris`) and `HorizonSummit` (`server/horizon.ts:23` / core `horizon-io`) on the core definition.
  6. Dedupe `normalizeRA` (`server/star-search.ts:87`, `server/wcs-reader.ts:155`, `src/star-catalog.ts:22`) into `packages/core/src/angles.ts`.
  7. Dedupe the angular distance helpers (`dso-catalog.ts:136`, `light-solve.ts:130`, `ui.ts:59`, and `angularDistDeg` at `fov-overlay.ts:64`) into the existing `angularSeparationDeg` (`sky-geometry.ts:54`).
  8. Steps 6 and 7 apply **only where the implementations are semantically identical**: same units, same range, same formula.
  9. In `plan-sort.ts` and `observation-windows.ts`, repoint the **type-only** imports from `./api` to the core domain files. Nothing else in those files changes.
- **Escalate if:**
  - a mapper's actual output doesn't match the client type, beyond optional fields;
  - the dedupe candidates differ in semantics. List the differences; don't pick one.

### WP1.7a — Inject the catalog into `wcsToCorrespondences` (Sonnet; depends on 1.3)

- **Goal:** remove the hidden `fs` dependency before the move.
- **Steps:**
  1. In `server/wcs-reader.ts`, add a pure function `wcsToCorrespondencesWithCatalog(wcs, catalog, …)` holding today's body, with the catalog as a parameter.
  2. Keep `wcsToCorrespondences(…)` with its **exact current signature** as a thin wrapper that calls `loadServerCatalog()` and then the new function.
  3. Replace the `console.log` at `:474-476` with nothing, or with the injected logger if one exists; do not add new output.
- **Acceptance:** `npm run verify` green, with **no test file changed** (3 tests mock `../../server/wcs-reader`).
- **Escalate if:** any test has to change.

### WP1.7 — Server decoders to `Uint8Array` (Sonnet; depends on 1.7a)

- **Steps:**
  1. Move the pure parts of `server/wcs-reader.ts` to `packages/core/src/wcs.ts`: `parseFITSHeader` (225), `extractFITSHeaderFromFITS` (348), `extractFITSHeaderFromTIFF` (281), `extractWCS` (710), `wcsToCorrespondencesWithCatalog`, `CAPTURE_FITS_MAP` (62).
  2. `server/wcs-reader.ts` keeps `loadServerCatalog` (161) and the `wcsToCorrespondences` wrapper, and re-exports the rest.
  3. Move `server/raw-decode/{fits-decoder,tiff-ifd,tiff-decoder,linear-map,codec/*}` to `packages/core/src/raw-decode/`. **Leave a shim at every old path**: 7 test imports target them. `server/raw-decode/index.ts` (sharp) stays.
  4. Replace `Buffer` with `Uint8Array` + `DataView`:
     - build the `DataView` with the array's `byteOffset` and `byteLength`;
     - use `subarray`, never `slice`;
     - `getUint16(o, true)` for little-endian; FITS data is big-endian, so pass `false`.
  5. Replace `toString('ascii', a, b)` with `new TextDecoder('latin1').decode(sub)`.
  6. Replace `zlib.inflateSync` (`tiff-decoder.ts:40`) with `fflate.unzlibSync`. Add `fflate` as a dependency of `packages/core`.
  7. Server files were never compiled under `erasableSyntaxOnly`. Rewrite parameter properties as plain fields (a mechanical change, authorised here).
- **Gotchas:**
  - `Buffer` is a `Uint8Array` subclass, so existing tests passing Buffers must still pass **unchanged**.
  - Apply the `vi.mock` gotcha from WP1.2.
- **Acceptance (worker):** `npm run verify` is green.
- **Acceptance (orchestrator):** the `test-placement` skill: upload a FITS/TIFF with WCS in the dev app and check its placement.
- **Escalate if:** a test has to change beyond a mock path.

### WP1.4 — i18n platform injection (Sonnet; depends on 1.7)

- **Steps:**
  1. `git mv src/i18n/{index,fr,en,es,de}.ts` into `packages/core/src/i18n/`.
  2. Leave shims at the old paths. The dictionaries use **default exports** (`import fr from './fr'`), so each shim is `export { default } from '@myastrosky/core/i18n/fr';`. The index shim is `export * from '@myastrosky/core/i18n/index';`.
  3. In the core `index.ts`:
     - Add `export interface I18nPlatform { storedLang(): string|null; storeLang(l: Lang): void; preferredLanguages(): readonly string[]; reload(): void; onMissingKey?(k: string): void }`.
     - Add `configureI18n(p)`, which sets the platform and resets `currentLang`.
     - The default platform returns `null` and `[]`, and its reload is a no-op.
     - Replace `localStorage`, `navigator`, `location` and `import.meta.env.DEV` at lines 14, 18, 38, 39, 60 with platform calls.
  4. Create `src/platform-init.ts`. It configures the browser platform; `onMissingKey` calls `console.warn` only when `import.meta.env.DEV` is set.
  5. Make it the **first import** in `src/main.ts`.
  6. Add `test.setupFiles: ['tests/setup/platform.ts']` (which imports `src/platform-init`) to `vitest.config.ts`.
  7. Move `affine.ts` (it only uses `t`) with a shim.
- **Gotcha (important):** 21 tests use `vi.mock('../../src/i18n')`. After this card, core modules import `./i18n` relatively and bypass that mock. For each of those tests, check whether the module under test is now in core; if so, change the mock path to `@myastrosky/core/i18n/index`. List every changed test in the report.
- **Acceptance (worker):** `npm run verify` is green, including the i18n parity test.
- **Acceptance (orchestrator):** in the dev app, switching the language to EN reloads in English.

### WP1.5 — DSO catalog registry (Sonnet; depends on 1.4)

- **Steps:**
  1. Create `packages/core/src/catalog/dso-registry.ts`. Move into it, from `src/dso-catalog.ts`:
     - the columnar JSON → `DSO[]` build and the override overlay;
     - `displayName` resolution, taking `lang` as a parameter;
     - `dsoImportance`, `DSO_CATALOGS_ALL`;
     - the module Maps (`:9`, `:33-34`) and every lookup (`getDSOs`, `getDSOById`, `getDSOImportanceRank`, …);
     - a setter `setDsoCatalog(json, overrides, lang)`.
  2. `src/dso-catalog.ts` keeps only the loader: `fetch('/data/dso.json')` (`:146`), `getDsoOverrides()` (`:116`), then `setDsoCatalog(...)`. It re-exports everything else from the registry.
- **Must NOT:** change the density-gate behaviour (see `src/CLAUDE.md`).
- **Acceptance (worker):** `npm run verify` is green.
- **Acceptance (orchestrator):** the sky map plus a DSO search work in the dev app.

### WP1.5b — Star catalog registry (Sonnet; depends on 1.5)

- Same pattern for `src/star-catalog.ts` (265 lines): the singletons at `:10-20` and all lookups move to `packages/core/src/catalog/star-registry.ts`; the fetches at `:42-72` and `:131` stay in `src/star-catalog.ts`, which calls a setter.
- `normalizeRA` already comes from `core/angles.ts` (WP1.3).

### WP1.6 — Second pass of leaf moves (Haiku; depends on 1.5b)

- Run the WP1.2 rule on the files that are now unblocked:
  - `dso-render-select`, `sky-hit-test`, `multiple-stars`, `batch-wcs`
  - `poi`, `format-utils`, `sky-trajectory`
  - `asteroid-identify`, `comet-identify`, `supernova-identify`
  - `plan-sort`
- **Expected to stay blocked — report, don't fix:**
  - `observation-windows` (imports `filterCssKey` from the DOM module `chip-utils`);
  - `photo-placement` (imports `error-reporter`, which uses `window`);
  - `setup-info` (imports `gear-catalog`, which fetches);
  - `frame-controller` (imports `TILE_TRASH_R` from `sky-draw` and uses `requestAnimationFrame`).
- The Planner turns that report into small Sonnet cards (inject a logger, move a constant) at the start of Phase 3.

### WP1.8 — XISF + `.wcs` sidecar decoding (Sonnet; depends on 1.7)

- **XISF:** in `packages/core/src/raw-decode/xisf.ts`:
  - parse the `XISF0100` signature, the 4-byte little-endian header length and the XML header;
  - read `FITSKeyword` elements into the existing FITS header shape;
  - read the `Image` geometry, `sampleFormat` and an `attachment:` location.
- **Sidecar:** `.wcs` sidecars (ASTAP `.wcs`, astrometry.net `wcs.fits`) are FITS headers. Add `parseWcsSidecar(bytes)` that reuses `parseFITSHeader`.
- **Tests:** synthetic fixtures only, built like the existing FITS builders in `tests/fixtures/`. There are no real XISF files in `test-photos/`.
- **Known limit, written in the module header:** XISF files whose astrometric solution is stored only as XISF Properties (`PCL:AstrometricSolution:*`), not as FITS keywords, are not handled. That needs a real sample from you.
- **Must NOT:** add upload UI. That is a separate desktop card in Phase 6/W4.

### WP1.9 — Docs (Haiku; after 1.0; parallel-safe with any code card)

- Create `docs/dev/mobile-architecture.md` from §3–4 of this plan.
- Add rows to the tables in `docs/CLAUDE.md` and `.github/copilot-instructions.md`.
- Fix the two doc drifts from §1.
- **Must NOT** touch `.claude/work-packages/README.md`: the orchestrator owns it.

**Flow of Phases 0 and 1**

1. On `mobile/phase-1` (created from `dev`): 0.0 → 0.T.
2. On `spike/mobile` (created from `mobile/phase-1`): spikes 0.1–0.5, the device session, then 0.6.
3. Back on `mobile/phase-1`: 1.0 → 1.1 → 1.2 → 1.3 → 1.7a → 1.7 → 1.4 → 1.5 → 1.5b → 1.6, with 1.8 after 1.7 and 1.9 alongside.

Then a Sonnet `/code-review` on the phase diff, and you merge `mobile/phase-1` into `dev` through a pull request.

---

## 8. Later phases: card index

The Planner writes these cards in full at the start of each phase.

**Phase 2 — Services and ports on the server.** This also fixes the router monolith (ARCHITECTURE_REVIEW §3.3).

- 2.0a–h (Sonnet, sequential): split `server/index.ts` into `express.Router` files, one domain at a time, with no logic change. This enables the parallel work below.
- 2.1 (Sonnet): turn `db.ts` into an `openDatabase(path)` factory with no side effects on import.
- 2.2 (Sonnet, then an Opus review): the `SqlDb` port, the better-sqlite3 adapter (mutex, BEGIN IMMEDIATE, batch), an async migration runner from a v0 baseline, and the interleaving test from §3.
- 2.3a–j (Sonnet, one at a time; two together only when their files are fully disjoint): one card per service in the §3 table — plans; gear and setups; POI, regions and overrides; settings; photos; solved-file import; star search; identification; horizon; backup; nova solve; version.
- 2.4 (Sonnet): the contract-test harness.

**Phase 3 — Front-end seam.**

- 3.0: the small unblocking cards from the WP1.6 report (`photo-placement`, `frame-controller`, `observation-windows`, `setup-info`, `density-slider`).
- 3.1 (Sonnet, then an Opus review): the `Backend` interface with `FileInput`, progress and cancel types; `api.ts` as a facade over `HttpBackend`; `photoUrl()`; an `export()` that returns bytes.
- 3.2: `LocalBackend`.
- 3.3: contract tests against both backends.
- 3.4: extract the logic from `targets-view.ts` and `fov-overlay.ts` into core.
- 3.5: create `packages/app-state` with the plans, settings and fov-frames stores, behind `Backend` and `PrefsStore`; update their tests to mock the backend.
- 3.6: add the `PrefsStore` state to the backup manifest (new manifest version, import accepts the old one).

**Phase 4 — Rendering and touch.**

- 4.1: theme injection, replacing `cssVar` — **before** the move.
- 4.2 (Haiku + rule): move the painters into `packages/render`.
- 4.3 (Sonnet + Opus review + desktop ui-verify): the gesture controller.
- 4.4: the canvas photo layer (ImageBitmap cache, level of detail, eviction), sized by the WP0.2 measurement.
- 4.5: the catalog format chosen by the spike.

**Phase 5 — Design (D0–D3).** Opus with you. It runs **in parallel with Phases 1–3**.

- 5.0 (Sonnet): the inputs for design — a token and component inventory, and the touch inventory from §4.
- D0–D3 as in §5, with the approval table and the exported PNGs and specs.

**Phase 6 — Mobile app.** Every UI card is gated on its approved screen, and each wave ends with an as-built review. A wave is delivered as the **debug APK built by CI**, which you install on your phone.

- 6.0 Shell (gated by D0 and D2): Capacitor, Ionic, adapters, `LocalBackend`, the red theme, i18n, GPS, the L1/L2/L3 tooling, `mobile.yml`, `apps/*` added to the workspaces (and to the Dockerfile's `COPY` of manifests).
- W1 Sky: map, search, time scrubber, object sheet.
- W2 Targets: targets and gear setups.
- W3 Plans: plans, framing editor, mosaics.
- W4 Library: library and import (solved files, nova, share intent, file picker, desktop sidecar upload) and the 4th metadata editor.
- W5 Identification and data: POI identification, horizon, ZIP export/import, PDF share.
- W6 LAN connect: CORS, token, QR pairing, capabilities, remote ASTAP.

**Phase 7 — Release.**

- Android signing (keystore stored as a CI secret), AAB builds, `versionCode` derived from semver.
- The Play internal test track. This needs a Google Play developer account, which you would have to create.
- The release workflow (tags) gains the signed Android build next to the existing desktop builds.

**Mobile CI — added in card 6.0, as soon as `apps/mobile` exists. No nightly job.**

A new workflow `mobile.yml` uses the **same triggers as `ci.yml`**: `push` and `pull_request` on `[master, dev]`. It compiles both apps on every dev push.

- **`android` job** (`ubuntu-latest`):
  1. Set up Node 24 and JDK 21.
  2. `npm ci`
  3. Build the mobile web bundle.
  4. `npx cap sync android`
  5. `cd apps/mobile/android`, then **`./gradlew build`**
  6. Upload the debug APK as a workflow artifact, so you can install a CI build on your phone.
- **`ios` job** (`macos-14`):
  1. `npm ci`
  2. Build the mobile web bundle.
  3. `npx cap sync ios`
  4. `xcodebuild … -sdk iphonesimulator build CODE_SIGNING_ALLOWED=NO`

  This compiles the iOS app with no Apple account and no signing.

- **Notes for the card:**
  - The `ios/` folder is generated with `npx cap add ios`. If that fails on Windows, escalate; the fallback is a one-off macOS runner job that generates it.
  - macOS runner minutes are billed at a higher rate on private repositories.

---

## 9. How future work is done once both shells exist

- **Every feature starts with "which layer?"**
  - Logic goes in core, tested in a Node environment.
  - Persistence goes in a service plus a shared migration.
  - The UI goes into both shells, or is explicitly marked as desktop-only or mobile-only.
- **Capabilities, not `isMobile` branches.** Use `backend.capabilities` (`localSolvers`, `onlineSolve`, `lanServer`, …).
- **Contract tests** run against both backends. The export ZIP format is versioned and tested in both directions, since it is the bridge between devices.
- **`docs/dev/feature-parity.md`**, plus a PR-template line: "Mobile impact: none / done / tracked".
- **Skills and docs:**
  - Split `frontend-feature` into `desktop-ui` and `mobile-ui`.
  - Add `core-logic`.
  - Rename `fullstack-feature` to `service-feature`.
  - Add a mobile step to `add-photo-metadata`.
  - Add a mobile tier to `ui-verify`.
  - Add `packages/core/CLAUDE.md` and `apps/mobile/CLAUDE.md`.
  - Every new doc file gets its rows in `docs/CLAUDE.md` and `.github/copilot-instructions.md`; `docs/dev/ui/mobile.md` is also linked from `ui-guidelines.md` and the sidebar.
- **New mobile screens follow the same path:** a design card (artboard, your approval), then an implementation card. Never the other way round.
- **CI:**
  - `ci.yml` runs `typecheck:core`, and `test.yml` runs on `dev` too (both from WP1.0).
  - `mobile.yml` compiles Android and iOS on every push and PR to `master` and `dev`.
  - Mobile typecheck, tests and L3 screenshots join the existing gates.
- **Releases:** one version and one changelog, with scopes `feat(mobile):`, `feat(desktop):` and `feat(core):`.

## 10. Risks

| Risk                                               | Mitigation                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Sky-map performance and memory on mid-range phones | Spike WP0.2 on your real devices, then a binary/tiered catalog, a DPR cap                                    |
| The canvas photo layer is too slow                 | Measured in WP0.2 (20 bitmaps under pan and pinch) before any commitment; fallback is DOM images as today    |
| Decoding large images runs out of memory           | Spike WP0.5 and a resize on decode                                                                           |
| Binary multipart over CapacitorHttp                | Spike WP0.3; fallback to a native plugin                                                                     |
| Refactoring `db.ts` to async breaks the desktop    | Strangler order, the transaction rule and its test, contract tests, `verify` green at every card             |
| Cheaper models improvise                           | Card template with Must NOT / Escalate if, orchestrator re-runs acceptance, Opus reviews the high-risk cards |
| An unattended run stalls on a permission prompt    | The allow/deny list in §6, approved by you before the first run                                              |
| Design drift from approval                         | File-based approval table, exported PNG and spec per screen, as-built review, L3 baselines                   |
| iOS without a Mac                                  | The iOS app is compiled by `mobile.yml` on every dev push; runtime WebKit issues are found later             |
| Disk fills up                                      | No worktrees, a measured ≥6 GB check before Android or Electron builds, no local Docker build                |
| A worker touches your untracked files or branches  | Path-scoped `git add`, deny rules for `git clean`/`stash`/`add -A`, branch check before every commit         |
| A worker installs an emulator or SDK packages      | Deny rules, `android.builder.sdkDownload=false`, the device rule in every device card                        |
| A worker kills your dev server or uses your DB     | Workers never start servers; the orchestrator checks the ports and asks you if they are busy                 |

## 11. Verification

- **Every card:** its worker acceptance, then the orchestrator's `npm run verify` on the phase branch.
- **Every phase:**
  - a Sonnet `/code-review` on the phase diff, plus the Opus review of the high-risk cards;
  - the Docker smoke test, in CI (`docker.yml`, on the PR to `master`), not locally;
  - desktop placement checked with the `test-placement` skill.
- **Phase 2/3:**
  - contract tests on both backends;
  - export from the old build, import into the new one, and get an identical re-export.
- **Phase 4:** a desktop A/B benchmark (`profile-performance`) and a touchscreen check.
- **Phase 6:**
  - L1 and L3 runs in the phone-sized browser, and L2 runs on your real device in batched device sessions;
  - `mobile-ui-verify-reviewer` sign-off;
  - your as-built review, recorded in the approval table;
  - a night field test on a real phone.
- **LAN:**
  1. Pair the phone with the Electron app by QR code.
  2. Browse the library.
  3. Run an ASTAP solve on the desktop and see the photo placed on the phone.

## Critical files

- `src/api.ts`
- `src/i18n/index.ts`
- `src/types.ts`
- `src/projection.ts`
- `src/dso-catalog.ts`
- `src/star-catalog.ts`
- `src/gear-catalog.ts`
- `src/photo-placement.ts`
- `src/photo-overlay.ts`
- `src/sky-map-events.ts`
- `src/sky-map.ts`
- `src/targets-view.ts`
- `src/fov-overlay.ts`
- `src/stores/{plans,settings,fov-frames}.ts`
- `server/index.ts`
- `server/db.ts`
- `server/db-migrations.ts`
- `server/wcs-reader.ts`
- `server/raw-decode/*`
- `server/astrometry.ts`
- `package.json`
- `tsconfig*.json`
- `vitest.config.ts`
- `eslint.config.js`
- `Dockerfile`
- `forge.config.ts`
- `.github/workflows/{ci,test,docker}.yml`
- `.claude/settings.json`, `.claude/settings.local.json`
- `.claude/hooks/{vitest-on-ts-edit,ui-verify-guard}.js`
- `.claude/agents/ui-verify-reviewer.md`
- `.claude/skills/*`
- `CLAUDE.md`
- `docs/CLAUDE.md`

## Next steps on approval

1. **You:** nothing to install. Keep a phone with USB debugging ready for the first device session.
2. **This session:** save the "no emulator, real devices only, limited disk" and "Opus supervises only" rules to persistent memory.
3. **This session:** prepare the permission allow/deny list (§6) and show it to you before applying it.
4. **This session, through one Haiku subagent:** write `.claude/work-packages/README.md` (the protocol and an empty status table) and one file per Phase 0/1 card, copied from this plan. They are left as untracked files; nothing is committed and no branch is created.
5. **This session:** spawn the Sonnet orchestrator for stretch A (your commit permission on the new branches is already given). It runs in the background, and I relay its report when it stops.
6. **In parallel:** a Sonnet subagent gathers the design inputs (5.0), then design rounds D0–D3 with you on Opus.
