import type {
  Photo,
  PhotoCorrespondence,
  PlateSolveResult,
  AstrometrySolveStatus,
  ManualPlacement,
  DSOUserOverride,
  PhotoIntegration,
  PointOfInterest,
  PoiCategory,
  CaptureDetails,
} from '@myastrosky/core/types';
import { t } from '@myastrosky/core/i18n/index';
import { getBackend } from './backend';
import type { HorizonProfile } from '@myastrosky/core/horizon-io';
import type { SkybotCandidate } from '@myastrosky/core/asteroid-identify';
import type { TnsCandidate } from '@myastrosky/core/supernova-identify';
import type { CometElements } from '@myastrosky/core/comet-ephemeris';

// ─── Shared domain types (live in @myastrosky/core; re-exported so importers are unchanged) ───
import type { FileSource } from '@myastrosky/core/backend';
import { DomainError } from '@myastrosky/core/domain/errors';
import type {
  LatestRelease,
  ServerSettings,
  SolverAvailability,
} from '@myastrosky/core/domain/settings';
import type { StarSearchResult } from '@myastrosky/core/domain/stars';
import type {
  ConvertRawPhotoResult as CoreConvertRawPhotoResult,
  AstrometrySubmission,
  LocalSolverApi,
  LocalSolverName,
  ProbeKind,
  ProbeRequest,
  ProbeResponse,
} from '@myastrosky/core/domain/solve';
import type {
  ExportOptions,
  ImportPreviewImage,
  ImportPreviewPlan,
  ImportPreviewSetup,
  ImportPreviewGear,
  ImportPreviewResult,
  ImportResult,
  ImportOptions,
} from '@myastrosky/core/domain/backup';
import type { CustomGearType, GearSetupData } from '@myastrosky/core/domain/gear';
import type { UploadFields } from '@myastrosky/core/domain/photos';
import type { SkyRegionData } from '@myastrosky/core/domain/regions';
import type {
  ObservationWindow,
  PlanEntry,
  PlanMosaic,
  MosaicTileInput,
  MosaicParams,
  PlanSortKey,
  Plan,
} from '@myastrosky/core/domain/plans';

export type {
  LatestRelease,
  ServerSettings,
  SolverAvailability,
} from '@myastrosky/core/domain/settings';
export type { StarMultiplicity } from '@myastrosky/core/types';
export type { StarSearchResult } from '@myastrosky/core/domain/stars';
export type { AstrometrySubmission } from '@myastrosky/core/domain/solve';
export type {
  ExportOptions,
  ImportPreviewImage,
  ImportPreviewPlan,
  ImportPreviewSetup,
  ImportPreviewGear,
  ImportPreviewResult,
  ImportResult,
  ImportOptions,
  SetupConflict,
  SetupImportChoice,
} from '@myastrosky/core/domain/backup';
export type { GearSetupData } from '@myastrosky/core/domain/gear';
export type { SkyRegionData } from '@myastrosky/core/domain/regions';
export type {
  ObservationWindow,
  PlanEntry,
  PlanMosaic,
  MosaicTileInput,
  MosaicParams,
  PlanSortKey,
  Plan,
} from '@myastrosky/core/domain/plans';

/** Result of `convertRawPhoto`: the converted PNG as a browser `File` plus any header metadata. */
export type ConvertRawPhotoResult = CoreConvertRawPhotoResult<File>;

/** Translate a server error response using the `code` field when available. */
export function parseServerError(
  data: { error?: string; code?: string },
  fallbackKey: string,
): string {
  if (data.code) {
    const translated = t('serverErrors.' + data.code);
    // A message with a {placeholder} needs details the response only carries in `error`.
    const needsDetail = /\{\w+\}/.test(translated) && !!data.error;
    if (!translated.startsWith('serverErrors.') && !needsDetail) return translated;
  }
  return data.error || t(fallbackKey);
}

/**
 * What a function of this module throws: the backend's `DomainError` becomes a plain `Error` whose
 * message is its `code` translated, else its own message, else `fallbackKey`. Anything else (a
 * cancelled transfer, a bug) passes through as it is.
 */
function toUserError(err: unknown, fallbackKey: string): Error {
  if (err instanceof DomainError) {
    return new Error(parseServerError({ error: err.message, code: err.code }, fallbackKey));
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Runs a backend call, throwing `toUserError(...)` when it fails. */
async function guard<T>(fallbackKey: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw toUserError(err, fallbackKey);
  }
}

/** A browser `File` as the backend takes it. */
function fileSource(file: File): FileSource {
  return {
    name: file.name,
    size: file.size,
    read: async () => new Uint8Array(await file.arrayBuffer()),
    native: file,
  };
}

/** The solvers installed next to the server; absent on a backend without them. */
function localSolvers(): LocalSolverApi {
  const solvers = getBackend().localSolvers;
  if (!solvers) {
    throw new DomainError('invalid', 'Local solvers are not available on this device.', {
      code: 'LOCAL_SOLVERS_UNAVAILABLE',
    });
  }
  return solvers;
}

/** Which solver a screen means by the route it used to name. */
function solverOf(endpoint: string): LocalSolverName {
  return endpoint.includes('astap') ? 'astap' : 'solve-field';
}

/**
 * Fetch the latest published GitHub release via the backend proxy.
 * Returns `null` on any failure so the update check stays silent when offline.
 */
export async function getLatestVersion(): Promise<LatestRelease | null> {
  try {
    return await getBackend().version.getLatest();
  } catch {
    // Silent by design — a failed update check must never surface an error.
    return null;
  }
}

/**
 * Fetch a computed terrain horizon profile for a location from the backend
 * (which ray-traces open DEM tiles and caches the result). Throws on failure so
 * the caller can surface a message; the UI's "Compute" button awaits this.
 */
export async function fetchHorizonProfile(
  lat: number,
  lon: number,
  opts: { radiusKm?: number; obsHeightM?: number | null } = {},
): Promise<HorizonProfile> {
  return guard(
    'horizon.error.compute',
    () => getBackend().horizon.getProfile({ lat, lon, ...opts }) as Promise<HorizonProfile>,
  );
}

export async function searchStarsAPI(query: string, limit = 10): Promise<StarSearchResult[]> {
  try {
    return await getBackend().stars.search(query, limit);
  } catch {
    return [];
  }
}

export async function searchStarsByPosition(options: {
  ra: number;
  dec: number;
  radius: number;
  magLimit?: number;
  limit?: number;
}): Promise<StarSearchResult[]> {
  try {
    return await getBackend().stars.nearby(options);
  } catch {
    return [];
  }
}

export function uploadPhoto(
  file: File,
  correspondences: PhotoCorrespondence[],
  manualPlacement?: ManualPlacement,
  onProgress?: (fraction: number) => void,
  metadata?: {
    dsoIds?: string[];
    labels?: string[];
    pointsOfInterest?: PointOfInterest[];
    integrations?: PhotoIntegration[];
    notes?: string;
    displayName?: string;
    observationDate?: string | null;
    captureDetails?: CaptureDetails | null;
    gearSetupId?: string | null;
  },
): Promise<Photo> {
  const fields: UploadFields = { correspondences: JSON.stringify(correspondences) };
  if (manualPlacement) fields.manualPlacement = JSON.stringify(manualPlacement);
  if (metadata?.dsoIds) fields.dsoIds = JSON.stringify(metadata.dsoIds);
  if (metadata?.labels) fields.labels = JSON.stringify(metadata.labels);
  if (metadata?.pointsOfInterest)
    fields.pointsOfInterest = JSON.stringify(metadata.pointsOfInterest);
  if (metadata?.integrations) fields.integrations = JSON.stringify(metadata.integrations);
  if (metadata?.notes !== undefined) fields.notes = metadata.notes;
  if (metadata?.displayName) fields.displayName = metadata.displayName;
  if (metadata?.observationDate) fields.observationDate = metadata.observationDate;
  if (metadata?.captureDetails && Object.keys(metadata.captureDetails).length > 0)
    fields.captureDetails = JSON.stringify(metadata.captureDetails);
  if (metadata?.gearSetupId) fields.gearSetupId = metadata.gearSetupId;
  return guard('errors.uploadFailed', () =>
    getBackend().photos.upload(fileSource(file), fields, { onProgress }),
  );
}

export async function getPhotos(): Promise<Photo[]> {
  return guard('errors.loadPhotos', () => getBackend().photos.listWithSizes());
}

export async function deletePhotoAPI(id: string): Promise<void> {
  return guard('errors.deletePhoto', () => getBackend().photos.remove(id));
}

export async function updatePhotoManualPlacement(
  photoId: string,
  manualPlacement: ManualPlacement | null,
): Promise<void> {
  return guard('errors.updatePhoto', () =>
    getBackend().photos.setManualPlacement(photoId, manualPlacement),
  );
}

export async function updatePhotoMetadata(
  photoId: string,
  metadata: {
    dsoIds: string[];
    labels: string[];
    pointsOfInterest?: PointOfInterest[];
    integrations?: PhotoIntegration[];
    notes: string;
    originalName?: string;
    observationDate?: string | null;
    captureDetails?: CaptureDetails | null;
    gearSetupId?: string | null;
  },
): Promise<void> {
  await guard('errors.updatePhoto', () => getBackend().photos.updateMetadata(photoId, metadata));
}

export async function updatePhotoOrder(photoIds: string[]): Promise<void> {
  return guard('errors.updatePhoto', () => getBackend().photos.setOrder(photoIds));
}

export async function solveWCS(
  file: File,
  targetWidth?: number,
  targetHeight?: number,
): Promise<PlateSolveResult> {
  let result;
  try {
    result = await getBackend().solvedImport.solveWcs(fileSource(file), {
      width: targetWidth,
      height: targetHeight,
    });
  } catch (err) {
    if (err instanceof DomainError) {
      throw new Error(
        t('errors.wcsError', {
          text: parseServerError({ error: err.message, code: err.code }, 'errors.wcsError'),
        }),
        { cause: err },
      );
    }
    throw toUserError(err, 'errors.wcsError');
  }
  if (result.success === false) {
    const translated = t('serverErrors.' + result.code);
    return {
      success: false,
      code: result.code,
      ...(translated.startsWith('serverErrors.') ? {} : { error: translated }),
    };
  }
  return result as PlateSolveResult;
}

/**
 * Convert a raw astro image (TIFF/FITS) to a PNG on the server — the raw file is never
 * stored. Returns the converted PNG as a `File` (ready to flow through the normal upload
 * pipeline) plus any WCS/capture metadata found in the raw file's header, in the same
 * shape `solveWCS` returns. The raw upload is the slow part, so its progress is reported.
 */
export async function convertRawPhoto(
  file: File,
  onUploadProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ConvertRawPhotoResult> {
  const { png, ...meta } = await guard('errors.uploadFailed', () =>
    getBackend().solvedImport.convert(fileSource(file), {
      onProgress: onUploadProgress,
      cancel: signal,
    }),
  );
  const pngFile = new File([png as BlobPart], `${file.name.replace(/\.[^.]+$/, '')}.png`, {
    type: 'image/png',
  });
  return { png: pngFile, meta: meta as ConvertRawPhotoResult['meta'] };
}

export async function submitPlateSolve(
  file: File,
  hints?: {
    ra?: number;
    dec?: number;
    radius?: number;
    scale_lower?: number;
    scale_upper?: number;
  },
): Promise<{ jobId: string }> {
  const jobId = await guard('errors.submitFailed', () =>
    getBackend().novaSolve.submit(fileSource(file), hints),
  );
  return { jobId };
}

export async function pollPlateSolve(jobId: string): Promise<AstrometrySolveStatus> {
  try {
    return (await getBackend().novaSolve.getJob(jobId)) as AstrometrySolveStatus;
  } catch (err) {
    // A 429 is transient (batch polling briefly exceeded the rate limit). The job is
    // still running, so report it as in-progress and let the caller retry.
    if (err instanceof DomainError && err.kind === 'rateLimited') {
      return { jobId, status: 'solving' };
    }
    throw toUserError(err, 'errors.pollFailed');
  }
}

export async function submitLocalSolveJob(
  endpoint: '/api/solve-field' | '/api/solve-astap',
  file: File,
  hints?: { ra?: number; dec?: number; fov?: number; radius?: number },
  signal?: AbortSignal,
): Promise<{ jobId: string }> {
  const jobId = await guard('errors.submitFailed', async () =>
    localSolvers().submit(solverOf(endpoint), fileSource(file), hints, { cancel: signal }),
  );
  return { jobId };
}

export async function pollLocalSolveJob(
  endpoint: '/api/solve-field' | '/api/solve-astap',
  jobId: string,
): Promise<{ status: string; result?: PlateSolveResult; error?: string }> {
  try {
    return await localSolvers().poll(solverOf(endpoint), jobId);
  } catch (err) {
    // A 429 is transient (batch polling briefly exceeded the rate limit). The job is
    // still running, so report it as pending and let the caller retry.
    if (err instanceof DomainError && err.kind === 'rateLimited') return { status: 'pending' };
    throw toUserError(err, 'errors.pollFailed');
  }
}

export async function cancelLocalSolveJob(
  endpoint: '/api/solve-field' | '/api/solve-astap',
  jobId: string,
): Promise<void> {
  try {
    await localSolvers().cancel(solverOf(endpoint), jobId);
  } catch {
    // Cancelling is best effort.
  }
}

/** Checks that a solver program runs (or that a folder lists), as the solver settings do. */
export async function probeLocalSolver(
  kind: ProbeKind,
  request: ProbeRequest,
): Promise<ProbeResponse> {
  return guard('errors.networkError', async () => localSolvers().probe(kind, request));
}

export async function listAstrometrySubmissions(): Promise<AstrometrySubmission[]> {
  try {
    return await getBackend().novaSolve.listSubmissions();
  } catch (err) {
    throw new Error(t('errors.listSubmissionsFailed'), { cause: err });
  }
}

export async function reuseAstrometrySubmission(
  file: File,
  jobId: number,
): Promise<PlateSolveResult> {
  try {
    return (await getBackend().novaSolve.reuse(fileSource(file), jobId)) as PlateSolveResult;
  } catch (err) {
    return { success: false, error: toUserError(err, 'errors.reuseSubmissionFailed').message };
  }
}

// ─── Export / Import ──────────────────────────────────────────────────────────

/**
 * Trigger a sky data export download.
 * Always produces a ZIP archive.
 * options controls what is included; ids: photo IDs to include (omit = all).
 * shortcuts: the client's keyboard-shortcut bindings (localStorage), bundled as
 * shortcuts.json when options.includeShortcuts is set — the server has no access to it.
 */
export async function exportData(
  options: ExportOptions,
  ids: string[],
  shortcuts?: unknown,
): Promise<void> {
  return guard('settings.importError', () =>
    getBackend().backup.exportToUser({ options, ids, shortcuts }),
  );
}

/** Dry-run: inspects ZIP/JSON bundle contents without writing to DB. */
export async function importPreview(file: File): Promise<ImportPreviewResult> {
  return guard('settings.importError', () => getBackend().backup.preview(fileSource(file)));
}

/** Import a sky bundle (.zip or .json) with the given options. */
export async function importData(file: File, opts: ImportOptions): Promise<ImportResult> {
  return guard('settings.importError', () => getBackend().backup.restore(fileSource(file), opts));
}

/** A solver is considered available if the user explicitly provided a path (or API key). */
export function getSolverAvailability(settings: ServerSettings): SolverAvailability {
  return {
    solveField: !!settings.SOLVE_FIELD_PATH,
    astap: !!settings.ASTAP_PATH,
    astrometry: settings.apiKeySet,
  };
}

export async function loadServerSettings(): Promise<ServerSettings> {
  return guard('errors.loadSettings', () => getBackend().settings.readPublic());
}

export async function saveServerSettings(settings: {
  apiKey?: string;
  ASTAP_PATH: string;
  SOLVE_FIELD_PATH: string;
  ASTROMETRY_DATA_DIR: string;
  USE_WSL_FOR_SOLVE_FIELD: boolean;
  USE_WSL_FOR_ASTAP: boolean;
  MAX_PARALLEL_SOLVES?: string;
}): Promise<void> {
  await guard('settings.importError', () => getBackend().settings.update(settings));
}

export async function clearAstrometryApiKey(): Promise<void> {
  return guard('settings.importError', () => getBackend().settings.removeApiKey());
}

// ─── Stored files and catalogues ─────────────────────────────────────────────

/** The address of a stored photo or thumbnail file, for an image's `src` or a download. */
export function photoFileUrl(fileName: string): string {
  return getBackend().files.url(fileName);
}

/** The address of the star catalogue file to load. */
export function getStarCatalogUrl(): Promise<string> {
  return getBackend().catalog.starCatalogUrl();
}

/** The built-in and custom gear of one kind (telescopes, cameras, accessories or filters). */
export async function getGearCatalog(type: CustomGearType): Promise<object[]> {
  return guard('errors.loadGearSetups', () => getBackend().gear.listCatalog(type));
}

// ─── DSO user overrides ──────────────────────────────────────────────────────

export async function getDsoOverrides(): Promise<Record<string, DSOUserOverride>> {
  try {
    return await getBackend().dsoOverrides.getAll();
  } catch {
    return {};
  }
}

export async function upsertDsoOverride(id: string, data: DSOUserOverride): Promise<void> {
  return guard('errors.saveDsoOverride', () => getBackend().dsoOverrides.upsert(id, data));
}

export async function deleteDsoOverride(id: string): Promise<void> {
  return guard('errors.deleteDsoOverride', () => getBackend().dsoOverrides.remove(id));
}

// ─── Custom gear ──────────────────────────────────────────────────────────────

export async function createCustomGear(
  type: 'telescope' | 'camera' | 'accessory' | 'filter',
  data: object,
): Promise<{ id: string }> {
  return guard('errors.createCustomGear', () =>
    getBackend().gear.addCustom(type, data as Record<string, unknown>),
  );
}

export async function deleteCustomGear(id: string): Promise<void> {
  return guard('errors.deleteCustomGear', () => getBackend().gear.removeCustom(id));
}

export async function deleteBulkPhotos(ids: string[]): Promise<void> {
  await guard('errors.deletePhoto', () => getBackend().photos.removeMany(ids));
}

export async function deleteAllPhotoMetadata(): Promise<void> {
  await guard('errors.deletePhoto', () => getBackend().photos.removeAll());
}

export async function deleteAllDsoOverrides(): Promise<void> {
  await guard('errors.deleteDsoOverrides', () => getBackend().dsoOverrides.removeAll());
}

export async function deleteAllCustomGear(): Promise<void> {
  await guard('errors.deleteCustomGear', () => getBackend().gear.removeAllCustom());
}

// ─── Gear setups ──────────────────────────────────────────────────────────────

export async function getGearSetups(): Promise<GearSetupData[]> {
  return guard('errors.loadGearSetups', () => getBackend().gear.listSetups());
}

export async function createGearSetup(data: Omit<GearSetupData, 'id'>): Promise<{ id: string }> {
  return guard('errors.createGearSetup', () => getBackend().gear.createSetup(data));
}

export async function updateGearSetup(id: string, data: Omit<GearSetupData, 'id'>): Promise<void> {
  return guard('errors.updateGearSetup', () => getBackend().gear.replaceSetup(id, data));
}

export async function patchGearSetupEnabled(id: string, enabled: boolean): Promise<void> {
  return guard('errors.updateGearSetupEnabled', () =>
    getBackend().gear.setSetupEnabled(id, enabled),
  );
}

export async function deleteGearSetupAPI(id: string): Promise<void> {
  return guard('errors.deleteGearSetup', () => getBackend().gear.removeSetup(id));
}

export async function deleteAllGearSetupsAPI(): Promise<void> {
  await guard('errors.deleteAllGearSetups', () => getBackend().gear.removeAllSetups());
}

// ─── Points of Interest categories ───────────────────────────────────────────

export async function getPoiCategories(): Promise<PoiCategory[]> {
  return guard('errors.loadPoiCategories', () => getBackend().poiCategories.list());
}

export async function createPoiCategory(data: {
  name: string;
  color: string;
}): Promise<{ id: string }> {
  return guard('errors.createPoiCategory', () => getBackend().poiCategories.create(data));
}

export async function updatePoiCategory(
  id: string,
  data: Partial<{ name: string; color: string; position: number }>,
): Promise<void> {
  return guard('errors.updatePoiCategory', () => getBackend().poiCategories.update(id, data));
}

export async function deletePoiCategoryAPI(id: string): Promise<void> {
  return guard('errors.deletePoiCategory', () => getBackend().poiCategories.remove(id));
}

// ─── Sky regions ────────────────────────────────────────────────────────────

export async function getSkyRegions(): Promise<SkyRegionData[]> {
  return guard('errors.loadSkyRegions', () => getBackend().skyRegions.list());
}

export async function createSkyRegion(
  data: Omit<SkyRegionData, 'id' | 'position'>,
): Promise<{ id: string }> {
  return guard('errors.createSkyRegion', () => getBackend().skyRegions.create(data));
}

export async function updateSkyRegion(
  id: string,
  data: Partial<Omit<SkyRegionData, 'id'>>,
): Promise<void> {
  return guard('errors.updateSkyRegion', () => getBackend().skyRegions.update(id, data));
}

export async function deleteSkyRegionAPI(id: string): Promise<void> {
  return guard('errors.deleteSkyRegion', () => getBackend().skyRegions.remove(id));
}

// ─── Night plans ───────────────────────────────────────────────────────────

export async function getPlans(): Promise<Plan[]> {
  return guard('errors.loadPlans', () => getBackend().plans.list());
}

export async function createPlanAPI(name: string): Promise<{ id: string }> {
  return guard('errors.createPlan', () => getBackend().plans.create({ name }));
}

export async function renamePlanAPI(id: string, name: string): Promise<void> {
  return guard('errors.renamePlan', () => getBackend().plans.update(id, { name }));
}

export async function updatePlanSettingsAPI(
  id: string,
  nightOf: string | null,
  setupId: string | null,
  lat: number | null,
  lon: number | null,
): Promise<void> {
  return guard('errors.updatePlanSettings', () =>
    getBackend().plans.update(id, { nightOf, setupId, lat, lon }),
  );
}

/** Persist just a plan's objects-list sort key (partial update of the plan). */
export async function updatePlanSortAPI(id: string, sortBy: PlanSortKey): Promise<void> {
  return guard('errors.updatePlanSort', () => getBackend().plans.update(id, { sortBy }));
}

export async function deletePlanAPI(id: string): Promise<void> {
  return guard('errors.deletePlan', () => getBackend().plans.remove(id));
}

export async function reorderPlansAPI(ids: string[]): Promise<void> {
  return guard('errors.reorderPlans', () => getBackend().plans.reorder(ids));
}

export async function addPlanEntryAPI(planId: string, dsoId: string): Promise<{ id: string }> {
  return guard('errors.addPlanTarget', () => getBackend().plans.addEntry(planId, { dsoId }));
}

/** Add a custom-location entry (no DSO) framed on empty sky at the given centre. */
export async function addCustomPlanEntryAPI(
  planId: string,
  ra: number,
  dec: number,
): Promise<{ id: string }> {
  return guard('errors.addPlanFrame', () => getBackend().plans.addEntry(planId, { ra, dec }));
}

export async function removePlanEntryAPI(planId: string, entryId: string): Promise<void> {
  return guard('errors.removePlanTarget', () => getBackend().plans.removeEntry(entryId, planId));
}

/** Create a mosaic in a plan from client-computed tiles. Returns the mosaic id. */
export async function createPlanMosaicAPI(
  planId: string,
  params: MosaicParams,
): Promise<{ id: string }> {
  return guard('errors.createMosaic', () => getBackend().plans.createMosaic(planId, params));
}

/** Replace a mosaic's parameters and tile set. */
export async function updatePlanMosaicAPI(
  planId: string,
  mosaicId: string,
  params: MosaicParams,
): Promise<void> {
  return guard('errors.updateMosaic', () =>
    getBackend().plans.updateMosaic(planId, mosaicId, params),
  );
}

export async function deletePlanMosaicAPI(planId: string, mosaicId: string): Promise<void> {
  return guard('errors.deleteMosaic', () => getBackend().plans.removeMosaic(planId, mosaicId));
}

export async function reorderPlanEntriesAPI(planId: string, ids: string[]): Promise<void> {
  return guard('errors.reorderPlanEntries', () => getBackend().plans.reorderEntries(planId, ids));
}

export async function updatePlanEntryPAAPI(
  planId: string,
  entryId: string,
  paDeg: number | null,
): Promise<void> {
  return guard('errors.updatePlanEntryAngle', () =>
    getBackend().plans.updateEntry(entryId, { paDeg }, planId),
  );
}

/**
 * Update a plan entry's frame position and/or target. Only the provided fields
 * are sent (the PATCH route applies a partial update), so a position drag and a
 * rotation persist independently.
 */
export async function updatePlanEntryPositionAPI(
  planId: string,
  entryId: string,
  fields: {
    ra?: number | null;
    dec?: number | null;
    paDeg?: number | null;
    dsoId?: string | null;
    mosaicWDeg?: number | null;
    mosaicHDeg?: number | null;
    observationWindows?: ObservationWindow[];
  },
): Promise<void> {
  return guard('errors.updatePlanEntryPosition', () =>
    getBackend().plans.updateEntry(entryId, fields, planId),
  );
}

/**
 * Cone-searches IMCCE SkyBoT (through the backend) for known asteroids near a sky
 * position and epoch. Used by the asteroid identification modal to match the
 * user's marked trail against a candidate.
 */
export async function skybotConesearchAPI(params: {
  raDeg: number;
  decDeg: number;
  radiusArcmin: number;
  epochJd: number;
}): Promise<SkybotCandidate[]> {
  return guard('errors.skybotSearch', () => getBackend().identify.searchAsteroids(params));
}

/**
 * Cone-searches the IAU Transient Name Server (through the backend) for transients
 * discovered in a date window. Used by the supernova identification modal. TNS
 * allows only ~2 anonymous cone searches a minute, surfaced as a translated message.
 */
export async function tnsConesearchAPI(params: {
  raDeg: number;
  decDeg: number;
  radiusArcmin: number;
  dateStart: string;
  dateEnd: string;
}): Promise<TnsCandidate[]> {
  return guard('errors.tnsSearch', () => getBackend().identify.searchTransients(params));
}

let cometElementsPromise: Promise<CometElements[]> | null = null;

/**
 * Current MPC comet orbital elements (through the backend's cache). Memoised for the
 * session — the comet identification modal re-propagates them on every date edit.
 * A failed load is not memoised, so reopening the modal retries.
 */
export function cometElementsAPI(): Promise<CometElements[]> {
  cometElementsPromise ??= guard('errors.cometElements', () =>
    getBackend().identify.getCometElements(),
  ).catch((err: unknown) => {
    cometElementsPromise = null;
    throw err;
  });
  return cometElementsPromise;
}
