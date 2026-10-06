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
import sharp from 'sharp';
import { vi } from 'vitest';
import type { FileSource } from '@myastrosky/core/backend';
import type {
  ContractFixtures,
  ContractNetworkAnswer,
  ContractSetup,
} from '@myastrosky/core/testing/backend-contract';
import { createHttpBackend, type UploadFn } from '@myastrosky/backend-http/http-backend';
import { buildFits } from '../fixtures/fits-builders';

const FIXTURES = path.join(__dirname, '../fixtures');
const read = (file: string) => fs.readFileSync(path.join(FIXTURES, file), 'utf8');

/** A file as the contract wants it: bytes in memory, no browser `File`. */
function fileSource(name: string, bytes: Uint8Array): FileSource {
  return { name, size: bytes.length, read: async () => bytes };
}

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

// A 40x30 mono FITS whose solution (0.1 degree per pixel) covers a field of the real star catalogue.
const FITS_CARDS = [
  'CRPIX1  = 20.5',
  'CRPIX2  = 15.5',
  'CRVAL1  = 330.21217',
  'CRVAL2  = 73.08178',
  'CD1_1   = -0.1',
  'CD1_2   = 0',
  'CD2_1   = 0',
  'CD2_2   = 0.1',
  "DATE-OBS= '2025-09-04T21:30:00'",
  'EXPTIME = 300',
  'STACKCNT= 12',
  "FILTER  = 'Ha'",
];

export interface RunningApp extends ContractSetup {
  close(): Promise<void>;
  /** Empties every table the contract fills (the default point-of-interest categories stay) and the upload folder. */
  reset(): Promise<void>;
}

/** The answers the fake network gives, by site; `undefined` (reset) means the recorded file. */
type Answers = Partial<Record<'skybot' | 'tns' | 'comets' | 'version', ContractNetworkAnswer>>;

const realFetch = globalThis.fetch;

// The server and the backend share this process: anything that is not a test server is "the internet".
const recorded = {
  skybot: read('skybot/ngc4438-conesearch.json'),
  tns: read('tns/ngc7331-search.csv'),
  comets: read('comets/CometEls-sample.txt'),
  version: JSON.stringify({
    tag_name: 'v9.9.9',
    html_url: 'https://example.invalid/release/v9.9.9',
    published_at: '2026-01-02T03:04:05Z',
  }),
};
let answers: Answers = {};
let running = 0;

const siteOf = (url: string): keyof Answers | undefined => {
  if (url.includes('skybot')) return 'skybot';
  if (url.includes('wis-tns.org')) return 'tns';
  if (url.includes('CometEls')) return 'comets';
  if (url.includes('api.github.com')) return 'version';
  return undefined;
};

const fakeInternet = async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input as string, init);
  const site = siteOf(url);
  if (!site) throw new Error(`the contract tests may not reach ${url}`);
  const answer = answers[site] ?? { status: 200, body: recorded[site] };
  return new Response(answer.body, { status: answer.status, headers: answer.headers });
};

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

  if (running++ === 0) vi.stubGlobal('fetch', fakeInternet);

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

  const jpeg = new Uint8Array(
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#203060' } })
      .jpeg()
      .toBuffer(),
  );
  const fits = new Uint8Array(
    buildFits({
      bitpix: -32,
      naxis1: 40,
      naxis2: 30,
      roworder: 'TOP-DOWN',
      pixels: Array.from({ length: 40 * 30 }, (_, i) => (i % 7) / 7),
      extraCards: FITS_CARDS,
    }),
  );

  const fixtures: ContractFixtures = {
    jpeg: () => fileSource('contract.jpg', jpeg),
    fits: () => fileSource('contract.fits', fits),
    text: () => fileSource('contract.txt', new TextEncoder().encode('not a picture')),
    async lastExport() {
      await Promise.all(pending);
      const last = saved[saved.length - 1];
      return last ? fileSource(last.name, last.bytes) : undefined;
    },
    network: {
      answer(site, answer) {
        answers = { ...answers, [site]: answer };
      },
    },
  };

  const call = async (method: string, url: string) => {
    await realFetch(base + url, { method });
  };

  return {
    backend,
    fixtures,
    async reset() {
      rateLimits.clear(); // the API limit is 300 requests per minute per address
      answers = {};
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
      if (--running === 0) vi.stubGlobal('fetch', realFetch);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      closeDatabase();
      fs.rmSync(uploadsDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
      if (savedApiKey !== undefined) process.env.ASTROMETRY_API_KEY = savedApiKey;
    },
  };
}
