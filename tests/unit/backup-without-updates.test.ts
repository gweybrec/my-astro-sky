// @vitest-environment node
/**
 * The full backup the desktop app offers after a failed database update: it reads a database the updates have not
 * reached, without updating it, and writes the usual archive.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';

const nodeRequire = createRequire(import.meta.url);
const unzipper = nodeRequire('unzipper') as typeof import('unzipper');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myastrosky-backup-without-updates-'));
const uploadsDir = path.join(dir, 'uploads');
const dbPath = path.join(dir, 'data.db');

let saveBackupWithoutUpdates: (outputPath: string, dbPath?: string) => Promise<void>;

/** A version-14 database (before the photo turn column) with one photo, its picture and one plan. */
async function olderDatabase(): Promise<void> {
  const conn = new Database(dbPath);
  await initSchema(createBetterSqliteDb(conn));
  conn
    .prepare(
      "INSERT INTO photos (id, filename, original_name, width, height) VALUES ('p1', 'p1.jpg', 'M42.jpg', 40, 30)",
    )
    .run();
  conn
    .prepare(
      "INSERT INTO plans (id, name, position, created_at) VALUES ('plan1', 'Orion', 0, '2026-01-01T00:00:00.000Z')",
    )
    .run();
  conn.exec('ALTER TABLE photos DROP COLUMN quarter_turns');
  conn.prepare('UPDATE schema_version SET version = 14').run();
  conn.close();
  fs.writeFileSync(path.join(uploadsDir, 'p1.jpg'), Buffer.from('picture bytes'));
}

beforeAll(async () => {
  fs.mkdirSync(uploadsDir);
  vi.stubEnv('UPLOADS_DIR', uploadsDir);
  ({ saveBackupWithoutUpdates } = await import('../../server/backup-without-updates'));
  await olderDatabase();
});

afterEach(() => {
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.zip')) fs.rmSync(path.join(dir, name));
  }
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('saveBackupWithoutUpdates', () => {
  it('writes the photos, their pictures and the plans of an older database, and leaves it at its version', async () => {
    const out = path.join(dir, 'backup.zip');
    await saveBackupWithoutUpdates(out, dbPath);

    const zip = await unzipper.Open.file(out);
    const read = async (name: string) =>
      (await zip.files.find((f) => f.path === name)!.buffer()).toString('utf8');
    expect(zip.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(['manifest.json', 'images/p1.jpg', 'plans.json', 'gear-setups.json']),
    );
    const manifest = JSON.parse(await read('manifest.json'));
    expect(manifest.photos).toMatchObject([
      { id: 'p1', originalName: 'M42.jpg', width: 40, height: 30 },
    ]);
    expect(await read('images/p1.jpg')).toBe('picture bytes');
    expect(JSON.parse(await read('plans.json'))).toMatchObject([{ id: 'plan1', name: 'Orion' }]);

    const conn = new Database(dbPath);
    expect(conn.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 14 });
    conn.close();
  });

  it('fails without leaving a file when the database cannot be opened', async () => {
    const out = path.join(dir, 'missing.zip');
    await expect(saveBackupWithoutUpdates(out, path.join(dir, 'no-such.db'))).rejects.toThrow();
    expect(fs.existsSync(out)).toBe(false);
  });
});
