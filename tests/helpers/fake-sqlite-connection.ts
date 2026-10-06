/**
 * A fake `@capacitor-community/sqlite` connection built on better-sqlite3: every call answers asynchronously
 * and has the plugin's result shapes, BLOB encodings and quirks (an `executeSet` binds raw JSON, so a BLOB
 * there fails).
 */
import Database from 'better-sqlite3';
import type {
  CapacitorSqliteChanges,
  CapacitorSqliteConnection,
} from '@myastrosky/backend-local/capacitor-sqlite-db';

const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Call = { method: string; args: unknown[] };

export interface FakeConnection extends CapacitorSqliteConnection {
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
export function createFakeConnection(): FakeConnection {
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
