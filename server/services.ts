import { v4 as uuidv4 } from 'uuid';
import { createServices } from '@myastrosky/core/services/create-services';
import { UPLOADS_DIR } from './server-paths.js';
import { getConnection } from './db.js';
import { loadBuiltInGearCatalog } from './gear-catalog.js';
import { createServerSecretCodec } from './secret-codec.js';
import { createFsBlobStore } from './blob-store.js';
import { createSharpImageCodec } from './image-codec.js';
import { createFetchHttpClient } from './http-client.js';
import { createBetterSqliteDb } from './sqlite-adapter.js';
import { logServerError } from './logger.js';
import { loadDeepCatalog } from './star-search.js';
import { loadServerCatalog } from './wcs-reader.js';

const services = createServices({
  db: createBetterSqliteDb(getConnection()),
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

export const {
  backup,
  gear,
  dsoOverrides,
  poiCategories,
  skyRegions,
  settings,
  plans,
  photos,
  stars,
  identify,
  horizon,
  solvedImport,
  novaSolve,
  version,
} = services;
