// @vitest-environment node
/**
 * The phone's backend, assembled by `createPhoneBackend` on fakes of the plugin objects: the backend contract
 * passes on it, and the pieces specific to the phone (the share sheet, the archive limit, the key) work.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { openZipBundle } from '@myastrosky/backend-local/bundle-fflate';
import { createPhoneBackend, MAX_ARCHIVE_BYTES } from '@myastrosky/backend-local/phone-backend';
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

  it('refuses an archive larger than the limit with BACKUP_TOO_LARGE', async () => {
    expect(MAX_ARCHIVE_BYTES).toBe(300 * 1024 * 1024);
    await expect(openZipBundle(new Uint8Array(11), { maxArchiveBytes: 10 })).rejects.toMatchObject({
      kind: 'invalid',
      code: 'BACKUP_TOO_LARGE',
    });
  });
});
