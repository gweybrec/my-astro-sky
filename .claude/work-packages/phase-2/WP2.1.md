# WP2.1 — The `SqlDb` port and its better-sqlite3 adapter

Model: sonnet · Depends on: WP2.0k · Parallel-safe with: nothing · Needs device: no · Needs browser: no · **Reviewed by the Planner (Opus) before any card builds on it**

## Goal

Services shared by the desktop server and the phone will talk to SQLite through one small asynchronous interface, `SqlDb`. This card defines that interface in the core package, implements it for the server on top of the existing better-sqlite3 connection, and makes it impossible for old synchronous database code and a new service transaction to mix. No existing behaviour changes.

## Step 0

Check `git branch --show-current` is `mobile/phase-2` and that `git status --short` shows no modified tracked files. If not, stop.

## Context

- `server/db.ts` opens the connection at import time (`new Database(dbPath)`, near line 31), creates the schema, runs the migrations, and declares 72 module-level prepared statements and 11 `db.transaction` uses. It does not export the connection. Read `packages/core/CLAUDE.md` for the rules of the core package (no Node or DOM globals; `erasableSyntaxOnly`: no parameter properties, no enums).
- Three tests mock the module `../../server/db` with only `getSetting` (`astap.test.ts`, `solve-field.test.ts`, `astrometry-http.test.ts`). Other tests load `server/db.js` with `vi.resetModules()`, `vi.stubEnv('DB_PATH', ':memory:')` and a dynamic import. Both patterns must keep working unchanged.
- Why the guard (step 4): better-sqlite3 is synchronous and there is one connection. A service transaction is `BEGIN` … awaits … `COMMIT`. If its body only awaits `SqlDb` calls, which resolve at once, the whole transaction finishes before Node runs any other request. If a body awaits anything else (a file, an image, a timer), another request can run in the middle, and its writes would silently join the open transaction. That must fail loudly instead.

## Steps

1. **The port.** Create `packages/core/src/ports/sql-db.ts` with exactly these exports (add doc comments; do not add members):

   ```ts
   export type SqlValue = string | number | null | Uint8Array;

   export interface SqlRunResult {
     /** Rows changed by the statement. */
     changes: number;
     /** Row id of the last inserted row, when the statement inserted one. */
     lastInsertRowid?: number;
   }

   export interface SqlStatement {
     sql: string;
     params?: readonly SqlValue[];
   }

   /** What a transaction body may use. */
   export interface SqlTx {
     all<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
     get<T = Record<string, unknown>>(
       sql: string,
       params?: readonly SqlValue[],
     ): Promise<T | undefined>;
     run(sql: string, params?: readonly SqlValue[]): Promise<SqlRunResult>;
     /** Runs several statements in order. Inside a transaction they belong to it; outside, they are atomic. */
     batch(statements: readonly SqlStatement[]): Promise<void>;
   }

   export interface SqlDb extends SqlTx {
     /** Runs one or more statements without parameters (schema changes). */
     exec(sql: string): Promise<void>;
     /**
      * Runs `body` inside one transaction: committed if it resolves, rolled back if it rejects.
      * RULE: `body` may only await calls on `tx`. Awaiting anything else is an error (see the adapter).
      * Transactions do not nest.
      */
     transaction<T>(body: (tx: SqlTx) => Promise<T>): Promise<T>;
   }

   /** Error codes the adapters use. */
   export const SQL_TX_AWAITED_NON_DB = 'SQL_TX_AWAITED_NON_DB';
   export const SQL_TX_NESTED = 'SQL_TX_NESTED';
   export const SQL_LEGACY_CALL_IN_TX = 'SQL_LEGACY_CALL_IN_TX';
   ```

2. **Expose the connection.** In `server/db.ts`, add one export, `getConnection()`, returning the raw better-sqlite3 handle (see step 4 for which handle is "raw"). Change nothing else in the exported API.

3. **The adapter.** Create `server/sqlite-adapter.ts` exporting `createBetterSqliteDb(conn: Database.Database): SqlDb`.
   - `all`, `get`, `run`, `exec`: do the work synchronously and return an already-settled promise (a thrown error becomes a rejected promise). Cache prepared statements by SQL text.
   - Bind a `Uint8Array` parameter as a `Buffer` view over the same bytes (no copy).
   - `batch` outside a transaction: all statements inside one better-sqlite3 transaction, so they are atomic.
   - `transaction(body)`:
     - if one is already open on this adapter because the caller is inside its body, reject with an `Error` whose `code` is `SQL_TX_NESTED`;
     - callers from elsewhere wait in a queue until the open transaction has settled (a promise chain is enough); the same queue makes plain `all`/`get`/`run`/`batch`/`exec` calls on the outer `SqlDb` wait while a transaction is open;
     - `BEGIN IMMEDIATE`, mark the guard of step 4 "open", call `body(tx)`;
     - **watchdog:** schedule a `setImmediate` when the transaction begins. If the transaction is still open when it fires, the body awaited something that was not a `tx` call: roll back, mark the guard "closed", and make the transaction's promise reject with an `Error` whose `code` is `SQL_TX_AWAITED_NON_DB` and whose message says that a transaction body may only await `tx` calls. A late call on that `tx` rejects with the same code;
     - on success `COMMIT`; on failure `ROLLBACK` and rethrow the body's error; always mark the guard "closed" and cancel the watchdog.

4. **The guard on old code.** Create `server/db-tx-guard.ts`: a module-level flag with `setServiceTxOpen(open: boolean)` and `assertLegacyAllowed()`, which throws an `Error` with `code` `SQL_LEGACY_CALL_IN_TX` when the flag is set. In `server/db.ts`, keep the raw handle for `getConnection()` and for nothing else, and make the module's own `db` a wrapper around it whose `prepare(...)` returns statements that call `assertLegacyAllowed()` before `run`, `get`, `all` and `iterate`, and whose `exec`, `pragma` and `transaction` do the same before running. Every other statement or connection member must behave exactly as before (bind native methods to the real object). The adapter uses the raw handle, so it is not affected by the guard.

5. **Tests: `tests/unit/sqlite-adapter.test.ts`.** Use a private `new Database(':memory:')` for 5a to 5g, and the `DB_PATH=':memory:'` dynamic-import pattern for 5h.
   - a. `run`, `get`, `all`, `exec` on a small table: values, `changes`, `lastInsertRowid`; `get` on no row returns `undefined`.
   - b. `null` binds as SQL NULL; a `Uint8Array` round-trips through a BLOB column byte for byte.
   - c. `batch`: all applied; when the second statement fails, the first is not applied.
   - d. `transaction`: commits and returns the body's value; rolls back when the body throws, and rejects with the body's error.
   - e. Rule violation: a body that awaits a 5 ms timer between two writes rejects with code `SQL_TX_AWAITED_NON_DB`; nothing is committed; `conn.inTransaction` is `false` afterwards; the adapter is usable again.
   - f. Two `transaction` calls started together (`Promise.all`) both succeed and do not overlap.
   - g. A nested `transaction` call rejects with code `SQL_TX_NESTED`, and the outer one can still commit.
   - h. The guard: load `server/db.js`, build an adapter on `getConnection()`, open a transaction, and inside its body (after one `tx.run`) check that calling a legacy function (`getSetting('x')`) throws with code `SQL_LEGACY_CALL_IN_TX`; after the transaction, the same call works. Also check that a legacy write made from a timer that fires during a rule-violating body throws, and is therefore not part of the rolled-back transaction.

6. **ESLint.** In `eslint.config.js`, the `packages/core/**` block already bans Node and server imports. Add nothing unless the new files produce an error; report any new warning in the new files.

7. **Docs.** In `docs/dev/mobile-architecture.md`, in the part about ports, add five lines on `SqlDb`: where it lives, the transaction rule, the three error codes, and that old `server/db.ts` functions throw inside a service transaction. In `server/CLAUDE.md`, add two sentences: new persistence code goes through `SqlDb`; inside `SqlDb.transaction` only `tx` calls may be awaited.

## Must NOT

- Change the behaviour or the signature of any existing export of `server/db.ts`, or move any SQL.
- Convert any existing function to `SqlDb`. Nothing uses the adapter yet outside its tests.
- Make `server/db.ts` free of import-time work (a later card decides that).
- Edit an existing test. If one fails, stop and report.
- Add a dependency.

## Acceptance (worker)

- `npx vitest run tests/unit/sqlite-adapter.test.ts` passes.
- `npx vitest run tests/unit/server-app.test.ts` passes, unedited.
- `npm run typecheck:core` passes (the port uses no Node or DOM type).
- `npm run verify` is green, with no existing test file changed.

## Gotchas

- `packages/core` is compiled with `lib: ["ES2022"]` and `types: []`: `Buffer`, `setImmediate` and `process` do not exist there. They belong in `server/sqlite-adapter.ts`.
- Node runs all pending promise callbacks after each request callback before it runs the next one; `setImmediate` runs later, after other pending I/O callbacks. That is why the watchdog alone is not enough and step 4 exists: a legacy call that sneaks in before the watchdog fires must throw.
- better-sqlite3 statements and the connection are native objects: a method called with the wrong `this` throws "Illegal invocation". The wrapper must call methods on the real object.
- `conn.inTransaction` tells whether SQLite has a transaction open.
- The working tree has CRLF line endings.

## Escalate if

- The wrapper of step 4 cannot be made transparent (an existing test fails, or a member of the connection is used in a way the wrapper cannot pass through).
- The electron main bundle (`vite.main.config.ts`) or `tsx` cannot load the new files.
- You find a place where today's code already runs a statement between a `BEGIN` and a `COMMIT` across an `await`.

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit**, made when the acceptance passes, with files staged by explicit path. Before committing, check `git branch --show-current` is `mobile/phase-2`.
- Message: `internal(refactor): add the SqlDb port and its better-sqlite3 adapter`.
- **Never add a `Co-Authored-By` line or any AI attribution.** The root `CLAUDE.md` forbids it, and that rule overrides the harness default.

## Always forbidden

- Do not start a dev server. Do not kill any process you did not start.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create.

## Report

Files changed and created · the final text of the port file · how the wrapper of step 4 passes other members through · acceptance output (test counts, verify result) · deviations · open questions.
