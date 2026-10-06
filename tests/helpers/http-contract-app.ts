/**
 * Builds the real Express application on a temporary database and upload folder, listening on a free
 * port of 127.0.0.1, and returns the HTTP backend that talks to it plus the fixtures the backend
 * contract needs. The sites the server reaches out to (SkyBoT, TNS, the MPC, GitHub) are answered from
 * recorded files: `globalThis.fetch` is the interception point, and calls to the test server itself pass through.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { vi } from 'vitest';
import type { ContractSetup } from '@myastrosky/core/testing/backend-contract';
import { createHttpBackend, type UploadFn } from '@myastrosky/backend-http/http-backend';
import {
  buildFixtures,
  fileSource,
  installFakeInternet,
  releaseFakeInternet,
  resetFakeInternet,
} from './contract-shared';

const realFetch = globalThis.fetch;

/** The upload of the two calls with progress, with `fetch` (there is no `XMLHttpRequest` in Node). */
const fetchUpload = (realFetch: typeof fetch): UploadFn => {
  return async ({ url, form, onProgress, cancel }) => {
    if (cancel?.aborted) throw new DOMException('Aborted', 'AbortError');
    const controller = new AbortController();
    cancel?.addEventListener('abort', () => controller.abort());
    const res = await realFetch(url, { method: 'POST', body: form, signal: controller.signal });
    onProgress?.(1);
    return { status: res.status, statusText: res.statusText, text: await res.text() };
  };
};

export interface RunningApp extends ContractSetup {
  close(): Promise<void>;
  /** Empties every table the contract fills (the default point-of-interest categories stay) and the upload folder. */
  reset(): Promise<void>;
}

export async function startHttpApp(): Promise<RunningApp> {
  vi.resetModules();
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myastrosky-contract-'));
  vi.stubEnv('DB_PATH', ':memory:');
  vi.stubEnv('UPLOADS_DIR', uploadsDir);
  vi.stubEnv('ENABLE_SWAGGER', 'false');
  const savedApiKey = process.env.ASTROMETRY_API_KEY;
  delete process.env.ASTROMETRY_API_KEY;

  const mod = await import('../../server/app.js');
  const app = await mod.createApp();
  const closeDatabase = (await import('../../server/db.js')).closeDatabase;
  const rateLimits = (await import('../../server/routes/shared.js')).rateLimits;
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  installFakeInternet();

  const saved: { name: string; bytes: Uint8Array }[] = [];
  const backend = createHttpBackend({
    baseUrl: base,
    fetch: realFetch,
    lang: () => 'en',
    saveFile: (name, blob) => {
      // The blob's bytes arrive asynchronously; `lastExport` waits for them.
      pending.push(
        blob.arrayBuffer().then((buffer) => {
          saved.push({ name, bytes: new Uint8Array(buffer) });
        }),
      );
    },
    upload: fetchUpload(realFetch),
  });
  const pending: Promise<void>[] = [];

  const fixtures = await buildFixtures(async () => {
    await Promise.all(pending);
    const last = saved[saved.length - 1];
    return last ? fileSource(last.name, last.bytes) : undefined;
  });

  const call = async (method: string, url: string) => {
    await realFetch(base + url, { method });
  };

  return {
    backend,
    fixtures,
    async reset() {
      rateLimits.clear(); // the API limit is 300 requests per minute per address
      resetFakeInternet();
      saved.length = 0;
      await call('DELETE', '/api/photo-metadata');
      await call('DELETE', '/api/custom-gear');
      await call('DELETE', '/api/gear-setups');
      await call('DELETE', '/api/dso-overrides');
      const regions = (await (await realFetch(`${base}/api/sky-regions`)).json()) as {
        id: string;
      }[];
      for (const r of regions) await call('DELETE', `/api/sky-regions/${r.id}`);
      const plans = (await (await realFetch(`${base}/api/plans`)).json()) as { id: string }[];
      for (const p of plans) await call('DELETE', `/api/plans/${p.id}`);
    },
    async close() {
      releaseFakeInternet();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      closeDatabase();
      fs.rmSync(uploadsDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
      if (savedApiKey !== undefined) process.env.ASTROMETRY_API_KEY = savedApiKey;
    },
  };
}
