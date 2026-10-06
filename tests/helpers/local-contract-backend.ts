/**
 * Builds the local backend on an in-memory database, for the backend contract: the real services, the
 * server's `sharp` codec (so thumbnails equal the HTTP run's), a blob store in memory, the star catalogues
 * and the built-in gear from the repository, and the outgoing network answered by the recorded files.
 */
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { createLocalBackend } from '@myastrosky/backend-local/local-backend';
import { newZipBundle, openZipBundle } from '@myastrosky/backend-local/bundle-fflate';
import { initSchema } from '@myastrosky/core/db/schema';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { createServices } from '@myastrosky/core/services/create-services';
import type { ContractSetup } from '@myastrosky/core/testing/backend-contract';
import { loadBuiltInGearCatalog } from '../../server/gear-catalog';
import { createFetchHttpClient } from '../../server/http-client';
import { createSharpImageCodec } from '../../server/image-codec';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { loadDeepCatalog } from '../../server/star-search';
import { loadServerCatalog } from '../../server/wcs-reader';
import { buildFixtures, fileSource, resetFakeInternet } from './contract-shared';
import { memoryBlobStore } from './fake-image-io';

export interface LocalContractOptions {
  /** Wraps the database (the asynchronous or the counting one). */
  wrapDb?: (db: SqlDb) => SqlDb;
}

/** A backend with nothing stored, and the database under it. */
export async function makeLocalContractSetup(
  options: LocalContractOptions = {},
): Promise<ContractSetup & { db: SqlDb }> {
  const sqlite = new Database(':memory:');
  const db = (options.wrapDb ?? ((d) => d))(createBetterSqliteDb(sqlite));
  await initSchema(db);
  resetFakeInternet();

  const services = createServices({
    db,
    newId: uuidv4,
    secrets: {
      canEncrypt: () => false,
      encrypt: async (s) => s,
      decrypt: async (s) => s,
      isEncrypted: () => false,
    },
    env: () => undefined,
    platform: { isWindows: process.platform === 'win32' },
    gearCatalog: loadBuiltInGearCatalog(),
    images: createSharpImageCodec(),
    blobs: memoryBlobStore(),
    stars: loadDeepCatalog,
    catalogStars: loadServerCatalog,
    http: createFetchHttpClient(),
    now: () => Date.now(),
  });

  const saved: { name: string; bytes: Uint8Array }[] = [];
  const backend = createLocalBackend({
    services,
    files: { url: (fileName) => `/uploads/${fileName}` },
    starCatalogUrl: '/data/stars-deep.json',
    openZip: openZipBundle,
    newZip: newZipBundle,
    saveFile: async (name, bytes) => {
      saved.push({ name, bytes });
    },
    now: () => new Date(),
  });

  const fixtures = await buildFixtures(async () => {
    const last = saved[saved.length - 1];
    return last ? fileSource(last.name, last.bytes) : undefined;
  });
  return { backend, fixtures, db };
}
