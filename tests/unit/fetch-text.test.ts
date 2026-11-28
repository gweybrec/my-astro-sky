import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'zlib';
// @ts-expect-error -- plain .mjs build script, no type declarations
import { describeFetchError, fetchFromMirrors, fetchText } from '../../scripts/fetch-text.mjs';

/** The shape of Node's fetch failure: "fetch failed", the real error in `cause`. */
function fetchFailed(cause: unknown): Error {
  return new TypeError('fetch failed', { cause });
}

function sysError(code: string, message: string, address?: string, port?: number) {
  return Object.assign(new Error(message), { code, address, port });
}

describe('describeFetchError', () => {
  it('names a refused connection and the address that refused it', () => {
    const e = fetchFailed(
      sysError('ECONNREFUSED', 'connect ECONNREFUSED 130.79.129.14:443', '130.79.129.14', 443),
    );
    expect(describeFetchError(e)).toBe(
      'the server refused the connection (server down, or the port is blocked) [ECONNREFUSED 130.79.129.14:443]',
    );
  });

  it('reads the errors of an AggregateError (one per address tried)', () => {
    const e = fetchFailed(
      new AggregateError([sysError('ETIMEDOUT', 'connect ETIMEDOUT 130.79.129.14:443')]),
    );
    expect(describeFetchError(e)).toMatch(/^the connection timed out .*\[ETIMEDOUT\]$/);
  });

  it('names a DNS failure', () => {
    const e = fetchFailed(sysError('ENOTFOUND', 'getaddrinfo ENOTFOUND cdsarc.cds.unistra.fr'));
    expect(describeFetchError(e)).toMatch(/^the host name was not found/);
  });

  it('names our own time-out', () => {
    const e = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    expect(describeFetchError(e)).toBe('no answer within 60 s (server down or very slow)');
  });

  it('keeps an unknown error code and its message', () => {
    const e = fetchFailed(sysError('EWEIRD', 'something odd'));
    expect(describeFetchError(e)).toBe('EWEIRD: something odd');
  });
});

describe('fetchText', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says what could not be downloaded, from where and why', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(fetchFailed(sysError('ECONNRESET', 'read ECONNRESET'))),
    );
    await expect(fetchText('https://example.org/x.dat', 'the X catalogue')).rejects.toThrow(
      'Could not download the X catalogue from https://example.org/x.dat: the connection was cut',
    );
  });

  it('reports an HTTP error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('', { status: 503, statusText: 'Service Unavailable' })),
    );
    await expect(fetchText('https://example.org/x.dat', 'the X catalogue')).rejects.toThrow(
      'the server answered HTTP 503 Service Unavailable',
    );
  });

  it('returns the text on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('hello')));
    await expect(fetchText('https://example.org/x.dat', 'the X catalogue')).resolves.toBe('hello');
  });

  it('unpacks a gzipped file when asked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(gzipSync('NGC 2606'))));
    await expect(
      fetchText('https://example.org/x.gz', 'the X catalogue', { gzip: true }),
    ).resolves.toBe('NGC 2606');
  });
});

describe('fetchFromMirrors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const down = () => Promise.reject(fetchFailed(sysError('ECONNREFUSED', 'connect ECONNREFUSED')));

  it('falls back to the next mirror, then starts from the one that answered', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mirrors = ['https://main.example/', 'https://mirror.example/'];
    const fetchMock = vi.fn((url: string) =>
      url.startsWith('https://main.') ? down() : Promise.resolve(new Response(`got ${url}`)),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchFromMirrors(mirrors, 'a/b.dat', 'the file')).resolves.toBe(
      'got https://mirror.example/a/b.dat',
    );
    await fetchFromMirrors(mirrors, 'c.dat', 'the file');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://main.example/a/b.dat',
      'https://mirror.example/a/b.dat',
      'https://mirror.example/c.dat',
    ]);
  });

  it('lists every mirror and its reason when all fail', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(down));
    const error = await fetchFromMirrors(['https://a.example/', 'https://b.example/'], 'x', 'the X')
      .then(() => null)
      .catch((e: Error) => e);
    expect(error?.message).toMatch(/^Could not download the X from any mirror:/);
    expect(error?.message).toContain('https://a.example/x: the server refused the connection');
    expect(error?.message).toContain('https://b.example/x: the server refused the connection');
  });
});
