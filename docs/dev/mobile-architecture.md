# Mobile Architecture

How the desktop app and the phone app share their code, and how the phone app runs without a server.

## Layout

```
src/, server/, electron/   The desktop app, its Express server and the Electron shell.
packages/core/             Platform-neutral TypeScript: astronomy, projection, recommender, file decoders,
                           domain types, i18n, catalogue registries, the services, the ports, the database schema.
packages/app-state/        The data functions the screens call (api.ts), the backend holder, and the Pinia
                           stores that hold backend data (plans, POI categories, sky regions, settings) or drive
                           the sky map (display settings, sky time) through a map port (`core/src/map-ports.ts`).
packages/backend-http/     The backend that calls the Express server's routes.
packages/render/           The sky map's canvas drawing, hit testing and input handling.
packages/backend-local/    The backend that calls the services directly, and the phone's platform adapters.
apps/mobile/               The phone app: Capacitor + Ionic Vue.
```

Every package is consumed as TypeScript source (`"exports": { "./*": "./src/*.ts" }`), imported as `@myastrosky/<package>/<module>`.

### Dependency rules

Enforced by ESLint (`no-restricted-imports` at error) and, for core, by its `tsconfig` (`lib: ["ES2022"]`, `types: []`).

| Package         | May import                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `core`          | Nothing outside itself except `fflate`. No DOM, Node, Vue, Pinia or Capacitor.                   |
| `app-state`     | `core`, Vue, Pinia.                                                                              |
| `backend-http`  | `core`. Browser APIs are allowed.                                                                |
| `render`        | `core`. Browser APIs are allowed (the sky map's canvas drawing, hit testing and input handling). |
| `backend-local` | `core`, `fflate`. Browser APIs are allowed; plugin objects are passed in.                        |
| `apps/mobile`   | The packages, Ionic, Capacitor. Never the desktop's `src/` or `server/`.                         |
| `server`        | `core`.                                                                                          |
| `src`           | The packages. A lint rule forbids one-line re-export files of package modules.                   |

## How a screen reaches its data

A screen calls a function of `@myastrosky/app-state/api` (`getPlans()`, `uploadPhoto()`, `photoFileUrl()`…). Each function calls the one **backend** object (`getBackend()` in `packages/app-state/src/backend.ts`) and turns the `DomainError` it rejects with into the `Error` the screen shows: the translated message of the error's code (`serverErrors.<CODE>`), else the error's own message, else the function's fallback text. A screen never knows which backend is installed.

- **Desktop and web**: `src/platform-init.ts` installs the HTTP backend (`createHttpBackend`, `packages/backend-http/src/http-backend.ts`), which calls the Express routes.
- **Phone**: `apps/mobile/src/platform-init.ts` installs the local backend (`createPhoneBackend`, `packages/backend-local/src/phone-backend.ts`), which calls the services directly on the phone's own database and files. In a desktop browser the phone app uses the HTTP backend through a Vite proxy, so that screens can be developed without a device.

`getBackend()` throws when no backend was installed. Nothing in `src/` or `apps/mobile/src/` may `fetch` the server or build an `/uploads/` address itself; a lint rule fails on it.

### The `Backend` interface

`packages/core/src/backend.ts`. Its members are the services' own interfaces (`Pick<PlanService, …>`…), so the local backend hands out the services as they are. Only the members that take a file differ:

- `FileSource { name; size; read(); native? }` stands for a file; the HTTP backend sends `native` (a browser `File`) as it is, the local backend calls `read()`.
- `TransferOptions { onProgress?; cancel? }`; `CancelSignal` is satisfied by the browser's `AbortSignal`.
- `capabilities` says what a backend can do (`localSolvers`); screens test it, never the platform. `localSolvers` (ASTAP, solve-field and their probes) exists only on the HTTP backend.
- Every method rejects with a `DomainError` (`kind`: `invalid`, `notFound`, `conflict`, `rateLimited`, `upstream`; and a `code`).

`packages/core/src/testing/backend-contract.ts` is one suite of cases that both backends pass (`tests/unit/backend-http-contract.test.ts`, `tests/unit/backend-local-contract.test.ts` on a synchronous and on an asynchronous database).

### Adding a data function

1. The method on the service, in `packages/core/src/services/`.
2. The member in `Backend`.
3. The method in the HTTP backend, and the route in `server/routes/`.
4. A case in the contract suite.
5. The function in `packages/app-state/src/api.ts`, with its fallback error text.

## Services

`packages/core/src/services/`, wired by `createServices` (`create-services.ts`) for the server and for the phone alike. The server's routes only transport: they read the request, call one method and send the result (`sendError` in `server/routes/http-errors.ts` maps a `DomainError` to a status and adds its code).

| Service                                                        | Owns                                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `PlanService`                                                  | Night plans, their entries, mosaics and observation windows.                                       |
| `PhotoService`                                                 | Photos and star correspondences; the upload pipeline (probe, orientation, stored file, thumbnail). |
| `GearService`                                                  | The built-in and custom gear catalogue, gear setups.                                               |
| `SettingsService`                                              | Settings, including the astrometry.net key through the `SecretCodec` port.                         |
| `DsoOverrideService`, `PoiCategoryService`, `SkyRegionService` | Their rows and checks.                                                                             |
| `BackupService`                                                | Export, import preview and import, over the bundle ports.                                          |
| `StarSearchService`                                            | Star search by name, designation, number and position.                                             |
| `IdentifyService`                                              | Asteroid (SkyBoT), supernova (TNS) and comet (MPC) lookups, with their caches.                     |
| `HorizonService`                                               | The terrain horizon of a location, cached.                                                         |
| `SolvedImportService`                                          | Reading the solution of an already-solved FITS, TIFF or XISF file; converting it to a picture.     |
| `NovaSolveService`                                             | Online solving through astrometry.net.                                                             |
| `VersionService`                                               | The latest release, cached.                                                                        |

Rules for a service method:

- **Group the database calls.** On a phone each call crosses a bridge (about 19 ms on a mid-range device), so a method never awaits a call inside a loop: several reads are one query, several writes are one `batch`. Its test asserts the number of round trips with `tests/helpers/counting-sql-db.ts`.
- **Typed parameters, validated at run time.** Parameter types come from `packages/core/src/domain/`.
- **Every error has a code.** `DomainError.code` is an `ErrorCode` (`packages/core/src/domain/error-codes.ts`), and `tests/unit/error-codes.test.ts` requires a `serverErrors` message for every code in the four languages.
- **No clock, file system or network of its own.** Time, identifiers, HTTP, images and files arrive through dependencies.

## Ports and adapters

`packages/core/src/ports/`.

| Port                            | Server (`server/`)                                | Phone (`packages/backend-local/src/`)                                                     |
| ------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `SqlDb`                         | `sqlite-adapter.ts` over better-sqlite3           | `capacitor-sqlite-db.ts` over the SQLite plugin                                           |
| `BlobStore`                     | `blob-store.ts`, files of the uploads folder      | `capacitor-blob-store.ts` over the Filesystem plugin; also gives a file's address (`url`) |
| `ImageCodec`                    | `image-codec.ts` over sharp                       | `browser-image-codec.ts`: `createImageBitmap` and `OffscreenCanvas`                       |
| `HttpClient`                    | `http-client.ts` over Node's `fetch`              | `fetch-http-client.ts` over the WebView's `fetch`, which Capacitor routes natively        |
| `SecretCodec`                   | `secret-codec.ts`, AES-256-GCM, key from env      | `webcrypto-secret-codec.ts`, AES-GCM with a non-extractable key kept in IndexedDB         |
| `BundleWriter` / `BundleReader` | `bundle-zip.ts`, streaming ZIP                    | `bundle-fflate.ts`, ZIP in memory                                                         |
| `KeyValueStore`                 | (desktop: `localStorage`, `src/platform-init.ts`) | `preferences-store.ts` over the Preferences plugin, loaded in memory at start-up          |
| `EnvSource`                     | `process.env`                                     | always undefined                                                                          |

No adapter of `backend-local` imports a Capacitor package: each receives the plugin object it needs as a parameter. Each port with two adapters has a conformance suite in `packages/core/src/testing/` that both pass.

Where the phone's adapters differ from the server's on purpose:

- **A picture with no rotation is stored byte for byte.** `bakeOrientation` re-encodes only to apply a real EXIF rotation; the server always re-encodes.
- **`decode` always returns 4 channels**, since a canvas has no other form.
- **The astrometry.net key** is encrypted with a key the WebView creates as non-extractable. A backup never contains the key. Android's own backup and phone-to-phone transfer are off (`allowBackup="false"` and `res/xml/data_extraction_rules.xml`), since they would copy that key with the database; changing phones goes through the app's backup.
- **A backup archive is read by pieces** (`openZipRanges` over `FileSource.readRange`): its end and central directory, then one entry at a time, so its size has no limit. Only a file read whole (a `.json` backup) is refused above `maxWholeFileBytes` (`BACKUP_TOO_LARGE`), before it is read. Pictures are stored uncompressed in the archive.
- **A network timeout is a race with a timer**, because the natively routed `fetch` may ignore an abort.

### `SqlDb`

- `transaction(body)` may only await calls on its `tx`. A body that awaits anything else is rolled back; transactions do not nest; a call on the outer `SqlDb` from inside a body is rejected. A function that must work in both places takes a `SqlTx`.
- `batch` is one round trip. Keep binary values out of a batch on the phone: the plugin then falls back to one call per statement.
- The schema is defined once in `packages/core/src/db/schema.ts` (`BASELINE_SCHEMA` at `SCHEMA_VERSION`, `MIGRATIONS` for later versions, `initSchema`). A new migration is SQL added to `MIGRATIONS`, with `BASELINE_SCHEMA` and `SCHEMA_VERSION` updated in the same commit; `tests/unit/schema-baseline.test.ts` fails otherwise. The schema avoids `RETURNING`, `json_*` and `STRICT`; foreign keys are switched on explicitly. A migration that drops and recreates a table other tables point at sets `rebuildsTable`: foreign keys are switched off around it, and it is undone if it leaves rows pointing nowhere.

## Platform hooks in core

Core modules that need something of the platform ask a hook that each app configures at start-up (`packages/core/src/platform/`): device storage (`configureStorage`), the error reporter, the debug and info log sink (`configureLogSink`, installed in development builds only), device hints for the initial map density, the gear catalogue loader and the remote star search. The i18n module is configured the same way (`configureI18n`). The deep-sky and star catalogues live in registries (`packages/core/src/catalog/`): an app loads the files and calls the setter; every lookup reads the registry.

## The phone app

- `apps/mobile/`: Vite, Vue 3, Ionic Vue, Capacitor (Android). Five tabs on Ionic's tab bar; sub-pages are routes inside their tab.
- The Ciel tab draws the sky map (`packages/render`'s `SkyMap`) through `src/sky-map-setup.ts`. `SkyMapOptions` is how an app changes what the map reads from its page: `touch` (drag, pinch and turn about the fingers, tap and long press, in `sky-map-touch.ts`; region drawing and frame dragging take the finger first and switch the other gestures off while they run; a tap on an empty spot clears the selection; a tap finds the object under the finger itself, since a touch has no hover), `maxPixelRatio` (the phone caps the density at 2), `followCanvasSize` (redraw when the canvas box changes, e.g. on rotation), `isOverPanel` (the desktop's 280 px side-panel test, off on the phone) and `cssVar` (the canvas colours). The desktop passes none.
- The photos of the sky map are drawn by `PhotoLayer` (`packages/render/src/photo-layer.ts`): one `<img>` each in a box over the canvas, moved by a CSS matrix fitted to the photo's star correspondences or manual placement. The app gives it the address of the photo files and what to do with a photo that cannot be placed; the desktop's `PhotoOverlay` extends it, the phone's Ciel tab uses it as it is and reads the placed photos again each time the tab is shown.
- Start-up (`src/platform-init.ts`), awaited before the app is mounted: device storage, language, backend, hooks. The catalogues load after the first screen is shown.
- The look: the design system's stylesheet and tokens (`src/theme/design-system/`), mapped onto Ionic's variables (`src/theme/ionic-tokens.css`), with shared components over Ionic's own (`src/components/`). Fonts are bundled. The rules of the screens are in [ui/mobile.md](ui/mobile.md).
- The star, name, constellation and deep-sky files and the gear lists are copied into the app's build (`scripts/copy-bundled.mjs`).
- The desktop does not pick the phone app up: the Docker runtime stage installs only the root and `packages/*`, and the Electron package contains none of its dependencies.

## Constraints measured on a real phone

Figures from a mid-range Android phone (Galaxy A16). They explain several rules above.

- **A database call costs about 19 ms**, whatever it does. Forty single inserts take about 4 s; the same rows in one `batch` take under 0.1 s.
- **The SQLite plugin runs only the first statement of a one-line script**, so the adapter splits scripts itself; and its row counts include rows removed by foreign-key cascades, so the adapter reads `changes()` after a statement that modified rows.
- **The Filesystem plugin accepts text only.** A file is written in pieces encoded in base64 (about 160 ms per megabyte with 8 MB pieces) and read back through `fetch`, with no encoding. The WebView's native `Uint8Array.prototype.toBase64` is used when present.
- **`OffscreenCanvas.convertToBlob` waits about 4 s when no frame is being drawn.** The image codec keeps frames running while it encodes; the call then takes about 40 ms.
- **Decoding a 19-megapixel JPEG takes about 0.3 s**, at any target size.
- **astrometry.net accepts an upload sent as a form with a file part**, not a hand-built multipart body; and it needs a non-browser `User-Agent`. TNS is reachable only through the native HTTP layer.
- **The local server of the WebView answers the app's own page with status 200 for an unknown path**, so the existence of a file is checked with `stat`, never with the status of a request.
- **The page is 360 to 430 CSS pixels wide** depending on the phone, and the system bars' insets differ between gesture and three-button navigation and between the two landscape directions. The frame applies each inset once (`src/theme/ionic-tokens.css`); screens never read `env(safe-area-inset-*)`.
