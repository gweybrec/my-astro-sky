import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- plain .mjs build script, no type declarations
import { describeFetchError, fetchText } from '../../scripts/fetch-text.mjs';

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
});
