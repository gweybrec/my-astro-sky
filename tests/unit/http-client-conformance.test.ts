// @vitest-environment node
/**
 * The `HttpClient` conformance suite against the echo server (`spikes/mobile/scripts/echo-server.mjs`), started
 * on port 0 of 127.0.0.1: on the server's adapter and on the phone's, with Node's `fetch` standing in for the
 * patched one. `spikes/` is not tracked: without that file the suite is skipped.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFetchHttpClient as createPhoneHttpClient } from '@myastrosky/backend-local/fetch-http-client';
import type { HttpClient } from '@myastrosky/core/ports/http-client';
import { httpClientConformanceCases } from '@myastrosky/core/testing/http-client-conformance';
import { createFetchHttpClient as createServerHttpClient } from '../../server/http-client';

const ECHO = path.resolve(__dirname, '../../spikes/mobile/scripts/echo-server.mjs');
const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  crypto.createHash('sha256').update(bytes).digest('hex');

const available = fs.existsSync(ECHO);
let echo: { url: string; close(): Promise<void> };

beforeAll(async () => {
  if (!available) return;
  const mod = (await import(pathToFileURL(ECHO).href)) as {
    startEchoServer(port: number, host: string): Promise<typeof echo>;
  };
  echo = await mod.startEchoServer(0, '127.0.0.1');
});
afterAll(async () => {
  if (available) await echo.close();
});

const clients: [string, () => HttpClient][] = [
  ['server adapter', () => createServerHttpClient()],
  ['phone adapter (Node fetch)', () => createPhoneHttpClient({ fetch: globalThis.fetch })],
];

describe.skipIf(!available).each(clients)('HttpClient conformance: %s', (_name, make) => {
  for (const c of httpClientConformanceCases(sha256Hex)) {
    it(c.name, () => c.run(make(), echo.url));
  }
});

describe('phone HttpClient timeout', () => {
  it('rejects at the timeout even when fetch ignores the abort', async () => {
    const never = () => new Promise<never>(() => undefined);
    const client = createPhoneHttpClient({ fetch: never });
    const started = Date.now();
    await expect(
      client({ method: 'GET', url: 'http://x.invalid/', timeoutMs: 50 }),
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
