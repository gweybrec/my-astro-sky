/**
 * The backend of the desktop app and the web build: every method is one request to the Express
 * server's routes (the same ones `src/api.ts` called directly before), with the response wrappers
 * (`{ jobId }`, `{ candidates }`, ...) taken off so the result is what the service returns.
 *
 * This package may use browser APIs (`fetch`, `FormData`, `XMLHttpRequest`) but nothing of the app:
 * what it needs from the app (language, saving a file) arrives through `HttpBackendOptions`.
 */
import type { Backend, CancelSignal, FileSource, TransferOptions } from '@myastrosky/core/backend';
import { DomainError, type DomainErrorKind } from '@myastrosky/core/domain/errors';
import type { ErrorCode } from '@myastrosky/core/domain/error-codes';
import type {
  LocalSolverApi,
  LocalSolverName,
  LocalSolveHints,
  NovaSolveHints,
} from '@myastrosky/core/domain/solve';
import type { ConvertSolvedResult, SolveWcsResult } from '@myastrosky/core/domain/solved-import';
import type { ImportOptions } from '@myastrosky/core/domain/backup';
import type { ApiErrorDetails, PlateSolveResult } from '@myastrosky/core/types';

/** One multipart upload to send, with progress and cancel. */
export interface UploadRequest {
  url: string;
  form: FormData;
  onProgress?: (fraction: number) => void;
  cancel?: CancelSignal;
}

/** What an upload came back with, whatever its status. */
export interface UploadReply {
  status: number;
  statusText: string;
  text: string;
}

/** Sends a multipart POST and reports its progress. A cancelled one rejects with `DOMException('Aborted', 'AbortError')`. */
export type UploadFn = (request: UploadRequest) => Promise<UploadReply>;

export interface HttpBackendOptions {
  /** Prefix of every address; '' (the page's own origin) when absent. */
  baseUrl?: string;
  /** The `fetch` to use; the global one when absent. */
  fetch?: typeof fetch;
  /** The app's language, sent as the `lang` field of the routes that translate their messages. */
  lang: () => string;
  /** Hands a downloaded file to the user (the browser's save dialog). */
  saveFile(name: string, blob: Blob): void;
  /** Sends the two uploads that report progress (`photos.upload`, `solvedImport.convert`). `XMLHttpRequest` when absent. */
  upload?: UploadFn;
}

const KIND_BY_STATUS: Record<number, DomainErrorKind> = {
  400: 'invalid',
  404: 'notFound',
  409: 'conflict',
  429: 'rateLimited',
  502: 'upstream',
};

const HTTP_CODES: Record<number, ErrorCode> = {
  400: 'HTTP_400',
  404: 'HTTP_404',
  409: 'HTTP_409',
  413: 'HTTP_413',
  429: 'HTTP_429',
  500: 'HTTP_500',
  502: 'HTTP_502',
  503: 'HTTP_503',
  504: 'HTTP_504',
};

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

const LOCAL_SOLVER_ENDPOINT: Record<LocalSolverName, string> = {
  astap: '/api/solve-astap',
  'solve-field': '/api/solve-field',
};

const CATALOG_ROUTE = {
  telescope: '/api/telescopes',
  camera: '/api/cameras',
  accessory: '/api/accessories',
  filter: '/api/filters',
} as const;

const abortError = () => new DOMException('Aborted', 'AbortError');

const networkError = () => new DomainError('upstream', 'Network error', { code: 'NETWORK_ERROR' });

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The error of a response that is not a success. */
function failure(reply: UploadReply): DomainError {
  const body = parseJson(reply.text) as { error?: unknown; code?: unknown } | undefined;
  const message =
    typeof body?.error === 'string' && body.error
      ? body.error
      : reply.statusText || `HTTP ${reply.status}`;
  const code =
    typeof body?.code === 'string' && body.code
      ? (body.code as ErrorCode)
      : (HTTP_CODES[reply.status] ?? 'HTTP_ERROR');
  return new DomainError(KIND_BY_STATUS[reply.status] ?? 'upstream', message, { code });
}

/** The value of a successful response; a body that is not JSON is an `upstream` error. */
function jsonOf<T>(reply: UploadReply): T {
  if (reply.status < 200 || reply.status >= 300) throw failure(reply);
  const value = parseJson(reply.text);
  if (value === undefined && reply.text.trim() !== 'null') {
    throw new DomainError('upstream', 'Invalid response', { code: 'HTTP_ERROR' });
  }
  return value as T;
}

function bytesToBlob(bytes: Uint8Array, name: string): Blob {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return new Blob([bytes as BlobPart], { type: MIME_BY_EXTENSION[extension] ?? '' });
}

/** The upload of a file as the browser would make it: the `File` itself when there is one, else its bytes. */
async function blobOf(file: FileSource): Promise<Blob> {
  if (typeof Blob !== 'undefined' && file.native instanceof Blob) return file.native;
  return bytesToBlob(await file.read(), file.name);
}

/** The default upload: `XMLHttpRequest`, the only way to learn how much of a large body has left. */
const xhrUpload: UploadFn = ({ url, form, onProgress, cancel }) =>
  new Promise((resolve, reject) => {
    if (cancel?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
    }
    const onAbort = () => xhr.abort();
    cancel?.addEventListener('abort', onAbort);
    const done = () => cancel?.removeEventListener('abort', onAbort);
    xhr.onload = () => {
      done();
      resolve({ status: xhr.status, statusText: xhr.statusText, text: xhr.responseText });
    };
    xhr.onerror = () => {
      done();
      reject(networkError());
    };
    xhr.onabort = () => {
      done();
      reject(abortError());
    };
    xhr.send(form);
  });

/** An `AbortSignal` that follows a `CancelSignal`, for `fetch`. */
function followCancel(cancel: CancelSignal | undefined): { signal: AbortSignal; stop(): void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (cancel?.aborted) controller.abort();
  else cancel?.addEventListener('abort', onAbort);
  return { signal: controller.signal, stop: () => cancel?.removeEventListener('abort', onAbort) };
}

export function createHttpBackend(options: HttpBackendOptions): Backend {
  const baseUrl = options.baseUrl ?? '';
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? fetch)(input, init);
  const sendUpload: UploadFn = (request) => (options.upload ?? xhrUpload)(request);

  /** One request, answered with its status and text; a failure to reach the server is `NETWORK_ERROR`. */
  async function raw(method: string, path: string, init: RequestInit = {}): Promise<UploadReply> {
    let res: Response;
    try {
      res = await doFetch(baseUrl + path, { ...init, method });
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') throw e;
      throw networkError();
    }
    return { status: res.status, statusText: res.statusText, text: await res.text() };
  }

  /** A request with an optional JSON body; the parsed answer. */
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit =
      body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    return jsonOf<T>(await raw(method, path, init));
  }

  async function sendForm<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
    return jsonOf<T>(await raw('POST', path, { body: form, signal }));
  }

  const id = encodeURIComponent;

  /** A form with the file under `field`, then the given text fields (those that are defined). */
  async function formOf(
    field: string,
    file: FileSource,
    fields: Record<string, string | number | undefined>,
  ): Promise<FormData> {
    const form = new FormData();
    form.append(field, await blobOf(file), file.name);
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) form.append(key, String(value));
    }
    return form;
  }

  const hintFields = (hints: LocalSolveHints | undefined) => ({
    ra: hints?.ra,
    dec: hints?.dec,
    fov: hints?.fov,
    radius: hints?.radius,
  });

  const localSolvers: LocalSolverApi = {
    async submit(solver, file, hints, opts) {
      const form = await formOf('photo', file, { ...hintFields(hints), lang: options.lang() });
      const { signal, stop } = followCancel(opts?.cancel);
      try {
        return (await sendForm<{ jobId: string }>(LOCAL_SOLVER_ENDPOINT[solver], form, signal))
          .jobId;
      } finally {
        stop();
      }
    },
    poll: (solver, jobId) => call('GET', `${LOCAL_SOLVER_ENDPOINT[solver]}/${id(jobId)}`),
    async cancel(solver, jobId) {
      await call('DELETE', `${LOCAL_SOLVER_ENDPOINT[solver]}/${id(jobId)}`);
    },
    async solve(solver, file, hints, opts) {
      const endpoint = LOCAL_SOLVER_ENDPOINT[solver];
      const form = await formOf('photo', file, { ...hintFields(hints), lang: options.lang() });
      const { signal, stop } = followCancel(opts?.cancel);
      let reply: UploadReply;
      try {
        reply = await raw('POST', endpoint, { body: form, signal });
      } finally {
        stop();
      }
      if (reply.status >= 200 && reply.status < 300) return jsonOf<PlateSolveResult>(reply);
      const parsed = parseJson(reply.text) as { error?: unknown; code?: unknown } | undefined;
      const code = typeof parsed?.code === 'string' ? parsed.code.trim() : undefined;
      const responseBody = (parsed ? JSON.stringify(parsed, null, 2) : reply.text).trim();
      const errorDetails: ApiErrorDetails = {
        method: 'POST',
        endpoint,
        httpStatus: reply.status,
        httpStatusText: reply.statusText,
        code,
        ...(responseBody ? { responseBody: responseBody.slice(0, 8000) } : {}),
      };
      return {
        success: false,
        error: typeof parsed?.error === 'string' ? parsed.error.trim() : '',
        code,
        errorDetails,
      };
    },
    probe: (kind, request) =>
      call(
        'POST',
        `/api/settings/probe-${kind}`,
        kind === 'data-dir'
          ? { dir: request.dir, useWSL: request.useWSL }
          : { path: request.path, useWSL: request.useWSL },
      ),
  };

  const backend: Backend = {
    capabilities: { localSolvers: true },
    files: { url: (fileName) => `${baseUrl}/uploads/${fileName}` },
    catalog: {
      async starCatalogUrl() {
        // The server says which catalogue to use (STAR_CATALOG_PATH); without an answer the default one.
        try {
          const config = await call<{ starCatalog?: unknown }>('GET', '/api/config');
          if (typeof config.starCatalog === 'string') return baseUrl + config.starCatalog;
        } catch {
          // fall through to the default
        }
        return `${baseUrl}/data/stars.14.json`;
      },
    },

    plans: {
      list: () => call('GET', '/api/plans'),
      create: (input) => call('POST', '/api/plans', { name: input.name }),
      async reorder(ids) {
        await call('PUT', '/api/plans/order', { ids });
      },
      async update(planId, changes) {
        await call('PUT', `/api/plans/${id(planId)}`, changes ?? {});
      },
      async remove(planId) {
        await call('DELETE', `/api/plans/${id(planId)}`);
      },
      addEntry: (planId, input) => call('POST', `/api/plans/${id(planId)}/entries`, input),
      async reorderEntries(planId, ids) {
        await call('PUT', `/api/plans/${id(planId)}/entries/order`, { ids });
      },
      // The route ignores the plan in its path; without one the placeholder '-' stands in.
      async removeEntry(entryId, planId = '-') {
        await call('DELETE', `/api/plans/${id(planId)}/entries/${id(entryId)}`);
      },
      async updateEntry(entryId, changes, planId = '-') {
        await call('PATCH', `/api/plans/${id(planId)}/entries/${id(entryId)}`, changes);
      },
      createMosaic: (planId, params) => call('POST', `/api/plans/${id(planId)}/mosaics`, params),
      async updateMosaic(planId, mosaicId, params) {
        await call('PUT', `/api/plans/${id(planId)}/mosaics/${id(mosaicId)}`, params);
      },
      async removeMosaic(planId, mosaicId) {
        await call('DELETE', `/api/plans/${id(planId)}/mosaics/${id(mosaicId)}`);
      },
    },

    photos: {
      listWithSizes: () => call('GET', '/api/photos'),
      async remove(photoId) {
        await call('DELETE', `/api/photos/${id(photoId)}`);
      },
      async removeMany(ids) {
        return (await call<{ deleted: number }>('DELETE', '/api/photos', { ids })).deleted;
      },
      async removeAll() {
        return (await call<{ deleted: number }>('DELETE', '/api/photo-metadata')).deleted;
      },
      async updateMetadata(photoId, changes) {
        const reply = await call<{ originalName?: string }>(
          'PATCH',
          `/api/photos/${id(photoId)}/metadata`,
          changes,
        );
        return reply.originalName !== undefined ? { originalName: reply.originalName } : {};
      },
      async setManualPlacement(photoId, placement) {
        await call('PATCH', `/api/photos/${id(photoId)}/manual-placement`, {
          manualPlacement: placement ?? null,
        });
      },
      async setOrder(photoIds) {
        await call('PATCH', '/api/photos/order', { photoIds });
      },
      async upload(file, fields, opts) {
        const form = await formOf('photo', file, { ...fields });
        const reply = await sendUpload({
          url: `${baseUrl}/api/photos`,
          form,
          onProgress: opts?.onProgress,
          cancel: opts?.cancel,
        });
        return jsonOf(reply);
      },
    },

    gear: {
      listCatalog: (type) => call('GET', CATALOG_ROUTE[type]),
      addCustom: (type, data) => call('POST', '/api/custom-gear', { type, data }),
      async removeCustom(gearId) {
        await call('DELETE', `/api/custom-gear/${id(gearId)}`);
      },
      async removeAllCustom() {
        return (await call<{ deleted: number }>('DELETE', '/api/custom-gear')).deleted;
      },
      listSetups: () => call('GET', '/api/gear-setups'),
      createSetup: (input) => call('POST', '/api/gear-setups', input),
      async replaceSetup(setupId, input) {
        await call('PUT', `/api/gear-setups/${id(setupId)}`, input);
      },
      async setSetupEnabled(setupId, enabled) {
        await call('PATCH', `/api/gear-setups/${id(setupId)}/enabled`, { enabled });
      },
      async removeSetup(setupId) {
        await call('DELETE', `/api/gear-setups/${id(setupId)}`);
      },
      async removeAllSetups() {
        return (await call<{ deleted: number }>('DELETE', '/api/gear-setups')).deleted;
      },
    },

    dsoOverrides: {
      getAll: () => call('GET', '/api/dso-overrides'),
      async upsert(dsoId, data) {
        await call('PUT', `/api/dso-overrides/${id(dsoId)}`, data);
      },
      async remove(dsoId) {
        await call('DELETE', `/api/dso-overrides/${id(dsoId)}`);
      },
      async removeAll() {
        return (await call<{ deleted: number }>('DELETE', '/api/dso-overrides')).deleted;
      },
    },

    poiCategories: {
      list: () => call('GET', '/api/poi-categories'),
      create: (input) => call('POST', '/api/poi-categories', input),
      async update(categoryId, changes) {
        await call('PATCH', `/api/poi-categories/${id(categoryId)}`, changes);
      },
      async remove(categoryId) {
        await call('DELETE', `/api/poi-categories/${id(categoryId)}`);
      },
    },

    skyRegions: {
      list: () => call('GET', '/api/sky-regions'),
      create: (input) => call('POST', '/api/sky-regions', input),
      async update(regionId, changes) {
        await call('PATCH', `/api/sky-regions/${id(regionId)}`, changes);
      },
      async remove(regionId) {
        await call('DELETE', `/api/sky-regions/${id(regionId)}`);
      },
    },

    settings: {
      readPublic: () => call('GET', '/api/settings'),
      async update(changes) {
        await call('PUT', '/api/settings', changes);
        // The route answers `{ ok: true }`; the service reports a key was written when a non-empty one was sent.
        return {
          apiKeyChanged: typeof changes.apiKey === 'string' && changes.apiKey.trim().length > 0,
        };
      },
      async removeApiKey() {
        await call('DELETE', '/api/settings/astrometry-api-key');
      },
    },

    stars: {
      search(query, limit) {
        const params = new URLSearchParams({ q: query });
        if (limit !== undefined) params.set('limit', String(limit));
        return call('GET', `/api/stars/search?${params}`);
      },
      nearby(query) {
        const params = new URLSearchParams({
          ra: String(query.ra),
          dec: String(query.dec),
          radius: String(query.radius),
          magLimit: String(query.magLimit ?? 10),
          limit: String(query.limit ?? 20),
        });
        return call('GET', `/api/stars/nearby?${params}`);
      },
      getByHip: (hip) => call('GET', `/api/stars/${id(String(hip))}`),
    },

    horizon: {
      getProfile(query) {
        const params = new URLSearchParams({ lat: String(query.lat), lon: String(query.lon) });
        if (query.radiusKm != null) params.set('radiusKm', String(query.radiusKm));
        if (query.obsHeightM != null) params.set('obsHeightM', String(query.obsHeightM));
        return call('GET', `/api/horizon?${params}`);
      },
    },

    identify: {
      async searchAsteroids(params) {
        return (
          await call<{ candidates: Awaited<ReturnType<Backend['identify']['searchAsteroids']>> }>(
            'POST',
            '/api/skybot/conesearch',
            {
              ...params,
              lang: options.lang(),
            },
          )
        ).candidates;
      },
      async searchTransients(params) {
        try {
          return (
            await call<{
              candidates: Awaited<ReturnType<Backend['identify']['searchTransients']>>;
            }>('POST', '/api/tns/conesearch', { ...params, lang: options.lang() })
          ).candidates;
        } catch (e) {
          // The route names the TNS limit RATE_LIMITED; the service names it TNS_RATE_LIMITED.
          if (e instanceof DomainError && e.code === 'RATE_LIMITED') {
            throw new DomainError('rateLimited', e.message, { code: 'TNS_RATE_LIMITED' });
          }
          throw e;
        }
      },
      async getCometElements() {
        return (
          await call<{ comets: Awaited<ReturnType<Backend['identify']['getCometElements']>> }>(
            'GET',
            `/api/comets/elements?lang=${encodeURIComponent(options.lang())}`,
          )
        ).comets;
      },
    },

    version: { getLatest: () => call('GET', '/api/version/latest') },

    novaSolve: {
      getJob: (jobId) => call('GET', `/api/solve-plate/${id(jobId)}`),
      async listSubmissions() {
        return (
          await call<{ submissions: Awaited<ReturnType<Backend['novaSolve']['listSubmissions']>> }>(
            'GET',
            '/api/astrometry/submissions',
          )
        ).submissions;
      },
      async submit(file: FileSource, hints?: NovaSolveHints) {
        const form = await formOf('photo', file, {
          ra: hints?.ra,
          dec: hints?.dec,
          radius: hints?.radius,
          scale_lower: hints?.scale_lower,
          scale_upper: hints?.scale_upper,
        });
        return (await sendForm<{ jobId: string }>('/api/solve-plate', form)).jobId;
      },
      async reuse(file, jobId) {
        const form = await formOf('photo', file, { jobId, lang: options.lang() });
        return sendForm('/api/astrometry/reuse', form);
      },
    },

    solvedImport: {
      async solveWcs(file, target): Promise<SolveWcsResult> {
        const form = await formOf('photo', file, {
          lang: options.lang(),
          targetWidth: target?.width,
          targetHeight: target?.height,
        });
        const reply = await sendForm<Record<string, unknown>>('/api/solve-wcs', form);
        if (reply.success === false) {
          return { success: false, code: reply.code as 'NO_WCS_DATA' };
        }
        const { error: _error, ...result } = reply;
        return result as SolveWcsResult;
      },
      async convert(file, opts?: TransferOptions): Promise<ConvertSolvedResult> {
        const form = await formOf('photo', file, { lang: options.lang() });
        const reply = jsonOf<Record<string, unknown> & { pngBase64: string }>(
          await sendUpload({
            url: `${baseUrl}/api/photos/convert`,
            form,
            onProgress: opts?.onProgress,
            cancel: opts?.cancel,
          }),
        );
        const { pngBase64, error: _error, ...rest } = reply;
        const text = atob(pngBase64);
        const png = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) png[i] = text.charCodeAt(i);
        return { ...rest, png } as ConvertSolvedResult;
      },
    },

    backup: {
      async exportToUser(request) {
        let res: Response;
        try {
          res = await doFetch(`${baseUrl}/api/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
          });
        } catch {
          throw networkError();
        }
        if (!res.ok) {
          throw failure({
            status: res.status,
            statusText: res.statusText,
            text: await res.text(),
          });
        }
        const blob = await res.blob();
        // The file name comes from Content-Disposition; a sensible default when it is missing.
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = disposition.match(/filename="?([^"]+)"?/);
        options.saveFile(match ? match[1] : 'sky-export.zip', blob);
      },
      async preview(file) {
        const form = await formOf('bundle', file, {});
        return sendForm('/api/import/preview', form);
      },
      async restore(file, opts: ImportOptions) {
        const form = await formOf('bundle', file, {
          importMetadata: opts.importMetadata ? '1' : undefined,
          importDsoOverrides: opts.importDsoOverrides ? '1' : undefined,
          importPoiCategories: opts.importPoiCategories ? '1' : undefined,
          importSkyRegions: opts.importSkyRegions ? '1' : undefined,
          selectedImages: json(opts.selectedImages),
          selectedPlans: json(opts.selectedPlans),
          selectedSetups: json(opts.selectedSetups),
          selectedGear: json(opts.selectedGear),
          setupConflicts:
            opts.setupConflicts && Object.keys(opts.setupConflicts).length > 0
              ? JSON.stringify(opts.setupConflicts)
              : undefined,
        });
        return sendForm('/api/import', form);
      },
    },

    localSolvers,
  };
  return backend;
}

/** A list or object as the JSON text of a form field; a field that is `null` or absent is not sent. */
function json(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : JSON.stringify(value);
}
