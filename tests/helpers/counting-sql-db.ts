/**
 * A `SqlDb` test double that counts round trips. On the phone every database call crosses a bridge
 * (about 35 ms), so a service method's number of calls is part of its contract.
 *
 * Counting rule: `all`, `get`, `run`, `exec` and `batch` on the outer object count 1 each. A whole
 * `transaction` counts 1 for its begin, 1 per `tx` call inside it, and 1 for its commit (or rollback).
 */
import type { SqlDb, SqlTx } from '@myastrosky/core/ports/sql-db';

export interface CountingSqlDb extends SqlDb {
  /** Round trips made since creation or the last `reset()`. */
  calls(): number;
  reset(): void;
}

export function countingSqlDb(inner: SqlDb): CountingSqlDb {
  let count = 0;
  const bump = (): void => {
    count++;
  };

  const countedTx = (tx: SqlTx): SqlTx => ({
    all: (sql, params) => (bump(), tx.all(sql, params)),
    get: (sql, params) => (bump(), tx.get(sql, params)),
    run: (sql, params) => (bump(), tx.run(sql, params)),
    batch: (statements) => (bump(), tx.batch(statements)),
  });

  return {
    all: (sql, params) => (bump(), inner.all(sql, params)),
    get: (sql, params) => (bump(), inner.get(sql, params)),
    run: (sql, params) => (bump(), inner.run(sql, params)),
    exec: (sql) => (bump(), inner.exec(sql)),
    batch: (statements) => (bump(), inner.batch(statements)),
    transaction: async (body) => {
      bump(); // begin
      try {
        return await inner.transaction((tx) => body(countedTx(tx)));
      } finally {
        bump(); // commit or rollback
      }
    },
    calls: () => count,
    reset: () => {
      count = 0;
    },
  };
}
