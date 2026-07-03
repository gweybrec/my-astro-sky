import { wcsToCorrespondences, loadServerCatalog, parseFITSHeader } from './wcs-reader.js';
import { getSetting } from './db.js';
import { normalizeDSOAliases } from './dso-utils.js';

interface AstrometryJob {
  localId: string;
  submissionId?: number;
  jobId?: number;
  status: 'pending' | 'solving' | 'solved' | 'failed' | 'timeout';
  correspondences?: Array<{
    pointIndex: number;
    photoX: number;
    photoY: number;
    starHip: number;
    starName: string;
  }>;
  error?: string;
  imageWidth: number;
  imageHeight: number;
  dsoIds?: string[];
}

const API_BASE = 'https://nova.astrometry.net/api';
const jobs = new Map<string, AstrometryJob>();
const jobCreatedAt = new Map<string, number>();
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour
let sessionKey: string | null = null;

function evictStaleJobs() {
  const now = Date.now();
  for (const [id, createdAt] of jobCreatedAt) {
    if (now - createdAt > JOB_TTL_MS) {
      jobs.delete(id);
      jobCreatedAt.delete(id);
    }
  }
}

export function resetSession(): void {
  sessionKey = null;
}

async function login(): Promise<string> {
  const apiKey = getSetting('ASTROMETRY_API_KEY');
  if (!apiKey) throw new Error('ASTROMETRY_API_KEY non configurée');

  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `request-json=${encodeURIComponent(JSON.stringify({ apikey: apiKey }))}`,
  });

  const data = await res.json();
  if (data.status !== 'success') {
    throw new Error(
      `Échec de l'authentification astrometry.net: ${data.errormessage || 'unknown'}`,
    );
  }

  sessionKey = data.session;
  return sessionKey!;
}

async function getSession(): Promise<string> {
  if (sessionKey) return sessionKey;
  return login();
}

export function isConfigured(): boolean {
  return !!getSetting('ASTROMETRY_API_KEY');
}

export async function submitJob(
  imageBuffer: Buffer,
  filename: string,
  imageWidth: number,
  imageHeight: number,
  hints?: {
    ra?: number;
    dec?: number;
    radius?: number;
    scale_lower?: number;
    scale_upper?: number;
  },
): Promise<string> {
  const session = await getSession();
  const localId = crypto.randomUUID();

  evictStaleJobs();

  const job: AstrometryJob = {
    localId,
    status: 'pending',
    imageWidth,
    imageHeight,
  };
  jobs.set(localId, job);
  jobCreatedAt.set(localId, Date.now());

  // Build request with optional hints
  const requestData: any = {
    session,
    publicly_visible: 'n',
    allow_modifications: 'n',
    allow_commercial_use: 'n',
  };

  // Add position hints if provided
  if (hints?.ra !== undefined && hints?.dec !== undefined) {
    requestData.center_ra = hints.ra;
    requestData.center_dec = hints.dec;
    requestData.radius = hints.radius || 2.0; // Search within 2 degrees by default
  }

  // Add scale hints if provided
  if (hints?.scale_lower !== undefined) {
    requestData.scale_lower = hints.scale_lower;
  }
  if (hints?.scale_upper !== undefined) {
    requestData.scale_upper = hints.scale_upper;
  }

  // Estimate scale from image dimensions if not provided
  if (!requestData.scale_lower && !requestData.scale_upper) {
    // Assume typical DSLR/CCD field of view: 1-3 degrees for smaller dimension
    const minDim = Math.min(imageWidth, imageHeight);
    const estimatedArcsecPerPx = (2.0 * 3600) / minDim; // 2 degrees in arcsec / pixels
    requestData.scale_lower = estimatedArcsecPerPx * 0.5;
    requestData.scale_upper = estimatedArcsecPerPx * 2.0;
    requestData.scale_units = 'arcsecperpix';
  }

  // Upload via multipart form
  const boundary = '----AstrometryBoundary' + Date.now();
  const requestJson = JSON.stringify(requestData);

  const parts: Buffer[] = [];

  // request-json part
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="request-json"\r\n\r\n` +
        requestJson +
        `\r\n`,
    ),
  );

  // file part
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    ),
  );
  parts.push(imageBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  try {
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    });

    const data = await res.json();
    if (data.status !== 'success') {
      job.status = 'failed';
      job.error = data.errormessage || 'Upload rejected';
      return localId;
    }

    job.submissionId = data.subid;
    job.status = 'solving';

    // Start polling in background
    pollJob(localId);
  } catch (err: any) {
    job.status = 'failed';
    job.error = err.message;
  }

  return localId;
}

async function pollJob(localId: string) {
  const job = jobs.get(localId);
  if (!job || !job.submissionId) return;

  const delays = [3000, 5000, 8000, 13000, 13000, 13000, 13000, 13000]; // ~80s total
  let attempt = 0;

  // First: poll submission to get job ID
  while (attempt < delays.length) {
    await sleep(delays[Math.min(attempt, delays.length - 1)]);
    attempt++;

    if (job.status !== 'solving') return;

    try {
      const subRes = await fetch(`${API_BASE}/submissions/${job.submissionId}`);
      const subData = await subRes.json();

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

  // Poll job status
  while (attempt < delays.length + 8) {
    await sleep(delays[Math.min(attempt, delays.length - 1)]);
    attempt++;

    if (job.status !== 'solving') return;

    try {
      const jobRes = await fetch(`${API_BASE}/jobs/${job.jobId}`);
      const jobData = await jobRes.json();

      if (jobData.status === 'success') {
        // Try to get WCS file directly from astrometry.net
        try {
          const wcsUrl = `https://nova.astrometry.net/wcs_file/${job.jobId}/`;
          console.log(`[Astrometry] Fetching WCS file from ${wcsUrl}`);
          const wcsRes = await fetch(wcsUrl);
          const wcsText = await wcsRes.text();

          console.log('[Astrometry] WCS file response length:', wcsText.length);

          if (wcsText && wcsText.includes('CRPIX1')) {
            // Parse WCS file
            const parsed = parseFITSHeader(wcsText);
            const required = [
              'CRPIX1',
              'CRPIX2',
              'CRVAL1',
              'CRVAL2',
              'CD1_1',
              'CD1_2',
              'CD2_1',
              'CD2_2',
            ];
            const hasAll = required.every((key) => typeof parsed[key] === 'number');

            console.log(
              '[Astrometry] Parsed WCS keys:',
              Object.keys(parsed).filter((k) => required.includes(k)),
            );

            if (hasAll) {
              const wcs: any = {
                CRPIX1: parsed.CRPIX1 as number,
                CRPIX2: parsed.CRPIX2 as number,
                CRVAL1: parsed.CRVAL1 as number,
                CRVAL2: parsed.CRVAL2 as number,
                CD1_1: parsed.CD1_1 as number,
                CD1_2: parsed.CD1_2 as number,
                CD2_1: parsed.CD2_1 as number,
                CD2_2: parsed.CD2_2 as number,
                NAXIS1: job.imageWidth,
                NAXIS2: job.imageHeight,
              };

              // Include SIP distortion coefficients if present
              if (parsed.AP_ORDER) {
                wcs.AP_ORDER = parsed.AP_ORDER;
                for (let i = 0; i <= Number(parsed.AP_ORDER); i++) {
                  for (let j = 0; j <= Number(parsed.AP_ORDER); j++) {
                    const key = `AP_${i}_${j}`;
                    if (parsed[key] !== undefined) wcs[key] = parsed[key];
                  }
                }
              }
              if (parsed.BP_ORDER) {
                wcs.BP_ORDER = parsed.BP_ORDER;
                for (let i = 0; i <= Number(parsed.BP_ORDER); i++) {
                  for (let j = 0; j <= Number(parsed.BP_ORDER); j++) {
                    const key = `BP_${i}_${j}`;
                    if (parsed[key] !== undefined) wcs[key] = parsed[key];
                  }
                }
              }

              console.log(
                '[Astrometry] Got WCS from astrometry.net with SIP order:',
                parsed.AP_ORDER || 0,
                '/',
                parsed.BP_ORDER || 0,
              );

              const correspondences = wcsToCorrespondences(wcs, job.imageWidth, job.imageHeight);
              if (correspondences.length >= 3) {
                job.status = 'solved';
                job.correspondences = correspondences;
                job.dsoIds = await fetchObjectsInField(job.jobId!);
                return;
              }
            }
          }
        } catch (e) {
          console.log('[Astrometry] Failed to get WCS file:', e);
        }

        // Fallback: Get calibration
        const calRes = await fetch(`${API_BASE}/jobs/${job.jobId}/calibration/`);
        const cal = await calRes.json();

        // Convert calibration to WCS-like data and then to correspondences
        const correspondences = calibrationToCorrespondences(cal, job.imageWidth, job.imageHeight);
        if (correspondences.length >= 3) {
          job.status = 'solved';
          job.correspondences = correspondences;
          job.dsoIds = await fetchObjectsInField(job.jobId!);
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

export function calibrationToCorrespondences(cal: any, imageWidth: number, imageHeight: number) {
  console.log('[Astrometry] Calibration:', JSON.stringify(cal, null, 2));

  // astrometry.net calibration gives: ra, dec, radius, pixscale, orientation, parity
  // NOTE: astrometry.net uses IMAGE coordinates (0,0 at top-left, Y down)
  // We need to construct WCS in FITS convention (1,1 at bottom-left, Y up)
  const pixscale = cal.pixscale / 3600; // arcsec/pixel → degrees/pixel
  const orientation = cal.orientation * (Math.PI / 180); // degrees → radians
  const parity = cal.parity || 1; // 1 or -1

  // CD matrix from pixscale + orientation + parity
  // Try negating CD1_1 and CD2_2 to match FITS convention
  const cd11 = -pixscale * Math.cos(orientation) * parity;
  const cd12 = pixscale * Math.sin(orientation);
  const cd21 = pixscale * Math.sin(orientation) * parity;
  const cd22 = -pixscale * Math.cos(orientation);

  // CRPIX: Reference pixel position in FITS coordinates
  // Astrometry.net calibrates at image center in PIXEL coords (0-indexed, top-left origin)
  // Image center in pixel coords: (W/2, H/2) = (2769.5, 2166) for 5539x4332
  // Convert to FITS coords (1-indexed, bottom-left origin):
  //   FITS_X = pixel_X + 1
  //   FITS_Y = H - pixel_Y
  const centerPixelX = imageWidth / 2; // 2769.5
  const centerPixelY = imageHeight / 2; // 2166
  const wcs = {
    CRPIX1: centerPixelX + 1, // 2770.5
    CRPIX2: imageHeight - centerPixelY, // 4332 - 2166 = 2166
    CRVAL1: cal.ra,
    CRVAL2: cal.dec,
    CD1_1: cd11,
    CD1_2: cd12,
    CD2_1: cd21,
    CD2_2: cd22,
    NAXIS1: imageWidth,
    NAXIS2: imageHeight,
  };

  console.log('[Astrometry] Constructed WCS:', JSON.stringify(wcs, null, 2));

  // Make sure server catalog is loaded
  loadServerCatalog();

  const correspondences = wcsToCorrespondences(wcs, imageWidth, imageHeight);
  console.log('[Astrometry] Found correspondences:', correspondences.length);
  for (const c of correspondences.slice(0, 3)) {
    console.log(
      `  [${c.pointIndex}] ${c.starName} at pixel (${c.photoX.toFixed(1)}, ${c.photoY.toFixed(1)})`,
    );
  }

  return correspondences;
}

export function getJobStatus(localId: string): AstrometryJob | undefined {
  return jobs.get(localId);
}

function asPositiveNumber(value: any): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function extractImageDimensionsFromJobInfo(info: any): { width?: number; height?: number } {
  const width =
    asPositiveNumber(info?.image_width) ??
    asPositiveNumber(info?.imagew) ??
    asPositiveNumber(info?.width) ??
    asPositiveNumber(info?.original_width) ??
    asPositiveNumber(info?.original_image_width) ??
    asPositiveNumber(info?.calibration?.image_width) ??
    asPositiveNumber(info?.calibration?.width);

  const height =
    asPositiveNumber(info?.image_height) ??
    asPositiveNumber(info?.imageh) ??
    asPositiveNumber(info?.height) ??
    asPositiveNumber(info?.original_height) ??
    asPositiveNumber(info?.original_image_height) ??
    asPositiveNumber(info?.calibration?.image_height) ??
    asPositiveNumber(info?.calibration?.height);

  return { width, height };
}

function extractImageDimensionsFromParsedWcsHeader(parsed: Record<string, any>): {
  width?: number;
  height?: number;
} {
  const width = asPositiveNumber(parsed.IMAGEW) ?? asPositiveNumber(parsed.NAXIS1);
  const height = asPositiveNumber(parsed.IMAGEH) ?? asPositiveNumber(parsed.NAXIS2);
  return { width, height };
}

// List recent user submissions from astrometry.net
export async function listUserSubmissions(): Promise<
  Array<{
    submissionId: number;
    jobId?: number;
    status: string;
    timestamp?: string;
    filename?: string;
    width?: number;
    height?: number;
  }>
> {
  try {
    const session = await getSession();

    console.log('[Astrometry] Fetching user submissions...');
    const res = await fetch(`${API_BASE}/myjobs/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `request-json=${encodeURIComponent(JSON.stringify({ session }))}`,
    });

    if (!res.ok) {
      console.error(`[Astrometry] myjobs API returned ${res.status}`);
      return [];
    }

    const data = await res.json();
    console.log('[Astrometry] myjobs response:', JSON.stringify(data).substring(0, 200));

    if (!data || !data.jobs) {
      console.log('[Astrometry] No jobs field in response');
      return [];
    }

    const jobIds = data.jobs.filter((id: any) => id !== null && id !== undefined);
    console.log(`[Astrometry] Found ${jobIds.length} jobs`);

    // Fetch job details in batches to get filename and status
    const submissions: Array<{
      submissionId: number;
      jobId?: number;
      status: string;
      timestamp?: string;
      filename?: string;
      width?: number;
      height?: number;
    }> = [];
    const batchSize = 5;

    for (let i = 0; i < jobIds.length; i += batchSize) {
      const batch = jobIds.slice(i, i + batchSize);
      const batchPromises = batch.map(async (jobId: number) => {
        try {
          const infoRes = await fetch(`${API_BASE}/jobs/${jobId}/info/`);
          if (!infoRes.ok) {
            return {
              submissionId: jobId,
              jobId: jobId,
              status: 'unknown',
              filename: undefined,
              timestamp: undefined,
              width: undefined,
              height: undefined,
            };
          }

          const info = await infoRes.json();
          let dims = extractImageDimensionsFromJobInfo(info);

          // Some astrometry accounts do not expose pixel dimensions in /info.
          // Fallback to WCS header, which usually contains IMAGEW/IMAGEH.
          if (dims.width === undefined || dims.height === undefined) {
            try {
              const wcsRes = await fetch(`https://nova.astrometry.net/wcs_file/${jobId}/`);
              if (wcsRes.ok) {
                const wcsText = await wcsRes.text();
                if (wcsText && wcsText.includes('CRPIX1')) {
                  const parsed = parseFITSHeader(wcsText);
                  const wcsDims = extractImageDimensionsFromParsedWcsHeader(parsed);
                  if (wcsDims.width !== undefined && wcsDims.height !== undefined) {
                    dims = wcsDims;
                  }
                }
              }
            } catch (wcsErr) {
              console.log(`[Astrometry] Failed WCS dimension fallback for job ${jobId}:`, wcsErr);
            }
          }

          return {
            submissionId: jobId,
            jobId: jobId,
            status: info.status || 'unknown',
            filename: info.original_filename,
            timestamp: undefined, // API doesn't seem to provide submission timestamp
            width: dims.width,
            height: dims.height,
          };
        } catch (err) {
          console.error(`[Astrometry] Failed to get info for job ${jobId}:`, err);
          return {
            submissionId: jobId,
            jobId: jobId,
            status: 'unknown',
            filename: undefined,
            timestamp: undefined,
            width: undefined,
            height: undefined,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      submissions.push(...batchResults);
    }

    console.log(`[Astrometry] Returning ${submissions.length} submissions with details`);

    // Sort by job ID descending (higher IDs = more recent)
    submissions.sort((a, b) => (b.jobId || 0) - (a.jobId || 0));

    return submissions;
  } catch (err) {
    console.error('[Astrometry] Failed to list submissions:', err);
    return [];
  }
}

// Reuse an existing submission by job ID
export async function reuseSubmission(
  jobId: number,
  imageWidth: number,
  imageHeight: number,
): Promise<{ success: boolean; correspondences?: Array<any>; dsoIds?: string[]; error?: string }> {
  try {
    // Check job status
    const jobRes = await fetch(`${API_BASE}/jobs/${jobId}`);
    const jobData = await jobRes.json();

    if (jobData.status !== 'success') {
      return {
        success: false,
        error: `Job ${jobId} status: ${jobData.status}`,
      };
    }

    // Try to get WCS file directly
    try {
      const wcsUrl = `https://nova.astrometry.net/wcs_file/${jobId}/`;
      console.log(`[Astrometry] Reusing job ${jobId}, fetching WCS from ${wcsUrl}`);
      const wcsRes = await fetch(wcsUrl);
      const wcsText = await wcsRes.text();

      if (wcsText && wcsText.includes('CRPIX1')) {
        const parsed = parseFITSHeader(wcsText);
        const required = [
          'CRPIX1',
          'CRPIX2',
          'CRVAL1',
          'CRVAL2',
          'CD1_1',
          'CD1_2',
          'CD2_1',
          'CD2_2',
        ];
        const hasAll = required.every((key) => typeof parsed[key] === 'number');

        if (hasAll) {
          // Get original image dimensions from WCS
          const originalWidth =
            (parsed.IMAGEW as number) || (parsed.NAXIS1 as number) || imageWidth;
          const originalHeight =
            (parsed.IMAGEH as number) || (parsed.NAXIS2 as number) || imageHeight;

          // Scale CRPIX if image dimensions changed
          const scaleX = imageWidth / originalWidth;
          const scaleY = imageHeight / originalHeight;

          // Guardrail: reject clearly incompatible images to prevent reusing the wrong job.
          // Uniform resizing is expected (scaleX ~= scaleY), but major aspect/skew mismatch
          // usually means the selected astrometry job belongs to another image.
          const originalAspect = originalWidth / originalHeight;
          const currentAspect = imageWidth / imageHeight;
          const aspectDiff =
            Math.abs(currentAspect - originalAspect) / Math.max(1e-9, originalAspect);
          const scaleSkew = Math.abs(scaleX - scaleY) / Math.max(1e-9, Math.max(scaleX, scaleY));
          const ASPECT_DIFF_LIMIT = 0.03;
          const SCALE_SKEW_LIMIT = 0.03;

          if (aspectDiff > ASPECT_DIFF_LIMIT || scaleSkew > SCALE_SKEW_LIMIT) {
            return {
              success: false,
              error: `Selected astrometry solution appears to be for a different image (solution ${originalWidth}x${originalHeight}, current ${imageWidth}x${imageHeight}).`,
            };
          }

          console.log(
            `[Astrometry] WCS original: ${originalWidth}×${originalHeight}, current: ${imageWidth}×${imageHeight}, scale: ${scaleX.toFixed(4)}×${scaleY.toFixed(4)}`,
          );

          // Scale CRPIX to match new image size, keep CD matrix as-is
          const wcs: any = {
            CRPIX1: (parsed.CRPIX1 as number) * scaleX,
            CRPIX2: (parsed.CRPIX2 as number) * scaleY,
            CRVAL1: parsed.CRVAL1 as number,
            CRVAL2: parsed.CRVAL2 as number,
            CD1_1: parsed.CD1_1 as number,
            CD1_2: parsed.CD1_2 as number,
            CD2_1: parsed.CD2_1 as number,
            CD2_2: parsed.CD2_2 as number,
            NAXIS1: imageWidth,
            NAXIS2: imageHeight,
          };

          // Include SIP distortion if present
          if (parsed.AP_ORDER) {
            wcs.AP_ORDER = parsed.AP_ORDER;
            for (let i = 0; i <= Number(parsed.AP_ORDER); i++) {
              for (let j = 0; j <= Number(parsed.AP_ORDER); j++) {
                const key = `AP_${i}_${j}`;
                if (parsed[key] !== undefined) wcs[key] = parsed[key];
              }
            }
          }
          if (parsed.BP_ORDER) {
            wcs.BP_ORDER = parsed.BP_ORDER;
            for (let i = 0; i <= Number(parsed.BP_ORDER); i++) {
              for (let j = 0; j <= Number(parsed.BP_ORDER); j++) {
                const key = `BP_${i}_${j}`;
                if (parsed[key] !== undefined) wcs[key] = parsed[key];
              }
            }
          }

          loadServerCatalog();
          const correspondences = wcsToCorrespondences(wcs, imageWidth, imageHeight);

          if (correspondences.length >= 3) {
            console.log(
              `[Astrometry] Reused job ${jobId} with ${correspondences.length} correspondences`,
            );
            const dsoIds = await fetchObjectsInField(jobId);
            return { success: true, correspondences, dsoIds };
          }
        }
      }
    } catch (err) {
      console.log('[Astrometry] Failed to get WCS file for reuse:', err);
    }

    // Fallback: Get calibration
    const calRes = await fetch(`${API_BASE}/jobs/${jobId}/calibration/`);
    const cal = await calRes.json();

    loadServerCatalog();
    const correspondences = calibrationToCorrespondences(cal, imageWidth, imageHeight);

    if (correspondences.length >= 3) {
      console.log(
        `[Astrometry] Reused job ${jobId} via calibration with ${correspondences.length} correspondences`,
      );
      const dsoIds = await fetchObjectsInField(jobId);
      return { success: true, correspondences, dsoIds };
    }

    return {
      success: false,
      error: 'No correspondences found',
    };
  } catch (err: any) {
    console.error(`[Astrometry] Failed to reuse job ${jobId}:`, err);
    return {
      success: false,
      error: err.message || 'Failed to reuse submission',
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch the list of known objects in the field from astrometry.net.
 * Returns normalized IDs with spaces removed: ["NGC5457", "M101"]
 */
async function fetchObjectsInField(jobId: number): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/jobs/${jobId}/objects_in_field/`);
    if (!res.ok) return [];
    const data = await res.json();
    const names: string[] = data?.objects_in_field ?? [];
    return normalizeDSOAliases(names);
  } catch {
    return [];
  }
}
