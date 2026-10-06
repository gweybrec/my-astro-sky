import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import type { SettingsService } from '@myastrosky/core/services/settings';

/** The settings service on the real database module and the real secret codec, as the server builds it. */
async function openSettings(): Promise<{ settings: SettingsService; closeDatabase: () => void }> {
  const { getConnection, closeDatabase } = await import('../../server/db.js');
  const { createBetterSqliteDb } = await import('../../server/sqlite-adapter.js');
  const { createServerSecretCodec } = await import('../../server/secret-codec.js');
  const { createSettingsService } = await import('@myastrosky/core/services/settings');
  const settings = createSettingsService({
    db: createBetterSqliteDb(getConnection()),
    secrets: createServerSecretCodec(),
    env: (k) => process.env[k],
  });
  return { settings, closeDatabase };
}

describe('settings security behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DB_PATH', ':memory:');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers env value for ASTROMETRY_API_KEY over DB value', async () => {
    vi.stubEnv('ASTROMETRY_API_KEY', 'env-key');
    const { settings } = await openSettings();
    await settings.set('ASTROMETRY_API_KEY', 'db-key');
    expect(await settings.get('ASTROMETRY_API_KEY')).toBe('env-key');
  });

  it('falls back to DB value for ASTROMETRY_API_KEY when env is unset', async () => {
    const { settings } = await openSettings();
    await settings.set('ASTROMETRY_API_KEY', 'db-key');
    expect(await settings.get('ASTROMETRY_API_KEY')).toBe('db-key');
  });

  it('keeps DB precedence for non-secret settings', async () => {
    vi.stubEnv('ASTAP_PATH', '/env/astap');
    const { settings } = await openSettings();
    await settings.set('ASTAP_PATH', '/db/astap');
    expect(await settings.get('ASTAP_PATH')).toBe('/db/astap');
  });

  it('keeps env fallback for non-secret settings when DB row missing', async () => {
    vi.stubEnv('SOLVE_FIELD_PATH', '/env/solve-field');
    const { settings } = await openSettings();
    expect(await settings.get('SOLVE_FIELD_PATH')).toBe('/env/solve-field');
  });

  it('remove deletes DB value for secret setting', async () => {
    const { settings } = await openSettings();
    await settings.set('ASTROMETRY_API_KEY', 'db-key');
    expect(await settings.get('ASTROMETRY_API_KEY')).toBe('db-key');
    await settings.remove('ASTROMETRY_API_KEY');
    expect(await settings.get('ASTROMETRY_API_KEY')).toBeUndefined();
  });

  it('remove preserves env-managed secret visibility', async () => {
    vi.stubEnv('ASTROMETRY_API_KEY', 'env-key');
    const { settings } = await openSettings();
    await settings.set('ASTROMETRY_API_KEY', 'db-key');
    await settings.remove('ASTROMETRY_API_KEY');
    expect(await settings.get('ASTROMETRY_API_KEY')).toBe('env-key');
  });

  it('stores secret setting encrypted when SETTINGS_ENCRYPTION_KEY is configured', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-settings-enc-'));
    const dbPath = path.join(tmpDir, 'settings.db');
    vi.stubEnv('DB_PATH', dbPath);
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    vi.resetModules();

    const { settings, closeDatabase } = await openSettings();
    await settings.set('ASTROMETRY_API_KEY', 'super-secret');

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ASTROMETRY_API_KEY') as
      { value: string } | undefined;
    db.close();

    expect(row).toBeDefined();
    expect(row!.value.startsWith('enc:v1:aesgcm:')).toBe(true);
    expect(row!.value).not.toContain('super-secret');
    expect(await settings.get('ASTROMETRY_API_KEY')).toBe('super-secret');

    closeDatabase();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns undefined for encrypted secret when encryption key is missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-settings-enc-'));
    const dbPath = path.join(tmpDir, 'settings.db');

    vi.stubEnv('DB_PATH', dbPath);
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'));
    vi.resetModules();
    {
      const { settings, closeDatabase } = await openSettings();
      await settings.set('ASTROMETRY_API_KEY', 'super-secret');
      closeDatabase();
    }

    vi.unstubAllEnvs();
    vi.stubEnv('DB_PATH', dbPath);
    vi.resetModules();

    const { settings, closeDatabase } = await openSettings();
    expect(await settings.get('ASTROMETRY_API_KEY')).toBeUndefined();
    closeDatabase();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
