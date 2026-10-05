import type { GearCatalog } from '@myastrosky/core/domain/gear';
import type { BlobStore } from '@myastrosky/core/ports/blob-store';
import type { EnvSource } from '@myastrosky/core/ports/env-source';
import type { HttpClient } from '@myastrosky/core/ports/http-client';
import type { ImageCodec } from '@myastrosky/core/ports/image-codec';
import type { SecretCodec } from '@myastrosky/core/ports/secret-codec';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { createDsoOverrideService } from '@myastrosky/core/services/dso-overrides';
import { createGearService } from '@myastrosky/core/services/gear';
import { createHorizonService } from '@myastrosky/core/services/horizon';
import { createIdentifyService } from '@myastrosky/core/services/identify';
import { createPhotoService } from '@myastrosky/core/services/photos';
import { createPlanService } from '@myastrosky/core/services/plans';
import { createPoiCategoryService } from '@myastrosky/core/services/poi-categories';
import {
  createSolvedImportService,
  type CatalogStarSource,
} from '@myastrosky/core/services/solved-import';
import { createSettingsService } from '@myastrosky/core/services/settings';
import {
  createStarSearchService,
  type StarCatalogSource,
} from '@myastrosky/core/services/star-search';
import { createSkyRegionService } from '@myastrosky/core/services/sky-regions';

export interface ServiceDeps {
  db: SqlDb;
  newId: () => string;
  secrets: SecretCodec;
  env: EnvSource;
  gearCatalog: GearCatalog;
  images: ImageCodec;
  blobs: BlobStore;
  /** The deep star catalogue, or a function that loads it on first use. */
  stars: StarCatalogSource;
  /** The catalogue (every magnitude, with names) that solved files are matched against, or a function that loads it on first use. */
  catalogStars: CatalogStarSource;
  http: HttpClient;
  /** The clock, in milliseconds since the epoch. */
  now: () => number;
  /** Where services report a problem that does not fail the call. */
  log?: (event: string, error: unknown, context?: Record<string, unknown>) => void;
  /** Waits between retries of a network call; the services own timer when absent. */
  sleep?: (ms: number) => Promise<void>;
}

/** Builds every service on one database. Later service cards add theirs here. */
export function createServices(deps: ServiceDeps) {
  const {
    db,
    newId,
    secrets,
    env,
    gearCatalog,
    images,
    blobs,
    stars,
    catalogStars,
    http,
    now,
    log,
    sleep,
  } = deps;
  return {
    dsoOverrides: createDsoOverrideService({ db }),
    skyRegions: createSkyRegionService({ db, newId }),
    poiCategories: createPoiCategoryService({ db, newId }),
    settings: createSettingsService({ db, secrets, env }),
    gear: createGearService({ db, newId, catalog: gearCatalog }),
    plans: createPlanService({ db, newId }),
    photos: createPhotoService({ db, newId, images, blobs }),
    stars: createStarSearchService({ stars }),
    identify: createIdentifyService({ http, now }),
    solvedImport: createSolvedImportService({ images, stars: catalogStars }),
    horizon: createHorizonService({ db, http, images, now, log, sleep }),
  };
}

export type Services = ReturnType<typeof createServices>;
