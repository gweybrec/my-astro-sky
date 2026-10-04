import { createDsoOverrideService } from '@myastrosky/core/services/dso-overrides';
import { createPoiCategoryService } from '@myastrosky/core/services/poi-categories';
import { createSettingsService } from '@myastrosky/core/services/settings';
import { createSkyRegionService } from '@myastrosky/core/services/sky-regions';
import { v4 as uuidv4 } from 'uuid';
import { getConnection } from './db.js';
import { createServerSecretCodec } from './secret-codec.js';
import { createBetterSqliteDb } from './sqlite-adapter.js';

const db = createBetterSqliteDb(getConnection());

export const dsoOverrides = createDsoOverrideService({ db });
export const poiCategories = createPoiCategoryService({ db, newId: uuidv4 });
export const skyRegions = createSkyRegionService({ db, newId: uuidv4 });
export const settings = createSettingsService({
  db,
  secrets: createServerSecretCodec(),
  env: (k) => process.env[k],
});
