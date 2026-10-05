// @vitest-environment node
/**
 * The `SqlDb` port on better-sqlite3 (WP2.1): plain calls, atomic batches, the transaction rule
 * (a body may only await `tx` calls) and the guard that stops old synchronous db.ts code from
 * running inside a service transaction.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SQL_LEGACY_CALL_IN_TX, SQL_TX_AWAITED_NON_DB } from '@myastrosky/core/ports/sql-db';
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

describe('legacy guard (server/db.ts)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DB_PATH', ':memory:');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('h. legacy calls throw inside a service transaction and work after it', async () => {
    // Import both after vi.resetModules() so they share one instance of the guard module.
    const dbModule = await import('../../server/db.js');
    const adapterModule = await import('../../server/sqlite-adapter.js');
    const conn = dbModule.getConnection();
    const sql = adapterModule.createBetterSqliteDb(conn);
    expect(dbModule.getSetting('x')).toBeUndefined();

    let inside: unknown;
    await sql.transaction(async (tx) => {
      await tx.run("INSERT INTO settings (key, value) VALUES ('adapter-test', '1')");
      try {
        dbModule.getSetting('x');
      } catch (e) {
        inside = e;
      }
    });
    expect((inside as { code?: string }).code).toBe(SQL_LEGACY_CALL_IN_TX);
    expect(dbModule.getSetting('adapter-test')).toBe('1');
    expect(dbModule.getSetting('x')).toBeUndefined();

    // A legacy write that sneaks in before the watchdog fires (here from a microtask, which Node
    // runs before any timer or immediate) throws, so it cannot join the doomed transaction.
    let legacy: unknown = 'not run';
    const p = sql.transaction(async (tx) => {
      await tx.run("INSERT INTO settings (key, value) VALUES ('rolled-back', '1')");
      await Promise.resolve().then(() => {
        try {
          dbModule.setSetting('legacy-write', '1');
          legacy = undefined;
        } catch (e) {
          legacy = e;
        }
      });
      await sleep(5);
    });
    await expect(p).rejects.toMatchObject({ code: SQL_TX_AWAITED_NON_DB });
    expect((legacy as { code?: string }).code).toBe(SQL_LEGACY_CALL_IN_TX);
    expect(dbModule.getSetting('rolled-back')).toBeUndefined();
    expect(dbModule.getSetting('legacy-write')).toBeUndefined();
    expect(conn.inTransaction).toBe(false);

    // A legacy write from a timer: the watchdog has already rolled back and closed the guard, so
    // the write succeeds on its own and is not part of the rolled-back transaction.
    const p2 = sql.transaction(async (tx) => {
      await tx.run("INSERT INTO settings (key, value) VALUES ('rolled-back-2', '1')");
      await sleep(5);
      dbModule.setSetting('timer-write', '1');
    });
    await expect(p2).rejects.toMatchObject({ code: SQL_TX_AWAITED_NON_DB });
    expect(dbModule.getSetting('rolled-back-2')).toBeUndefined();
    expect(conn.inTransaction).toBe(false);
    dbModule.closeDatabase();
  });
});
