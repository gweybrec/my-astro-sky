// @vitest-environment node
/**
 * Regression test for the SPA catch-all / swagger ordering bug.
 *
 * Root cause: the server registered swagger routes inside an async function.
 * Without the /api guard, the synchronously-registered SPA catch-all intercepted
 * /api/docs before the async swagger routes were appended to the router stack,
 * serving index.html instead of the Swagger UI.
 *
 * The fix has two layers:
 *   1. startServer() awaits swagger setup before registering the catch-all (ordering fix).
 *   2. The /api guard on the catch-all (belt-and-suspenders against future ordering regressions).
 *
 * This test exercises layer 2 directly: the catch-all is intentionally registered *before*
 * the /api route to simulate the worst-case ordering, and the guard must still let it through.
 */

import express from 'express';
import http from 'http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('SPA catch-all /api guard', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    const app = express();

    // Catch-all registered first — intentionally worst-case ordering (mirrors the old async-IIFE bug).
    // The /api guard is what makes /api routes reachable in this scenario.
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/api')) { next(); return; }
      res.status(200).send('spa');
    });

    // /api/docs registered AFTER the catch-all — simulates swagger appended by an async function.
    app.get('/api/docs', (_req, res) => res.status(200).json({ swagger: true }));

    await new Promise<void>(resolve => {
      server = http.createServer(app);
      server.listen(0, resolve);
    });
    const addr = server.address() as { port: number };
    base = `http://localhost:${addr.port}`;
  });

  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  it('reaches /api/docs even when it is registered after the catch-all', async () => {
    const res = await fetch(`${base}/api/docs`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swagger: true });
  });

  it('serves the SPA for non-API paths', async () => {
    const res = await fetch(`${base}/gallery`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('spa');
  });

  it('does not serve the SPA for unmatched /api paths', async () => {
    const res = await fetch(`${base}/api/unknown`);
    // No route matches → Express default 404, not the SPA index.html
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toBe('spa');
  });
});
