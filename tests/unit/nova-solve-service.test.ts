// @vitest-environment node
/**
 * The online-solving service on a fake `HttpClient`, a fake clock and the real WCS maths over a
 * small catalogue: the run-time checks of each method and their error codes, the requests it
 * sends, the session and the jobs living in the instance, the background polling driven by an
 * injected `sleep`, and what is reported through `log`. The HTTP layer with mocked parsers is
 * covered by astrometry-http.test.ts; the routes by server-app-network.test.ts.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi } from 'vitest';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { HttpRequest, HttpResponse } from '@myastrosky/core/ports/http-client';
import { createNovaSolveService, POLL_BUDGET_MS } from '@myastrosky/core/services/nova-solve';
import { fovScaleHints, onlineSolveHints } from '@myastrosky/core/domain/solve';
import { buildFits } from '../fixtures/fits-builders';

const FIXTURES = path.join(__dirname, '../fixtures/astrometry');
const WCS_TEXT = fs.readFileSync(path.join(FIXTURES, '10796000-wcs.fits'), 'latin1');
const OBJECTS = fs.readFileSync(path.join(FIXTURES, '10796000-objects.json'), 'utf8');
const CALIBRATION = fs.readFileSync(path.join(FIXTURES, '10796000-calibration.json'), 'utf8');

const API = 'https://nova.astrometry.net/api';
const BIG = { width: 3840, height: 2160 };

const reply = (text: string, status = 200): HttpResponse => ({
  status,
  headers: {},
  text: async () => text,
  bytes: async () => new Uint8Array(),
});
const json = (data: unknown) => reply(JSON.stringify(data));

type Route = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

function setup(
  options: {
    key?: string | undefined;
    size?: { width: number; height: number } | 'unreadable';
    route?: Route;
  } = {},
) {
  const calls: HttpRequest[] = [];
  const route: Route = options.route ?? (() => reply('', 404));
  const http = vi.fn(async (req: HttpRequest) => {
    calls.push(req);
    return route(req);
  });
  const settings = {
    get: vi.fn(async (_k: string) => ('key' in options ? options.key : 'the-key')),
  };
  const probe = vi.fn(async () => {
    if (options.size === 'unreadable') throw new Error('Unreadable image');
    return options.size ?? BIG;
  });
  const log = vi.fn();
  // The polling waits on this: a test releases the waits one by one.
  const waits: Array<() => void> = [];
  const sleep = vi.fn((_ms: number) => new Promise<void>((resolve) => waits.push(resolve)));
  let clock = 1_000;
  let ids = 0;
  const service = createNovaSolveService({
    http,
    settings,
    images: { probe } as never,
    now: () => clock,
    newId: () => `job-${++ids}`,
    log,
    sleep,
  });
  const file = { fileName: 'm13.jpg', bytes: new Uint8Array([1, 2, 3]) };
  return {
    service,
    http,
    calls,
    settings,
    probe,
    log,
    sleep,
    file,
    advance: (ms: number) => {
      clock += ms;
    },
    /** Lets the polling run until it waits again (or ends). */
    async pump(times = 1) {
      for (let i = 0; i < times; i++) {
        await new Promise((r) => setTimeout(r, 0));
        waits.shift()?.();
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
}

async function failure(p: Promise<unknown>) {
  const err = await p.then(
    () => undefined,
    (e) => e,
  );
  return isDomainError(err) ? `${err.kind}:${err.code}` : String(err);
}

const loginOk = (url: string): HttpResponse | undefined =>
  url === `${API}/login` ? json({ status: 'success', session: 'sess' }) : undefined;

describe('isConfigured() and the API key', () => {
  it('reads the key through the settings service on every call', async () => {
    const t = setup({ key: undefined });
    expect(await t.service.isConfigured()).toBe(false);
    expect(t.settings.get).toHaveBeenCalledWith('ASTROMETRY_API_KEY');
    const u = setup({ key: 'abc' });
    expect(await u.service.isConfigured()).toBe(true);
  });

  it('refuses to submit without a key, before any request', async () => {
    const t = setup({ key: undefined });
    expect(await failure(t.service.submit(t.file))).toBe('invalid:ASTROMETRY_NOT_CONFIGURED');
    expect(t.http).not.toHaveBeenCalled();
  });

  it('refuses to list the submissions or reuse one without a key, before any request', async () => {
    const t = setup({ key: undefined });
    expect(await failure(t.service.listSubmissions())).toBe('invalid:ASTROMETRY_NOT_CONFIGURED');
    // The key is checked before the job id.
    expect(await failure(t.service.reuse(t.file, Number.NaN))).toBe(
      'invalid:ASTROMETRY_NOT_CONFIGURED',
    );
    expect(t.http).not.toHaveBeenCalled();
  });
});

describe('submit()', () => {
  it('accepts a picture whose size is known and rejects an unreadable one', async () => {
    const ok = setup({
      route: (r) => loginOk(r.url) ?? json({ status: 'success', subid: 1 }),
    });
    expect(await ok.service.submit(ok.file)).toBe('job-1');

    const bad = setup({ size: 'unreadable' });
    expect(await failure(bad.service.submit(bad.file))).toBe('invalid:CANNOT_DETERMINE_DIMENSIONS');
    expect(bad.http).not.toHaveBeenCalled();
  });

  it('reads the size of an unreadable .fits from its header', async () => {
    const fits = new Uint8Array(
      buildFits({
        bitpix: -32,
        naxis1: 40,
        naxis2: 30,
        pixels: Array.from({ length: 1200 }, () => 0),
        extraCards: [
          'CRPIX1  = 20.5',
          'CRPIX2  = 15.5',
          'CRVAL1  = 330.2',
          'CRVAL2  = 73.0',
          'CD1_1   = -0.1',
          'CD1_2   = 0',
          'CD2_1   = 0',
          'CD2_2   = 0.1',
        ],
      }),
    );
    const t = setup({
      size: 'unreadable',
      route: (r) => loginOk(r.url) ?? json({ status: 'success', subid: 1 }),
    });
    await t.service.submit({ fileName: 'x.FITS', bytes: fits });
    const request = JSON.parse(
      (t.calls[1].body as { form: Array<{ value?: string }> }).form[0].value!,
    );
    expect(request).toMatchObject({ scale_units: 'degwidth', scale_lower: 0.1, scale_upper: 180 });
    // The same size with a name that is not a FITS name is not a picture.
    expect(await failure(t.service.submit({ fileName: 'x.dat', bytes: fits }))).toBe(
      'invalid:CANNOT_DETERMINE_DIMENSIONS',
    );
  });

  it.each(['raw.fit', 'raw.fits', 'RAW.FIT', 'RAW.FITS'])(
    'reads the size of the FITS file %s that has no plate solution',
    async (fileName) => {
      const fits = new Uint8Array(
        buildFits({
          bitpix: 16,
          naxis1: 40,
          naxis2: 30,
          pixels: Array.from({ length: 1200 }, () => 0),
        }),
      );
      const t = setup({
        size: 'unreadable',
        route: (r) => loginOk(r.url) ?? json({ status: 'success', subid: 1 }),
      });
      await t.service.submit({ fileName, bytes: fits });
      const request = JSON.parse(
        (t.calls[1].body as { form: Array<{ value?: string }> }).form[0].value!,
      );
      expect(request.scale_upper).toBe(180);
    },
  );

  it('sends a field width range from the hint in degrees, and the full range without one', async () => {
    const t = setup({
      route: (r) => loginOk(r.url) ?? json({ status: 'success', subid: 1 }),
    });
    const sent = (i: number) =>
      JSON.parse((t.calls[i].body as { form: Array<{ value?: string }> }).form[0].value!);
    await t.service.submit(t.file, { ...fovScaleHints(2.5), ra: 10, dec: 41 });
    expect(sent(1)).toMatchObject({ scale_units: 'degwidth', scale_type: 'ul', center_ra: 10 });
    expect(sent(1).scale_lower).toBeCloseTo(2);
    expect(sent(1).scale_upper).toBeCloseTo(3);
    await t.service.submit(t.file, { ra: 10, dec: 41 });
    expect(sent(2)).toMatchObject({ scale_units: 'degwidth', scale_lower: 0.1, scale_upper: 180 });
  });

  it('builds the hint from the target object and the field width typed, each only when given', () => {
    expect(onlineSolveHints(null, null)).toEqual({});
    expect(onlineSolveHints({ ra: 10, dec: 41 }, null)).toEqual({ ra: 10, dec: 41, radius: 2 });
    expect(onlineSolveHints(null, 2.5)).toEqual(fovScaleHints(2.5));
  });

  it('keeps the field width range inside 0.1 to 180 degrees', () => {
    expect(fovScaleHints(0.1).scale_lower).toBe(0.1);
    expect(fovScaleHints(170).scale_upper).toBe(180);
  });

  it('logs in once and sends the picture as a multipart form with the file part', async () => {
    const t = setup({
      route: (r) => loginOk(r.url) ?? json({ status: 'success', subid: 5 }),
    });
    await t.service.submit(t.file);
    await t.service.submit(t.file);
    expect(t.calls.map((c) => c.url)).toEqual([`${API}/login`, `${API}/upload`, `${API}/upload`]);
    const form = (t.calls[1].body as { form: unknown[] }).form;
    expect(form[1]).toEqual({
      name: 'file',
      fileName: 'm13.jpg',
      type: 'application/octet-stream',
      bytes: t.file.bytes,
    });
    // No Content-Type: the client sets the form's own, with its boundary.
    expect(t.calls[1].headers).toEqual({ 'User-Agent': 'MyAstroSky' });
  });

  it('sends a file read on demand as it is, reading only the start of a FITS for its size', async () => {
    const fits = buildFits({
      bitpix: -32,
      naxis1: 400,
      naxis2: 300,
      pixels: Array.from({ length: 400 * 300 }, () => 0),
    });
    const reads: Array<[number | undefined, number | undefined]> = [];
    // A Blob-like source over the file: it records what is read.
    const source = (start = 0, end = fits.length) => ({
      size: end - start,
      slice: (s?: number, e?: number) => {
        reads.push([s, e]);
        return source(start + (s ?? 0), Math.min(end, start + (e ?? end - start)));
      },
      arrayBuffer: async () => {
        reads.push([start, end]);
        return new Uint8Array(fits.subarray(start, end)).buffer;
      },
    });
    const bytes = source();
    const t = setup({ route: (r) => loginOk(r.url) ?? json({ status: 'success', subid: 5 }) });
    await t.service.submit({ fileName: 'm13.fits', bytes });
    expect(t.probe).not.toHaveBeenCalled();
    expect(reads).toEqual([
      [0, 64 * 1024],
      [0, 64 * 1024],
    ]);
    expect(((t.calls[1].body as { form: unknown[] }).form[1] as { bytes: unknown }).bytes).toBe(
      bytes,
    );
    const status = await t.service.getJob('job-1');
    expect(status.status).toBe('solving');
  });

  it('names the app in every request: astrometry.net answers a browser User-Agent with a page for crawlers', async () => {
    const t = setup({
      route: (r) => loginOk(r.url) ?? json({ status: 'success', subid: 5 }),
    });
    await t.service.submit(t.file);
    expect(t.calls.length).toBeGreaterThan(1);
    for (const call of t.calls) expect(call.headers?.['User-Agent']).toBe('MyAstroSky');
  });

  it('logs in again after resetSession()', async () => {
    const t = setup({
      route: (r) => loginOk(r.url) ?? json({ status: 'success', subid: 5 }),
    });
    await t.service.submit(t.file);
    t.service.resetSession();
    await t.service.submit(t.file);
    expect(t.calls.filter((c) => c.url === `${API}/login`)).toHaveLength(2);
  });

  it('throws upstream ASTROMETRY_LOGIN_FAILED, with the message the route sends, when the login is refused', async () => {
    const t = setup({ route: () => json({ status: 'error', errormessage: 'bad apikey' }) });
    const err = await t.service.submit(t.file).catch((e) => e);
    expect(isDomainError(err) && [err.kind, err.code, err.message]).toEqual([
      'upstream',
      'ASTROMETRY_LOGIN_FAILED',
      "Échec de l'authentification astrometry.net: bad apikey",
    ]);
  });

  it('forgets a job after an hour, on the clock it is given', async () => {
    const t = setup({
      route: (r) => loginOk(r.url) ?? json({ status: 'error', errormessage: 'x' }),
    });
    const first = await t.service.submit(t.file);
    t.advance(60 * 60 * 1000 + 1);
    const second = await t.service.submit(t.file);
    expect(await failure(t.service.getJob(first))).toBe('notFound:JOB_NOT_FOUND');
    expect((await t.service.getJob(second)).status).toBe('failed');
  });
});

describe('the polling of a submitted job', () => {
  const solvedRoute: Route = (r) =>
    loginOk(r.url) ??
    (r.url === `${API}/upload`
      ? json({ status: 'success', subid: 9 })
      : r.url === `${API}/submissions/9`
        ? json({ jobs: [10796000] })
        : r.url === `${API}/jobs/10796000`
          ? json({ status: 'success' })
          : r.url === 'https://nova.astrometry.net/wcs_file/10796000/'
            ? reply(WCS_TEXT)
            : r.url === `${API}/jobs/10796000/objects_in_field/`
              ? reply(OBJECTS)
              : reply('', 404));

  it('waits 3 s, then 5 s, then solves the job from its WCS file', async () => {
    const t = setup({ route: solvedRoute });
    const id = await t.service.submit(t.file);
    expect((await t.service.getJob(id)).status).toBe('solving');
    await t.pump(1);
    expect(t.sleep).toHaveBeenNthCalledWith(1, 3000);
    await t.pump(1);
    expect(t.sleep).toHaveBeenNthCalledWith(2, 5000);
    await t.pump(1);
    const job = await t.service.getJob(id);
    expect(job.status).toBe('solved');
    expect(job.correspondences!.length).toBeGreaterThanOrEqual(3);
    expect(job.dsoIds!.length).toBeGreaterThan(0);
    expect(Object.keys(job)).toEqual([
      'jobId',
      'status',
      'correspondences',
      'error',
      'dsoIds',
      'submissionId',
    ]);
    expect(job.submissionId).toBe(9);
  });

  it('solves from the calibration when the job has no WCS file', async () => {
    const t = setup({
      route: (r) =>
        r.url === 'https://nova.astrometry.net/wcs_file/10796000/'
          ? reply('SIMPLE  = T')
          : r.url === `${API}/jobs/10796000/calibration/`
            ? reply(CALIBRATION)
            : solvedRoute(r),
    });
    const id = await t.service.submit(t.file);
    await t.pump(3);
    const job = await t.service.getJob(id);
    expect(job.status).toBe('solved');
    expect(t.calls.some((c) => c.url === `${API}/jobs/10796000/calibration/`)).toBe(true);
  });

  it('fails the job when astrometry.net reports a failure', async () => {
    const t = setup({
      route: (r) =>
        r.url === `${API}/jobs/10796000` ? json({ status: 'failure' }) : solvedRoute(r),
    });
    const id = await t.service.submit(t.file);
    await t.pump(3);
    expect(await t.service.getJob(id)).toMatchObject({ status: 'failed', error: 'Solving failed' });
  });

  /** The time the polling waited in all. */
  const waitedMs = (t: ReturnType<typeof setup>) =>
    t.sleep.mock.calls.reduce((sum, [ms]) => sum + ms, 0);

  it('stops after 15 minutes when the submission never becomes a job, without an error', async () => {
    const t = setup({
      route: (r) => (r.url === `${API}/submissions/9` ? json({ jobs: [null] }) : solvedRoute(r)),
    });
    const id = await t.service.submit(t.file);
    await t.pump(80);
    expect(waitedMs(t)).toBe(POLL_BUDGET_MS);
    expect(POLL_BUDGET_MS).toBe(15 * 60 * 1000);
    const job = await t.service.getJob(id);
    expect(job.status).toBe('timeout');
    expect(job.error).toBeUndefined();
    // Every 13 s at most: astrometry.net is not asked too often.
    expect(Math.max(...t.sleep.mock.calls.map(([ms]) => ms))).toBe(13000);
  });

  it('stops after 15 minutes when the job is still solving, without an error', async () => {
    const t = setup({
      route: (r) =>
        r.url === `${API}/jobs/10796000` ? json({ status: 'solving' }) : solvedRoute(r),
    });
    const id = await t.service.submit(t.file);
    await t.pump(80);
    expect(waitedMs(t)).toBe(POLL_BUDGET_MS);
    const job = await t.service.getJob(id);
    expect(job).toMatchObject({ status: 'timeout', submissionId: 9 });
    expect(job.error).toBeUndefined();
  });

  it('still gets the solution of a job astrometry.net solves after 12 minutes', async () => {
    let solved = false;
    const t = setup({
      route: (r) =>
        r.url === `${API}/jobs/10796000` && !solved ? json({ status: 'solving' }) : solvedRoute(r),
    });
    const id = await t.service.submit(t.file);
    while (waitedMs(t) < 12 * 60 * 1000) await t.pump(1);
    expect((await t.service.getJob(id)).status).toBe('solving');
    solved = true;
    await t.pump(2);
    expect((await t.service.getJob(id)).status).toBe('solved');
  });
});

describe('resume()', () => {
  const solvedRoute: Route = (r) =>
    r.url === `${API}/submissions/9`
      ? json({ jobs: [10796000] })
      : r.url === `${API}/jobs/10796000`
        ? json({ status: 'success' })
        : r.url === 'https://nova.astrometry.net/wcs_file/10796000/'
          ? reply(WCS_TEXT)
          : r.url === `${API}/jobs/10796000/objects_in_field/`
            ? reply(OBJECTS)
            : reply('', 404);

  it('follows a submission sent by another instance under a new job, without uploading or logging in', async () => {
    // A new instance stands for the app after a restart: it never saw the submission.
    const t = setup({ route: solvedRoute });
    const id = await t.service.resume(t.file, 9);
    expect(t.http).not.toHaveBeenCalled();
    expect(await t.service.getJob(id)).toMatchObject({ status: 'solving', submissionId: 9 });
    await t.pump(3);
    const job = await t.service.getJob(id);
    expect(job.status).toBe('solved');
    expect(job.correspondences!.length).toBeGreaterThanOrEqual(3);
    expect(t.calls.some((c) => c.url === `${API}/upload` || c.url === `${API}/login`)).toBe(false);
  });

  it('reads the solution with FITS rows when told the picture sent was a FITS file, though the one given is not', async () => {
    const plain = setup({ route: solvedRoute });
    const plainId = await plain.service.resume(plain.file, 9);
    await plain.pump(3);
    const asSent = setup({ route: solvedRoute });
    const fitsId = await asSent.service.resume(asSent.file, 9, { fits: true });
    await asSent.pump(3);
    const a = (await plain.service.getJob(plainId)).correspondences!;
    const b = (await asSent.service.getJob(fitsId)).correspondences!;
    expect(b).toHaveLength(a.length);
    // The same pixels, but their rows count from the other edge: each takes another place on the sky.
    expect(b.map((c) => [c.photoX, c.photoY])).toEqual(a.map((c) => [c.photoX, c.photoY]));
    expect(b.map((c) => c.starDec)).not.toEqual(a.map((c) => c.starDec));
  });

  it('refuses without a key, then a submission id that is not a positive integer, then an unreadable picture', async () => {
    const none = setup({ key: undefined });
    expect(await failure(none.service.resume(none.file, Number.NaN))).toBe(
      'invalid:ASTROMETRY_NOT_CONFIGURED',
    );
    const t = setup();
    for (const bad of [Number.NaN, 0, -3, 1.5]) {
      expect(await failure(t.service.resume(t.file, bad))).toBe('invalid:INVALID_SUBMISSION_ID');
    }
    const unreadable = setup({ size: 'unreadable' });
    expect(await failure(unreadable.service.resume(unreadable.file, 9))).toBe(
      'invalid:CANNOT_DETERMINE_DIMENSIONS',
    );
  });
});

describe('listSubmissions()', () => {
  const details = (status = 'success') =>
    json({ status, original_filename: 'f.jpg', width: 10, height: 20 });
  const infoUrls = (calls: HttpRequest[]) =>
    calls.filter((c) => c.url.includes('/info/')).map((c) => c.url);

  it('looks up the five most recent jobs by default, and gives the total', async () => {
    const t = setup({
      route: (r) =>
        loginOk(r.url) ??
        (r.url === `${API}/myjobs/` ? json({ jobs: [1, 2, null, 3, 4, 5, 6, 7] }) : details()),
    });
    const page = await t.service.listSubmissions();
    expect(page.total).toBe(7);
    expect(page.submissions.map((s) => s.jobId)).toEqual([7, 6, 5, 4, 3]);
    expect(infoUrls(t.calls)).toEqual([7, 6, 5, 4, 3].map((id) => `${API}/jobs/${id}/info/`));
  });

  it('looks up only the page asked for, 20 at most', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    const t = setup({
      route: (r) =>
        loginOk(r.url) ?? (r.url === `${API}/myjobs/` ? json({ jobs: ids }) : details()),
    });
    const page = await t.service.listSubmissions({ offset: 5, limit: 5 });
    expect(page.submissions.map((s) => s.jobId)).toEqual([25, 24, 23, 22, 21]);
    expect(infoUrls(t.calls)).toHaveLength(5);
    expect((await t.service.listSubmissions({ limit: 500 })).submissions).toHaveLength(20);
    expect((await t.service.listSubmissions({ offset: 40 })).submissions).toEqual([]);
  });

  it('keeps the details of a finished job, and asks again for one still running', async () => {
    const t = setup({
      route: (r) => {
        const login = loginOk(r.url);
        if (login) return login;
        if (r.url === `${API}/myjobs/`) return json({ jobs: [1, 2] });
        return details(r.url.includes('/2/') ? 'solving' : 'success');
      },
    });
    await t.service.listSubmissions();
    await t.service.listSubmissions();
    expect(infoUrls(t.calls)).toEqual([
      `${API}/jobs/2/info/`,
      `${API}/jobs/1/info/`,
      `${API}/jobs/2/info/`,
    ]);
  });

  it('answers an empty page and logs when the account cannot be read', async () => {
    const t = setup({ route: (r) => loginOk(r.url) ?? reply('', 403) });
    expect(await t.service.listSubmissions()).toEqual({ submissions: [], total: 0 });
    expect(t.log).toHaveBeenCalledWith('astrometry_myjobs_failed', expect.any(Error));
    const u = setup({ route: () => json({ status: 'error' }) });
    expect(await u.service.listSubmissions()).toEqual({ submissions: [], total: 0 });
    expect(u.log).toHaveBeenCalledWith('astrometry_list_failed', expect.any(Error));
  });

  it('throws rateLimited when astrometry.net refuses the list or the details of a job', async () => {
    const page = reply('<!DOCTYPE html><html>429 Too Many Requests</html>', 429);
    const t = setup({ route: (r) => loginOk(r.url) ?? page });
    expect(await failure(t.service.listSubmissions())).toBe('rateLimited:ASTROMETRY_RATE_LIMITED');
    const u = setup({
      route: (r) => loginOk(r.url) ?? (r.url === `${API}/myjobs/` ? json({ jobs: [1] }) : page),
    });
    expect(await failure(u.service.listSubmissions())).toBe('rateLimited:ASTROMETRY_RATE_LIMITED');
  });
});

describe('reuse()', () => {
  it('throws rateLimited when astrometry.net refuses for too many requests', async () => {
    const t = setup({ route: () => reply('<!DOCTYPE html><html>429</html>', 429) });
    expect(await failure(t.service.reuse(t.file, 10796000))).toBe(
      'rateLimited:ASTROMETRY_RATE_LIMITED',
    );
  });

  it('rejects a job id that is not a number or is zero, and a picture of unknown size', async () => {
    const t = setup();
    for (const bad of [0, NaN, 'x' as unknown as number]) {
      expect(await failure(t.service.reuse(t.file, bad))).toBe('invalid:INVALID_JOB_ID');
    }
    const u = setup({ size: 'unreadable' });
    expect(await failure(u.service.reuse(u.file, 5))).toBe('invalid:CANNOT_DETERMINE_DIMENSIONS');
    expect(t.http).not.toHaveBeenCalled();
    expect(u.http).not.toHaveBeenCalled();
  });

  it('builds the correspondences of a solved job for a picture of the same shape', async () => {
    const t = setup({
      route: (r) =>
        r.url === `${API}/jobs/10796000`
          ? json({ status: 'success' })
          : r.url === 'https://nova.astrometry.net/wcs_file/10796000/'
            ? reply(WCS_TEXT)
            : r.url === `${API}/jobs/10796000/objects_in_field/`
              ? reply(OBJECTS)
              : reply('', 404),
    });
    const r = await t.service.reuse(t.file, 10796000);
    expect(r.success).toBe(true);
    expect(r.correspondences!.length).toBeGreaterThanOrEqual(3);
    expect(r.dsoIds!.length).toBeGreaterThan(0);
  });

  it('keeps the sky size of a solution reused for a smaller picture of the same shape', async () => {
    const route: Route = (r) =>
      r.url === `${API}/jobs/10796000`
        ? json({ status: 'success' })
        : r.url === 'https://nova.astrometry.net/wcs_file/10796000/'
          ? reply(WCS_TEXT)
          : r.url === `${API}/jobs/10796000/objects_in_field/`
            ? reply(OBJECTS)
            : reply('', 404);
    const big = setup({ route });
    const full = await big.service.reuse(big.file, 10796000);
    const half = setup({ size: { width: 1920, height: 1080 }, route });
    const r = await half.service.reuse(half.file, 10796000);
    // The same points, at half the pixel position, on the same sky: the photo keeps its size on the sky.
    expect(r.correspondences).toHaveLength(9);
    r.correspondences!.forEach((c, i) => {
      const f = full.correspondences![i];
      expect([c.photoX, c.photoY]).toEqual([f.photoX / 2, f.photoY / 2]);
      expect(c.starRa).toBeCloseTo(f.starRa!, 9);
      expect(c.starDec).toBeCloseTo(f.starDec!, 9);
    });
  });

  it('reads the solution of a FITS solved by astrometry.net with its rows from the bottom', async () => {
    const solvedAs = (name: string | null) =>
      setup({
        route: (r) =>
          r.url === `${API}/jobs/10796000`
            ? json({ status: 'success' })
            : r.url === `${API}/jobs/10796000/info/`
              ? name
                ? json({ status: 'success', original_filename: name })
                : reply('', 404)
              : r.url === 'https://nova.astrometry.net/wcs_file/10796000/'
                ? reply(WCS_TEXT)
                : reply('', 404),
      });
    const t = solvedAs('m13.fit');
    const fits = (await t.service.reuse(t.file, 10796000)).correspondences!;
    const u = solvedAs('m13.jpg');
    const jpeg = (await u.service.reuse(u.file, 10796000)).correspondences!;
    // The 9 points run row by row from the top: the FITS reading puts on top what the JPEG one puts at the bottom.
    const mirrored = [6, 7, 8, 3, 4, 5, 0, 1, 2];
    expect(fits).toHaveLength(9);
    fits.forEach((c, i) => {
      expect([c.photoX, c.photoY]).toEqual([jpeg[i].photoX, jpeg[i].photoY]);
      // One pixel apart (the FITS rows count from 1 at the bottom edge).
      expect(c.starRa).toBeCloseTo(jpeg[mirrored[i]].starRa!, 2);
      expect(c.starDec).toBeCloseTo(jpeg[mirrored[i]].starDec!, 2);
    });
    expect(fits[0].starDec).not.toBeCloseTo(jpeg[0].starDec!, 2);
    // Without the name of the file solved, the picture's own type decides (here a JPEG).
    const v = solvedAs(null);
    expect((await v.service.reuse(v.file, 10796000)).correspondences).toEqual(jpeg);
  });

  it('takes the name of the file solved from the list already loaded, without asking again', async () => {
    const t = setup({
      route: (r) => {
        const login = loginOk(r.url);
        if (login) return login;
        if (r.url === `${API}/myjobs/`) return json({ jobs: [10796000] });
        if (r.url === `${API}/jobs/10796000/info/`)
          return json({
            status: 'success',
            original_filename: 'm13.fit',
            width: 3840,
            height: 2160,
          });
        if (r.url === `${API}/jobs/10796000`) return json({ status: 'success' });
        if (r.url === 'https://nova.astrometry.net/wcs_file/10796000/') return reply(WCS_TEXT);
        return reply('', 404);
      },
    });
    await t.service.listSubmissions();
    const before = t.calls.length;
    expect((await t.service.reuse(t.file, 10796000)).success).toBe(true);
    expect(t.calls.slice(before).some((c) => c.url.endsWith('/info/'))).toBe(false);
  });

  it('refuses a solution of another shape, with the message the route sends', async () => {
    const t = setup({
      size: { width: 100, height: 100 },
      route: (r) =>
        r.url === `${API}/jobs/10796000` ? json({ status: 'success' }) : reply(WCS_TEXT),
    });
    expect(await t.service.reuse(t.file, 10796000)).toEqual({
      success: false,
      error:
        'Selected astrometry solution appears to be for a different image (solution 3840x2160, current 100x100).',
    });
  });

  it('reports a network failure as a result and logs it', async () => {
    const t = setup({
      route: () => {
        throw new Error('timeout');
      },
    });
    expect(await t.service.reuse(t.file, 99)).toEqual({ success: false, error: 'timeout' });
    expect(t.log).toHaveBeenCalledWith('astrometry_reuse_failed', expect.any(Error), {
      jobId: 99,
    });
  });
});
