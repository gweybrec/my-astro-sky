import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { applyMigrations } from './db-migrations.js';
import { ENC_PREFIX, encryptSecret, decryptSecret } from './secret-codec.js';
import { wrapLegacyConnection } from './db-tx-guard.js';

export { applyMigrations };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');

const rawDb = new Database(dbPath);
// Old synchronous code goes through this wrapper; it throws while a SqlDb service transaction is open.
const db = wrapLegacyConnection(rawDb);
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
// horizonCacheKey). Terrain doesn't move, so a computed skyline is reusable
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

// ─── User-configurable settings ───────────────────────────────────────────────
// Reads from the settings table first, falls back to process.env for
// backward-compat with Docker / .env deployments.

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
const deleteSettingStmt = db.prepare('DELETE FROM settings WHERE key = ?');
const SECRET_SETTINGS = new Set(['ASTROMETRY_API_KEY']);

// Kept for the solver modules until they move to services (astap, solve-field, astrometry). The rules
// are also in `packages/core/src/services/settings.ts`; `tests/unit/settings-service.test.ts` proves the
// two agree.
export function getSetting(key: string): string | undefined {
  if (SECRET_SETTINGS.has(key) && process.env[key] !== undefined) {
    return process.env[key];
  }
  const row = getSettingStmt.get(key) as { value: string } | undefined;
  if (row !== undefined) {
    if (!SECRET_SETTINGS.has(key)) return row.value;

    const decrypted = decryptSecret(row.value);
    if (decrypted !== null) return decrypted;

    // Encrypted row exists but no valid key available -> do not leak ciphertext.
    if (row.value.startsWith(ENC_PREFIX)) return undefined;

    // Best-effort migration of plaintext secrets to encrypted storage when key is configured.
    const encrypted = encryptSecret(row.value);
    if (encrypted !== row.value) {
      setSettingStmt.run(key, encrypted);
    }
    return row.value;
  }
  return process.env[key];
}

export function setSetting(key: string, value: string): void {
  if (SECRET_SETTINGS.has(key)) {
    setSettingStmt.run(key, encryptSecret(value));
    return;
  }
  setSettingStmt.run(key, value);
}

export function deleteSetting(key: string): void {
  deleteSettingStmt.run(key);
}

/** The raw better-sqlite3 handle, for the `SqlDb` adapter only (not guarded against service transactions). */
export function getConnection(): Database.Database {
  return rawDb;
}

export function closeDatabase(): void {
  db.close();
}

// ─── Horizon profile cache ─────────────────────────────────────────────────────
// A computed skyline for a location is expensive (DEM tile fetch + ray-trace) but
// stable, so cache it keyed by rounded lat/lon + radius + eye height.

const getHorizonStmt = db.prepare('SELECT json FROM horizon_profiles WHERE key = ?');
const setHorizonStmt = db.prepare(
  'INSERT OR REPLACE INTO horizon_profiles (key, json) VALUES (?, ?)',
);

// Bump when the computed profile's shape/content changes (e.g. summits added), so
// stale entries from an older algorithm are bypassed rather than served forever.
const HORIZON_CACHE_VERSION = 'v5';

/** Cache key: version + 3-decimal lat/lon (~100 m) plus radius (km) and eye height (m). */
export function horizonCacheKey(
  lat: number,
  lon: number,
  radiusKm: number,
  obsHeightM: number | null,
): string {
  return `${HORIZON_CACHE_VERSION}:${lat.toFixed(3)}:${lon.toFixed(3)}:${radiusKm}:${obsHeightM ?? 'auto'}`;
}

export function getCachedHorizon(key: string): object | undefined {
  const row = getHorizonStmt.get(key) as { json: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.json);
  } catch {
    return undefined;
  }
}

export function setCachedHorizon(key: string, profile: object): void {
  setHorizonStmt.run(key, JSON.stringify(profile));
}
