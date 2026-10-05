import { v4 as uuidv4 } from 'uuid';
import { createServices } from './create-services.js';
import { UPLOADS_DIR } from './server-paths.js';
import { getConnection } from './db.js';
import { loadBuiltInGearCatalog } from './gear-catalog.js';
import { createServerSecretCodec } from './secret-codec.js';
import { createFsBlobStore } from './blob-store.js';
import { createSharpImageCodec } from './image-codec.js';
import { createBetterSqliteDb } from './sqlite-adapter.js';

const services = createServices({
  db: createBetterSqliteDb(getConnection()),
  newId: uuidv4,
  secrets: createServerSecretCodec(),
  env: (k) => process.env[k],
  gearCatalog: loadBuiltInGearCatalog(),
  images: createSharpImageCodec(),
  blobs: createFsBlobStore(UPLOADS_DIR),
});

export const { gear, dsoOverrides, poiCategories, skyRegions, settings, plans, photos } = services;
