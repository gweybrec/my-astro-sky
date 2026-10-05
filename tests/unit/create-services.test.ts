// @vitest-environment node
/** `createServices` builds independent service sets: each set sees only its own database. */
import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import { createServices } from '../../server/create-services';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';

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
    gearCatalog: { telescopes: [], cameras: [], accessories: [], filters: [] },
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
});
