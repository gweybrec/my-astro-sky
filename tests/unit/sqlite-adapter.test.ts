// @vitest-environment node
/**
 * The `SqlDb` port on better-sqlite3 (WP2.1): plain calls, atomic batches, the transaction rule
 * (a body may only await `tx` calls).
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQL_TX_AWAITED_NON_DB } from '@myastrosky/core/ports/sql-db';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { describeSqlDbConformance } from '../helpers/sql-db-conformance';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describeSqlDbConformance('better-sqlite3 adapter', async () => {
  const conn = new Database(':memory:');
  return {
    db: createBetterSqliteDb(conn),
    close: async () => {
      conn.close();
    },
  };
});

describe('createBetterSqliteDb (specific to better-sqlite3)', () => {
  let conn: Database.Database;
  let db: SqlDb;

  beforeEach(async () => {
    conn = new Database(':memory:');
    db = createBetterSqliteDb(conn);
    await db.exec(
      'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, n INTEGER, data BLOB)',
    );
  });
  afterEach(() => conn.close());

  const count = async () => (await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM t'))!.c;

  it('e. a body that awaits a timer is rolled back with SQL_TX_AWAITED_NON_DB', async () => {
    let lateError: unknown;
    const p = db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (name) VALUES (?)', ['a']);
      await sleep(5);
      try {
        await tx.run('INSERT INTO t (name) VALUES (?)', ['b']);
      } catch (e) {
        lateError = e;
        throw e;
      }
    });
    await expect(p).rejects.toMatchObject({ code: SQL_TX_AWAITED_NON_DB });
    await expect(p).rejects.toThrow(/only await tx calls/);
    await sleep(10);
    expect((lateError as { code?: string }).code).toBe(SQL_TX_AWAITED_NON_DB);
    expect(conn.inTransaction).toBe(false);
    expect(await count()).toBe(0);
    // The adapter is usable again.
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (name) VALUES (?)', ['ok']);
    });
    expect(await count()).toBe(1);
  });

  it('j. an outer call after the body awaited a timer rejects with SQL_TX_AWAITED_NON_DB', async () => {
    let late: unknown;
    const p = db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (name) VALUES (?)', ['a']);
      await sleep(5);
      try {
        await db.run('INSERT INTO t (name) VALUES (?)', ['late']);
      } catch (e) {
        late = e;
        throw e;
      }
    });
    await expect(p).rejects.toMatchObject({ code: SQL_TX_AWAITED_NON_DB });
    await sleep(10);
    expect((late as { code?: string }).code).toBe(SQL_TX_AWAITED_NON_DB);
    expect(conn.inTransaction).toBe(false);
    expect(await count()).toBe(0);
  });

  it('l. 250 different SQL texts in a row all work (statement cache cap)', async () => {
    for (let i = 0; i < 250; i++) {
      const row = await db.get<{ v: number }>(`SELECT ${i} AS v`);
      expect(row).toEqual({ v: i });
    }
    // The oldest texts were dropped from the cache and are prepared again.
    expect(await db.get<{ v: number }>('SELECT 0 AS v')).toEqual({ v: 0 });
  });
});
