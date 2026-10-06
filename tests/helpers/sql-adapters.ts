import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { createAsyncSqlDb } from './async-sql-db';

/** The adapters a service test runs on: the better-sqlite3 one as it is, and the same wrapped to be really asynchronous. */
export const SQL_ADAPTERS: readonly (readonly [string, (db: SqlDb) => SqlDb])[] = [
  ['better-sqlite3', (db) => db],
  ['asynchronous', createAsyncSqlDb],
];
