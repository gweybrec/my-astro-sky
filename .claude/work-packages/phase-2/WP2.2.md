# WP2.2 — One schema definition for the server and the phone

Model: sonnet · Depends on: WP2.1 · Parallel-safe with: nothing · Needs device: no · Needs browser: no

## Goal

The phone will create its database from scratch; the server upgrades databases that are years old. Both must end with the same schema, defined once. This card puts the current schema (version 14) in the core package as a baseline, adds a place for future migrations that both sides run, and proves with a test that the baseline equals what the server's old path produces.

## Step 0

Check `git branch --show-current` is `mobile/phase-2` and that `git status --short` shows no modified tracked files. If not, stop.

## Context

- `server/db.ts` creates tables in two groups around `applyMigrations(db)` (from `server/db-migrations.ts`, versions 1 to 14; the version is one row in `schema_version`). Migrations 1 to 14 contain program logic (try/catch `ALTER TABLE`, a table rebuild in 13) and stay where they are, frozen.
- WP2.1 added `SqlDb` (`packages/core/src/ports/sql-db.ts`), `createBetterSqliteDb` (`server/sqlite-adapter.ts`) and `getConnection()` in `server/db.ts`.
- The schema uses nothing that is special to one SQLite build: no `RETURNING`, no `json_*` functions, no `STRICT` tables. It must stay that way.

## Steps

1. **Get the real schema.** With a throwaway script outside the repo, load `server/db.js` on `DB_PATH=':memory:'` and read `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name`. That output is the source for step 2.
2. **Create `packages/core/src/db/schema.ts`** exporting:
   - `SCHEMA_VERSION = 14`;
   - `BASELINE_SCHEMA: readonly string[]`: one SQL statement per entry (tables first, then indexes), taken from step 1. You may re-indent a statement; you may not reorder columns or change types, defaults or constraints. `schema_version` is not in the list (step 3 creates it);
   - `interface DataMigration { version: number; statements: readonly string[] }`;
   - `MIGRATIONS: readonly DataMigration[] = []`, with a comment: migrations from version 15 on go here, as SQL statements only, in ascending order;
   - `async function initSchema(db: SqlDb): Promise<number>` (see step 3).
     The header comment states the portability rules of "Context" and that the first two files to read before adding a migration are this one and `server/db-migrations.ts`.
3. **`initSchema(db)`**, in this order:
   - run `PRAGMA foreign_keys = ON`, outside any transaction;
   - create `schema_version (version INTEGER)` if it does not exist;
   - read the version row. If there is none and the database has no `photos` table: run `BASELINE_SCHEMA` and insert the row with `SCHEMA_VERSION`, all in one `db.transaction`. If there is none but `photos` exists, throw an `Error` saying the database predates versioning and must be opened by the desktop server first;
   - for each entry of `MIGRATIONS` with a version above the stored one, in order: its statements and the `UPDATE schema_version` in one `db.transaction`;
   - return the final version.
4. **The server runs the same future migrations.** In `server/db-migrations.ts`, after the existing loop, add a second loop over `MIGRATIONS` from core: for each entry above the stored version, run its statements and the version update inside one better-sqlite3 transaction. The array is empty today, so nothing changes at run time. Do not touch migrations 1 to 14.
5. **Tests: `tests/unit/schema-baseline.test.ts`.**
   - Build database A the old way (dynamic import of `server/db.js` on `:memory:`, then `getConnection()`), and database B from a private `new Database(':memory:')` through the adapter and `initSchema`.
   - The two have the same set of tables and the same set of indexes (names).
   - For every table: `PRAGMA table_info`, `PRAGMA foreign_key_list` and `PRAGMA index_list` with each index's `PRAGMA index_info` are equal in A and B (compare as data, not as SQL text).
   - Both report version 14.
   - On B, foreign keys are enforced: deleting a photo removes its rows in `star_correspondences`.
   - `initSchema` twice on B is a no-op and returns 14. `initSchema` on A (through an adapter on its connection) is a no-op and returns 14.
   - A fake future migration: call the migration loop with a test-only list (make the loop a small exported function that takes the list, used by `initSchema` with `MIGRATIONS`) and check the statements ran and the version moved; then check that a failing statement leaves the version and the schema unchanged.
   - The same fake list through the server's loop of step 4 (export that loop as a small function too) gives the same schema as through `initSchema`.
6. **Docs.** `server/CLAUDE.md`: replace the sentence saying schema changes go through `server/db-migrations.ts` by: new migrations (version 15 and above) are SQL statements added to `MIGRATIONS` in `packages/core/src/db/schema.ts`, and `BASELINE_SCHEMA` and `SCHEMA_VERSION` are updated in the same commit; `schema-baseline.test.ts` fails otherwise. Add the same rule in two lines to `packages/core/CLAUDE.md` and to `docs/dev/mobile-architecture.md`. If `.claude/skills/add-photo-metadata/SKILL.md` tells the reader to add a migration in `server/db-migrations.ts`, correct that step.

## Must NOT

- Change migrations 1 to 14, the table creation in `server/db.ts`, or any SQL the server runs today.
- Seed data in the baseline (the default POI categories are seeded by a later card).
- Edit an existing test. If one fails, stop and report.
- Add a dependency.

## Acceptance (worker)

- `npx vitest run tests/unit/schema-baseline.test.ts` passes.
- `npx vitest run tests/unit/server-app.test.ts tests/unit/db-migrations.test.ts` pass, unedited.
- `npm run typecheck:core` passes.
- `npm run verify` is green, with no existing test file changed.

## Gotchas

- A column added by `ALTER TABLE ADD COLUMN` appears at the end of the table's `sql` in `sqlite_master`, sometimes with odd spacing. Keep the column order as it is there.
- The baseline must make the keeping-in-step rule testable: the comparison in step 5 is what fails when someone adds a migration without updating the baseline. Say in the report how you checked that (for example by temporarily removing a column from the baseline and seeing the test fail, then restoring it).
- `PRAGMA foreign_keys` has no effect inside a transaction.

## Escalate if

- The old path's schema cannot be reproduced by plain `CREATE` statements (for example a table that only exists in some upgrade paths).
- `sqlite_master` shows a difference between a fresh database and what `db-migrations.test.ts` builds from version 0.
- Anything in the schema is not portable under the rules of "Context".

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit**, made when the acceptance passes, with files staged by explicit path. Before committing, check `git branch --show-current` is `mobile/phase-2`.
- Message: `internal(refactor): define the database schema once, in the core package`.
- **Never add a `Co-Authored-By` line or any AI attribution.**

## Always forbidden

- Do not start a dev server. Do not kill any process you did not start.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create.

## Report

Files changed and created · the list of tables and indexes in the baseline · how you proved the test catches a baseline that is out of step · acceptance output · deviations · open questions.
