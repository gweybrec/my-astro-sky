// @vitest-environment node
/**
 * What the HTTP backend does that the contract suite cannot see from outside: the requests it makes,
 * how it turns a failed response or a lost connection into a `DomainError`, and how it sends a file.
 * A recording `fetch` stands in for the server.
 */
import { describe, it, expect } from 'vitest';
import { createHttpBackend } from '@myastrosky/backend-http/http-backend';
import { DomainError } from '@myastrosky/core/domain/errors';
import type { FileSource } from '@myastrosky/core/backend';

interface Sent {
  url: string;
  method: string;
  body?: unknown;
}

const json = (body: unknown, status = 200, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status, ...init });

function makeBackend(reply: (url: string) => Response | Promise<Response> = () => json({})) {
  const sent: Sent[] = [];
  const saved: { name: string; blob: Blob }[] = [];
  const backend = createHttpBackend({
    baseUrl: 'http://app',
    fetch: (async (input: string, init?: RequestInit) => {
      sent.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body });
      return reply(String(input));
    }) as typeof fetch,
    lang: () => 'fr',
    saveFile: (name, blob) => saved.push({ name, blob }),
  });
  return { backend, sent, saved };
}

async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    return e as DomainError;
  }
  throw new Error('it resolved');
}

describe('failed responses', () => {
  it.each([
    [400, 'invalid'],
    [404, 'notFound'],
    [409, 'conflict'],
    [429, 'rateLimited'],
    [502, 'upstream'],
    [500, 'upstream'],
    [418, 'upstream'],
  ])('status %i becomes kind %s', async (status, kind) => {
    const { backend } = makeBackend(() => json({ error: 'boom', code: 'PLAN_NOT_FOUND' }, status));
    const e = await rejection(backend.plans.list());
    expect([e.kind, e.message, e.code]).toEqual([kind, 'boom', 'PLAN_NOT_FOUND']);
  });

  it('uses HTTP_<status> and the status text when the body has no code or message', async () => {
    const { backend } = makeBackend(
      () => new Response('<html>', { status: 413, statusText: 'Payload Too Large' }),
    );
    const e = await rejection(backend.plans.list());
    expect([e.kind, e.message, e.code]).toEqual(['upstream', 'Payload Too Large', 'HTTP_413']);
  });

  it('uses HTTP_ERROR for a status with no code of its own', async () => {
    const { backend } = makeBackend(() => new Response('', { status: 418 }));
    expect((await rejection(backend.plans.list())).code).toBe('HTTP_ERROR');
  });

  it('turns a lost connection into upstream NETWORK_ERROR', async () => {
    const backend = createHttpBackend({
      fetch: (() => Promise.reject(new TypeError('failed to fetch'))) as typeof fetch,
      lang: () => 'en',
      saveFile: () => {},
    });
    const e = await rejection(backend.plans.list());
    expect([e.kind, e.code]).toEqual(['upstream', 'NETWORK_ERROR']);
  });

  it('turns a success that is not JSON into an upstream error', async () => {
    const { backend } = makeBackend(() => new Response('not json', { status: 200 }));
    const e = await rejection(backend.plans.list());
    expect([e.kind, e.code]).toEqual(['upstream', 'HTTP_ERROR']);
  });

  it('names the TNS limit TNS_RATE_LIMITED, as the service does', async () => {
    const { backend } = makeBackend(() => json({ error: 'slow down', code: 'RATE_LIMITED' }, 429));
    const e = await rejection(
      backend.identify.searchTransients({
        raDeg: 1,
        decDeg: 2,
        radiusArcmin: 3,
        dateStart: '2025-01-01',
        dateEnd: '2025-02-01',
      }),
    );
    expect([e.kind, e.code]).toEqual(['rateLimited', 'TNS_RATE_LIMITED']);
  });
});

describe('requests', () => {
  it('addresses an entry by plan and entry, with a placeholder when the plan is not given', async () => {
    const { backend, sent } = makeBackend();
    await backend.plans.removeEntry('e/1', 'p 1');
    await backend.plans.updateEntry('e1', { paDeg: 3 });
    expect(sent.map((s) => [s.method, s.url])).toEqual([
      ['DELETE', 'http://app/api/plans/p%201/entries/e%2F1'],
      ['PATCH', 'http://app/api/plans/-/entries/e1'],
    ]);
  });

  it('unwraps the response wrappers', async () => {
    const answers: Record<string, unknown> = {
      '/api/astrometry/submissions': { submissions: [{ submissionId: 1 }] },
      '/api/comets/elements?lang=fr': { comets: [{ designation: '10P' }] },
      '/api/photos': { ok: true, deleted: 4 },
    };
    const { backend } = makeBackend((url) => json(answers[url.replace('http://app', '')]));
    expect(await backend.novaSolve.listSubmissions()).toEqual([{ submissionId: 1 }]);
    expect(await backend.identify.getCometElements()).toEqual([{ designation: '10P' }]);
    expect(await backend.photos.removeMany(['a'])).toBe(4);
  });

  it('sends the language with the routes that translate their messages', async () => {
    const { backend, sent } = makeBackend(() => json({ candidates: [] }));
    await backend.identify.searchAsteroids({ raDeg: 1, decDeg: 2, radiusArcmin: 3, epochJd: 4 });
    expect(JSON.parse(sent[0].body as string)).toEqual({
      raDeg: 1,
      decDeg: 2,
      radiusArcmin: 3,
      epochJd: 4,
      lang: 'fr',
    });
  });

  it('asks which star catalogue to load, and falls back to the default one', async () => {
    const ok = makeBackend(() => json({ starCatalog: '/data/stars.9.json' }));
    expect(await ok.backend.catalog.starCatalogUrl()).toBe('http://app/data/stars.9.json');
    const down = makeBackend(() => new Response('', { status: 500 }));
    expect(await down.backend.catalog.starCatalogUrl()).toBe('http://app/data/stars.14.json');
    expect(down.backend.files.url('a.jpg')).toBe('http://app/uploads/a.jpg');
  });

  it('reports whether a key was written, as the service does', async () => {
    const { backend } = makeBackend();
    expect(await backend.settings.update({ apiKey: '  ' })).toEqual({ apiKeyChanged: false });
    expect(await backend.settings.update({ apiKey: 'k' })).toEqual({ apiKeyChanged: true });
  });

  it('clears a manual placement with null', async () => {
    const { backend, sent } = makeBackend();
    await backend.photos.setManualPlacement('p', null);
    expect(JSON.parse(sent[0].body as string)).toEqual({ manualPlacement: null });
  });
});

describe('files', () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it('sends the browser file as it is, and never reads it', async () => {
    const native = new Blob([bytes], { type: 'image/png' });
    let reads = 0;
    const file: FileSource = {
      name: 'a.png',
      size: 3,
      native,
      read: async () => {
        reads++;
        return bytes;
      },
    };
    const { backend, sent } = makeBackend(() => json({ jobId: 'j1' }));
    expect(await backend.novaSolve.submit(file, { ra: 1.5 })).toBe('j1');
    const form = sent[0].body as FormData;
    expect(reads).toBe(0);
    expect((form.get('photo') as File).name).toBe('a.png');
    expect((form.get('photo') as File).type).toBe('image/png');
    expect(form.get('ra')).toBe('1.5');
    expect(form.has('dec')).toBe(false);
  });

  it('builds the file from its bytes, with the type its extension says', async () => {
    const file: FileSource = { name: 'x.JPG', size: 3, read: async () => bytes };
    const { backend, sent } = makeBackend(() => json({ jobId: 'j1' }));
    await backend.novaSolve.submit(file);
    const photo = (sent[0].body as FormData).get('photo') as File;
    expect([photo.name, photo.type, photo.size]).toEqual(['x.JPG', 'image/jpeg', 3]);
  });
});

describe('uploads with progress', () => {
  it('uses the upload option, passing the progress callback and the cancel signal', async () => {
    const seen: unknown[] = [];
    const backend = createHttpBackend({
      baseUrl: 'http://app',
      lang: () => 'en',
      saveFile: () => {},
      upload: async (request) => {
        seen.push(request.url, request.cancel);
        request.onProgress?.(0.5);
        return { status: 200, statusText: 'OK', text: JSON.stringify({ id: 'p1' }) };
      },
    });
    const progress: number[] = [];
    const cancel = { aborted: false, addEventListener() {}, removeEventListener() {} };
    const photo = await backend.photos.upload(
      { name: 'a.jpg', size: 1, read: async () => new Uint8Array([1]) },
      { correspondences: '[]' },
      { onProgress: (f) => progress.push(f), cancel },
    );
    expect(photo).toEqual({ id: 'p1' });
    expect(progress).toEqual([0.5]);
    expect(seen).toEqual(['http://app/api/photos', cancel]);
  });
});

describe('export', () => {
  it('hands the file to the user under the name the server gave it', async () => {
    const { backend, saved } = makeBackend(
      () =>
        new Response('zip', {
          headers: { 'Content-Disposition': 'attachment; filename="sky-export-1.zip"' },
        }),
    );
    await backend.backup.exportToUser({ ids: [] });
    expect(saved.map((s) => s.name)).toEqual(['sky-export-1.zip']);
    expect(await saved[0].blob.text()).toBe('zip');
  });

  it('falls back to a default name', async () => {
    const { backend, saved } = makeBackend(() => new Response('zip'));
    await backend.backup.exportToUser({});
    expect(saved.map((s) => s.name)).toEqual(['sky-export.zip']);
  });

  it('rejects with the error of a failed export, saving nothing', async () => {
    const { backend, saved } = makeBackend(() => json({ error: 'nope' }, 500));
    const e = await rejection(backend.backup.exportToUser({}));
    expect([e.kind, e.message, e.code]).toEqual(['upstream', 'nope', 'HTTP_500']);
    expect(saved).toEqual([]);
  });
});

describe('local solvers', () => {
  it('returns a failed solve instead of throwing, with what the response said', async () => {
    const body = { error: 'Bad format ', code: 'UNSUPPORTED_FORMAT' };
    const { backend } = makeBackend(
      () => new Response(JSON.stringify(body), { status: 400, statusText: 'Bad Request' }),
    );
    const result = await backend.localSolvers!.solve('astap', {
      name: 'a.gif',
      size: 1,
      read: async () => new Uint8Array([1]),
    });
    expect(result).toEqual({
      success: false,
      error: 'Bad format',
      code: 'UNSUPPORTED_FORMAT',
      errorDetails: {
        method: 'POST',
        endpoint: '/api/solve-astap',
        httpStatus: 400,
        httpStatusText: 'Bad Request',
        code: 'UNSUPPORTED_FORMAT',
        responseBody: JSON.stringify(body, null, 2),
      },
    });
  });

  it('probes with the body each probe expects', async () => {
    const { backend, sent } = makeBackend();
    await backend.localSolvers!.probe('astap', { path: '/a', useWSL: true });
    await backend.localSolvers!.probe('data-dir', { dir: '/d', useWSL: false });
    expect(sent.map((s) => [s.url, JSON.parse(s.body as string)])).toEqual([
      ['http://app/api/settings/probe-astap', { path: '/a', useWSL: true }],
      ['http://app/api/settings/probe-data-dir', { dir: '/d', useWSL: false }],
    ]);
  });
});
