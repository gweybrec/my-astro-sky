/**
 * The database schema, defined once for the desktop server and the phone.
 *
 * Portability rules: the schema uses nothing special to one SQLite build, so it must keep
 * avoiding `RETURNING`, `json_*` functions and `STRICT` tables.
 *
 * Before adding a migration, read this file and `server/db-migrations.ts` first. Migrations
 * 1 to 14 live in `server/db-migrations.ts` (program logic, frozen). From version 15 on, a
 * migration is a list of SQL statements added to `MIGRATIONS` below, and `BASELINE_SCHEMA` and
 * `SCHEMA_VERSION` are updated in the same commit; `tests/unit/schema-baseline.test.ts` compares
 * the baseline with what the server produces and fails otherwise.
 */
import type { SqlDb, SqlTx } from '../ports/sql-db';

/** Schema version produced by `BASELINE_SCHEMA` (the latest migration it includes). */
export const SCHEMA_VERSION = 14;

/**
 * The schema at `SCHEMA_VERSION`, one statement per entry (tables first, then indexes).
 * Column order matches what the server's old upgrade path produces. `schema_version` is not
 * listed: `initSchema` creates it. No data is seeded here.
 */
export const BASELINE_SCHEMA: readonly string[] = [
  `CREATE TABLE custom_gear (
    id   TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('telescope','camera','accessory','filter')),
    data TEXT NOT NULL
  )`,
  `CREATE TABLE dso_overrides (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`,
  `CREATE TABLE gear_setups (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL DEFAULT '',
    telescope_id TEXT NOT NULL,
    camera_id    TEXT NOT NULL,
    accessory_id TEXT,
    enabled      INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE horizon_profiles (
    key  TEXT PRIMARY KEY,
    json TEXT NOT NULL
  )`,
  `CREATE TABLE photos (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    manual_placement TEXT,
    dso_ids TEXT NOT NULL DEFAULT '[]',
    labels TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    integrations TEXT NOT NULL DEFAULT '[]',
    display_order INTEGER,
    thumb_filename TEXT,
    observation_date TEXT,
    points_of_interest TEXT NOT NULL DEFAULT '[]',
    capture_details TEXT NOT NULL DEFAULT '{}',
    gear_setup_id TEXT
  )`,
  `CREATE TABLE plan_entries (
    id        TEXT PRIMARY KEY,
    plan_id   TEXT NOT NULL,
    dso_id    TEXT,
    position  INTEGER NOT NULL,
    pa_deg    REAL,
    ra        REAL,
    dec       REAL,
    notes     TEXT,
    mosaic_id TEXT,
    mosaic_w_deg REAL,
    mosaic_h_deg REAL,
    observation_windows TEXT NOT NULL DEFAULT '[]'
  )`,
  `CREATE TABLE plan_mosaics (
    id          TEXT PRIMARY KEY,
    plan_id     TEXT NOT NULL,
    dso_id      TEXT,
    center_ra   REAL NOT NULL,
    center_dec  REAL NOT NULL,
    pa_deg      REAL NOT NULL DEFAULT 0,
    overlap_pct REAL NOT NULL DEFAULT 20,
    cols        INTEGER NOT NULL DEFAULT 1,
    rows        INTEGER NOT NULL DEFAULT 1,
    position    INTEGER NOT NULL DEFAULT 0,
    name TEXT
  )`,
  `CREATE TABLE plans (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    night_of   TEXT,
    setup_id   TEXT,
    lat        REAL,
    lon        REAL,
    sort_by    TEXT NOT NULL DEFAULT 'transit'
  )`,
  `CREATE TABLE poi_categories (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL DEFAULT '',
    color    TEXT NOT NULL DEFAULT '#888888',
    position INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE sky_regions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    points TEXT NOT NULL,
    position INTEGER NOT NULL
  )`,
  `CREATE TABLE star_correspondences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    point_index INTEGER NOT NULL,
    photo_x REAL NOT NULL,
    photo_y REAL NOT NULL,
    star_hip INTEGER NOT NULL,
    star_name TEXT,
    star_ra REAL,
    star_dec REAL,
    UNIQUE(photo_id, point_index)
  )`,
  `CREATE INDEX idx_corr_photo_id ON star_correspondences(photo_id)`,
];

/** A schema change from version 15 on: SQL statements only, no program logic. */
export interface DataMigration {
  version: number;
  statements: readonly string[];
}

// Migrations from version 15 on go here, as SQL statements only, in ascending order.
export const MIGRATIONS: readonly DataMigration[] = [];

/**
 * Runs every migration of `migrations` above the stored version, in order; each migration's
 * statements and its `UPDATE schema_version` share one transaction. Returns the final version.
 */
export async function runDataMigrations(
  db: SqlDb,
  migrations: readonly DataMigration[],
  fromVersion: number,
): Promise<number> {
  let current = fromVersion;
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    await db.transaction(async (tx: SqlTx) => {
      for (const sql of migration.statements) await tx.run(sql);
      await tx.run('UPDATE schema_version SET version = ?', [migration.version]);
    });
    current = migration.version;
  }
  return current;
}

/**
 * Brings the database to the latest schema: creates it from `BASELINE_SCHEMA` when empty, then
 * runs `MIGRATIONS`. Returns the final version.
 */
export async function initSchema(db: SqlDb): Promise<number> {
  await db.exec('PRAGMA foreign_keys = ON');
  await db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 0)');

  const row = await db.get<{ version: number }>('SELECT version FROM schema_version');
  let current: number;
  if (row === undefined) {
    const photos = await db.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'photos'",
    );
    if (photos !== undefined) {
      throw new Error(
        'This database predates versioning (it has a photos table but no schema version); open it with the desktop server first.',
      );
    }
    await db.transaction(async (tx) => {
      for (const sql of BASELINE_SCHEMA) await tx.run(sql);
      await tx.run('INSERT INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION]);
    });
    current = SCHEMA_VERSION;
  } else {
    current = row.version;
  }
  return runDataMigrations(db, MIGRATIONS, current);
}
