import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { applyMigrations } from './db-migrations.js';

export { applyMigrations };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function tryTightenDbPermissions(basePath: string): void {
  if (process.platform === 'win32' || basePath === ':memory:') return;
  const candidates = [basePath, `${basePath}-wal`, `${basePath}-shm`];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      fs.chmodSync(candidate, 0o600);
    } catch {
      // Best-effort hardening: ignore permission errors to avoid startup failure.
    }
  }
}

tryTightenDbPermissions(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS star_correspondences (
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
  );

  CREATE INDEX IF NOT EXISTS idx_corr_photo_id ON star_correspondences(photo_id);
`);

applyMigrations(db);

// User-editable DSO overrides
db.exec(`
  CREATE TABLE IF NOT EXISTS dso_overrides (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
`);

// Cached computed horizon profiles, keyed by rounded location + params (see
// horizonCacheKey in the horizon service). Terrain doesn't move, so a computed skyline is reusable
// indefinitely; recomputing means re-fetching DEM tiles and ray-tracing.
db.exec(`
  CREATE TABLE IF NOT EXISTS horizon_profiles (
    key  TEXT PRIMARY KEY,
    json TEXT NOT NULL
  );
`);

// User-created custom gear (telescopes, cameras, accessories, filters).
// Note: existing databases are widened to accept 'filter' by migration v13, which
// rebuilds the table — SQLite cannot alter a CHECK constraint in place.
db.exec(`
  CREATE TABLE IF NOT EXISTS custom_gear (
    id   TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('telescope','camera','accessory','filter')),
    data TEXT NOT NULL
  );
`);

// Named gear setups (user-named telescope + camera + optional accessory combos)
db.exec(`
  CREATE TABLE IF NOT EXISTS gear_setups (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL DEFAULT '',
    telescope_id TEXT NOT NULL,
    camera_id    TEXT NOT NULL,
    accessory_id TEXT,
    enabled      INTEGER NOT NULL DEFAULT 1
  );
`);

// Night plans (named target lists) + their entries (one DSO each).
db.exec(`
  CREATE TABLE IF NOT EXISTS plans (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    night_of   TEXT,
    setup_id   TEXT,
    lat        REAL,
    lon        REAL,
    sort_by    TEXT NOT NULL DEFAULT 'transit'
  );
  CREATE TABLE IF NOT EXISTS plan_entries (
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
  );
  CREATE TABLE IF NOT EXISTS plan_mosaics (
    id          TEXT PRIMARY KEY,
    plan_id     TEXT NOT NULL,
    dso_id      TEXT,
    name        TEXT,
    center_ra   REAL NOT NULL,
    center_dec  REAL NOT NULL,
    pa_deg      REAL NOT NULL DEFAULT 0,
    overlap_pct REAL NOT NULL DEFAULT 20,
    cols        INTEGER NOT NULL DEFAULT 1,
    rows        INTEGER NOT NULL DEFAULT 1,
    position    INTEGER NOT NULL DEFAULT 0
  );
`);

/** The better-sqlite3 handle, for the `SqlDb` adapter. */
export function getConnection(): Database.Database {
  return db;
}

export function closeDatabase(): void {
  db.close();
}
