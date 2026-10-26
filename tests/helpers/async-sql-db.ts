/**
 * A test-only `SqlDb` that behaves like the phone's adapter will: every call really is
 * asynchronous (it resolves after a `setTimeout(0)`), and a transaction holds the database across
 * those gaps with a real lock, so other callers wait for it.
 *
 * It wraps another `SqlDb` (the better-sqlite3 adapter) but never uses the wrapped `transaction`
 * (its watchdog forbids awaiting a timer): it sends BEGIN / COMMIT / ROLLBACK itself. Like the
 * phone's adapter, it rolls back a body that awaits something other than its `tx` calls: once the
 * body's last `tx` call settles, a 0 ms timer checks that it started another one or settled.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  SQL_TX_AWAITED_NON_DB,
  SQL_TX_NESTED,
  SQL_TX_OUTER_CALL,
  type SqlDb,
  type SqlTx,
} from '@myastrosky/core/ports/sql-db';

interface TxContext {
  open: boolean;
  bodyDone: boolean;
  inFlight: number;
  settled: number;
  abandon: (err: Error) => void;
}

function codedError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function createAsyncSqlDb(inner: SqlDb): SqlDb {
  const als = new AsyncLocalStorage<TxContext>();
  /** The lock: a chain of promises; each holder runs after the previous one released. */
  let tail: Promise<void> = Promise.resolve();

  const acquire = async (): Promise<() => void> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  };

  /** A call made from inside a transaction body (or after it closed) must not use the outer object. */
  const refuseFromTx = (nested: boolean): Error | null => {
    const store = als.getStore();
    if (store === undefined) return null;
    if (!store.open) {
      return codedError(SQL_TX_AWAITED_NON_DB, 'This transaction is no longer open.');
    }
    return nested
      ? codedError(SQL_TX_NESTED, 'Transactions do not nest.')
      : codedError(SQL_TX_OUTER_CALL, 'Inside a transaction body, use only tx.');
  };

  /** A call from outside any transaction: wait for the lock, then for one timer tick. */
  const locked = async <T>(fn: () => Promise<T>): Promise<T> => {
    const refused = refuseFromTx(false);
    if (refused) throw refused;
    const release = await acquire();
    try {
      await tick();
      return await fn();
    } finally {
      release();
    }
  };

  return {
    all: (sql, params) => locked(() => inner.all(sql, params)),
    get: (sql, params) => locked(() => inner.get(sql, params)),
    run: (sql, params) => locked(() => inner.run(sql, params)),
    exec: (sql) => locked(() => inner.exec(sql)),
    batch: (statements) =>
      locked(async () => {
        await inner.exec('SAVEPOINT async_batch');
        try {
          await inner.batch(statements);
        } catch (err) {
          await inner.exec('ROLLBACK TO async_batch');
          await inner.exec('RELEASE async_batch');
          throw err;
        }
        await inner.exec('RELEASE async_batch');
      }),
    transaction: async <T>(body: (tx: SqlTx) => Promise<T>): Promise<T> => {
      const refused = refuseFromTx(true);
      if (refused) throw refused;
      const release = await acquire();
      const ctx: TxContext = {
        open: true,
        bodyDone: false,
        inFlight: 0,
        settled: 0,
        abandon: () => {},
      };
      const watch = (): void => {
        const at = ctx.settled;
        setTimeout(() => {
          if (!ctx.open || ctx.bodyDone || ctx.inFlight > 0 || ctx.settled !== at) return;
          ctx.abandon(
            codedError(SQL_TX_AWAITED_NON_DB, 'The body awaited something other than tx.'),
          );
        }, 0);
      };
      try {
        await tick();
        await inner.exec('BEGIN IMMEDIATE');
        const step = async <R>(fn: () => Promise<R>): Promise<R> => {
          if (!ctx.open) throw codedError(SQL_TX_AWAITED_NON_DB, 'This tx is no longer open.');
          ctx.inFlight++;
          try {
            await tick();
            return await fn();
          } finally {
            ctx.inFlight--;
            ctx.settled++;
            if (ctx.inFlight === 0) watch();
          }
        };
        const tx: SqlTx = {
          all: (sql, params) => step(() => inner.all(sql, params)),
          get: (sql, params) => step(() => inner.get(sql, params)),
          run: (sql, params) => step(() => inner.run(sql, params)),
          batch: (statements) => step(() => inner.batch(statements)),
        };
        let value: T;
        try {
          value = await new Promise<T>((resolve, reject) => {
            ctx.abandon = (err) => {
              ctx.open = false;
              reject(err);
            };
            als
              .run(ctx, () => body(tx))
              .then(
                (v) => {
                  ctx.bodyDone = true;
                  resolve(v);
                },
                (err: unknown) => {
                  ctx.bodyDone = true;
                  reject(err);
                },
              );
            watch();
          });
        } catch (err) {
          ctx.open = false;
          await tick();
          await inner.exec('ROLLBACK');
          throw err;
        }
        ctx.open = false;
        await tick();
        try {
          await inner.exec('COMMIT');
        } catch (err) {
          await inner.exec('ROLLBACK').catch(() => {});
          throw err;
        }
        return value;
      } finally {
        ctx.open = false;
        release();
      }
    },
  };
}
