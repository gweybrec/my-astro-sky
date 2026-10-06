// @vitest-environment node
/** `createServices` builds independent service sets: each set sees only its own database. */
import Database from 'better-sqlite3';
import { describe, it, expect, vi } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import { createServices } from '@myastrosky/core/services/create-services';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { fakeImageCodec, memoryBlobStore } from '../helpers/fake-image-io';
import { fakeImageCodec, memoryBlobStore } from '../helpers/fake-image-io';

async function makeServices() {
  const db = createBetterSqliteDb(new Database(':memory:'));
  await initSchema(db);
  let n = 0;
  return createServices({
    db,
    newId: () => `id-${++n}`,
    secrets: {
      canEncrypt: () => false,
      encrypt: async (s) => s,
      decrypt: async (s) => s,
      isEncrypted: () => false,
    },
    env: () => undefined,
    platform: { isWindows: false },
    gearCatalog: { telescopes: [], cameras: [], accessories: [], filters: [] },
    images: fakeImageCodec(),
    blobs: memoryBlobStore(),
    stars: [],
    catalogStars: [],
    http: async () => {
      throw new Error('no network in this test');
    },
    now: () => 0,
  });
}

describe('createServices', () => {
  it('keeps two sets on two in-memory databases independent', async () => {
    const a = await makeServices();
    const b = await makeServices();
    await a.dsoOverrides.upsert('M31', { name: 'Andromeda' });
    expect(Object.keys(await a.dsoOverrides.getAll())).toEqual(['M31']);
    expect(await b.dsoOverrides.getAll()).toEqual({});
  });

  it('drops the online-solving session when the API key changes, and only then', async () => {
    const services = await makeServices();
    const reset = vi.spyOn(services.novaSolve, 'resetSession');
    await services.settings.update({ ASTAP_PATH: '/astap' });
    expect(reset).not.toHaveBeenCalled();
    await services.settings.update({ apiKey: 'a-key' });
    expect(reset).toHaveBeenCalledTimes(1);
    await services.settings.removeApiKey();
    expect(reset).toHaveBeenCalledTimes(2);
  });
});
