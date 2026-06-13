/**
 * Tests for the HTTP layer of server/astrometry.ts:
 *  - login request payload and response handling
 *  - submitJob upload payload (with/without hints)
 *  - submitJob response handling (success, rejection, network error)
 *  - listUserSubmissions (success, empty, non-ok, network error)
 *  - reuseSubmission (job failure, WCS path, calibration fallback, network error)
 *
 * vi.useFakeTimers() is used so the background pollJob timers never fire
 * and make real HTTP calls after test teardown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Module mocks (hoisted before imports) ───────────────────────────────────

vi.mock('../../server/db', () => ({
  getSetting: vi.fn(),
}));

vi.mock('../../server/wcs-reader', () => ({
  loadServerCatalog: vi.fn(),
  wcsToCorrespondences: vi.fn(() => []),
  parseFITSHeader: vi.fn(() => ({
    CRPIX1: 960, CRPIX2: 540,
    CRVAL1: 84.05, CRVAL2: -1.2,
    CD1_1: -0.001, CD1_2: 0, CD2_1: 0, CD2_2: 0.001,
  })),
  extractFITSHeaderFromFITS: vi.fn(() => ''),
}));

vi.mock('../../server/dso-utils', () => ({
  normalizeDSOAliases: vi.fn((ids: string[]) => ids),
}));

import { getSetting } from '../../server/db';
import { wcsToCorrespondences, parseFITSHeader } from '../../server/wcs-reader';
import {
  resetSession,
  isConfigured,
  getJobStatus,
  submitJob,
  listUserSubmissions,
  reuseSubmission,
} from '../../server/astrometry';

const mockGetSetting      = vi.mocked(getSetting);
const mockWcsCorrs        = vi.mocked(wcsToCorrespondences);
const mockParseFITSHeader = vi.mocked(parseFITSHeader);

const API_BASE  = 'https://nova.astrometry.net/api';
const LOGIN_URL = `${API_BASE}/login`;
const UPLOAD_URL = `${API_BASE}/upload`;

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

function jsonResp(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}

function textResp(text: string) {
  return { ok: true, status: 200, text: async () => text, json: async () => ({}) };
}

function failResp(status = 500) {
  return { ok: false, status, json: async () => ({}), text: async () => '' };
}

// ─── Test setup ───────────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
  resetSession();
  vi.clearAllMocks();
  // Restore default mock implementations cleared by clearAllMocks
  mockWcsCorrs.mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── isConfigured ─────────────────────────────────────────────────────────────

describe('isConfigured()', () => {
  it('returns false when API key is not set', () => {
    mockGetSetting.mockReturnValue(null);
    expect(isConfigured()).toBe(false);
  });

  it('returns true when API key is configured', () => {
    mockGetSetting.mockReturnValue('mykey123');
    expect(isConfigured()).toBe(true);
  });
});

// ─── getJobStatus ─────────────────────────────────────────────────────────────

describe('getJobStatus()', () => {
  it('returns undefined for an unknown localId', () => {
    expect(getJobStatus('nonexistent-id')).toBeUndefined();
  });
});

// ─── login — request payload ──────────────────────────────────────────────────

describe('login — request payload', () => {
  it('sends POST to /api/login with form-encoded request-json body containing apikey', async () => {
    mockGetSetting.mockReturnValue('test-api-key');
    fetchMock
      .mockResolvedValueOnce(jsonResp({ status: 'success', session: 'sess-abc' }))
      .mockResolvedValueOnce(jsonResp({ status: 'success', subid: 1 }));

    await submitJob(Buffer.from('img'), 'test.jpg', 800, 600);

    const [loginUrl, loginOpts] = fetchMock.mock.calls[0];
    expect(loginUrl).toBe(LOGIN_URL);
    expect(loginOpts.method).toBe('POST');
    expect(loginOpts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const body: string = loginOpts.body;
    expect(body).toMatch(/^request-json=/);
    const payload = JSON.parse(decodeURIComponent(body.replace('request-json=', '')));
    expect(payload.apikey).toBe('test-api-key');
  });
});

// ─── login — response handling ────────────────────────────────────────────────

describe('login — response handling', () => {
  it('caches the session key — subsequent submitJob calls do not re-login', async () => {
    mockGetSetting.mockReturnValue('my-key');
    fetchMock
      .mockResolvedValueOnce(jsonResp({ status: 'success', session: 'sess-xyz' }))
      .mockResolvedValueOnce(jsonResp({ status: 'success', subid: 42 }))
      // Second submitJob — only upload, no login
      .mockResolvedValueOnce(jsonResp({ status: 'success', subid: 43 }));

    await submitJob(Buffer.from('img'), 'test.jpg', 100, 100);
    await submitJob(Buffer.from('img'), 'test.jpg', 100, 100);

    // login (1) + upload (1) + upload (1) = 3 total calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(LOGIN_URL);
    expect(fetchMock.mock.calls[1][0]).toBe(UPLOAD_URL);
    expect(fetchMock.mock.calls[2][0]).toBe(UPLOAD_URL);
  });

  it('throws when API returns status != success', async () => {
    mockGetSetting.mockReturnValue('bad-key');
    fetchMock.mockResolvedValueOnce(
      jsonResp({ status: 'error', errormessage: 'bad apikey' }),
    );
    await expect(submitJob(Buffer.from('img'), 'test.jpg', 100, 100)).rejects.toThrow('bad apikey');
  });

  it('throws with "unknown" when errormessage is absent', async () => {
    mockGetSetting.mockReturnValue('some-key');
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'error' }));
    await expect(submitJob(Buffer.from('img'), 'test.jpg', 100, 100)).rejects.toThrow(/unknown/);
  });

  it('propagates network error from login', async () => {
    mockGetSetting.mockReturnValue('some-key');
    fetchMock.mockRejectedValueOnce(new Error('DNS failure'));
    await expect(submitJob(Buffer.from('img'), 'test.jpg', 100, 100)).rejects.toThrow('DNS failure');
  });
});

// ─── submitJob — upload payload ───────────────────────────────────────────────

describe('submitJob — upload request payload', () => {
  beforeEach(() => {
    mockGetSetting.mockReturnValue('api-key');
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'success', session: 'session-token' }));
  });

  it('multipart body includes session and privacy flags', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'success', subid: 1 }));
    await submitJob(Buffer.from('fake-image'), 'photo.jpg', 1920, 1080);

    const [uploadUrl, uploadOpts] = fetchMock.mock.calls[1];
    expect(uploadUrl).toBe(UPLOAD_URL);
    expect(uploadOpts.method).toBe('POST');
    expect(uploadOpts.headers['Content-Type']).toContain('multipart/form-data; boundary=');

    const body: string = (uploadOpts.body as Buffer).toString('utf8');
    expect(body).toContain('"session":"session-token"');
    expect(body).toContain('"publicly_visible":"n"');
    expect(body).toContain('"allow_modifications":"n"');
    expect(body).toContain('"allow_commercial_use":"n"');
  });

  it('auto-estimates scale_lower/scale_upper/scale_units when no hints given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'success', subid: 1 }));
    await submitJob(Buffer.from('fake-image'), 'photo.jpg', 1920, 1080);

    const body: string = (fetchMock.mock.calls[1][1].body as Buffer).toString('utf8');
    expect(body).toContain('"scale_units":"arcsecperpix"');
    expect(body).toContain('"scale_lower"');
    expect(body).toContain('"scale_upper"');
    expect(body).not.toContain('"center_ra"');
  });

  it('includes center_ra/center_dec/radius when position hints provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'success', subid: 1 }));
    await submitJob(Buffer.from('img'), 'photo.jpg', 1920, 1080, { ra: 84.05, dec: -1.2, radius: 1.5 });

    const body: string = (fetchMock.mock.calls[1][1].body as Buffer).toString('utf8');
    expect(body).toContain('"center_ra":84.05');
    expect(body).toContain('"center_dec":-1.2');
    expect(body).toContain('"radius":1.5');
  });

  it('uses default radius of 2 when ra/dec given without radius', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'success', subid: 1 }));
    await submitJob(Buffer.from('img'), 'photo.jpg', 800, 600, { ra: 10, dec: 20 });

    const body: string = (fetchMock.mock.calls[1][1].body as Buffer).toString('utf8');
    expect(body).toContain('"radius":2');
  });

  it('uses explicit scale hints without auto-estimation', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'success', subid: 1 }));
    await submitJob(Buffer.from('img'), 'photo.jpg', 800, 600, { scale_lower: 0.5, scale_upper: 1.5 });

    const body: string = (fetchMock.mock.calls[1][1].body as Buffer).toString('utf8');
    expect(body).toContain('"scale_lower":0.5');
    expect(body).toContain('"scale_upper":1.5');
    expect(body).not.toContain('"scale_units"');
  });
});

// ─── submitJob — response handling ────────────────────────────────────────────

describe('submitJob — upload response handling', () => {
  beforeEach(() => {
    mockGetSetting.mockReturnValue('api-key');
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'success', session: 'sess' }));
  });

  it('job.status becomes "solving" and submissionId is set on success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'success', subid: 12345 }));
    const localId = await submitJob(Buffer.from('img'), 'photo.jpg', 800, 600);

    const job = getJobStatus(localId);
    expect(job).toBeDefined();
    expect(job!.status).toBe('solving');
  });

  it('job.status becomes "failed" when API rejects upload', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'error', errormessage: 'bad image format' }));
    const localId = await submitJob(Buffer.from('img'), 'photo.jpg', 800, 600);

    const job = getJobStatus(localId);
    expect(job!.status).toBe('failed');
    expect(job!.error).toBe('bad image format');
  });

  it('job.status becomes "failed" on network error during upload', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const localId = await submitJob(Buffer.from('img'), 'photo.jpg', 800, 600);

    const job = getJobStatus(localId);
    expect(job!.status).toBe('failed');
    expect(job!.error).toContain('connection refused');
  });

  it('job.error falls back to "Upload rejected" when errormessage absent', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'error' }));
    const localId = await submitJob(Buffer.from('img'), 'photo.jpg', 800, 600);

    expect(getJobStatus(localId)!.error).toBe('Upload rejected');
  });

  it('polling marks job as timeout when submission never yields a job ID', async () => {
    fetchMock.mockReset();
    fetchMock
      // login
      .mockResolvedValueOnce(jsonResp({ status: 'success', session: 'sess' }))
      // upload
      .mockResolvedValueOnce(jsonResp({ status: 'success', subid: 123 }))
      // submissions/<id> checks for all retries: jobs remains null
      .mockResolvedValue(jsonResp({ jobs: [null] }));

    const localId = await submitJob(Buffer.from('img'), 'photo.jpg', 800, 600);
  await vi.advanceTimersByTimeAsync(200000);

    const job = getJobStatus(localId);
    expect(job).toBeDefined();
    expect(job!.status).toBe('timeout');
    expect(job!.error).toBeTruthy();
  });

  it('polling marks job as failed when astrometry job status is failure', async () => {
    fetchMock.mockReset();
    fetchMock
      // login
      .mockResolvedValueOnce(jsonResp({ status: 'success', session: 'sess' }))
      // upload
      .mockResolvedValueOnce(jsonResp({ status: 'success', subid: 321 }))
      // submissions/<id>: returns job id
      .mockResolvedValueOnce(jsonResp({ jobs: [999] }))
      // jobs/<id>: failure
      .mockResolvedValueOnce(jsonResp({ status: 'failure' }));

    const localId = await submitJob(Buffer.from('img'), 'photo.jpg', 800, 600);
  await vi.advanceTimersByTimeAsync(200000);

    const job = getJobStatus(localId);
    expect(job).toBeDefined();
    expect(job!.status).toBe('failed');
    expect(job!.error).toBeTruthy();
  });

  it('polling marks job as solved via WCS path and stores correspondences', async () => {
    fetchMock.mockReset();
    const THREE_CORRS = [
      { pointIndex: 0, photoX: 10, photoY: 20, starHip: 1, starName: 'A' },
      { pointIndex: 1, photoX: 30, photoY: 40, starHip: 2, starName: 'B' },
      { pointIndex: 2, photoX: 50, photoY: 60, starHip: 3, starName: 'C' },
    ];
    mockWcsCorrs.mockReturnValueOnce(THREE_CORRS as any);
    mockParseFITSHeader.mockReturnValueOnce({
      CRPIX1: 960,
      CRPIX2: 540,
      CRVAL1: 84.05,
      CRVAL2: -1.2,
      CD1_1: -0.0004,
      CD1_2: 0,
      CD2_1: 0,
      CD2_2: 0.0004,
      AP_ORDER: 0,
      BP_ORDER: 0,
    } as any);

    fetchMock
      // login
      .mockResolvedValueOnce(jsonResp({ status: 'success', session: 'sess' }))
      // upload
      .mockResolvedValueOnce(jsonResp({ status: 'success', subid: 111 }))
      // submissions/<id>
      .mockResolvedValueOnce(jsonResp({ jobs: [222] }))
      // jobs/<id>
      .mockResolvedValueOnce(jsonResp({ status: 'success' }))
      // wcs_file/<id>
      .mockResolvedValueOnce(textResp('CRPIX1 = 960\nCRPIX2 = 540'))
      // objects_in_field
      .mockResolvedValueOnce(jsonResp({ objects_in_field: ['M 42'] }));

    const localId = await submitJob(Buffer.from('img'), 'photo.jpg', 800, 600);
  await vi.advanceTimersByTimeAsync(200000);

    const job = getJobStatus(localId);
    expect(job).toBeDefined();
    expect(job!.status).toBe('solved');
    expect(job!.correspondences).toHaveLength(3);
    expect(job!.dsoIds).toEqual(['M 42']);
  });

  it('polling falls back to calibration when WCS parse is incomplete and succeeds', async () => {
    fetchMock.mockReset();
    const THREE_CORRS = [
      { pointIndex: 0, photoX: 10, photoY: 20, starHip: 1, starName: 'A' },
      { pointIndex: 1, photoX: 30, photoY: 40, starHip: 2, starName: 'B' },
      { pointIndex: 2, photoX: 50, photoY: 60, starHip: 3, starName: 'C' },
    ];
    // hasAll=false means wcsToCorrespondences is called only once in calibration path.
    mockWcsCorrs.mockReturnValueOnce(THREE_CORRS as any);
    // Missing CD2_2 in parsed WCS forces hasAll=false and calibration fallback
    mockParseFITSHeader.mockReturnValueOnce({
      CRPIX1: 960,
      CRPIX2: 540,
      CRVAL1: 84.05,
      CRVAL2: -1.2,
      CD1_1: -0.0004,
      CD1_2: 0,
      CD2_1: 0,
    } as any);

    fetchMock
      // login
      .mockResolvedValueOnce(jsonResp({ status: 'success', session: 'sess' }))
      // upload
      .mockResolvedValueOnce(jsonResp({ status: 'success', subid: 444 }))
      // submissions/<id>
      .mockResolvedValueOnce(jsonResp({ jobs: [555] }))
      // jobs/<id>
      .mockResolvedValueOnce(jsonResp({ status: 'success' }))
      // wcs_file/<id>
      .mockResolvedValueOnce(textResp('CRPIX1 = 960\nCRPIX2 = 540'))
      // jobs/<id>/calibration
      .mockResolvedValueOnce(jsonResp({ ra: 84.05, dec: -1.2, pixscale: 1.5, orientation: 0, parity: 1 }))
      // objects_in_field
      .mockResolvedValueOnce(jsonResp({ objects_in_field: ['NGC 1976'] }));

    const localId = await submitJob(Buffer.from('img'), 'photo.jpg', 800, 600);
  await vi.advanceTimersByTimeAsync(200000);

    const job = getJobStatus(localId);
    expect(job).toBeDefined();
    expect(job!.status).toBe('solved');
    expect(job!.correspondences).toHaveLength(3);
    expect(job!.dsoIds).toEqual(['NGC 1976']);
  });
});

// ─── listUserSubmissions ──────────────────────────────────────────────────────

describe('listUserSubmissions()', () => {
  it('returns submissions sorted by descending job ID with filenames', async () => {
    mockGetSetting.mockReturnValue('api-key');
    fetchMock
      .mockResolvedValueOnce(jsonResp({ status: 'success', session: 's' }))
      .mockResolvedValueOnce(jsonResp({ jobs: [101, 200] }))
      .mockResolvedValueOnce(jsonResp({ status: 'success', original_filename: 'M42.jpg' }))
      .mockResolvedValueOnce(jsonResp({ status: 'success', original_filename: 'M31.jpg' }));

    const result = await listUserSubmissions();
    expect(result).toHaveLength(2);
    // sorted descending by jobId
    expect(result[0].jobId).toBe(200);
    expect(result[0].filename).toBe('M31.jpg');
    expect(result[1].jobId).toBe(101);
    expect(result[1].filename).toBe('M42.jpg');
  });

  it('returns empty array when response has no "jobs" field', async () => {
    mockGetSetting.mockReturnValue('api-key');
    fetchMock
      .mockResolvedValueOnce(jsonResp({ status: 'success', session: 's' }))
      .mockResolvedValueOnce(jsonResp({ something: 'else' }));

    expect(await listUserSubmissions()).toEqual([]);
  });

  it('returns empty array when jobs array is empty', async () => {
    mockGetSetting.mockReturnValue('api-key');
    fetchMock
      .mockResolvedValueOnce(jsonResp({ status: 'success', session: 's' }))
      .mockResolvedValueOnce(jsonResp({ jobs: [] }));

    expect(await listUserSubmissions()).toEqual([]);
  });

  it('returns empty array when myjobs endpoint returns non-ok', async () => {
    mockGetSetting.mockReturnValue('api-key');
    fetchMock
      .mockResolvedValueOnce(jsonResp({ status: 'success', session: 's' }))
      .mockResolvedValueOnce(failResp(403));

    expect(await listUserSubmissions()).toEqual([]);
  });

  it('returns empty array on network error', async () => {
    mockGetSetting.mockReturnValue('api-key');
    fetchMock.mockRejectedValue(new Error('network error'));

    expect(await listUserSubmissions()).toEqual([]);
  });
});

// ─── reuseSubmission ─────────────────────────────────────────────────────────

describe('reuseSubmission()', () => {
  // reuseSubmission does NOT call getSession() — fetches directly

  it('returns failure when job status is not "success"', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'failure' }));

    const result = await reuseSubmission(99999, 1920, 1080);
    expect(result.success).toBe(false);
    expect(result.error).toContain('99999');
  });

  it('returns success via WCS file path when correspondences found', async () => {
    const THREE_CORRS = [
      { pointIndex: 0, photoX: 100, photoY: 200, starHip: 1, starName: 'A', starRa: 10, starDec: 20 },
      { pointIndex: 1, photoX: 300, photoY: 400, starHip: 2, starName: 'B', starRa: 15, starDec: 25 },
      { pointIndex: 2, photoX: 500, photoY: 600, starHip: 3, starName: 'C', starRa: 20, starDec: 30 },
    ];
    mockWcsCorrs.mockReturnValueOnce(THREE_CORRS as any);

    fetchMock
      // job status
      .mockResolvedValueOnce(jsonResp({ status: 'success' }))
      // WCS file — must include 'CRPIX1' so the code parses it
      .mockResolvedValueOnce(textResp('CRPIX1 = 960 / Reference pixel\nCRPIX2 = 540'))
      // objects_in_field
      .mockResolvedValueOnce(jsonResp({ objects_in_field: ['NGC5457', 'M101'] }));

    const result = await reuseSubmission(10001, 1920, 1080);
    expect(result.success).toBe(true);
    expect(result.correspondences).toHaveLength(3);
  });

  it('falls back to calibration when WCS text has no CRPIX1', async () => {
    const THREE_CORRS = [
      { pointIndex: 0, photoX: 100, photoY: 200, starHip: 1, starName: 'A', starRa: 10, starDec: 20 },
      { pointIndex: 1, photoX: 300, photoY: 400, starHip: 2, starName: 'B', starRa: 15, starDec: 25 },
      { pointIndex: 2, photoX: 500, photoY: 600, starHip: 3, starName: 'C', starRa: 20, starDec: 30 },
    ];
    mockWcsCorrs.mockReturnValueOnce(THREE_CORRS as any);

    fetchMock
      // job status
      .mockResolvedValueOnce(jsonResp({ status: 'success' }))
      // WCS file — no CRPIX1, so fallback triggers
      .mockResolvedValueOnce(textResp('SIMPLE = T / no WCS keywords here'))
      // calibration endpoint
      .mockResolvedValueOnce(jsonResp({ ra: 84.05, dec: -1.2, pixscale: 1.5, orientation: 0, parity: 1.0 }))
      // objects_in_field
      .mockResolvedValueOnce(jsonResp({ objects_in_field: ['M42'] }));

    const result = await reuseSubmission(10002, 1920, 1080);
    expect(result.success).toBe(true);
  });

  it('returns failure when no correspondences can be derived', async () => {
    mockWcsCorrs.mockReset();
    mockWcsCorrs.mockReturnValue([] as any);
    fetchMock
      .mockResolvedValueOnce(jsonResp({ status: 'success' }))
      .mockResolvedValueOnce(textResp('SIMPLE = T'))
      .mockResolvedValueOnce(jsonResp({ ra: 84.05, dec: -1.2, pixscale: 1.5, orientation: 0, parity: 1.0 }));

    const result = await reuseSubmission(10003, 1920, 1080);
    expect(result.success).toBe(false);
  });

  it('falls back to calibration when WCS parse is incomplete and succeeds', async () => {
    mockParseFITSHeader.mockReturnValueOnce({
      CRPIX1: 960,
      CRPIX2: 540,
      CRVAL1: 84.05,
      CRVAL2: -1.2,
      CD1_1: -0.0004,
      CD1_2: 0,
      CD2_1: 0,
      // missing CD2_2 => hasAll false
    } as any);
    mockWcsCorrs.mockReset();
    mockWcsCorrs.mockReturnValueOnce([
      { pointIndex: 0, photoX: 10, photoY: 20, starHip: 1, starName: 'A' },
      { pointIndex: 1, photoX: 30, photoY: 40, starHip: 2, starName: 'B' },
      { pointIndex: 2, photoX: 50, photoY: 60, starHip: 3, starName: 'C' },
    ] as any);

    fetchMock
      .mockResolvedValueOnce(jsonResp({ status: 'success' }))
      .mockResolvedValueOnce(textResp('CRPIX1 = 960'))
      .mockResolvedValueOnce(jsonResp({ ra: 84.05, dec: -1.2, pixscale: 1.5, orientation: 0, parity: 1 }))
      .mockResolvedValueOnce(jsonResp({ objects_in_field: ['M 42'] }));

    const result = await reuseSubmission(10004, 1920, 1080);
    expect(result.success).toBe(true);
    expect(result.correspondences).toHaveLength(3);
  });

  it('returns failure on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'));

    const result = await reuseSubmission(99, 800, 600);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });
});
