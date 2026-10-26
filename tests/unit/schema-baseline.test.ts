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
  REBUILD_BROKE_REFERENCES,
  SCHEMA_VERSION,
  initSchema,
  runDataMigrations,
  type DataMigration,
} from '@myastrosky/core/db/schema';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { applyDataMigrations } from '../../server/db-migrations';
import { countingSqlDb } from '../helpers/counting-sql-db';
import { SQL_ADAPTERS } from '../helpers/sql-adapters';

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
    expect(SCHEMA_VERSION).toBe(17);
    expect(version(a)).toBe(SCHEMA_VERSION);
    expect(version(b)).toBe(SCHEMA_VERSION);
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
    expect(await initSchema(dbB)).toBe(SCHEMA_VERSION);
    expect(sqlText(b)).toEqual(before);

    const beforeA = sqlText(a);
    expect(await initSchema(createBetterSqliteDb(a))).toBe(SCHEMA_VERSION);
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
  /** The current version; the fake migrations come after it. */
  const V = SCHEMA_VERSION;
  const fake: DataMigration[] = [
    {
      version: V + 1,
      statements: [
        'CREATE TABLE fake_a (id TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)',
        'CREATE INDEX idx_fake_a_n ON fake_a(n)',
      ],
    },
    { version: V + 2, statements: ['ALTER TABLE fake_a ADD COLUMN extra TEXT'] },
  ];
  const failing: DataMigration[] = [
    {
      version: V + 1,
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
    expect(await runDataMigrations(db, fake, V)).toBe(V + 2);
    expect(version(conn)).toBe(V + 2);
    expect(names(conn, 'table')).toContain('fake_a');
    expect(names(conn, 'index')).toContain('idx_fake_a_n');
    const cols = (conn.pragma('table_info(fake_a)') as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'n', 'extra']);
    // migrations at or below the stored version are skipped
    expect(await runDataMigrations(db, fake, V + 2)).toBe(V + 2);
    conn.close();
  });

  it('a failing statement leaves the version and the schema unchanged', async () => {
    const { conn, db } = await freshDb();
    const before = sqlText(conn);
    await expect(runDataMigrations(db, failing, V)).rejects.toThrow();
    expect(version(conn)).toBe(V);
    expect(sqlText(conn)).toEqual(before);
    // A later migration that fails undoes the earlier ones of the same run too.
    const laterFails = [fake[0], ...failing.map((m) => ({ ...m, version: V + 2 }))];
    await expect(runDataMigrations(db, laterFails, V)).rejects.toThrow();
    expect(version(conn)).toBe(V);
    expect(sqlText(conn)).toEqual(before);
    conn.close();
  });

  it('creates a database and runs the pending migrations in a fixed number of round trips', async () => {
    const counted = countingSqlDb(createBetterSqliteDb(new Database(':memory:')));
    // pragma, schema_version table, version read, empty-database check, one batch
    expect(await initSchema(counted)).toBe(SCHEMA_VERSION);
    expect(counted.calls()).toBe(5);
    counted.reset();
    expect(await runDataMigrations(counted, fake, V)).toBe(V + 2);
    expect(counted.calls()).toBe(1);
    counted.reset();
    expect(await runDataMigrations(counted, fake, V + 2)).toBe(V + 2);
    expect(counted.calls()).toBe(0);
  });

  it('the server loop gives the same schema as the initSchema loop', async () => {
    const viaCore = await freshDb();
    await runDataMigrations(viaCore.db, fake, V);

    const serverConn = new Database(':memory:');
    await initSchema(createBetterSqliteDb(serverConn));
    expect(applyDataMigrations(serverConn, fake, V)).toBe(V + 2);

    expect(version(serverConn)).toBe(V + 2);
    expect(sqlText(serverConn)).toEqual(sqlText(viaCore.conn));

    const before = sqlText(serverConn);
    expect(() =>
      applyDataMigrations(
        serverConn,
        failing.map((m) => ({ ...m, version: V + 3 })),
        V + 2,
      ),
    ).toThrow();
    expect(version(serverConn)).toBe(V + 2);
    expect(sqlText(serverConn)).toEqual(before);

    viaCore.conn.close();
    serverConn.close();
  });
});

describe.each(SQL_ADAPTERS)('the photos table rebuild of version 17 (%s)', (_adapter, wrap) => {
  const NEW_DEFAULT = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const photoRows = (conn: Conn) => conn.prepare('SELECT * FROM photos ORDER BY id').all();
  const matchRows = (conn: Conn) =>
    conn.prepare('SELECT * FROM star_correspondences ORDER BY id').all();
  const dateDefault = (conn: Conn) =>
    (conn.pragma('table_info(photos)') as { name: string; dflt_value: string }[]).find(
      (c) => c.name === 'created_at',
    )!.dflt_value;

  /** A database as version 16 left it: the old date default, two photos and their star matches. */
  function atVersion16(): Conn {
    const conn = new Database(':memory:');
    conn.pragma('foreign_keys = ON');
    for (const sql of BASELINE_SCHEMA) conn.exec(sql.replace(NEW_DEFAULT, "datetime('now')"));
    conn.exec('CREATE TABLE schema_version (version INTEGER NOT NULL DEFAULT 0)');
    conn.prepare('INSERT INTO schema_version (version) VALUES (16)').run();
    const photo = conn.prepare(
      'INSERT INTO photos (id, filename, original_name, width, height, created_at, notes, quarter_turns) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    photo.run('p1', 'p1.jpg', 'P1.jpg', 30, 20, '2026-03-04T05:06:07.000Z', 'n', 1);
    photo.run('p2', 'p2.jpg', 'P2.jpg', 40, 10, null, '', 0);
    const match = conn.prepare(
      'INSERT INTO star_correspondences (photo_id, point_index, photo_x, photo_y, star_hip) VALUES (?, ?, ?, ?, ?)',
    );
    match.run('p1', 0, 1, 2, 100);
    match.run('p1', 1, 3, 4, 200);
    match.run('p2', 0, 5, 6, 300);
    return conn;
  }

  it('keeps every photo, every star match and the link between them, with the ISO date default', async () => {
    const conn = atVersion16();
    expect(dateDefault(conn)).toBe("datetime('now')");
    const photos = photoRows(conn);
    const matches = matchRows(conn);
    const db = countingSqlDb(wrap(createBetterSqliteDb(conn)));
    expect(await initSchema(db)).toBe(SCHEMA_VERSION);
    // initSchema's three calls, then: foreign-key state, switch off, begin, check, batch, check, commit, switch back
    expect(db.calls()).toBe(11);
    expect(dateDefault(conn)).toBe(NEW_DEFAULT);
    expect(photoRows(conn)).toEqual(photos);
    expect(matchRows(conn)).toEqual(matches);
    expect(conn.pragma('foreign_keys', { simple: true })).toBe(1);
    // the star matches still belong to the photos: deleting one takes its matches along
    conn.prepare('DELETE FROM photos WHERE id = ?').run('p1');
    expect(matchRows(conn)).toMatchObject([{ photo_id: 'p2' }]);
    conn
      .prepare(
        'INSERT INTO photos (id, filename, original_name, width, height) VALUES (?, ?, ?, ?, ?)',
      )
      .run('p3', 'p3.jpg', 'p3.jpg', 1, 1);
    expect(
      (
        conn.prepare('SELECT created_at FROM photos WHERE id = ?').get('p3') as {
          created_at: string;
        }
      ).created_at,
    ).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    conn.close();
  });

  it('upgrades a database whose star matches already pointed at a missing photo, and keeps them', async () => {
    const conn = atVersion16();
    conn.pragma('foreign_keys = OFF');
    conn
      .prepare(
        'INSERT INTO star_correspondences (photo_id, point_index, photo_x, photo_y, star_hip) VALUES (?, ?, ?, ?, ?)',
      )
      .run('gone', 0, 1, 1, 1);
    conn.pragma('foreign_keys = ON');
    expect(await initSchema(wrap(createBetterSqliteDb(conn)))).toBe(SCHEMA_VERSION);
    expect(matchRows(conn)).toHaveLength(4);
    conn.close();
  });

  it('undoes a rebuild that leaves star matches pointing nowhere, and switches foreign keys back on', async () => {
    const conn = atVersion16();
    const photos = photoRows(conn);
    const broken: DataMigration[] = [
      { version: 17, rebuildsTable: true, statements: ['DROP TABLE photos'] },
    ];
    await expect(runDataMigrations(wrap(createBetterSqliteDb(conn)), broken, 16)).rejects.toThrow(
      REBUILD_BROKE_REFERENCES,
    );
    expect(version(conn)).toBe(16);
    expect(photoRows(conn)).toEqual(photos);
    expect(matchRows(conn)).toHaveLength(3);
    expect(conn.pragma('foreign_keys', { simple: true })).toBe(1);
    conn.close();
  });
});
