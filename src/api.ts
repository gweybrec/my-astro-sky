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
import type { SkybotCandidate } from './asteroid-identify';
import type { TnsCandidate } from './supernova-identify';
import type { CometElements } from './comet-ephemeris';

// ─── Shared domain types (live in @myastrosky/core; re-exported so importers are unchanged) ───
import type {
  LatestRelease,
  ServerSettings,
  SolverAvailability,
} from '@myastrosky/core/domain/settings';
import type { StarSearchResult } from '@myastrosky/core/domain/stars';
import type {
  ConvertRawPhotoResult as CoreConvertRawPhotoResult,
  AstrometrySubmission,
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
import type { GearSetupData } from '@myastrosky/core/domain/gear';
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

/** The message for a failed response: its `code` translated, else its `error`, else `fallbackKey`. */
async function failureMessage(res: Response, fallbackKey: string): Promise<string> {
  let data: { error?: string; code?: string } = {};
  try {
    data = await res.json();
  } catch {
    // the body is not JSON (or there is none): the fallback message is used
  }
  return parseServerError(data ?? {}, fallbackKey);
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
  if (!res.ok) throw new Error(await failureMessage(res, 'errors.loadPhotos'));
  return res.json();
}

export async function deletePhotoAPI(id: string): Promise<void> {
  const res = await fetch(`/api/photos/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await failureMessage(res, 'errors.deletePhoto'));
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
  if (!res.ok) throw new Error(await failureMessage(res, 'errors.updatePhoto'));
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
  if (!res.ok) throw new Error(await failureMessage(res, 'errors.updatePhoto'));
}

export async function updatePhotoOrder(photoIds: string[]): Promise<void> {
  const res = await fetch('/api/photos/order', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoIds }),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'errors.updatePhoto'));
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
    let data: { error?: string; code?: string } | null = null;
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON: the raw text is shown as before
    }
    throw new Error(
      t('errors.wcsError', { text: data?.code ? parseServerError(data, 'errors.wcsError') : text }),
    );
  }

  return res.json();
}

/**
 * Convert a raw astro image (TIFF/FITS) to a PNG on the server — the raw file is never
 * stored. Returns the converted PNG as a `File` (ready to flow through the normal upload
 * pipeline) plus any WCS/capture metadata found in the raw file's header, in the same
 * shape `solveWCS` returns. XHR (not fetch) is used because the raw upload is the slow
 * part and only XHR exposes upload progress.
 */
export function convertRawPhoto(
  file: File,
  onUploadProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ConvertRawPhotoResult> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('lang', getLang());

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/photos/convert');

    if (onUploadProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onUploadProgress(e.loaded / e.total);
      };
    }

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort());
    }

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let errorMsg = t('errors.uploadFailed', { response: xhr.responseText });
        try {
          errorMsg = parseServerError(JSON.parse(xhr.responseText), 'errors.uploadFailed');
        } catch {
          /* non-JSON response, keep default */
        }
        reject(new Error(errorMsg));
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as PlateSolveResult & {
          width: number;
          height: number;
          pngBase64: string;
        };
        const bytes = atob(body.pngBase64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const pngFile = new File([arr], `${file.name.replace(/\.[^.]+$/, '')}.png`, {
          type: 'image/png',
        });
        const { pngBase64: _pngBase64, ...meta } = body;
        resolve({ png: pngFile, meta });
      } catch {
        reject(new Error(t('errors.invalidResponse')));
      }
    };

    xhr.onerror = () => reject(new Error(t('errors.networkError')));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.send(formData);
  });
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
  if (!res.ok) throw new Error(await failureMessage(res, 'errors.pollFailed'));
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
  if (!res.ok) throw new Error(await failureMessage(res, 'errors.pollFailed'));
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
    return { success: false, error: parseServerError(data, 'errors.reuseSubmissionFailed') };
  }
  return res.json();
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
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ options, ids, shortcuts }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(parseServerError(data, 'settings.importError'));
  }
  const blob = await res.blob();
  // Filename comes from Content-Disposition; fall back to a sensible default
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  downloadBlob(blob, match ? match[1] : 'sky-export.zip');
}

/** Dry-run: inspects ZIP/JSON bundle contents without writing to DB. */
export async function importPreview(file: File): Promise<ImportPreviewResult> {
  const fd = new FormData();
  fd.append('bundle', file);
  const res = await fetch('/api/import/preview', { method: 'POST', body: fd });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(parseServerError(data, 'settings.importError'));
  }
  return res.json();
}

/** Import a sky bundle (.zip or .json) with the given options. */
export async function importData(file: File, opts: ImportOptions): Promise<ImportResult> {
  const fd = new FormData();
  fd.append('bundle', file);
  if (opts.importMetadata) fd.append('importMetadata', '1');
  if (opts.importDsoOverrides) fd.append('importDsoOverrides', '1');
  if (opts.importPoiCategories) fd.append('importPoiCategories', '1');
  if (opts.importSkyRegions) fd.append('importSkyRegions', '1');
  if (opts.selectedImages !== null)
    fd.append('selectedImages', JSON.stringify(opts.selectedImages));
  if (opts.selectedPlans !== null) fd.append('selectedPlans', JSON.stringify(opts.selectedPlans));
  if (opts.selectedSetups !== null)
    fd.append('selectedSetups', JSON.stringify(opts.selectedSetups));
  if (opts.selectedGear !== null) fd.append('selectedGear', JSON.stringify(opts.selectedGear));
  if (opts.setupConflicts && Object.keys(opts.setupConflicts).length > 0)
    fd.append('setupConflicts', JSON.stringify(opts.setupConflicts));
  const res = await fetch('/api/import', { method: 'POST', body: fd });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(parseServerError(data, 'settings.importError'));
  }
  return res.json();
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
  if (!res.ok) throw new Error(await failureMessage(res, 'errors.loadSettings'));
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
    throw new Error(parseServerError(data, 'settings.importError'));
  }
}

export async function clearAstrometryApiKey(): Promise<void> {
  const res = await fetch('/api/settings/astrometry-api-key', { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(parseServerError(data, 'settings.importError'));
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
    throw new Error(parseServerError(d, 'errors.saveDsoOverride'));
  }
}

export async function deleteDsoOverride(id: string): Promise<void> {
  const res = await fetch(`/api/dso-overrides/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.deleteDsoOverride'));
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
    throw new Error(parseServerError(d, 'errors.createCustomGear'));
  }
  return res.json();
}

export async function deleteCustomGear(id: string): Promise<void> {
  const res = await fetch(`/api/custom-gear/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.deleteCustomGear'));
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
    throw new Error(parseServerError(d, 'errors.deletePhoto'));
  }
}

export async function deleteAllPhotoMetadata(): Promise<void> {
  const res = await fetch('/api/photo-metadata', { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.deletePhoto'));
  }
}

export async function deleteAllDsoOverrides(): Promise<void> {
  const res = await fetch('/api/dso-overrides', { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.deleteDsoOverrides'));
  }
}

export async function deleteAllCustomGear(): Promise<void> {
  const res = await fetch('/api/custom-gear', { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.deleteCustomGear'));
  }
}

// ─── Gear setups ──────────────────────────────────────────────────────────────

export async function getGearSetups(): Promise<GearSetupData[]> {
  const res = await fetch('/api/gear-setups');
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.loadGearSetups'));
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
    throw new Error(parseServerError(d, 'errors.createGearSetup'));
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
    throw new Error(parseServerError(d, 'errors.updateGearSetup'));
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
    throw new Error(parseServerError(d, 'errors.updateGearSetupEnabled'));
  }
}

export async function deleteGearSetupAPI(id: string): Promise<void> {
  const res = await fetch(`/api/gear-setups/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.deleteGearSetup'));
  }
}

export async function deleteAllGearSetupsAPI(): Promise<void> {
  const res = await fetch('/api/gear-setups', { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.deleteAllGearSetups'));
  }
}

// ─── Points of Interest categories ───────────────────────────────────────────

export async function getPoiCategories(): Promise<PoiCategory[]> {
  const res = await fetch('/api/poi-categories');
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.loadPoiCategories'));
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
    throw new Error(parseServerError(d, 'errors.createPoiCategory'));
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
    throw new Error(parseServerError(d, 'errors.updatePoiCategory'));
  }
}

export async function deletePoiCategoryAPI(id: string): Promise<void> {
  const res = await fetch(`/api/poi-categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.deletePoiCategory'));
  }
}

// ─── Sky regions ────────────────────────────────────────────────────────────

export async function getSkyRegions(): Promise<SkyRegionData[]> {
  const res = await fetch('/api/sky-regions');
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.loadSkyRegions'));
  }
  return res.json();
}

export async function createSkyRegion(
  data: Omit<SkyRegionData, 'id' | 'position'>,
): Promise<{ id: string }> {
  const res = await fetch('/api/sky-regions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.createSkyRegion'));
  }
  return res.json();
}

export async function updateSkyRegion(
  id: string,
  data: Partial<Omit<SkyRegionData, 'id'>>,
): Promise<void> {
  const res = await fetch(`/api/sky-regions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.updateSkyRegion'));
  }
}

export async function deleteSkyRegionAPI(id: string): Promise<void> {
  const res = await fetch(`/api/sky-regions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.deleteSkyRegion'));
  }
}

// ─── Night plans ───────────────────────────────────────────────────────────

export async function getPlans(): Promise<Plan[]> {
  const res = await fetch('/api/plans');
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.loadPlans'));
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
    throw new Error(parseServerError(d, 'errors.createPlan'));
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
    throw new Error(parseServerError(d, 'errors.renamePlan'));
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
    throw new Error(parseServerError(d, 'errors.updatePlanSettings'));
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
    throw new Error(parseServerError(d, 'errors.updatePlanSort'));
  }
}

export async function deletePlanAPI(id: string): Promise<void> {
  const res = await fetch(`/api/plans/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.deletePlan'));
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
    throw new Error(parseServerError(d, 'errors.reorderPlans'));
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
    throw new Error(parseServerError(d, 'errors.addPlanTarget'));
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
    throw new Error(parseServerError(d, 'errors.addPlanFrame'));
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
    throw new Error(parseServerError(d, 'errors.removePlanTarget'));
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
    throw new Error(parseServerError(d, 'errors.createMosaic'));
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
    throw new Error(parseServerError(d, 'errors.updateMosaic'));
  }
}

export async function deletePlanMosaicAPI(planId: string, mosaicId: string): Promise<void> {
  const res = await fetch(
    `/api/plans/${encodeURIComponent(planId)}/mosaics/${encodeURIComponent(mosaicId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(parseServerError(d, 'errors.deleteMosaic'));
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
    throw new Error(parseServerError(d, 'errors.reorderPlanEntries'));
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
    throw new Error(parseServerError(d, 'errors.updatePlanEntryAngle'));
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
    throw new Error(parseServerError(d, 'errors.updatePlanEntryPosition'));
  }
}

/**
 * Cone-searches IMCCE SkyBoT (via the server proxy, `POST /api/skybot/conesearch`)
 * for known asteroids near a sky position and epoch. Used by the asteroid
 * identification modal to match the user's marked trail against a candidate.
 */
export async function skybotConesearchAPI(params: {
  raDeg: number;
  decDeg: number;
  radiusArcmin: number;
  epochJd: number;
}): Promise<SkybotCandidate[]> {
  const res = await fetch('/api/skybot/conesearch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, lang: getLang() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseServerError(data, 'errors.skybotSearch'));
  }
  return data.candidates ?? [];
}

/**
 * Cone-searches the IAU Transient Name Server (via the server proxy,
 * `POST /api/tns/conesearch`) for transients discovered in a date window. Used by
 * the supernova identification modal. The proxy caches results — TNS allows only
 * ~2 anonymous cone searches a minute, surfaced as a translated 429 message.
 */
export async function tnsConesearchAPI(params: {
  raDeg: number;
  decDeg: number;
  radiusArcmin: number;
  dateStart: string;
  dateEnd: string;
}): Promise<TnsCandidate[]> {
  const res = await fetch('/api/tns/conesearch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, lang: getLang() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseServerError(data, 'errors.tnsSearch'));
  }
  return data.candidates ?? [];
}

let cometElementsPromise: Promise<CometElements[]> | null = null;

/**
 * Current MPC comet orbital elements (via the server's cached proxy,
 * `GET /api/comets/elements`). Memoised for the session — the comet
 * identification modal re-propagates them on every date edit. A failed load
 * is not memoised, so reopening the modal retries.
 */
export function cometElementsAPI(): Promise<CometElements[]> {
  cometElementsPromise ??= (async () => {
    const res = await fetch(`/api/comets/elements?lang=${getLang()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(parseServerError(data, 'errors.cometElements'));
    }
    return (data.comets ?? []) as CometElements[];
  })().catch((err: unknown) => {
    cometElementsPromise = null;
    throw err;
  });
  return cometElementsPromise;
}
