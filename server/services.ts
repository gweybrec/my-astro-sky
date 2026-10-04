import { createDsoOverrideService } from '@myastrosky/core/services/dso-overrides';
import { getConnection } from './db.js';
import { createBetterSqliteDb } from './sqlite-adapter.js';

const db = createBetterSqliteDb(getConnection());

export const dsoOverrides = createDsoOverrideService({ db });
