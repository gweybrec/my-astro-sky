import { getConnection } from './db.js';
import { createServerServices } from './create-server-services.js';
import { v4 as uuidv4 } from 'uuid';
import { createSharedSkyImports } from './shared-sky-imports.js';
import { createBetterSqliteDb } from './sqlite-adapter.js';

const services = createServerServices(createBetterSqliteDb(getConnection()));

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
  sharedSkies,
} = services;

/** The shared-sky packages uploaded and being opened. */
export const sharedSkyImports = createSharedSkyImports({ service: sharedSkies, newId: uuidv4 });
