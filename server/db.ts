import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { applyMigrations } from './db-migrations.js';
import { ENC_PREFIX, encryptSecret, decryptSecret } from './secret-codec.js';
import { wrapLegacyConnection } from './db-tx-guard.js';
import { sanitizeCaptureDetails } from './wcs-reader.js';
import type { Photo } from '@myastrosky/core/types';

export { applyMigrations };
// Re-export so callers that already import from db.js (e.g. server/index.ts) keep working.
export { sanitizeCaptureDetails };

function parseCaptureDetails(val: any): Record<string, number | string> {
  if (!val) return {};
  try {
    return sanitizeCaptureDetails(JSON.parse(val));
  } catch {
    return {};
  }
}

/** Trim a nullable string FK (gear setup id) to a bounded value or null. */
function sanitizeSetupId(val: unknown): string | null {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim().slice(0, 64) : null;
}

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

const insertPhoto = db.prepare(
  `INSERT INTO photos (id, filename, original_name, width, height, manual_placement, dso_ids, labels, points_of_interest, notes, integrations, display_order, thumb_filename, observation_date, capture_details, gear_setup_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(display_order) + 1 FROM photos), 0), ?, ?, ?, ?)`,
);
const insertCorrespondence = db.prepare(
  'INSERT INTO star_correspondences (photo_id, point_index, photo_x, photo_y, star_hip, star_name, star_ra, star_dec) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
);
const selectPhotos = db.prepare(
  'SELECT * FROM photos ORDER BY display_order ASC, created_at ASC, id ASC',
);
const selectCorrespondences = db.prepare('SELECT * FROM star_correspondences ORDER BY point_index');
const selectPhotoById = db.prepare('SELECT * FROM photos WHERE id = ?');
const selectCorrespondencesForPhoto = db.prepare(
  'SELECT * FROM star_correspondences WHERE photo_id = ? ORDER BY point_index',
);
const deletePhotoStmt = db.prepare('DELETE FROM photos WHERE id = ?');
const selectFilename = db.prepare('SELECT filename FROM photos WHERE id = ?');
const updatePhotoDisplayOrderStmt = db.prepare('UPDATE photos SET display_order = ? WHERE id = ?');

interface CorrespondenceInput {
  pointIndex: number;
  photoX: number;
  photoY: number;
  starHip: number;
  starName: string;
  starRa?: number | null;
  starDec?: number | null;
}

interface IntegrationInput {
  frames: number;
  seconds: number;
  filter: string;
}

function sanitizeIntegrationRows(rows: any): IntegrationInput[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((entry: any) => ({
      frames: Number.isInteger(Number(entry?.frames)) ? Number(entry.frames) : 0,
      seconds: Number.isInteger(Number(entry?.seconds)) ? Number(entry.seconds) : 0,
      filter: typeof entry?.filter === 'string' ? entry.filter.trim() : '',
    }))
    .filter((entry) => entry.frames >= 1 && entry.seconds >= 1 && entry.filter.length > 0);
}

export interface PointOfInterestInput {
  name: string;
  categoryId: string;
  /** Sky position (degrees) — set when the POI was identified on the photo (e.g. a supernova). */
  ra?: number;
  dec?: number;
}

/**
 * Accept only well-formed POI entries: a non-empty trimmed name (≤100 chars) and a
 * string categoryId. Orphan categoryIds (category since deleted) are preserved — the
 * UI resolves them to an "Uncategorized" group at render time. An optional ra/dec
 * position is kept only when both are finite and in range.
 */
export function sanitizePois(rows: any): PointOfInterestInput[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((entry: any) => {
      const poi: PointOfInterestInput = {
        name: typeof entry?.name === 'string' ? entry.name.trim().slice(0, 100) : '',
        categoryId: typeof entry?.categoryId === 'string' ? entry.categoryId.slice(0, 64) : '',
      };
      const ra = entry?.ra;
      const dec = entry?.dec;
      if (
        typeof ra === 'number' &&
        typeof dec === 'number' &&
        Number.isFinite(ra) &&
        Number.isFinite(dec) &&
        ra >= 0 &&
        ra < 360 &&
        dec >= -90 &&
        dec <= 90
      ) {
        poi.ra = ra;
        poi.dec = dec;
      }
      return poi;
    })
    .filter((entry) => entry.name.length > 0 && entry.categoryId.length > 0);
}

function parsePois(val: any): PointOfInterestInput[] {
  if (!val) return [];
  try {
    return sanitizePois(JSON.parse(val));
  } catch {
    return [];
  }
}

export function createPhoto(
  id: string,
  filename: string,
  originalName: string,
  width: number,
  height: number,
  correspondences: CorrespondenceInput[],
  manualPlacement?: string | null,
  dsoIds?: string[],
  labels?: string[],
  notes?: string,
  integrations?: IntegrationInput[],
  thumbFilename?: string | null,
  observationDate?: string | null,
  pointsOfInterest?: PointOfInterestInput[],
  captureDetails?: Record<string, number | string> | null,
  gearSetupId?: string | null,
) {
  const sanitizedIntegrations = sanitizeIntegrationRows(integrations ?? []);
  const run = db.transaction(() => {
    insertPhoto.run(
      id,
      filename,
      originalName,
      width,
      height,
      manualPlacement ?? null,
      JSON.stringify(dsoIds ?? []),
      JSON.stringify(labels ?? []),
      JSON.stringify(sanitizePois(pointsOfInterest ?? [])),
      notes ?? '',
      JSON.stringify(sanitizedIntegrations),
      thumbFilename ?? null,
      observationDate ?? null,
      JSON.stringify(sanitizeCaptureDetails(captureDetails ?? {})),
      sanitizeSetupId(gearSetupId),
    );
    for (const c of correspondences) {
      insertCorrespondence.run(
        id,
        c.pointIndex,
        c.photoX,
        c.photoY,
        c.starHip,
        c.starName,
        c.starRa ?? null,
        c.starDec ?? null,
      );
    }
  });
  run();
}

/**
 * Map one raw `photos` table row (plus the correspondence rows for that photo) to the
 * serialized API shape. This is the **single source of truth** for what a photo looks
 * like over the wire: `getAllPhotos()` (GET /api/photos) and `getPhotoById()` (the
 * POST /api/photos response) both go through here, so the two can never drift and drop
 * a field. When you add a new metadata column, wire it in here once — nowhere else.
 */
function rowToPhoto(p: any, corr: any[]): Photo {
  return {
    id: p.id,
    filename: p.filename,
    originalName: p.original_name,
    width: p.width,
    height: p.height,
    createdAt: p.created_at,
    ...(p.manual_placement ? { manualPlacement: JSON.parse(p.manual_placement) } : {}),
    dsoIds: parseJsonArray(p.dso_ids),
    labels: parseJsonArray(p.labels),
    pointsOfInterest: parsePois(p.points_of_interest),
    notes: p.notes ?? '',
    integrations: parseIntegrationRows(p.integrations),
    observationDate: p.observation_date ?? null,
    captureDetails: parseCaptureDetails(p.capture_details),
    gearSetupId: p.gear_setup_id ?? null,
    thumbFilename: p.thumb_filename ?? null,
    correspondences: corr
      .filter((c) => c.photo_id === p.id)
      .map((c) => ({
        pointIndex: c.point_index,
        photoX: c.photo_x,
        photoY: c.photo_y,
        starHip: c.star_hip,
        starName: c.star_name,
        ...(c.star_ra != null ? { starRa: c.star_ra } : {}),
        ...(c.star_dec != null ? { starDec: c.star_dec } : {}),
      })),
  };
}

export function getAllPhotos() {
  const photos = selectPhotos.all() as any[];
  const allCorr = selectCorrespondences.all() as any[];
  return photos.map((p) => rowToPhoto(p, allCorr));
}

/**
 * One serialized photo by id, or `undefined` if there is no such row. Identical in
 * shape to a single `getAllPhotos()` entry (see `rowToPhoto`).
 */
export function getPhotoById(id: string) {
  const p = selectPhotoById.get(id) as any;
  if (!p) return undefined;
  return rowToPhoto(p, selectCorrespondencesForPhoto.all(id) as any[]);
}

export function deletePhoto(id: string): boolean {
  const result = deletePhotoStmt.run(id);
  return result.changes > 0;
}

export function getPhotoFilename(id: string): string | undefined {
  const row = selectFilename.get(id) as any;
  return row?.filename;
}

const updatePhotoManualPlacementStmt = db.prepare(
  'UPDATE photos SET manual_placement = ? WHERE id = ?',
);

export function updatePhotoManualPlacement(id: string, manualPlacement: string | null): boolean {
  const result = updatePhotoManualPlacementStmt.run(manualPlacement, id);
  return result.changes > 0;
}

function parseJsonArray(val: any): string[] {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseIntegrationRows(val: any): IntegrationInput[] {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    return sanitizeIntegrationRows(parsed);
  } catch {
    return [];
  }
}

const updatePhotoMetadataStmt = db.prepare(
  'UPDATE photos SET dso_ids = ?, labels = ?, points_of_interest = ?, notes = ?, integrations = ?, observation_date = ?, capture_details = ?, gear_setup_id = ? WHERE id = ?',
);

const updatePhotoMetadataWithNameStmt = db.prepare(
  'UPDATE photos SET dso_ids = ?, labels = ?, points_of_interest = ?, notes = ?, integrations = ?, observation_date = ?, capture_details = ?, gear_setup_id = ?, original_name = ? WHERE id = ?',
);

export function updatePhotoMetadata(
  id: string,
  dsoIds: string[],
  labels: string[],
  notes: string,
  originalName?: string,
  integrations?: IntegrationInput[],
  observationDate?: string | null,
  pointsOfInterest?: PointOfInterestInput[],
  captureDetails?: Record<string, number | string> | null,
  gearSetupId?: string | null,
): boolean {
  const sanitizedIntegrations = sanitizeIntegrationRows(integrations ?? []);
  const pois = JSON.stringify(sanitizePois(pointsOfInterest ?? []));
  const obsDate =
    typeof observationDate === 'string' && observationDate.length > 0
      ? observationDate.slice(0, 50)
      : null;
  const capture = JSON.stringify(sanitizeCaptureDetails(captureDetails ?? {}));
  const setupId = sanitizeSetupId(gearSetupId);
  if (originalName !== undefined) {
    const result = updatePhotoMetadataWithNameStmt.run(
      JSON.stringify(dsoIds),
      JSON.stringify(labels),
      pois,
      notes,
      JSON.stringify(sanitizedIntegrations),
      obsDate,
      capture,
      setupId,
      originalName,
      id,
    );
    return result.changes > 0;
  }
  const result = updatePhotoMetadataStmt.run(
    JSON.stringify(dsoIds),
    JSON.stringify(labels),
    pois,
    notes,
    JSON.stringify(sanitizedIntegrations),
    obsDate,
    capture,
    setupId,
    id,
  );
  return result.changes > 0;
}

const insertPhotoWithId = db.prepare(
  `INSERT OR IGNORE INTO photos (id, filename, original_name, width, height, created_at, manual_placement, dso_ids, labels, points_of_interest, notes, integrations, display_order, thumb_filename, observation_date, capture_details, gear_setup_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(display_order) + 1 FROM photos), 0), ?, ?, ?, ?)`,
);
const deletePhotoForReplace = db.prepare('DELETE FROM photos WHERE id = ?');

/**
 * Insert a photo with a caller-supplied UUID (used during import to preserve original IDs).
 * strategy='skip'    — does nothing if the ID already exists.
 * strategy='replace' — deletes the existing record first, then inserts the new one.
 * Returns 'imported' | 'skipped'.
 */
export function createPhotoWithId(
  id: string,
  filename: string,
  originalName: string,
  width: number,
  height: number,
  correspondences: CorrespondenceInput[],
  createdAt?: string | null,
  manualPlacement?: string | null,
  dsoIds?: string[],
  labels?: string[],
  notes?: string,
  strategy: 'skip' | 'replace' = 'skip',
  integrations?: IntegrationInput[],
  thumbFilename?: string | null,
  observationDate?: string | null,
  pointsOfInterest?: PointOfInterestInput[],
  captureDetails?: Record<string, number | string> | null,
  gearSetupId?: string | null,
): 'imported' | 'skipped' {
  const sanitizedIntegrations = sanitizeIntegrationRows(integrations ?? []);
  const run = db.transaction(() => {
    if (strategy === 'replace') {
      deletePhotoForReplace.run(id);
    }
    const result = insertPhotoWithId.run(
      id,
      filename,
      originalName,
      width,
      height,
      createdAt ?? new Date().toISOString(),
      manualPlacement ?? null,
      JSON.stringify(dsoIds ?? []),
      JSON.stringify(labels ?? []),
      JSON.stringify(sanitizePois(pointsOfInterest ?? [])),
      notes ?? '',
      JSON.stringify(sanitizedIntegrations),
      thumbFilename ?? null,
      observationDate ?? null,
      JSON.stringify(sanitizeCaptureDetails(captureDetails ?? {})),
      sanitizeSetupId(gearSetupId),
    );
    if (result.changes === 0) return 'skipped';
    for (const c of correspondences) {
      insertCorrespondence.run(
        id,
        c.pointIndex,
        c.photoX,
        c.photoY,
        c.starHip,
        c.starName,
        c.starRa ?? null,
        c.starDec ?? null,
      );
    }
    return 'imported';
  });
  return run() as 'imported' | 'skipped';
}

export function updatePhotoDrawOrder(photoIdsInOrder: string[]): boolean {
  const run = db.transaction(() => {
    let changed = false;
    for (let i = 0; i < photoIdsInOrder.length; i++) {
      const result = updatePhotoDisplayOrderStmt.run(i, photoIdsInOrder[i]);
      if (result.changes > 0) changed = true;
    }
    return changed;
  });
  return run() as boolean;
}

const checkExistStmt = db.prepare('SELECT id FROM photos WHERE id = ?');

/** Returns the subset of provided IDs that already exist in the database. */
export function checkPhotosExist(ids: string[]): string[] {
  return ids.filter((id) => checkExistStmt.get(id) != null);
}

const checkExistByNameStmt = db.prepare('SELECT id FROM photos WHERE original_name = ?');

/** Returns the subset of provided original filenames that already exist in the database, with their current DB id. */
export function checkPhotosExistByName(names: string[]): { originalName: string; id: string }[] {
  const result: { originalName: string; id: string }[] = [];
  for (const name of names) {
    const row = checkExistByNameStmt.get(name) as { id: string } | undefined;
    if (row != null) result.push({ originalName: name, id: row.id });
  }
  return result;
}

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

// ─── Bulk-delete helpers (used by "Delete all data" feature) ───────────────────

const deleteAllPhotosStmt = db.prepare('DELETE FROM photos');

/** Delete all photo rows from the DB (no file removal). Returns number of rows deleted. */
export function deleteAllPhotoMetadata(): number {
  return deleteAllPhotosStmt.run().changes;
}
