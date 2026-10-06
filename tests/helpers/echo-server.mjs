/**
 * A small echo server for the HTTP client conformance suite (`packages/core/src/testing/http-client-conformance.ts`).
 * It answers JSON describing what it received:
 *   any path                -> { method, url, headers, body } (text body), or for a multipart form
 *                              { method, url, headers, parts: [{ name, fileName, type, size, sha256 }] }
 *   /status/<n>             -> that status, body "status <n>"
 *   /slow?ms=<n>            -> answers after n milliseconds
 *   /bytes?n=<n>            -> n bytes: byte i is i % 251
 * Header names are lower-case (as Node gives them). Run it by hand for the phone:
 *   node tests/helpers/echo-server.mjs [port] [host]
 * `startEchoServer(port, host)` is also exported for the Node wrapper of the suite (port 0 = any free port).
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) return null;
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
  const parts = [];
  let pos = body.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const next = body.indexOf(boundary, start);
    if (next === -1) break;
    // The part is between the line break after the boundary and the one before the next boundary.
    const part = body.subarray(start + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, split).toString('utf8');
    const content = part.subarray(split + 4);
    const name = /name="([^"]*)"/i.exec(head)?.[1] ?? null;
    const fileName = /filename="([^"]*)"/i.exec(head)?.[1] ?? null;
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() ?? null;
    parts.push({
      name,
      fileName,
      type,
      size: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      ...(fileName === null ? { value: content.toString('utf8') } : {}),
    });
    pos = next;
  }
  return parts;
}

export function startEchoServer(port = 0, host = '127.0.0.1') {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://echo.local');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const json = (status, value) => {
        res.writeHead(status, { 'content-type': 'application/json', 'x-echo': 'yes' });
        res.end(JSON.stringify(value));
      };
      const status = /^\/status\/(\d{3})$/.exec(url.pathname);
      if (status) {
        res.writeHead(Number(status[1]), { 'content-type': 'text/plain', 'x-echo': 'yes' });
        res.end(`status ${status[1]}`);
        return;
      }
      if (url.pathname === '/slow') {
        setTimeout(() => json(200, { slow: true }), Number(url.searchParams.get('ms') ?? 0));
        return;
      }
      if (url.pathname === '/bytes') {
        const n = Number(url.searchParams.get('n') ?? 0);
        const out = Buffer.alloc(n);
        for (let i = 0; i < n; i++) out[i] = i % 251;
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-echo': 'yes' });
        res.end(out);
        return;
      }
      const contentType = req.headers['content-type'] ?? '';
      const reply = { method: req.method, url: req.url, headers: req.headers };
      if (/^multipart\/form-data/i.test(contentType)) {
        json(200, { ...reply, parts: parseMultipart(body, contentType) });
      } else {
        json(200, { ...reply, body: body.toString('utf8') });
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const { port: actual } = server.address();
      resolve({
        url: `http://${host}:${actual}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.argv[2] ?? 8787);
  const host = process.argv[3] ?? '0.0.0.0';
  const { url } = await startEchoServer(port, host);
  console.log(`Echo server listening on ${url}`);
}
