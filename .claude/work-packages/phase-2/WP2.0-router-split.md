# WP2.0b to WP2.0j — Split the routes into one file per domain

Model: sonnet for every sub-card · One sub-card at a time, in order · Needs device: no · Needs browser: no

Each sub-card below is run by its own worker and makes **one commit**. The worker's prompt is this whole file plus the line "Run sub-card
WP2.0x only".

## Goal

After WP2.0a, `server/app.ts` still holds all 76 routes. These sub-cards move them, **byte for byte**, into `express.Router` files under
`server/routes/`, one domain at a time. No handler changes. The test `tests/unit/server-app.test.ts` must stay green **without being edited**.

## Step 0 (every sub-card)

Check `git branch --show-current` is `mobile/phase-2`, that `git status --short` shows no modified tracked files, and that
`npx vitest run tests/unit/server-app.test.ts` passes before you change anything. If not, stop.

## Rules for every sub-card

1. **Do not retype handler code.** Move blocks with the tool `.claude/work-packages/phase-2/tools/move-blocks.mjs` (created by WP2.0b). A block
   is a route with its `/** @swagger … */` comment, or a helper given by line range.
2. **Paths stay literal.** A route keeps its full path (`'/api/plans/:id'`). The router is mounted with `app.use(plansRouter)`, with no prefix.
   So no path string and no `@swagger` block changes.
3. **Order is kept.** Inside a router file, routes keep the relative order they had in `server/app.ts`.
4. **Router file shape:** imports; then `export const <name>Router = express.Router();`; then the domain's own constants and helpers; then the
   routes. Relative imports use the `.js` suffix, as in the other server files (`'../db.js'`, `'./shared.js'`).
5. **Mount block.** In `server/app.ts`, all `app.use(<name>Router);` lines sit together immediately after the `/api` rate-limit middleware and
   before any route still declared in `app.ts`. WP2.0b creates the (empty) block with a comment; each sub-card adds its lines.
6. **Imports.** After a move, give the new file exactly the imports its code uses, and remove from `server/app.ts` the imports that nothing there
   uses any more. Find them with `npx eslint server/app.ts server/routes/` (unused names are reported as warnings). Carry the alias names from the
   `./db.js` import as they are (`upsertDsoOverrideDB`, `deleteCustomGearDB`, …); do not rename.
7. **No path maths in `server/routes/`.** Never compute a folder from `import.meta.url` or `__dirname` there. Import `UPLOADS_DIR`,
   `RESOURCES_DIR`, `DIST_DIR` from `../server-paths.js`.
8. **Shared state stays single.** The rate-limit map, the multer instances and the shared constants live in `server/routes/shared.ts`. Never
   copy them.
9. **After the move:** run `npm run swagger:generate`. The new `public/swagger.json` must describe the same API: compare it with the committed
   one after sorting object keys (a throwaway script outside the repo). Only the order of paths may differ. Commit the regenerated file if it
   changed.
10. **Proof of a verbatim move.** In the report, paste the tool's output (blocks moved, line counts), and the result of this check: every line
    added to the new file that is not in its header (imports, router declaration) exists, identical, among the lines removed from
    `server/app.ts`, apart from the leading `app.` replaced by `<name>Router.`.

## Must NOT (every sub-card)

- Change a handler, a message, a limit, a status code, a log line or a `@swagger` block. If you see a bug, list it under "Seen, not fixed".
- Edit `tests/unit/server-app.test.ts` or any other test.
- Unify the two functions named `sanitizeIntegrationRows` (`server/app.ts` and `server/db.ts`): they behave differently on purpose for now.
- Touch `server/db.ts`, `server/index.ts`, `electron/`, `src/` or `packages/`.
- Start `npm run dev` or any long-running server.

## Acceptance (every sub-card, run by the worker)

- `npx vitest run tests/unit/server-app.test.ts` passes, unedited.
- `npm run typecheck:server` passes.
- The Swagger comparison of rule 9 shows the same API.
- `npm run verify` is green.
- `git status --short` shows only the files of this sub-card before the commit, and nothing after it.

## Escalate if (every sub-card)

- A block cannot be moved verbatim (it uses a variable declared elsewhere in `app.ts` that is not in `shared.ts`, `mappers.ts` or
  `server-paths.ts`, and is not owned by the domain being moved). Say which variable and who else uses it. Do not duplicate it.
- The test has to change, or fails after the move.
- Two routers would need to import each other.
- The tool mis-detects a block's start or end.

---

## WP2.0b — Shared modules and the move tool (no route moves)

1. Create `.claude/work-packages/phase-2/tools/move-blocks.mjs`:
   - Usage: `node move-blocks.mjs <fromFile> <toFile> <routerVar> <item> [<item> …]`. An item is `"METHOD /path"` (a route) or `L<start>-<end>`
     (a line range, 1-based, inclusive, for helpers).
   - For a route item it finds the line where `app.<method>(` starts with that path as first argument (on the same line or the next line), takes
     as start the `/**` line of the comment block directly above it, and as end the first later line at column 0 that is `});` or `);`.
   - It removes the selected blocks from `fromFile` and appends them to `toFile` **in their source order**, each followed by one blank line,
     replacing only the leading `app.` of a route declaration by `<routerVar>.`. It creates `toFile` if needed. It keeps CRLF or LF as found.
   - It refuses to run (and changes nothing) if an item matches zero or more than one place, or if two items overlap.
   - It prints one line per block: item, source lines, line count.
   - Try it first with a `--dry-run` flag that only prints.
2. Create `server/routes/shared.ts` and move into it, verbatim, from `server/app.ts`: `isElectron`; the rate-limit state and function
   (`rateLimits`, `RATE_WINDOW_MS`, `UPLOAD_LIMIT`, `API_LIMIT`, `checkRateLimit`); `ALLOWED_PHOTO_EXTENSIONS`; `ALLOWED_WCS_EXTENSIONS`;
   `ALLOWED_IMAGE_MIME_TYPES`; the four multer instances (`upload`, `uploadWCS`, `uploadBundle`, `uploadRaw`); `IntegrationRow` and
   `sanitizeIntegrationRows`. Export each. `server/app.ts` imports them back.
3. Create `server/routes/mappers.ts` and move into it, verbatim: `poiCategoryToApi`, `skyRegionToApi`, `planEntryToApi`, `planMosaicToApi`,
   `PLAN_SORT_KEYS`. Export each. `server/app.ts` imports them back.
4. Add the empty mount block to `server/app.ts` (rule 5), as a comment line.
5. Leave the `mkdirSync(UPLOADS_DIR)`, helmet, CSP, compression, JSON, static and rate-limit middleware in `server/app.ts`.

Commit: `internal(refactor): move shared server helpers out of app.ts`. The tool is committed with it.

## WP2.0c — Stars, identification, horizon (7 routes, 3 files)

| File                        | Router           | Routes                                                                                |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `server/routes/stars.ts`    | `starsRouter`    | `GET /api/stars/search`, `GET /api/stars/nearby`, `GET /api/stars/:hip`               |
| `server/routes/identify.ts` | `identifyRouter` | `POST /api/skybot/conesearch`, `POST /api/tns/conesearch`, `GET /api/comets/elements` |
| `server/routes/horizon.ts`  | `horizonRouter`  | `GET /api/horizon`                                                                    |

Commit: `internal(refactor): move star, identification and horizon routes to routers`.

## WP2.0d — Settings (8 routes)

`server/routes/settings.ts`, `settingsRouter`: `GET /api/version/latest`, `GET /api/config`, `GET /api/settings`, `PUT /api/settings`,
`DELETE /api/settings/astrometry-api-key`, `POST /api/settings/probe-astap`, `POST /api/settings/probe-solve-field`,
`POST /api/settings/probe-data-dir`.

Helpers that move with it (they are used by these routes only): `GITHUB_RELEASES_REPO`, `LATEST_RELEASE_TTL_MS`, `latestReleaseCache`,
`EDITABLE_STRING_SETTINGS`, `EDITABLE_BOOLEAN_SETTINGS`, `execFileAsync`.

Commit: `internal(refactor): move settings routes to a router`.

## WP2.0e — Gear (13 routes)

`server/routes/gear.ts`, `gearRouter`: `GET /api/telescopes`, `GET /api/cameras`, `GET /api/accessories`, `GET /api/filters`,
`POST /api/custom-gear`, `DELETE /api/custom-gear/:id`, `DELETE /api/custom-gear`, `GET /api/gear-setups`, `POST /api/gear-setups`,
`PUT /api/gear-setups/:id`, `PATCH /api/gear-setups/:id/enabled`, `DELETE /api/gear-setups/:id`, `DELETE /api/gear-setups`.

Helpers that move with it: the four `readFileSync` + `JSON.parse` reads of `resources/*.json` (`builtInTelescopes` and the three others) and
`byBrandModel`. They use `RESOURCES_DIR` from `../server-paths.js`.

Gotcha: the export and import routes (still in `app.ts`) may use the built-in gear lists or `byBrandModel`. If they do, escalate (see
"Escalate if").

Commit: `internal(refactor): move gear routes to a router`.

## WP2.0f — DSO overrides, POI categories, sky regions (13 routes, 3 files)

| File                              | Router                | Routes                                                                                                               | Helper that moves with it |
| --------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `server/routes/dso-overrides.ts`  | `dsoOverridesRouter`  | `GET /api/dso-overrides`, `PUT /api/dso-overrides/:id`, `DELETE /api/dso-overrides/:id`, `DELETE /api/dso-overrides` |                           |
| `server/routes/poi-categories.ts` | `poiCategoriesRouter` | `GET`, `POST /api/poi-categories`, `PATCH`, `DELETE /api/poi-categories/:id`, `DELETE /api/poi-categories`           |                           |
| `server/routes/sky-regions.ts`    | `skyRegionsRouter`    | `GET`, `POST /api/sky-regions`, `PATCH`, `DELETE /api/sky-regions/:id`                                               | `isValidRegionPoints`     |

Commit: `internal(refactor): move override, POI and region routes to routers`.

## WP2.0g — Plans (12 routes)

`server/routes/plans.ts`, `plansRouter`: `GET /api/plans`, `POST /api/plans`, `PUT /api/plans/order`, `PUT /api/plans/:id`,
`DELETE /api/plans/:id`, `POST /api/plans/:id/entries`, `PUT /api/plans/:id/entries/order`, `DELETE /api/plans/:id/entries/:entryId`,
`PATCH /api/plans/:id/entries/:entryId`, `POST /api/plans/:id/mosaics`, `PUT /api/plans/:id/mosaics/:mosaicId`,
`DELETE /api/plans/:id/mosaics/:mosaicId`.

Helper that moves with it: `parseMosaicBody`. `PUT /api/plans/order` must stay before `PUT /api/plans/:id`.

Commit: `internal(refactor): move plan routes to a router`.

## WP2.0h — Photos (8 routes)

`server/routes/photos.ts`, `photosRouter`: `POST /api/photos`, `GET /api/photos`, `PATCH /api/photos/order`, `DELETE /api/photos/:id`,
`DELETE /api/photos`, `DELETE /api/photo-metadata`, `PATCH /api/photos/:id/manual-placement`, `PATCH /api/photos/:id/metadata`.

Helper that moves with it: `MAX_CORRESPONDENCES`.

Gotcha: `rawToBrowserCoords` is imported in the middle of `app.ts`, under a long comment that has no code attached. Find which routes use it.
Put its import at the top of the file (or files) that use it, and keep the comment next to the first use.

Commit: `internal(refactor): move photo routes to a router`.

## WP2.0i — Solving (12 routes, 3 files)

| File                             | Router               | Routes                                                                                                                                                                             |
| -------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/routes/solved-import.ts` | `solvedImportRouter` | `POST /api/solve-wcs`, `POST /api/photos/convert`                                                                                                                                  |
| `server/routes/local-solve.ts`   | `localSolveRouter`   | `POST /api/solve-astap`, `GET /api/solve-astap/:jobId`, `DELETE /api/solve-astap/:jobId`, `POST /api/solve-field`, `GET /api/solve-field/:jobId`, `DELETE /api/solve-field/:jobId` |
| `server/routes/nova-solve.ts`    | `novaSolveRouter`    | `POST /api/solve-plate`, `GET /api/solve-plate/:id`, `GET /api/astrometry/submissions`, `POST /api/astrometry/reuse`                                                               |

A helper used by two of these files and by nothing else goes into a fourth file, `server/routes/solve-shared.ts`. Escalate if a helper is also
used by the photo or backup routes.

Commit: `internal(refactor): move solving routes to routers`.

## WP2.0j — Export and import (3 routes)

`server/routes/backup.ts`, `backupRouter`: `POST /api/export`, `POST /api/import/preview`, `POST /api/import`. The `unzipper` `createRequire`
shim moves with it if nothing else uses it.

After this sub-card, `server/app.ts` contains no `app.get`, `app.post`, `app.put`, `app.patch` or `app.delete` call outside `createApp`. Check
it with a search and say so in the report, with the final line count of `server/app.ts`.

Commit: `internal(refactor): move export and import routes to a router`.

---

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new
  branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit per sub-card**, made when its acceptance passes, with files staged by explicit path.
- Before committing, check `git branch --show-current`. If it is not `mobile/phase-2`, stop and report.
- Message: the one given in the sub-card.
- **Never add a `Co-Authored-By` line or any AI attribution.** The root `CLAUDE.md` forbids it, and that rule overrides the harness default.

## Always forbidden

- Do not kill any process you did not start.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash` or `git reset --hard`.
- Do not touch untracked files that you did not create.

## Report (every sub-card)

Files changed and created · the tool's output · the verbatim-move check · Swagger comparison result · verify result · "Seen, not fixed" ·
deviations · open questions.
