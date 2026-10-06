// @vitest-environment node
/**
 * What the HTTP backend does that the contract suite cannot see from outside: the requests it makes,
 * how it turns a failed response or a lost connection into a `DomainError`, and how it sends a file.
 * A recording `fetch` stands in for the server.
 */
import { describe, it, expect, afterEach } from 'vitest';
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

/** A small stand-in for the browser's `XMLHttpRequest`: the test drives what the request sees. */
class FakeXhr {
  static last: FakeXhr | undefined;
  upload: {
    onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;
  } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  status = 0;
  statusText = '';
  responseText = '';
  opened?: [string, string];
  sent?: unknown;
  aborted = false;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.opened = [method, url];
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  reply(status: number, text: string, statusText = '') {
    this.status = status;
    this.statusText = statusText;
    this.responseText = text;
    this.onload?.();
  }
}

/** A cancel signal that records its listeners. */
function makeCancel() {
  const listeners = new Set<() => void>();
  return {
    listeners,
    aborted: false,
    addEventListener: (_type: 'abort', l: () => void) => void listeners.add(l),
    removeEventListener: (_type: 'abort', l: () => void) => void listeners.delete(l),
    fire() {
      this.aborted = true;
      for (const l of [...listeners]) l();
    },
  };
}

describe('the default upload (XMLHttpRequest)', () => {
  const real = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  afterEach(() => {
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = real;
  });

  function start(cancel = makeCancel()) {
    FakeXhr.last = undefined;
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
    const backend = createHttpBackend({
      baseUrl: 'http://app',
      lang: () => 'en',
      saveFile: () => {},
    });
    const progress: number[] = [];
    const promise = backend.photos.upload(
      { name: 'a.jpg', size: 1, read: async () => new Uint8Array([1]) },
      { correspondences: '[]' },
      { onProgress: (f) => progress.push(f), cancel },
    );
    return { promise, progress, cancel };
  }

  /** The request is only created once the form is built, a few microtasks after the call. */
  const request = async () => {
    for (let i = 0; i < 10 && !FakeXhr.last?.sent; i++) await Promise.resolve();
    return FakeXhr.last!;
  };

  it('reports the fractions sent, and resolves with the stored photo', async () => {
    const { promise, progress } = start();
    const xhr = await request();
    expect(xhr.opened).toEqual(['POST', 'http://app/api/photos']);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 50, total: 0 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    xhr.reply(201, JSON.stringify({ id: 'p1' }));
    expect(await promise).toEqual({ id: 'p1' });
    expect(progress).toEqual([0.25, 1]);
  });

  it('rejects with AbortError on a cancel during the upload, and removes its listener', async () => {
    const { promise, cancel } = start();
    const xhr = await request();
    expect(cancel.listeners.size).toBe(1);
    cancel.fire();
    expect(xhr.aborted).toBe(true);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel.listeners.size).toBe(0);
  });

  it('rejects with NETWORK_ERROR when the request cannot be made', async () => {
    const { promise, cancel } = start();
    const xhr = await request();
    xhr.onerror?.();
    const e = await rejection(promise);
    expect([e.kind, e.code]).toEqual(['upstream', 'NETWORK_ERROR']);
    expect(cancel.listeners.size).toBe(0);
  });

  it('gives the code of a 400 answer', async () => {
    const { promise } = start();
    const xhr = await request();
    xhr.reply(400, JSON.stringify({ error: 'bad', code: 'INVALID_IMAGE' }), 'Bad Request');
    const e = await rejection(promise);
    expect([e.kind, e.code, e.message]).toEqual(['invalid', 'INVALID_IMAGE', 'bad']);
  });

  it('does not start when it is already cancelled', async () => {
    const cancel = makeCancel();
    cancel.aborted = true;
    const { promise } = start(cancel);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
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
