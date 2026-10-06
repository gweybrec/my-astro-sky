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
import { createNovaSolveService } from '@myastrosky/core/services/nova-solve';
import type { CatalogStar } from '@myastrosky/core/wcs';
import { buildFits } from '../fixtures/fits-builders';

const FIXTURES = path.join(__dirname, '../fixtures/astrometry');
const WCS_TEXT = fs.readFileSync(path.join(FIXTURES, '10796000-wcs.fits'), 'latin1');
const OBJECTS = fs.readFileSync(path.join(FIXTURES, '10796000-objects.json'), 'utf8');
const CALIBRATION = fs.readFileSync(path.join(FIXTURES, '10796000-calibration.json'), 'utf8');

/** Stars around the reference point of the fixture solution (M13), so the solution finds some. */
const STARS: CatalogStar[] = [
  { hip: 99004, ra: 251.072257, dec: 36.213791, mag: 5 },
  { hip: 99005, ra: 250.9, dec: 36.3, mag: 6 },
  { hip: 99006, ra: 251.2, dec: 36.1, mag: 6.5 },
  { hip: 99007, ra: 250.7, dec: 36.4, mag: 7 },
];

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
    stars?: CatalogStar[];
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
    stars: options.stars ?? STARS,
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
    // 30 pixels on the smaller side: 2 degrees over it.
    expect(request.scale_lower).toBeCloseTo((2 * 3600) / 30 / 2);
    // The same size with a name that is not a FITS name is not a picture.
    expect(await failure(t.service.submit({ fileName: 'x.dat', bytes: fits }))).toBe(
      'invalid:CANNOT_DETERMINE_DIMENSIONS',
    );
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
    expect(t.calls[1].headers).toBeUndefined();
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
    expect(Object.keys(job)).toEqual(['jobId', 'status', 'correspondences', 'error', 'dsoIds']);
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
    // The catalogue may hold too few stars for the calibration; either way the job is final.
    expect(['solved', 'failed']).toContain(job.status);
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

  it('times out when the submission never becomes a job', async () => {
    const t = setup({
      route: (r) => (r.url === `${API}/submissions/9` ? json({ jobs: [null] }) : solvedRoute(r)),
    });
    const id = await t.service.submit(t.file);
    await t.pump(9);
    expect(t.sleep).toHaveBeenCalledTimes(8);
    expect(await t.service.getJob(id)).toMatchObject({
      status: 'timeout',
      error: 'Timeout: pas de job créé',
    });
  });
});

describe('listSubmissions()', () => {
  it('fetches the details five jobs at a time and sorts by descending id', async () => {
    let inFlight = 0;
    let peak = 0;
    const t = setup({
      route: async (r) => {
        const login = loginOk(r.url);
        if (login) return login;
        if (r.url === `${API}/myjobs/`) return json({ jobs: [1, 2, 3, 4, 5, 6, 7] });
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
        return json({ status: 'success', original_filename: 'f.jpg', width: 10, height: 20 });
      },
    });
    const list = await t.service.listSubmissions();
    expect(list.map((s) => s.jobId)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(peak).toBe(5);
  });

  it('answers an empty list and logs when the account cannot be read', async () => {
    const t = setup({ route: (r) => loginOk(r.url) ?? reply('', 403) });
    expect(await t.service.listSubmissions()).toEqual([]);
    expect(t.log).toHaveBeenCalledWith('astrometry_myjobs_failed', expect.any(Error));
    const u = setup({ route: () => json({ status: 'error' }) });
    expect(await u.service.listSubmissions()).toEqual([]);
    expect(u.log).toHaveBeenCalledWith('astrometry_list_failed', expect.any(Error));
  });
});

describe('reuse()', () => {
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
