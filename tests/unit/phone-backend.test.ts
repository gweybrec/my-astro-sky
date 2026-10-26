// @vitest-environment node
/**
 * The phone's backend, assembled by `createPhoneBackend` on fakes of the plugin objects: the backend contract
 * passes on it, and the pieces specific to the phone (the share sheet, the archive limit, the key) work.
 */
import Database from 'better-sqlite3';
import { unzipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
import type { FileSource } from '@myastrosky/core/backend';
import { FULL_BACKUP_OPTIONS } from '@myastrosky/core/backup-selection';
import { initSchema } from '@myastrosky/core/db/schema';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { createFakeConnection } from '../helpers/fake-sqlite-connection';
import { createPhoneBackend, MAX_WHOLE_FILE_BYTES } from '@myastrosky/backend-local/phone-backend';
import { describeBackendContract } from '../helpers/backend-contract';
import { installFakeInternet, releaseFakeInternet } from '../helpers/contract-shared';
import { makePhoneContractSetup, makePhonePlatform } from '../helpers/phone-contract-backend';

installFakeInternet();
afterAll(() => releaseFakeInternet());

describeBackendContract('phone backend over fake plugins', makePhoneContractSetup);

describe('createPhoneBackend', () => {
  it('creates the schema and the default categories at start-up', async () => {
    const { platform } = await makePhonePlatform();
    const backend = await createPhoneBackend(platform);
    expect((await backend.poiCategories.list()).length).toBeGreaterThan(0);
  });

  it('withoutUpdates exports a database the updates have not reached, and writes nothing to it', async () => {
    const raw = new Database(':memory:');
    await initSchema(createBetterSqliteDb(raw));
    raw
      .prepare(
        "INSERT INTO photos (id, filename, original_name, width, height) VALUES ('p1', 'p1.jpg', 'M42.jpg', 40, 30)",
      )
      .run();
    raw.exec('ALTER TABLE photos DROP COLUMN quarter_turns');
    raw.prepare('UPDATE schema_version SET version = 14').run();
    const { platform, fake, shared } = await makePhonePlatform();
    platform.sqliteConnection = createFakeConnection({ raw });

    const backend = await createPhoneBackend(platform, { withoutUpdates: true });
    await backend.backup.exportToUser({ options: FULL_BACKUP_OPTIONS });

    const zip = unzipSync(fake.files.get(`exports/${shared[0].name}`)!);
    const manifest = JSON.parse(new TextDecoder().decode(zip['manifest.json']));
    expect(manifest.photos).toMatchObject([{ id: 'p1', originalName: 'M42.jpg' }]);
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(['plans.json', 'poi-categories.json']));
    expect(raw.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 14 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM poi_categories').get()).toEqual({ n: 0 });
  });

  it('saveFile writes the file in the cache directory and opens the share sheet on its address', async () => {
    const { platform, fake, shared } = await makePhonePlatform();
    const backend = await createPhoneBackend(platform);
    await backend.backup.exportToUser({ photos: true } as never);
    expect(shared).toHaveLength(1);
    expect(shared[0].uri).toContain('/exports/');
    const bytes = fake.files.get(`exports/${shared[0].name}`)!;
    expect(bytes.length).toBeGreaterThan(0);
    expect(fake.maxDataLength).toBeLessThanOrEqual(Math.ceil((1024 * 1024) / 3) * 4);
  });

  it('restores a ZIP backup by pieces, never reading the whole file', async () => {
    const { platform, fake, shared } = await makePhonePlatform();
    const backend = await createPhoneBackend(platform);
    await backend.backup.exportToUser({
      options: { includeSetups: true },
      ids: [],
    } as never);
    const bytes = fake.files.get(`exports/${shared[0].name}`)!;
    const file: FileSource = {
      name: shared[0].name,
      size: bytes.length,
      read: async () => {
        throw new Error('the whole file was read');
      },
      readRange: async (start, end) => bytes.slice(start, end),
    };
    const preview = await backend.backup.preview(file);
    expect(preview.images).toEqual([]);
    await expect(backend.backup.restore(file, {} as never)).resolves.toMatchObject({
      imported: 0,
    });
  });

  it('refuses a file read whole above the limit with BACKUP_TOO_LARGE, before reading it', async () => {
    expect(MAX_WHOLE_FILE_BYTES).toBe(300 * 1024 * 1024);
    const backend = await createPhoneBackend((await makePhonePlatform()).platform);
    let reads = 0;
    const file: FileSource = {
      name: 'photos.json',
      size: MAX_WHOLE_FILE_BYTES + 1,
      read: async () => {
        reads++;
        return new Uint8Array();
      },
    };
    await expect(backend.backup.preview(file)).rejects.toMatchObject({
      kind: 'invalid',
      code: 'BACKUP_TOO_LARGE',
    });
    expect(reads).toBe(0);
  });
});
