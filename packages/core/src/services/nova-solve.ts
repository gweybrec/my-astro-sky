/**
 * Online plate solving through astrometry.net (nova.astrometry.net): log in with the API key
 * (read through the settings service), upload a picture, poll the job, read the solution as a
 * WCS file or a calibration, list the past submissions and reuse a solved job for another
 * picture. Every request goes through the `HttpClient` port. The session key and the jobs
 * belong to the service instance, and `now` dates them. It has no database and no file access.
 */
import {
  calibrationToCorrespondences,
  dimensionsFromJobInfo,
  dimensionsFromWcsHeader,
  hasAllWcsKeys,
  solutionFitsPicture,
  solutionToWcs,
  type NovaCalibration,
} from '../astrometry-solution';
import { normalizeDSOAliases } from '../dso-aliases';
import { DomainError } from '../domain/errors';
import type {
  AstrometrySubmission,
  NovaCorrespondence,
  NovaJobState,
  NovaJobStatus,
  NovaReuseResult,
  NovaSolveFile,
  NovaSolveHints,
} from '../domain/solve';
import type { HttpClient, HttpResponse } from '../ports/http-client';
import type { ImageCodec } from '../ports/image-codec';
import { extractWCS, parseFITSHeader, wcsToCorrespondencesWithCatalog } from '../wcs';
import type { CatalogStar } from '../wcs';
import type { CatalogStarSource } from './solved-import';

const API_BASE = 'https://nova.astrometry.net/api';
const WCS_FILE_BASE = 'https://nova.astrometry.net/wcs_file';
const API_KEY_SETTING = 'ASTROMETRY_API_KEY';
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour
/** Seconds between two polls (the last one repeats); about 80 s to get a job id, as many polls again to solve it. */
const POLL_DELAYS_MS = [3000, 5000, 8000, 13000, 13000, 13000, 13000, 13000];
const LIST_BATCH_SIZE = 5;

export interface NovaSolveServiceDeps {
  http: HttpClient;
  /** Reads the API key (`ASTROMETRY_API_KEY`); the settings service satisfies it. */
  settings: { get(key: string): Promise<string | undefined> };
  /** Reads the size of a picture. */
  images: ImageCodec;
  /** The catalogue (every magnitude) that solutions are matched against, or a function that loads it. */
  stars: CatalogStarSource;
  /** The clock, in milliseconds since the epoch; it dates the jobs. */
  now: () => number;
  /** A new unique id for a job. */
  newId: () => string;
  /** Where a problem that does not fail the call is reported. */
  log?: (event: string, error: unknown, context?: Record<string, unknown>) => void;
  /** Waits between two polls; the default is a timer. */
  sleep?: (ms: number) => Promise<void>;
}

export interface NovaSolveService {
  /** True when an API key is set (stored or in the environment). */
  isConfigured(): Promise<boolean>;
  /** Forgets the session; the next call logs in again. Call it when the API key changed. */
  resetSession(): void;
  /**
   * Uploads the picture and starts solving in the background; returns the local job id. A
   * rejected or failed upload is not an error: the job is `failed` and carries the message.
   * Throws `invalid` (`ASTROMETRY_NOT_CONFIGURED`) without a key, `invalid`
   * (`CANNOT_DETERMINE_DIMENSIONS`) when the size of the picture cannot be read; a login that
   * fails or cannot be reached throws (`upstream` `ASTROMETRY_LOGIN_FAILED`, or the network error).
   */
  submit(file: NovaSolveFile, hints?: NovaSolveHints): Promise<string>;
  /** The state of a local job. Throws `notFound` (`JOB_NOT_FOUND`) for an unknown or expired id. */
  getJob(localId: string): Promise<NovaJobStatus>;
  /** The jobs of the account, most recent first; an empty list when the account cannot be read. */
  listSubmissions(): Promise<AstrometrySubmission[]>;
  /**
   * Builds the correspondences of an already solved astrometry.net job for this picture.
   * Throws `invalid` (`INVALID_JOB_ID`, `CANNOT_DETERMINE_DIMENSIONS`); a job that is not solved,
   * a solution of another shape or a network failure is a result with `success: false`.
   */
  reuse(file: NovaSolveFile, jobId: number): Promise<NovaReuseResult>;
}

interface Job {
  localId: string;
  createdAt: number;
  submissionId?: number;
  jobId?: number;
  status: NovaJobState;
  correspondences?: NovaCorrespondence[];
  error?: string;
  imageWidth: number;
  imageHeight: number;
  dsoIds?: string[];
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isOk = (res: HttpResponse) => res.status >= 200 && res.status <= 299;
const readJson = async (res: HttpResponse): Promise<any> => JSON.parse(await res.text());
const formBody = (payload: unknown) =>
  `request-json=${encodeURIComponent(JSON.stringify(payload))}`;

function extensionOf(fileName: string): string {
  const base = fileName.slice(Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

export function createNovaSolveService(deps: NovaSolveServiceDeps): NovaSolveService {
  const { http, settings, images, stars, now, newId, log } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const jobs = new Map<string, Job>();
  let sessionKey: string | null = null;

  const catalog = async (): Promise<CatalogStar[]> =>
    (typeof stars === 'function' ? await stars() : stars) as CatalogStar[];

  function evictStaleJobs(): void {
    const t = now();
    for (const [id, job] of jobs) {
      if (t - job.createdAt > JOB_TTL_MS) jobs.delete(id);
    }
  }

  async function isConfigured(): Promise<boolean> {
    return !!(await settings.get(API_KEY_SETTING));
  }

  async function login(): Promise<string> {
    const apiKey = await settings.get(API_KEY_SETTING);
    if (!apiKey) {
      throw new DomainError('invalid', 'ASTROMETRY_API_KEY non configurée', {
        code: 'ASTROMETRY_NOT_CONFIGURED',
      });
    }
    const res = await http({
      method: 'POST',
      url: `${API_BASE}/login`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ apikey: apiKey }),
    });
    const data = await readJson(res);
    if (data.status !== 'success') {
      throw new DomainError(
        'upstream',
        `Échec de l'authentification astrometry.net: ${data.errormessage || 'unknown'}`,
        { code: 'ASTROMETRY_LOGIN_FAILED' },
      );
    }
    sessionKey = data.session as string;
    return sessionKey;
  }

  async function getSession(): Promise<string> {
    return sessionKey ?? login();
  }

  /** The size of a picture: its own, else the one a FITS header reports. 0 when unknown. */
  async function dimensionsOf(file: NovaSolveFile): Promise<{ width: number; height: number }> {
    try {
      const info = await images.probe(file.bytes);
      return { width: info.width || 0, height: info.height || 0 };
    } catch {
      // For non-image formats, try to extract from FITS header
      const ext = extensionOf(file.fileName);
      if (ext === '.fits' || ext === '.fit') {
        const wcs = extractWCS(file.bytes, ext);
        if (wcs) return { width: wcs.NAXIS1, height: wcs.NAXIS2 };
      }
      return { width: 0, height: 0 };
    }
  }

  async function requireDimensions(file: NovaSolveFile) {
    const dims = await dimensionsOf(file);
    if (!dims.width || !dims.height) {
      throw new DomainError('invalid', 'Cannot determine image dimensions', {
        code: 'CANNOT_DETERMINE_DIMENSIONS',
      });
    }
    return dims;
  }

  /** The known objects in the field, as compact ids; empty when the answer cannot be read. */
  async function fetchObjectsInField(jobId: number): Promise<string[]> {
    try {
      const res = await http({ method: 'GET', url: `${API_BASE}/jobs/${jobId}/objects_in_field/` });
      if (!isOk(res)) return [];
      const data = await readJson(res);
      const names: string[] = data?.objects_in_field ?? [];
      return normalizeDSOAliases(names);
    } catch {
      return [];
    }
  }

  /** The WCS file of a job, parsed; null when it is missing or not a WCS header. */
  async function fetchWcsHeader(jobId: number) {
    const res = await http({ method: 'GET', url: `${WCS_FILE_BASE}/${jobId}/` });
    const text = await res.text();
    if (text && text.includes('CRPIX1')) return parseFITSHeader(text);
    return null;
  }

  async function fetchCalibration(jobId: number): Promise<NovaCalibration> {
    const res = await http({ method: 'GET', url: `${API_BASE}/jobs/${jobId}/calibration/` });
    return readJson(res);
  }

  async function submit(file: NovaSolveFile, hints?: NovaSolveHints): Promise<string> {
    if (!(await isConfigured())) {
      throw new DomainError('invalid', 'ASTROMETRY_API_KEY not configured', {
        code: 'ASTROMETRY_NOT_CONFIGURED',
      });
    }
    const { width: imageWidth, height: imageHeight } = await requireDimensions(file);

    const session = await getSession();
    const localId = newId();
    evictStaleJobs();
    const job: Job = { localId, createdAt: now(), status: 'pending', imageWidth, imageHeight };
    jobs.set(localId, job);

    const requestData: Record<string, unknown> = {
      session,
      publicly_visible: 'n',
      allow_modifications: 'n',
      allow_commercial_use: 'n',
    };
    if (hints?.ra !== undefined && hints?.dec !== undefined) {
      requestData.center_ra = hints.ra;
      requestData.center_dec = hints.dec;
      requestData.radius = hints.radius || 2.0; // Search within 2 degrees by default
    }
    if (hints?.scale_lower !== undefined) requestData.scale_lower = hints.scale_lower;
    if (hints?.scale_upper !== undefined) requestData.scale_upper = hints.scale_upper;
    // Estimate the scale from the picture when it is not given: a field of 2 degrees on the smaller side.
    if (!requestData.scale_lower && !requestData.scale_upper) {
      const minDim = Math.min(imageWidth, imageHeight);
      const estimatedArcsecPerPx = (2.0 * 3600) / minDim;
      requestData.scale_lower = estimatedArcsecPerPx * 0.5;
      requestData.scale_upper = estimatedArcsecPerPx * 2.0;
      requestData.scale_units = 'arcsecperpix';
    }

    try {
      const res = await http({
        method: 'POST',
        url: `${API_BASE}/upload`,
        body: {
          form: [
            { name: 'request-json', value: JSON.stringify(requestData) },
            {
              name: 'file',
              fileName: file.fileName,
              type: 'application/octet-stream',
              bytes: file.bytes,
            },
          ],
        },
      });
      const data = await readJson(res);
      if (data.status !== 'success') {
        job.status = 'failed';
        job.error = data.errormessage || 'Upload rejected';
        return localId;
      }
      job.submissionId = data.subid;
      job.status = 'solving';
      // Poll in the background; the caller gets the id now.
      pollJob(job).catch((err) => log?.('astrometry_poll_failed', err, { jobId: localId }));
    } catch (err) {
      job.status = 'failed';
      job.error = (err as Error).message;
    }
    return localId;
  }

  /** Waits for the submission to become a job, then for the job to finish, and stores the solution. */
  async function pollJob(job: Job): Promise<void> {
    if (!job.submissionId) return;
    const delays = POLL_DELAYS_MS;
    let attempt = 0;

    // First: poll the submission to get the job id.
    while (attempt < delays.length) {
      await sleep(delays[Math.min(attempt, delays.length - 1)]);
      attempt++;
      if (job.status !== 'solving') return;
      try {
        const subRes = await http({
          method: 'GET',
          url: `${API_BASE}/submissions/${job.submissionId}`,
        });
        const subData = await readJson(subRes);
        if (subData.jobs && subData.jobs.length > 0 && subData.jobs[0] !== null) {
          job.jobId = subData.jobs[0];
          break;
        }
      } catch {
        // Retry
      }
    }
    if (!job.jobId) {
      job.status = 'timeout';
      job.error = 'Timeout: pas de job créé';
      return;
    }

    // Then poll the job.
    while (attempt < delays.length + 8) {
      await sleep(delays[Math.min(attempt, delays.length - 1)]);
      attempt++;
      if (job.status !== 'solving') return;
      try {
        const jobData = await readJson(
          await http({ method: 'GET', url: `${API_BASE}/jobs/${job.jobId}` }),
        );
        if (jobData.status === 'success') {
          // The WCS file of the job, when it gives enough correspondences.
          try {
            const parsed = await fetchWcsHeader(job.jobId);
            if (parsed && hasAllWcsKeys(parsed)) {
              const correspondences = wcsToCorrespondencesWithCatalog(
                solutionToWcs(parsed, job.imageWidth, job.imageHeight),
                await catalog(),
                job.imageWidth,
                job.imageHeight,
              );
              if (correspondences.length >= 3) {
                job.status = 'solved';
                job.correspondences = correspondences;
                job.dsoIds = await fetchObjectsInField(job.jobId);
                return;
              }
            }
          } catch (err) {
            log?.('astrometry_wcs_file_failed', err, { jobId: job.jobId });
          }

          // Fallback: the calibration.
          const cal = await fetchCalibration(job.jobId);
          const correspondences = calibrationToCorrespondences(
            cal,
            job.imageWidth,
            job.imageHeight,
            await catalog(),
          );
          if (correspondences.length >= 3) {
            job.status = 'solved';
            job.correspondences = correspondences;
            job.dsoIds = await fetchObjectsInField(job.jobId);
          } else {
            job.status = 'failed';
            job.error = 'Calibration obtained but no catalog stars found in the field';
          }
          return;
        } else if (jobData.status === 'failure') {
          job.status = 'failed';
          job.error = 'Solving failed';
          return;
        }
        // else still solving, continue polling
      } catch {
        // Retry
      }
    }
    job.status = 'timeout';
    job.error = 'Timeout: résolution trop longue';
  }

  async function fetchSubmissionInfo(jobId: number): Promise<AstrometrySubmission> {
    const unknown = (): AstrometrySubmission => ({
      submissionId: jobId,
      jobId,
      status: 'unknown',
      filename: undefined,
      timestamp: undefined,
      width: undefined,
      height: undefined,
    });
    try {
      const infoRes = await http({ method: 'GET', url: `${API_BASE}/jobs/${jobId}/info/` });
      if (!isOk(infoRes)) return unknown();

      const info = await readJson(infoRes);
      let dims = dimensionsFromJobInfo(info);

      // Some accounts do not expose pixel dimensions in /info. The WCS header usually holds IMAGEW/IMAGEH.
      if (dims.width === undefined || dims.height === undefined) {
        try {
          const wcsRes = await http({ method: 'GET', url: `${WCS_FILE_BASE}/${jobId}/` });
          if (isOk(wcsRes)) {
            const wcsText = await wcsRes.text();
            if (wcsText && wcsText.includes('CRPIX1')) {
              const wcsDims = dimensionsFromWcsHeader(parseFITSHeader(wcsText));
              if (wcsDims.width !== undefined && wcsDims.height !== undefined) dims = wcsDims;
            }
          }
        } catch (wcsErr) {
          log?.('astrometry_wcs_dimensions_failed', wcsErr, { jobId });
        }
      }

      return {
        submissionId: jobId,
        jobId,
        status: info.status || 'unknown',
        filename: info.original_filename,
        timestamp: undefined, // the API does not give the submission time
        width: dims.width,
        height: dims.height,
      };
    } catch (err) {
      log?.('astrometry_job_info_failed', err, { jobId });
      return unknown();
    }
  }

  async function listSubmissions(): Promise<AstrometrySubmission[]> {
    try {
      const session = await getSession();
      const res = await http({
        method: 'POST',
        url: `${API_BASE}/myjobs/`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody({ session }),
      });
      if (!isOk(res)) {
        log?.('astrometry_myjobs_failed', new Error(`myjobs API returned ${res.status}`));
        return [];
      }
      const data = await readJson(res);
      if (!data || !data.jobs) return [];

      const jobIds: number[] = data.jobs.filter((id: unknown) => id !== null && id !== undefined);
      const submissions: AstrometrySubmission[] = [];
      // The details are fetched five jobs at a time.
      for (let i = 0; i < jobIds.length; i += LIST_BATCH_SIZE) {
        const batch = jobIds.slice(i, i + LIST_BATCH_SIZE);
        submissions.push(...(await Promise.all(batch.map(fetchSubmissionInfo))));
      }
      // Higher ids are more recent.
      submissions.sort((a, b) => (b.jobId || 0) - (a.jobId || 0));
      return submissions;
    } catch (err) {
      log?.('astrometry_list_failed', err);
      return [];
    }
  }

  async function reuseSolved(
    jobId: number,
    imageWidth: number,
    imageHeight: number,
  ): Promise<NovaReuseResult> {
    try {
      const jobData = await readJson(
        await http({ method: 'GET', url: `${API_BASE}/jobs/${jobId}` }),
      );
      if (jobData.status !== 'success') {
        return { success: false, error: `Job ${jobId} status: ${jobData.status}` };
      }

      // The WCS file first.
      try {
        const parsed = await fetchWcsHeader(jobId);
        if (parsed && hasAllWcsKeys(parsed)) {
          const originalWidth =
            (parsed.IMAGEW as number) || (parsed.NAXIS1 as number) || imageWidth;
          const originalHeight =
            (parsed.IMAGEH as number) || (parsed.NAXIS2 as number) || imageHeight;

          // A solution that does not fit the picture belongs to another image.
          if (
            !solutionFitsPicture(
              { width: originalWidth, height: originalHeight },
              { width: imageWidth, height: imageHeight },
            )
          ) {
            return {
              success: false,
              error: `Selected astrometry solution appears to be for a different image (solution ${originalWidth}x${originalHeight}, current ${imageWidth}x${imageHeight}).`,
            };
          }

          // Scale the reference pixel to the new size and keep the CD matrix.
          const wcs = solutionToWcs(
            parsed,
            imageWidth,
            imageHeight,
            imageWidth / originalWidth,
            imageHeight / originalHeight,
          );
          const correspondences = wcsToCorrespondencesWithCatalog(
            wcs,
            await catalog(),
            imageWidth,
            imageHeight,
          );
          if (correspondences.length >= 3) {
            return { success: true, correspondences, dsoIds: await fetchObjectsInField(jobId) };
          }
        }
      } catch (err) {
        log?.('astrometry_reuse_wcs_failed', err, { jobId });
      }

      // Fallback: the calibration.
      const cal = await fetchCalibration(jobId);
      const correspondences = calibrationToCorrespondences(
        cal,
        imageWidth,
        imageHeight,
        await catalog(),
      );
      if (correspondences.length >= 3) {
        return { success: true, correspondences, dsoIds: await fetchObjectsInField(jobId) };
      }
      return { success: false, error: 'No correspondences found' };
    } catch (err) {
      log?.('astrometry_reuse_failed', err, { jobId });
      return { success: false, error: (err as Error).message || 'Failed to reuse submission' };
    }
  }

  return {
    isConfigured,

    resetSession() {
      sessionKey = null;
    },

    submit,

    async getJob(localId) {
      const job = jobs.get(localId);
      if (!job) {
        throw new DomainError('notFound', 'Job introuvable', {
          code: 'JOB_NOT_FOUND',
          body: { error: 'Job introuvable', code: 'JOB_NOT_FOUND' },
        });
      }
      return {
        jobId: job.localId,
        status: job.status,
        correspondences: job.correspondences,
        error: job.error,
        dsoIds: job.dsoIds,
      };
    },

    listSubmissions,

    async reuse(file, jobId) {
      if (typeof jobId !== 'number' || !jobId || Number.isNaN(jobId)) {
        throw new DomainError('invalid', 'Invalid job ID', { code: 'INVALID_JOB_ID' });
      }
      const { width, height } = await requireDimensions(file);
      return reuseSolved(jobId, width, height);
    },
  };
}
