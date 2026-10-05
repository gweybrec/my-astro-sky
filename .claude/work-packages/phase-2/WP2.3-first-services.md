# WP2.3a to WP2.3c — The first three services

Model: sonnet for every sub-card · One sub-card at a time, in order · Depends on: WP2.1b · Needs device: no · Needs browser: no

Each sub-card is run by its own worker and makes **one commit**. The worker's prompt is this whole file plus the line "Run sub-card WP2.3x only".

## Goal

A **service** is the one place where a feature's rules and its SQL live. It is plain TypeScript in `packages/core`, talks to the database through `SqlDb`, and will run unchanged on the phone. The Express route keeps only HTTP work: read the request, call the service, write the response. These three sub-cards convert the three smallest domains and set the pattern for all the others. **No behaviour changes:** `tests/unit/server-app.test.ts` pins these routes and must pass unedited.

## Step 0 (every sub-card)

Check `git branch --show-current` is `mobile/phase-2`, that `git status --short` shows no modified tracked files, and that `npx vitest run tests/unit/server-app.test.ts` passes before you change anything. If not, stop.

## Read first

`packages/core/CLAUDE.md`, `server/CLAUDE.md`, `packages/core/src/ports/sql-db.ts`, `server/sqlite-adapter.ts`, `packages/core/src/db/schema.ts`, and (from WP2.3b on) the files WP2.3a created.

## The pattern (every sub-card)

1. **Service file:** `packages/core/src/services/<name>.ts` exports `create<Name>Service(deps)` returning an object of async methods. `deps` is an object: always `db: SqlDb`; `newId: () => string` when the service creates ids. No class, no module-level state, no import from `server/` or `src/`.
2. **Everything about the feature moves into the service:** the validation that the route does today, the mapping between database rows and the API shape, and the SQL that `server/db.ts` holds for it. The SQL text is copied unchanged. A method that makes several writes that must go together uses `db.transaction` and, inside the body, only `tx`.
3. **Errors:** a rule that fails throws a `DomainError` (created in WP2.3a). The route turns it into the response it sends today: same status, same body, byte for byte. Read each `res.status(...).json(...)` of the route before you move it.
4. **Types:** the API shape of the feature lives in `packages/core/src/domain/` (it may already be there from Phase 1; reuse it). The row type stays private to the service.
5. **The route file** imports the service from `server/services.ts` and becomes: parse `req`, `await` the service, send the result; one `try`/`catch` per handler that calls `sendError(res, err)`. Keep every `@swagger` block unchanged. If a handler logs with `logServerError` today, it still does, for the same cases.
6. **Every other caller** of the `server/db.ts` functions you replace is switched to the service in the same sub-card (`server/routes/backup.ts` uses them for export and import; search the whole of `server/`). Mappers in `server/routes/mappers.ts` that the service absorbs are deleted there. Then delete the replaced functions, their prepared statements and their row types from `server/db.ts`. If something still needs one of them and cannot use the service, keep it, and say which and why.
7. **Tests:**
   - a new `tests/unit/<name>-service.test.ts` runs the service on a private in-memory database: `new Database(':memory:')`, `createBetterSqliteDb`, `initSchema`. Cover every method, every validation rule (one accepted and one rejected case each), and what a caller sees when a row is missing;
   - an existing test that calls a deleted `server/db.ts` function is rewritten to call the service on the same kind of database, **keeping its assertions**. List each such test in the report. A test that fails for another reason: stop and report;
   - `tests/unit/server-app.test.ts` passes **unedited**.
8. **Docs:** add the service to the table of services in `docs/dev/mobile-architecture.md` (create the table in WP2.3a if there is none: service, file, what it owns, routes that use it).

## Rules added on 2026-10-05 (they apply to every service card from WP2.3f on)

9. **Group the database calls.** On the phone each call costs about 35 ms. A method never awaits a database call inside a loop: several reads are one query, several writes are one `batch` (inside a transaction: `tx.batch`). Its test states the method's number of round trips with `countingSqlDb` (`tests/helpers/counting-sql-db.ts`), as a fixed number that does not grow with the number of rows.
10. **Every `DomainError` has a `code`** (upper snake case, stable). The HTTP response does not change: carry today's exact body in `body`.
11. **Typed parameters.** The service interfaces are what the phone UI and the desktop UI will both call. A method takes typed parameters declared in `packages/core/src/domain/` (for example `update(id: string, changes: PlanChanges)`), and still checks them at run time, because the HTTP route passes what a client sent. It returns domain values. A method does not take "the request body" as `unknown`.
12. **Register the service in `createServices`** (`server/create-services.ts`), with its dependencies.
13. **The service tests run on both adapters**: the better-sqlite3 one and the asynchronous test adapter of `tests/helpers/`.
14. **Status row.** Update your card's row in the status table at the end of `.claude/work-packages/README.md` in your own commit.

## Must NOT (every sub-card)

- Change what a route accepts or returns, an error message, a status code, or a `@swagger` block.
- Use the outer `db` inside a transaction body, or await anything but `tx` calls there.
- Import `server/db.ts` from the core package, or `better-sqlite3` outside `server/` and the tests.
- Touch a domain that is not the sub-card's.
- Make `server/db.ts` free of import-time work, or change how tests obtain the old database.

## Acceptance (every sub-card, run by the worker)

- `npx vitest run tests/unit/server-app.test.ts` passes, unedited.
- The new service test passes.
- `npm run typecheck:core` passes.
- `npm run swagger:generate` leaves `public/swagger.json` unchanged.
- `npm run verify` is green.
- A search shows no remaining use of the deleted `server/db.ts` functions.

## Escalate if (every sub-card)

- A response cannot be reproduced byte for byte through the service and `sendError`.
- `tests/unit/server-app.test.ts` would have to change.
- A caller of the old functions is synchronous and cannot await (say where).
- An existing test other than those of rule 7 fails.

---

## WP2.3a — Errors, the services module, and DSO overrides

1. Create `packages/core/src/domain/errors.ts`:

   ```ts
   export type DomainErrorKind = 'invalid' | 'notFound' | 'conflict' | 'rateLimited' | 'upstream';

   /** A rule of the domain was not met. Routes and the phone UI turn it into a response or a message. */
   export class DomainError extends Error {
     readonly kind: DomainErrorKind;
     /** Stable machine code, when the client translates the message. */
     readonly code?: string;
     /** The exact response body to send, when it is not `{ error: message }`. */
     readonly body?: Readonly<Record<string, unknown>>;
     constructor(
       kind: DomainErrorKind,
       message: string,
       options?: { code?: string; body?: Readonly<Record<string, unknown>> },
     );
   }
   ```

   Write the constructor with plain field assignments (the core package forbids parameter properties). Add `isDomainError(e: unknown): e is DomainError`.

2. Create `server/routes/http-errors.ts` with `sendError(res, err, fallbackStatus = 500)`: for a `DomainError`, the status is 400 for `invalid`, 404 for `notFound`, 409 for `conflict`, 429 for `rateLimited`, 502 for `upstream`, and the body is `err.body ?? { error: err.message }`; for anything else, `fallbackStatus` and `{ error: (err as Error).message }`, as the handlers do today.
3. Create `server/services.ts`: it builds one `SqlDb` with `createBetterSqliteDb(getConnection())` and exports one instance per service (`export const dsoOverrides = createDsoOverrideService({ db })`). Later sub-cards add theirs. Nothing else goes in this file.
4. `packages/core/src/services/dso-overrides.ts`, `createDsoOverrideService({ db })` with: `getAll(): Promise<Record<string, object>>`, `upsert(id: unknown, data: unknown): Promise<void>` (the three rejections of today's `PUT` route, in the same order: invalid id, invalid data, invalid coordinates), `remove(id: string): Promise<void>`, `removeAll(): Promise<number>` (the count that today's `DELETE /api/dso-overrides` returns), and `importOne(id: string, data: object): Promise<void>` if the import route needs a write without the route's checks (look at what `server/routes/backup.ts` does today and keep it).
5. `validateDsoOverrideCoords` is in `server/import-utils.ts`. Move it to `packages/core/src/services/dso-overrides.ts` (or a file next to it) if it is pure, and re-export it from `server/import-utils.ts` so that its existing test keeps importing it from there. Its return value is the body that the route sends with status 400: carry it in `DomainError.body`.
6. Convert `server/routes/dso-overrides.ts` and the override parts of `server/routes/backup.ts`; delete `getDsoOverride`, `getAllDsoOverrides`, `upsertDsoOverride`, `deleteDsoOverride`, `deleteAllDsoOverrides` and their statements from `server/db.ts` (rule 6).

Commit: `internal(refactor): move DSO overrides into a core service`.

## WP2.3b — Sky regions

`packages/core/src/services/sky-regions.ts`, `createSkyRegionService({ db, newId })`. It absorbs `skyRegionToApi` (from `server/routes/mappers.ts`), `isValidRegionPoints` (from `server/routes/sky-regions.ts`), the validation of the four routes, and `getAllSkyRegions`, `upsertSkyRegion`, `deleteSkyRegion` from `server/db.ts`. The methods return the API shape, so the export route no longer maps. The route passes `uuidv4` as `newId` through `server/services.ts`.

Commit: `internal(refactor): move sky regions into a core service`.

## WP2.3c — POI categories, and their default rows

`packages/core/src/services/poi-categories.ts`, `createPoiCategoryService({ db, newId })`. It absorbs `poiCategoryToApi`, the validation of the five routes, and `getAllPoiCategories`, `upsertPoiCategory`, `deletePoiCategory`, `deleteAllPoiCategories` from `server/db.ts`.

The default categories: today `server/db.ts` inserts five default rows at import time when the table is empty. Move that into the service as `ensureDefaults(): Promise<void>` (same five rows, same ids, same condition, in one transaction), delete the block and its count statement from `server/db.ts`, and call `await poiCategories.ensureDefaults()` in `createApp()` in `server/app.ts`, before the routers can serve a request. A test that relied on the rows being there right after importing `server/db.js` calls `ensureDefaults()` first; list it in the report.

Commit: `internal(refactor): move POI categories into a core service`.

---

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit per sub-card**, made when its acceptance passes, with files staged by explicit path. Before committing, check `git branch --show-current` is `mobile/phase-2`.
- Message: the one given in the sub-card.
- **Never add a `Co-Authored-By` line or any AI attribution.**

## Always forbidden

- Do not start a dev server. Do not kill any process you did not start.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create.

## Report (every sub-card)

Files changed and created · the service's method list with signatures · functions deleted from `server/db.ts`, and any kept with the reason · existing tests rewritten (file, what changed) · acceptance output · "Seen, not fixed" · deviations · open questions.
