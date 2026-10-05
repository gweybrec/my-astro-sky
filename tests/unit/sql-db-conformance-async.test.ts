// @vitest-environment node
/**
 * The SqlDb conformance suite on a test-only adapter whose every call is really asynchronous and
 * whose transactions hold a real lock across the gaps: the behaviour the phone adapter will have.
 */
import Database from 'better-sqlite3';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { createAsyncSqlDb } from '../helpers/async-sql-db';
import { describeSqlDbConformance } from '../helpers/sql-db-conformance';

describeSqlDbConformance('asynchronous test adapter', async () => {
  const conn = new Database(':memory:');
  return {
    db: createAsyncSqlDb(createBetterSqliteDb(conn)),
    close: async () => {
      conn.close();
    },
  };
});
