# WP3.1 — Typed parameters on the services, and routes that only transport

Model: sonnet · Depends on: Phase 2 · Needs device: no · Needs browser: no

## Goal

The backend of this phase is made of the services' own methods. Two things stand in the way: some methods still take `unknown` (a raw request body), and some routes still do work that a phone, which has no routes, would miss. Fix both. **No response of any route changes.**

## Part A — typed parameters

These methods take `unknown` today. Give each a parameter type from `packages/core/src/domain/` (create the type there when it does not exist; reuse the type `src/api.ts` already uses for the matching function when there is one). The method **keeps validating at run time exactly as today** (a phone screen or a restored backup can still pass bad data): same checks, same errors, same codes.

| Service method                                                                  | Type to use (the one of the matching `src/api.ts` function)                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `DsoOverrideService.upsert(id, data)`                                           | `id: string`, `data: DSOUserOverride`; `getAll()` returns `Record<string, DSOUserOverride>`       |
| `GearService.addCustom(type, data)`                                             | `type: CustomGearType`, `data`: a `CustomGearInput` type you define from the validation           |
| `GearService.createSetup(input)`, `replaceSetup(id, input)`                     | `Omit<GearSetupData, 'id'>`                                                                       |
| `GearService.setSetupEnabled(id, enabled)`                                      | `boolean`                                                                                         |
| `PoiCategoryService.create(input)`, `update(id, input)`                         | `{ name: string; color: string }`, `Partial<{ name; color; position }>`                           |
| `SkyRegionService.create(input)`, `update(id, input)`                           | `Omit<SkyRegionData, 'id' \| 'position'>`, `Partial<Omit<SkyRegionData, 'id'>>`                   |
| `SettingsService.update(body)`                                                  | a `SettingsChanges` type matching the object `saveServerSettings` sends                           |
| `BackupService.previewPhotoList(list)`, `importPhotoList(list, …)`, `shortcuts` | leave as `unknown`: they are the content of a file, not a caller's argument. Say so in a comment. |

The routes pass `req.body` with a cast at the call (`req.body as SettingsChanges`); the run-time validation is what protects them. Tests that pass deliberately wrong values to a service keep doing so with a cast in the test.

## Part B — routes that only transport

For every file of `server/routes/`, list what each handler does besides: read the request, call one service method, send the result. Then move each extra into the service layer, so that calling the service directly gives the same outcome as calling the route. Known cases (find the others):

1. **`isWindows`** is added to the settings by the route. Give `createSettingsService` a dependency `platform: { isWindows: boolean }`; `readPublic()` returns the full `ServerSettings`. The server passes `process.platform === 'win32'`.
2. **After the online-solving key changes**, the route resets the online-solving session (`novaSolve.resetSession()`). Do it without the route: `createSettingsService` takes an optional `onApiKeyChanged?: () => void`, and `createServices` wires it to the session reset (mind the creation order; a small holder variable is fine). `update` and `removeApiKey` both call it when the key changed.
3. **The backup routes decide whether the uploaded file is a ZIP or a JSON list**, then call `preview`/`previewPhotoList` or `importFrom`/`importPhotoList`. Move that decision into core: `BackupService.previewFile(file)` and `BackupService.importFile(file, options)`, where `file` is `{ bytes: Uint8Array; openZip(): Promise<BundleReader> }` (the caller supplies how to open a ZIP; the server passes its `unzipper` reader). The route keeps multer and the parsing of the form's text fields into `ImportOptions`. If the server's reader needs a file path instead of bytes, keep `openZip` lazy so nothing is read twice; if that cannot be done without loading a large archive in memory on the server, escalate with the smallest alternative.
4. **The name of the export file** (`Content-Disposition`). Move the name's construction to core (`backupFileName(now: Date): string` in `packages/core/src/domain/backup.ts`); the route uses it.
5. **Messages translated on the server.** `server/messages.ts` (`msg.api.*`, chosen by a `lang` field of the request) is used by `routes/identify.ts`, `routes/nova-solve.ts` and `routes/solved-import.ts`. Do **not** remove this now. For each place, make sure the error or result also carries a stable `code` (add one where missing, upper snake case), and list in the report every `msg.api.*` key with its code: WP3.2 uses that list.

Do not move: multer and its size limits, the rate limiter, the static file serving, the response wrappers (`{ jobId }`, `{ submissions }`, `{ candidates }`, `{ comets }`), the local solver routes (`server/routes/local-solve.ts`) and the three probe routes of `server/routes/settings.ts` (the phone has no local solvers).

## Tests

- Each typed method: the existing service tests keep passing (with casts where they pass bad data on purpose).
- `isWindows`, the session reset on key change, `previewFile`/`importFile` (a ZIP, a JSON list, a file that is neither) and `backupFileName`: cases in the matching service test files, on both database adapters where a database is involved.

## Commit

`internal(refactor): type the service parameters and move the last route logic into services`

## Report, in addition to the common items

The table of every route handler with "transport only: yes/no" and what was moved · the list of `msg.api.*` keys with their codes · anything a route still does that a phone would miss, with the reason it stays.
