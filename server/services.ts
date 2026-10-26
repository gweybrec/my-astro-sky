import { getConnection } from './db.js';
import { createServerServices } from './create-server-services.js';
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
} = services;
