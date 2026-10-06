// @vitest-environment node
/**
 * The Capacitor SQLite adapter over a fake `@capacitor-community/sqlite` connection built on
 * better-sqlite3: every call answers asynchronously and has the plugin's result shapes, BLOB
 * encodings and quirks (an `executeSet` binds raw JSON, so a BLOB there fails).
 */
import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { SQL_TX_NESTED, SQL_TX_OUTER_CALL } from '@myastrosky/core/ports/sql-db';
import {
  createCapacitorSqliteDb,
  splitStatements,
  type CapacitorSqliteChanges,
  type CapacitorSqliteConnection,
} from '@myastrosky/backend-local/capacitor-sqlite-db';
import { describeSqlDbConformance } from '../helpers/sql-db-conformance';

const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

type Call = { method: string; args: unknown[] };

interface FakeConnection extends CapacitorSqliteConnection {
  calls: Call[];
  raw: Database.Database;
}

function plugBind(values: unknown[] | undefined): unknown[] {
  return (values ?? []).map((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'object' && (v as { type?: string }).type === 'Buffer') {
      return Buffer.from((v as unknown as { data: number[] }).data);
    }
    return v;
  });
}

/** Mimics the plugin: asynchronous, string rejections, BLOBs out as arrays of byte values. */
function createFakeConnection(): FakeConnection {
  const raw = new Database(':memory:');
  const calls: Call[] = [];
  const record = async (method: string, ...args: unknown[]): Promise<void> => {
    calls.push({ method, args });
    await tick();
  };
  const reject = (err: unknown): never => {
    throw (err as Error).message;
  };
  const runOne = (sql: string, values: unknown[]): CapacitorSqliteChanges => {
    const r = raw.prepare(sql).run(...values);
    return { changes: { changes: r.changes, lastId: Number(r.lastInsertRowid) } };
  };
  return {
    calls,
    raw,
    async query(statement, values) {
      await record('query', statement, values);
      try {
        const rows = raw.prepare(statement).all(...plugBind(values)) as Record<string, unknown>[];
        return {
          values: rows.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([k, v]) => [k, Buffer.isBuffer(v) ? Array.from(v) : v]),
            ),
          ),
        };
      } catch (err) {
        return reject(err);
      }
    },
    async run(statement, values, transaction) {
      await record('run', statement, values, transaction);
      try {
        if (transaction) raw.exec('BEGIN');
        const res = runOne(statement, plugBind(values));
        if (transaction) raw.exec('COMMIT');
        return res;
      } catch (err) {
        if (raw.inTransaction && transaction) raw.exec('ROLLBACK');
        return reject(err);
      }
    },
    async execute(statements, transaction) {
      await record('execute', statements, transaction);
      try {
        // The plugin splits at a semicolon plus newline; a piece holding two statements is not
        // run whole (better-sqlite3 refuses it, the plugin silently drops the second).
        for (const piece of statements.split(';\n')) {
          const one = piece.trim().replace(/;$/, '');
          if (one) raw.prepare(one).run();
        }
        return {};
      } catch (err) {
        return reject(err);
      }
    },
    async executeSet(set, transaction) {
      await record('executeSet', set, transaction);
      try {
        if (transaction) raw.exec('BEGIN');
        let last: CapacitorSqliteChanges = {};
        for (const s of set) {
          for (const v of s.values) {
            if (v !== null && typeof v === 'object') throw new Error('Object not implemented');
          }
          last = runOne(s.statement, s.values);
        }
        if (transaction) raw.exec('COMMIT');
        return last;
      } catch (err) {
        if (raw.inTransaction && transaction) raw.exec('ROLLBACK');
        return reject(err);
      }
    },
    async beginTransaction() {
      await record('beginTransaction');
      try {
        raw.exec('BEGIN');
      } catch (err) {
        reject(err);
      }
      return {};
    },
    async commitTransaction() {
      await record('commitTransaction');
      try {
        raw.exec('COMMIT');
      } catch (err) {
        reject(err);
      }
      return {};
    },
    async rollbackTransaction() {
      await record('rollbackTransaction');
      try {
        raw.exec('ROLLBACK');
      } catch (err) {
        reject(err);
      }
      return {};
    },
  };
}

// The lock timeout is short so the two "called from inside a body" cases are quick.
describeSqlDbConformance('Capacitor SQLite adapter over a fake plugin', async () => {
  const conn = createFakeConnection();
  return {
    db: createCapacitorSqliteDb(conn, { lockTimeoutMs: 40 }),
    close: async () => {
      conn.raw.close();
    },
  };
});

describe('createCapacitorSqliteDb (specific to the Capacitor adapter)', () => {
  const setup = async (lockTimeoutMs = 40) => {
    const conn = createFakeConnection();
    const db = createCapacitorSqliteDb(conn, { lockTimeoutMs });
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, data BLOB)');
    conn.calls.length = 0;
    return { conn, db };
  };
  const methods = (conn: FakeConnection): string[] => conn.calls.map((c) => c.method);

  it('turns foreign keys on before the first call', async () => {
    const conn = createFakeConnection();
    const db = createCapacitorSqliteDb(conn);
    await db.exec('CREATE TABLE x (id INTEGER)');
    expect(conn.calls[0]).toEqual({
      method: 'execute',
      args: ['PRAGMA foreign_keys = ON', false],
    });
  });

  it('exec hands the plugin one statement per line, even for a one-line script', async () => {
    const { conn, db } = await setup();
    await db.exec("INSERT INTO t (name) VALUES ('a;b'); INSERT INTO t (name) VALUES ('c') ;");
    expect(conn.calls[0].args[0]).toBe(
      "INSERT INTO t (name) VALUES ('a;b');\nINSERT INTO t (name) VALUES ('c');\n",
    );
    expect(await db.all('SELECT name FROM t ORDER BY id')).toEqual([
      { name: 'a;b' },
      { name: 'c' },
    ]);
  });

  it('splitStatements ignores semicolons in strings and comments', () => {
    expect(splitStatements('SELECT \'x;y\'; -- one; two\n SELECT 2 /* a;b */; "q;"\n')).toEqual([
      "SELECT 'x;y'",
      'SELECT 2',
      '"q;"',
    ]);
  });

  it('never lets the plugin wrap run, query or execute in its own transaction', async () => {
    const { conn, db } = await setup();
    await db.run('INSERT INTO t (name) VALUES (?)', ['a']);
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (name) VALUES (?)', ['b']);
      await tx.batch([{ sql: 'INSERT INTO t (name) VALUES (?)', params: ['c'] }]);
    });
    for (const c of conn.calls) {
      if (c.method === 'run') expect(c.args[2]).toBe(false);
      if (c.method === 'executeSet' || c.method === 'execute') {
        // Only the one-hop batch outside a transaction may use the plugin's own transaction.
        expect(c.args[1]).toBe(false);
      }
    }
  });

  it('a batch of 50 statements is exactly one executeSet call', async () => {
    const { conn, db } = await setup();
    const statements = Array.from({ length: 50 }, (_, i) => ({
      sql: 'INSERT INTO t (name) VALUES (?)',
      params: [`n${i}`],
    }));
    await db.batch(statements);
    expect(methods(conn)).toEqual(['executeSet']);
    expect((conn.calls[0].args[0] as unknown[]).length).toBe(50);
    expect((await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM t'))!.c).toBe(50);
  });

  it('a batch inside a transaction is one executeSet call with the plugin transaction off', async () => {
    const { conn, db } = await setup();
    await db.transaction(async (tx) => {
      await tx.batch([
        { sql: 'INSERT INTO t (name) VALUES (?)', params: ['a'] },
        { sql: 'INSERT INTO t (name) VALUES (?)', params: ['b'] },
      ]);
    });
    expect(methods(conn)).toEqual(['beginTransaction', 'executeSet', 'commitTransaction']);
    expect(conn.calls[1].args[1]).toBe(false);
  });

  it('an empty batch makes no call', async () => {
    const { conn, db } = await setup();
    await db.batch([]);
    expect(conn.calls).toEqual([]);
  });

  it('a batch holding a Uint8Array falls back to one run per statement inside a transaction', async () => {
    const { conn, db } = await setup();
    await db.batch([
      { sql: 'INSERT INTO t (name, data) VALUES (?, ?)', params: ['a', new Uint8Array([1, 2, 3])] },
      { sql: 'INSERT INTO t (name) VALUES (?)', params: ['b'] },
    ]);
    expect(methods(conn)).toEqual(['beginTransaction', 'run', 'run', 'commitTransaction']);
    const row = await db.get<{ data: Uint8Array }>('SELECT data FROM t WHERE name = ?', ['a']);
    expect(Array.from(row!.data)).toEqual([1, 2, 3]);
  });

  it('a failing blob batch is rolled back', async () => {
    const { conn, db } = await setup();
    await expect(
      db.batch([
        { sql: 'INSERT INTO t (name, data) VALUES (?, ?)', params: ['a', new Uint8Array([1])] },
        { sql: 'INSERT INTO nope VALUES (1)' },
      ]),
    ).rejects.toThrow();
    expect(methods(conn)).toContain('rollbackTransaction');
    expect((await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM t'))!.c).toBe(0);
  });

  it('rejects with Error objects even though the plugin rejects with strings', async () => {
    const { db } = await setup();
    const err = await db.run('INSERT INTO nope VALUES (1)').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).toContain('nope');
  });

  it('the lock: a plain call waits for a running transaction and runs after it', async () => {
    const { conn, db } = await setup();
    const order: string[] = [];
    const tx = db.transaction(async (t) => {
      await t.run('INSERT INTO t (name) VALUES (?)', ['a']);
      await sleep(5);
      await t.run('INSERT INTO t (name) VALUES (?)', ['b']);
      order.push('tx');
    });
    const plain = db.get('SELECT COUNT(*) AS c FROM t').then((r) => {
      order.push('plain');
      return r;
    });
    expect(await plain).toEqual({ c: 2 });
    await tx;
    expect(order).toEqual(['tx', 'plain']);
    // The plain query came after the commit.
    const ms = methods(conn);
    expect(ms.indexOf('commitTransaction')).toBeLessThan(ms.lastIndexOf('query'));
  });

  it('a waiter behind a busy transaction does not time out', async () => {
    const { db } = await setup(60);
    const tx = db.transaction(async (t) => {
      for (let i = 0; i < 12; i++) {
        await t.run('INSERT INTO t (name) VALUES (?)', [`n${i}`]);
        await sleep(15);
      }
    });
    // Waits about 180 ms, three times the timeout, but the transaction keeps working.
    const waiter = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM t');
    expect(await waiter).toEqual({ c: 12 });
    await tx;
  });

  it('times out a call made on the outer db from inside a body', async () => {
    const { db } = await setup(30);
    const started = Date.now();
    let outer: unknown;
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (name) VALUES (?)', ['in']);
      await db.run('INSERT INTO t (name) VALUES (?)', ['out']).catch((e) => (outer = e));
    });
    expect((outer as { code?: string }).code).toBe(SQL_TX_OUTER_CALL);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    // The cancelled waiter does not block the lock afterwards.
    expect(await db.all('SELECT name FROM t')).toEqual([{ name: 'in' }]);
  });

  it('times out a nested transaction() with SQL_TX_NESTED and rolls back when the body propagates it', async () => {
    const { db } = await setup(30);
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (name) VALUES (?)', ['in']);
        await db.transaction(async () => {});
      }),
    ).rejects.toMatchObject({ code: SQL_TX_NESTED });
    expect(await db.all('SELECT name FROM t')).toEqual([]);
  });

  it('a tx used after its transaction closed is rejected', async () => {
    const { db } = await setup();
    let leaked: Parameters<Parameters<typeof db.transaction>[0]>[0] | undefined;
    await db.transaction(async (tx) => {
      leaked = tx;
    });
    await expect(leaked!.get('SELECT 1')).rejects.toMatchObject({ code: 'SQL_TX_AWAITED_NON_DB' });
  });

  it('reports a failure of the opening PRAGMA on the first call', async () => {
    const conn = createFakeConnection();
    conn.execute = () => Promise.reject('disk I/O error');
    const db = createCapacitorSqliteDb(conn);
    await expect(db.get('SELECT 1')).rejects.toThrow('disk I/O error');
  });
});
