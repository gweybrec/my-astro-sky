// @vitest-environment node
/**
 * Pins the branches of the plan and photo routes that server-app.test.ts leaves untested
 * (WP2.4b). It is the safety net for moving these two domains into services.
 *
 * Responses that look odd are recorded as they are, not judged; each one is marked
 * `KNOWN GAP`. Every case goes through the real app.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type express from 'express';
import sharp from 'sharp';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// ─── Harness (same as server-app.test.ts) ────────────────────────────────────

let app: express.Express;
let server: Server;
let base: string;
let uploadsDir: string;
let closeDatabase: () => void;
let rateLimits: Map<string, number[]>;
let savedApiKeyEnv: string | undefined;

interface Reply {
  status: number;
  body: any;
}

const OK: Reply = { status: 200, body: { ok: true } };

async function parse(res: Response): Promise<Reply> {
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed };
}

async function call(method: string, url: string, body?: unknown): Promise<Reply> {
  const init: RequestInit = { method };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return parse(await fetch(base + url, init));
}

/** Sends the text as the JSON body, unchanged (JSON.stringify cannot produce 1e999 or no body). */
async function callRaw(method: string, url: string, jsonText?: string): Promise<Reply> {
  const init: RequestInit = { method };
  if (jsonText !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = jsonText;
  }
  return parse(await fetch(base + url, init));
}

beforeAll(async () => {
  vi.resetModules();
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myastrosky-plans-photos-test-'));
  vi.stubEnv('DB_PATH', ':memory:');
  vi.stubEnv('UPLOADS_DIR', uploadsDir);
  vi.stubEnv('ENABLE_SWAGGER', 'false');
  savedApiKeyEnv = process.env.ASTROMETRY_API_KEY;
  delete process.env.ASTROMETRY_API_KEY;

  const mod = await import('../../server/app.js');
  app = await mod.createApp();
  closeDatabase = (await import('../../server/db.js')).closeDatabase;
  rateLimits = (await import('../../server/routes/shared.js')).rateLimits;
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

/** Every case starts from an empty database and an empty uploads folder. */
beforeEach(async () => {
  rateLimits.clear(); // the API limit is 300 requests per minute per address
  await call('DELETE', '/api/photo-metadata');
  for (const f of fs.readdirSync(uploadsDir)) fs.rmSync(path.join(uploadsDir, f), { force: true });
  const plans = await call('GET', '/api/plans');
  for (const p of plans.body) await call('DELETE', `/api/plans/${p.id}`);
});

// ─── Plan helpers ────────────────────────────────────────────────────────────

async function mkPlan(name = 'Night'): Promise<string> {
  const r = await call('POST', '/api/plans', { name });
  expect(r.status).toBe(200);
  return r.body.id;
}

async function readPlan(id: string): Promise<any> {
  const list = await call('GET', '/api/plans');
  return list.body.find((p: any) => p.id === id);
}

async function mkEntry(planId: string, body: object): Promise<string> {
  const r = await call('POST', `/api/plans/${planId}/entries`, body);
  expect(r.status).toBe(200);
  return r.body.id;
}

const MOSAIC_TILES = [
  { ra: 10, dec: 20 },
  { ra: 11, dec: 20 },
  { ra: 12, dec: 20 },
];

async function mkMosaic(planId: string, extra: object = {}): Promise<string> {
  const r = await call('POST', `/api/plans/${planId}/mosaics`, {
    centerRa: 11,
    centerDec: 20,
    tiles: MOSAIC_TILES,
    ...extra,
  });
  expect(r.status).toBe(200);
  return r.body.id;
}

// ─── Plans ───────────────────────────────────────────────────────────────────

describe('PUT /api/plans/:id', () => {
  it('rejects a blank name and leaves the name alone', async () => {
    const id = await mkPlan('Keep me');
    for (const name of ['', '   ', 5, null]) {
      expect(await call('PUT', `/api/plans/${id}`, { name })).toEqual({
        status: 400,
        body: { error: 'name is required', code: 'PLAN_NAME_REQUIRED' },
      });
    }
    expect((await readPlan(id)).name).toBe('Keep me');
  });

  it('rejects a latitude out of range or not finite', async () => {
    const id = await mkPlan();
    for (const lat of [91, -90.5]) {
      expect(await call('PUT', `/api/plans/${id}`, { lat })).toEqual({
        status: 400,
        body: { error: 'lat must be between -90 and 90', code: 'PLAN_LAT_OUT_OF_RANGE' },
      });
    }
    // 1e999 is valid JSON that parses to Infinity.
    expect(await callRaw('PUT', `/api/plans/${id}`, '{"lat":1e999}')).toEqual({
      status: 400,
      body: { error: 'lat must be between -90 and 90', code: 'PLAN_LAT_OUT_OF_RANGE' },
    });
    expect((await readPlan(id)).lat).toBeNull();
  });

  it('rejects a longitude out of range or not finite', async () => {
    const id = await mkPlan();
    for (const lon of [181, -180.1]) {
      expect(await call('PUT', `/api/plans/${id}`, { lon })).toEqual({
        status: 400,
        body: { error: 'lon must be between -180 and 180', code: 'PLAN_LON_OUT_OF_RANGE' },
      });
    }
    expect(await callRaw('PUT', `/api/plans/${id}`, '{"lon":-1e999}')).toEqual({
      status: 400,
      body: { error: 'lon must be between -180 and 180', code: 'PLAN_LON_OUT_OF_RANGE' },
    });
    expect((await readPlan(id)).lon).toBeNull();
  });

  it('accepts the bounds of latitude and longitude', async () => {
    const id = await mkPlan();
    expect(await call('PUT', `/api/plans/${id}`, { lat: -90, lon: 180 })).toEqual(OK);
    expect(await readPlan(id)).toMatchObject({ lat: -90, lon: 180 });
  });

  it('rejects an unknown sortBy and lists the keys', async () => {
    const id = await mkPlan();
    const message =
      'sortBy must be one of: transit, altitude, rating, magnitude, size, name, difficulty, window';
    for (const sortBy of ['bogus', 5, null]) {
      expect(await call('PUT', `/api/plans/${id}`, { sortBy })).toEqual({
        status: 400,
        body: { error: message, code: 'PLAN_SORT_INVALID' },
      });
    }
    expect((await readPlan(id)).sortBy).toBe('transit');
    expect(await call('PUT', `/api/plans/${id}`, { sortBy: 'window' })).toEqual(OK);
    expect((await readPlan(id)).sortBy).toBe('window');
  });

  it('rejects a body with none of the recognised keys', async () => {
    const id = await mkPlan();
    const message = 'name, settings (nightOf/setupId/lat/lon), or sortBy required';
    for (const body of [{}, { foo: 1 }, { notes: 'x' }]) {
      expect(await call('PUT', `/api/plans/${id}`, body)).toEqual({
        status: 400,
        body: { error: message, code: 'PLAN_UPDATE_EMPTY' },
      });
    }
  });

  it('stores a latitude that is a string as null', async () => {
    const id = await mkPlan();
    expect(await call('PUT', `/api/plans/${id}`, { lat: 45, lon: 6 })).toEqual(OK);
    expect(await call('PUT', `/api/plans/${id}`, { lat: '48.5' })).toEqual(OK);
    // KNOWN GAP: a string latitude is not rejected, it silently clears the stored latitude.
    expect(await readPlan(id)).toMatchObject({ lat: null, lon: 6 });
    expect(await call('PUT', `/api/plans/${id}`, { lon: '9' })).toEqual(OK);
    // KNOWN GAP: same for a string longitude.
    expect(await readPlan(id)).toMatchObject({ lat: null, lon: null });
  });

  it('clears nightOf and setupId with an empty string, and keeps the keys that are absent', async () => {
    const id = await mkPlan();
    expect(
      await call('PUT', `/api/plans/${id}`, {
        nightOf: '2026-10-05',
        setupId: 'setup-x',
        lat: 10,
        lon: 20,
      }),
    ).toEqual(OK);
    expect(await readPlan(id)).toMatchObject({
      nightOf: '2026-10-05',
      setupId: 'setup-x',
      lat: 10,
      lon: 20,
    });
    expect(await call('PUT', `/api/plans/${id}`, { nightOf: '' })).toEqual(OK);
    expect(await readPlan(id)).toMatchObject({ nightOf: null, setupId: 'setup-x', lat: 10 });
    expect(await call('PUT', `/api/plans/${id}`, { setupId: '' })).toEqual(OK);
    expect(await readPlan(id)).toMatchObject({ nightOf: null, setupId: null, lat: 10, lon: 20 });
    expect(await call('PUT', `/api/plans/${id}`, { nightOf: null, setupId: 0, lat: null })).toEqual(
      OK,
    );
    expect(await readPlan(id)).toMatchObject({ nightOf: null, setupId: null, lat: null, lon: 20 });
  });

  it('trims the name', async () => {
    const id = await mkPlan();
    expect(await call('PUT', `/api/plans/${id}`, { name: '  Renamed  ' })).toEqual(OK);
    expect((await readPlan(id)).name).toBe('Renamed');
  });

  it('writes nothing when a later part of the body is rejected', async () => {
    const id = await mkPlan('Before');
    expect(await call('PUT', `/api/plans/${id}`, { name: 'After', lat: 95 })).toEqual({
      status: 400,
      body: { error: 'lat must be between -90 and 90', code: 'PLAN_LAT_OUT_OF_RANGE' },
    });
    // Every check runs before the first write (WP2.3f): the rejected request leaves the name alone.
    expect((await readPlan(id)).name).toBe('Before');

    expect(await call('PUT', `/api/plans/${id}`, { lat: 12, sortBy: 'nope' })).toEqual({
      status: 400,
      body: {
        error:
          'sortBy must be one of: transit, altitude, rating, magnitude, size, name, difficulty, window',
        code: 'PLAN_SORT_INVALID',
      },
    });
    // Same for the settings: they are not stored when sortBy is rejected.
    expect((await readPlan(id)).lat).toBeNull();
  });
});

describe('POST /api/plans/:id/entries', () => {
  it('rejects a body with neither dsoId nor numeric ra/dec', async () => {
    const id = await mkPlan();
    for (const body of [{}, { ra: 10 }, { ra: '10', dec: 20 }, { ra: 10, dec: null }]) {
      expect(await call('POST', `/api/plans/${id}/entries`, body)).toEqual({
        status: 400,
        body: { error: 'dsoId or ra/dec is required', code: 'ENTRY_TARGET_REQUIRED' },
      });
    }
    // dsoId null counts as absent
    expect(await call('POST', `/api/plans/${id}/entries`, { dsoId: null })).toEqual({
      status: 400,
      body: { error: 'dsoId or ra/dec is required', code: 'ENTRY_TARGET_REQUIRED' },
    });
    expect((await readPlan(id)).entries).toEqual([]);
  });

  it('rejects a dsoId that is not a string', async () => {
    const id = await mkPlan();
    for (const dsoId of [5, true, ['M1'], {}]) {
      expect(await call('POST', `/api/plans/${id}/entries`, { dsoId })).toEqual({
        status: 400,
        body: { error: 'dsoId must be a string', code: 'ENTRY_DSO_NOT_STRING' },
      });
    }
  });

  it('adds a custom entry with its paDeg and an entry id of the form pe-uuid', async () => {
    const id = await mkPlan();
    const r = await call('POST', `/api/plans/${id}/entries`, { ra: 10, dec: -20, paDeg: 45 });
    expect(r.status).toBe(200);
    expect(r.body.id).toMatch(/^pe-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect((await readPlan(id)).entries).toEqual([
      {
        id: r.body.id,
        dsoId: null,
        position: 0,
        paDeg: 45,
        ra: 10,
        dec: -20,
        notes: null,
        mosaicId: null,
        mosaicWDeg: null,
        mosaicHDeg: null,
        observationWindows: [],
      },
    ]);
  });

  it('ignores a paDeg that is not a number, and allows several custom entries at one place', async () => {
    const id = await mkPlan();
    await mkEntry(id, { ra: 10, dec: 20, paDeg: '45' });
    await mkEntry(id, { ra: 10, dec: 20 });
    const entries = (await readPlan(id)).entries;
    expect(entries.map((e: any) => [e.paDeg, e.position])).toEqual([
      [null, 0],
      [null, 1],
    ]);
  });

  it('answers 409 with a code for a duplicate DSO', async () => {
    const id = await mkPlan();
    await mkEntry(id, { dsoId: 'M31' });
    expect(await call('POST', `/api/plans/${id}/entries`, { dsoId: 'M31' })).toEqual({
      status: 409,
      body: { error: 'Target already in plan', code: 'DUPLICATE_ENTRY' },
    });
    // another plan may hold the same DSO
    const other = await mkPlan('Other');
    await mkEntry(other, { dsoId: 'M31' });
    expect((await readPlan(id)).entries).toHaveLength(1);
  });

  it('answers 409 for a DSO that a mosaic tile of the same object already holds', async () => {
    const id = await mkPlan();
    await mkMosaic(id, { dsoId: 'M42' });
    // KNOWN GAP: the duplicate check does not exclude mosaic tiles, so a DSO that has a mosaic cannot also get a standalone entry.
    expect(await call('POST', `/api/plans/${id}/entries`, { dsoId: 'M42' })).toEqual({
      status: 409,
      body: { error: 'Target already in plan', code: 'DUPLICATE_ENTRY' },
    });
    expect((await readPlan(id)).entries).toHaveLength(3);
  });

  it('checks the plan before the body', async () => {
    expect(await call('POST', '/api/plans/nope/entries', {})).toEqual({
      status: 404,
      body: { error: 'Plan not found', code: 'PLAN_NOT_FOUND' },
    });
  });
});

describe('PATCH /api/plans/:id/entries/:entryId', () => {
  it('rejects each key with a wrong type', async () => {
    const id = await mkPlan();
    const entryId = await mkEntry(id, { dsoId: 'M1' });
    const cases: Array<[string, unknown, string]> = [
      ['paDeg', '45', 'paDeg must be a number or null'],
      ['paDeg', true, 'paDeg must be a number or null'],
      ['ra', '10', 'ra must be a number or null'],
      ['dec', {}, 'dec must be a number or null'],
      ['mosaicWDeg', '1', 'mosaicWDeg must be a number or null'],
      ['mosaicHDeg', [], 'mosaicHDeg must be a number or null'],
      ['dsoId', 5, 'dsoId must be a string or null'],
      ['observationWindows', 'x', 'observationWindows must be an array'],
      ['observationWindows', null, 'observationWindows must be an array'],
      ['observationWindows', {}, 'observationWindows must be an array'],
    ];
    for (const [key, value, error] of cases) {
      expect(await call('PATCH', `/api/plans/${id}/entries/${entryId}`, { [key]: value })).toEqual({
        status: 400,
        body: { error, code: 'ENTRY_FIELD_INVALID' },
      });
    }
    expect((await readPlan(id)).entries[0]).toMatchObject({ dsoId: 'M1', paDeg: null, ra: null });
  });

  it('accepts null for each nullable key and stores the numbers', async () => {
    const id = await mkPlan();
    const entryId = await mkEntry(id, { dsoId: 'M1', paDeg: 10 });
    expect(
      await call('PATCH', `/api/plans/${id}/entries/${entryId}`, {
        paDeg: 30,
        ra: 1,
        dec: 2,
        mosaicWDeg: 3,
        mosaicHDeg: 4,
        dsoId: 'M2',
      }),
    ).toEqual(OK);
    expect((await readPlan(id)).entries[0]).toMatchObject({
      dsoId: 'M2',
      paDeg: 30,
      ra: 1,
      dec: 2,
      mosaicWDeg: 3,
      mosaicHDeg: 4,
    });
    expect(
      await call('PATCH', `/api/plans/${id}/entries/${entryId}`, {
        paDeg: null,
        ra: null,
        dec: null,
        mosaicWDeg: null,
        mosaicHDeg: null,
        dsoId: null,
      }),
    ).toEqual(OK);
    expect((await readPlan(id)).entries[0]).toMatchObject({
      dsoId: null,
      paDeg: null,
      ra: null,
      dec: null,
      mosaicWDeg: null,
      mosaicHDeg: null,
    });
  });

  it('rejects a body with no recognised key, notes included', async () => {
    const id = await mkPlan();
    const entryId = await mkEntry(id, { dsoId: 'M1' });
    for (const body of [{}, { foo: 1 }, { notes: 'a note' }]) {
      // KNOWN GAP: notes cannot be changed through this route (no route writes plan_entries.notes).
      expect(await call('PATCH', `/api/plans/${id}/entries/${entryId}`, body)).toEqual({
        status: 400,
        body: { error: 'No updatable fields provided', code: 'ENTRY_NO_FIELDS' },
      });
    }
    expect((await readPlan(id)).entries[0].notes).toBeNull();
  });

  it('answers 404 for an unknown entry id', async () => {
    const id = await mkPlan();
    expect(await call('PATCH', `/api/plans/${id}/entries/nope`, { paDeg: 1 })).toEqual({
      status: 404,
      body: { error: 'Entry not found', code: 'ENTRY_NOT_FOUND' },
    });
  });

  it('ignores the plan id in the path', async () => {
    const a = await mkPlan('A');
    const b = await mkPlan('B');
    const entryId = await mkEntry(a, { dsoId: 'M1' });
    // KNOWN GAP: the entry of plan A is updated through plan B's path (and through a plan id that does not exist).
    expect(await call('PATCH', `/api/plans/${b}/entries/${entryId}`, { paDeg: 7 })).toEqual(OK);
    expect(await call('PATCH', `/api/plans/nope/entries/${entryId}`, { paDeg: 8 })).toEqual(OK);
    expect((await readPlan(a)).entries[0].paDeg).toBe(8);
  });
});

describe('observation windows through PATCH', () => {
  async function patchWindows(windows: unknown[]): Promise<any[]> {
    const id = await mkPlan();
    const entryId = await mkEntry(id, { dsoId: 'M1' });
    expect(
      await call('PATCH', `/api/plans/${id}/entries/${entryId}`, { observationWindows: windows }),
    ).toEqual(OK);
    return (await readPlan(id)).entries[0].observationWindows;
  }

  const base = { id: 'w', startFrac: 0.2, endFrac: 0.6 };

  it('keeps a valid window as it is and drops unknown keys', async () => {
    const out = await patchWindows([
      {
        ...base,
        filter: 'Ha',
        color: '#ff0000',
        frameSeconds: 30,
        snap: true,
        extra: 1,
        notes: 'x',
      },
    ]);
    expect(out).toEqual([
      {
        id: 'w',
        startFrac: 0.2,
        endFrac: 0.6,
        filter: 'Ha',
        color: '#ff0000',
        frameSeconds: 30,
        snap: true,
      },
    ]);
  });

  it('swaps reversed bounds and clamps values outside 0..1', async () => {
    const out = await patchWindows([
      { id: 'a', startFrac: 0.8, endFrac: 0.2 },
      { id: 'b', startFrac: -1, endFrac: 2 },
      { id: 'c', startFrac: 3, endFrac: -3 },
    ]);
    expect(out.map((w) => [w.id, w.startFrac, w.endFrac])).toEqual([
      ['a', 0.2, 0.8],
      ['b', 0, 1],
      ['c', 0, 1],
    ]);
  });

  it('widens a window narrower than 0.02, and moves the start back at the end of the night', async () => {
    const out = await patchWindows([
      { id: 'a', startFrac: 0.5, endFrac: 0.505 },
      { id: 'b', startFrac: 0.5, endFrac: 0.5 },
      { id: 'c', startFrac: 0.99, endFrac: 1 },
      { id: 'd', startFrac: 1, endFrac: 1 },
      { id: 'e', startFrac: 0, endFrac: 0 },
    ]);
    const bounds = out.map((w) => [w.startFrac, w.endFrac]);
    expect(bounds[0][0]).toBe(0.5);
    expect(bounds[0][1]).toBeCloseTo(0.52, 10);
    expect(bounds[1][0]).toBe(0.5);
    expect(bounds[1][1]).toBeCloseTo(0.52, 10);
    expect(bounds[2][0]).toBeCloseTo(0.98, 10);
    expect(bounds[2][1]).toBe(1);
    expect(bounds[3][0]).toBeCloseTo(0.98, 10);
    expect(bounds[3][1]).toBe(1);
    expect(bounds[4]).toEqual([0, 0.02]);
  });

  it('cuts a long filter at 40 characters and a long colour at 64, and trims both', async () => {
    const out = await patchWindows([
      { ...base, id: 'a', filter: 'F'.repeat(50), color: 'C'.repeat(70) },
      { ...base, id: 'b', filter: '  Oiii  ', color: '  red  ' },
      { ...base, id: 'c', filter: '   ', color: '' },
      { ...base, id: 'd', filter: 5, color: 5 },
    ]);
    expect(out[0].filter).toBe('F'.repeat(40));
    expect(out[0].color).toBe('C'.repeat(64));
    expect(out[1]).toMatchObject({ filter: 'Oiii', color: 'red' });
    expect(out[2]).toMatchObject({ filter: null, color: null });
    expect(out[3]).toMatchObject({ filter: null, color: null });
  });

  it('turns a frameSeconds that is not above zero into null', async () => {
    const out = await patchWindows([
      { ...base, id: 'a', frameSeconds: 0 },
      { ...base, id: 'b', frameSeconds: -5 },
      { ...base, id: 'c', frameSeconds: 'abc' },
      { ...base, id: 'd', frameSeconds: null },
      { ...base, id: 'e' },
      { ...base, id: 'f', frameSeconds: 12.5 },
      { ...base, id: 'g', frameSeconds: '45' },
    ]);
    expect(out.map((w) => w.frameSeconds)).toEqual([null, null, null, null, null, 12.5, 45]);
  });

  it('turns a snap that is not a boolean into false', async () => {
    const out = await patchWindows([
      { ...base, id: 'a', snap: 'yes' },
      { ...base, id: 'b', snap: 1 },
      { ...base, id: 'c', snap: null },
      { ...base, id: 'd' },
      { ...base, id: 'e', snap: true },
      { ...base, id: 'f', snap: false },
    ]);
    expect(out.map((w) => w.snap)).toEqual([false, false, false, false, true, false]);
  });

  it('gives a window with no id one of the form ow-<time>-<random>, and cuts a long id', async () => {
    const out = await patchWindows([
      { startFrac: 0.1, endFrac: 0.3 },
      { id: '', startFrac: 0.1, endFrac: 0.3 },
      { id: '   ', startFrac: 0.1, endFrac: 0.3 },
      { id: 7, startFrac: 0.1, endFrac: 0.3 },
      { id: ' x '.padEnd(80, 'y'), startFrac: 0.1, endFrac: 0.3 },
    ]);
    for (const w of out.slice(0, 4)) expect(w.id).toMatch(/^ow-[0-9a-z]+-[0-9a-z]{1,6}$/);
    expect(new Set(out.slice(0, 4).map((w) => w.id)).size).toBe(4);
    expect(out[4].id).toHaveLength(64);
    expect(out[4].id.startsWith('x')).toBe(true);
  });

  it('skips items that are not objects or whose bounds are not numeric', async () => {
    const out = await patchWindows([
      5,
      null,
      'text',
      [],
      { id: 'a', startFrac: 'abc', endFrac: 0.5 },
      { id: 'b', startFrac: 0.1 },
      { id: 'c', endFrac: 0.5 },
      { id: 'd', startFrac: {}, endFrac: 0.5 },
      { id: 'ok', startFrac: '0.1', endFrac: '0.4' },
    ]);
    // KNOWN GAP: a null bound counts as 0 (Number(null) is 0), so these are kept, not skipped.
    expect(await patchWindows([{ id: 'n', startFrac: null, endFrac: 0.5 }])).toEqual([
      {
        id: 'n',
        startFrac: 0,
        endFrac: 0.5,
        filter: null,
        color: null,
        frameSeconds: null,
        snap: false,
      },
    ]);
    // Items that are not objects, or have no usable numeric bounds, are skipped; the numeric strings are kept.
    expect(out).toEqual([
      {
        id: 'ok',
        startFrac: 0.1,
        endFrac: 0.4,
        filter: null,
        color: null,
        frameSeconds: null,
        snap: false,
      },
    ]);
  });

  it('stores an empty array', async () => {
    expect(await patchWindows([])).toEqual([]);
  });
});

describe('PUT /api/plans/:id/entries/order', () => {
  async function threeEntries(): Promise<{ plan: string; ids: string[] }> {
    const plan = await mkPlan();
    const ids = [
      await mkEntry(plan, { dsoId: 'M1' }),
      await mkEntry(plan, { dsoId: 'M2' }),
      await mkEntry(plan, { dsoId: 'M3' }),
    ];
    return { plan, ids };
  }

  async function order(plan: string): Promise<Array<[string | null, number]>> {
    return (await readPlan(plan)).entries.map((e: any) => [e.dsoId, e.position]);
  }

  it('rejects ids that is not an array', async () => {
    const { plan } = await threeEntries();
    for (const ids of ['x', {}, null, 5]) {
      expect(await call('PUT', `/api/plans/${plan}/entries/order`, { ids })).toEqual({
        status: 400,
        body: { error: 'ids must be an array', code: 'PLAN_IDS_NOT_ARRAY' },
      });
    }
    expect(await call('PUT', `/api/plans/${plan}/entries/order`, {})).toEqual({
      status: 400,
      body: { error: 'ids must be an array', code: 'PLAN_IDS_NOT_ARRAY' },
    });
  });

  it('reorders a full list', async () => {
    const { plan, ids } = await threeEntries();
    expect(
      await call('PUT', `/api/plans/${plan}/entries/order`, { ids: [ids[2], ids[0], ids[1]] }),
    ).toEqual(OK);
    expect(await order(plan)).toEqual([
      ['M3', 0],
      ['M1', 1],
      ['M2', 2],
    ]);
  });

  it('ignores ids of another plan and unknown ids, but still counts their place in the list', async () => {
    const { plan, ids } = await threeEntries();
    const other = await mkPlan('Other');
    const foreign = await mkEntry(other, { dsoId: 'M9' });
    expect(
      await call('PUT', `/api/plans/${plan}/entries/order`, {
        ids: [ids[2], foreign, 'nope', ids[0]],
      }),
    ).toEqual(OK);
    // position = index in the list: M3 -> 0, M1 -> 3, M2 untouched at 1
    expect(await order(plan)).toEqual([
      ['M3', 0],
      ['M2', 1],
      ['M1', 3],
    ]);
    expect(await order(other)).toEqual([['M9', 0]]);
  });

  it('leaves the entries that are not in a partial list where they were', async () => {
    const { plan, ids } = await threeEntries();
    expect(await call('PUT', `/api/plans/${plan}/entries/order`, { ids: [ids[2]] })).toEqual(OK);
    // M3 -> 0 ties with M1 (0): ties break on insertion order
    expect(await order(plan)).toEqual([
      ['M1', 0],
      ['M3', 0],
      ['M2', 1],
    ]);
  });

  it('accepts an empty list and an unknown plan id', async () => {
    const { plan } = await threeEntries();
    expect(await call('PUT', `/api/plans/${plan}/entries/order`, { ids: [] })).toEqual(OK);
    // KNOWN GAP: no 404 for a plan that does not exist.
    expect(await call('PUT', '/api/plans/nope/entries/order', { ids: ['a'] })).toEqual(OK);
    expect(await order(plan)).toEqual([
      ['M1', 0],
      ['M2', 1],
      ['M3', 2],
    ]);
  });
});

describe('DELETE /api/plans/:id/entries/:entryId', () => {
  it('answers 404 for an unknown entry', async () => {
    const id = await mkPlan();
    expect(await call('DELETE', `/api/plans/${id}/entries/nope`)).toEqual({
      status: 404,
      body: { error: 'Entry not found', code: 'ENTRY_NOT_FOUND' },
    });
  });

  it('removes an entry, and a second delete answers 404', async () => {
    const id = await mkPlan();
    const entryId = await mkEntry(id, { dsoId: 'M1' });
    expect(await call('DELETE', `/api/plans/${id}/entries/${entryId}`)).toEqual(OK);
    expect(await call('DELETE', `/api/plans/${id}/entries/${entryId}`)).toEqual({
      status: 404,
      body: { error: 'Entry not found', code: 'ENTRY_NOT_FOUND' },
    });
  });

  it('ignores the plan id in the path', async () => {
    const a = await mkPlan('A');
    const entryId = await mkEntry(a, { dsoId: 'M1' });
    // KNOWN GAP: the entry of plan A is removed through a plan id that does not exist.
    expect(await call('DELETE', `/api/plans/nope/entries/${entryId}`)).toEqual(OK);
    expect((await readPlan(a)).entries).toEqual([]);
  });
});

describe('mosaics', () => {
  it('rejects each bad body', async () => {
    const id = await mkPlan();
    const url = `/api/plans/${id}/mosaics`;
    const centre = 'centerRa/centerDec must be numbers';
    expect(await call('POST', url, { centerDec: 1, tiles: MOSAIC_TILES })).toEqual({
      status: 400,
      body: { error: centre, code: 'MOSAIC_CENTER_INVALID' },
    });
    expect(await call('POST', url, { centerRa: 1, tiles: MOSAIC_TILES })).toEqual({
      status: 400,
      body: { error: centre, code: 'MOSAIC_CENTER_INVALID' },
    });
    expect(await call('POST', url, { centerRa: '1', centerDec: 1, tiles: MOSAIC_TILES })).toEqual({
      status: 400,
      body: { error: centre, code: 'MOSAIC_CENTER_INVALID' },
    });
    for (const tiles of [undefined, [], 'x', {}]) {
      expect(await call('POST', url, { centerRa: 1, centerDec: 1, tiles })).toEqual({
        status: 400,
        body: { error: 'tiles must be a non-empty array', code: 'MOSAIC_TILES_INVALID' },
      });
    }
    for (const tile of [{}, { ra: 1 }, { ra: '1', dec: 2 }, null, 5]) {
      expect(
        await call('POST', url, { centerRa: 1, centerDec: 1, tiles: [{ ra: 1, dec: 2 }, tile] }),
      ).toEqual({
        status: 400,
        body: { error: 'each tile needs numeric ra/dec', code: 'MOSAIC_TILE_COORDS_INVALID' },
      });
    }
    expect(await readPlan(id)).toMatchObject({ entries: [], mosaics: [] });
  });

  it('checks the plan before the body', async () => {
    expect(await call('POST', '/api/plans/nope/mosaics', {})).toEqual({
      status: 404,
      body: { error: 'Plan not found', code: 'PLAN_NOT_FOUND' },
    });
  });

  it('applies the defaults when cols, rows, overlapPct and paDeg are absent', async () => {
    const id = await mkPlan();
    const mosaicId = await mkMosaic(id);
    expect(mosaicId).toMatch(/^mo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect((await readPlan(id)).mosaics).toEqual([
      {
        id: mosaicId,
        dsoId: null,
        name: null,
        centerRa: 11,
        centerDec: 20,
        paDeg: 0,
        overlapPct: 20,
        cols: 3,
        rows: 1,
        position: 0,
      },
    ]);
  });

  it('builds the tile entries with ids of the form tile-<mosaicId>-<position>', async () => {
    const id = await mkPlan();
    await mkEntry(id, { dsoId: 'M1' });
    const mosaicId = await mkMosaic(id, {
      dsoId: 'M42',
      tiles: [
        { ra: 1, dec: 2, paDeg: 30 },
        { ra: 3, dec: 4, paDeg: 'x' },
        { ra: 5, dec: 6 },
      ],
    });
    const tiles = (await readPlan(id)).entries.filter((e: any) => e.mosaicId === mosaicId);
    expect(tiles).toEqual([
      expect.objectContaining({
        id: `tile-${mosaicId}-1`,
        position: 1,
        ra: 1,
        dec: 2,
        paDeg: 30,
        dsoId: 'M42',
      }),
      expect.objectContaining({
        id: `tile-${mosaicId}-2`,
        position: 2,
        ra: 3,
        dec: 4,
        paDeg: null,
        dsoId: 'M42',
      }),
      expect.objectContaining({
        id: `tile-${mosaicId}-3`,
        position: 3,
        ra: 5,
        dec: 6,
        paDeg: null,
        dsoId: 'M42',
      }),
    ]);
  });

  it('clamps cols and rows to at least 1, falls back when they are not integers, and clamps overlapPct', async () => {
    const id = await mkPlan();
    const a = await mkMosaic(id, { cols: 0, rows: -3, overlapPct: 150 });
    const b = await mkMosaic(id, { cols: 2.5, rows: '2', overlapPct: -5 });
    const c = await mkMosaic(id, { cols: 4, rows: 2, overlapPct: 35, paDeg: 90, name: 'Big one' });
    const d = await mkMosaic(id, { overlapPct: 'x', paDeg: 'x' });
    const byId = Object.fromEntries((await readPlan(id)).mosaics.map((m: any) => [m.id, m]));
    expect(byId[a]).toMatchObject({ cols: 1, rows: 1, overlapPct: 90, position: 0 });
    expect(byId[b]).toMatchObject({ cols: 3, rows: 1, overlapPct: 0, position: 1 });
    expect(byId[c]).toMatchObject({
      cols: 4,
      rows: 2,
      overlapPct: 35,
      paDeg: 90,
      name: 'Big one',
      position: 2,
    });
    expect(byId[d]).toMatchObject({ cols: 3, rows: 1, overlapPct: 20, paDeg: 0, position: 3 });
  });

  it('removes the standalone entry of the same object when it is created', async () => {
    const id = await mkPlan();
    const other = await mkPlan('Other');
    const standalone = await mkEntry(id, { dsoId: 'M42' });
    const custom = await mkEntry(id, { ra: 5, dec: 5 });
    await mkEntry(id, { dsoId: 'M1' });
    await mkEntry(other, { dsoId: 'M42' });
    const mosaicId = await mkMosaic(id, { dsoId: 'M42' });
    const entries = (await readPlan(id)).entries;
    expect(entries.map((e: any) => e.id)).not.toContain(standalone);
    expect(entries.map((e: any) => e.id)).toContain(custom);
    expect(entries.filter((e: any) => e.mosaicId === mosaicId)).toHaveLength(3);
    expect(entries.filter((e: any) => e.dsoId === 'M1')).toHaveLength(1);
    expect((await readPlan(other)).entries).toHaveLength(1);
  });

  it('removes the entries listed in replaceEntryIds, ignoring other values', async () => {
    const id = await mkPlan();
    const a = await mkEntry(id, { ra: 5, dec: 5 });
    const b = await mkEntry(id, { ra: 6, dec: 6 });
    const keep = await mkEntry(id, { ra: 7, dec: 7 });
    await mkMosaic(id, { replaceEntryIds: [a, b, 'nope', 5, null] });
    const ids = (await readPlan(id)).entries.map((e: any) => e.id);
    expect(ids).toContain(keep);
    expect(ids).not.toContain(a);
    expect(ids).not.toContain(b);
    expect(ids).toHaveLength(4);
  });

  it('does not let replaceEntryIds remove an entry of another plan', async () => {
    const id = await mkPlan();
    const other = await mkPlan('Other');
    const foreign = await mkEntry(other, { dsoId: 'M9' });
    await mkMosaic(id, { replaceEntryIds: [foreign] });
    // fixed in WP2.7a: replaceEntryIds is limited to the plan of the mosaic.
    expect((await readPlan(other)).entries.map((e: any) => e.id)).toEqual([foreign]);
  });

  it('answers 404 for PUT and DELETE with the mosaic of another plan or an unknown id', async () => {
    const a = await mkPlan('A');
    const b = await mkPlan('B');
    const mosaicId = await mkMosaic(a);
    const body = { centerRa: 1, centerDec: 1, tiles: [{ ra: 1, dec: 1 }] };
    const notFound = { status: 404, body: { error: 'Mosaic not found', code: 'MOSAIC_NOT_FOUND' } };
    expect(await call('PUT', `/api/plans/${b}/mosaics/${mosaicId}`, body)).toEqual(notFound);
    expect(await call('PUT', `/api/plans/${a}/mosaics/nope`, body)).toEqual(notFound);
    expect(await call('PUT', `/api/plans/nope/mosaics/${mosaicId}`, body)).toEqual(notFound);
    expect(await call('DELETE', `/api/plans/${b}/mosaics/${mosaicId}`)).toEqual(notFound);
    expect(await call('DELETE', `/api/plans/${a}/mosaics/nope`)).toEqual(notFound);
    // the mosaic of A is untouched
    expect((await readPlan(a)).mosaics).toHaveLength(1);
    expect((await readPlan(a)).entries).toHaveLength(3);
  });

  it('rejects a bad body on PUT only when the mosaic exists, and leaves the mosaic alone', async () => {
    const id = await mkPlan();
    const mosaicId = await mkMosaic(id);
    expect(await call('PUT', `/api/plans/${id}/mosaics/nope`, {})).toEqual({
      status: 404,
      body: { error: 'Mosaic not found', code: 'MOSAIC_NOT_FOUND' },
    });
    expect(await call('PUT', `/api/plans/${id}/mosaics/${mosaicId}`, { tiles: [] })).toEqual({
      status: 400,
      body: { error: 'centerRa/centerDec must be numbers', code: 'MOSAIC_CENTER_INVALID' },
    });
    expect(
      await call('PUT', `/api/plans/${id}/mosaics/${mosaicId}`, {
        centerRa: 1,
        centerDec: 1,
        tiles: [],
      }),
    ).toEqual({
      status: 400,
      body: { error: 'tiles must be a non-empty array', code: 'MOSAIC_TILES_INVALID' },
    });
    expect((await readPlan(id)).entries).toHaveLength(3);
  });

  it('replaces the tiles when it updates a mosaic, and keeps the name when none is given', async () => {
    const id = await mkPlan();
    const mosaicId = await mkMosaic(id, { dsoId: 'M42', name: 'Orion' });
    const oldTiles = (await readPlan(id)).entries.map((e: any) => e.id);
    expect(oldTiles).toEqual([`tile-${mosaicId}-0`, `tile-${mosaicId}-1`, `tile-${mosaicId}-2`]);

    expect(
      await call('PUT', `/api/plans/${id}/mosaics/${mosaicId}`, {
        dsoId: 'M43',
        centerRa: 50,
        centerDec: 60,
        paDeg: 15,
        overlapPct: 40,
        cols: 2,
        rows: 1,
        tiles: [
          { ra: 1, dec: 2, paDeg: 5 },
          { ra: 3, dec: 4 },
        ],
      }),
    ).toEqual(OK);
    let plan = await readPlan(id);
    expect(plan.mosaics).toEqual([
      {
        id: mosaicId,
        dsoId: 'M43',
        name: 'Orion', // KEPT: no name in the body
        centerRa: 50,
        centerDec: 60,
        paDeg: 15,
        overlapPct: 40,
        cols: 2,
        rows: 1,
        position: 0,
      },
    ]);
    expect(plan.entries).toEqual([
      expect.objectContaining({
        id: `tile-${mosaicId}-0`,
        position: 0,
        ra: 1,
        dec: 2,
        paDeg: 5,
        dsoId: 'M43',
      }),
      expect.objectContaining({
        id: `tile-${mosaicId}-1`,
        position: 1,
        ra: 3,
        dec: 4,
        paDeg: null,
        dsoId: 'M43',
      }),
    ]);

    expect(
      await call('PUT', `/api/plans/${id}/mosaics/${mosaicId}`, {
        name: 'Renamed',
        centerRa: 50,
        centerDec: 60,
        tiles: [{ ra: 9, dec: 9 }],
      }),
    ).toEqual(OK);
    plan = await readPlan(id);
    expect(plan.mosaics[0]).toMatchObject({ name: 'Renamed', dsoId: null, cols: 1, rows: 1 });
    expect(plan.entries).toHaveLength(1);
  });

  it('removes the entries listed in replaceEntryIds on PUT', async () => {
    const id = await mkPlan();
    const standalone = await mkEntry(id, { ra: 5, dec: 5 });
    const mosaicId = await mkMosaic(id);
    expect(
      await call('PUT', `/api/plans/${id}/mosaics/${mosaicId}`, {
        centerRa: 1,
        centerDec: 1,
        tiles: [{ ra: 1, dec: 1 }],
        replaceEntryIds: [standalone],
      }),
    ).toEqual(OK);
    expect((await readPlan(id)).entries).toHaveLength(1);
  });

  it('deletes a mosaic with its tiles but not the other entries', async () => {
    const id = await mkPlan();
    const standalone = await mkEntry(id, { dsoId: 'M1' });
    const mosaicId = await mkMosaic(id);
    expect(await call('DELETE', `/api/plans/${id}/mosaics/${mosaicId}`)).toEqual(OK);
    const plan = await readPlan(id);
    expect(plan.mosaics).toEqual([]);
    expect(plan.entries.map((e: any) => e.id)).toEqual([standalone]);
    expect(await call('DELETE', `/api/plans/${id}/mosaics/${mosaicId}`)).toEqual({
      status: 404,
      body: { error: 'Mosaic not found', code: 'MOSAIC_NOT_FOUND' },
    });
  });
});

describe('deleting a plan', () => {
  it('removes its entries and mosaics', async () => {
    const old = await mkPlan('Old');
    const keepPlan = await mkPlan('Keep');
    const entryId = await mkEntry(old, { dsoId: 'M1' });
    const mosaicId = await mkMosaic(old, { dsoId: 'M42' });
    const keptEntry = await mkEntry(keepPlan, { dsoId: 'M1' });
    const tileId = `tile-${mosaicId}-1`;

    expect(await call('DELETE', `/api/plans/${old}`)).toEqual(OK);
    const fresh = await mkPlan('Fresh');
    const list = (await call('GET', '/api/plans')).body;
    expect(list.map((p: any) => p.name)).toEqual(['Keep', 'Fresh']);
    expect(list.find((p: any) => p.id === fresh)).toMatchObject({ entries: [], mosaics: [] });
    expect(list.find((p: any) => p.id === keepPlan).entries.map((e: any) => e.id)).toEqual([
      keptEntry,
    ]);
    expect(list.flatMap((p: any) => p.mosaics)).toEqual([]);
    const all = list.flatMap((p: any) => p.entries.map((e: any) => e.id));
    expect(all).not.toContain(entryId);
    expect(all).not.toContain(tileId);

    // what the API still answers for the old ids
    expect(await call('PATCH', `/api/plans/${fresh}/entries/${entryId}`, { paDeg: 1 })).toEqual({
      status: 404,
      body: { error: 'Entry not found', code: 'ENTRY_NOT_FOUND' },
    });
    expect(await call('PATCH', `/api/plans/${fresh}/entries/${tileId}`, { paDeg: 1 })).toEqual({
      status: 404,
      body: { error: 'Entry not found', code: 'ENTRY_NOT_FOUND' },
    });
    expect(await call('DELETE', `/api/plans/${old}/mosaics/${mosaicId}`)).toEqual({
      status: 404,
      body: { error: 'Mosaic not found', code: 'MOSAIC_NOT_FOUND' },
    });
    expect(await call('DELETE', `/api/plans/${old}`)).toEqual({
      status: 404,
      body: { error: 'Plan not found', code: 'PLAN_NOT_FOUND' },
    });
  });
});

describe('plan positions', () => {
  it('records the positions after a delete and a create', async () => {
    const p1 = await mkPlan('P1');
    const p2 = await mkPlan('P2');
    const p3 = await mkPlan('P3');
    expect((await call('GET', '/api/plans')).body.map((p: any) => [p.name, p.position])).toEqual([
      ['P1', 0],
      ['P2', 1],
      ['P3', 2],
    ]);
    expect(await call('DELETE', `/api/plans/${p1}`)).toEqual(OK);
    const p4 = await mkPlan('P4');
    const list = (await call('GET', '/api/plans')).body;
    // KNOWN GAP: a new plan takes position = number of plans, so after a delete it can share a position
    // with an existing plan (P3 and P4 are both at 2); the order then falls back on insertion order.
    expect(list.map((p: any) => [p.id, p.position])).toEqual([
      [p2, 1],
      [p3, 2],
      [p4, 2],
    ]);
  });

  it('reorders by index, ignores unknown ids and leaves a plan that is not listed', async () => {
    const a = await mkPlan('A');
    const b = await mkPlan('B');
    const c = await mkPlan('C');
    expect(await call('PUT', '/api/plans/order', { ids: [c, 'nope', a] })).toEqual(OK);
    expect((await call('GET', '/api/plans')).body.map((p: any) => [p.id, p.position])).toEqual([
      [c, 0],
      [b, 1],
      [a, 2],
    ]);
  });
});

describe('requests with no body', () => {
  it('POST /api/plans', async () => {
    // KNOWN GAP: no body at all gives a 500 from a TypeError instead of the 400 "name is required".
    const r = await callRaw('POST', '/api/plans');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({
      error: expect.stringContaining("Cannot destructure property 'name' of 'req.body'"),
    });
  });

  it('POST /api/plans/:id/entries', async () => {
    const id = await mkPlan();
    const r = await callRaw('POST', `/api/plans/${id}/entries`);
    // KNOWN GAP: 500 from a TypeError instead of a 400.
    expect(r.status).toBe(500);
    expect(r.body).toEqual({
      error: expect.stringContaining("Cannot destructure property 'dsoId' of 'req.body'"),
    });
    // KNOWN GAP: the body is destructured before the plan is looked up, so an unknown plan also answers 500 here.
    expect(await callRaw('POST', '/api/plans/nope/entries')).toMatchObject({ status: 500 });
  });

  it('PUT /api/plans/:id/entries/order', async () => {
    const id = await mkPlan();
    const r = await callRaw('PUT', `/api/plans/${id}/entries/order`);
    // KNOWN GAP: 500 from a TypeError instead of the 400 "ids must be an array".
    expect(r.status).toBe(500);
    expect(r.body).toEqual({
      error: expect.stringContaining("Cannot destructure property 'ids' of 'req.body'"),
    });
  });

  it('PATCH /api/plans/:id/entries/:entryId', async () => {
    const id = await mkPlan();
    const entryId = await mkEntry(id, { dsoId: 'M1' });
    const r = await callRaw('PATCH', `/api/plans/${id}/entries/${entryId}`);
    // KNOWN GAP: 500 from a TypeError instead of "No updatable fields provided".
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: expect.stringContaining("'in' operator") });
  });

  it('PUT /api/plans/:id answers 400 because it defaults the body to {}', async () => {
    const id = await mkPlan();
    expect(await callRaw('PUT', `/api/plans/${id}`)).toEqual({
      status: 400,
      body: {
        error: 'name, settings (nightOf/setupId/lat/lon), or sortBy required',
        code: 'PLAN_UPDATE_EMPTY',
      },
    });
  });
});

// ─── Photos ──────────────────────────────────────────────────────────────────

const GOOD_CORR = [
  { pointIndex: 0, photoX: 5, photoY: 5, starHip: 32349, starName: 'Sirius' },
  { pointIndex: 1, photoX: 20, photoY: 15, starHip: 27989 },
];

async function png(width = 32, height = 24): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

interface FormOptions {
  buffer?: Buffer;
  name?: string;
  type?: string;
  /** An array is sent as JSON; a string is sent as it is; null leaves the field out. */
  corr?: unknown;
  fields?: Record<string, string>;
}

async function photoForm(opts: FormOptions = {}): Promise<FormData> {
  const buffer = opts.buffer ?? (await png());
  const form = new FormData();
  form.append(
    'photo',
    new Blob([new Uint8Array(buffer)], { type: opts.type ?? 'image/png' }),
    opts.name ?? 'test.png',
  );
  const corr = opts.corr === undefined ? GOOD_CORR : opts.corr;
  if (corr !== null)
    form.append('correspondences', typeof corr === 'string' ? corr : JSON.stringify(corr));
  for (const [k, v] of Object.entries(opts.fields ?? {})) form.append(k, v);
  return form;
}

async function upload(opts: FormOptions = {}): Promise<any> {
  const r = await call('POST', '/api/photos', await photoForm(opts));
  expect(r.status).toBe(200);
  return r.body;
}

const uploadsList = () => fs.readdirSync(uploadsDir).sort();

async function readPhoto(id: string): Promise<any> {
  return (await call('GET', '/api/photos')).body.find((p: any) => p.id === id);
}

describe('POST /api/photos', () => {
  it('rejects an extension that is not allowed', async () => {
    const r = await call(
      'POST',
      '/api/photos',
      await photoForm({ name: 'x.gif', type: 'image/gif' }),
    );
    expect(r).toEqual({
      status: 400,
      body: { error: 'Extension non autorisée : .gif', code: 'INVALID_EXTENSION' },
    });
    const noExt = await call('POST', '/api/photos', await photoForm({ name: 'noext' }));
    expect(noExt).toEqual({
      status: 400,
      body: { error: 'Extension non autorisée : ', code: 'INVALID_EXTENSION' },
    });
    expect(uploadsList()).toEqual([]);
  });

  it('accepts an upper-case extension', async () => {
    const photo = await upload({ name: 'PHOTO.PNG' });
    expect(photo.filename).toBe(`${photo.id}.png`);
    expect(photo.originalName).toBe('PHOTO.PNG');
  });

  it('rejects correspondences that are not JSON', async () => {
    expect(await call('POST', '/api/photos', await photoForm({ corr: 'not json' }))).toEqual({
      status: 400,
      body: { error: 'JSON des correspondances invalide', code: 'INVALID_JSON' },
    });
    expect(uploadsList()).toEqual([]);
  });

  it('rejects fewer than two correspondences', async () => {
    const body = { error: 'Au moins 2 correspondances requises', code: 'MIN_CORRESPONDENCES' };
    for (const corr of [[], [GOOD_CORR[0]], '{}', '5', '"x"']) {
      expect(await call('POST', '/api/photos', await photoForm({ corr }))).toEqual({
        status: 400,
        body,
      });
    }
    expect(uploadsList()).toEqual([]);
  });

  it('rejects more than 100 correspondences, and accepts exactly 100', async () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ pointIndex: i, photoX: 1, photoY: 1, starHip: 1 }));
    expect(await call('POST', '/api/photos', await photoForm({ corr: many(101) }))).toEqual({
      status: 400,
      body: { error: 'Trop de correspondances (max 100)', code: 'MAX_CORRESPONDENCES' },
    });
    expect(uploadsList()).toEqual([]);
    const ok = await upload({ corr: many(100) });
    expect(ok.correspondences).toHaveLength(100);
  });

  it('rejects each bad correspondence with its code', async () => {
    const good = GOOD_CORR[1];
    const bad = (patch: object, drop: string[] = []) => {
      const c: any = { ...GOOD_CORR[0], ...patch };
      for (const k of drop) delete c[k];
      return [c, good];
    };
    const cases: Array<[unknown, string, string]> = [
      [bad({ pointIndex: -1 }), 'pointIndex invalide (entier >= 0 attendu)', 'INVALID_POINT_INDEX'],
      [
        bad({ pointIndex: 1.5 }),
        'pointIndex invalide (entier >= 0 attendu)',
        'INVALID_POINT_INDEX',
      ],
      [
        bad({ pointIndex: '0' }),
        'pointIndex invalide (entier >= 0 attendu)',
        'INVALID_POINT_INDEX',
      ],
      [bad({}, ['pointIndex']), 'pointIndex invalide (entier >= 0 attendu)', 'INVALID_POINT_INDEX'],
      [bad({ photoX: -1 }), 'photoX invalide (nombre positif attendu)', 'INVALID_PHOTO_X'],
      [bad({ photoX: '5' }), 'photoX invalide (nombre positif attendu)', 'INVALID_PHOTO_X'],
      [bad({ photoX: null }), 'photoX invalide (nombre positif attendu)', 'INVALID_PHOTO_X'],
      [bad({ photoY: -0.5 }), 'photoY invalide (nombre positif attendu)', 'INVALID_PHOTO_Y'],
      [bad({ photoY: 'a' }), 'photoY invalide (nombre positif attendu)', 'INVALID_PHOTO_Y'],
      [bad({ starHip: 0 }), 'starRa/starDec requis quand starHip=0', 'INVALID_STAR_HIP'],
      [
        bad({ starHip: 0, starRa: 10 }),
        'starRa/starDec requis quand starHip=0',
        'INVALID_STAR_HIP',
      ],
      [
        bad({ starHip: 0, starRa: '10', starDec: 20 }),
        'starRa/starDec requis quand starHip=0',
        'INVALID_STAR_HIP',
      ],
      [bad({ starHip: -5 }), 'starHip invalide (entier positif attendu)', 'INVALID_STAR_HIP'],
      [bad({ starHip: 1.5 }), 'starHip invalide (entier positif attendu)', 'INVALID_STAR_HIP'],
      [bad({ starHip: '7' }), 'starHip invalide (entier positif attendu)', 'INVALID_STAR_HIP'],
      [bad({}, ['starHip']), 'starHip invalide (entier positif attendu)', 'INVALID_STAR_HIP'],
    ];
    for (const [corr, error, code] of cases) {
      expect(await call('POST', '/api/photos', await photoForm({ corr }))).toEqual({
        status: 400,
        body: { error, code },
      });
    }
    // the first failing item decides, whatever the later ones hold
    expect(
      await call(
        'POST',
        '/api/photos',
        await photoForm({ corr: [{ ...GOOD_CORR[0], photoX: -1 }, { pointIndex: -1 }] }),
      ),
    ).toMatchObject({ body: { code: 'INVALID_PHOTO_X' } });
    expect(uploadsList()).toEqual([]);
  });

  it('accepts starHip 0 with coordinates and returns them', async () => {
    const photo = await upload({
      corr: [
        { pointIndex: 0, photoX: 1, photoY: 2, starHip: 0, starRa: 10.5, starDec: -20 },
        GOOD_CORR[1],
      ],
    });
    expect(photo.correspondences).toEqual([
      { pointIndex: 0, photoX: 1, photoY: 2, starHip: 0, starName: '', starRa: 10.5, starDec: -20 },
      { pointIndex: 1, photoX: 20, photoY: 15, starHip: 27989, starName: '' },
    ]);
  });

  it('answers 500 for a correspondence that is null', async () => {
    const r = await call('POST', '/api/photos', await photoForm({ corr: [null, null] }));
    // KNOWN GAP: a null item throws a TypeError (500) instead of an INVALID_POINT_INDEX 400.
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: expect.stringContaining('null') });
    expect(uploadsList()).toEqual([]);
  });

  it('rejects a file that is not an image', async () => {
    const r = await call(
      'POST',
      '/api/photos',
      await photoForm({ buffer: Buffer.from('this is plain text, not a picture') }),
    );
    expect(r).toEqual({
      status: 400,
      body: { error: 'Fichier image invalide ou corrompu', code: 'INVALID_IMAGE' },
    });
    expect(uploadsList()).toEqual([]);
  });

  it('rejects a MIME type the upload filter refuses, with its code', async () => {
    const r = await call('POST', '/api/photos', await photoForm({ type: 'text/plain' }));
    expect(r).toEqual({
      status: 400,
      body: { error: 'Invalid file type', code: 'INVALID_FILE_TYPE' },
    });
    expect(uploadsList()).toEqual([]);
  });

  it('uses the file name, or the trimmed and cut displayName when one is given', async () => {
    expect((await upload({ name: 'orig.png' })).originalName).toBe('orig.png');
    expect(
      (await upload({ name: 'orig.png', fields: { displayName: '  Nice name  ' } })).originalName,
    ).toBe('Nice name');
    expect((await upload({ fields: { displayName: 'x'.repeat(300) } })).originalName).toBe(
      'x'.repeat(255),
    );
    expect((await upload({ name: 'orig.png', fields: { displayName: '   ' } })).originalName).toBe(
      'orig.png',
    );
  });

  it('ignores a manualPlacement that is not JSON, and rescales one that is', async () => {
    const bad = await upload({ fields: { manualPlacement: 'not json' } });
    expect(bad).not.toHaveProperty('manualPlacement');
    expect((await readPhoto(bad.id)).manualPlacement).toBeUndefined();

    const good = await upload({
      fields: { manualPlacement: JSON.stringify({ projPerPx: 0.002, centerX: 1 }) },
    });
    expect(good.manualPlacement).toEqual({ projPerPx: 0.002, centerX: 1 });

    // KNOWN GAP: a placement with no projPerPx is stored with projPerPx null (NaN serialised by JSON).
    const noScale = await upload({ fields: { manualPlacement: JSON.stringify({ centerX: 1 }) } });
    expect(noScale.manualPlacement).toEqual({ centerX: 1, projPerPx: null });
  });

  it('bakes EXIF orientation 6 into the file and swaps width and height', async () => {
    const jpeg = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 200, g: 10, b: 10 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).orientation).toBe(6);

    const photo = await upload({ buffer: jpeg, name: 'rot.jpg', type: 'image/jpeg' });
    expect(photo).toMatchObject({ filename: `${photo.id}.jpg`, width: 20, height: 40 });
    // the client sends browser-space coordinates, which are kept as they are
    expect(photo.correspondences).toEqual([
      { pointIndex: 0, photoX: 5, photoY: 5, starHip: 32349, starName: 'Sirius' },
      { pointIndex: 1, photoX: 20, photoY: 15, starHip: 27989, starName: '' },
    ]);
    const stored = await sharp(path.join(uploadsDir, photo.filename)).metadata();
    expect([stored.width, stored.height]).toEqual([20, 40]);
    expect(stored.orientation).toBeUndefined();
    const thumb = await sharp(path.join(uploadsDir, photo.thumbFilename)).metadata();
    expect([thumb.width, thumb.height]).toEqual([20, 40]);
  });

  it('rejects two correspondences with the same pointIndex before any file is written', async () => {
    const r = await call(
      'POST',
      '/api/photos',
      await photoForm({
        corr: [
          { pointIndex: 0, photoX: 1, photoY: 1, starHip: 1 },
          { pointIndex: 0, photoX: 2, photoY: 2, starHip: 2 },
        ],
      }),
    );
    // fixed in WP2.7a: a 400 with a code, and nothing is written.
    expect(r).toEqual({
      status: 400,
      body: { error: 'pointIndex en double', code: 'DUPLICATE_POINT_INDEX' },
    });
    expect((await call('GET', '/api/photos')).body).toEqual([]);
    expect(uploadsList()).toEqual([]);
  });

  it('keeps the metadata fields of the upload form', async () => {
    const photo = await upload({
      fields: {
        dsoIds: JSON.stringify(['M31']),
        labels: 'not json',
        notes: 'n'.repeat(6000),
        observationDate: '  2026-10-05T20:00:00Z  ',
        gearSetupId: 'g'.repeat(80),
        integrations: JSON.stringify([{ frames: 3, seconds: 60, filter: 'L' }, { frames: 0 }]),
        captureDetails: JSON.stringify({ gain: '120', bogus: 1 }),
        pointsOfInterest: JSON.stringify([{ name: 'SN', categoryId: 'c' }, { name: '' }]),
      },
    });
    expect(photo).toMatchObject({
      dsoIds: ['M31'],
      labels: [],
      observationDate: '2026-10-05T20:00:00Z',
      gearSetupId: 'g'.repeat(64),
      integrations: [{ frames: 3, seconds: 60, filter: 'L' }],
      captureDetails: { gain: 120 },
      pointsOfInterest: [{ name: 'SN', categoryId: 'c' }],
    });
    expect(photo.notes).toHaveLength(5000);
  });
});

describe('PATCH /api/photos/:id/metadata', () => {
  async function onePhoto(): Promise<string> {
    return (await upload()).id;
  }
  const patch = (id: string, body: unknown) => call('PATCH', `/api/photos/${id}/metadata`, body);

  it('coerces each field with a wrong type and never answers 400', async () => {
    const id = await onePhoto();
    expect(
      await patch(id, {
        dsoIds: 'M1',
        labels: {},
        notes: 5,
        integrations: 'x',
        originalName: 5,
        observationDate: 5,
        pointsOfInterest: 'x',
        captureDetails: [],
        gearSetupId: 5,
      }),
    ).toEqual(OK);
    expect(await readPhoto(id)).toMatchObject({
      originalName: 'test.png',
      dsoIds: [],
      labels: [],
      notes: '',
      integrations: [],
      observationDate: null,
      pointsOfInterest: [],
      captureDetails: {},
      gearSetupId: null,
    });
  });

  it('stores the elements of dsoIds and labels without checking their type', async () => {
    const id = await onePhoto();
    expect(await patch(id, { dsoIds: [1, null, 'M1'], labels: [{ a: 1 }] })).toEqual(OK);
    // KNOWN GAP: only "is an array" is checked, not the elements.
    expect(await readPhoto(id)).toMatchObject({ dsoIds: [1, null, 'M1'], labels: [{ a: 1 }] });
  });

  it('cuts notes at 5000 characters', async () => {
    const id = await onePhoto();
    expect(await patch(id, { notes: 'n'.repeat(5001) })).toEqual(OK);
    expect((await readPhoto(id)).notes).toBe('n'.repeat(5000));
    expect(await patch(id, { notes: '  spaced  ' })).toEqual(OK);
    expect((await readPhoto(id)).notes).toBe('  spaced  ');
  });

  it('leaves originalName alone when blank, and trims and cuts it otherwise', async () => {
    const id = await onePhoto();
    for (const originalName of ['', '   ', null]) {
      expect(await patch(id, { originalName })).toEqual(OK);
      expect((await readPhoto(id)).originalName).toBe('test.png');
    }
    const long = await patch(id, { originalName: `  ${'a'.repeat(300)}  ` });
    expect(long).toEqual({ status: 200, body: { ok: true, originalName: 'a'.repeat(255) } });
    expect((await readPhoto(id)).originalName).toBe('a'.repeat(255));
  });

  it('clears the stored observation date when it is left out', async () => {
    const id = await onePhoto();
    expect(await patch(id, { observationDate: '  2026-10-05T20:00:00Z ' })).toEqual(OK);
    expect((await readPhoto(id)).observationDate).toBe('2026-10-05T20:00:00Z');
    expect(await patch(id, { notes: 'only notes' })).toEqual(OK);
    // KNOWN GAP: the route replaces every field, so a body without observationDate clears the stored date.
    expect((await readPhoto(id)).observationDate).toBeNull();
    expect(await patch(id, { observationDate: 'z'.repeat(60) })).toEqual(OK);
    expect((await readPhoto(id)).observationDate).toBe('z'.repeat(50));
  });

  it('clears every other field that is left out of the body', async () => {
    const id = await onePhoto();
    expect(
      await patch(id, {
        dsoIds: ['M1'],
        labels: ['a'],
        notes: 'n',
        gearSetupId: 'g1',
        integrations: [{ frames: 1, seconds: 1, filter: 'L' }],
        captureDetails: { gain: 1 },
        pointsOfInterest: [{ name: 'A', categoryId: 'c' }],
      }),
    ).toEqual(OK);
    expect(await patch(id, {})).toEqual(OK);
    // KNOWN GAP: an empty body is accepted and wipes the metadata (it is a replace, not a patch).
    expect(await readPhoto(id)).toMatchObject({
      dsoIds: [],
      labels: [],
      notes: '',
      gearSetupId: null,
      integrations: [],
      captureDetails: {},
      pointsOfInterest: [],
    });
  });

  it('drops the integration rows that are invalid', async () => {
    const id = await onePhoto();
    expect(
      await patch(id, {
        integrations: [
          { frames: 0, seconds: 60, filter: 'L' },
          { frames: -2, seconds: 60, filter: 'L' },
          { frames: 1.5, seconds: 60, filter: 'L' },
          { frames: 3, seconds: 0, filter: 'L' },
          { frames: 3, seconds: 60.5, filter: 'L' },
          { frames: 3, seconds: 60, filter: '' },
          { frames: 3, seconds: 60, filter: '   ' },
          { frames: 3, seconds: 60 },
          { frames: 3, seconds: 60, filter: 5 },
          { frames: 'abc', seconds: 60, filter: 'L' },
          null,
          'row',
          { frames: '4', seconds: '120', filter: '  Ha  ' },
          { frames: 10, seconds: 300, filter: 'Oiii' },
        ],
      }),
    ).toEqual(OK);
    expect((await readPhoto(id)).integrations).toEqual([
      { frames: 4, seconds: 120, filter: 'Ha' },
      { frames: 10, seconds: 300, filter: 'Oiii' },
    ]);
  });

  it('drops the points of interest that are invalid and the coordinates out of range', async () => {
    const id = await onePhoto();
    expect(
      await patch(id, {
        pointsOfInterest: [
          { name: 'ra too big', categoryId: 'c', ra: 400, dec: 0 },
          { name: 'ra 360', categoryId: 'c', ra: 360, dec: 0 },
          { name: 'dec too big', categoryId: 'c', ra: 10, dec: 91 },
          { name: 'only ra', categoryId: 'c', ra: 10 },
          { name: 'string ra', categoryId: 'c', ra: '10', dec: 5 },
          { name: 'edges', categoryId: 'c', ra: 0, dec: -90 },
          { name: 'top', categoryId: 'c', ra: 359.9, dec: 90 },
          { name: '', categoryId: 'c' },
          { name: '   ', categoryId: 'c' },
          { name: 'no category' },
          { name: 'empty category', categoryId: '' },
          { name: 5, categoryId: 'c' },
          null,
          { name: `  ${'N'.repeat(120)} `, categoryId: 'k'.repeat(80) },
        ],
      }),
    ).toEqual(OK);
    expect((await readPhoto(id)).pointsOfInterest).toEqual([
      { name: 'ra too big', categoryId: 'c' },
      { name: 'ra 360', categoryId: 'c' },
      { name: 'dec too big', categoryId: 'c' },
      { name: 'only ra', categoryId: 'c' },
      { name: 'string ra', categoryId: 'c' },
      { name: 'edges', categoryId: 'c', ra: 0, dec: -90 },
      { name: 'top', categoryId: 'c', ra: 359.9, dec: 90 },
      { name: 'N'.repeat(100), categoryId: 'k'.repeat(64) },
    ]);
  });

  it('keeps the known capture fields with finite numbers and drops the rest', async () => {
    const id = await onePhoto();
    expect(
      await callRaw(
        'PATCH',
        `/api/photos/${id}/metadata`,
        JSON.stringify({}).replace(
          '{}',
          '{"captureDetails":{"gain":"120","offset":1e999,"iso":"abc","ccdTemp":-10.5,"setTemp":null,"binning":"  2x2  ","unknown":5,"__proto__":{"x":1}}}',
        ),
      ),
    ).toEqual(OK);
    expect((await readPhoto(id)).captureDetails).toEqual({
      gain: 120,
      ccdTemp: -10.5,
      binning: '2x2',
    });
    expect(await patch(id, { captureDetails: { binning: 'b'.repeat(80), gain: '' } })).toEqual(OK);
    expect((await readPhoto(id)).captureDetails).toEqual({ binning: 'b'.repeat(64) });
  });

  it('cuts gearSetupId at 64 characters without checking that the setup exists', async () => {
    const id = await onePhoto();
    expect(await patch(id, { gearSetupId: `  ${'g'.repeat(100)}  ` })).toEqual(OK);
    expect((await readPhoto(id)).gearSetupId).toBe('g'.repeat(64));
    expect(await patch(id, { gearSetupId: '   ' })).toEqual(OK);
    expect((await readPhoto(id)).gearSetupId).toBeNull();
  });
});

describe('PATCH /api/photos/:id/manual-placement', () => {
  const place = (id: string, body: unknown) =>
    call('PATCH', `/api/photos/${id}/manual-placement`, body);

  it('clears the placement with null, and with any falsy value or no key', async () => {
    const id = (await upload({ fields: { manualPlacement: JSON.stringify({ projPerPx: 1 }) } })).id;
    expect((await readPhoto(id)).manualPlacement).toEqual({ projPerPx: 1 });
    for (const body of [
      { manualPlacement: null },
      { manualPlacement: 0 },
      { manualPlacement: '' },
      {},
    ]) {
      expect(await place(id, { manualPlacement: { a: 1 } })).toEqual(OK);
      expect(await place(id, body)).toEqual(OK);
      expect(await readPhoto(id)).not.toHaveProperty('manualPlacement');
    }
  });

  it('stores an arbitrary object as given', async () => {
    const id = (await upload()).id;
    const weird = { foo: 'bar', nested: { a: [1, 2, 3] }, projPerPx: 'not a number' };
    expect(await place(id, { manualPlacement: weird })).toEqual(OK);
    // KNOWN GAP: the shape is not validated at all.
    expect((await readPhoto(id)).manualPlacement).toEqual(weird);
    expect(await place(id, { manualPlacement: 'text' })).toEqual(OK);
    expect((await readPhoto(id)).manualPlacement).toBe('text');
    expect(await place(id, { manualPlacement: [1, 2] })).toEqual(OK);
    expect((await readPhoto(id)).manualPlacement).toEqual([1, 2]);
  });
});

describe('PATCH /api/photos/order', () => {
  const INVALID_SHAPE = {
    status: 400,
    body: { error: 'photoIds must be a non-empty array of strings', code: 'INVALID_PHOTO_ORDER' },
  };
  const INCOMPLETE = {
    status: 400,
    body: {
      error: 'photoIds must include all existing photos exactly once',
      code: 'INVALID_PHOTO_ORDER',
    },
  };
  const order = async () => (await call('GET', '/api/photos')).body.map((p: any) => p.id);

  it('rejects duplicates', async () => {
    const a = (await upload()).id;
    const b = (await upload()).id;
    expect(await call('PATCH', '/api/photos/order', { photoIds: [a, a] })).toEqual({
      status: 400,
      body: { error: 'photoIds contains duplicates', code: 'INVALID_PHOTO_ORDER' },
    });
    expect(await call('PATCH', '/api/photos/order', { photoIds: [a, b, a] })).toEqual({
      status: 400,
      body: { error: 'photoIds contains duplicates', code: 'INVALID_PHOTO_ORDER' },
    });
  });

  it('rejects a list that misses a photo or holds an unknown one', async () => {
    const a = (await upload()).id;
    const b = (await upload()).id;
    expect(await call('PATCH', '/api/photos/order', { photoIds: [a] })).toEqual(INCOMPLETE);
    expect(await call('PATCH', '/api/photos/order', { photoIds: [a, 'zzz'] })).toEqual(INCOMPLETE);
    expect(await call('PATCH', '/api/photos/order', { photoIds: [a, b, 'zzz'] })).toEqual(
      INCOMPLETE,
    );
    expect(await order()).toEqual([a, b]);
  });

  it('rejects an empty list while photos exist, and accepts it when there are none', async () => {
    await upload();
    // The message says "non-empty" but the shape check lets [] through; it fails the completeness check.
    expect(await call('PATCH', '/api/photos/order', { photoIds: [] })).toEqual(INCOMPLETE);
    await call('DELETE', '/api/photo-metadata');
    // KNOWN GAP: with no photos an empty list is accepted although the error message says "non-empty".
    expect(await call('PATCH', '/api/photos/order', { photoIds: [] })).toEqual(OK);
  });

  it('rejects an element that is not a string, or is empty, and a missing list', async () => {
    const a = (await upload()).id;
    expect(await call('PATCH', '/api/photos/order', { photoIds: [a, 5] })).toEqual(INVALID_SHAPE);
    expect(await call('PATCH', '/api/photos/order', { photoIds: [a, null] })).toEqual(
      INVALID_SHAPE,
    );
    expect(await call('PATCH', '/api/photos/order', { photoIds: [''] })).toEqual(INVALID_SHAPE);
    expect(await call('PATCH', '/api/photos/order', {})).toEqual(INVALID_SHAPE);
  });

  it('reorders a full list', async () => {
    const a = (await upload()).id;
    const b = (await upload()).id;
    const c = (await upload()).id;
    expect(await order()).toEqual([a, b, c]);
    expect(await call('PATCH', '/api/photos/order', { photoIds: [c, a, b] })).toEqual(OK);
    expect(await order()).toEqual([c, a, b]);
  });
});

describe('DELETE /api/photos (bulk)', () => {
  it('rejects ids that is not an array', async () => {
    for (const ids of ['x', {}, null, 5]) {
      expect(await call('DELETE', '/api/photos', { ids })).toEqual({
        status: 400,
        body: { error: 'ids must be an array', code: 'IDS_NOT_ARRAY' },
      });
    }
    expect(await call('DELETE', '/api/photos', {})).toEqual({
      status: 400,
      body: { error: 'ids must be an array', code: 'IDS_NOT_ARRAY' },
    });
  });

  it('deletes the known ids, skips the others, and removes their files', async () => {
    const a = await upload();
    const b = await upload();
    const c = await upload();
    expect(uploadsList()).toHaveLength(6);
    const r = await call('DELETE', '/api/photos', { ids: [a.id, 'unknown', 5, null, b.id, a.id] });
    // the second a.id is already gone and is not counted
    expect(r).toEqual({ status: 200, body: { ok: true, deleted: 2 } });
    expect(uploadsList()).toEqual([c.filename, c.thumbFilename].sort());
    expect((await call('GET', '/api/photos')).body.map((p: any) => p.id)).toEqual([c.id]);
  });

  it('answers deleted 0 for an empty list or only unknown ids', async () => {
    const a = await upload();
    expect(await call('DELETE', '/api/photos', { ids: [] })).toEqual({
      status: 200,
      body: { ok: true, deleted: 0 },
    });
    expect(await call('DELETE', '/api/photos', { ids: ['x', 1] })).toEqual({
      status: 200,
      body: { ok: true, deleted: 0 },
    });
    expect(uploadsList()).toHaveLength(2);
    expect((await readPhoto(a.id)).id).toBe(a.id);
  });
});

describe('DELETE /api/photo-metadata', () => {
  it('removes the rows, their correspondences and the files', async () => {
    const a = await upload();
    const b = await upload();
    expect(await call('DELETE', '/api/photo-metadata')).toEqual({
      status: 200,
      body: { ok: true, deleted: 2 },
    });
    expect((await call('GET', '/api/photos')).body).toEqual([]);
    // fixed in WP2.7a: the image and thumbnail files are removed with the rows.
    expect(uploadsList()).toEqual([]);
    // correspondences went with the rows (ON DELETE CASCADE): a new photo holds only its own
    const c = await upload({
      corr: [{ pointIndex: 0, photoX: 1, photoY: 1, starHip: 5 }, GOOD_CORR[1]],
    });
    const list = (await call('GET', '/api/photos')).body;
    expect(list).toHaveLength(1);
    expect(list[0].correspondences).toEqual(c.correspondences);
    expect(list[0].correspondences).toHaveLength(2);
  });

  it('answers deleted 0 when there is nothing', async () => {
    expect(await call('DELETE', '/api/photo-metadata')).toEqual({
      status: 200,
      body: { ok: true, deleted: 0 },
    });
  });
});

describe('a photo whose file is missing from the uploads folder', () => {
  it('lists it with fileSize null, and deletes it', async () => {
    const photo = await upload();
    const other = await upload();
    fs.rmSync(path.join(uploadsDir, photo.filename));
    const list = (await call('GET', '/api/photos')).body;
    expect(list.map((p: any) => [p.id, p.fileSize === null])).toEqual([
      [photo.id, true],
      [other.id, false],
    ]);
    expect(list[1].fileSize).toBe(fs.statSync(path.join(uploadsDir, other.filename)).size);

    expect(await call('DELETE', `/api/photos/${photo.id}`)).toEqual(OK);
    expect(uploadsList()).toEqual([other.filename, other.thumbFilename].sort());
    expect((await call('GET', '/api/photos')).body.map((p: any) => p.id)).toEqual([other.id]);
    expect(await call('DELETE', `/api/photos/${photo.id}`)).toEqual({
      status: 404,
      body: { error: 'Photo introuvable', code: 'PHOTO_NOT_FOUND' },
    });
  });

  it('deletes a photo whose thumbnail is missing too', async () => {
    const photo = await upload();
    fs.rmSync(path.join(uploadsDir, photo.filename));
    fs.rmSync(path.join(uploadsDir, photo.thumbFilename));
    expect(await call('DELETE', `/api/photos/${photo.id}`)).toEqual(OK);
    expect(uploadsList()).toEqual([]);
  });
});
