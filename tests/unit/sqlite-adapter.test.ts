// @vitest-environment node
/**
 * The `SqlDb` port on better-sqlite3 (WP2.1): plain calls, atomic batches, the transaction rule
 * (a body may only await `tx` calls) and the guard that stops old synchronous db.ts code from
 * running inside a service transaction.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SQL_LEGACY_CALL_IN_TX,
  SQL_TX_AWAITED_NON_DB,
  SQL_TX_NESTED,
} from '@myastrosky/core/ports/sql-db';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('createBetterSqliteDb', () => {
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

  it('a. run / get / all / exec', async () => {
    const r1 = await db.run('INSERT INTO t (name, n) VALUES (?, ?)', ['a', 1]);
    expect(r1).toEqual({ changes: 1, lastInsertRowid: 1 });
    const r2 = await db.run('INSERT INTO t (name, n) VALUES (?, ?)', ['b', 2]);
    expect(r2.lastInsertRowid).toBe(2);
    const upd = await db.run('UPDATE t SET n = n + 10');
    expect(upd.changes).toBe(2);
    expect(upd.lastInsertRowid).toBeUndefined();
    expect(await db.get<{ name: string }>('SELECT name FROM t WHERE id = ?', [2])).toEqual({
      name: 'b',
    });
    expect(await db.get('SELECT * FROM t WHERE id = ?', [99])).toBeUndefined();
    const rows = await db.all<{ name: string; n: number }>('SELECT name, n FROM t ORDER BY id');
    expect(rows).toEqual([
      { name: 'a', n: 11 },
      { name: 'b', n: 12 },
    ]);
    await db.exec("INSERT INTO t (name) VALUES ('x'); INSERT INTO t (name) VALUES ('y');");
    expect(await count()).toBe(4);
    await expect(db.run('INSERT INTO nope VALUES (1)')).rejects.toThrow();
  });

  it('b. null and Uint8Array binding', async () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128]);
    // A view over a larger buffer: only the viewed bytes must be bound.
    const big = new Uint8Array([9, 9, 0, 1, 2, 255, 128, 9]);
    await db.run('INSERT INTO t (name, data) VALUES (?, ?)', [null, bytes]);
    await db.run('INSERT INTO t (name, data) VALUES (?, ?)', ['v', big.subarray(2, 7)]);
    const rows = await db.all<{ name: string | null; data: Uint8Array }>(
      'SELECT name, data FROM t ORDER BY id',
    );
    expect(rows[0].name).toBeNull();
    expect(Array.from(rows[0].data)).toEqual(Array.from(bytes));
    expect(Array.from(rows[1].data)).toEqual(Array.from(bytes));
    expect(await db.get('SELECT 1 AS x WHERE ? IS NULL', [null])).toEqual({ x: 1 });
  });

  it('c. batch is atomic outside a transaction', async () => {
    await db.batch([
      { sql: 'INSERT INTO t (name) VALUES (?)', params: ['a'] },
      { sql: 'INSERT INTO t (name) VALUES (?)', params: ['b'] },
    ]);
    expect(await count()).toBe(2);
    await expect(
      db.batch([
        { sql: 'INSERT INTO t (name) VALUES (?)', params: ['c'] },
        { sql: 'INSERT INTO nope VALUES (1)' },
      ]),
    ).rejects.toThrow();
    expect(await count()).toBe(2);
  });

  it('d. transaction commits and returns the value; rolls back on a throw', async () => {
    const value = await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (name) VALUES (?)', ['a']);
      const row = await tx.get<{ name: string }>('SELECT name FROM t');
      await tx.batch([{ sql: 'INSERT INTO t (name) VALUES (?)', params: ['b'] }]);
      return row!.name;
    });
    expect(value).toBe('a');
    expect(await count()).toBe(2);

    const boom = new Error('boom');
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (name) VALUES (?)', ['c']);
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await count()).toBe(2);
    expect(conn.inTransaction).toBe(false);
  });

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

  it('f. concurrent transactions do not overlap', async () => {
    const log: string[] = [];
    const make = (label: string) =>
      db.transaction(async (tx) => {
        log.push(`${label}:start`);
        await tx.run('INSERT INTO t (name) VALUES (?)', [label]);
        await tx.get('SELECT 1');
        log.push(`${label}:end`);
        return label;
      });
    const results = await Promise.all([
      make('a'),
      make('b'),
      db.run('INSERT INTO t (name) VALUES (?)', ['plain']),
    ]);
    expect(results.slice(0, 2)).toEqual(['a', 'b']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    expect(await count()).toBe(3);
  });

  it('g. a nested transaction rejects with SQL_TX_NESTED; the outer one can commit', async () => {
    let nested: unknown;
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (name) VALUES (?)', ['outer']);
      await db.transaction(async () => {}).catch((e) => (nested = e));
    });
    expect((nested as { code?: string }).code).toBe(SQL_TX_NESTED);
    expect(await count()).toBe(1);
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
