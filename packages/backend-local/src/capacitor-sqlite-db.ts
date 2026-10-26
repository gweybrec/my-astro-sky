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
 * The rule that a transaction body may only await `tx` calls is enforced like the server's
 * adapter does, without `AsyncLocalStorage`: when the body starts and whenever its last `tx` call
 * settles, a timer of 0 ms is set. A body that keeps the rule has, by the time it fires (after
 * every pending microtask), either started another `tx` call or settled. If it has done neither,
 * it is awaiting something else:
 * - when calls joined the lock queue since then, they came from the body (calls on the outer
 *   `SqlDb`, or `transaction()` inside the body): they are rejected with `SQL_TX_OUTER_CALL` or
 *   `SQL_TX_NESTED` without running, and the body decides what to do with the rejection;
 * - otherwise the transaction is rolled back at once and rejects with `SQL_TX_AWAITED_NON_DB`;
 *   its `tx` calls are refused from then on.
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
  /** The body has settled: COMMIT or ROLLBACK follows, nothing more to watch. */
  bodyDone: boolean;
  inFlight: number;
  /** Counts the `tx` calls that settled, so a watchdog set before the latest one does nothing. */
  settled: number;
  /** Rolls the transaction back and rejects it (set when the body starts). */
  abandon: (err: Error) => void;
}

interface Waiter {
  cancelled: boolean;
  grant: (release: () => void) => void;
  refuse: () => void;
  /** The transaction that held the lock, idle, when this call joined the queue. */
  idleOf: OpenTx | null;
  idleAt: number;
}

export function createCapacitorSqliteDb(conn: CapacitorSqliteConnection): SqlDb {
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
      locked = true;
      waiter.grant(release);
    }
  };
  const release = (): void => {
    locked = false;
    holder = null;
    next();
  };

  const acquire = (rejectCode: string, message: string): Promise<() => void> =>
    new Promise((resolve, reject) => {
      if (!locked && queue.length === 0) {
        locked = true;
        resolve(release);
        return;
      }
      const h = holder;
      const idle = h !== null && h.open && !h.bodyDone && h.inFlight === 0;
      queue.push({
        cancelled: false,
        grant: resolve,
        refuse: () => reject(codedError(rejectCode, message)),
        idleOf: idle ? h : null,
        idleAt: idle ? h.settled : -1,
      });
    });

  /** Checks, after every pending microtask, that the body started a `tx` call or settled. */
  const watch = (state: OpenTx): void => {
    const at = state.settled;
    setTimeout(() => {
      if (!state.open || state.bodyDone || state.inFlight > 0 || state.settled !== at) return;
      const fromBody = queue.filter((w) => !w.cancelled && w.idleOf === state && w.idleAt === at);
      if (fromBody.length > 0) {
        for (const w of fromBody) {
          w.cancelled = true;
          w.refuse();
        }
        // The body now reacts to the rejections; watch it again.
        state.settled++;
        watch(state);
        return;
      }
      state.abandon(
        codedError(
          SQL_TX_AWAITED_NON_DB,
          'A SqlDb transaction body may only await tx calls; it awaited something else, so the transaction was rolled back.',
        ),
      );
    }, 0);
  };

  /** Runs `fn` with the lock held. */
  const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    await ready;
    const done = await acquire(
      SQL_TX_OUTER_CALL,
      'A call on the outer SqlDb was made from inside a transaction body; use tx.',
    );
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
  /**
   * The plugin joins the lines of each statement with a space and cuts each line at "--", quotes
   * or not, so a string literal in an `exec` script must not hold a newline or "--" (schema
   * scripts hold neither). Joining the lines here as well keeps a ";" + newline inside a literal
   * from being taken for the end of a statement.
   */
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
        state.settled++;
        if (state.inFlight === 0) watch(state);
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
      const done = await acquire(
        SQL_TX_NESTED,
        'transaction() was called from inside a transaction body; transactions do not nest.',
      );
      const state: OpenTx = {
        open: false,
        bodyDone: false,
        inFlight: 0,
        settled: 0,
        abandon: () => {},
      };
      try {
        checkReady();
        await begin();
        state.open = true;
        holder = state;
        let value: T;
        try {
          // The first of the body settling and the watchdog abandoning the transaction wins.
          value = await new Promise<T>((resolve, reject) => {
            state.abandon = (err) => {
              state.open = false;
              reject(err);
            };
            let result: Promise<T>;
            try {
              result = Promise.resolve(body(makeTx(state)));
            } catch (err) {
              result = Promise.reject(err);
            }
            result.then(
              (v) => {
                state.bodyDone = true;
                resolve(v);
              },
              (err) => {
                state.bodyDone = true;
                reject(err);
              },
            );
            watch(state);
          });
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
