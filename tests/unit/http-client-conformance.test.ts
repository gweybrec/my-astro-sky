// @vitest-environment node
/**
 * The `HttpClient` conformance suite against the echo server (`tests/helpers/echo-server.mjs`), started
 * on port 0 of 127.0.0.1: on the server's adapter and on the phone's, with Node's `fetch` standing in for the
 * patched one.
 */
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFetchHttpClient as createPhoneHttpClient } from '@myastrosky/backend-local/fetch-http-client';
import type { HttpClient } from '@myastrosky/core/ports/http-client';
import { httpClientConformanceCases } from '@myastrosky/core/testing/http-client-conformance';
import { createFetchHttpClient as createServerHttpClient } from '../../server/http-client';
// @ts-expect-error -- plain .mjs helper without type declarations
import { startEchoServer } from '../helpers/echo-server.mjs';

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  crypto.createHash('sha256').update(bytes).digest('hex');

let echo: { url: string; close(): Promise<void> };

beforeAll(async () => {
  echo = await startEchoServer(0, '127.0.0.1');
});
afterAll(async () => {
  await echo.close();
});

const clients: [string, () => HttpClient][] = [
  ['server adapter', () => createServerHttpClient()],
  ['phone adapter (Node fetch)', () => createPhoneHttpClient({ fetch: globalThis.fetch })],
];

describe.each(clients)('HttpClient conformance: %s', (_name, make) => {
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
