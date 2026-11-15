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
import { DomainError, isDomainError } from '../domain/errors';
import type {
  AstrometrySubmission,
  AstrometrySubmissionPage,
  NovaCorrespondence,
  NovaJobState,
  NovaJobStatus,
  NovaReuseResult,
  NovaSolveFile,
  NovaSolveHints,
} from '../domain/solve';
import type { HttpClient, HttpResponse } from '../ports/http-client';
import type { ImageCodec } from '../ports/image-codec';
import { fitsImageSize, parseFITSHeader, wcsToCorrespondences } from '../wcs';
import { isFitsFile } from '../photo-formats';

const API_BASE = 'https://nova.astrometry.net/api';
const WCS_FILE_BASE = 'https://nova.astrometry.net/wcs_file';
const API_KEY_SETTING = 'ASTROMETRY_API_KEY';
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour
/** Seconds between two polls (the last one repeats); about 80 s to get a job id, as many polls again to solve it. */
const POLL_DELAYS_MS = [3000, 5000, 8000, 13000, 13000, 13000, 13000, 13000];
/** Submissions per page when the caller does not say, and the most a page may hold. */
const LIST_PAGE_SIZE = 5;
const LIST_PAGE_MAX = 20;

export interface NovaSolveServiceDeps {
  http: HttpClient;
  /** Reads the API key (`ASTROMETRY_API_KEY`); the settings service satisfies it. */
  settings: { get(key: string): Promise<string | undefined> };
  /** Reads the size of a picture. */
  images: ImageCodec;
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
  /**
   * Follows again a submission sent earlier (the jobs are lost when the app restarts): a new local job polls it
   * in the background; returns its id. Throws `invalid` (`ASTROMETRY_NOT_CONFIGURED` without a key, checked
   * first; `INVALID_SUBMISSION_ID`, `CANNOT_DETERMINE_DIMENSIONS`). It sends no request itself.
   */
  resume(file: NovaSolveFile, submissionId: number): Promise<string>;
  /**
   * One page of the account's jobs, most recent first (`limit` 5 by default, 20 at most): the details are
   * fetched for that page only, and kept for a finished job. An empty page when the account cannot be read.
   * Throws `invalid` (`ASTROMETRY_NOT_CONFIGURED`) without a key, `rateLimited` (`ASTROMETRY_RATE_LIMITED`)
   * when astrometry.net refuses for too many requests.
   */
  listSubmissions(page?: { offset?: number; limit?: number }): Promise<AstrometrySubmissionPage>;
  /**
   * Builds the correspondences of an already solved astrometry.net job for this picture.
   * Throws `invalid` (`ASTROMETRY_NOT_CONFIGURED` without a key, checked first; `INVALID_JOB_ID`, `CANNOT_DETERMINE_DIMENSIONS`)
   * and `rateLimited` (`ASTROMETRY_RATE_LIMITED`); a job that is not solved, a solution of another shape or a
   * network failure is a result with `success: false`.
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
  /** The picture sent is a FITS file: its rows count from the bottom. */
  fits: boolean;
  dsoIds?: string[];
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isOk = (res: HttpResponse) => res.status >= 200 && res.status <= 299;

const rateLimited = () =>
  new DomainError('rateLimited', 'astrometry.net: too many requests', {
    code: 'ASTROMETRY_RATE_LIMITED',
  });
const isRateLimited = (err: unknown) => isDomainError(err) && err.kind === 'rateLimited';

/** Throws `rateLimited` when astrometry.net refused for too many requests (its answer is then an HTML page). */
function checkRateLimit(res: HttpResponse): HttpResponse {
  if (res.status === 429) throw rateLimited();
  return res;
}
const readJson = async (res: HttpResponse): Promise<any> =>
  JSON.parse(await checkRateLimit(res).text());
/** A job whose details no longer change. */
const isFinished = (s: AstrometrySubmission) => s.status === 'success' || s.status === 'failure';
const formBody = (payload: unknown) =>
  `request-json=${encodeURIComponent(JSON.stringify(payload))}`;

export function createNovaSolveService(deps: NovaSolveServiceDeps): NovaSolveService {
  const { http, settings, images, now, newId, log } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const jobs = new Map<string, Job>();
  /** The details of finished jobs of the account, by job id. */
  const finishedInfo = new Map<number, AstrometrySubmission>();
  let sessionKey: string | null = null;

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
    // A FITS file is not an image the codec reads: its header gives the size, plate solution or not.
    if (isFitsFile(file.fileName)) return fitsImageSize(file.bytes);
    try {
      const info = await images.probe(file.bytes);
      return { width: info.width || 0, height: info.height || 0 };
    } catch {
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
    const res = checkRateLimit(await http({ method: 'GET', url: `${WCS_FILE_BASE}/${jobId}/` }));
    const text = await res.text();
    if (text && text.includes('CRPIX1')) return parseFITSHeader(text);
    return null;
  }

  async function fetchCalibration(jobId: number): Promise<NovaCalibration> {
    const res = await http({ method: 'GET', url: `${API_BASE}/jobs/${jobId}/calibration/` });
    return readJson(res);
  }

  async function submit(file: NovaSolveFile, hints?: NovaSolveHints): Promise<string> {
    await requireConfigured();
    const { width: imageWidth, height: imageHeight } = await requireDimensions(file);

    const session = await getSession();
    const localId = newId();
    evictStaleJobs();
    const job: Job = {
      localId,
      createdAt: now(),
      status: 'pending',
      imageWidth,
      imageHeight,
      fits: isFitsFile(file.fileName),
    };
    jobs.set(localId, job);

    const requestData: Record<string, unknown> = {
      session,
      publicly_visible: 'n',
      allow_modifications: 'n',
      allow_commercial_use: 'n',
      // As the web form: try both parities, and downsample the stars' detection image by 2.
      parity: 2,
      downsample_factor: 2,
    };
    if (hints?.ra !== undefined && hints?.dec !== undefined) {
      requestData.center_ra = hints.ra;
      requestData.center_dec = hints.dec;
      requestData.radius = hints.radius || 2.0; // Search within 2 degrees by default
    }
    if (hints?.scale_lower !== undefined) requestData.scale_lower = hints.scale_lower;
    if (hints?.scale_upper !== undefined) requestData.scale_upper = hints.scale_upper;
    // The scale range astrometry.net's own web form defaults to: a field from 0.1 to 180 degrees wide.
    // A narrow guess from the picture's size left out telephoto and very wide fields.
    if (!requestData.scale_lower && !requestData.scale_upper) {
      requestData.scale_units = 'degwidth';
      requestData.scale_type = 'ul';
      requestData.scale_lower = 0.1;
      requestData.scale_upper = 180;
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

  async function resume(file: NovaSolveFile, submissionId: number): Promise<string> {
    await requireConfigured();
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      throw new DomainError('invalid', 'Invalid submission ID', { code: 'INVALID_SUBMISSION_ID' });
    }
    const { width: imageWidth, height: imageHeight } = await requireDimensions(file);
    const localId = newId();
    evictStaleJobs();
    const job: Job = {
      localId,
      createdAt: now(),
      submissionId,
      status: 'solving',
      imageWidth,
      imageHeight,
      fits: isFitsFile(file.fileName),
    };
    jobs.set(localId, job);
    pollJob(job).catch((err) => log?.('astrometry_poll_failed', err, { jobId: localId }));
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
              const correspondences = wcsToCorrespondences(
                solutionToWcs(parsed, job.imageWidth, job.imageHeight),
                job.imageWidth,
                job.imageHeight,
                job.fits,
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
          const found = calibrationToCorrespondences(cal, job.imageWidth, job.imageHeight);
          // The calibration counts rows from the top of the picture as read; a FITS file is drawn from the bottom.
          const correspondences = job.fits
            ? found.map((c) => ({ ...c, photoY: job.imageHeight - c.photoY }))
            : found;
          if (correspondences.length >= 3) {
            job.status = 'solved';
            job.correspondences = correspondences;
            job.dsoIds = await fetchObjectsInField(job.jobId);
          } else {
            job.status = 'failed';
            job.error = 'Calibration obtained but it gives no usable reference points';
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
    const known = finishedInfo.get(jobId);
    if (known) return known;
    try {
      const infoRes = checkRateLimit(
        await http({ method: 'GET', url: `${API_BASE}/jobs/${jobId}/info/` }),
      );
      if (!isOk(infoRes)) return unknown();

      const info = await readJson(infoRes);
      let dims = dimensionsFromJobInfo(info);

      // Some accounts do not expose pixel dimensions in /info. The WCS header usually holds IMAGEW/IMAGEH.
      if (dims.width === undefined || dims.height === undefined) {
        try {
          const wcsRes = checkRateLimit(
            await http({ method: 'GET', url: `${WCS_FILE_BASE}/${jobId}/` }),
          );
          if (isOk(wcsRes)) {
            const wcsText = await wcsRes.text();
            if (wcsText && wcsText.includes('CRPIX1')) {
              const wcsDims = dimensionsFromWcsHeader(parseFITSHeader(wcsText));
              if (wcsDims.width !== undefined && wcsDims.height !== undefined) dims = wcsDims;
            }
          }
        } catch (wcsErr) {
          if (isRateLimited(wcsErr)) throw wcsErr;
          log?.('astrometry_wcs_dimensions_failed', wcsErr, { jobId });
        }
      }

      const submission: AstrometrySubmission = {
        submissionId: jobId,
        jobId,
        status: info.status || 'unknown',
        filename: info.original_filename,
        timestamp: undefined, // the API does not give the submission time
        width: dims.width,
        height: dims.height,
      };
      if (isFinished(submission)) finishedInfo.set(jobId, submission);
      return submission;
    } catch (err) {
      if (isRateLimited(err)) throw err;
      log?.('astrometry_job_info_failed', err, { jobId });
      return unknown();
    }
  }

  async function requireConfigured(): Promise<void> {
    if (!(await isConfigured())) {
      throw new DomainError('invalid', 'ASTROMETRY_API_KEY not configured', {
        code: 'ASTROMETRY_NOT_CONFIGURED',
      });
    }
  }

  async function listSubmissions(
    page: { offset?: number; limit?: number } = {},
  ): Promise<AstrometrySubmissionPage> {
    await requireConfigured();
    const offset = Math.max(0, Math.floor(page.offset ?? 0) || 0);
    const limit = Math.min(
      LIST_PAGE_MAX,
      Math.max(1, Math.floor(page.limit ?? LIST_PAGE_SIZE) || LIST_PAGE_SIZE),
    );
    const empty: AstrometrySubmissionPage = { submissions: [], total: 0 };
    try {
      const session = await getSession();
      const res = checkRateLimit(
        await http({
          method: 'POST',
          url: `${API_BASE}/myjobs/`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formBody({ session }),
        }),
      );
      if (!isOk(res)) {
        log?.('astrometry_myjobs_failed', new Error(`myjobs API returned ${res.status}`));
        return empty;
      }
      const data = await readJson(res);
      if (!data || !data.jobs) return empty;

      // Higher ids are more recent; only the details of the page asked for are fetched.
      const jobIds = (data.jobs as unknown[])
        .filter((id): id is number => typeof id === 'number')
        .sort((a, b) => b - a);
      const submissions = await Promise.all(
        jobIds.slice(offset, offset + limit).map(fetchSubmissionInfo),
      );
      return { submissions, total: jobIds.length };
    } catch (err) {
      if (isRateLimited(err)) throw err;
      log?.('astrometry_list_failed', err);
      return empty;
    }
  }

  /**
   * Whether astrometry.net solved a FITS file for this job: its solution then counts rows from the bottom. Read
   * from the name of the file sent (the details the list already holds, else one request); `fallback` when unknown.
   */
  async function solvedFileIsFits(jobId: number, fallback: boolean): Promise<boolean> {
    let fileName = finishedInfo.get(jobId)?.filename;
    if (!fileName) {
      try {
        const res = checkRateLimit(
          await http({ method: 'GET', url: `${API_BASE}/jobs/${jobId}/info/` }),
        );
        if (isOk(res)) fileName = (await readJson(res))?.original_filename;
      } catch (err) {
        if (isRateLimited(err)) throw err;
        log?.('astrometry_job_info_failed', err, { jobId });
      }
    }
    return typeof fileName === 'string' && fileName ? isFitsFile(fileName) : fallback;
  }

  async function reuseSolved(
    jobId: number,
    imageWidth: number,
    imageHeight: number,
    pictureIsFits: boolean,
  ): Promise<NovaReuseResult> {
    try {
      const jobData = await readJson(
        await http({ method: 'GET', url: `${API_BASE}/jobs/${jobId}` }),
      );
      if (jobData.status !== 'success') {
        return { success: false, error: `Job ${jobId} status: ${jobData.status}` };
      }
      // The solution is in the pixels of the file astrometry.net solved: a FITS counts its rows from the bottom, as
      // the app draws it, whatever the type of the picture it is reused for (a PNG exported from that FITS shows
      // the same way up).
      const solvedFits = await solvedFileIsFits(jobId, pictureIsFits);

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

          // The points are taken on the solved picture, then moved onto this one: the solution's pixel scale and
          // distortion are in the solved picture's pixels.
          const scaleX = imageWidth / originalWidth;
          const scaleY = imageHeight / originalHeight;
          const correspondences = wcsToCorrespondences(
            solutionToWcs(parsed, originalWidth, originalHeight),
            originalWidth,
            originalHeight,
            solvedFits,
          ).map((c) => ({ ...c, photoX: c.photoX * scaleX, photoY: c.photoY * scaleY }));
          if (correspondences.length >= 3) {
            return { success: true, correspondences, dsoIds: await fetchObjectsInField(jobId) };
          }
        }
      } catch (err) {
        if (isRateLimited(err)) throw err;
        log?.('astrometry_reuse_wcs_failed', err, { jobId });
      }

      // Fallback: the calibration.
      const cal = await fetchCalibration(jobId);
      const found = calibrationToCorrespondences(cal, imageWidth, imageHeight);
      // The calibration counts rows from the top of the picture as read; a FITS is drawn from the bottom.
      const correspondences = solvedFits
        ? found.map((c) => ({ ...c, photoY: imageHeight - c.photoY }))
        : found;
      if (correspondences.length >= 3) {
        return { success: true, correspondences, dsoIds: await fetchObjectsInField(jobId) };
      }
      return { success: false, error: 'No correspondences found' };
    } catch (err) {
      if (isRateLimited(err)) throw err;
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
        submissionId: job.submissionId,
      };
    },

    resume,

    listSubmissions,

    async reuse(file, jobId) {
      await requireConfigured();
      if (typeof jobId !== 'number' || !jobId || Number.isNaN(jobId)) {
        throw new DomainError('invalid', 'Invalid job ID', { code: 'INVALID_JOB_ID' });
      }
      const { width, height } = await requireDimensions(file);
      return reuseSolved(jobId, width, height, isFitsFile(file.fileName));
    },
  };
}
