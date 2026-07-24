import type {
  Photo,
  PhotoCorrespondence,
  PlateSolveResult,
  AstrometrySolveStatus,
  ManualPlacement,
  ApiErrorDetails,
  DSOUserOverride,
  PhotoIntegration,
  PointOfInterest,
  PoiCategory,
  CaptureDetails,
} from './types';
import { t, getLang } from './i18n';
import { reportRendererError } from './error-reporter';
import { downloadBlob } from './file-utils';
import type { HorizonProfile } from './horizon-io';

/** Translate a server error response using the `code` field when available. */
export function parseServerError(
  data: { error?: string; code?: string },
  fallbackKey: string,
): string {
  if (data.code) {
    const translated = t('serverErrors.' + data.code);
    if (!translated.startsWith('serverErrors.')) return translated;
  }
  return data.error || t(fallbackKey);
}

export interface LatestRelease {
  version: string;
  url: string;
  publishedAt: string | null;
}

/**
 * Fetch the latest published GitHub release via the backend proxy.
 * Returns `null` on any failure so the update check stays silent when offline.
 */
export async function getLatestVersion(): Promise<LatestRelease | null> {
  try {
    const res = await fetch('/api/version/latest');
    if (!res.ok) return null;
    return (await res.json()) as LatestRelease | null;
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
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (opts.radiusKm != null) params.set('radiusKm', String(opts.radiusKm));
  if (opts.obsHeightM != null) params.set('obsHeightM', String(opts.obsHeightM));
  const res = await fetch(`/api/horizon?${params.toString()}`);
  if (!res.ok) {
    let data: { error?: string; code?: string } = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error body */
    }
    throw new Error(parseServerError(data, 'horizon.error.compute'));
  }
  return (await res.json()) as HorizonProfile;
}

export interface StarMultiplicity {
  components: number;
  sep?: string;
}

export interface StarSearchResult {
  hip: number;
  ra: number;
  dec: number;
  mag: number;
  bv: number;
  name?: string;
  bayer?: string;
  flam?: string;
  constellation?: string;
  desig?: string;
  multiplicity?: StarMultiplicity;
  label: string;
  score: number;
}

export async function searchStarsAPI(query: string, limit = 10): Promise<StarSearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`/api/stars/search?${params}`);
  if (!res.ok) return [];
  return res.json();
}

export async function searchStarsByPosition(options: {
  ra: number;
  dec: number;
  radius: number;
  magLimit?: number;
  limit?: number;
}): Promise<StarSearchResult[]> {
  const params = new URLSearchParams({
    ra: String(options.ra),
    dec: String(options.dec),
    radius: String(options.radius),
    magLimit: String(options.magLimit ?? 10),
    limit: String(options.limit ?? 20),
  });
  const res = await fetch(`/api/stars/nearby?${params}`);
  if (!res.ok) return [];
  return res.json();
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
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('correspondences', JSON.stringify(correspondences));
    if (manualPlacement) {
      formData.append('manualPlacement', JSON.stringify(manualPlacement));
    }
    if (metadata?.dsoIds) formData.append('dsoIds', JSON.stringify(metadata.dsoIds));
    if (metadata?.labels) formData.append('labels', JSON.stringify(metadata.labels));
    if (metadata?.pointsOfInterest)
      formData.append('pointsOfInterest', JSON.stringify(metadata.pointsOfInterest));
    if (metadata?.integrations)
      formData.append('integrations', JSON.stringify(metadata.integrations));
    if (metadata?.notes !== undefined) formData.append('notes', metadata.notes);
    if (metadata?.displayName) formData.append('displayName', metadata.displayName);
    if (metadata?.observationDate) formData.append('observationDate', metadata.observationDate);
    if (metadata?.captureDetails && Object.keys(metadata.captureDetails).length > 0)
      formData.append('captureDetails', JSON.stringify(metadata.captureDetails));
    if (metadata?.gearSetupId) formData.append('gearSetupId', metadata.gearSetupId);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/photos');

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded / e.total);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error(t('errors.invalidResponse')));
        }
      } else {
        let errorMsg = t('errors.uploadFailed', { response: xhr.responseText });
        try {
          const body = JSON.parse(xhr.responseText);
          errorMsg = parseServerError(body, 'errors.uploadFailed');
        } catch {
          /* non-JSON response, keep default */
        }
        reject(new Error(errorMsg));
      }
    };

    xhr.onerror = () => reject(new Error(t('errors.networkError')));
    xhr.send(formData);
  });
}

export async function getPhotos(): Promise<Photo[]> {
  const res = await fetch('/api/photos');
  if (!res.ok) throw new Error(t('errors.loadPhotos'));
  return res.json();
}

export async function deletePhotoAPI(id: string): Promise<void> {
  const res = await fetch(`/api/photos/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(t('errors.deletePhoto'));
}

export async function updatePhotoManualPlacement(
  photoId: string,
  manualPlacement: ManualPlacement | null,
): Promise<void> {
  const res = await fetch(`/api/photos/${photoId}/manual-placement`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manualPlacement }),
  });
  if (!res.ok) throw new Error(t('errors.updatePhoto'));
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
  const res = await fetch(`/api/photos/${photoId}/metadata`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) throw new Error(t('errors.updatePhoto'));
}

export async function updatePhotoOrder(photoIds: string[]): Promise<void> {
  const res = await fetch('/api/photos/order', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoIds }),
  });
  if (!res.ok) throw new Error(t('errors.updatePhoto'));
}

export async function solveWCS(
  file: File,
  targetWidth?: number,
  targetHeight?: number,
): Promise<PlateSolveResult> {
  const formData = new FormData();
  formData.append('photo', file);
  formData.append('lang', getLang());
  if (targetWidth !== undefined) formData.append('targetWidth', String(targetWidth));
  if (targetHeight !== undefined) formData.append('targetHeight', String(targetHeight));

  const res = await fetch('/api/solve-wcs', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(t('errors.wcsError', { text }));
  }

  return res.json();
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
  const formData = new FormData();
  formData.append('photo', file);
  if (hints?.ra !== undefined) formData.append('ra', String(hints.ra));
  if (hints?.dec !== undefined) formData.append('dec', String(hints.dec));
  if (hints?.radius !== undefined) formData.append('radius', String(hints.radius));
  if (hints?.scale_lower !== undefined) formData.append('scale_lower', String(hints.scale_lower));
  if (hints?.scale_upper !== undefined) formData.append('scale_upper', String(hints.scale_upper));

  const res = await fetch('/api/solve-plate', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(parseServerError(data, 'errors.submitFailed'));
  }

  return res.json();
}

export async function pollPlateSolve(jobId: string): Promise<AstrometrySolveStatus> {
  const res = await fetch(`/api/solve-plate/${jobId}`);
  // A 429 is transient (batch polling briefly exceeded the rate limit). The job is
  // still running server-side, so report it as in-progress and let the caller retry.
  if (res.status === 429) return { jobId, status: 'solving' };
  if (!res.ok) throw new Error(t('errors.pollFailed'));
  return res.json();
}

export async function submitLocalSolveJob(
  endpoint: '/api/solve-field' | '/api/solve-astap',
  file: File,
  hints?: { ra?: number; dec?: number; fov?: number; radius?: number },
  signal?: AbortSignal,
): Promise<{ jobId: string }> {
  const fd = new FormData();
  fd.append('photo', file);
  if (hints?.ra !== undefined) fd.append('ra', String(hints.ra));
  if (hints?.dec !== undefined) fd.append('dec', String(hints.dec));
  if (hints?.fov !== undefined) fd.append('fov', String(hints.fov));
  if (hints?.radius !== undefined) fd.append('radius', String(hints.radius));
  fd.append('lang', getLang());
  const res = await fetch(endpoint, { method: 'POST', body: fd, signal });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(parseServerError(data, 'errors.submitFailed'));
  }
  return res.json();
}

export async function pollLocalSolveJob(
  endpoint: '/api/solve-field' | '/api/solve-astap',
  jobId: string,
): Promise<{ status: string; result?: PlateSolveResult; error?: string }> {
  const res = await fetch(`${endpoint}/${jobId}`);
  // A 429 is transient (batch polling briefly exceeded the rate limit). The job is
  // still running server-side, so report it as pending and let the caller retry.
  if (res.status === 429) return { status: 'pending' };
  if (!res.ok) throw new Error(t('errors.pollFailed'));
  return res.json();
}

export async function cancelLocalSolveJob(
  endpoint: '/api/solve-field' | '/api/solve-astap',
  jobId: string,
): Promise<void> {
  await fetch(`${endpoint}/${jobId}`, { method: 'DELETE' }).catch(() => undefined);
}

async function parseSolverFailure(
  res: Response,
  method: 'POST',
  endpoint: '/api/solve-astap' | '/api/solve-field',
  fallbackMessage: string,
): Promise<{ message: string; code?: string; details: ApiErrorDetails }> {
  const details: ApiErrorDetails = {
    method,
    endpoint,
    httpStatus: res.status,
    httpStatusText: res.statusText,
  };

  let bodyText = '';
  let parsed: any = null;

  try {
    const clone = res.clone();
    parsed = await clone.json();
    bodyText = JSON.stringify(parsed, null, 2);
  } catch {
    try {
      bodyText = await res.text();
    } catch {
      bodyText = '';
    }
  }

  if (bodyText.trim()) {
    details.responseBody = bodyText.trim().slice(0, 8000);
  }

  const serverError = typeof parsed?.error === 'string' ? parsed.error.trim() : '';
  const serverCode = typeof parsed?.code === 'string' ? parsed.code.trim() : undefined;
  details.code = serverCode;

  const translatedCode = serverCode ? t('serverErrors.' + serverCode) : '';
  const hasCodeTranslation = translatedCode && !translatedCode.startsWith('serverErrors.');
  const isGeneric = /^(error|erreur)$/i.test(serverError);
  const message = hasCodeTranslation
    ? translatedCode
    : serverError && !isGeneric
      ? serverError
      : `${fallbackMessage} (HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''})`;

  reportRendererError({
    category: 'api_solver_http_error',
    message,
    context: {
      method,
      endpoint,
      httpStatus: res.status,
      httpStatusText: res.statusText,
      code: serverCode,
      responseBody: details.responseBody,
    },
  });

  return { message, code: serverCode, details };
}

export async function solveWithASTAP(
  file: File,
  hints?: { ra?: number; dec?: number; fov?: number; radius?: number },
  signal?: AbortSignal,
): Promise<PlateSolveResult> {
  const fd = new FormData();
  fd.append('photo', file);
  if (hints?.ra !== undefined) fd.append('ra', String(hints.ra));
  if (hints?.dec !== undefined) fd.append('dec', String(hints.dec));
  if (hints?.fov !== undefined) fd.append('fov', String(hints.fov));
  if (hints?.radius !== undefined) fd.append('radius', String(hints.radius));
  fd.append('lang', getLang());
  const res = await fetch('/api/solve-astap', { method: 'POST', body: fd, signal });
  if (!res.ok) {
    const parsed = await parseSolverFailure(
      res,
      'POST',
      '/api/solve-astap',
      t('errors.astapError'),
    );
    return {
      success: false,
      error: parsed.message,
      code: parsed.code,
      errorDetails: parsed.details,
    };
  }
  return res.json();
}

export async function solveWithSolveField(
  file: File,
  hints?: { ra?: number; dec?: number; fov?: number; radius?: number },
  signal?: AbortSignal,
): Promise<PlateSolveResult> {
  const fd = new FormData();
  fd.append('photo', file);
  if (hints?.ra !== undefined) fd.append('ra', String(hints.ra));
  if (hints?.dec !== undefined) fd.append('dec', String(hints.dec));
  if (hints?.fov !== undefined) fd.append('fov', String(hints.fov));
  if (hints?.radius !== undefined) fd.append('radius', String(hints.radius));
  fd.append('lang', getLang());
  const res = await fetch('/api/solve-field', { method: 'POST', body: fd, signal });
  if (!res.ok) {
    const parsed = await parseSolverFailure(
      res,
      'POST',
      '/api/solve-field',
      t('errors.solveFieldError'),
    );
    return {
      success: false,
      error: parsed.message,
      code: parsed.code,
      errorDetails: parsed.details,
    };
  }
  return res.json();
}

export interface AstrometrySubmission {
  submissionId: number;
  jobId?: number;
  status: string;
  timestamp?: string;
  filename?: string;
  width?: number;
  height?: number;
}

export async function listAstrometrySubmissions(): Promise<AstrometrySubmission[]> {
  const res = await fetch('/api/astrometry/submissions');
  if (!res.ok) {
    throw new Error(t('errors.listSubmissionsFailed'));
  }
  const data = await res.json();
  return data.submissions || [];
}

export async function reuseAstrometrySubmission(
  file: File,
  jobId: number,
): Promise<PlateSolveResult> {
  const fd = new FormData();
  fd.append('photo', file);
  fd.append('jobId', String(jobId));
  fd.append('lang', getLang());

  const res = await fetch('/api/astrometry/reuse', { method: 'POST', body: fd });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { success: false, error: data.error ?? t('errors.reuseSubmissionFailed') };
  }
  return res.json();
}

// ─── Export / Import ──────────────────────────────────────────────────────────

export interface ExportOptions {
  includeImages?: boolean;
  includeMetadata?: boolean;
  includeDsoOverrides?: boolean;
  includeCustomGear?: boolean;
  includeSetups?: boolean;
  includePlans?: boolean;
  includeShortcuts?: boolean;
  includePoiCategories?: boolean;
}

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
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ options, ids, shortcuts }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? t('settings.importError'));
  }
  const blob = await res.blob();
  // Filename comes from Content-Disposition; fall back to a sensible default
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  downloadBlob(blob, match ? match[1] : 'sky-export.zip');
}

export interface ImportPreviewImage {
  filename: string;
  originalName: string;
  size: number;
  exists: boolean;
}

export interface ImportPreviewPlan {
  id: string;
  name: string;
  /** true if a plan with the same name already exists (will be replaced if imported). */
  exists: boolean;
}

export interface ImportPreviewSetup {
  id: string;
  name: string;
  /** true if a setup with the same name already exists (will be replaced if imported). */
  exists: boolean;
}

export interface ImportPreviewGear {
  id: string;
  type: string;
  name: string;
  /** true if gear of the same type + name already exists (will be replaced if imported). */
  exists: boolean;
}

export interface ImportPreviewResult {
  hasMetadata: boolean;
  photos: number;
  hasDsoOverrides: boolean;
  hasCustomGear: boolean;
  hasSetups: boolean;
  hasPoiCategories: boolean;
  hasPlans: boolean;
  hasShortcuts: boolean;
  /** Parsed shortcuts.json content, applied client-side to localStorage on import. */
  shortcuts?: unknown;
  images: ImportPreviewImage[];
  plans: ImportPreviewPlan[];
  setups: ImportPreviewSetup[];
  gear: ImportPreviewGear[];
}

/** Dry-run: inspects ZIP/JSON bundle contents without writing to DB. */
export async function importPreview(file: File): Promise<ImportPreviewResult> {
  const fd = new FormData();
  fd.append('bundle', file);
  const res = await fetch('/api/import/preview', { method: 'POST', body: fd });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? t('settings.importError'));
  }
  return res.json();
}

export interface ImportResult {
  imported: number;
  skipped: number;
  dsoOverridesImported?: number;
}

export interface ImportOptions {
  importMetadata: boolean;
  importDsoOverrides: boolean;
  importPoiCategories?: boolean;
  /** null means no image filtering (metadata-only import). */
  selectedImages: string[] | null;
  /** ids of plans to import (name-collisions are replaced); null/empty ⇒ none. */
  selectedPlans: string[] | null;
  /** ids of gear setups to import (name-collisions are replaced); null/empty ⇒ none. */
  selectedSetups: string[] | null;
  /** ids of custom gear to import (type+name-collisions are replaced); null/empty ⇒ none. */
  selectedGear: string[] | null;
}

/** Import a sky bundle (.zip or .json) with the given options. */
export async function importData(file: File, opts: ImportOptions): Promise<ImportResult> {
  const fd = new FormData();
  fd.append('bundle', file);
  if (opts.importMetadata) fd.append('importMetadata', '1');
  if (opts.importDsoOverrides) fd.append('importDsoOverrides', '1');
  if (opts.importPoiCategories) fd.append('importPoiCategories', '1');
  if (opts.selectedImages !== null)
    fd.append('selectedImages', JSON.stringify(opts.selectedImages));
  if (opts.selectedPlans !== null) fd.append('selectedPlans', JSON.stringify(opts.selectedPlans));
  if (opts.selectedSetups !== null)
    fd.append('selectedSetups', JSON.stringify(opts.selectedSetups));
  if (opts.selectedGear !== null) fd.append('selectedGear', JSON.stringify(opts.selectedGear));
  const res = await fetch('/api/import', { method: 'POST', body: fd });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? t('settings.importError'));
  }
  return res.json();
}

export interface ServerSettings {
  apiKeySet: boolean;
  isWindows: boolean;
  ASTAP_PATH: string;
  SOLVE_FIELD_PATH: string;
  ASTROMETRY_DATA_DIR: string;
  USE_WSL_FOR_SOLVE_FIELD: boolean;
  USE_WSL_FOR_ASTAP: boolean;
  MAX_PARALLEL_SOLVES: string;
}

export interface SolverAvailability {
  solveField: boolean;
  astap: boolean;
  astrometry: boolean;
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
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json();
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
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? t('settings.importError'));
  }
}

export async function clearAstrometryApiKey(): Promise<void> {
  const res = await fetch('/api/settings/astrometry-api-key', { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? t('settings.importError'));
  }
}

// ─── DSO user overrides ──────────────────────────────────────────────────────

export async function getDsoOverrides(): Promise<Record<string, DSOUserOverride>> {
  const res = await fetch('/api/dso-overrides');
  if (!res.ok) return {};
  return res.json();
}

export async function upsertDsoOverride(id: string, data: DSOUserOverride): Promise<void> {
  const res = await fetch(`/api/dso-overrides/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to save DSO override');
  }
}

export async function deleteDsoOverride(id: string): Promise<void> {
  const res = await fetch(`/api/dso-overrides/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to delete DSO override');
  }
}

// ─── Custom gear ──────────────────────────────────────────────────────────────

export async function createCustomGear(
  type: 'telescope' | 'camera' | 'accessory' | 'filter',
  data: object,
): Promise<{ id: string }> {
  const res = await fetch('/api/custom-gear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, data }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to create custom gear');
  }
  return res.json();
}

export async function deleteCustomGear(id: string): Promise<void> {
  const res = await fetch(`/api/custom-gear/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to delete custom gear');
  }
}

export async function deleteBulkPhotos(ids: string[]): Promise<void> {
  const res = await fetch('/api/photos', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? t('errors.deletePhoto'));
  }
}

export async function deleteAllPhotoMetadata(): Promise<void> {
  const res = await fetch('/api/photo-metadata', { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? t('errors.deletePhoto'));
  }
}

export async function deleteAllDsoOverrides(): Promise<void> {
  const res = await fetch('/api/dso-overrides', { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to delete DSO overrides');
  }
}

export async function deleteAllCustomGear(): Promise<void> {
  const res = await fetch('/api/custom-gear', { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to delete custom gear');
  }
}

// ─── Gear setups ──────────────────────────────────────────────────────────────

export interface GearSetupData {
  id: string;
  name: string;
  telescopeId: string;
  cameraId: string;
  accessoryId: string | null;
  enabled: boolean;
}

export async function getGearSetups(): Promise<GearSetupData[]> {
  const res = await fetch('/api/gear-setups');
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to load gear setups');
  }
  return res.json();
}

export async function createGearSetup(data: Omit<GearSetupData, 'id'>): Promise<{ id: string }> {
  const res = await fetch('/api/gear-setups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to create gear setup');
  }
  return res.json();
}

export async function updateGearSetup(id: string, data: Omit<GearSetupData, 'id'>): Promise<void> {
  const res = await fetch(`/api/gear-setups/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to update gear setup');
  }
}

export async function patchGearSetupEnabled(id: string, enabled: boolean): Promise<void> {
  const res = await fetch(`/api/gear-setups/${encodeURIComponent(id)}/enabled`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to update gear setup enabled state');
  }
}

export async function deleteGearSetupAPI(id: string): Promise<void> {
  const res = await fetch(`/api/gear-setups/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to delete gear setup');
  }
}

export async function deleteAllGearSetupsAPI(): Promise<void> {
  const res = await fetch('/api/gear-setups', { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to delete all gear setups');
  }
}

// ─── Points of Interest categories ───────────────────────────────────────────

export async function getPoiCategories(): Promise<PoiCategory[]> {
  const res = await fetch('/api/poi-categories');
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to load POI categories');
  }
  return res.json();
}

export async function createPoiCategory(data: {
  name: string;
  color: string;
}): Promise<{ id: string }> {
  const res = await fetch('/api/poi-categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to create POI category');
  }
  return res.json();
}

export async function updatePoiCategory(
  id: string,
  data: Partial<{ name: string; color: string; position: number }>,
): Promise<void> {
  const res = await fetch(`/api/poi-categories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to update POI category');
  }
}

export async function deletePoiCategoryAPI(id: string): Promise<void> {
  const res = await fetch(`/api/poi-categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to delete POI category');
  }
}

// ─── Night plans ───────────────────────────────────────────────────────────

/**
 * A user-drawn observation window on a plan entry's night trajectory: a time
 * region (two draggable edges) during which the target will be imaged, with an
 * optional imaging filter and colour. Positions are stored as fractions of the
 * plotted night window so they render identically on the interactive chart and
 * the exported PDF (both map the same `win` via the chart's `xAt`).
 */
export interface ObservationWindow {
  id: string;
  /** Start position within the night window, [0,1] (win.start → win.end). */
  startFrac: number;
  /** End position within the night window, [0,1]; always > startFrac. */
  endFrac: number;
  /** Imaging filter name (e.g. 'Ha'), or null for no filter. */
  filter: string | null;
  /** Explicit CSS colour when the user overrides; null ⇒ derive from the filter. */
  color: string | null;
  /** Single-frame (sub) exposure in seconds; null ⇒ unset. Also the optional
   * drag snap-step when the window's step mode is enabled. */
  frameSeconds: number | null;
  /** When true, dragging snaps to whole single-frame steps (the "link" toggle).
   * Defaults on for newly created windows. */
  snap: boolean;
}

export interface PlanEntry {
  id: string;
  /** Target DSO id, or null for a custom location (framed on empty sky). */
  dsoId: string | null;
  position: number;
  paDeg: number | null;
  /** Frame-centre sky coordinates (degrees); null → use the DSO position. */
  ra: number | null;
  dec: number | null;
  notes: string | null;
  /** Mosaic this entry is a tile of, or null for a standalone frame. */
  mosaicId: string | null;
  /** Smart-scope single-frame mosaic size (deg); null ⇒ render at native FOV. */
  mosaicWDeg: number | null;
  mosaicHDeg: number | null;
  /** User-drawn observation windows on the night trajectory (may be empty). */
  observationWindows: ObservationWindow[];
}

/** A mosaic: a group of tile entries covering one target. Tiles are the plan
 * entries whose `mosaicId` equals this id; this record holds the group params. */
export interface PlanMosaic {
  id: string;
  dsoId: string | null;
  /** User-supplied name; null on legacy mosaics (then derived from the DSO). */
  name: string | null;
  /** Mosaic centre (degrees). */
  centerRa: number;
  centerDec: number;
  /** Group position angle (°E of N). */
  paDeg: number;
  /** Overlap percentage between adjacent tiles. */
  overlapPct: number;
  cols: number;
  rows: number;
  position: number;
}

/** Per-tile sky centre sent to the server when creating/updating a mosaic. */
export interface MosaicTileInput {
  ra: number;
  dec: number;
  paDeg: number | null;
}

export interface MosaicParams {
  dsoId: string | null;
  /** Omit to leave a stored name unchanged (background drags/transforms). */
  name?: string;
  centerRa: number;
  centerDec: number;
  paDeg: number;
  overlapPct: number;
  cols: number;
  rows: number;
  tiles: MosaicTileInput[];
  /** Standalone plan entries this mosaic replaces — deleted when it is created. */
  replaceEntryIds?: string[];
}

/**
 * Sort key for a plan's objects list (and its exported PDF). Mirrors the
 * meaningful subset of the Targets-search sort values plus `window` (order by
 * each entry's earliest observation window). `transit` is the default.
 */
export type PlanSortKey =
  'transit' | 'altitude' | 'rating' | 'magnitude' | 'size' | 'name' | 'difficulty' | 'window';

export interface Plan {
  id: string;
  name: string;
  position: number;
  /** Observation night (ISO `YYYY-MM-DD`), or null to fall back to the global date. */
  nightOf: string | null;
  /** Gear setup id used for this plan's FOV/recipe, or null. */
  setupId: string | null;
  /** Observing latitude (°N), or null to fall back to the global location. */
  lat: number | null;
  /** Observing longitude (°E), or null to fall back to the global location. */
  lon: number | null;
  /** Objects-list sort key (drives the UI list and the exported PDF order). */
  sortBy: PlanSortKey;
  entries: PlanEntry[];
  mosaics: PlanMosaic[];
}

export async function getPlans(): Promise<Plan[]> {
  const res = await fetch('/api/plans');
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to load plans');
  }
  return res.json();
}

export async function createPlanAPI(name: string): Promise<{ id: string }> {
  const res = await fetch('/api/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to create plan');
  }
  return res.json();
}

export async function renamePlanAPI(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/plans/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to rename plan');
  }
}

export async function updatePlanSettingsAPI(
  id: string,
  nightOf: string | null,
  setupId: string | null,
  lat: number | null,
  lon: number | null,
): Promise<void> {
  const res = await fetch(`/api/plans/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nightOf, setupId, lat, lon }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to update plan settings');
  }
}

/** Persist just a plan's objects-list sort key (partial update of the plan). */
export async function updatePlanSortAPI(id: string, sortBy: PlanSortKey): Promise<void> {
  const res = await fetch(`/api/plans/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sortBy }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to update plan sort');
  }
}

export async function deletePlanAPI(id: string): Promise<void> {
  const res = await fetch(`/api/plans/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to delete plan');
  }
}

export async function reorderPlansAPI(ids: string[]): Promise<void> {
  const res = await fetch('/api/plans/order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to reorder plans');
  }
}

export async function addPlanEntryAPI(planId: string, dsoId: string): Promise<{ id: string }> {
  const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dsoId }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to add target to plan');
  }
  return res.json();
}

/** Add a custom-location entry (no DSO) framed on empty sky at the given centre. */
export async function addCustomPlanEntryAPI(
  planId: string,
  ra: number,
  dec: number,
): Promise<{ id: string }> {
  const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ra, dec }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to add custom frame to plan');
  }
  return res.json();
}

export async function removePlanEntryAPI(planId: string, entryId: string): Promise<void> {
  const res = await fetch(
    `/api/plans/${encodeURIComponent(planId)}/entries/${encodeURIComponent(entryId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to remove target from plan');
  }
}

/** Create a mosaic in a plan from client-computed tiles. Returns the mosaic id. */
export async function createPlanMosaicAPI(
  planId: string,
  params: MosaicParams,
): Promise<{ id: string }> {
  const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/mosaics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to create mosaic');
  }
  return res.json();
}

/** Replace a mosaic's parameters and tile set. */
export async function updatePlanMosaicAPI(
  planId: string,
  mosaicId: string,
  params: MosaicParams,
): Promise<void> {
  const res = await fetch(
    `/api/plans/${encodeURIComponent(planId)}/mosaics/${encodeURIComponent(mosaicId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    },
  );
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to update mosaic');
  }
}

export async function deletePlanMosaicAPI(planId: string, mosaicId: string): Promise<void> {
  const res = await fetch(
    `/api/plans/${encodeURIComponent(planId)}/mosaics/${encodeURIComponent(mosaicId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to delete mosaic');
  }
}

export async function reorderPlanEntriesAPI(planId: string, ids: string[]): Promise<void> {
  const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/entries/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to reorder plan entries');
  }
}

export async function updatePlanEntryPAAPI(
  planId: string,
  entryId: string,
  paDeg: number | null,
): Promise<void> {
  const res = await fetch(
    `/api/plans/${encodeURIComponent(planId)}/entries/${encodeURIComponent(entryId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paDeg }),
    },
  );
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to update plan entry position angle');
  }
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
  const res = await fetch(
    `/api/plans/${encodeURIComponent(planId)}/entries/${encodeURIComponent(entryId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    },
  );
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to update plan entry position');
  }
}
