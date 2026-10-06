/**
 * The contract every `SqlDb` adapter must meet, as plain data: a list of cases that need no test
 * runner (they throw on failure), so the same cases run under Vitest and inside the phone's WebView.
 * Each case opens its own fresh, empty, in-memory database and closes it afterwards, and creates
 * its own tables. Cases about one adapter's internals (a watchdog, a statement cache) do not
 * belong here.
 */
import { initSchema, SCHEMA_VERSION } from '../db/schema';
import { SQL_TX_NESTED, SQL_TX_OUTER_CALL } from '../ports/sql-db';
import type { SqlDb, SqlTx } from '../ports/sql-db';

export interface OpenedSqlDb {
  db: SqlDb;
  close: () => Promise<void>;
}

export interface SqlDbConformanceCase {
  name: string;
  run(open: () => Promise<OpenedSqlDb>): Promise<void>;
}

const T_DDL =
  'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, n INTEGER, data BLOB)';

function show(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Deep equality that, like Vitest's `toEqual`, ignores keys whose value is `undefined`. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

function fail(message: string): never {
  throw new Error(message);
}

function toEqual(actual: unknown, expected: unknown, what: string): void {
  if (!deepEqual(actual, expected)) {
    fail(`${what}: expected ${show(expected)}, got ${show(actual)}`);
  }
}

function toBe(actual: unknown, expected: unknown, what: string): void {
  if (!Object.is(actual, expected)) {
    fail(`${what}: expected ${show(expected)}, got ${show(actual)}`);
  }
}

/** Waits for `promise` to reject and returns the reason. */
async function rejection(promise: Promise<unknown>, what: string): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return fail(`${what}: expected a rejection, the promise resolved`);
}

const codeOf = (err: unknown): string | undefined => (err as { code?: string } | undefined)?.code;

/** Opens a database, runs `body`, and always closes the database. */
function withDb(name: string, body: (db: SqlDb) => Promise<void>): SqlDbConformanceCase {
  return {
    name,
    async run(open) {
      const { db, close } = await open();
      try {
        await body(db);
      } finally {
        await close();
      }
    },
  };
}

const count = async (db: SqlDb): Promise<number> =>
  (await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM t'))!.c;

export const sqlDbConformanceCases: SqlDbConformanceCase[] = [
  withDb('run / get / all / exec, changes and lastInsertRowid', async (db) => {
    await db.exec(T_DDL);
    const r1 = await db.run('INSERT INTO t (name, n) VALUES (?, ?)', ['a', 1]);
    toEqual(r1, { changes: 1, lastInsertRowid: 1 }, 'first insert');
    const r2 = await db.run('INSERT INTO t (name, n) VALUES (?, ?)', ['b', 2]);
    toBe(r2.lastInsertRowid, 2, 'second lastInsertRowid');
    const upd = await db.run('UPDATE t SET n = n + 10');
    toBe(upd.changes, 2, 'update changes');
    toBe(upd.lastInsertRowid, undefined, 'update lastInsertRowid');
    toEqual(
      await db.get<{ name: string }>('SELECT name FROM t WHERE id = ?', [2]),
      { name: 'b' },
      'get one row',
    );
    toBe(await db.get('SELECT * FROM t WHERE id = ?', [99]), undefined, 'get no row');
    const rows = await db.all<{ name: string; n: number }>('SELECT name, n FROM t ORDER BY id');
    toEqual(
      rows,
      [
        { name: 'a', n: 11 },
        { name: 'b', n: 12 },
      ],
      'all rows',
    );
    await db.exec("INSERT INTO t (name) VALUES ('x'); INSERT INTO t (name) VALUES ('y');");
    toBe(await count(db), 4, 'row count after exec');
    await rejection(db.run('INSERT INTO nope VALUES (1)'), 'insert into a missing table');
  }),

  withDb('changes counts only its own rows, not foreign-key cascades', async (db) => {
    await db.exec('PRAGMA foreign_keys = ON');
    await db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
    await db.exec(
      'CREATE TABLE child (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES parent(id) ON DELETE CASCADE)',
    );
    await db.exec('INSERT INTO parent (id) VALUES (1); INSERT INTO parent (id) VALUES (2);');
    await db.exec(
      'INSERT INTO child (pid) VALUES (1); INSERT INTO child (pid) VALUES (1); INSERT INTO child (pid) VALUES (2);',
    );
    const one = await db.run('DELETE FROM parent WHERE id = 1');
    toBe(one.changes, 1, 'delete one parent with two children');
    const all = await db.run('DELETE FROM parent');
    toBe(all.changes, 1, 'delete the last parent with one child');
    toBe(
      (await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM child'))!.c,
      0,
      'children cascaded',
    );
  }),

  withDb('round-trips strings, numbers, null and Uint8Array', async (db) => {
    await db.exec(T_DDL);
    const bytes = new Uint8Array([0, 1, 2, 255, 128]);
    // A view over a larger buffer: only the viewed bytes must be bound.
    const big = new Uint8Array([9, 9, 0, 1, 2, 255, 128, 9]);
    await db.run('INSERT INTO t (name, data) VALUES (?, ?)', [null, bytes]);
    await db.run('INSERT INTO t (name, n, data) VALUES (?, ?, ?)', ['v', 7, big.subarray(2, 7)]);
    const rows = await db.all<{ name: string | null; n: number | null; data: Uint8Array }>(
      'SELECT name, n, data FROM t ORDER BY id',
    );
    toBe(rows[0].name, null, 'null name');
    toBe(rows[0].n, null, 'null n');
    toEqual(Array.from(rows[0].data), Array.from(bytes), 'first blob');
    toBe(rows[1].name, 'v', 'string');
    toBe(rows[1].n, 7, 'number');
    toEqual(Array.from(rows[1].data), Array.from(bytes), 'blob from a view');
    toEqual(await db.get('SELECT 1 AS x WHERE ? IS NULL', [null]), { x: 1 }, 'null parameter');
  }),

  withDb('batch is all-or-nothing outside a transaction', async (db) => {
    await db.exec(T_DDL);
    await db.batch([
      { sql: 'INSERT INTO t (name) VALUES (?)', params: ['a'] },
      { sql: 'INSERT INTO t (name) VALUES (?)', params: ['b'] },
    ]);
    toBe(await count(db), 2, 'rows after a good batch');
    await rejection(
      db.batch([
        { sql: 'INSERT INTO t (name) VALUES (?)', params: ['c'] },
        { sql: 'INSERT INTO nope VALUES (1)' },
      ]),
      'a failing batch',
    );
    toBe(await count(db), 2, 'rows after a failed batch');
  }),

  withDb('a transaction commits and returns the body value', async (db) => {
    await db.exec(T_DDL);
    const value = await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (name) VALUES (?)', ['a']);
      const row = await tx.get<{ name: string }>('SELECT name FROM t');
      await tx.batch([{ sql: 'INSERT INTO t (name) VALUES (?)', params: ['b'] }]);
      return row!.name;
    });
    toBe(value, 'a', 'body value');
    toBe(await count(db), 2, 'rows after commit');
  }),

  withDb('a transaction rolls back and rethrows when the body throws', async (db) => {
    await db.exec(T_DDL);
    await db.run('INSERT INTO t (name) VALUES (?)', ['kept']);
    const boom = new Error('boom');
    const err = await rejection(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (name) VALUES (?)', ['c']);
        throw boom;
      }),
      'a throwing body',
    );
    toBe(err, boom, 'the thrown error');
    toBe(await count(db), 1, 'rows after rollback');
    // The adapter is usable again.
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (name) VALUES (?)', ['ok']);
    });
    toBe(await count(db), 2, 'rows after the next transaction');
  }),

  withDb('a failing batch inside a transaction rolls the whole transaction back', async (db) => {
    await db.exec(T_DDL);
    await rejection(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (name) VALUES (?)', ['a']);
        await tx.batch([
          { sql: 'INSERT INTO t (name) VALUES (?)', params: ['b'] },
          { sql: 'INSERT INTO nope VALUES (1)' },
        ]);
      }),
      'a transaction with a failing batch',
    );
    toBe(await count(db), 0, 'rows after rollback');
  }),

  withDb('two transactions started together do not overlap', async (db) => {
    await db.exec(T_DDL);
    const log: string[] = [];
    const make = (label: string): Promise<string> =>
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
    toEqual(results.slice(0, 2), ['a', 'b'], 'results');
    toEqual(log, ['a:start', 'a:end', 'b:start', 'b:end'], 'order of the transactions');
    toBe(await count(db), 3, 'rows');
  }),

  withDb(
    'a nested transaction rejects with SQL_TX_NESTED; the outer one can commit',
    async (db) => {
      await db.exec(T_DDL);
      let nested: unknown;
      await db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (name) VALUES (?)', ['outer']);
        await db.transaction(async () => {}).catch((e) => (nested = e));
      });
      toBe(codeOf(nested), SQL_TX_NESTED, 'nested transaction code');
      toBe(await count(db), 1, 'rows');
    },
  ),

  withDb('a call on the outer SqlDb inside a body rejects with SQL_TX_OUTER_CALL', async (db) => {
    await db.exec(T_DDL);
    let outer: unknown;
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (name) VALUES (?)', ['inside']);
      await db.run('INSERT INTO t (name) VALUES (?)', ['outer']).catch((e) => (outer = e));
      await db.get('SELECT 1').catch(() => {});
      await tx.run('INSERT INTO t (name) VALUES (?)', ['inside2']);
    });
    toBe(codeOf(outer), SQL_TX_OUTER_CALL, 'outer call code');
    const names = await db.all<{ name: string }>('SELECT name FROM t ORDER BY id');
    toEqual(
      names.map((r) => r.name),
      ['inside', 'inside2'],
      'rows',
    );
  }),

  withDb('a function taking a SqlTx works with tx and with the outer SqlDb', async (db) => {
    await db.exec(T_DDL);
    const addRow = async (target: SqlTx, rowName: string): Promise<void> => {
      await target.run('INSERT INTO t (name) VALUES (?)', [rowName]);
    };
    await db.transaction(async (tx) => {
      await addRow(tx, 'via-tx');
    });
    await addRow(db, 'via-db');
    const names = await db.all<{ name: string }>('SELECT name FROM t ORDER BY id');
    toEqual(
      names.map((r) => r.name),
      ['via-tx', 'via-db'],
      'rows',
    );
  }),

  withDb('initSchema builds the schema and foreign keys are enforced', async (db) => {
    toBe(await initSchema(db), SCHEMA_VERSION, 'initSchema result');
    toEqual(
      await db.get<{ version: number }>('SELECT version FROM schema_version'),
      { version: SCHEMA_VERSION },
      'schema_version',
    );
    // Running it again changes nothing.
    toBe(await initSchema(db), SCHEMA_VERSION, 'second initSchema result');

    await db.exec(
      'CREATE TABLE parent (id TEXT PRIMARY KEY); CREATE TABLE child (id INTEGER PRIMARY KEY, pid TEXT NOT NULL REFERENCES parent(id) ON DELETE CASCADE)',
    );
    await rejection(db.run('INSERT INTO child (pid) VALUES (?)', ['missing']), 'orphan insert');
    await db.run('INSERT INTO parent (id) VALUES (?)', ['p']);
    await db.run('INSERT INTO child (pid) VALUES (?)', ['p']);
    await db.run('DELETE FROM parent WHERE id = ?', ['p']);
    toEqual(
      await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM child'),
      { c: 0 },
      'children after cascade',
    );
  }),
];
