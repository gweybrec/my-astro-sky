import { v4 as uuidv4 } from 'uuid';
import { createServices } from '@myastrosky/core/services/create-services';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { UPLOADS_DIR } from './server-paths.js';
import { loadBuiltInGearCatalog } from './gear-catalog.js';
import { createServerSecretCodec } from './secret-codec.js';
import { createFsBlobStore } from './blob-store.js';
import { createSharpImageCodec } from './image-codec.js';
import { createFetchHttpClient } from './http-client.js';
import { logServerError } from './logger.js';
import { loadDeepCatalog } from './star-search.js';
import { loadServerCatalog } from './wcs-reader.js';

/** The services on the server's adapters, over `db`. Does not load `db.ts`, which runs the database updates. */
export function createServerServices(db: SqlDb) {
  return createServices({
    db,
    newId: uuidv4,
    secrets: createServerSecretCodec(),
    env: (k) => process.env[k],
    platform: { isWindows: process.platform === 'win32' },
    gearCatalog: loadBuiltInGearCatalog(),
    images: createSharpImageCodec(),
    blobs: createFsBlobStore(UPLOADS_DIR),
    // Read from disk on the first star request, as before.
    stars: loadDeepCatalog,
    // The catalogue that solved files are matched against; read on first use, as before.
    catalogStars: loadServerCatalog,
    http: createFetchHttpClient(),
    now: () => Date.now(),
    log: logServerError,
  });
}
