import type { GearCatalog } from '@myastrosky/core/domain/gear';
import type { BlobStore } from '@myastrosky/core/ports/blob-store';
import type { EnvSource } from '@myastrosky/core/ports/env-source';
import type { HttpClient } from '@myastrosky/core/ports/http-client';
import type { ImageCodec } from '@myastrosky/core/ports/image-codec';
import type { SecretCodec } from '@myastrosky/core/ports/secret-codec';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { createBackupService } from '@myastrosky/core/services/backup';
import { createDsoOverrideService } from '@myastrosky/core/services/dso-overrides';
import { createGearService } from '@myastrosky/core/services/gear';
import { createHorizonService } from '@myastrosky/core/services/horizon';
import { createIdentifyService } from '@myastrosky/core/services/identify';
import { createNovaSolveService } from '@myastrosky/core/services/nova-solve';
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
import { createVersionService } from '@myastrosky/core/services/version';
import { createSkyRegionService } from '@myastrosky/core/services/sky-regions';

export interface ServiceDeps {
  db: SqlDb;
  newId: () => string;
  secrets: SecretCodec;
  env: EnvSource;
  /** What the host runs on. */
  platform: { isWindows: boolean };
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
    platform,
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
  // The settings service is built before the online-solving one, which reads settings: a holder breaks the cycle.
  let resetNovaSession: () => void = () => {};
  const settings = createSettingsService({
    db,
    secrets,
    env,
    platform,
    // The session was opened with the old key; drop it.
    onApiKeyChanged: () => resetNovaSession(),
  });
  const dsoOverrides = createDsoOverrideService({ db });
  const skyRegions = createSkyRegionService({ db, newId });
  const poiCategories = createPoiCategoryService({ db, newId });
  const gear = createGearService({ db, newId, catalog: gearCatalog });
  const plans = createPlanService({ db, newId });
  const photos = createPhotoService({ db, newId, images, blobs });
  const novaSolve = createNovaSolveService({
    http,
    settings,
    images,
    stars: catalogStars,
    now,
    newId,
    log,
    sleep,
  });
  resetNovaSession = () => novaSolve.resetSession();
  return {
    dsoOverrides,
    skyRegions,
    poiCategories,
    settings,
    gear,
    plans,
    photos,
    backup: createBackupService({
      photos,
      plans,
      gear,
      dsoOverrides,
      poiCategories,
      skyRegions,
      blobs,
      newId,
    }),
    stars: createStarSearchService({ stars }),
    identify: createIdentifyService({ http, now }),
    solvedImport: createSolvedImportService({ images, stars: catalogStars }),
    version: createVersionService({ http, now }),
    horizon: createHorizonService({ db, http, images, now, log, sleep }),
    novaSolve,
  };
}

export type Services = ReturnType<typeof createServices>;
