# WP2.6a to WP2.6c — Fixes from the review of 2026-10-04

Model: sonnet for all · One sub-card at a time, in order · Depends on: WP2.5a · Needs device: no · Needs browser: no

Each sub-card is run by its own worker and makes **one commit**. The worker's prompt is this whole file plus the line "Run sub-card WP2.6x only". These cards run **before** WP2.4b and the plan and photo services.

## Why

An independent review (`.claude/work-packages/mobile-review-2026-10-04.md`, points A3, B1, B2, B3) found three things the service pattern missed:

- **On the phone, every database call crosses a bridge and costs about 35 ms**, against about 0.3 ms per statement inside one batch (measured in the spike, `docs/dev/mobile/spike-results.md`). The server's database is synchronous, so no server test notices a service that makes many calls one after another.
- **About half of the `DomainError`s have no `code`**, only an English message. The phone shows messages in the user's language through the code.
- **Services are built once, at import time**, in `server/services.ts`, which makes per-test databases and a second backend awkward.

## Read first

`.claude/work-packages/phase-2/WP2.3-first-services.md` (the pattern, including its section "Rules added on 2026-10-05"), `packages/core/src/ports/sql-db.ts`, `server/sqlite-adapter.ts`, the five services in `packages/core/src/services/`, `server/services.ts`, `server/routes/http-errors.ts`.

## Step 0 (every sub-card)

Check `git branch --show-current` is `mobile/phase-2`, that `git status --short` shows no modified tracked files, and that `npx vitest run tests/unit/server-app.test.ts tests/unit/server-backup.test.ts` passes. If not, stop.

---

## WP2.6a — Count database calls, group them, and give every error a code

1. **A counting test double.** Create `tests/helpers/counting-sql-db.ts`: `countingSqlDb(inner: SqlDb)` returns a `SqlDb` that forwards to `inner` and records, per top-level operation, how many **round trips** it made: each `all`, `get`, `run`, `exec`, `batch` call on the outer object counts 1; a whole `transaction` counts 1 for its begin, 1 per `tx` call inside it, and 1 for its commit. Expose `calls()` and `reset()`.
2. **Reduce the round trips of the existing services** (DSO overrides, sky regions, POI categories, settings, gear), without changing any result:
   - a read of several keys or rows is one query (`settings.readPublic()` reads its keys with one `SELECT … WHERE key IN (…)`; the rule for the secret key still applies to that row);
   - several writes that go together are one `batch` (`poiCategories.ensureDefaults()`; the writes of `settings.update`; a gear or setup import with its replaced ids);
   - no method awaits a database call inside a loop.
3. **Assert the counts.** In each service's test file, add one test per method that states its number of round trips with the counting double, as a fixed number that does not grow with the number of rows (for example: `readPublic` 1; `ensureDefaults` on an empty table 2; an import of one setup replacing three: a fixed small number).
4. **A code on every `DomainError`.** Make `code` a required constructor argument in `packages/core/src/domain/errors.ts`. Give each existing error a stable upper-snake-case code that says what is wrong (`PLAN_NAME_REQUIRED`, `SETUP_NOT_FOUND`, …); keep the codes that exist. **The HTTP responses must not change:** a response that has no `code` in its body today still has none (carry the exact body in `body`, as today); a response that has one keeps it. Add a test that every `DomainError` thrown by every service method's rejection path has a non-empty code (drive the rejection paths that the service tests already have).
5. In `docs/dev/mobile-architecture.md`, add the two rules (grouping, codes) to the part on services, in four lines.

Commit: `internal(refactor): group database calls in services and give every domain error a code`.

## WP2.6b — Build the services with a function

1. Create `server/create-services.ts`: `createServices(deps: { db: SqlDb; newId: () => string; secrets: SecretCodec; env: EnvSource; gearCatalog: GearCatalog })` returns the object of all services (`{ dsoOverrides, skyRegions, poiCategories, settings, gear }`). Later service cards add theirs, with their dependencies, here.
2. `server/services.ts` becomes the one place that calls it for the running server (with the adapter on `getConnection()`, `uuidv4`, the server secret codec, `process.env`, the built-in catalogue) and re-exports the same names as today, so that the routes do not change.
3. The service test files that build services by hand keep doing so or use `createServices`: your choice, but add one test, `tests/unit/create-services.test.ts`, that builds two independent sets on two in-memory databases and shows that a write through one is not seen by the other.
4. Do **not** change how `server/db.ts` opens the database.

Commit: `internal(refactor): build the server services with a function`.

## WP2.6c — One test suite that every `SqlDb` adapter must pass

The phone's adapter will be written later against real asynchronous calls. It must behave like the server's. This card turns the adapter's tests into a suite that any adapter can run.

1. Create `tests/helpers/sql-db-conformance.ts`: `describeSqlDbConformance(name: string, open: () => Promise<{ db: SqlDb; close: () => Promise<void> }>)`. It registers the cases of `tests/unit/sqlite-adapter.test.ts` that are about the contract and not about better-sqlite3: values and `null` and `Uint8Array` round trips; `changes` and `lastInsertRowid`; `batch` all-or-nothing; `transaction` commit, rollback and returned value; no nesting (`SQL_TX_NESTED`); calls on the outer object from inside a body rejected (`SQL_TX_OUTER_CALL`); two transactions started together do not overlap; `initSchema` works and foreign keys are enforced. Each case creates its own tables.
2. `tests/unit/sqlite-adapter.test.ts` calls the suite for the better-sqlite3 adapter and keeps, outside the suite, the cases that are specific to it (the `setImmediate` watchdog and `SQL_TX_AWAITED_NON_DB`, the legacy guard, the statement cache).
3. Add `tests/unit/sql-db-conformance-async.test.ts`: a second, test-only adapter that wraps the better-sqlite3 one and makes every call really asynchronous (each call resolves after a `setTimeout(0)`, with a real lock so that a transaction holds the database across those gaps and other callers wait). Run the suite on it. This is the behaviour the phone adapter will have; if a case cannot pass on it, the case is wrong for the phone: report it rather than forcing it.
4. Run the five service test suites once on that asynchronous adapter too (one extra `describe` per service file, or a shared loop): the services must pass on both.

Commit: `test: add a conformance suite for SqlDb adapters and run the services on an asynchronous one`.

---

## Must NOT (every sub-card)

- Change what any route accepts or returns. `tests/unit/server-app.test.ts` and `tests/unit/server-backup.test.ts` pass **unedited**.
- Touch the plan or photo code (their cards come next).
- Add a dependency.

## Acceptance (every sub-card, run by the worker)

- The new and changed tests pass; the two pinning tests pass unedited.
- `npm run typecheck:core` passes; `npm run swagger:generate` leaves `public/swagger.json` unchanged.
- `npm run verify` is green.

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit per sub-card**, with files staged by explicit path, **including the card's own row in the status table** at the end of `.claude/work-packages/README.md` (state `done`, the hash left as "this commit", a note of at most 30 words). Before committing, check `git branch --show-current` is `mobile/phase-2`.
- **Never add a `Co-Authored-By` line or any AI attribution.**

## Always forbidden

- Do not start a dev server. Do not kill any process you did not start.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create.

## Report (every sub-card)

Files changed and created · for WP2.6a the round-trip count of every service method before and after, and the list of codes added · acceptance output · anything that could not pass on the asynchronous adapter (WP2.6c) · deviations · open questions.
