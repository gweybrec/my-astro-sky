# WP2.1b — Make the `SqlDb` rule portable (Planner review of WP2.1)

Model: sonnet · Depends on: WP2.2 · Parallel-safe with: nothing · Needs device: no · Needs browser: no

## Goal

The Planner reviewed WP2.1 and approves it with three changes. The adapter currently lets a call on the outer `SqlDb`, made from inside a transaction body, join the transaction. It detects that with Node's `AsyncLocalStorage`. The phone's adapter will have no such mechanism: the same code would deadlock there. So the server adapter must refuse what the phone cannot do, and the rule becomes: **inside a transaction body, use only `tx`**.

## Step 0

Check `git branch --show-current` is `mobile/phase-2` and that `git status --short` shows no modified tracked files. If not, stop.

## Steps

1. **`packages/core/src/ports/sql-db.ts`:** add `export const SQL_TX_OUTER_CALL = 'SQL_TX_OUTER_CALL';` with the comment "A call was made on the outer `SqlDb` from inside a transaction body; use `tx`." In the doc comment of `transaction`, add: "Inside `body`, calls on the outer `SqlDb` are rejected: pass `tx` to the code that needs the database. A function that must work both inside and outside a transaction takes a `SqlTx` parameter (`SqlDb` is one)."
2. **`server/sqlite-adapter.ts`, the plain calls (`all`, `get`, `run`, `exec`, `batch`) and `transaction`:**
   - a call made from inside the body of the transaction that is open (`store === current && store.open`) rejects with code `SQL_TX_OUTER_CALL` for the plain calls; `transaction` keeps rejecting with `SQL_TX_NESTED`;
   - a call made from a transaction context that is no longer open (`store !== undefined && !store.open`: the body went on running after the watchdog rolled it back, or after it settled) rejects with code `SQL_TX_AWAITED_NON_DB`, for the plain calls and for `transaction`. Today such a call runs on its own, outside any transaction, which would leave a half-applied change;
   - everything else is unchanged (a caller with no transaction context runs at once when nothing is queued, or waits in the queue).
3. **Statement cache:** cap it at 200 entries; when full, drop the oldest entry before adding one.
4. **Tests, added to `tests/unit/sqlite-adapter.test.ts`** (do not change the existing cases, except case h's comment if it describes the old behaviour):
   - a plain call on the outer `SqlDb` inside a body rejects with `SQL_TX_OUTER_CALL`, the body can catch it, and the transaction can still commit what it did through `tx`;
   - a body that awaits a timer and then calls the outer `SqlDb`: the transaction rejects with `SQL_TX_AWAITED_NON_DB`, the late outer call rejects with the same code, and nothing was written;
   - a function taking a `SqlTx` works when given `tx` and when given the outer `SqlDb`;
   - 250 different SQL texts in a row all work (cache cap).
5. **`packages/core/src/db/schema.ts`:** check that `initSchema` and `runDataMigrations` use only `tx` inside their bodies (they do today); change nothing unless a test fails.
6. **Docs:** `docs/dev/mobile-architecture.md` and `server/CLAUDE.md`: state the rule in one sentence each ("inside a transaction body, use only `tx`; outer calls are rejected") and list the fourth error code.
7. **Electron check** (the adapter imports `node:async_hooks`, which no server file imported before): measure free disk space (`Get-PSDrive C`); if under 6 GB, skip this step and say so. Check that no process listens on ports 5173 and 3001 (if one does, skip this step and say so: `electron:package` cleans build folders). Run `npm run electron:package`; it must succeed; then check that `.vite/build/main.js` contains `createBetterSqliteDb` or, if the adapter is not yet reachable from the entry point (nothing imports it outside tests), say so and check instead that the build has no unresolved-import warning for `node:async_hooks`. Then run `npm run clean`.

## Must NOT

- Change the port's interfaces (only add the constant and the comment).
- Change `server/db.ts`, `server/db-tx-guard.ts` or any existing test case's assertions.
- Convert any existing code to `SqlDb`.

## Acceptance (worker)

- `npx vitest run tests/unit/sqlite-adapter.test.ts tests/unit/schema-baseline.test.ts tests/unit/server-app.test.ts` pass.
- `npm run typecheck:core` passes.
- `npm run verify` is green.
- The Electron check of step 7, or the reason it was skipped.

## Escalate if

- An existing test case has to change its assertions.
- `electron:package` fails for a reason linked to this branch's changes.

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit**, with files staged by explicit path. Before committing, check `git branch --show-current` is `mobile/phase-2`.
- Message: `internal(refactor): reject outer database calls inside a transaction body`.
- **Never add a `Co-Authored-By` line or any AI attribution.**

## Always forbidden

- Do not start a dev server. Do not kill any process you did not start.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create.

## Report

Files changed · acceptance output · the Electron check result · deviations · open questions.
