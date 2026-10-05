/**
 * The contract every `SqlDb` adapter must meet. Call `describeSqlDbConformance` from a test file
 * with a function that opens a fresh, empty, in-memory database. Every case creates its own tables.
 * Cases about one adapter's internals (a watchdog, a statement cache) do not belong here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSchema, SCHEMA_VERSION } from '@myastrosky/core/db/schema';
import { SQL_TX_NESTED, SQL_TX_OUTER_CALL } from '@myastrosky/core/ports/sql-db';
import type { SqlDb, SqlTx } from '@myastrosky/core/ports/sql-db';

export interface OpenedSqlDb {
  db: SqlDb;
  close: () => Promise<void>;
}

const T_DDL =
  'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, n INTEGER, data BLOB)';

export function describeSqlDbConformance(name: string, open: () => Promise<OpenedSqlDb>): void {
  describe(`SqlDb conformance: ${name}`, () => {
    let db: SqlDb;
    let close: () => Promise<void>;

    beforeEach(async () => {
      ({ db, close } = await open());
    });
    afterEach(async () => {
      await close();
    });

    const count = async (): Promise<number> =>
      (await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM t'))!.c;

    it('run / get / all / exec, changes and lastInsertRowid', async () => {
      await db.exec(T_DDL);
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

    it('round-trips strings, numbers, null and Uint8Array', async () => {
      await db.exec(T_DDL);
      const bytes = new Uint8Array([0, 1, 2, 255, 128]);
      // A view over a larger buffer: only the viewed bytes must be bound.
      const big = new Uint8Array([9, 9, 0, 1, 2, 255, 128, 9]);
      await db.run('INSERT INTO t (name, data) VALUES (?, ?)', [null, bytes]);
      await db.run('INSERT INTO t (name, n, data) VALUES (?, ?, ?)', ['v', 7, big.subarray(2, 7)]);
      const rows = await db.all<{ name: string | null; n: number | null; data: Uint8Array }>(
        'SELECT name, n, data FROM t ORDER BY id',
      );
      expect(rows[0].name).toBeNull();
      expect(rows[0].n).toBeNull();
      expect(Array.from(rows[0].data)).toEqual(Array.from(bytes));
      expect(rows[1].name).toBe('v');
      expect(rows[1].n).toBe(7);
      expect(Array.from(rows[1].data)).toEqual(Array.from(bytes));
      expect(await db.get('SELECT 1 AS x WHERE ? IS NULL', [null])).toEqual({ x: 1 });
    });

    it('batch is all-or-nothing outside a transaction', async () => {
      await db.exec(T_DDL);
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

    it('a transaction commits and returns the body value', async () => {
      await db.exec(T_DDL);
      const value = await db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (name) VALUES (?)', ['a']);
        const row = await tx.get<{ name: string }>('SELECT name FROM t');
        await tx.batch([{ sql: 'INSERT INTO t (name) VALUES (?)', params: ['b'] }]);
        return row!.name;
      });
      expect(value).toBe('a');
      expect(await count()).toBe(2);
    });

    it('a transaction rolls back and rethrows when the body throws', async () => {
      await db.exec(T_DDL);
      await db.run('INSERT INTO t (name) VALUES (?)', ['kept']);
      const boom = new Error('boom');
      await expect(
        db.transaction(async (tx) => {
          await tx.run('INSERT INTO t (name) VALUES (?)', ['c']);
          throw boom;
        }),
      ).rejects.toBe(boom);
      expect(await count()).toBe(1);
      // The adapter is usable again.
      await db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (name) VALUES (?)', ['ok']);
      });
      expect(await count()).toBe(2);
    });

    it('a failing batch inside a transaction rolls the whole transaction back', async () => {
      await db.exec(T_DDL);
      await expect(
        db.transaction(async (tx) => {
          await tx.run('INSERT INTO t (name) VALUES (?)', ['a']);
          await tx.batch([
            { sql: 'INSERT INTO t (name) VALUES (?)', params: ['b'] },
            { sql: 'INSERT INTO nope VALUES (1)' },
          ]);
        }),
      ).rejects.toThrow();
      expect(await count()).toBe(0);
    });

    it('two transactions started together do not overlap', async () => {
      await db.exec(T_DDL);
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

    it('a nested transaction rejects with SQL_TX_NESTED; the outer one can commit', async () => {
      await db.exec(T_DDL);
      let nested: unknown;
      await db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (name) VALUES (?)', ['outer']);
        await db.transaction(async () => {}).catch((e) => (nested = e));
      });
      expect((nested as { code?: string }).code).toBe(SQL_TX_NESTED);
      expect(await count()).toBe(1);
    });

    it('a call on the outer SqlDb inside a body rejects with SQL_TX_OUTER_CALL', async () => {
      await db.exec(T_DDL);
      let outer: unknown;
      await db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (name) VALUES (?)', ['inside']);
        await db.run('INSERT INTO t (name) VALUES (?)', ['outer']).catch((e) => (outer = e));
        await db.get('SELECT 1').catch(() => {});
        await tx.run('INSERT INTO t (name) VALUES (?)', ['inside2']);
      });
      expect((outer as { code?: string }).code).toBe(SQL_TX_OUTER_CALL);
      const names = await db.all<{ name: string }>('SELECT name FROM t ORDER BY id');
      expect(names.map((r) => r.name)).toEqual(['inside', 'inside2']);
    });

    it('a function taking a SqlTx works with tx and with the outer SqlDb', async () => {
      await db.exec(T_DDL);
      const addRow = async (target: SqlTx, rowName: string): Promise<void> => {
        await target.run('INSERT INTO t (name) VALUES (?)', [rowName]);
      };
      await db.transaction(async (tx) => {
        await addRow(tx, 'via-tx');
      });
      await addRow(db, 'via-db');
      const names = await db.all<{ name: string }>('SELECT name FROM t ORDER BY id');
      expect(names.map((r) => r.name)).toEqual(['via-tx', 'via-db']);
    });

    it('initSchema builds the schema and foreign keys are enforced', async () => {
      expect(await initSchema(db)).toBe(SCHEMA_VERSION);
      expect(await db.get<{ version: number }>('SELECT version FROM schema_version')).toEqual({
        version: SCHEMA_VERSION,
      });
      // Running it again changes nothing.
      expect(await initSchema(db)).toBe(SCHEMA_VERSION);

      await db.exec(
        'CREATE TABLE parent (id TEXT PRIMARY KEY); CREATE TABLE child (id INTEGER PRIMARY KEY, pid TEXT NOT NULL REFERENCES parent(id) ON DELETE CASCADE)',
      );
      await expect(db.run('INSERT INTO child (pid) VALUES (?)', ['missing'])).rejects.toThrow();
      await db.run('INSERT INTO parent (id) VALUES (?)', ['p']);
      await db.run('INSERT INTO child (pid) VALUES (?)', ['p']);
      await db.run('DELETE FROM parent WHERE id = ?', ['p']);
      expect(await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM child')).toEqual({ c: 0 });
    });
  });
}
