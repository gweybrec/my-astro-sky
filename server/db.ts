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

// Night plans (named target lists) + their entries (one DSO each).
db.exec(`
  CREATE TABLE IF NOT EXISTS plans (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    night_of   TEXT,
    setup_id   TEXT
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
    mosaic_id TEXT
  );
  CREATE TABLE IF NOT EXISTS plan_mosaics (
    id          TEXT PRIMARY KEY,
    plan_id     TEXT NOT NULL,
    dso_id      TEXT,
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

// ─── Night plans ────────────────────────────────────────────────────────────

export interface PlanRow {
  id: string;
  name: string;
  position: number;
  created_at: string;
  night_of: string | null;
  setup_id: string | null;
}

export interface PlanEntryRow {
  id: string;
  plan_id: string;
  dso_id: string | null;
  position: number;
  pa_deg: number | null;
  ra: number | null;
  dec: number | null;
  notes: string | null;
  /** Mosaic this entry is a tile of, or null for a standalone frame. */
  mosaic_id: string | null;
}

export interface PlanMosaicRow {
  id: string;
  plan_id: string;
  dso_id: string | null;
  center_ra: number;
  center_dec: number;
  pa_deg: number;
  overlap_pct: number;
  cols: number;
  rows: number;
  position: number;
}

const getPlansStmt              = db.prepare('SELECT * FROM plans ORDER BY position ASC, rowid ASC');
const getPlanStmt               = db.prepare('SELECT * FROM plans WHERE id = ?');
const insertPlanStmt            = db.prepare(
  'INSERT INTO plans (id, name, position, created_at, night_of, setup_id) VALUES (?, ?, ?, ?, ?, ?)',
);
const renamePlanStmt            = db.prepare('UPDATE plans SET name = ? WHERE id = ?');
const updatePlanSettingsStmt    = db.prepare('UPDATE plans SET night_of = ?, setup_id = ? WHERE id = ?');
const updatePlanPositionStmt    = db.prepare('UPDATE plans SET position = ? WHERE id = ?');
const deletePlanStmt            = db.prepare('DELETE FROM plans WHERE id = ?');
const deleteAllPlansStmt        = db.prepare('DELETE FROM plans');

const getPlanEntriesStmt        = db.prepare('SELECT * FROM plan_entries WHERE plan_id = ? ORDER BY position ASC, rowid ASC');
const getAllPlanEntriesStmt     = db.prepare('SELECT * FROM plan_entries ORDER BY position ASC, rowid ASC');
const planEntryExistsStmt       = db.prepare('SELECT 1 FROM plan_entries WHERE plan_id = ? AND dso_id = ?');
const insertPlanEntryStmt       = db.prepare(
  'INSERT INTO plan_entries (id, plan_id, dso_id, position, pa_deg, ra, dec, notes, mosaic_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
const deletePlanEntryStmt       = db.prepare('DELETE FROM plan_entries WHERE id = ?');
const deletePlanEntriesStmt     = db.prepare('DELETE FROM plan_entries WHERE plan_id = ?');

const getPlanMosaicsStmt        = db.prepare('SELECT * FROM plan_mosaics WHERE plan_id = ? ORDER BY position ASC, rowid ASC');
const getAllPlanMosaicsStmt     = db.prepare('SELECT * FROM plan_mosaics ORDER BY position ASC, rowid ASC');
const insertPlanMosaicStmt      = db.prepare(
  'INSERT INTO plan_mosaics (id, plan_id, dso_id, center_ra, center_dec, pa_deg, overlap_pct, cols, rows, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
const updatePlanMosaicStmt      = db.prepare(
  'UPDATE plan_mosaics SET dso_id = ?, center_ra = ?, center_dec = ?, pa_deg = ?, overlap_pct = ?, cols = ?, rows = ? WHERE id = ?',
);
const deletePlanMosaicStmt      = db.prepare('DELETE FROM plan_mosaics WHERE id = ?');
const deletePlanMosaicsStmt     = db.prepare('DELETE FROM plan_mosaics WHERE plan_id = ?');
const deleteMosaicTilesStmt     = db.prepare('DELETE FROM plan_entries WHERE mosaic_id = ?');
// A mosaic represents its whole target, so it replaces any standalone frame for
// the same DSO (mosaic tiles carry a mosaic_id; standalone entries don't).
const deleteStandaloneEntryByDsoStmt = db.prepare('DELETE FROM plan_entries WHERE plan_id = ? AND dso_id = ? AND mosaic_id IS NULL');
const updatePlanEntryPositionStmt = db.prepare('UPDATE plan_entries SET position = ? WHERE id = ? AND plan_id = ?');
const updatePlanEntryPaStmt       = db.prepare('UPDATE plan_entries SET pa_deg = ? WHERE id = ?');

export function getPlans(): PlanRow[] {
  return getPlansStmt.all() as PlanRow[];
}

export function getPlan(id: string): PlanRow | undefined {
  return getPlanStmt.get(id) as PlanRow | undefined;
}

export function getPlanEntries(planId: string): PlanEntryRow[] {
  return getPlanEntriesStmt.all(planId) as PlanEntryRow[];
}

export function getAllPlanEntries(): PlanEntryRow[] {
  return getAllPlanEntriesStmt.all() as PlanEntryRow[];
}

export function createPlan(row: PlanRow): void {
  insertPlanStmt.run(row.id, row.name, row.position, row.created_at, row.night_of ?? null, row.setup_id ?? null);
}

export function renamePlan(id: string, name: string): boolean {
  return renamePlanStmt.run(name, id).changes > 0;
}

export function updatePlanSettings(id: string, nightOf: string | null, setupId: string | null): boolean {
  return updatePlanSettingsStmt.run(nightOf, setupId, id).changes > 0;
}

export function deletePlan(id: string): boolean {
  return db.transaction(() => {
    deletePlanEntriesStmt.run(id);
    deletePlanMosaicsStmt.run(id);
    return deletePlanStmt.run(id).changes > 0;
  })();
}

export function deleteAllPlans(): number {
  return db.transaction(() => {
    db.prepare('DELETE FROM plan_entries').run();
    db.prepare('DELETE FROM plan_mosaics').run();
    return deleteAllPlansStmt.run().changes;
  })();
}

// ─── Mosaics (a group of tile entries covering one target) ─────────────────────

export function getPlanMosaics(planId: string): PlanMosaicRow[] {
  return getPlanMosaicsStmt.all(planId) as PlanMosaicRow[];
}

export function getAllPlanMosaics(): PlanMosaicRow[] {
  return getAllPlanMosaicsStmt.all() as PlanMosaicRow[];
}

function nextPlanMosaicPosition(planId: string): number {
  const r = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM plan_mosaics WHERE plan_id = ?').get(planId) as { pos: number };
  return r.pos;
}

/** A single mosaic tile to persist as a plan entry (target derived from the mosaic). */
export interface MosaicTileInput {
  ra: number;
  dec: number;
  paDeg: number | null;
}

/**
 * Create a mosaic and its tile entries in one transaction. The tiles are
 * persisted as plan_entries tagged with the new mosaic id, all targeting the
 * mosaic's DSO. Returns the new mosaic id.
 */
export function createPlanMosaic(
  row: Omit<PlanMosaicRow, 'position'> & { position?: number },
  tiles: MosaicTileInput[],
  replaceEntryIds: string[] = [],
): string {
  return db.transaction(() => {
    // The mosaic stands in for the whole target — drop any single frame for the
    // same DSO, plus the specific standalone frames the client says it replaces
    // (e.g. a custom-location frame sitting on the target), so none are listed
    // alongside the mosaic.
    if (row.dso_id) deleteStandaloneEntryByDsoStmt.run(row.plan_id, row.dso_id);
    for (const id of replaceEntryIds) deletePlanEntryStmt.run(id);
    const position = row.position ?? nextPlanMosaicPosition(row.plan_id);
    insertPlanMosaicStmt.run(
      row.id, row.plan_id, row.dso_id ?? null, row.center_ra, row.center_dec,
      row.pa_deg, row.overlap_pct, row.cols, row.rows, position,
    );
    let pos = nextPlanEntryPosition(row.plan_id);
    for (const t of tiles) {
      addPlanEntry({
        id: `tile-${row.id}-${pos}`, plan_id: row.plan_id, dso_id: row.dso_id ?? null,
        position: pos++, pa_deg: t.paDeg ?? null, ra: t.ra, dec: t.dec, notes: null, mosaic_id: row.id,
      });
    }
    return row.id;
  })();
}

/**
 * Replace a mosaic's parameters and its tile set. Old tiles (entries with this
 * mosaic_id) are removed and the supplied tiles inserted. Returns false if the
 * mosaic doesn't exist.
 */
export function updatePlanMosaic(
  mosaicId: string,
  fields: { dsoId: string | null; centerRa: number; centerDec: number; paDeg: number; overlapPct: number; cols: number; rows: number },
  tiles: MosaicTileInput[],
): boolean {
  return db.transaction(() => {
    const m = db.prepare('SELECT plan_id FROM plan_mosaics WHERE id = ?').get(mosaicId) as { plan_id: string } | undefined;
    if (!m) return false;
    updatePlanMosaicStmt.run(
      fields.dsoId ?? null, fields.centerRa, fields.centerDec, fields.paDeg,
      fields.overlapPct, fields.cols, fields.rows, mosaicId,
    );
    deleteMosaicTilesStmt.run(mosaicId);
    let pos = nextPlanEntryPosition(m.plan_id);
    for (const t of tiles) {
      addPlanEntry({
        id: `tile-${mosaicId}-${pos}`, plan_id: m.plan_id, dso_id: fields.dsoId ?? null,
        position: pos++, pa_deg: t.paDeg ?? null, ra: t.ra, dec: t.dec, notes: null, mosaic_id: mosaicId,
      });
    }
    return true;
  })();
}

/** Delete a mosaic and all of its tile entries. */
export function deletePlanMosaic(mosaicId: string): boolean {
  return db.transaction(() => {
    deleteMosaicTilesStmt.run(mosaicId);
    return deletePlanMosaicStmt.run(mosaicId).changes > 0;
  })();
}

export function reorderPlans(ids: string[]): void {
  db.transaction(() => {
    ids.forEach((id, i) => updatePlanPositionStmt.run(i, id));
  })();
}

export function planEntryExists(planId: string, dsoId: string): boolean {
  return planEntryExistsStmt.get(planId, dsoId) !== undefined;
}

export function addPlanEntry(row: PlanEntryRow): void {
  insertPlanEntryStmt.run(
    row.id, row.plan_id, row.dso_id ?? null, row.position, row.pa_deg ?? null,
    row.ra ?? null, row.dec ?? null, row.notes ?? null, row.mosaic_id ?? null,
  );
}

export function nextPlanEntryPosition(planId: string): number {
  const r = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM plan_entries WHERE plan_id = ?').get(planId) as { pos: number };
  return r.pos;
}

export function removePlanEntry(entryId: string): boolean {
  return deletePlanEntryStmt.run(entryId).changes > 0;
}

export function updatePlanEntryPA(entryId: string, paDeg: number | null): boolean {
  return updatePlanEntryPaStmt.run(paDeg, entryId).changes > 0;
}

/**
 * Update any subset of a plan entry's framing fields (position angle, frame
 * centre ra/dec, and target dso). Only the keys present in `fields` are
 * written, so a position drag and a rotation can persist independently.
 */
export function updatePlanEntryFrame(
  entryId: string,
  fields: { ra?: number | null; dec?: number | null; paDeg?: number | null; dsoId?: string | null },
): boolean {
  const sets: string[] = [];
  const vals: Array<number | string | null> = [];
  if ('ra' in fields) { sets.push('ra = ?'); vals.push(fields.ra ?? null); }
  if ('dec' in fields) { sets.push('dec = ?'); vals.push(fields.dec ?? null); }
  if ('paDeg' in fields) { sets.push('pa_deg = ?'); vals.push(fields.paDeg ?? null); }
  if ('dsoId' in fields) { sets.push('dso_id = ?'); vals.push(fields.dsoId ?? null); }
  if (sets.length === 0) return false;
  vals.push(entryId);
  return db.prepare(`UPDATE plan_entries SET ${sets.join(', ')} WHERE id = ?`).run(...vals).changes > 0;
}

export function reorderPlanEntries(planId: string, ids: string[]): void {
  db.transaction(() => {
    ids.forEach((id, i) => updatePlanEntryPositionStmt.run(i, id, planId));
  })();
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
