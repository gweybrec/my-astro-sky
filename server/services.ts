import { createDsoOverrideService } from '@myastrosky/core/services/dso-overrides';
import { createSkyRegionService } from '@myastrosky/core/services/sky-regions';
import { v4 as uuidv4 } from 'uuid';
import { getConnection } from './db.js';
import { createBetterSqliteDb } from './sqlite-adapter.js';

const db = createBetterSqliteDb(getConnection());

export const dsoOverrides = createDsoOverrideService({ db });
export const skyRegions = createSkyRegionService({ db, newId: uuidv4 });
