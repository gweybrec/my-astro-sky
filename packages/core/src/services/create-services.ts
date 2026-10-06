import type { GearCatalog } from '../domain/gear';
import type { BlobStore } from '../ports/blob-store';
import type { EnvSource } from '../ports/env-source';
import type { HttpClient } from '../ports/http-client';
import type { ImageCodec } from '../ports/image-codec';
import type { SecretCodec } from '../ports/secret-codec';
import type { SqlDb } from '../ports/sql-db';
import { createBackupService } from './backup';
import { createDsoOverrideService } from './dso-overrides';
import { createGearService } from './gear';
import { createHorizonService } from './horizon';
import { createIdentifyService } from './identify';
import { createNovaSolveService } from './nova-solve';
import { createPhotoService } from './photos';
import { createPlanService } from './plans';
import { createPoiCategoryService } from './poi-categories';
import { createSolvedImportService, type CatalogStarSource } from './solved-import';
import { createSettingsService } from './settings';
import { createStarSearchService, type StarCatalogSource } from './star-search';
import { createVersionService } from './version';
import { createSkyRegionService } from './sky-regions';

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
