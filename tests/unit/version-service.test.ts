// @vitest-environment node
/** The update-check service on a fake `HttpClient` and a fake clock: the request, the mapping and the one-hour cache. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HttpRequest, HttpResponse } from '@myastrosky/core/ports/http-client';
import { createVersionService } from '@myastrosky/core/services/version';

const HOUR = 60 * 60 * 1000;
const URL = 'https://api.github.com/repos/gweybrec/my-astro-sky/releases/latest';

function reply(body: unknown, status = 200): HttpResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, headers: {}, text: async () => text, bytes: async () => new Uint8Array() };
}

function setup(answer: () => Promise<HttpResponse>) {
  const http = vi.fn(async (_req: HttpRequest) => answer());
  let clock = 5_000;
  const service = createVersionService({ http, now: () => clock });
  return {
    http,
    service,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const RELEASE = {
  tag_name: 'v1.2.3',
  html_url: 'https://example.test/r',
  published_at: '2026-01-01',
};

describe('createVersionService().getLatest()', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends one GET to the releases endpoint with the GitHub headers and no timeout', async () => {
    const { service, http } = setup(async () => reply(RELEASE));
    expect(await service.getLatest()).toEqual({
      version: 'v1.2.3',
      url: 'https://example.test/r',
      publishedAt: '2026-01-01',
    });
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0][0]).toEqual({
      method: 'GET',
      url: URL,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MyAstroSky' },
    });
  });

  it('serves the cache for an hour, then asks again', async () => {
    const { service, http, advance } = setup(async () => reply(RELEASE));
    await service.getLatest();
    advance(HOUR - 1);
    await service.getLatest();
    expect(http).toHaveBeenCalledTimes(1);
    advance(1);
    await service.getLatest();
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('keeps the cache in the instance: a second service asks again', async () => {
    const a = setup(async () => reply(RELEASE));
    const b = setup(async () => reply(RELEASE));
    await a.service.getLatest();
    await b.service.getLatest();
    expect(a.http).toHaveBeenCalledTimes(1);
    expect(b.http).toHaveBeenCalledTimes(1);
  });

  it('answers null for an error status and caches the null', async () => {
    const { service, http } = setup(async () => reply('rate limited', 403));
    expect(await service.getLatest()).toBeNull();
    expect(await service.getLatest()).toBeNull();
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('answers null when the request fails or the body is not JSON, and never throws', async () => {
    const failing = setup(async () => {
      throw new Error('ENOTFOUND');
    });
    expect(await failing.service.getLatest()).toBeNull();
    const garbled = setup(async () => reply('<html>'));
    expect(await garbled.service.getLatest()).toBeNull();
  });

  it('answers null for a payload without a usable tag', async () => {
    expect(await setup(async () => reply({ name: 'x' })).service.getLatest()).toBeNull();
    expect(await setup(async () => reply({ tag_name: '  ' })).service.getLatest()).toBeNull();
  });

  it('fills a missing url and date with defaults', async () => {
    const { service } = setup(async () => reply({ tag_name: 'v1.0.0' }));
    expect(await service.getLatest()).toEqual({ version: 'v1.0.0', url: '', publishedAt: null });
  });
});
