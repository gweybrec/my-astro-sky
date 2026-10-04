# WP2.4a — Pin export and import with a round-trip test

Model: sonnet · Depends on: WP2.3c · Parallel-safe with: nothing · Needs device: no · Needs browser: no

## Goal

`server/routes/backup.ts` (export, import preview, import) is the bridge between a user's devices, and no automated test runs it: `tests/unit/server-app.test.ts` leaves these three routes out, and `tests/unit/import-export.test.ts` tests helpers and database functions, not the routes. Stretch G already changed parts of these routes (they now call three services). This card adds a test that exports everything through the real routes, imports it into an empty database through the real routes, and checks that the data is the same. Every later service card must keep it green.

## Step 0

Check `git branch --show-current` is `mobile/phase-2` and that `git status --short` shows no modified tracked files. If not, stop.

## Read first

`server/routes/backup.ts` (all of it), `server/import-utils.ts`, `tests/unit/server-app.test.ts` (how it builds the app on an in-memory database and a temp uploads folder, how it sends requests and multipart bodies), `tests/CLAUDE.md`.

## Steps

1. Create `tests/unit/server-backup.test.ts`. Reuse the approach of `server-app.test.ts` (same environment line at the top, `vi.resetModules()`, `DB_PATH=':memory:'`, `UPLOADS_DIR` in a fresh temp folder, `ENABLE_SWAGGER='false'`, dynamic import of `server/app.js`, `listen(0)`). If helpers of `server-app.test.ts` are worth sharing, move them to `tests/helpers/server-app-harness.ts` and import them from both files **without changing any assertion of `server-app.test.ts`**; otherwise copy what you need.
2. **Instance A, seed through the API only** (no direct database call): one custom telescope and one custom camera; one gear setup using them; one plan with two entries, one observation window on an entry, and one mosaic; one POI category beyond the five defaults, and a change to one default; one sky region; one DSO override; one editable setting changed; two photos uploaded with `POST /api/photos` (small PNGs made with `sharp`), each with metadata (labels, DSO ids, a point of interest using the new category, integration rows, capture details, notes), one with a manual placement, and a draw order set.
3. **Export** with `POST /api/export`, every option on and all photos selected. Assert the response is a ZIP. Open it (`unzipper` is a dependency; `fflate` is available through the core package) and assert: the list of entry names; that `manifest.json` parses and holds the two photos; that each data file the export writes parses as JSON; that each photo's image entry has the same bytes as the file in A's uploads folder.
4. **Instance B:** tear A down completely (close the server, `closeDatabase()`, new temp uploads folder, `vi.resetModules()`), build a second app on a new in-memory database.
5. **Preview** on B with `POST /api/import/preview` and the ZIP: assert what the preview reports for an empty instance (what the bundle contains, nothing marked as already existing). Record the shape as it is today.
6. **Import** on B with `POST /api/import`, selecting everything (read the route for the form fields). Assert the response.
7. **Compare A and B through the API:** for each list route (`/api/photos`, `/api/plans`, `/api/gear-setups`, the gear catalogue routes for custom entries, `/api/poi-categories`, `/api/sky-regions`, `/api/dso-overrides`), the data of B equals the data of A after removing the fields that legitimately differ (find them by running the test: ids that are regenerated, timestamps, file names). List in a comment at the top of the test which fields are ignored and why. Everything else must be equal. Check that B's uploads folder holds the two images and their thumbnails.
8. **Second import on B** of the same ZIP: the preview now reports the items as already existing; the import completes; the lists of B are unchanged (no duplicates).
9. **Partial import:** on a third instance C, import the same ZIP with only the plans selected: plans arrive, photos do not.
10. Keep the file under 30 seconds. No network.

## Record, do not judge

This is a characterisation test. If something does not survive the round trip (a field lost, an order changed, a duplicate created by the second import), do NOT fix the route and do NOT hide it: write the assertion so that it matches today's behaviour, mark it with a comment `// KNOWN GAP:` and one sentence, and list every such gap in the report. The Planner decides what to fix.

## Must NOT

- Change `server/routes/backup.ts`, `server/import-utils.ts`, any service, or any assertion of an existing test.
- Add a dependency.
- Call `/api/version/latest`, the solve routes, or anything that reaches the network.

## Acceptance (worker)

- `npx vitest run tests/unit/server-backup.test.ts` passes three times in a row (no flakiness); give its duration.
- `npx vitest run tests/unit/server-app.test.ts` passes.
- `npm run verify` is green.

## Escalate if

- The app cannot be built a second time in one test file (module state that survives `vi.resetModules()`).
- The export or the import fails on valid data: that is a bug, possibly from stretch G. Stop and report the exact request, response and stack; do not work around it.
- The round trip loses user data in a way a user would notice (a photo, a plan entry, a setup): finish the test with `KNOWN GAP` markers, and put this at the top of the report.

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit**, with files staged by explicit path. Before committing, check `git branch --show-current` is `mobile/phase-2`.
- Message: `test: cover export and import with a round trip through the routes`.
- **Never add a `Co-Authored-By` line or any AI attribution.**

## Always forbidden

- Do not start a dev server. Do not kill any process you did not start (port 3001 is in use by the user's own app: leave it alone; the test listens on a free port of its own).
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create.

## Report

Files changed and created · the ZIP's entry list and the manifest's fields · the fields ignored in the comparison and why · every `KNOWN GAP` · acceptance output with durations · deviations · open questions.
