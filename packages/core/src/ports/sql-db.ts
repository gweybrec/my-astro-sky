/**
 * The SQL port: services shared by the desktop server and the phone talk to SQLite
 * through this small asynchronous interface. Adapters live outside core
 * (`server/sqlite-adapter.ts` for better-sqlite3).
 */

/** A value that can be bound to a statement parameter or read from a column. */
export type SqlValue = string | number | null | Uint8Array;

export interface SqlRunResult {
  /** Rows changed by the statement. */
  changes: number;
  /** Row id of the last inserted row, when the statement inserted one. */
  lastInsertRowid?: number;
}

/** One statement of a `batch`. */
export interface SqlStatement {
  sql: string;
  params?: readonly SqlValue[];
}

/** What a transaction body may use. */
export interface SqlTx {
  /** Runs a query and returns every row. */
  all<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Runs a query and returns the first row, or `undefined` when there is none. */
  get<T = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<T | undefined>;
  /** Runs one statement that changes data. */
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
   * Inside `body`, calls on the outer `SqlDb` are rejected: pass `tx` to the code that needs the database.
   * A function that must work both inside and outside a transaction takes a `SqlTx` parameter (`SqlDb` is one).
   */
  transaction<T>(body: (tx: SqlTx) => Promise<T>): Promise<T>;
}

/** Error codes the adapters use. */
/** A transaction body awaited something other than a `tx` call. */
export const SQL_TX_AWAITED_NON_DB = 'SQL_TX_AWAITED_NON_DB';
/** `transaction` was called from inside a transaction body. */
export const SQL_TX_NESTED = 'SQL_TX_NESTED';
/** Old synchronous database code ran while a service transaction was open. */
export const SQL_LEGACY_CALL_IN_TX = 'SQL_LEGACY_CALL_IN_TX';
/** A call was made on the outer `SqlDb` from inside a transaction body; use `tx`. */
export const SQL_TX_OUTER_CALL = 'SQL_TX_OUTER_CALL';
