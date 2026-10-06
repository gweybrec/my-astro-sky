// @vitest-environment node
/**
 * Pins what the Express routes do today (WP2.0a). It is the safety net for splitting
 * server/app.ts into route files: Part 1 checks the route table, Part 2 records the
 * behaviour of the routes that do not reach the network, a solver or the real disk.
 *
 * Responses that look odd are recorded as they are, not judged.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import sharp from 'sharp';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// ─── Route table helper ──────────────────────────────────────────────────────

/**
 * Lists every registered route as "METHOD /path", walking nested routers. Express 5 keeps
 * no record of the path a router was mounted on, so a nested router's routes are listed
 * relative to its mount point: mount routers at the root (the route files will do that).
 */
function listRoutes(target: any): string[] {
  const stack: any[] = target?.router?.stack ?? target?.stack ?? [];
  const out: string[] = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        out.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
    } else if (layer.handle?.stack) {
      out.push(...listRoutes(layer.handle));
    }
  }
  return out;
}

const EXPECTED_API_ROUTES = [
  'POST /api/photos',
  'GET /api/version/latest',
  'GET /api/config',
  'GET /api/settings',
  'PUT /api/settings',
  'DELETE /api/settings/astrometry-api-key',
  'GET /api/horizon',
  'POST /api/settings/probe-astap',
  'POST /api/settings/probe-solve-field',
  'POST /api/settings/probe-data-dir',
  'GET /api/photos',
  'PATCH /api/photos/order',
  'GET /api/dso-overrides',
  'PUT /api/dso-overrides/:id',
  'DELETE /api/dso-overrides/:id',
  'DELETE /api/dso-overrides',
  'GET /api/telescopes',
  'GET /api/cameras',
  'GET /api/accessories',
  'GET /api/filters',
  'POST /api/custom-gear',
  'DELETE /api/custom-gear/:id',
  'DELETE /api/custom-gear',
  'GET /api/gear-setups',
  'POST /api/gear-setups',
  'PUT /api/gear-setups/:id',
  'PATCH /api/gear-setups/:id/enabled',
  'DELETE /api/gear-setups/:id',
  'DELETE /api/gear-setups',
  'GET /api/poi-categories',
  'POST /api/poi-categories',
  'PATCH /api/poi-categories/:id',
  'DELETE /api/poi-categories/:id',
  'DELETE /api/poi-categories',
  'GET /api/sky-regions',
  'POST /api/sky-regions',
  'PATCH /api/sky-regions/:id',
  'DELETE /api/sky-regions/:id',
  'GET /api/plans',
  'POST /api/plans',
  'PUT /api/plans/order',
  'PUT /api/plans/:id',
  'DELETE /api/plans/:id',
  'POST /api/plans/:id/entries',
  'PUT /api/plans/:id/entries/order',
  'DELETE /api/plans/:id/entries/:entryId',
  'PATCH /api/plans/:id/entries/:entryId',
  'POST /api/plans/:id/mosaics',
  'PUT /api/plans/:id/mosaics/:mosaicId',
  'DELETE /api/plans/:id/mosaics/:mosaicId',
  'POST /api/export',
  'POST /api/import/preview',
  'POST /api/import',
  'DELETE /api/photos/:id',
  'DELETE /api/photos',
  'DELETE /api/photo-metadata',
  'PATCH /api/photos/:id/manual-placement',
  'PATCH /api/photos/:id/metadata',
  'POST /api/solve-wcs',
  'POST /api/photos/convert',
  'POST /api/solve-astap',
  'GET /api/solve-astap/:jobId',
  'DELETE /api/solve-astap/:jobId',
  'POST /api/solve-field',
  'GET /api/solve-field/:jobId',
  'DELETE /api/solve-field/:jobId',
  'POST /api/solve-plate',
  'GET /api/solve-plate/:id',
  'GET /api/astrometry/submissions',
  'POST /api/astrometry/reuse',
  'POST /api/skybot/conesearch',
  'POST /api/tns/conesearch',
  'GET /api/comets/elements',
  'GET /api/stars/search',
  'GET /api/stars/nearby',
  'GET /api/stars/:hip',
];

// ─── Test server ─────────────────────────────────────────────────────────────

let app: express.Express;
let server: Server;
let base: string;
let uploadsDir: string;
let closeDatabase: () => void;
let savedApiKeyEnv: string | undefined;

interface Reply {
  status: number;
  body: any;
}

async function call(method: string, url: string, body?: unknown): Promise<Reply> {
  const init: RequestInit = { method };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + url, init);
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON (e.g. Express's default HTML 404) */
  }
  return { status: res.status, body: parsed };
}

beforeAll(async () => {
  vi.resetModules();
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myastrosky-app-test-'));
  vi.stubEnv('DB_PATH', ':memory:');
  vi.stubEnv('UPLOADS_DIR', uploadsDir);
  vi.stubEnv('ENABLE_SWAGGER', 'false');
  // The settings routes answer 409 when the key is pinned by the environment.
  savedApiKeyEnv = process.env.ASTROMETRY_API_KEY;
  delete process.env.ASTROMETRY_API_KEY;

  const mod = await import('../../server/app.js');
  app = await mod.createApp();
  closeDatabase = (await import('../../server/db.js')).closeDatabase;
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase?.();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  if (savedApiKeyEnv !== undefined) process.env.ASTROMETRY_API_KEY = savedApiKeyEnv;
});

// ─── Part 1: route table ─────────────────────────────────────────────────────

describe('route table', () => {
  it('lists the routes of a synthetic app, walking a nested router', () => {
    const synthetic = express();
    const nested = express.Router();
    nested.get('/api/inner', (_req, res) => res.end());
    nested.post('/api/inner/:id', (_req, res) => res.end());
    synthetic.get('/api/outer', (_req, res) => res.end());
    synthetic.use(nested);
    synthetic.delete('/api/last', (_req, res) => res.end());
    expect(listRoutes(synthetic)).toEqual([
      'GET /api/outer',
      'GET /api/inner',
      'POST /api/inner/:id',
      'DELETE /api/last',
    ]);
  });

  it('registers exactly the 76 documented /api routes', () => {
    const all = listRoutes(app);
    const api = all.filter((r) => r.split(' ')[1].startsWith('/api/'));
    expect(EXPECTED_API_ROUTES).toHaveLength(76);
    expect([...api].sort()).toEqual([...EXPECTED_API_ROUTES].sort());
  });

  it('keeps the fixed paths ahead of the parameterised ones', () => {
    const all = listRoutes(app);
    expect(all.indexOf('PUT /api/plans/order')).toBeGreaterThanOrEqual(0);
    expect(all.indexOf('PUT /api/plans/order')).toBeLessThan(all.indexOf('PUT /api/plans/:id'));
    const hip = all.indexOf('GET /api/stars/:hip');
    expect(all.indexOf('GET /api/stars/search')).toBeGreaterThanOrEqual(0);
    expect(all.indexOf('GET /api/stars/search')).toBeLessThan(hip);
    expect(all.indexOf('GET /api/stars/nearby')).toBeGreaterThanOrEqual(0);
    expect(all.indexOf('GET /api/stars/nearby')).toBeLessThan(hip);
  });
});

// ─── Part 2: behaviour ───────────────────────────────────────────────────────

describe('lists on an empty database', () => {
  it.each(['/api/photos', '/api/plans', '/api/gear-setups', '/api/sky-regions'])(
    'GET %s returns an empty array',
    async (url) => {
      const r = await call('GET', url);
      expect(r.status).toBe(200);
      expect(r.body).toEqual([]);
    },
  );

  it('GET /api/poi-categories returns the 5 seeded defaults', async () => {
    const r = await call('GET', '/api/poi-categories');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([
      { id: 'cat-comet', name: 'Comet', color: '#4ea1ff', position: 0 },
      { id: 'cat-asteroid', name: 'Asteroid', color: '#c9a227', position: 1 },
      { id: 'cat-satellite', name: 'Satellite', color: '#7bd88f', position: 2 },
      { id: 'cat-iss', name: 'ISS', color: '#cbd5e1', position: 3 },
      { id: 'cat-supernova', name: 'Supernova', color: '#ff5a5a', position: 4 },
    ]);
  });

  it('GET /api/dso-overrides returns an empty object (not an array)', async () => {
    const r = await call('GET', '/api/dso-overrides');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({});
  });

  it('GET /api/settings returns the editable settings with empty defaults', async () => {
    const r = await call('GET', '/api/settings');
    expect(r.status).toBe(200);
    expect(typeof r.body.isWindows).toBe('boolean');
    expect({ ...r.body, isWindows: undefined }).toEqual({
      apiKeySet: false,
      isWindows: undefined,
      ASTAP_PATH: '',
      SOLVE_FIELD_PATH: '',
      ASTROMETRY_DATA_DIR: '',
      MAX_PARALLEL_SOLVES: '',
      USE_WSL_FOR_SOLVE_FIELD: false,
      USE_WSL_FOR_ASTAP: false,
    });
  });

  it('GET /api/config points at the star catalog file', async () => {
    const r = await call('GET', '/api/config');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ starCatalog: '/data/stars.14.json' });
  });

  it.each(['/api/telescopes', '/api/cameras', '/api/accessories', '/api/filters'])(
    'GET %s returns the built-in catalog',
    async (url) => {
      const r = await call('GET', url);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
      expect(r.body.length).toBeGreaterThan(0);
      for (const item of r.body) expect(typeof item.id).toBe('string');
    },
  );
});

describe('stars', () => {
  let sirius: any;

  it('GET /api/stars/search finds a bright star by name', async () => {
    const r = await call('GET', '/api/stars/search?q=sirius');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    sirius = r.body[0];
    expect(sirius).toMatchObject({
      hip: 32349,
      name: 'Sirius',
      bayer: 'α',
      constellation: 'CMa',
      label: 'Sirius (α CMa)',
    });
    expect(Object.keys(sirius).sort()).toEqual(
      [
        'bayer',
        'bv',
        'constellation',
        'dec',
        'desig',
        'flam',
        'hip',
        'label',
        'mag',
        'multiplicity',
        'name',
        'ra',
        'score',
      ].sort(),
    );
  });

  it('GET /api/stars/search without q returns an empty array', async () => {
    const r = await call('GET', '/api/stars/search');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it('GET /api/stars/nearby returns the stars around a position', async () => {
    const r = await call(
      'GET',
      `/api/stars/nearby?ra=${sirius.ra}&dec=${sirius.dec}&radius=2&magLimit=5&limit=5`,
    );
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.map((s: any) => s.hip)).toContain(32349);
  });

  it('GET /api/stars/:hip returns one star, without label and score', async () => {
    const r = await call('GET', '/api/stars/32349');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      hip: 32349,
      name: 'Sirius',
      ra: 101.2872,
      dec: -16.7161,
    });
    expect(r.body).not.toHaveProperty('label');
    expect(r.body).not.toHaveProperty('score');
  });

  it('GET /api/stars/:hip rejects a non-numeric HIP and an unknown star', async () => {
    const bad = await call('GET', '/api/stars/abc');
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'HIP invalide', code: 'INVALID_HIP' });
    const none = await call('GET', '/api/stars/99999999');
    expect(none.status).toBe(404);
    expect(none.body).toEqual({
      error: 'Étoile introuvable',
      code: 'STAR_NOT_FOUND',
    });
  });
});

const OK = { status: 200, body: { ok: true } };

describe('plans', () => {
  it('runs a full round trip', async () => {
    const created = await call('POST', '/api/plans', { name: '  Night 1  ' });
    expect(created.status).toBe(200);
    expect(Object.keys(created.body)).toEqual(['id']);
    const planId: string = created.body.id;
    expect(planId).toMatch(/^plan-/);

    let list = await call('GET', '/api/plans');
    expect(list.body).toEqual([
      {
        id: planId,
        name: 'Night 1',
        position: 0,
        nightOf: null,
        setupId: null,
        lat: null,
        lon: null,
        sortBy: 'transit',
        entries: [],
        mosaics: [],
      },
    ]);

    expect(await call('PUT', `/api/plans/${planId}`, { name: 'Night one' })).toEqual(OK);
    expect(
      await call('PUT', `/api/plans/${planId}`, {
        nightOf: '2026-10-04',
        lat: 48.5,
        lon: 2.25,
        sortBy: 'name',
      }),
    ).toEqual(OK);

    const e1 = await call('POST', `/api/plans/${planId}/entries`, {
      dsoId: 'M31',
    });
    expect(e1.status).toBe(200);
    expect(e1.body.id).toMatch(/^pe-/);
    const e2 = await call('POST', `/api/plans/${planId}/entries`, {
      ra: 10.5,
      dec: -20.25,
    });
    expect(e2.status).toBe(200);
    const dup = await call('POST', `/api/plans/${planId}/entries`, {
      dsoId: 'M31',
    });
    expect(dup).toEqual({
      status: 409,
      body: { error: 'Target already in plan', code: 'DUPLICATE_ENTRY' },
    });

    expect(
      await call('PUT', `/api/plans/${planId}/entries/order`, {
        ids: [e2.body.id, e1.body.id],
      }),
    ).toEqual(OK);
    expect(
      await call('PATCH', `/api/plans/${planId}/entries/${e1.body.id}`, {
        paDeg: 45,
        observationWindows: [],
      }),
    ).toEqual(OK);

    list = await call('GET', '/api/plans');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      name: 'Night one',
      nightOf: '2026-10-04',
      lat: 48.5,
      lon: 2.25,
      sortBy: 'name',
    });
    expect(list.body[0].entries.map((e: any) => e.id)).toEqual([e2.body.id, e1.body.id]);
    expect(list.body[0].entries[0]).toEqual({
      id: e2.body.id,
      dsoId: null,
      position: 0,
      paDeg: null,
      ra: 10.5,
      dec: -20.25,
      notes: null,
      mosaicId: null,
      mosaicWDeg: null,
      mosaicHDeg: null,
      observationWindows: [],
    });
    expect(list.body[0].entries[1]).toMatchObject({
      id: e1.body.id,
      dsoId: 'M31',
      paDeg: 45,
    });

    // Mosaic: create, see its tiles as entries, update, delete.
    const mosaicBody = {
      name: 'Pair',
      centerRa: 11,
      centerDec: -21,
      paDeg: 10,
      tiles: [
        { ra: 10.9, dec: -21 },
        { ra: 11.1, dec: -21, paDeg: 5 },
      ],
    };
    const mosaic = await call('POST', `/api/plans/${planId}/mosaics`, mosaicBody);
    expect(mosaic.status).toBe(200);
    expect(mosaic.body.id).toMatch(/^mo-/);
    list = await call('GET', '/api/plans');
    expect(list.body[0].mosaics).toEqual([
      {
        id: mosaic.body.id,
        dsoId: null,
        name: 'Pair',
        centerRa: 11,
        centerDec: -21,
        paDeg: 10,
        overlapPct: 20,
        cols: 2,
        rows: 1,
        position: 0,
      },
    ]);
    const tileEntries = list.body[0].entries.filter((e: any) => e.mosaicId === mosaic.body.id);
    expect(tileEntries).toHaveLength(2);
    expect(list.body[0].entries).toHaveLength(4);

    expect(
      await call('PUT', `/api/plans/${planId}/mosaics/${mosaic.body.id}`, {
        ...mosaicBody,
        name: 'Pair v2',
        overlapPct: 150,
      }),
    ).toEqual(OK);
    list = await call('GET', '/api/plans');
    expect(list.body[0].mosaics[0]).toMatchObject({
      name: 'Pair v2',
      overlapPct: 90,
    });

    expect(await call('DELETE', `/api/plans/${planId}/mosaics/${mosaic.body.id}`)).toEqual(OK);
    list = await call('GET', '/api/plans');
    expect(list.body[0].mosaics).toEqual([]);
    expect(list.body[0].entries.map((e: any) => e.id)).toEqual([e2.body.id, e1.body.id]);

    expect(await call('DELETE', `/api/plans/${planId}/entries/${e1.body.id}`)).toEqual(OK);

    const second = await call('POST', '/api/plans', { name: 'Night 2' });
    expect(await call('PUT', '/api/plans/order', { ids: [second.body.id, planId] })).toEqual(OK);
    list = await call('GET', '/api/plans');
    expect(list.body.map((p: any) => p.id)).toEqual([second.body.id, planId]);
    expect(list.body.map((p: any) => p.position)).toEqual([0, 1]);

    expect(await call('DELETE', `/api/plans/${planId}`)).toEqual(OK);
    expect(await call('DELETE', `/api/plans/${second.body.id}`)).toEqual(OK);
    expect((await call('GET', '/api/plans')).body).toEqual([]);
  });

  it('rejects bad requests', async () => {
    expect(await call('POST', '/api/plans', {})).toEqual({
      status: 400,
      body: { error: 'name is required', code: 'PLAN_NAME_REQUIRED' },
    });
    expect(await call('PUT', '/api/plans/nope', { name: 'x' })).toEqual({
      status: 404,
      body: { error: 'Plan not found', code: 'PLAN_NOT_FOUND' },
    });
    expect(await call('PUT', '/api/plans/nope', {})).toEqual({
      status: 400,
      body: {
        error: 'name, settings (nightOf/setupId/lat/lon), or sortBy required',
        code: 'PLAN_UPDATE_EMPTY',
      },
    });
    expect(await call('PUT', '/api/plans/order', { ids: 'x' })).toEqual({
      status: 400,
      body: { error: 'ids must be an array', code: 'PLAN_IDS_NOT_ARRAY' },
    });
    expect(await call('POST', '/api/plans/nope/entries', { dsoId: 'M1' })).toEqual({
      status: 404,
      body: { error: 'Plan not found', code: 'PLAN_NOT_FOUND' },
    });
    expect(await call('DELETE', '/api/plans/nope')).toEqual({
      status: 404,
      body: { error: 'Plan not found', code: 'PLAN_NOT_FOUND' },
    });
  });
});

describe('gear setups', () => {
  it('runs a full round trip', async () => {
    const created = await call('POST', '/api/gear-setups', {
      name: ' Rig A ',
      telescopeId: 'askar-130phq',
      cameraId: 'atik-314l-plus',
    });
    expect(created.status).toBe(200);
    expect(created.body.id).toMatch(/^setup-/);
    const id: string = created.body.id;

    let list = await call('GET', '/api/gear-setups');
    expect(list.body).toEqual([
      {
        id,
        name: 'Rig A',
        telescopeId: 'askar-130phq',
        cameraId: 'atik-314l-plus',
        accessoryId: null,
        enabled: true,
      },
    ]);

    expect(
      await call('PUT', `/api/gear-setups/${id}`, {
        name: 'Rig B',
        telescopeId: 'askar-130phq',
        cameraId: 'atik-314l-plus',
        accessoryId: 'askar-130phq-reducer',
      }),
    ).toEqual(OK);
    expect(await call('PATCH', `/api/gear-setups/${id}/enabled`, { enabled: false })).toEqual(OK);

    list = await call('GET', '/api/gear-setups');
    expect(list.body).toEqual([
      {
        id,
        name: 'Rig B',
        telescopeId: 'askar-130phq',
        cameraId: 'atik-314l-plus',
        accessoryId: 'askar-130phq-reducer',
        enabled: false,
      },
    ]);

    expect(await call('DELETE', `/api/gear-setups/${id}`)).toEqual(OK);
    expect((await call('GET', '/api/gear-setups')).body).toEqual([]);
  });

  it('rejects bad requests', async () => {
    expect(await call('POST', '/api/gear-setups', {})).toEqual({
      status: 400,
      body: { error: 'name is required', code: 'MISSING_NAME' },
    });
    expect(await call('POST', '/api/gear-setups', { name: 'x' })).toEqual({
      status: 400,
      body: { error: 'telescopeId is required', code: 'MISSING_TELESCOPE' },
    });
    expect(await call('PUT', '/api/gear-setups/nope', { name: 'x' })).toEqual({
      status: 400,
      body: {
        error: 'name, telescopeId, and cameraId are required',
        code: 'SETUP_FIELDS_REQUIRED',
      },
    });
    expect(await call('PATCH', '/api/gear-setups/nope/enabled', { enabled: 'yes' })).toEqual({
      status: 400,
      body: { error: 'enabled must be boolean', code: 'SETUP_ENABLED_NOT_BOOLEAN' },
    });
    expect(await call('PATCH', '/api/gear-setups/nope/enabled', { enabled: true })).toEqual({
      status: 404,
      body: { error: 'Setup not found', code: 'SETUP_NOT_FOUND' },
    });
    expect(await call('DELETE', '/api/gear-setups/nope')).toEqual({
      status: 404,
      body: { error: 'Setup not found', code: 'SETUP_NOT_FOUND' },
    });
  });
});

describe('custom gear', () => {
  it('runs a full round trip', async () => {
    const created = await call('POST', '/api/custom-gear', {
      type: 'telescope',
      data: { brand: 'Zed', model: 'Test 100' },
    });
    expect(created.status).toBe(200);
    expect(created.body.id).toMatch(/^custom-/);
    const id: string = created.body.id;

    const telescopes = await call('GET', '/api/telescopes');
    expect(telescopes.body.find((t: any) => t.id === id)).toEqual({
      brand: 'Zed',
      model: 'Test 100',
      id,
    });
    const cameras = await call('GET', '/api/cameras');
    expect(cameras.body.find((c: any) => c.id === id)).toBeUndefined();

    expect(await call('DELETE', `/api/custom-gear/${id}`)).toEqual(OK);
    const after = await call('GET', '/api/telescopes');
    expect(after.body.find((t: any) => t.id === id)).toBeUndefined();
  });

  it('rejects bad requests', async () => {
    expect(await call('POST', '/api/custom-gear', { type: 'mount', data: {} })).toEqual({
      status: 400,
      body: {
        error: 'Invalid type — must be telescope, camera, accessory, or filter',
        code: 'INVALID_GEAR_TYPE',
      },
    });
    expect(await call('POST', '/api/custom-gear', { type: 'camera', data: [] })).toEqual({
      status: 400,
      body: { error: 'Invalid data — must be a non-null object', code: 'INVALID_GEAR_DATA' },
    });
    expect(await call('DELETE', '/api/custom-gear/askar-130phq')).toEqual({
      status: 400,
      body: { error: 'Only custom gear items can be deleted', code: 'GEAR_NOT_CUSTOM' },
    });
    expect(await call('DELETE', '/api/custom-gear/custom-missing')).toEqual({
      status: 404,
      body: { error: 'Not found', code: 'GEAR_NOT_FOUND' },
    });
  });
});

describe('POI categories', () => {
  it('runs a full round trip', async () => {
    const created = await call('POST', '/api/poi-categories', {
      name: ' Meteor ',
    });
    expect(created.status).toBe(200);
    expect(created.body.id).toMatch(/^cat-/);
    const id: string = created.body.id;

    let list = await call('GET', '/api/poi-categories');
    expect(list.body).toHaveLength(6);
    expect(list.body[5]).toEqual({
      id,
      name: 'Meteor',
      color: '#888888',
      position: 5,
    });

    expect(
      await call('PATCH', `/api/poi-categories/${id}`, {
        name: 'Meteor shower',
        color: '#112233',
      }),
    ).toEqual(OK);
    list = await call('GET', '/api/poi-categories');
    expect(list.body.find((c: any) => c.id === id)).toEqual({
      id,
      name: 'Meteor shower',
      color: '#112233',
      position: 5,
    });

    expect(await call('DELETE', `/api/poi-categories/${id}`)).toEqual(OK);
    expect((await call('GET', '/api/poi-categories')).body).toHaveLength(5);
  });

  it('rejects bad requests', async () => {
    expect(await call('POST', '/api/poi-categories', {})).toEqual({
      status: 400,
      body: { error: 'name is required', code: 'MISSING_NAME' },
    });
    expect(await call('PATCH', '/api/poi-categories/nope', { name: 'x' })).toEqual({
      status: 404,
      body: { error: 'Category not found', code: 'CATEGORY_NOT_FOUND' },
    });
    expect(await call('DELETE', '/api/poi-categories/nope')).toEqual({
      status: 404,
      body: { error: 'Category not found', code: 'CATEGORY_NOT_FOUND' },
    });
  });
});

describe('sky regions', () => {
  const points = [
    { azDeg: 0, altDeg: 10 },
    { azDeg: 90, altDeg: 10 },
    { azDeg: 45, altDeg: 40 },
  ];

  it('runs a full round trip', async () => {
    const created = await call('POST', '/api/sky-regions', {
      name: ' Trees ',
      points,
    });
    expect(created.status).toBe(200);
    expect(created.body.id).toMatch(/^region-/);
    const id: string = created.body.id;

    let list = await call('GET', '/api/sky-regions');
    expect(list.body).toEqual([{ id, name: 'Trees', color: '#4ea1ff', points, position: 0 }]);

    expect(
      await call('PATCH', `/api/sky-regions/${id}`, {
        name: 'Roof',
        color: '#ff0000',
      }),
    ).toEqual(OK);
    list = await call('GET', '/api/sky-regions');
    expect(list.body).toEqual([{ id, name: 'Roof', color: '#ff0000', points, position: 0 }]);

    expect(await call('DELETE', `/api/sky-regions/${id}`)).toEqual(OK);
    expect((await call('GET', '/api/sky-regions')).body).toEqual([]);
  });

  it('rejects bad requests', async () => {
    expect(await call('POST', '/api/sky-regions', { points })).toEqual({
      status: 400,
      body: { error: 'name is required', code: 'MISSING_NAME' },
    });
    expect(
      await call('POST', '/api/sky-regions', {
        name: 'x',
        points: points.slice(0, 2),
      }),
    ).toEqual({
      status: 400,
      body: {
        error: 'points must have at least 3 {azDeg,altDeg} vertices',
        code: 'INVALID_REGION_POINTS',
      },
    });
    expect(await call('PATCH', '/api/sky-regions/nope', { name: 'x' })).toEqual({
      status: 404,
      body: { error: 'Region not found', code: 'REGION_NOT_FOUND' },
    });
    expect(await call('DELETE', '/api/sky-regions/nope')).toEqual({
      status: 404,
      body: { error: 'Region not found', code: 'REGION_NOT_FOUND' },
    });
  });
});

describe('DSO overrides', () => {
  it('runs a full round trip', async () => {
    expect(await call('PUT', '/api/dso-overrides/M31', { name: 'Andromeda (mine)' })).toEqual(OK);
    expect((await call('GET', '/api/dso-overrides')).body).toEqual({
      M31: { name: 'Andromeda (mine)' },
    });

    expect(await call('DELETE', '/api/dso-overrides/M31')).toEqual(OK);
    expect((await call('GET', '/api/dso-overrides')).body).toEqual({});
  });

  it('rejects bad requests', async () => {
    expect(await call('PUT', '/api/dso-overrides/M31', [])).toEqual({
      status: 400,
      body: { error: 'Invalid override data', code: 'INVALID_DSO_DATA' },
    });
    expect(await call('PUT', `/api/dso-overrides/${'x'.repeat(101)}`, { name: 'x' })).toEqual({
      status: 400,
      body: { error: 'Invalid DSO id', code: 'INVALID_DSO_ID' },
    });
  });
});

describe('settings', () => {
  it('runs a full round trip', async () => {
    expect(
      await call('PUT', '/api/settings', {
        ASTAP_PATH: '  /opt/astap  ',
        USE_WSL_FOR_ASTAP: true,
        apiKey: 'secret-key',
      }),
    ).toEqual(OK);

    let read = await call('GET', '/api/settings');
    expect(read.body).toMatchObject({
      apiKeySet: true,
      ASTAP_PATH: '/opt/astap',
      USE_WSL_FOR_ASTAP: true,
      USE_WSL_FOR_SOLVE_FIELD: false,
    });
    // The key itself is never returned.
    expect(JSON.stringify(read.body)).not.toContain('secret-key');

    expect(await call('DELETE', '/api/settings/astrometry-api-key')).toEqual(OK);
    read = await call('GET', '/api/settings');
    expect(read.body.apiKeySet).toBe(false);
    expect(read.body.ASTAP_PATH).toBe('/opt/astap');

    await call('PUT', '/api/settings', {
      ASTAP_PATH: '',
      USE_WSL_FOR_ASTAP: false,
    });
  });

  it('answers 409 when the API key is pinned by the environment', async () => {
    process.env.ASTROMETRY_API_KEY = 'from-env';
    try {
      const expected = {
        status: 409,
        body: {
          error:
            'ASTROMETRY_API_KEY is managed via environment variable and cannot be changed here',
          code: 'SETTING_LOCKED_BY_ENV',
          key: 'ASTROMETRY_API_KEY',
        },
      };
      expect(await call('PUT', '/api/settings', { apiKey: 'x' })).toEqual(expected);
      expect(await call('DELETE', '/api/settings/astrometry-api-key')).toEqual(expected);
    } finally {
      delete process.env.ASTROMETRY_API_KEY;
    }
  });
});

describe('photos', () => {
  async function makePhotoForm(): Promise<FormData> {
    const png = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'test.png');
    form.append(
      'correspondences',
      JSON.stringify([
        {
          pointIndex: 0,
          photoX: 5,
          photoY: 5,
          starHip: 32349,
          starName: 'Sirius',
        },
        { pointIndex: 1, photoX: 20, photoY: 15, starHip: 27989 },
      ]),
    );
    return form;
  }

  it('runs a full round trip', async () => {
    const up = await call('POST', '/api/photos', await makePhotoForm());
    expect(up.status).toBe(200);
    const id: string = up.body.id;
    expect(up.body).toMatchObject({
      filename: `${id}.png`,
      originalName: 'test.png',
      width: 32,
      height: 24,
      dsoIds: [],
      labels: [],
      notes: '',
      integrations: [],
      pointsOfInterest: [],
      captureDetails: {},
      observationDate: null,
      gearSetupId: null,
      thumbFilename: `${id}_thumb.jpg`,
      correspondences: [
        {
          pointIndex: 0,
          photoX: 5,
          photoY: 5,
          starHip: 32349,
          starName: 'Sirius',
        },
        { pointIndex: 1, photoX: 20, photoY: 15, starHip: 27989, starName: '' },
      ],
    });
    expect(up.body).not.toHaveProperty('fileSize');
    expect(fs.existsSync(path.join(uploadsDir, `${id}.png`))).toBe(true);
    expect(fs.existsSync(path.join(uploadsDir, `${id}_thumb.jpg`))).toBe(true);

    const list = await call('GET', '/api/photos');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id, filename: `${id}.png` });
    expect(list.body[0].fileSize).toBe(fs.statSync(path.join(uploadsDir, `${id}.png`)).size);

    expect(
      await call('PATCH', `/api/photos/${id}/metadata`, {
        dsoIds: ['M31'],
        labels: ['wide'],
        notes: 'hello',
        originalName: 'renamed.png',
      }),
    ).toEqual({ status: 200, body: { ok: true, originalName: 'renamed.png' } });

    const placement = {
      projPerPx: 0.001,
      centerX: 0.1,
      centerY: 0.2,
      rotation: 15,
    };
    expect(
      await call('PATCH', `/api/photos/${id}/manual-placement`, {
        manualPlacement: placement,
      }),
    ).toEqual(OK);

    const after = await call('GET', '/api/photos');
    expect(after.body[0]).toMatchObject({
      id,
      originalName: 'renamed.png',
      dsoIds: ['M31'],
      labels: ['wide'],
      notes: 'hello',
      manualPlacement: placement,
    });

    expect(await call('PATCH', '/api/photos/order', { photoIds: [id] })).toEqual(OK);

    expect(await call('DELETE', `/api/photos/${id}`)).toEqual(OK);
    expect(fs.existsSync(path.join(uploadsDir, `${id}.png`))).toBe(false);
    expect(fs.existsSync(path.join(uploadsDir, `${id}_thumb.jpg`))).toBe(false);
    expect((await call('GET', '/api/photos')).body).toEqual([]);
  });

  it('rejects bad requests', async () => {
    const noFile = new FormData();
    noFile.append('correspondences', '[]');
    expect(await call('POST', '/api/photos', noFile)).toEqual({
      status: 400,
      body: { error: 'Aucun fichier fourni', code: 'NO_FILE' },
    });

    const noCorr = await makePhotoForm();
    noCorr.delete('correspondences');
    expect(await call('POST', '/api/photos', noCorr)).toEqual({
      status: 400,
      body: {
        error: 'Correspondances manquantes',
        code: 'MISSING_CORRESPONDENCES',
      },
    });

    expect(await call('PATCH', '/api/photos/order', { photoIds: 'x' })).toEqual({
      status: 400,
      body: {
        error: 'photoIds must be a non-empty array of strings',
        code: 'INVALID_PHOTO_ORDER',
      },
    });
    expect(await call('PATCH', '/api/photos/nope/metadata', {})).toEqual({
      status: 404,
      body: { error: 'Photo introuvable', code: 'PHOTO_NOT_FOUND' },
    });
    expect(await call('PATCH', '/api/photos/nope/manual-placement', {})).toEqual({
      status: 404,
      body: { error: 'Photo introuvable', code: 'PHOTO_NOT_FOUND' },
    });
    expect(await call('DELETE', '/api/photos/nope')).toEqual({
      status: 404,
      body: { error: 'Photo introuvable', code: 'PHOTO_NOT_FOUND' },
    });
  });
});

describe('unknown paths', () => {
  it('answers the Express default 404 (HTML, not JSON) for an unknown /api path', async () => {
    const get = await call('GET', '/api/nothing-here');
    expect(get.status).toBe(404);
    expect(get.body).toContain('Cannot GET /api/nothing-here');
    const post = await call('POST', '/api/nothing-here', {});
    expect(post.status).toBe(404);
    expect(post.body).toContain('Cannot POST /api/nothing-here');
  });

  it('answers a malformed JSON body through the JSON error handler', async () => {
    const res = await fetch(`${base}/api/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(Object.keys(await res.json())).toEqual(['error']);
  });
});
