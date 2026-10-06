// @vitest-environment node
/**
 * The horizon service (WP2.7e) on a private in-memory database, on both adapters, with the tiles
 * and the Overpass answers served by a fake `HttpClient` and decoded by the real `sharp` codec.
 */
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import { DomainError, isDomainError } from '@myastrosky/core/domain/errors';
import type { HttpClient, HttpRequest, HttpResponse } from '@myastrosky/core/ports/http-client';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import {
  createHorizonService,
  horizonCacheKey,
  type HorizonService,
} from '@myastrosky/core/services/horizon';
import { createSharpImageCodec } from '../../server/image-codec';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { countingSqlDb, type CountingSqlDb } from '../helpers/counting-sql-db';
import { SQL_ADAPTERS } from '../helpers/sql-adapters';

const TILE_URL =
  /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/12\/\d+\/\d+\.png$/;
const PEAKS = JSON.stringify({
  elements: [
    { type: 'node', lat: 45.123, lon: 6.48, tags: { name: 'Pic Test', ele: '2500' } },
    { type: 'node', lat: 45.1, lon: 6.4, tags: { ele: '900' } },
  ],
});

type Reply = { status: number; body: string | Uint8Array } | { reject: string };

function response(status: number, body: string | Uint8Array): HttpResponse {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    status,
    headers: {},
    text: async () => new TextDecoder().decode(bytes),
    bytes: async () => bytes,
  };
}

/** A Terrarium tile: elevation rises from 500 m (west edge) to 1010 m (east edge), 2 m per pixel. */
async function terrainTile(): Promise<Uint8Array> {
  const raw = Buffer.alloc(256 * 256 * 3);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const v = 32768 + 500 + x * 2;
      const i = (y * 256 + x) * 3;
      raw[i] = v >> 8;
      raw[i + 1] = v & 255;
    }
  }
  return new Uint8Array(
    await sharp(raw, { raw: { width: 256, height: 256, channels: 3 } })
      .png()
      .toBuffer(),
  );
}

let tile: Uint8Array;
beforeAll(async () => {
  tile = await terrainTile();
});

describe('horizonCacheKey', () => {
  it('versions the key and rounds the position to 3 decimals', () => {
    expect(horizonCacheKey(45.1234, 6.4566, 40, null)).toBe('v5:45.123:6.457:40:auto');
    expect(horizonCacheKey(45.1234, 6.4566, 3, 2)).toBe('v5:45.123:6.457:3:2');
  });
});

describe.each(SQL_ADAPTERS)('HorizonService (%s)', (_adapter, wrap) => {
  let conn: Database.Database;
  let db: CountingSqlDb;
  let svc: HorizonService;
  let requests: HttpRequest[];
  let tileReply: Reply;
  let overpassReply: Reply;
  let logged: { event: string; context?: Record<string, unknown> }[];
  let sleeps: number[];

  const http: HttpClient = async (req) => {
    requests.push(req);
    const reply = TILE_URL.test(req.url) ? tileReply : overpassReply;
    if ('reject' in reply) throw new Error(reply.reject);
    return response(reply.status, reply.body);
  };

  beforeEach(async () => {
    conn = new Database(':memory:');
    const base: SqlDb = wrap(createBetterSqliteDb(conn));
    await initSchema(base);
    db = countingSqlDb(base);
    requests = [];
    logged = [];
    sleeps = [];
    tileReply = { status: 200, body: tile };
    overpassReply = { status: 200, body: PEAKS };
    svc = createHorizonService({
      db,
      http,
      images: createSharpImageCodec(),
      now: () => 0,
      log: (event, _error, context) => logged.push({ event, context }),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
  });
  afterEach(() => conn.close());

  const rejection = async (p: Promise<unknown>): Promise<DomainError> => {
    try {
      await p;
    } catch (e) {
      expect(isDomainError(e)).toBe(true);
      return e as DomainError;
    }
    throw new Error('expected the promise to reject');
  };
  const cacheRows = () =>
    conn.prepare('SELECT key FROM horizon_profiles').all() as { key: string }[];
  const tiles = () => requests.filter((r) => TILE_URL.test(r.url));
  const peaks = () => requests.filter((r) => !TILE_URL.test(r.url));

  describe('getProfile validation', () => {
    it.each([
      ['a latitude above 90', { lat: 91, lon: 6 }],
      ['a latitude below -90', { lat: -91, lon: 6 }],
      ['a latitude that is NaN', { lat: NaN, lon: 6 }],
      ['a longitude that is NaN', { lat: 45, lon: NaN }],
      ['a longitude that is infinite', { lat: 45, lon: Infinity }],
      ['a latitude that is not a number', { lat: '45' as unknown as number, lon: 6 }],
    ])('rejects %s before any request or query', async (_label, query) => {
      const err = await rejection(svc.getProfile(query));
      expect(err.kind).toBe('invalid');
      expect(err.code).toBe('INVALID_LAT_LON');
      expect(err.message).toBe('Invalid or missing lat/lon');
      expect(requests).toHaveLength(0);
      expect(db.calls()).toBe(0);
    });

    it('accepts any finite longitude, even outside -180..180', async () => {
      tileReply = { status: 404, body: '' };
      overpassReply = { status: 200, body: '{"elements":[]}' };
      const r = await svc.getProfile({ lat: 60, lon: 400, radiusKm: 3 });
      expect(r.alts).toHaveLength(360);
    });
  });

  describe('getProfile', () => {
    it('computes and caches in 2 round trips, then answers from the cache in 1', async () => {
      db.reset();
      const r = await svc.getProfile({ lat: 45.123, lon: 6.456, radiusKm: 3, obsHeightM: 2 });
      expect(db.calls()).toBe(2);
      expect(r).toMatchObject({
        lat: 45.123,
        lon: 6.456,
        obsHeightM: 2,
        azStepDeg: 1,
        source: 'auto',
      });
      expect(r.alts).toHaveLength(360);
      expect(r.layers.map((l) => l.maxDistKm)).toEqual([2, 3]);
      expect(r.layers[1].alts).toEqual(r.alts);
      expect(r.alts[90]).toBeCloseTo(4.1967, 3);
      expect(r.alts[270]).toBeCloseTo(-4.296, 3);
      expect(r.summits).toHaveLength(1);
      expect(r.summits[0]).toMatchObject({ name: 'Pic Test', elevationM: 2500 });
      expect(cacheRows()).toEqual([{ key: 'v5:45.123:6.456:3:2' }]);

      requests = [];
      db.reset();
      const again = await svc.getProfile({ lat: 45.1231, lon: 6.4561, radiusKm: 3, obsHeightM: 2 });
      expect(db.calls()).toBe(1);
      expect(again).toEqual(r);
      expect(requests).toHaveLength(0);
    });

    it('sends the tile and Overpass requests as the route did', async () => {
      await svc.getProfile({ lat: 45.123, lon: 6.456, radiusKm: 3 });
      expect(tiles().length).toBeGreaterThan(0);
      for (const t of tiles()) {
        expect(t.method).toBe('GET');
        expect(t.headers).toBeUndefined();
        expect(t.timeoutMs).toBeUndefined();
      }
      expect(peaks()).toHaveLength(1);
      const [p] = peaks();
      expect(p.url).toBe('https://overpass-api.de/api/interpreter');
      expect(p.method).toBe('POST');
      expect(p.headers).toEqual({
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'MyAstroSky (astro horizon feature)',
      });
      expect(p.timeoutMs).toBe(12000);
      expect(decodeURIComponent(String(p.body))).toMatch(
        /^data=\[out:json\]\[timeout:30\];node\[natural=peak\]\(.*\);out;$/,
      );
    });

    it('keys the cache on the eye height: absent or not finite means null', async () => {
      const a = await svc.getProfile({ lat: 45.123, lon: 6.456, radiusKm: 3 });
      const b = await svc.getProfile({ lat: 45.123, lon: 6.456, radiusKm: 3, obsHeightM: NaN });
      const c = await svc.getProfile({ lat: 45.123, lon: 6.456, radiusKm: 3, obsHeightM: 0 });
      expect(a.obsHeightM).toBeNull();
      expect(b.obsHeightM).toBeNull();
      expect(c.obsHeightM).toBe(0);
      expect(
        cacheRows()
          .map((r) => r.key)
          .sort(),
      ).toEqual(['v5:45.123:6.456:3:0', 'v5:45.123:6.456:3:auto']);
    });

    it('uses 40 km when the radius is absent or not finite, and clamps it to 1..100', async () => {
      tileReply = { status: 404, body: '' };
      overpassReply = { status: 200, body: '{"elements":[]}' };
      const d = await svc.getProfile({ lat: 60.5, lon: 10.5 });
      expect(d.layers.map((l) => l.maxDistKm)).toEqual([2, 4, 7, 11, 16, 23, 40]);
      const n = await svc.getProfile({ lat: 60.5, lon: 10.5, radiusKm: NaN });
      expect(n).toEqual(d);
      const small = await svc.getProfile({ lat: 60.5, lon: 10.5, radiusKm: 0.2 });
      expect(small.layers.map((l) => l.maxDistKm)).toEqual([1]);
    });

    it('treats a missing tile (404) as sea level', async () => {
      tileReply = { status: 404, body: 'nope' };
      overpassReply = { status: 200, body: '{"elements":[]}' };
      const r = await svc.getProfile({ lat: 10.5, lon: 20.5, radiusKm: 3 });
      expect(r.summits).toEqual([]);
      for (const a of r.alts) expect(a).toBeCloseTo(-0.0442, 3);
    });

    it('recomputes when the cached row is not valid JSON', async () => {
      conn
        .prepare('INSERT INTO horizon_profiles (key, json) VALUES (?, ?)')
        .run('v5:45.123:6.456:3:auto', '{broken');
      const r = await svc.getProfile({ lat: 45.123, lon: 6.456, radiusKm: 3 });
      expect(r.alts).toHaveLength(360);
      expect(tiles().length).toBeGreaterThan(0);
      const row = conn.prepare('SELECT json FROM horizon_profiles').get() as { json: string };
      expect(JSON.parse(row.json)).toEqual(r);
    });

    it('keeps the profile and reports no summits when every Overpass attempt fails', async () => {
      overpassReply = { status: 503, body: 'overloaded' };
      const r = await svc.getProfile({ lat: 30.5, lon: 30.5, radiusKm: 3 });
      expect(r.summits).toEqual([]);
      expect(peaks().map((p) => p.url)).toEqual([
        'https://overpass-api.de/api/interpreter',
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://overpass.private.coffee/api/interpreter',
      ]);
      expect(sleeps).toEqual([800, 800, 800]);
      expect(logged).toEqual([
        { event: 'overpass_fetch_failed', context: { lat: 30.5, lon: 30.5 } },
      ]);
      expect(cacheRows()).toHaveLength(1);
    });

    it('retries Overpass on a rejected request and stops at the first success', async () => {
      let n = 0;
      const flaky: HttpClient = async (req) => {
        if (TILE_URL.test(req.url)) return response(200, tile);
        requests.push(req);
        if (++n === 1) throw new Error('ECONNRESET');
        return response(200, PEAKS);
      };
      const s = createHorizonService({
        db,
        http: flaky,
        images: createSharpImageCodec(),
        now: () => 0,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      });
      const r = await s.getProfile({ lat: 45.123, lon: 6.456, radiusKm: 3 });
      expect(r.summits).toHaveLength(1);
      expect(requests).toHaveLength(2);
      expect(sleeps).toEqual([800]);
    });

    it('fails with HORIZON_COMPUTE_FAILED when a tile request fails, keeps the cause and caches nothing', async () => {
      tileReply = { reject: 'ECONNRESET' };
      const err = await rejection(svc.getProfile({ lat: -20.5, lon: 140.5, radiusKm: 3 }));
      expect(err.kind).toBe('upstream');
      expect(err.code).toBe('HORIZON_COMPUTE_FAILED');
      expect(err.body).toEqual({ error: 'Failed to compute horizon from elevation data' });
      expect((err.cause as Error).message).toBe('ECONNRESET');
      expect(cacheRows()).toEqual([]);
    });

    it('fails with HORIZON_COMPUTE_FAILED when a tile is not a readable image', async () => {
      tileReply = { status: 200, body: 'not a png' };
      const err = await rejection(svc.getProfile({ lat: -30.5, lon: 150.5, radiusKm: 3 }));
      expect(err.code).toBe('HORIZON_COMPUTE_FAILED');
      expect(cacheRows()).toEqual([]);
    });

    it('fails before any request when the radius needs more than 400 tiles', async () => {
      const err = await rejection(svc.getProfile({ lat: 45.5, lon: 7.5, radiusKm: 1000 }));
      expect(err.code).toBe('HORIZON_COMPUTE_FAILED');
      expect((err.cause as Error).message).toBe('Horizon radius too large: 900 tiles exceeds 400');
      expect(requests).toHaveLength(0);
    });
  });
});
