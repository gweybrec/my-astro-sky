// @vitest-environment node
/** The server's `HttpClient` over `fetch`, with `globalThis.fetch` stubbed (no network). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFetchHttpClient } from '../../server/http-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createFetchHttpClient()', () => {
  it('sends method, url and headers, and returns the status, lower-case headers and the body', async () => {
    const fetchMock = vi.fn(
      async () => new Response('héllo', { status: 201, headers: { 'X-Thing': 'a' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await createFetchHttpClient()({
      method: 'GET',
      url: 'https://example.test/x',
      headers: { 'User-Agent': 'MyAstroSky' },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/x');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ 'User-Agent': 'MyAstroSky' });
    expect(res.status).toBe(201);
    expect(res.headers['x-thing']).toBe('a');
    expect(await res.text()).toBe('héllo');
    expect(Array.from(await res.bytes())).toEqual(Array.from(new TextEncoder().encode('héllo')));
  });

  it('does not throw on an error status', async () => {
    vi.stubGlobal('fetch', async () => new Response('no', { status: 503 }));
    const res = await createFetchHttpClient()({ method: 'GET', url: 'https://example.test/' });
    expect(res.status).toBe(503);
  });

  it('sends a text body as it is', async () => {
    const fetchMock = vi.fn(async () => new Response(''));
    vi.stubGlobal('fetch', fetchMock);
    await createFetchHttpClient()({ method: 'POST', url: 'https://example.test/', body: 'a=1' });
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe('a=1');
  });

  it('sends a form with a text field and a file part', async () => {
    const fetchMock = vi.fn(async () => new Response(''));
    vi.stubGlobal('fetch', fetchMock);
    await createFetchHttpClient()({
      method: 'POST',
      url: 'https://example.test/',
      body: {
        form: [
          { name: 'request-json', value: '{"a":1}' },
          {
            name: 'file',
            fileName: 'm31.jpg',
            type: 'image/jpeg',
            bytes: new Uint8Array([1, 2, 3]),
          },
        ],
      },
    });
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('request-json')).toBe('{"a":1}');
    const file = form.get('file') as File;
    expect(file.name).toBe('m31.jpg');
    expect(file.type).toBe('image/jpeg');
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it('aborts the request when the timeout passes', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(
      createFetchHttpClient()({ method: 'GET', url: 'https://example.test/', timeoutMs: 5 }),
    ).rejects.toThrow('aborted');
  });

  it('lets a network failure through with its own message', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNRESET');
    });
    await expect(
      createFetchHttpClient()({ method: 'GET', url: 'https://example.test/' }),
    ).rejects.toThrow('ECONNRESET');
  });
});
