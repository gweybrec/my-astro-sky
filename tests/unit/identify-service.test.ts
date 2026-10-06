// @vitest-environment node
/**
 * The identify service on a fake `HttpClient` and a fake clock: the run-time checks of each
 * method, the requests it sends (URL, method, headers, timeout), the error codes, and the
 * caches living in the instance. The parsers and the recorded fixtures are covered by
 * skybot.test.ts, tns.test.ts and comets.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { HttpRequest, HttpResponse } from '@myastrosky/core/ports/http-client';
import { createIdentifyService, TnsRateLimitError } from '@myastrosky/core/services/identify';

function reply(text: string, status = 200, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers, text: async () => text, bytes: async () => new Uint8Array() };
}

function setup(first?: HttpResponse) {
  const http = vi.fn(async (_req: HttpRequest) => first ?? reply(''));
  let clock = 1_000;
  const service = createIdentifyService({ http, now: () => clock });
  return {
    http,
    service,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const SKYBOT = { raDeg: 186.9, decDeg: 13, radiusArcmin: 5, epochJd: 2461139.5 };
const TNS = {
  raDeg: 339.2671,
  decDeg: 34.4159,
  radiusArcmin: 20,
  dateStart: '2025-09-04',
  dateEnd: '2026-11-03',
};

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  const err = await p.then(
    () => undefined,
    (e) => e,
  );
  return isDomainError(err) ? `${err.kind}:${err.code}` : undefined;
}

describe('searchAsteroids()', () => {
  it('sends a GET with a 20 s timeout and no headers', async () => {
    const { service, http } = setup();
    await service.searchAsteroids(SKYBOT);
    const req = http.mock.calls[0][0];
    expect(req.method).toBe('GET');
    expect(req.url.startsWith('https://ssp.imcce.fr/webservices/skybot/api/conesearch.php?')).toBe(
      true,
    );
    expect(req.headers).toBeUndefined();
    expect(req.timeoutMs).toBe(20_000);
  });

  it('uses the given observatory code', async () => {
    const { service, http } = setup();
    await service.searchAsteroids({ ...SKYBOT, location: 'F65' });
    expect(new URL(http.mock.calls[0][0].url).searchParams.get('-loc')).toBe('F65');
  });

  it.each([
    ['accepted: the bounds', { raDeg: 360, decDeg: -90, radiusArcmin: 60 }, undefined],
    ['rejected: raDeg NaN', { raDeg: NaN }, 'invalid:INVALID_PARAMS'],
    ['rejected: decDeg above 90', { decDeg: 90.1 }, 'invalid:INVALID_PARAMS'],
    ['rejected: radius zero', { radiusArcmin: 0 }, 'invalid:INVALID_PARAMS'],
    ['rejected: radius above 60', { radiusArcmin: 60.1 }, 'invalid:INVALID_PARAMS'],
    ['rejected: epoch zero', { epochJd: 0 }, 'invalid:INVALID_PARAMS'],
    ['rejected: epoch not finite', { epochJd: Infinity }, 'invalid:INVALID_PARAMS'],
  ])('%s', async (_label, change, expected) => {
    const { service, http } = setup();
    expect(await codeOf(service.searchAsteroids({ ...SKYBOT, ...change }))).toBe(expected);
    expect(http).toHaveBeenCalledTimes(expected ? 0 : 1);
  });

  it('reports every upstream failure as upstream:SKYBOT_FAILED', async () => {
    const down = setup(reply('x', 503));
    expect(await codeOf(down.service.searchAsteroids(SKYBOT))).toBe('upstream:SKYBOT_FAILED');
    const flag = setup(reply('# Flag: -1\nboom'));
    expect(await codeOf(flag.service.searchAsteroids(SKYBOT))).toBe('upstream:SKYBOT_FAILED');
    const garbled = setup(reply('{nope'));
    expect(await codeOf(garbled.service.searchAsteroids(SKYBOT))).toBe('upstream:SKYBOT_FAILED');
    const { service, http } = setup();
    http.mockRejectedValueOnce(new Error('ECONNRESET'));
    const err = await service.searchAsteroids(SKYBOT).catch((e) => e);
    expect(err.message).toBe('SkyBoT request failed: ECONNRESET');
    expect(err.cause).toBeInstanceOf(Error);
  });

  it('does not cache: two searches are two requests', async () => {
    const { service, http } = setup();
    await service.searchAsteroids(SKYBOT);
    await service.searchAsteroids(SKYBOT);
    expect(http).toHaveBeenCalledTimes(2);
  });
});

describe('searchTransients()', () => {
  it('sends a GET with the User-Agent and a 20 s timeout', async () => {
    const { service, http } = setup();
    await service.searchTransients(TNS);
    const req = http.mock.calls[0][0];
    expect(req.method).toBe('GET');
    expect(req.headers).toEqual({ 'User-Agent': 'MyAstroSky' });
    expect(req.timeoutMs).toBe(20_000);
  });

  it.each([
    [
      'accepted: the bounds',
      { radiusArcmin: 60, dateStart: '2026-01-01', dateEnd: '2026-01-01' },
      undefined,
    ],
    ['rejected: radius above 60', { radiusArcmin: 61 }, 'invalid:INVALID_PARAMS'],
    ['rejected: decDeg below -90', { decDeg: -90.5 }, 'invalid:INVALID_PARAMS'],
    ['rejected: empty dateStart', { dateStart: '' }, 'invalid:INVALID_PARAMS'],
    ['rejected: impossible day', { dateEnd: '2026-02-31x' }, 'invalid:INVALID_PARAMS'],
    ['rejected: start after end', { dateStart: '2027-01-01' }, 'invalid:INVALID_PARAMS'],
  ])('%s', async (_label, change, expected) => {
    const { service, http } = setup();
    expect(await codeOf(service.searchTransients({ ...TNS, ...change }))).toBe(expected);
    expect(http).toHaveBeenCalledTimes(expected ? 0 : 1);
  });

  it('throws rateLimited:TNS_RATE_LIMITED on 429, reading Retry-After when there is no reset header', async () => {
    const { service } = setup(reply('', 429, { 'retry-after': '30' }));
    const err = await service.searchTransients(TNS).catch((e) => e);
    expect(err).toBeInstanceOf(TnsRateLimitError);
    expect(`${err.kind}:${err.code}`).toBe('rateLimited:TNS_RATE_LIMITED');
    expect(err.retryAfterSeconds).toBe(30);
    const none = setup(reply('', 429));
    expect((await none.service.searchTransients(TNS).catch((e) => e)).retryAfterSeconds).toBeNull();
  });

  it('reports other failures as upstream:TNS_FAILED', async () => {
    const down = setup(reply('x', 500));
    expect(await codeOf(down.service.searchTransients(TNS))).toBe('upstream:TNS_FAILED');
    const html = setup(reply('<html>'));
    expect(await codeOf(html.service.searchTransients(TNS))).toBe('upstream:TNS_FAILED');
  });

  it('keeps a result for 6 hours, by the clock the service was given', async () => {
    const { service, http, advance } = setup();
    await service.searchTransients(TNS);
    advance(6 * 3600_000 - 1);
    await service.searchTransients(TNS);
    expect(http).toHaveBeenCalledTimes(1);
    advance(1);
    await service.searchTransients(TNS);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('keeps at most 200 cones: the oldest is dropped', async () => {
    const { service, http } = setup();
    for (let i = 0; i < 200; i++) await service.searchTransients({ ...TNS, raDeg: i });
    expect(http).toHaveBeenCalledTimes(200);
    await service.searchTransients({ ...TNS, raDeg: 200 });
    await service.searchTransients({ ...TNS, raDeg: 0 }); // evicted, so fetched again
    await service.searchTransients({ ...TNS, raDeg: 199 }); // still cached
    expect(http).toHaveBeenCalledTimes(202);
  });

  it('gives each instance its own cache', async () => {
    const a = setup();
    const b = setup();
    await a.service.searchTransients(TNS);
    await b.service.searchTransients(TNS);
    expect(a.http).toHaveBeenCalledTimes(1);
    expect(b.http).toHaveBeenCalledTimes(1);
  });
});

describe('getCometElements()', () => {
  it('sends a GET with the User-Agent and a 30 s timeout', async () => {
    const { service, http } = setup(reply('<html>'));
    await service.getCometElements().catch(() => undefined);
    const req = http.mock.calls[0][0];
    expect(req).toMatchObject({
      method: 'GET',
      url: 'https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt',
      headers: { 'User-Agent': 'MyAstroSky' },
      timeoutMs: 30_000,
    });
  });

  it('reports a failure with nothing cached as upstream:COMET_ELEMENTS_FAILED', async () => {
    expect(await codeOf(setup(reply('x', 503)).service.getCometElements())).toBe(
      'upstream:COMET_ELEMENTS_FAILED',
    );
    expect(await codeOf(setup(reply('<html>')).service.getCometElements())).toBe(
      'upstream:COMET_ELEMENTS_FAILED',
    );
    const { service, http } = setup();
    http.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await codeOf(service.getCometElements())).toBe('upstream:COMET_ELEMENTS_FAILED');
  });
});
