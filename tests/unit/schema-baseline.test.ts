// @vitest-environment node
/**
 * WP2.2: the baseline schema in core (`BASELINE_SCHEMA`) must equal what the server's old path
 * (`server/db.ts` + `server/db-migrations.ts`) produces. If this fails after a schema change,
 * update `BASELINE_SCHEMA` / `SCHEMA_VERSION` in `packages/core/src/db/schema.ts`.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  BASELINE_SCHEMA,
  SCHEMA_VERSION,
  initSchema,
  runDataMigrations,
  type DataMigration,
} from '@myastrosky/core/db/schema';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { applyDataMigrations } from '../../server/db-migrations';

type Conn = Database.Database;

const names = (conn: Conn, type: 'table' | 'index'): string[] =>
  (
    conn
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all(type) as { name: string }[]
  ).map((r) => r.name);

/** Everything the schema says about a table, as data (not SQL text). */
function describeTable(conn: Conn, table: string) {
  const indexes = (conn.pragma(`index_list(${table})`) as { name: string }[])
    .map((idx) => ({
      list: idx,
      info: conn.pragma(`index_info(${idx.name})`),
    }))
    .sort((a, b) => a.list.name.localeCompare(b.list.name));
  return {
    columns: conn.pragma(`table_info(${table})`),
    foreignKeys: conn.pragma(`foreign_key_list(${table})`),
    indexes,
  };
}

const version = (conn: Conn): number =>
  (conn.prepare('SELECT version FROM schema_version').get() as { version: number }).version;

const sqlText = (conn: Conn): unknown[] =>
  conn
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all();

describe('baseline schema equals the server upgrade path', () => {
  let a: Conn; // old path
  let b: Conn; // initSchema
  let dbB: ReturnType<typeof createBetterSqliteDb>;

  beforeAll(async () => {
    process.env.DB_PATH = ':memory:';
    const server = await import('../../server/db.js');
    a = server.getConnection();
    b = new Database(':memory:');
    dbB = createBetterSqliteDb(b);
    await initSchema(dbB);
  });
  afterAll(() => {
    b.close();
  });

  it('has the same tables and indexes', () => {
    expect(names(b, 'table')).toEqual(names(a, 'table'));
    expect(names(b, 'index')).toEqual(names(a, 'index'));
    expect(names(b, 'table')).toContain('photos');
    expect(names(b, 'index')).toContain('idx_corr_photo_id');
  });

  it('has the same columns, foreign keys and indexes for every table', () => {
    for (const table of names(a, 'table')) {
      expect(describeTable(b, table), `table ${table}`).toEqual(describeTable(a, table));
    }
  });

  it('both report the baseline version', () => {
    expect(SCHEMA_VERSION).toBe(14);
    expect(version(a)).toBe(14);
    expect(version(b)).toBe(14);
  });

  it('enforces foreign keys on the new database', async () => {
    b.prepare(
      'INSERT INTO photos (id, filename, original_name, width, height) VALUES (?,?,?,?,?)',
    ).run('p1', 'f.jpg', 'f.jpg', 10, 10);
    b.prepare(
      'INSERT INTO star_correspondences (photo_id, point_index, photo_x, photo_y, star_hip) VALUES (?,?,?,?,?)',
    ).run('p1', 0, 1, 1, 1);
    const count = () =>
      (b.prepare('SELECT COUNT(*) AS c FROM star_correspondences').get() as { c: number }).c;
    expect(count()).toBe(1);
    b.prepare('DELETE FROM photos WHERE id = ?').run('p1');
    expect(count()).toBe(0);
  });

  it('initSchema is a no-op when run again, on either database', async () => {
    const before = sqlText(b);
    expect(await initSchema(dbB)).toBe(14);
    expect(sqlText(b)).toEqual(before);

    const beforeA = sqlText(a);
    expect(await initSchema(createBetterSqliteDb(a))).toBe(14);
    expect(sqlText(a)).toEqual(beforeA);
  });

  it('initSchema refuses a database that predates versioning', async () => {
    const old = new Database(':memory:');
    old.exec('CREATE TABLE photos (id TEXT PRIMARY KEY)');
    await expect(initSchema(createBetterSqliteDb(old))).rejects.toThrow(/predates versioning/);
    old.close();
  });
});

describe('data migrations', () => {
  const fake: DataMigration[] = [
    {
      version: 15,
      statements: [
        'CREATE TABLE fake_a (id TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)',
        'CREATE INDEX idx_fake_a_n ON fake_a(n)',
      ],
    },
    { version: 16, statements: ['ALTER TABLE fake_a ADD COLUMN extra TEXT'] },
  ];
  const failing: DataMigration[] = [
    {
      version: 15,
      statements: ['CREATE TABLE fake_b (id TEXT)', 'ALTER TABLE no_such_table ADD COLUMN x TEXT'],
    },
  ];

  async function freshDb() {
    const conn = new Database(':memory:');
    const db = createBetterSqliteDb(conn);
    await initSchema(db);
    return { conn, db };
  }

  it('runs future migrations through initSchema machinery and moves the version', async () => {
    const { conn, db } = await freshDb();
    expect(await runDataMigrations(db, fake, 14)).toBe(16);
    expect(version(conn)).toBe(16);
    expect(names(conn, 'table')).toContain('fake_a');
    expect(names(conn, 'index')).toContain('idx_fake_a_n');
    const cols = (conn.pragma('table_info(fake_a)') as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'n', 'extra']);
    // migrations at or below the stored version are skipped
    expect(await runDataMigrations(db, fake, 16)).toBe(16);
    conn.close();
  });

  it('a failing statement leaves the version and the schema unchanged', async () => {
    const { conn, db } = await freshDb();
    const before = sqlText(conn);
    await expect(runDataMigrations(db, failing, 14)).rejects.toThrow();
    expect(version(conn)).toBe(14);
    expect(sqlText(conn)).toEqual(before);
    conn.close();
  });

  it('the server loop gives the same schema as the initSchema loop', async () => {
    const viaCore = await freshDb();
    await runDataMigrations(viaCore.db, fake, 14);

    const serverConn = new Database(':memory:');
    await initSchema(createBetterSqliteDb(serverConn));
    expect(applyDataMigrations(serverConn, fake, 14)).toBe(16);

    expect(version(serverConn)).toBe(16);
    expect(sqlText(serverConn)).toEqual(sqlText(viaCore.conn));

    const before = sqlText(serverConn);
    expect(() =>
      applyDataMigrations(
        serverConn,
        failing.map((m) => ({ ...m, version: 17 })),
        16,
      ),
    ).toThrow();
    expect(version(serverConn)).toBe(16);
    expect(sqlText(serverConn)).toEqual(before);

    viaCore.conn.close();
    serverConn.close();
  });
});
