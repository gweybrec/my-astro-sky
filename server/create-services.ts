import type { GearCatalog } from '@myastrosky/core/domain/gear';
import type { EnvSource } from '@myastrosky/core/ports/env-source';
import type { SecretCodec } from '@myastrosky/core/ports/secret-codec';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { createDsoOverrideService } from '@myastrosky/core/services/dso-overrides';
import { createGearService } from '@myastrosky/core/services/gear';
import { createPoiCategoryService } from '@myastrosky/core/services/poi-categories';
import { createSettingsService } from '@myastrosky/core/services/settings';
import { createSkyRegionService } from '@myastrosky/core/services/sky-regions';

export interface ServiceDeps {
  db: SqlDb;
  newId: () => string;
  secrets: SecretCodec;
  env: EnvSource;
  gearCatalog: GearCatalog;
}

/** Builds every service on one database. Later service cards add theirs here. */
export function createServices(deps: ServiceDeps) {
  const { db, newId, secrets, env, gearCatalog } = deps;
  return {
    dsoOverrides: createDsoOverrideService({ db }),
    skyRegions: createSkyRegionService({ db, newId }),
    poiCategories: createPoiCategoryService({ db, newId }),
    settings: createSettingsService({ db, secrets, env }),
    gear: createGearService({ db, newId, catalog: gearCatalog }),
  };
}

export type Services = ReturnType<typeof createServices>;
