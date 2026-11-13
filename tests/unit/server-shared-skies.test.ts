// @vitest-environment node
/**
 * The shared-sky routes of the server, over HTTP on a real app: the package is downloaded once under its token, an
 * uploaded package lives in a file until its ticket is done with, and a visit shows in none of the photo routes.
 * What both backends must do is in the backend contract; the service's rules are in `shared-sky-service.test.ts`.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DomainError } from '@myastrosky/core/domain/errors';
import { createSharedSkyImports } from '../../server/shared-sky-imports';

interface Instance {
  base: string;
  uploadsDir: string;
  call: (method: string, url: string, body?: unknown) => Promise<{ status: number; body: any }>;
  stop: () => Promise<void>;
}

const tempDirs: string[] = [];
let instance: Instance;

async function startInstance(): Promise<Instance> {
  vi.resetModules();
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myastrosky-share-test-'));
  tempDirs.push(uploadsDir);
  vi.stubEnv('DB_PATH', ':memory:');
  vi.stubEnv('UPLOADS_DIR', uploadsDir);
  vi.stubEnv('ENABLE_SWAGGER', 'false');

  const mod = await import('../../server/app.js');
  const app = await mod.createApp();
  const closeDatabase = (await import('../../server/db.js')).closeDatabase;
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    uploadsDir,
    async call(method, url, body) {
      const init: RequestInit = { method };
      if (body instanceof FormData) init.body = body;
      else if (body !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(body);
      }
      const res = await fetch(base + url, init);
      const text = await res.text();
      let parsed: any = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return { status: res.status, body: parsed };
    },
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      closeDatabase();
    },
  };
}

const incoming = () => fs.readdirSync(path.join(instance.uploadsDir, '.incoming'));
const photoFiles = () => fs.readdirSync(instance.uploadsDir).filter((n) => n !== '.incoming');

function bundleForm(bytes: Uint8Array, name = 'Paul.myastrosky'): FormData {
  const form = new FormData();
  form.append('bundle', new Blob([bytes as BlobPart]), name);
  return form;
}

/** Downloads the package of a share of every photo under `senderName`. */
async function downloadPackage(senderName: string): Promise<{ name: string; bytes: Uint8Array }> {
  const prepared = await instance.call('POST', '/api/shared-skies/export', { senderName });
  expect(prepared.status).toBe(200);
  const res = await fetch(`${instance.base}/api/shared-skies/export/${prepared.body.token}`);
  expect(res.status).toBe(200);
  return {
    name: prepared.body.fileName,
    bytes: new Uint8Array(await res.arrayBuffer()),
  };
}

async function waitForEnd(ticket: string): Promise<any> {
  for (let i = 0; i < 200; i++) {
    const { body } = await instance.call('GET', `/api/shared-skies/open/${ticket}`);
    if (body.state !== 'ready' && body.state !== 'running') return body;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the import did not end');
}

beforeAll(async () => {
  instance = await startInstance();
  const png = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'M42.png');
  form.append(
    'correspondences',
    JSON.stringify([
      { pointIndex: 0, photoX: 5, photoY: 5, starHip: 32349, starName: 'Sirius' },
      { pointIndex: 1, photoX: 20, photoY: 15, starHip: 27989 },
    ]),
  );
  expect((await instance.call('POST', '/api/photos', form)).status).toBe(200);
}, 30_000);

afterAll(async () => {
  await instance.stop();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('sharing a sky', () => {
  it('prepares a package, which is downloaded once under its token and its own file name', async () => {
    const prepared = await instance.call('POST', '/api/shared-skies/export', {
      senderName: 'Zoé & Paul',
    });
    expect(prepared.body.fileName).toBe('Zoé & Paul.myastrosky');
    const url = `${instance.base}/api/shared-skies/export/${prepared.body.token}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="Zo_ & Paul.myastrosky"; filename*=UTF-8''Zo%C3%A9%20%26%20Paul.myastrosky`,
    );
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect((await fetch(url)).status).toBe(404);
    expect((await instance.call('GET', '/api/shared-skies/sender')).body).toEqual({
      senderName: 'Zoé & Paul',
    });
  });

  it('refuses a share without a name or without a photo before giving a token', async () => {
    expect((await instance.call('POST', '/api/shared-skies/export', {})).body).toMatchObject({
      code: 'SHARED_SKY_NAME_REQUIRED',
    });
    const none = await instance.call('POST', '/api/shared-skies/export', {
      senderName: 'Paul',
      ids: ['no-such-photo'],
    });
    expect(none.status).toBe(400);
    expect(none.body.code).toBe('SHARED_SKY_NOTHING_TO_SHARE');
  });
});

describe('opening a shared sky', () => {
  it('keeps the uploaded package in a file until it is opened, then removes it', async () => {
    const pkg = await downloadPackage('Paul');
    const inspected = await instance.call(
      'POST',
      '/api/shared-skies/inspect',
      bundleForm(pkg.bytes),
    );
    expect(inspected.status).toBe(200);
    expect(inspected.body.preview).toMatchObject({
      senderName: 'Paul',
      photoCount: 1,
      status: 'new',
    });
    expect(typeof inspected.body.preview.freeBytes).toBe('number');
    expect(incoming()).toHaveLength(1);
    const filesBefore = photoFiles();

    const ticket = inspected.body.ticket;
    expect((await instance.call('GET', `/api/shared-skies/open/${ticket}`)).body.state).toBe(
      'ready',
    );
    expect((await instance.call('POST', `/api/shared-skies/open/${ticket}`)).status).toBe(202);
    const ended = await waitForEnd(ticket);
    expect(ended).toMatchObject({ state: 'done', done: 1, total: 1, sky: { senderName: 'Paul' } });
    expect(incoming()).toEqual([]);
    // The visit's picture and thumbnail, beside the user's own files.
    expect(photoFiles()).toHaveLength(filesBefore.length + 2);

    // The result stays readable until the client lets go of the ticket.
    expect((await instance.call('GET', `/api/shared-skies/open/${ticket}`)).body.state).toBe(
      'done',
    );
    expect((await instance.call('DELETE', `/api/shared-skies/open/${ticket}`)).status).toBe(200);
    const gone = await instance.call('GET', `/api/shared-skies/open/${ticket}`);
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe('SHARED_SKY_TICKET_EXPIRED');

    // The visit shows in its own routes only.
    const skies = (await instance.call('GET', '/api/shared-skies')).body;
    expect(skies).toHaveLength(1);
    const photos = (await instance.call('GET', `/api/shared-skies/${skies[0].id}/photos`)).body;
    expect(photos).toMatchObject([
      { originalName: 'M42.png', sharedSkyId: skies[0].id, author: 'Paul' },
    ]);
    const mine = (await instance.call('GET', '/api/photos')).body;
    expect(mine).toHaveLength(1);
    expect(mine[0].id).not.toBe(photos[0].id);
    expect((await instance.call('DELETE', `/api/photos/${photos[0].id}`)).status).toBe(404);
    // A visit's picture is served like any stored picture.
    expect((await fetch(`${instance.base}/uploads/${photos[0].filename}`)).status).toBe(200);

    // A visit cannot be renamed: it shows its sender's name.
    expect((await instance.call('PATCH', `/api/shared-skies/${skies[0].id}`, {})).status).toBe(404);
    const removed = await instance.call('DELETE', `/api/shared-skies/${skies[0].id}`);
    expect(removed.body.bytesFreed).toBeGreaterThan(0);
    expect(photoFiles().sort()).toEqual(filesBefore.sort());
    expect((await instance.call('DELETE', `/api/shared-skies/${skies[0].id}`)).status).toBe(404);
  });

  it('removes the uploaded file of a package that is discarded without being opened', async () => {
    const pkg = await downloadPackage('Paul');
    const { body } = await instance.call(
      'POST',
      '/api/shared-skies/inspect',
      bundleForm(pkg.bytes),
    );
    expect(incoming()).toHaveLength(1);
    await instance.call('DELETE', `/api/shared-skies/open/${body.ticket}`);
    expect(incoming()).toEqual([]);
    expect((await instance.call('GET', '/api/shared-skies')).body).toEqual([]);
    expect((await instance.call('POST', `/api/shared-skies/open/${body.ticket}`)).status).toBe(404);
  });

  it('removes at once the uploaded file of what is not a shared sky', async () => {
    const notZip = await instance.call(
      'POST',
      '/api/shared-skies/inspect',
      bundleForm(new TextEncoder().encode('not a zip')),
    );
    expect(notZip.status).toBe(400);
    expect(notZip.body.code).toBe('NOT_A_SHARED_SKY');

    const backup = await fetch(`${instance.base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: { includeImages: true, includeMetadata: true } }),
    });
    const refused = await instance.call(
      'POST',
      '/api/shared-skies/inspect',
      bundleForm(new Uint8Array(await backup.arrayBuffer()), 'backup.zip'),
    );
    expect(refused.body.code).toBe('NOT_A_SHARED_SKY');
    expect((await instance.call('POST', '/api/shared-skies/inspect')).status).toBe(400);
    expect(incoming()).toEqual([]);
  });
});

describe('createSharedSkyImports', () => {
  const preview = {
    skyId: 'sky-12345678',
    senderName: 'Paul',
    sharedAt: '2026-03-01T10:00:00.000Z',
    photoCount: 3,
    bytes: 10,
    status: 'new' as const,
    freeBytes: null,
  };

  /** A real (tiny) ZIP on disk, so that it can be opened; the service under it is a fake. */
  async function uploadedFile(): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myastrosky-share-imports-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'upload.part');
    // An empty archive: the end record alone.
    const end = new Uint8Array(22);
    new DataView(end.buffer).setUint32(0, 0x06054b50, true);
    fs.writeFileSync(file, end);
    return file;
  }

  it('cancels a running import when it is discarded, and removes the file once it has stopped', async () => {
    const file = await uploadedFile();
    let sawCancel = false;
    const imports = createSharedSkyImports({
      newId: () => 'ticket-1',
      service: {
        inspect: async () => preview,
        open: async (_reader, options) => {
          options?.onProgress?.(1, 3);
          while (!options?.cancel?.aborted) await new Promise((r) => setTimeout(r, 5));
          sawCancel = true;
          throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
        },
      },
    });
    const { ticket } = await imports.inspect(file);
    imports.start(ticket);
    await new Promise((r) => setTimeout(r, 10));
    expect(imports.status(ticket)).toMatchObject({ state: 'running', done: 1, total: 3 });
    // Starting twice starts one import.
    imports.start(ticket);
    await imports.discard(ticket);
    expect(sawCancel).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(() => imports.status(ticket)).toThrow(/opened again/);
    await expect(imports.discard(ticket)).resolves.toBeUndefined();
  });

  it('reports a failed import with its code, and removes the file', async () => {
    const file = await uploadedFile();
    const imports = createSharedSkyImports({
      newId: () => 'ticket-2',
      service: {
        inspect: async () => preview,
        open: async () => {
          throw new DomainError('invalid', 'Not enough free space', { code: 'NOT_ENOUGH_SPACE' });
        },
      },
    });
    const { ticket } = await imports.inspect(file);
    imports.start(ticket);
    await vi.waitFor(() => expect(imports.status(ticket).state).toBe('failed'));
    expect(imports.status(ticket).error).toEqual({
      kind: 'invalid',
      code: 'NOT_ENOUGH_SPACE',
      message: 'Not enough free space',
    });
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(false));
  });

  it('drops a ticket nobody came back for, with its file', async () => {
    const file = await uploadedFile();
    const imports = createSharedSkyImports({
      newId: () => 'ticket-3',
      ttlMs: 20,
      service: { inspect: async () => preview, open: async () => ({}) as never },
    });
    const { ticket } = await imports.inspect(file);
    expect(imports.status(ticket).state).toBe('ready');
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(false));
    expect(() => imports.status(ticket)).toThrow(/opened again/);
  });
});
