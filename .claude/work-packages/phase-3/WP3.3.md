# WP3.3 — The backend interface, the HTTP backend, and the contract tests

Model: sonnet · Depends on: WP3.2 · Needs device: no · Needs browser: no · Reviewed by the planner before WP3.4 starts

## Goal

Define the one object the app's data functions will call (`Backend`), write the version that calls the server over HTTP, and write the suite of tests that any backend must pass. `src/api.ts` is **not** touched by this card.

## 1. The interface: `packages/core/src/backend.ts`

Core has no DOM types, so the interface uses its own small types for files, progress and cancelling.

```ts
/** A file chosen by the user, readable on demand. */
export interface FileSource {
  name: string;
  size: number;
  read(): Promise<Uint8Array>;
  /** The platform's own handle on the same file (a browser `File`), when there is one.
   *  A backend that can send it as it is does so, and never calls `read()`. */
  native?: unknown;
}
/** Satisfied by the browser's `AbortSignal`. */
export interface CancelSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}
export interface TransferOptions {
  /** Called with the fraction sent, from 0 to 1. A backend with nothing to send calls it once with 1. */
  onProgress?: (fraction: number) => void;
  cancel?: CancelSignal;
}
```

`Backend` is the services' own methods (the local backend will be the services themselves), written as `Pick<…>` of each service interface so that the two cannot drift:

```ts
export interface Backend {
  /** What this backend can do; screens test these, never "am I on a phone". */
  capabilities: { localSolvers: boolean };
  /** The address a screen puts in an image's `src` for a stored photo or thumbnail file. */
  files: { url(fileName: string): string };
  catalog: {
    /** The address of the star catalogue file to load. */
    starCatalogUrl(): Promise<string>;
  };
  plans: Pick<
    PlanService,
    | 'list'
    | 'create'
    | 'reorder'
    | 'update'
    | 'remove'
    | 'addEntry'
    | 'reorderEntries'
    | 'removeEntry'
    | 'updateEntry'
    | 'createMosaic'
    | 'updateMosaic'
    | 'removeMosaic'
  >;
  photos: Pick<
    PhotoService,
    | 'listWithSizes'
    | 'remove'
    | 'removeMany'
    | 'removeAll'
    | 'updateMetadata'
    | 'setManualPlacement'
    | 'setOrder'
  > & {
    upload(file: FileSource, fields: UploadFields, options?: TransferOptions): Promise<Photo>;
  };
  gear: Pick<
    GearService,
    | 'listCatalog'
    | 'addCustom'
    | 'removeCustom'
    | 'removeAllCustom'
    | 'listSetups'
    | 'createSetup'
    | 'replaceSetup'
    | 'setSetupEnabled'
    | 'removeSetup'
    | 'removeAllSetups'
  >;
  dsoOverrides: Pick<DsoOverrideService, 'getAll' | 'upsert' | 'remove' | 'removeAll'>;
  poiCategories: Pick<PoiCategoryService, 'list' | 'create' | 'update' | 'remove'>;
  skyRegions: Pick<SkyRegionService, 'list' | 'create' | 'update' | 'remove'>;
  settings: Pick<SettingsService, 'readPublic' | 'update' | 'removeApiKey'>;
  stars: Pick<StarSearchService, 'search' | 'nearby' | 'getByHip'>;
  horizon: Pick<HorizonService, 'getProfile'>;
  identify: Pick<IdentifyService, 'searchAsteroids' | 'searchTransients' | 'getCometElements'>;
  version: Pick<VersionService, 'getLatest'>;
  novaSolve: Pick<NovaSolveService, 'getJob' | 'listSubmissions'> & {
    submit(file: FileSource, hints?: NovaSolveHints): Promise<string>;
    reuse(file: FileSource, jobId: number): Promise<NovaReuseResult>;
  };
  solvedImport: {
    solveWcs(
      file: FileSource,
      target?: { width?: number; height?: number },
    ): Promise<SolveWcsResult>;
    convert(file: FileSource, options?: TransferOptions): Promise<ConvertSolvedResult>;
  };
  backup: {
    /** Builds the backup and hands it to the user: a download on the desktop, the share sheet on the phone. */
    exportToUser(request: ExportRequest): Promise<void>;
    preview(file: FileSource): Promise<ImportPreviewResult>;
    restore(file: FileSource, options: ImportOptions): Promise<ImportResult>;
  };
  /** The solvers installed next to the server. Absent on a backend without them. */
  localSolvers?: LocalSolverApi;
}
```

- The methods that take a `FileSource` are the only ones that differ from the services (which take bytes): the local backend will wrap those few.
- `LocalSolverApi`: define it in `packages/core/src/domain/solve.ts` from what `src/api.ts` does today with the two local solvers and from the three probe requests of `src/components/modals/SolverSettingsModal.vue` (lines 263, 305, 346): `submit(solver, file, hints?, options?)`, `poll(solver, jobId)`, `cancel(solver, jobId)`, `solve(solver, file, hints?, options?)` (the two direct solves that return a result without throwing) and `probe(kind, request)`, with `solver: 'astap' | 'solve-field'` and `kind: 'astap' | 'solve-field' | 'data-dir'`. Their types move to core, without `File` or `AbortSignal`.
- **Errors.** Every method rejects with a `DomainError` (`kind`, `code`, `message`). Nothing else is part of the contract.

## 2. The HTTP backend: new workspace package `packages/backend-http`

- `package.json` like `packages/backend-local/package.json` (name `@myastrosky/backend-http`), `tsconfig.json` with `lib: ["ES2022", "DOM"]` and `types: []`. Add its type check to the root `typecheck` script and to `.github/workflows/ci.yml`, its files to ESLint (browser globals; imports limited to `@myastrosky/core/*`, by `no-restricted-imports` at error) and to the coverage include, as was done for `packages/backend-local` (copy that set-up; look at commit `345967c`).
- `createHttpBackend(options): Backend` in `packages/backend-http/src/http-backend.ts`, with
  `options = { baseUrl?: string /* default '' */; fetch?: typeof fetch; lang: () => string; saveFile(name: string, blob: Blob): void }`.
- Each method does exactly the request `src/api.ts` does today for the matching function (same method, path, body, form field names, `lang` field), and unwraps the response wrappers (`{ jobId }`, `{ submissions }`, `{ candidates }`, `{ comets }`). The table of functions, routes and matching service methods is in the appendix of this card.
- A response that is not a success becomes `new DomainError(kind, message, { code })`: `kind` from the status (400 invalid, 404 notFound, 409 conflict, 429 rateLimited, 502 upstream, anything else upstream), `message` = the body's `error` (or the status text), `code` = the body's `code`, or `HTTP_<status>` when there is none (add the `HTTP_*` values you use to `ERROR_CODES` with a generic message in the four languages). A network failure becomes kind `upstream`, code `NETWORK_ERROR`.
- Files: when `file.native` is a `Blob`, it is appended to the form as it is (no copy in memory); otherwise `new Blob([await file.read()])`.
- Progress and cancel: `photos.upload` and `solvedImport.convert` keep `XMLHttpRequest` for the upload progress, as today; a cancelled request rejects with the same `DOMException('Aborted', 'AbortError')` as today (a cancellation is not a `DomainError`).
- `files.url(name)` returns `` `${baseUrl}/uploads/${name}` ``. `catalog.starCatalogUrl()` does what `src/star-catalog.ts:32-40` does (asks `GET /api/config`, falls back to `/data/stars.14.json`). `gear.listCatalog(type)` calls the four routes `src/gear-catalog.ts:111-141` calls. `capabilities.localSolvers` is `true`. `backup.exportToUser` posts the request, reads the file name from the response as today and calls `options.saveFile`.
- No `import.meta`, no `localStorage`, no `document` in this package: what it needs from the app comes through `options`.

## 3. The contract suite: `packages/core/src/testing/backend-contract.ts`

Written like `packages/core/src/testing/sql-db-conformance.ts` (a list of named cases with their own small assertions, no test framework imported), with a wrapper `tests/helpers/backend-contract.ts` that turns the cases into Vitest tests.

- `backendContractCases(makeBackend: () => Promise<{ backend: Backend; fixtures: ContractFixtures }>)`. `fixtures` gives the cases what they cannot build themselves in core: a small JPEG as a `FileSource`, a small FITS file with coordinates, a backup archive.
- Cases, at least: for each of plans, gear set-ups, custom gear, DSO corrections, point-of-interest categories and saved regions, a full life cycle (create, list, change, reorder where it exists, delete, list again) comparing the complete returned values; a photo upload, its listing with size, its metadata change, manual placement, order, deletion; settings read and change; star search by name, nearby and by number; a backup export captured through the save hook, previewed and restored into a second, empty backend; **one error case per error kind** (`invalid`, `notFound`, `conflict`) asserting `kind` and `code`; the cancellation of a conversion.
- The network-backed members (`horizon`, `identify`, `version`, `novaSolve`) are covered when `makeBackend` answers their outgoing requests from recorded fixtures (reuse those of `tests/unit/server-app-network.test.ts`); otherwise each has one case that at least asserts the error for bad input.
- No case may depend on generated identifiers, on timings or on the order of object keys.

## 4. Run the suite on the HTTP backend

`tests/unit/backend-http-contract.test.ts`: build the real application with `createApp()` on a temporary database and upload folder (copy the set-up of `tests/unit/server-app.test.ts`), and give `createHttpBackend` a `fetch` that reaches that application (listen on port 0 of `127.0.0.1` and close it after the tests, or call the application in-process the way the pinning tests do; choose what the pinning tests already use). `XMLHttpRequest` does not exist in the test environment for a server on another origin: if it cannot be used reliably, the HTTP backend takes an optional `options.upload` function for the two uploads with progress, the default being the `XMLHttpRequest` one, and the test passes a `fetch`-based one. Say which you chose.

## Must NOT

- Touch `src/` (the facade is the next card) or change any route.
- Put any browser type in `packages/core`.

## Escalate if

- A method of a service cannot be exposed as it is (its return value differs from what the route sends in a way the HTTP backend cannot rebuild). Give the method and the difference.
- The suite cannot reach the application without a real network port and the pinning tests offer no in-process way.

## Commit

`internal(mobile): add the backend interface, its HTTP version and a contract suite`

## Report, in addition to the common items

The final text of `packages/core/src/backend.ts` · every place where a `Backend` method differs from the service method, with the reason · the list of contract cases · how the test reaches the application · the members not covered and why.

---

## Appendix — today's functions, routes and matching service methods

`src/api.ts` function → request → service method. "wrap" = the route wraps the value in an object the HTTP backend unwraps.

**Plans** (`/api/plans…`): `getPlans` GET → `plans.list` · `createPlanAPI(name)` POST → `plans.create({ name })` · `renamePlanAPI`, `updatePlanSettingsAPI`, `updatePlanSortAPI` PUT `/:id` → `plans.update(id, changes)` · `deletePlanAPI` DELETE → `plans.remove` · `reorderPlansAPI` PUT `/order` → `plans.reorder` · `addPlanEntryAPI`, `addCustomPlanEntryAPI` POST `/:id/entries` → `plans.addEntry(planId, { dsoId } | { ra, dec })` · `removePlanEntryAPI(planId, entryId)` DELETE → `plans.removeEntry(entryId)` (the route needs the plan's id in its path: the HTTP backend's `removeEntry` and `updateEntry` receive only the entry's id; if the route cannot be called without the plan's id, add an optional trailing parameter to the service methods or a route addressed by entry id, and report which) · `reorderPlanEntriesAPI` PUT `/:id/entries/order` → `plans.reorderEntries` · `updatePlanEntryPAAPI`, `updatePlanEntryPositionAPI` PATCH `/:id/entries/:entryId` → `plans.updateEntry(entryId, changes)` · `createPlanMosaicAPI`, `updatePlanMosaicAPI`, `deletePlanMosaicAPI` → `plans.createMosaic`, `updateMosaic`, `removeMosaic`.

**Photos**: `uploadPhoto` POST `/api/photos` (form, progress) → `photos.upload` (the route sends only the photo) · `getPhotos` GET → `photos.listWithSizes` · `deletePhotoAPI` → `photos.remove` · `deleteBulkPhotos` DELETE `/api/photos` → `photos.removeMany` · `deleteAllPhotoMetadata` DELETE `/api/photo-metadata` → `photos.removeAll` · `updatePhotoManualPlacement` PATCH → `photos.setManualPlacement` · `updatePhotoMetadata` PATCH → `photos.updateMetadata` · `updatePhotoOrder` PATCH `/api/photos/order` → `photos.setOrder`.

**Solved files**: `solveWCS` POST `/api/solve-wcs` → `solvedImport.solveWcs` · `convertRawPhoto` POST `/api/photos/convert` (progress, cancel) → `solvedImport.convert` (the function builds a browser `File` from the returned picture: that stays in `src/api.ts`).

**Online solving**: `submitPlateSolve` POST `/api/solve-plate` → `novaSolve.submit` (wrap `{ jobId }`) · `pollPlateSolve` GET `/api/solve-plate/:id` → `novaSolve.getJob` · `listAstrometrySubmissions` GET → `novaSolve.listSubmissions` (wrap) · `reuseAstrometrySubmission` POST `/api/astrometry/reuse` → `novaSolve.reuse`.

**Local solvers (server only)**: `submitLocalSolveJob`, `pollLocalSolveJob`, `cancelLocalSolveJob`, `solveWithASTAP`, `solveWithSolveField` on `/api/solve-field` and `/api/solve-astap`; the three probes `POST /api/settings/probe-astap`, `/probe-solve-field`, `/probe-data-dir` → `localSolvers`.

**Backup**: `exportData` POST `/api/export` → `backup.exportToUser` · `importPreview` POST `/api/import/preview` → `backup.preview` · `importData` POST `/api/import` → `backup.restore`.

**Settings, version**: `loadServerSettings` GET `/api/settings` → `settings.readPublic` · `saveServerSettings` PUT → `settings.update` · `clearAstrometryApiKey` DELETE `/api/settings/astrometry-api-key` → `settings.removeApiKey` · `getLatestVersion` GET `/api/version/latest` → `version.getLatest`.

**Stars, horizon, identification**: `searchStarsAPI` GET `/api/stars/search` → `stars.search` · `searchStarsByPosition` GET `/api/stars/nearby` → `stars.nearby` · `GET /api/stars/:hip` → `stars.getByHip` · `fetchHorizonProfile` GET `/api/horizon` → `horizon.getProfile` · `skybotConesearchAPI` POST `/api/skybot/conesearch` → `identify.searchAsteroids` (wrap) · `tnsConesearchAPI` POST `/api/tns/conesearch` → `identify.searchTransients` (wrap) · `cometElementsAPI` GET `/api/comets/elements` → `identify.getCometElements` (wrap).

**Corrections, gear, categories, regions**: `getDsoOverrides`, `upsertDsoOverride`, `deleteDsoOverride`, `deleteAllDsoOverrides` → `dsoOverrides.getAll`, `upsert`, `remove`, `removeAll` · `createCustomGear`, `deleteCustomGear`, `deleteAllCustomGear` → `gear.addCustom`, `removeCustom`, `removeAllCustom` · `getGearSetups`, `createGearSetup`, `updateGearSetup`, `patchGearSetupEnabled`, `deleteGearSetupAPI`, `deleteAllGearSetupsAPI` → `gear.listSetups`, `createSetup`, `replaceSetup`, `setSetupEnabled`, `removeSetup`, `removeAllSetups` · `GET /api/telescopes|cameras|accessories|filters` → `gear.listCatalog(type)` · `getPoiCategories`, `createPoiCategory`, `updatePoiCategory`, `deletePoiCategoryAPI` → `poiCategories.list`, `create`, `update`, `remove` · `getSkyRegions`, `createSkyRegion`, `updateSkyRegion`, `deleteSkyRegionAPI` → `skyRegions.list`, `create`, `update`, `remove`.
