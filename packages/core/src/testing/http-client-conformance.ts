/**
 * The contract every `HttpClient` adapter must meet, as plain data (cases that throw on failure), run against
 * an address that answers like `tests/helpers/echo-server.mjs`: it returns as JSON the method, the
 * headers (lower-case names) and the text body, and for a multipart form each part's name, file name, type,
 * size and SHA-256; `/status/<n>`; `/slow?ms=<n>`; `/bytes?n=<n>` (byte i is i % 251).
 */
import type { HttpClient } from '../ports/http-client';
import { bytesEqual, ok, patternBytes, rejects, toBe } from './conformance-assert';

export interface HttpClientConformanceCase {
  name: string;
  run(client: HttpClient, baseUrl: string): Promise<void>;
}

interface EchoPart {
  name: string | null;
  fileName: string | null;
  type: string | null;
  size: number;
  sha256: string;
  value?: string;
}
interface Echo {
  method: string;
  headers: Record<string, string>;
  body?: string;
  parts?: EchoPart[];
}

/** The SHA-256 of some bytes as lower-case hex (the host has `crypto.subtle`; core has no such global). */
export type Sha256Hex = (bytes: Uint8Array) => Promise<string>;

export const httpClientConformanceCases = (sha256Hex: Sha256Hex): HttpClientConformanceCase[] => [
  {
    name: 'GET: method, custom headers sent, status 200 and a JSON body',
    async run(client, base) {
      const res = await client({
        method: 'GET',
        url: `${base}/echo`,
        headers: { 'X-Test': 'hello', 'User-Agent': 'MyAstroSky-test' },
      });
      toBe(res.status, 200, 'status');
      const echo = JSON.parse(await res.text()) as Echo;
      toBe(echo.method, 'GET', 'method');
      toBe(echo.headers['x-test'], 'hello', 'x-test header');
    },
  },
  {
    name: 'response header names are lower-case',
    async run(client, base) {
      const res = await client({ method: 'GET', url: `${base}/echo` });
      toBe(res.headers['x-echo'], 'yes', 'x-echo');
      ok(res.headers['content-type']?.includes('application/json'), 'content-type');
      for (const key of Object.keys(res.headers)) toBe(key, key.toLowerCase(), 'header name');
    },
  },
  {
    name: 'POST with a text body: the body arrives as it is (UTF-8)',
    async run(client, base) {
      const res = await client({
        method: 'POST',
        url: `${base}/echo`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'a=1&b=h%C3%A9llo&c=éè',
      });
      const echo = JSON.parse(await res.text()) as Echo;
      toBe(echo.method, 'POST', 'method');
      toBe(echo.body, 'a=1&b=h%C3%A9llo&c=éè', 'body');
    },
  },
  {
    name: 'POST with a form: text fields and a file with its name, type, size and checksum',
    async run(client, base) {
      const file = patternBytes(70_000, 5);
      const res = await client({
        method: 'POST',
        url: `${base}/upload`,
        body: {
          form: [
            { name: 'request-json', value: '{"session":"abc"}' },
            { name: 'file', fileName: 'photo.jpg', type: 'image/jpeg', bytes: file },
          ],
        },
      });
      toBe(res.status, 200, 'status');
      const echo = JSON.parse(await res.text()) as Echo;
      ok(
        /^multipart\/form-data; ?boundary=/i.test(echo.headers['content-type'] ?? ''),
        'multipart',
      );
      const parts = echo.parts ?? [];
      toBe(parts.length, 2, 'part count');
      toBe(parts[0].name, 'request-json', 'first part name');
      toBe(parts[0].fileName, null, 'first part is not a file');
      toBe(parts[0].value, '{"session":"abc"}', 'first part value');
      toBe(parts[1].name, 'file', 'file part name');
      toBe(parts[1].fileName, 'photo.jpg', 'file name');
      toBe(parts[1].type, 'image/jpeg', 'file type');
      toBe(parts[1].size, 70_000, 'file size');
      toBe(parts[1].sha256, await sha256Hex(file), 'file checksum');
    },
  },
  {
    name: 'an error status (503, 404) resolves with that status and does not reject',
    async run(client, base) {
      const a = await client({ method: 'GET', url: `${base}/status/503` });
      toBe(a.status, 503, 'status 503');
      toBe(await a.text(), 'status 503', 'body of 503');
      const b = await client({ method: 'GET', url: `${base}/status/404` });
      toBe(b.status, 404, 'status 404');
    },
  },
  {
    name: 'bytes(): a binary body comes back byte for byte, and text() and bytes() can both be read',
    async run(client, base) {
      const n = 100_000;
      const res = await client({ method: 'GET', url: `${base}/bytes?n=${n}` });
      const expected = new Uint8Array(n);
      for (let i = 0; i < n; i++) expected[i] = i % 251;
      bytesEqual(await res.bytes(), expected, 'bytes');
      toBe((await res.text()).length > 0, true, 'text readable after bytes');
    },
  },
  {
    name: 'timeoutMs: a slow answer rejects after about the timeout, a quick one passes',
    async run(client, base) {
      const started = Date.now();
      await rejects(
        () => client({ method: 'GET', url: `${base}/slow?ms=2000`, timeoutMs: 150 }),
        'slow request',
      );
      const waited = Date.now() - started;
      ok(waited >= 100 && waited < 1500, `the rejection came after ${waited} ms`);
      const quick = await client({ method: 'GET', url: `${base}/slow?ms=0`, timeoutMs: 5000 });
      toBe(quick.status, 200, 'quick status');
    },
  },
  {
    name: 'an address that cannot be reached rejects',
    async run(client) {
      await rejects(
        () => client({ method: 'GET', url: 'http://127.0.0.1:1/', timeoutMs: 3000 }),
        'unreachable address',
      );
    },
  },
];
