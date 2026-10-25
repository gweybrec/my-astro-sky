// @vitest-environment node
/**
 * The phone's backend, assembled by `createPhoneBackend` on fakes of the plugin objects: the backend contract
 * passes on it, and the pieces specific to the phone (the share sheet, the archive limit, the key) work.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { FileSource } from '@myastrosky/core/backend';
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
