/**
 * The phone's `SqlDb`: an adapter over a `@capacitor-community/sqlite` connection.
 *
 * Every plugin call is a real asynchronous bridge hop (about 35 ms), so:
 * - one promise-based lock serialises everything; a transaction holds it from BEGIN to
 *   COMMIT/ROLLBACK and every other call waits;
 * - `batch` is ONE `executeSet` call (about 0.3 ms per statement instead of 35 ms);
 * - the plugin's own `transaction` flag is passed as `false` and transactions are driven here,
 *   except for a `batch` made outside a transaction, which lets the plugin wrap its single
 *   `executeSet` call (one hop, atomic) because the lock guarantees no transaction is open.
 *
 * Calls on the outer `SqlDb` from inside a transaction body (and `transaction()` inside a body)
 * cannot be recognised without `AsyncLocalStorage`: they simply wait for the lock, which the body
 * holds while it awaits them. A waiter therefore gives up after `lockTimeoutMs` of the lock
 * holder (an open transaction) making no progress, and rejects with `SQL_TX_OUTER_CALL` (or
 * `SQL_TX_NESTED` for `transaction()`). The body then decides what to do with the rejection; if
 * it lets it propagate, the transaction rolls back. A legitimate waiter behind a busy
 * transaction does not time out, because the holder keeps making `tx` calls.
 *
 * BLOBs: the plugin returns a BLOB column as an array of byte values and accepts a bound BLOB as
 * `{ type: 'Buffer', data: number[] }` in `run` and `query`, but not in `executeSet`, which binds
 * raw JSON. A batch that contains a `Uint8Array` therefore runs its statements one by one inside
 * a transaction (slower, correct).
 */
import {
  SQL_TX_AWAITED_NON_DB,
  SQL_TX_NESTED,
  SQL_TX_OUTER_CALL,
  type SqlDb,
  type SqlRunResult,
  type SqlStatement,
  type SqlTx,
  type SqlValue,
} from '@myastrosky/core/ports/sql-db';

/** What the plugin returns for `run` and `executeSet`. */
export interface CapacitorSqliteChanges {
  changes?: { changes?: number; lastId?: number; values?: unknown[] };
}

/** What the plugin returns for `query`. */
export interface CapacitorSqliteValues {
  values?: unknown[];
}

/**
 * The methods of `@capacitor-community/sqlite`'s `SQLiteDBConnection` (v8) that the adapter uses.
 * The real connection is assignable to this interface.
 */
export interface CapacitorSqliteConnection {
  query(statement: string, values?: unknown[]): Promise<CapacitorSqliteValues>;
  run(
    statement: string,
    values?: unknown[],
    transaction?: boolean,
  ): Promise<CapacitorSqliteChanges>;
  execute(statements: string, transaction?: boolean): Promise<unknown>;
  executeSet(
    set: { statement: string; values: unknown[] }[],
    transaction?: boolean,
  ): Promise<CapacitorSqliteChanges>;
  beginTransaction(): Promise<unknown>;
  commitTransaction(): Promise<unknown>;
  rollbackTransaction(): Promise<unknown>;
}

export interface CapacitorSqliteDbOptions {
  /**
   * How long a call waiting for the lock tolerates a transaction that makes no progress before
   * it concludes it was made from inside that transaction's body. Default 10 000 ms.
   */
  lockTimeoutMs?: number;
}

function codedError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/** The plugin rejects with plain strings; the port promises `Error`s. */
function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  const message =
    typeof err === 'string'
      ? err
      : ((err as { message?: string } | null)?.message ?? JSON.stringify(err));
  return new Error(message);
}

/**
 * Splits a script into statements at the semicolons outside quotes and comments. The plugin's
 * `execute` splits its input only at ";" plus a newline and silently runs
 * just the first statement of anything else, so the adapter hands it one statement per line.
 * A trigger body (BEGIN ... END with inner semicolons) is not supported.
 */
export function splitStatements(script: string): string[] {
  const out: string[] = [];
  let current = '';
  let i = 0;
  while (i < script.length) {
    const ch = script[i];
    const two = script.slice(i, i + 2);
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < script.length) {
        if (script[j] === ch) {
          if (script[j + 1] === ch) j += 2;
          else break;
        } else j++;
      }
      current += script.slice(i, j + 1);
      i = j + 1;
    } else if (two === '--') {
      const end = script.indexOf('\n', i);
      i = end === -1 ? script.length : end;
    } else if (two === '/*') {
      const end = script.indexOf('*/', i + 2);
      i = end === -1 ? script.length : end + 2;
    } else if (ch === ';') {
      if (current.trim()) out.push(current.trim());
      current = '';
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const INSERT_RE = /^\s*(?:insert|replace)\b/i;
/**
 * Statements whose plugin count may include rows changed by foreign-key actions: the plugin
 * reports SQLite's total_changes difference, not the statement's own count. A plain INSERT cannot
 * trigger one, so it is not corrected.
 */
const MAY_CASCADE_RE = /^\s*(?:delete|update|replace|insert\s+or\s+replace)\b/i;

const isBytes = (p: SqlValue | undefined): p is Uint8Array => p instanceof Uint8Array;

/** Converts the port's parameters to what the plugin's `run` and `query` accept. */
function bind(params: readonly SqlValue[] | undefined): unknown[] {
  if (!params) return [];
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (isBytes(p)) return { type: 'Buffer', data: Array.from(p) };
    return p;
  });
}

/** Converts a row from the plugin: a BLOB column arrives as an array of byte values. */
function readRow<T>(row: unknown): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    out[key] = Array.isArray(value) ? Uint8Array.from(value as number[]) : value;
  }
  return out as T;
}

interface OpenTx {
  open: boolean;
  inFlight: number;
  lastActivity: number;
}

interface Waiter {
  cancelled: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  grant: (release: () => void) => void;
}

export function createCapacitorSqliteDb(
  conn: CapacitorSqliteConnection,
  options: CapacitorSqliteDbOptions = {},
): SqlDb {
  const lockTimeoutMs = options.lockTimeoutMs ?? 10_000;

  // The lock.
  let locked = false;
  const queue: Waiter[] = [];
  /** The transaction that holds the lock, if any. */
  let holder: OpenTx | null = null;

  const next = (): void => {
    while (!locked) {
      const waiter = queue.shift();
      if (!waiter) return;
      if (waiter.cancelled) continue;
      if (waiter.timer !== undefined) clearTimeout(waiter.timer);
      locked = true;
      waiter.grant(release);
    }
  };
  const release = (): void => {
    locked = false;
    holder = null;
    next();
  };

  const idleMs = (tx: OpenTx): number => (tx.inFlight > 0 ? 0 : Date.now() - tx.lastActivity);

  const acquire = (rejectCode: string, what: string): Promise<() => void> =>
    new Promise((resolve, reject) => {
      const waiter: Waiter = { cancelled: false, timer: undefined, grant: resolve };
      if (!locked && queue.length === 0) {
        locked = true;
        resolve(release);
        return;
      }
      const check = (): void => {
        if (waiter.cancelled) return;
        const h = holder;
        if (h && idleMs(h) >= lockTimeoutMs) {
          waiter.cancelled = true;
          reject(
            codedError(
              rejectCode,
              `${what} waited ${lockTimeoutMs} ms for a transaction that made no progress: it was most likely made from inside a transaction body (use tx; transactions do not nest).`,
            ),
          );
          return;
        }
        const wait = h ? Math.max(10, lockTimeoutMs - idleMs(h)) : lockTimeoutMs;
        waiter.timer = setTimeout(check, wait);
      };
      waiter.timer = setTimeout(check, lockTimeoutMs);
      queue.push(waiter);
    });

  /** Runs `fn` with the lock held. */
  const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    await ready;
    const done = await acquire(SQL_TX_OUTER_CALL, 'A SqlDb call');
    try {
      return await fn();
    } finally {
      done();
    }
  };

  // ---- plugin calls (no locking here) ----

  const doAll = async <T>(sql: string, params?: readonly SqlValue[]): Promise<T[]> => {
    try {
      const res = await conn.query(sql, bind(params));
      return (res.values ?? []).map((r) => readRow<T>(r));
    } catch (err) {
      throw toError(err);
    }
  };
  const doGet = async <T>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined> =>
    (await doAll<T>(sql, params))[0];
  const doRun = async (sql: string, params?: readonly SqlValue[]): Promise<SqlRunResult> => {
    let res: CapacitorSqliteChanges;
    try {
      res = await conn.run(sql, bind(params), false);
    } catch (err) {
      throw toError(err);
    }
    let changes = res.changes?.changes ?? 0;
    if (changes > 0 && MAY_CASCADE_RE.test(sql)) {
      // One more bridge hop, only when a cascade could have inflated the count.
      try {
        const own = await conn.query('SELECT changes() AS c');
        const c = (own.values?.[0] as { c?: unknown } | undefined)?.c;
        if (typeof c === 'number') changes = c;
      } catch (err) {
        throw toError(err);
      }
    }
    const out: SqlRunResult = { changes };
    const lastId = res.changes?.lastId;
    if (INSERT_RE.test(sql) && changes > 0 && lastId !== undefined) out.lastInsertRowid = lastId;
    return out;
  };
  const doExec = async (sql: string): Promise<void> => {
    try {
      const statements = splitStatements(sql).map((st) => st.replace(/\s*\n\s*/g, ' '));
      if (statements.length > 0) await conn.execute(statements.join(';\n') + ';\n', false);
    } catch (err) {
      throw toError(err);
    }
  };
  const hasBytes = (statements: readonly SqlStatement[]): boolean =>
    statements.some((s) => s.params?.some(isBytes));
  /** One `executeSet` call; `ownTransaction` lets the plugin wrap it (only when none is open). */
  const doExecuteSet = async (
    statements: readonly SqlStatement[],
    ownTransaction: boolean,
  ): Promise<void> => {
    if (statements.length === 0) return;
    try {
      await conn.executeSet(
        statements.map((s) => ({
          statement: s.sql,
          values: (s.params ?? []).map((p) => p ?? null),
        })),
        ownTransaction,
      );
    } catch (err) {
      throw toError(err);
    }
  };

  const begin = async (): Promise<void> => {
    try {
      await conn.beginTransaction();
    } catch (err) {
      throw toError(err);
    }
  };
  const commit = async (): Promise<void> => {
    try {
      await conn.commitTransaction();
    } catch (err) {
      throw toError(err);
    }
  };
  const rollback = async (): Promise<void> => {
    try {
      await conn.rollbackTransaction();
    } catch {
      // Nothing more to do: the transaction is being abandoned anyway.
    }
  };

  /** A batch inside an open transaction. */
  const batchInTx = async (statements: readonly SqlStatement[]): Promise<void> => {
    if (hasBytes(statements)) {
      for (const s of statements) await doRun(s.sql, s.params);
      return;
    }
    await doExecuteSet(statements, false);
  };

  // `PRAGMA foreign_keys = ON` runs before anything else, and a failure surfaces on the first call.
  let initError: Error | null = null;
  const ready: Promise<void> = conn.execute('PRAGMA foreign_keys = ON', false).then(
    () => undefined,
    (err) => {
      initError = toError(err);
    },
  );
  const checkReady = (): void => {
    if (initError) throw initError;
  };

  const plain = <T>(fn: () => Promise<T>): Promise<T> =>
    withLock(async () => {
      checkReady();
      return fn();
    });

  const makeTx = (state: OpenTx): SqlTx => {
    const live = async <T>(fn: () => Promise<T>): Promise<T> => {
      if (!state.open) {
        throw codedError(
          SQL_TX_AWAITED_NON_DB,
          'A SqlDb transaction body may only await tx calls; this tx is no longer open.',
        );
      }
      state.inFlight++;
      try {
        return await fn();
      } finally {
        state.inFlight--;
        state.lastActivity = Date.now();
      }
    };
    return {
      all: (sql, params) => live(() => doAll(sql, params)),
      get: (sql, params) => live(() => doGet(sql, params)),
      run: (sql, params) => live(() => doRun(sql, params)),
      batch: (statements) => live(() => batchInTx(statements)),
    };
  };

  return {
    all: (sql, params) => plain(() => doAll(sql, params)),
    get: (sql, params) => plain(() => doGet(sql, params)),
    run: (sql, params) => plain(() => doRun(sql, params)),
    exec: (sql) => plain(() => doExec(sql)),
    batch: (statements) =>
      plain(async () => {
        if (statements.length === 0) return;
        if (!hasBytes(statements)) {
          await doExecuteSet(statements, true);
          return;
        }
        await begin();
        try {
          for (const s of statements) await doRun(s.sql, s.params);
          await commit();
        } catch (err) {
          await rollback();
          throw err;
        }
      }),
    transaction: async <T>(body: (tx: SqlTx) => Promise<T>): Promise<T> => {
      await ready;
      const done = await acquire(SQL_TX_NESTED, 'transaction()');
      const state: OpenTx = { open: false, inFlight: 0, lastActivity: Date.now() };
      try {
        checkReady();
        await begin();
        state.open = true;
        state.lastActivity = Date.now();
        holder = state;
        let value: T;
        try {
          value = await body(makeTx(state));
          await commit();
        } catch (err) {
          state.open = false;
          await rollback();
          throw err;
        }
        state.open = false;
        return value;
      } finally {
        state.open = false;
        done();
      }
    },
  };
}
