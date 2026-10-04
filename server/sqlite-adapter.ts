import { AsyncLocalStorage } from 'node:async_hooks';
import type Database from 'better-sqlite3';
import {
  SQL_TX_AWAITED_NON_DB,
  SQL_TX_NESTED,
  type SqlDb,
  type SqlRunResult,
  type SqlStatement,
  type SqlTx,
  type SqlValue,
} from '@myastrosky/core/ports/sql-db';
import { setServiceTxOpen } from './db-tx-guard.js';

type Conn = Database.Database;

interface TxContext {
  open: boolean;
}

function codedError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/** Runs `fn` now and returns an already-settled promise (a throw becomes a rejection). */
function settle<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.reject(err);
  }
}

function bind(params: readonly SqlValue[] | undefined): unknown[] {
  if (!params) return [];
  return params.map((p) =>
    p instanceof Uint8Array ? Buffer.from(p.buffer, p.byteOffset, p.byteLength) : p,
  );
}

const INSERT_RE = /^\s*(?:insert|replace)\b/i;

/**
 * Adapts a better-sqlite3 connection to the asynchronous `SqlDb` port.
 * Pass the RAW connection (`getConnection()` from `db.ts`), not the guarded legacy wrapper.
 *
 * better-sqlite3 is synchronous and there is one connection, so every call does its work at
 * once and returns a settled promise. A transaction body that awaits only `tx` calls therefore
 * finishes before Node runs any other request. A body that awaits anything else is detected by a
 * `setImmediate` watchdog and rolled back (see `transaction`).
 */
export function createBetterSqliteDb(conn: Conn): SqlDb {
  const cache = new Map<string, Database.Statement>();
  const als = new AsyncLocalStorage<TxContext>();
  /** Tail of the queue of pending transactions. */
  let tail: Promise<unknown> = Promise.resolve();
  /** Transactions running or waiting. While > 0, plain calls from outside queue up too. */
  let pending = 0;
  let current: TxContext | null = null;

  const prep = (sql: string): Database.Statement => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = conn.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  };

  const allSync = <T>(sql: string, params?: readonly SqlValue[]): T[] =>
    prep(sql).all(...bind(params)) as T[];
  const getSync = <T>(sql: string, params?: readonly SqlValue[]): T | undefined =>
    prep(sql).get(...bind(params)) as T | undefined;
  const runSync = (sql: string, params?: readonly SqlValue[]): SqlRunResult => {
    const r = prep(sql).run(...bind(params));
    const out: SqlRunResult = { changes: r.changes };
    if (INSERT_RE.test(sql) && r.changes > 0) out.lastInsertRowid = Number(r.lastInsertRowid);
    return out;
  };
  const batchSync = (statements: readonly SqlStatement[]): void => {
    for (const s of statements) prep(s.sql).run(...bind(s.params));
  };

  /** Runs `fn` at once when nothing is queued or the caller is inside the open transaction; otherwise after the queue. */
  const gated = <T>(fn: () => T): Promise<T> => {
    const store = als.getStore();
    if (pending === 0 || (store !== undefined && store === current && store.open)) {
      return settle(fn);
    }
    return enqueue(() => settle(fn));
  };

  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    pending++;
    const run = tail.then(fn);
    tail = run.then(
      () => {
        pending--;
      },
      () => {
        pending--;
      },
    );
    return run;
  };

  const runTransaction = <T>(body: (tx: SqlTx) => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      try {
        conn.exec('BEGIN IMMEDIATE');
      } catch (err) {
        reject(err);
        return;
      }
      const ctx: TxContext = { open: true };
      current = ctx;
      setServiceTxOpen(true);

      const close = (): void => {
        ctx.open = false;
        if (current === ctx) current = null;
        setServiceTxOpen(false);
        clearImmediate(watchdog);
      };
      const rollback = (): void => {
        try {
          if (conn.inTransaction) conn.exec('ROLLBACK');
        } catch {
          // Nothing more to do: the transaction is being abandoned anyway.
        }
      };

      const watchdog = setImmediate(() => {
        if (!ctx.open) return;
        rollback();
        close();
        reject(
          codedError(
            SQL_TX_AWAITED_NON_DB,
            'A SqlDb transaction body may only await tx calls; it awaited something else, so the transaction was rolled back.',
          ),
        );
      });

      const lateCall = <R>(): Promise<R> =>
        Promise.reject(
          codedError(
            SQL_TX_AWAITED_NON_DB,
            'A SqlDb transaction body may only await tx calls; this tx is no longer open.',
          ),
        );
      const live = <R>(fn: () => R): Promise<R> => (ctx.open ? settle(fn) : lateCall<R>());

      const tx: SqlTx = {
        all: (sql, params) => live(() => allSync(sql, params)),
        get: (sql, params) => live(() => getSync(sql, params)),
        run: (sql, params) => live(() => runSync(sql, params)),
        batch: (statements) => live(() => batchSync(statements)),
      };

      const onSuccess = (value: T): void => {
        if (!ctx.open) return;
        try {
          conn.exec('COMMIT');
        } catch (err) {
          rollback();
          close();
          reject(err);
          return;
        }
        close();
        resolve(value);
      };
      const onFailure = (err: unknown): void => {
        if (!ctx.open) return;
        rollback();
        close();
        reject(err);
      };

      als.run(ctx, () => {
        let result: Promise<T>;
        try {
          result = Promise.resolve(body(tx));
        } catch (err) {
          result = Promise.reject(err);
        }
        result.then(onSuccess, onFailure);
      });
    });

  return {
    all: (sql, params) => gated(() => allSync(sql, params)),
    get: (sql, params) => gated(() => getSync(sql, params)),
    run: (sql, params) => gated(() => runSync(sql, params)),
    exec: (sql) =>
      gated(() => {
        conn.exec(sql);
      }),
    batch: (statements) =>
      gated(() => {
        if (conn.inTransaction) batchSync(statements);
        else conn.transaction(() => batchSync(statements))();
      }),
    transaction: (body) => {
      const store = als.getStore();
      if (store !== undefined && store === current && store.open) {
        return Promise.reject(
          codedError(
            SQL_TX_NESTED,
            'SqlDb transactions do not nest: transaction() was called from inside a transaction body.',
          ),
        );
      }
      return enqueue(() => runTransaction(body));
    },
  };
}
