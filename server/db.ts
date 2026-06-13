import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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

// User-created custom gear (telescopes, cameras, accessories)
db.exec(`
  CREATE TABLE IF NOT EXISTS custom_gear (
    id   TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('telescope','camera','accessory')),
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

const insertPhoto = db.prepare(
  `INSERT INTO photos (id, filename, original_name, width, height, manual_placement, dso_ids, labels, notes, integrations, display_order, thumb_filename, observation_date)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(display_order) + 1 FROM photos), 0), ?, ?)`
);
const insertCorrespondence = db.prepare(
  'INSERT INTO star_correspondences (photo_id, point_index, photo_x, photo_y, star_hip, star_name, star_ra, star_dec) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const selectPhotos = db.prepare('SELECT * FROM photos ORDER BY display_order ASC, created_at ASC, id ASC');
const selectCorrespondences = db.prepare(
  'SELECT * FROM star_correspondences ORDER BY point_index'
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
) {
  const sanitizedIntegrations = sanitizeIntegrationRows(integrations ?? []);
  const run = db.transaction(() => {
    insertPhoto.run(
      id, filename, originalName, width, height,
      manualPlacement ?? null,
      JSON.stringify(dsoIds ?? []),
      JSON.stringify(labels ?? []),
      notes ?? '',
      JSON.stringify(sanitizedIntegrations),
      thumbFilename ?? null,
      observationDate ?? null,
    );
    for (const c of correspondences) {
      insertCorrespondence.run(id, c.pointIndex, c.photoX, c.photoY, c.starHip, c.starName, c.starRa ?? null, c.starDec ?? null);
    }
  });
  run();
}

export function getAllPhotos() {
  const photos = selectPhotos.all() as any[];
  const allCorr = selectCorrespondences.all() as any[];

  return photos.map(p => ({
    id: p.id,
    filename: p.filename,
    originalName: p.original_name,
    width: p.width,
    height: p.height,
    createdAt: p.created_at,
    ...(p.manual_placement ? { manualPlacement: JSON.parse(p.manual_placement) } : {}),
    dsoIds: parseJsonArray(p.dso_ids),
    labels: parseJsonArray(p.labels),
    notes: p.notes ?? '',
    integrations: parseIntegrationRows(p.integrations),
    observationDate: p.observation_date ?? null,
    thumbFilename: p.thumb_filename ?? null,
    correspondences: allCorr
      .filter(c => c.photo_id === p.id)
      .map(c => ({
        pointIndex: c.point_index,
        photoX: c.photo_x,
        photoY: c.photo_y,
        starHip: c.star_hip,
        starName: c.star_name,
        ...(c.star_ra != null ? { starRa: c.star_ra } : {}),
        ...(c.star_dec != null ? { starDec: c.star_dec } : {}),
      })),
  }));
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
  'UPDATE photos SET manual_placement = ? WHERE id = ?'
);

export function updatePhotoManualPlacement(
  id: string,
  manualPlacement: string | null
): boolean {
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
  'UPDATE photos SET dso_ids = ?, labels = ?, notes = ?, integrations = ?, observation_date = ? WHERE id = ?'
);

const updatePhotoMetadataWithNameStmt = db.prepare(
  'UPDATE photos SET dso_ids = ?, labels = ?, notes = ?, integrations = ?, observation_date = ?, original_name = ? WHERE id = ?'
);

export function updatePhotoMetadata(
  id: string,
  dsoIds: string[],
  labels: string[],
  notes: string,
  originalName?: string,
  integrations?: IntegrationInput[],
  observationDate?: string | null,
): boolean {
  const sanitizedIntegrations = sanitizeIntegrationRows(integrations ?? []);
  const obsDate = typeof observationDate === 'string' && observationDate.length > 0
    ? observationDate.slice(0, 50)
    : null;
  if (originalName !== undefined) {
    const result = updatePhotoMetadataWithNameStmt.run(
      JSON.stringify(dsoIds),
      JSON.stringify(labels),
      notes,
      JSON.stringify(sanitizedIntegrations),
      obsDate,
      originalName,
      id,
    );
    return result.changes > 0;
  }
  const result = updatePhotoMetadataStmt.run(
    JSON.stringify(dsoIds),
    JSON.stringify(labels),
    notes,
    JSON.stringify(sanitizedIntegrations),
    obsDate,
    id,
  );
  return result.changes > 0;
}

const insertPhotoWithId = db.prepare(
  `INSERT OR IGNORE INTO photos (id, filename, original_name, width, height, created_at, manual_placement, dso_ids, labels, notes, integrations, display_order, thumb_filename, observation_date)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(display_order) + 1 FROM photos), 0), ?, ?)`
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
): 'imported' | 'skipped' {
  const sanitizedIntegrations = sanitizeIntegrationRows(integrations ?? []);
  const run = db.transaction(() => {
    if (strategy === 'replace') {
      deletePhotoForReplace.run(id);
    }
    const result = insertPhotoWithId.run(
      id, filename, originalName, width, height,
      createdAt ?? new Date().toISOString(),
      manualPlacement ?? null,
      JSON.stringify(dsoIds ?? []),
      JSON.stringify(labels ?? []),
      notes ?? '',
      JSON.stringify(sanitizedIntegrations),
      thumbFilename ?? null,
      observationDate ?? null,
    );
    if (result.changes === 0) return 'skipped';
    for (const c of correspondences) {
      insertCorrespondence.run(id, c.pointIndex, c.photoX, c.photoY, c.starHip, c.starName, c.starRa ?? null, c.starDec ?? null);
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
  return ids.filter(id => checkExistStmt.get(id) != null);
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
const ENC_PREFIX = 'enc:v1:aesgcm:';

function getSettingsEncryptionKey(): Buffer | null {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) return null;
    return key;
  } catch {
    return null;
  }
}

function encryptSecret(value: string): string {
  const key = getSettingsEncryptionKey();
  if (!key) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decryptSecret(value: string): string | null {
  if (!value.startsWith(ENC_PREFIX)) return value;
  const key = getSettingsEncryptionKey();
  if (!key) return null;
  const payload = value.slice(ENC_PREFIX.length);
  const parts = payload.split(':');
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(ctB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

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

export function closeDatabase(): void {
  db.close();
}

// ─── DSO user overrides ────────────────────────────────────────────────────────

const getDsoOverrideStmt = db.prepare('SELECT data FROM dso_overrides WHERE id = ?');
const getAllDsoOverridesStmt = db.prepare('SELECT id, data FROM dso_overrides');
const upsertDsoOverrideStmt = db.prepare('INSERT OR REPLACE INTO dso_overrides (id, data) VALUES (?, ?)');
const deleteDsoOverrideByIdStmt = db.prepare('DELETE FROM dso_overrides WHERE id = ?');

export function getDsoOverride(id: string): object | undefined {
  const row = getDsoOverrideStmt.get(id) as { data: string } | undefined;
  if (!row) return undefined;
  try { return JSON.parse(row.data); } catch { return undefined; }
}

export function getAllDsoOverrides(): Record<string, object> {
  const rows = getAllDsoOverridesStmt.all() as { id: string; data: string }[];
  const result: Record<string, object> = {};
  for (const row of rows) {
    try { result[row.id] = JSON.parse(row.data); } catch { /* skip invalid */ }
  }
  return result;
}

export function upsertDsoOverride(id: string, data: object): void {
  upsertDsoOverrideStmt.run(id, JSON.stringify(data));
}

export function deleteDsoOverride(id: string): void {
  deleteDsoOverrideByIdStmt.run(id);
}

// ─── Custom gear ───────────────────────────────────────────────────────────────

const getAllCustomGearStmt = db.prepare('SELECT id, type, data FROM custom_gear');
const upsertCustomGearStmt = db.prepare('INSERT OR REPLACE INTO custom_gear (id, type, data) VALUES (?, ?, ?)');
const deleteCustomGearStmt = db.prepare('DELETE FROM custom_gear WHERE id = ?');
const getCustomGearByTypeStmt = db.prepare('SELECT id, type, data FROM custom_gear WHERE type = ?');

export interface CustomGearRow {
  id: string;
  type: 'telescope' | 'camera' | 'accessory';
  data: string;
}

export function getAllCustomGear(): CustomGearRow[] {
  return getAllCustomGearStmt.all() as CustomGearRow[];
}

export function getCustomGearByType(type: 'telescope' | 'camera' | 'accessory'): CustomGearRow[] {
  return getCustomGearByTypeStmt.all(type) as CustomGearRow[];
}

export function upsertCustomGear(id: string, type: 'telescope' | 'camera' | 'accessory', data: object): void {
  upsertCustomGearStmt.run(id, type, JSON.stringify(data));
}

export function deleteCustomGear(id: string): boolean {
  const result = deleteCustomGearStmt.run(id);
  return result.changes > 0;
}

// ─── Gear setups ──────────────────────────────────────────────────────────────

export interface GearSetupRow {
  id: string;
  name: string;
  telescope_id: string;
  camera_id: string;
  accessory_id: string | null;
  enabled: number; // 0 | 1
}

const getAllGearSetupsStmt        = db.prepare('SELECT * FROM gear_setups ORDER BY rowid ASC');
const upsertGearSetupStmt         = db.prepare(
  `INSERT OR REPLACE INTO gear_setups (id, name, telescope_id, camera_id, accessory_id, enabled)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
const updateGearSetupEnabledStmt  = db.prepare('UPDATE gear_setups SET enabled = ? WHERE id = ?');
const deleteGearSetupStmt         = db.prepare('DELETE FROM gear_setups WHERE id = ?');
const deleteAllGearSetupsStmt     = db.prepare('DELETE FROM gear_setups');

export function getAllGearSetups(): GearSetupRow[] {
  return getAllGearSetupsStmt.all() as GearSetupRow[];
}

export function upsertGearSetup(row: GearSetupRow): void {
  upsertGearSetupStmt.run(
    row.id, row.name, row.telescope_id, row.camera_id,
    row.accessory_id ?? null, row.enabled,
  );
}

export function updateGearSetupEnabled(id: string, enabled: boolean): boolean {
  const result = updateGearSetupEnabledStmt.run(enabled ? 1 : 0, id);
  return result.changes > 0;
}

export function deleteGearSetup(id: string): boolean {
  const result = deleteGearSetupStmt.run(id);
  return result.changes > 0;
}

export function deleteAllGearSetups(): number {
  return deleteAllGearSetupsStmt.run().changes;
}

// ─── Bulk-delete helpers (used by "Delete all data" feature) ───────────────────

const deleteAllPhotosStmt = db.prepare('DELETE FROM photos');
const deleteAllDsoOverridesStmt = db.prepare('DELETE FROM dso_overrides');
const deleteAllCustomGearStmt = db.prepare("DELETE FROM custom_gear WHERE id LIKE 'custom-%'");

/** Delete all photo rows from the DB (no file removal). Returns number of rows deleted. */
export function deleteAllPhotoMetadata(): number {
  return deleteAllPhotosStmt.run().changes;
}

/** Delete all DSO override rows. Returns number of rows deleted. */
export function deleteAllDsoOverrides(): number {
  return deleteAllDsoOverridesStmt.run().changes;
}

/** Delete all custom gear rows. Returns number of rows deleted. */
export function deleteAllCustomGear(): number {
  return deleteAllCustomGearStmt.run().changes;
}
