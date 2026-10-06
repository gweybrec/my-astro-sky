# WP3.4 — `src/api.ts` calls the backend, and nothing else reaches the server

Model: sonnet · Depends on: WP3.3 (reviewed) · Needs device: no · Needs browser: no (the orchestrator checks the app in a browser afterwards)

## Goal

Every function of `src/api.ts` calls the backend object instead of the server, with the same name, the same parameters, the same return value and the same error behaviour as today. The few places of `src/` that reach the server without `src/api.ts` go through it too. After this card, no file of `src/` other than the backend's installation knows that a server exists.

## Steps

1. **`src/backend.ts`** (new):
   - `setBackend(backend: Backend): void` and `getBackend(): Backend`;
   - when `getBackend()` is called before any `setBackend`, it installs the HTTP backend: `createHttpBackend({ lang: getLang, saveFile: downloadBlob })` (`downloadBlob` is in `src/file-utils.ts`; use the app's current-language getter from the i18n module). This lazy default keeps every existing test and the desktop app working without a start-up step.
   - Nothing is created at import time.
2. **`src/api.ts` becomes a facade.** For each exported function: keep the signature and the documented behaviour, replace the request by a call to `getBackend()`.
   - A browser `File` becomes a `FileSource`: one helper `fileSource(file: File): FileSource` = `{ name: file.name, size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()), native: file }`.
   - An `AbortSignal` is passed as `cancel` as it is. `onProgress` is passed through.
   - **Errors.** The backend rejects with a `DomainError`. Each function turns it into what it does today: a plain `new Error(message)` whose message is `t('serverErrors.' + code)` when that key exists, else the error's message, else today's fallback text. Write this once (`toUserError(err, fallbackKey)`), keep `parseServerError` exported with its current behaviour (a test calls it).
   - **Special cases keep their exact behaviour**: `searchStarsAPI` and `searchStarsByPosition` return `[]` on any error; `getLatestVersion` returns `null`; `reuseAstrometrySubmission`, `solveWithASTAP` and `solveWithSolveField` return `{ success: false, … }` with the same fields as today (including `errorDetails` and the call to `reportRendererError`: if the HTTP backend no longer gives the facade the status and the response text these fields need, add them to the `DomainError`'s optional `body` in the HTTP backend and read them from there); `cancelLocalSolveJob` swallows errors; `pollPlateSolve` and `pollLocalSolveJob` answer "still running" when the error's kind is `rateLimited`; `cometElementsAPI` keeps its memory of the last successful answer; `convertRawPhoto` still returns a browser `File` built from the returned picture; `exportData` still returns nothing after the download started.
   - The local-solver functions use `getBackend().localSolvers`; when it is absent they fail with a `DomainError` of kind `invalid`, code `LOCAL_SOLVERS_UNAVAILABLE` (add the code and its message in the four languages: "Les solveurs locaux ne sont pas disponibles sur cet appareil." and its translations).
   - `getSolverAvailability(settings)` stays a pure function.
   - After this step `src/api.ts` contains no `fetch(`, no `XMLHttpRequest`, no `FormData` and no `/api/` text.
3. **The places that bypass `src/api.ts`**, each replaced by a new function of `src/api.ts` that calls the backend:
   - `src/gear-catalog.ts:111,121,131,141` (the four gear lists) → `getGearCatalog(type)` → `gear.listCatalog(type)`;
   - `src/components/modals/SolverSettingsModal.vue:263,305,346` (the three probes) → `probeLocalSolver(kind, request)` → `localSolvers.probe`;
   - `src/star-catalog.ts:32-40` (which star catalogue file to load) → `getStarCatalogUrl()` → `catalog.starCatalogUrl()`;
   - the addresses of stored pictures, built by hand as `'/uploads/' + name` in `src/components/modals/IdentifyModalShell.vue:53`, `src/export-render.ts:137,270`, `src/gallery.ts:480-481,614,620,775`, `src/photo-overlay.ts:896,923,989-990` → `photoFileUrl(fileName)` → `files.url(fileName)`. `src/photo-overlay.ts:923` compares an image's address with a text ending: compare with `photoFileUrl(fileName)` resolved to an absolute address instead, so the test still holds when the address is not under `/uploads/`.
   - The files under `/data/` (`src/star-catalog.ts`, `src/dso-catalog.ts`, `src/dso-editor.ts`) are part of the app's own files on every platform: leave them.
   - Each new function gets its entry in every `vi.mock('../../src/api', …)` factory of a test whose module under test now calls it (the factories list their functions one by one; a missing one is `undefined`). List the test files edited for this reason: this is the one edit to those tests this card allows.
4. **A lint rule that keeps it so**: in `eslint.config.js`, for `src/**` except `src/api.ts` and `src/backend.ts`, `no-restricted-syntax` at **error** on a call to `fetch` whose first argument is a text or template starting with `/api/` or `/uploads/`, and on any text or template starting with `/uploads/`. Check that `npm run lint` exits with 0.
5. **Tests.**
   - `tests/unit/api-facade.test.ts`: with a fake backend installed by `setBackend`, for each special case of step 2 and for five ordinary functions of different groups, assert the arguments the backend receives and what the function returns or throws (message from the code; fallback when the code has no message).
   - `tests/unit/api-errors.test.ts` keeps passing unedited.
   - The 15 mocking tests keep passing (apart from the additions of step 3).
6. **Docs**: in `docs/dev/mobile-architecture.md`, a section "How a screen reaches its data" (the screens call `src/api.ts`; it calls the backend; the HTTP backend on the desktop, the local backend on the phone; where each lives; how a new data function is added: service method, `Backend` member, HTTP backend method, contract case, facade function). In `src/CLAUDE.md`, two sentences: screens never call `fetch` on the server or build `/uploads/` addresses; they call `src/api.ts`.

## Must NOT

- Rename or remove an export of `src/api.ts`, or change a signature.
- Move a screen's import of `src/api` to another module.
- Change any screen beyond the replacements of step 3.

## Escalate if

- A function's behaviour today cannot be reproduced from the backend's result or error (name it, and what is missing).
- More than the tests named in step 3 would have to change.

## Commit

`internal(mobile): route every data call of the screens through the backend`

## Check by the orchestrator, after the commit (browser, isolated data)

Ports 5173 and 3001 free (otherwise stop and report; never kill a process that is not yours). Start `npm run dev` with `DB_PATH` and `UPLOADS_DIR` pointing to an empty folder of the scratchpad, never the user's data. In the browser: the sky map draws with no error in the console; add a photo that carries its coordinates (a FITS from `test-photos/` if present, see the `test-placement` skill) and see it placed; the gallery shows its thumbnail; create a plan, add a target, rename it, delete it; create a setup; open the settings window; export a backup and restore it; switch the language to English and provoke one error (rename a plan to an empty name) to see a translated message. Stop the server by killing the whole process tree you started, and check the ports are free. Report each item as passed or failed, with a screenshot of the map and of the gallery.

## Report, in addition to the common items

For each exported function: "ordinary" or the special case kept · the new functions and the files they replaced requests in · the mocking tests edited · anything of `src/` that still reaches the server and why.

## Additions after the review of WP3.3 (2026-10-06): they override the text above where they differ

1. **Plan entries.** `plans.removeEntry(entryId, planId?)` and `plans.updateEntry(entryId, changes, planId?)` have an optional last parameter since WP3.3. The facade always passes the real plan id it receives (`removePlanEntryAPI`, `updatePlanEntryPAAPI`, `updatePlanEntryPositionAPI`).
2. **Two dead functions.** `solveWithASTAP` and `solveWithSolveField` of `src/api.ts` have no caller (only an unused import in `src/ui.ts` and in `src/photo-overlay.ts`), and the routes they call have answered with a job id, not a result, since before this work. Check with a search that there is still no caller, then delete: the two functions, their two unused imports, `parseSolverFailure` and its helpers if nothing else uses them, `LocalSolverApi.solve` with its implementation in `packages/backend-http`, its cases in `tests/unit/http-backend.test.ts` and in the contract suite, and its mention in any `vi.mock` factory. This is the one removal of exports this card allows. If you find a caller, stop and report.
3. **Star catalogue.** `catalog.starCatalogUrl()` only chooses the address. `src/star-catalog.ts` keeps its own fallback to `/data/stars.14.json` when loading the chosen file fails, exactly as today.
4. **The default upload is untested.** Add to `tests/unit/http-backend.test.ts` cases for the default `XMLHttpRequest` upload with a small fake `XMLHttpRequest` class installed on `globalThis` for the test: the progress fractions reach `onProgress`; a cancel during the upload rejects with `AbortError` and removes its listener; a network error rejects with code `NETWORK_ERROR`; a 400 answer with a code gives that code.
