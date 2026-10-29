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
import type { SqlDb } from '../ports/sql-db';

/** Schema version produced by `BASELINE_SCHEMA` (the latest migration it includes). */
export const SCHEMA_VERSION = 18;

/** The columns of the photos table at version 17, in their order (migration 17 copies them). */
const PHOTO_COLUMNS_V17 =
  'id, filename, original_name, width, height, created_at, manual_placement, dso_ids, labels, notes, integrations, display_order, thumb_filename, observation_date, points_of_interest, capture_details, gear_setup_id, quarter_turns';

/**
 * The photos table, created under `name`: as it is now for the baseline, and as it was at version 17
 * (`atVersion17`) for the rebuild of migration 17, which later migrations then change.
 */
function photosTable(name: string, atVersion17 = false): string {
  return `CREATE TABLE ${name} (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
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
    gear_setup_id TEXT,
    quarter_turns INTEGER NOT NULL DEFAULT 0${atVersion17 ? '' : ',\n    medium_filename TEXT'}
  )`;
}

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
  photosTable('photos'),
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
  /**
   * The statements drop and recreate a table that other tables point at. Foreign keys are switched off
   * around the run (SQLite ignores the switch inside a transaction, and dropping the table would delete
   * the rows that point at it), and the run is undone if it leaves more rows pointing nowhere than before.
   */
  rebuildsTable?: boolean;
}

// Migrations from version 15 on go here, as SQL statements only, in ascending order.
export const MIGRATIONS: readonly DataMigration[] = [
  // How many quarters to the right a photo is shown turned; its picture file is never changed.
  {
    version: 15,
    statements: ['ALTER TABLE photos ADD COLUMN quarter_turns INTEGER NOT NULL DEFAULT 0'],
  },
  // A photo's date in the ISO form of the services' clock: the column default wrote `YYYY-MM-DD HH:MM:SS`, in UTC.
  {
    version: 16,
    statements: [
      `UPDATE photos SET created_at = substr(created_at, 1, 10) || 'T' || substr(created_at, 12) || '.000Z'
       WHERE created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'`,
    ],
  },
  // The photos table again, with a date default in that ISO form (SQLite cannot change a column's default in place).
  {
    version: 17,
    rebuildsTable: true,
    statements: [
      photosTable('photos_new', true),
      `INSERT INTO photos_new (${PHOTO_COLUMNS_V17}) SELECT ${PHOTO_COLUMNS_V17} FROM photos`,
      'DROP TABLE photos',
      'ALTER TABLE photos_new RENAME TO photos',
    ],
  },
  // A medium-sized copy of a large photo's picture, shown on the sky map between the thumbnail and the full picture.
  {
    version: 18,
    statements: ['ALTER TABLE photos ADD COLUMN medium_filename TEXT'],
  },
];

/**
 * A database update that failed at start-up. Everything it wrote was undone, so the data is as the previous version
 * of the app left it; until a version that fixes the update is installed, the app can only export a backup.
 */
export class DatabaseUpdateError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super(`The database update failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'DatabaseUpdateError';
    this.cause = cause;
  }
}

/** True for a `DatabaseUpdateError`, also when it comes from another copy of this module (by its name). */
export function isDatabaseUpdateError(error: unknown): error is DatabaseUpdateError {
  return error instanceof Error && error.name === 'DatabaseUpdateError';
}

/** The error of a table rebuild that left rows pointing nowhere; the run is undone. */
export const REBUILD_BROKE_REFERENCES =
  'A table rebuild left rows pointing at missing rows; it was undone.';

/**
 * Runs every migration of `migrations` above the stored version, in order, each followed by its
 * `UPDATE schema_version`, all in one atomic batch: a failure leaves the database at `fromVersion`
 * and throws a `DatabaseUpdateError`.
 * When one of them rebuilds a table, the batch runs in a transaction with foreign keys switched off
 * (see `DataMigration.rebuildsTable`), then put back as they were. Returns the final version.
 */
export async function runDataMigrations(
  db: SqlDb,
  migrations: readonly DataMigration[],
  fromVersion: number,
): Promise<number> {
  const pending = migrations.filter((m) => m.version > fromVersion);
  if (pending.length === 0) return fromVersion;
  try {
    await runPending(db, pending);
  } catch (error) {
    throw new DatabaseUpdateError(error);
  }
  return pending[pending.length - 1].version;
}

async function runPending(db: SqlDb, pending: readonly DataMigration[]): Promise<void> {
  const statements = pending.flatMap((m) => [
    ...m.statements.map((sql) => ({ sql })),
    { sql: 'UPDATE schema_version SET version = ?', params: [m.version] },
  ]);
  if (!pending.some((m) => m.rebuildsTable)) {
    await db.batch(statements);
  } else {
    const foreignKeys = (await db.get<{ foreign_keys: number }>('PRAGMA foreign_keys'))
      ?.foreign_keys;
    await db.exec('PRAGMA foreign_keys = OFF');
    try {
      await db.transaction(async (tx) => {
        const before = (await tx.all('PRAGMA foreign_key_check')).length;
        await tx.batch(statements);
        if ((await tx.all('PRAGMA foreign_key_check')).length > before) {
          throw new Error(REBUILD_BROKE_REFERENCES);
        }
      });
    } finally {
      await db.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
    }
  }
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
    await db.batch([
      ...BASELINE_SCHEMA.map((sql) => ({ sql })),
      { sql: 'INSERT INTO schema_version (version) VALUES (?)', params: [SCHEMA_VERSION] },
    ]);
    current = SCHEMA_VERSION;
  } else {
    current = row.version;
  }
  return runDataMigrations(db, MIGRATIONS, current);
}
