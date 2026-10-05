// @vitest-environment node
/**
 * Pins the routes that reach the network (WP2.7d). The real routes run on a real server; the
 * outgoing requests to the upstream sites are answered by recorded fixtures. `globalThis.fetch`
 * is the interception point: calls to the test server itself pass through, anything else is
 * recorded and answered from `upstream`.
 *
 * The caches live as long as the app, so every case that must reach the upstream uses a cone
 * no earlier case used; the comet cases run in the order failure, empty, success, cached.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type express from 'express';
import sharp from 'sharp';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const FIXTURES = path.join(__dirname, '../fixtures');
const SKYBOT_FIXTURE = fs.readFileSync(
  path.join(FIXTURES, 'skybot/ngc4438-conesearch.json'),
  'utf8',
);
const TNS_FIXTURE = fs.readFileSync(path.join(FIXTURES, 'tns/ngc7331-search.csv'), 'utf8');
const COMET_FIXTURE = fs.readFileSync(path.join(FIXTURES, 'comets/CometEls-sample.txt'), 'utf8');

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

type UpstreamReply =
  | { status: number; body: string | Uint8Array; headers?: Record<string, string> }
  | { reject: string };
/** One reply for every request, or a function that answers each URL (the horizon needs several). */
type Upstream = UpstreamReply | ((url: string) => UpstreamReply);

let app: express.Express;
let server: Server;
let base: string;
let uploadsDir: string;
let closeDatabase: () => void;
let savedApiKeyEnv: string | undefined;
const realFetch = globalThis.fetch;
let upstream: Upstream;
let recorded: Recorded[];

function headersOf(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init?.headers ?? {}).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

beforeAll(async () => {
  vi.resetModules();
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myastrosky-network-test-'));
  vi.stubEnv('DB_PATH', ':memory:');
  vi.stubEnv('UPLOADS_DIR', uploadsDir);
  vi.stubEnv('ENABLE_SWAGGER', 'false');
  savedApiKeyEnv = process.env.ASTROMETRY_API_KEY;
  delete process.env.ASTROMETRY_API_KEY;

  const mod = await import('../../server/app.js');
  app = await mod.createApp();
  closeDatabase = (await import('../../server/db.js')).closeDatabase;
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(base)) return realFetch(input as string, init);
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: headersOf(init),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const reply = typeof upstream === 'function' ? upstream(url) : upstream;
    if ('reject' in reply) throw new Error(reply.reject);
    return new Response(reply.body as BodyInit, { status: reply.status, headers: reply.headers });
  });
}, 30_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase?.();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  if (savedApiKeyEnv !== undefined) process.env.ASTROMETRY_API_KEY = savedApiKeyEnv;
});

beforeEach(() => {
  recorded = [];
  upstream = { status: 200, body: '' };
});

async function call(method: string, url: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await realFetch(base + url, init);
  return { status: res.status, body: (await res.json()) as any };
}

// ─── POST /api/skybot/conesearch ─────────────────────────────────────────────

describe('POST /api/skybot/conesearch', () => {
  const GOOD = { raDeg: 186.9, decDeg: 13.0, radiusArcmin: 5, epochJd: 2461139.5 };

  it('sends one GET to SkyBoT with the cone and answers with the candidates', async () => {
    upstream = { status: 200, body: SKYBOT_FIXTURE };
    const r = await call('POST', '/api/skybot/conesearch', GOOD);
    expect(r.status).toBe(200);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].method).toBe('GET');
    const url = new URL(recorded[0].url);
    expect(url.origin + url.pathname).toBe(
      'https://ssp.imcce.fr/webservices/skybot/api/conesearch.php',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      '-ra': '186.9',
      '-dec': '13',
      '-rd': '5',
      '-ep': '2461139.5',
      '-mime': 'json',
      '-output': 'obs',
      '-loc': '500',
      '-filter': '0',
      '-objFilter': '100',
      '-from': 'MyAstroSky',
    });
    expect(Object.keys(recorded[0].headers)).toEqual([]);
    const asteroid = r.body.candidates.find((c: any) => c.number === '18799');
    expect(asteroid.name).toBe('1999 JZ73');
    expect(asteroid.raDeg).toBeCloseTo(186.965976, 4);
    expect(Object.keys(r.body)).toEqual(['candidates']);
  });

  it('answers an empty upstream body with an empty list', async () => {
    const r = await call('POST', '/api/skybot/conesearch', GOOD);
    expect(r).toEqual({ status: 200, body: { candidates: [] } });
  });

  it('answers 502 with the upstream status when SkyBoT fails (English by default)', async () => {
    upstream = { status: 503, body: 'down for maintenance' };
    const r = await call('POST', '/api/skybot/conesearch', GOOD);
    expect(r).toEqual({
      status: 502,
      body: { error: 'SkyBoT error: SkyBoT request failed (503): down for maintenance' },
    });
  });

  it('answers 502 in French when asked and the body is an IMCCE error header', async () => {
    upstream = { status: 200, body: '# Flag: -1\n# Ticket: 1\ncalceph_compute_unit error #0' };
    const r = await call('POST', '/api/skybot/conesearch', { ...GOOD, lang: 'fr' });
    expect(r).toEqual({
      status: 502,
      body: { error: 'Erreur SkyBoT : SkyBoT error: calceph_compute_unit error #0' },
    });
  });

  it('answers 502 when the request itself fails', async () => {
    upstream = { reject: 'ECONNRESET' };
    const r = await call('POST', '/api/skybot/conesearch', GOOD);
    expect(r).toEqual({
      status: 502,
      body: { error: 'SkyBoT error: SkyBoT request failed: ECONNRESET' },
    });
  });

  it('answers 502 when the body is not JSON', async () => {
    upstream = { status: 200, body: 'not json' };
    const r = await call('POST', '/api/skybot/conesearch', GOOD);
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/^SkyBoT error: SkyBoT returned an unexpected response: /);
  });

  it.each([
    ['raDeg below 0', { raDeg: -1 }],
    ['raDeg above 360', { raDeg: 361 }],
    ['decDeg below -90', { decDeg: -91 }],
    ['decDeg above 90', { decDeg: 91 }],
    ['radiusArcmin zero', { radiusArcmin: 0 }],
    ['radiusArcmin above 60', { radiusArcmin: 61 }],
    ['epochJd zero', { epochJd: 0 }],
    ['raDeg not a number', { raDeg: 'abc' }],
    ['epochJd missing', { epochJd: undefined }],
  ])('rejects %s with 400 and never calls SkyBoT', async (_label, change) => {
    const r = await call('POST', '/api/skybot/conesearch', { ...GOOD, ...change });
    expect(r).toEqual({
      status: 400,
      body: { error: 'Invalid SkyBoT search parameters', code: 'INVALID_PARAMS' },
    });
    expect(recorded).toHaveLength(0);
  });

  it('writes the rejection in French when asked', async () => {
    const r = await call('POST', '/api/skybot/conesearch', { ...GOOD, raDeg: 400, lang: 'fr' });
    expect(r).toEqual({
      status: 400,
      body: { error: 'Paramètres de recherche SkyBoT invalides', code: 'INVALID_PARAMS' },
    });
  });
});

// ─── POST /api/tns/conesearch ────────────────────────────────────────────────

describe('POST /api/tns/conesearch', () => {
  const GOOD = {
    raDeg: 339.2671,
    decDeg: 34.4159,
    radiusArcmin: 20,
    dateStart: '2025-09-04',
    dateEnd: '2026-11-03',
  };

  it('sends one GET to TNS with the snapped cone and the User-Agent, and answers with the candidates', async () => {
    upstream = { status: 200, body: TNS_FIXTURE };
    const r = await call('POST', '/api/tns/conesearch', GOOD);
    expect(r.status).toBe(200);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers['user-agent']).toBe('MyAstroSky');
    const url = new URL(recorded[0].url);
    expect(url.origin + url.pathname).toBe('https://www.wis-tns.org/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ra: '339.27',
      decl: '34.42',
      radius: '21',
      coords_unit: 'arcmin',
      format: 'csv',
      num_page: '100',
      'date_start[date]': '2025-09-04',
      'date_end[date]': '2026-11-03',
    });
    expect(r.body.candidates).toHaveLength(8);
    const sn = r.body.candidates.find((c: any) => c.name === 'SN 2026aaiv');
    expect(sn.classified).toBe(true);
    expect(sn.tnsUrl).toBe('https://www.wis-tns.org/object/2026aaiv');
  });

  it('serves a repeated cone from the cache without a second request', async () => {
    const r = await call('POST', '/api/tns/conesearch', GOOD);
    expect(r.status).toBe(200);
    expect(r.body.candidates).toHaveLength(8);
    expect(recorded).toHaveLength(0);
  });

  it('answers 429 with the reset delay (English), then in French with the default delay', async () => {
    upstream = {
      status: 429,
      body: '{"id_code":429}',
      headers: { 'x-cone-rate-limit-reset': '42' },
    };
    const cone = { ...GOOD, raDeg: 10 };
    const en = await call('POST', '/api/tns/conesearch', cone);
    expect(en).toEqual({
      status: 429,
      body: {
        error: 'The TNS server is rate-limiting searches — try again in 42 s',
        code: 'RATE_LIMITED',
      },
    });
    upstream = { status: 429, body: '' };
    const fr = await call('POST', '/api/tns/conesearch', { ...cone, lang: 'fr' });
    expect(fr).toEqual({
      status: 429,
      body: {
        error: 'Le serveur TNS limite les recherches — réessayez dans 60 s',
        code: 'RATE_LIMITED',
      },
    });
  });

  it('answers 502 on an upstream HTTP error', async () => {
    upstream = { status: 500, body: 'boom' };
    const r = await call('POST', '/api/tns/conesearch', { ...GOOD, raDeg: 20 });
    expect(r).toEqual({
      status: 502,
      body: { error: 'TNS error: TNS request failed (500): boom' },
    });
  });

  it('answers 502 on an HTML page returned with status 200, and on a failed request', async () => {
    upstream = { status: 200, body: '<html>Maintenance</html>' };
    const html = await call('POST', '/api/tns/conesearch', { ...GOOD, raDeg: 30 });
    expect(html).toEqual({
      status: 502,
      body: { error: 'TNS error: TNS returned an unexpected response: <html>Maintenance</html>' },
    });
    upstream = { reject: 'ECONNRESET' };
    const failed = await call('POST', '/api/tns/conesearch', { ...GOOD, raDeg: 40, lang: 'fr' });
    expect(failed).toEqual({
      status: 502,
      body: { error: 'Erreur TNS : TNS request failed: ECONNRESET' },
    });
  });

  it('does not cache a failed search', async () => {
    const cone = { ...GOOD, raDeg: 50 };
    upstream = { status: 500, body: 'boom' };
    await call('POST', '/api/tns/conesearch', cone);
    upstream = { status: 200, body: TNS_FIXTURE };
    const r = await call('POST', '/api/tns/conesearch', cone);
    expect(r.status).toBe(200);
    expect(recorded).toHaveLength(2);
  });

  it('answers an empty upstream body with an empty list', async () => {
    const r = await call('POST', '/api/tns/conesearch', { ...GOOD, raDeg: 60 });
    expect(r).toEqual({ status: 200, body: { candidates: [] } });
  });

  it.each([
    ['raDeg above 360', { raDeg: 361 }],
    ['decDeg below -90', { decDeg: -91 }],
    ['radiusArcmin zero', { radiusArcmin: 0 }],
    ['radiusArcmin above 60', { radiusArcmin: 61 }],
    ['dateStart missing', { dateStart: undefined }],
    ['dateStart malformed', { dateStart: '2025/09/04' }],
    ['dateEnd not a date', { dateEnd: '2026-13-45' }],
    ['dateStart after dateEnd', { dateStart: '2026-12-01' }],
  ])('rejects %s with 400 and never calls TNS', async (_label, change) => {
    const r = await call('POST', '/api/tns/conesearch', { ...GOOD, ...change });
    expect(r).toEqual({
      status: 400,
      body: { error: 'Invalid TNS search parameters', code: 'INVALID_PARAMS' },
    });
    expect(recorded).toHaveLength(0);
  });

  it('writes the rejection in French when asked', async () => {
    const r = await call('POST', '/api/tns/conesearch', { ...GOOD, radiusArcmin: 99, lang: 'fr' });
    expect(r.body).toEqual({
      error: 'Paramètres de recherche TNS invalides',
      code: 'INVALID_PARAMS',
    });
  });
});

// ─── GET /api/comets/elements (order matters: nothing is cached until the success) ───

describe('GET /api/comets/elements', () => {
  const MPC = 'https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt';

  it('answers 502 when the MPC fails and nothing is cached (English by default)', async () => {
    upstream = { status: 503, body: 'Service Unavailable' };
    const r = await call('GET', '/api/comets/elements');
    expect(r).toEqual({
      status: 502,
      body: {
        error: 'Could not load comet orbits (MPC): MPC request failed (503): Service Unavailable',
      },
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ url: MPC, method: 'GET' });
    expect(recorded[0].headers['user-agent']).toBe('MyAstroSky');
  });

  it('answers 502 in French when the file holds no comet, and when the request fails', async () => {
    upstream = { status: 200, body: '<html>maintenance</html>' };
    const empty = await call('GET', '/api/comets/elements?lang=fr');
    expect(empty).toEqual({
      status: 502,
      body: {
        error:
          'Impossible de charger les orbites des comètes (MPC) : MPC returned no comet elements: <html>maintenance</html>',
      },
    });
    upstream = { reject: 'ECONNRESET' };
    const failed = await call('GET', '/api/comets/elements');
    expect(failed).toEqual({
      status: 502,
      body: { error: 'Could not load comet orbits (MPC): MPC request failed: ECONNRESET' },
    });
  });

  it('answers with the parsed elements, then serves the cache without a second request', async () => {
    upstream = { status: 200, body: COMET_FIXTURE };
    const first = await call('GET', '/api/comets/elements');
    expect(first.status).toBe(200);
    expect(first.body.comets).toHaveLength(7);
    expect(Object.keys(first.body)).toEqual(['comets']);
    expect(Object.keys(first.body.comets[0]).sort()).toEqual(
      ['designation', 'e', 'h', 'incl', 'k', 'name', 'node', 'peri', 'q', 'tpJd'].sort(),
    );
    expect(recorded).toHaveLength(1);

    const second = await call('GET', '/api/comets/elements');
    expect(second).toEqual(first);
    expect(recorded).toHaveLength(1);
  });
});
// ─── GET /api/horizon ─────────────────────────────────────────────────────────

describe('GET /api/horizon', () => {
  const TILE_URL =
    /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/12\/\d+\/\d+\.png$/;
  const OVERPASS_URLS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  const PEAKS = JSON.stringify({
    elements: [
      {
        type: 'node',
        lat: 45.123,
        lon: 6.48,
        tags: { name: 'Pic Test', ele: '2500' },
      },
      { type: 'node', lat: 45.1, lon: 6.4, tags: { ele: '900' } },
    ],
  });

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

  const answer =
    (overpass: UpstreamReply, tileReply?: UpstreamReply) =>
    (url: string): UpstreamReply =>
      TILE_URL.test(url) ? (tileReply ?? { status: 200, body: tile }) : overpass;

  const tileRequests = () => recorded.filter((r) => TILE_URL.test(r.url));
  const overpassRequests = () => recorded.filter((r) => r.url.includes('/api/interpreter'));

  it.each([
    ['lat missing', '?lon=6'],
    ['lon missing', '?lat=45'],
    ['lat not a number', '?lat=abc&lon=6'],
    ['lat above 90', '?lat=91&lon=6'],
    ['lat below -90', '?lat=-91&lon=6'],
  ])('rejects %s with 400 and calls nobody', async (_label, query) => {
    const r = await call('GET', `/api/horizon${query}`);
    expect(r).toEqual({
      status: 400,
      body: { error: 'Invalid or missing lat/lon' },
    });
    expect(recorded).toHaveLength(0);
  });

  it('fetches the DEM tiles and the peaks, answers with the profile, then serves the cache', async () => {
    upstream = answer({ status: 200, body: PEAKS });
    const r = await call('GET', '/api/horizon?lat=45.123&lon=6.456&radiusKm=3&obsHeightM=2');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body)).toEqual([
      'lat',
      'lon',
      'obsHeightM',
      'azStepDeg',
      'alts',
      'layers',
      'summits',
      'source',
    ]);
    expect(r.body).toMatchObject({
      lat: 45.123,
      lon: 6.456,
      obsHeightM: 2,
      azStepDeg: 1,
      source: 'auto',
    });
    expect(r.body.alts).toHaveLength(360);
    expect(r.body.layers.map((l: any) => l.maxDistKm)).toEqual([2, 3]);
    expect(r.body.layers[1].alts).toEqual(r.body.alts);
    expect(r.body.alts[90]).toBeCloseTo(4.1967, 3);
    expect(r.body.alts[270]).toBeCloseTo(-4.296, 3);
    expect(r.body.layers[0].alts[90]).toBeCloseTo(4.1811, 3);
    expect(r.body.summits).toHaveLength(1);
    expect(r.body.summits[0]).toMatchObject({ name: 'Pic Test', elevationM: 2500 });

    expect(tileRequests().length).toBeGreaterThan(0);
    for (const t of tileRequests()) {
      expect(t.method).toBe('GET');
      expect(t.headers).toEqual({});
    }
    const peaks = overpassRequests();
    expect(peaks).toHaveLength(1);
    expect(peaks[0].url).toBe(OVERPASS_URLS[0]);
    expect(peaks[0].method).toBe('POST');
    expect(peaks[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(peaks[0].headers['user-agent']).toBe('MyAstroSky (astro horizon feature)');
    const query = decodeURIComponent(peaks[0].body!.replace(/^data=/, ''));
    expect(query).toMatch(/^\[out:json\]\[timeout:30\];node\[natural=peak\]\(/);
    expect(query).toMatch(/\);out;$/);

    // Same rounded location (3 decimals), radius and eye height: the cache answers.
    recorded = [];
    const again = await call('GET', '/api/horizon?lat=45.1231&lon=6.4561&radiusKm=3&obsHeightM=2');
    expect(again.status).toBe(200);
    expect(again.body).toEqual(r.body);
    expect(recorded).toHaveLength(0);
  });

  it('keys the cache on the eye height: no obsHeightM is a new computation answering null', async () => {
    upstream = answer({ status: 200, body: PEAKS });
    const r = await call('GET', '/api/horizon?lat=45.123&lon=6.456&radiusKm=3');
    expect(r.status).toBe(200);
    expect(r.body.obsHeightM).toBeNull();
    expect(tileRequests().length).toBeGreaterThan(0);
  });

  it('treats a missing tile as sea level and still answers 200', async () => {
    upstream = answer({ status: 200, body: '{"elements":[]}' }, { status: 404, body: 'nope' });
    const r = await call('GET', '/api/horizon?lat=10.5&lon=20.5&radiusKm=3');
    expect(r.status).toBe(200);
    expect(r.body.summits).toEqual([]);
    for (const a of r.body.alts) expect(a).toBeCloseTo(-0.0442, 3);
  });

  it('answers 200 with no summits when every Overpass attempt fails, trying the four endpoints in order', async () => {
    upstream = answer({ status: 503, body: 'overloaded' });
    const r = await call('GET', '/api/horizon?lat=30.5&lon=30.5&radiusKm=3');
    expect(r.status).toBe(200);
    expect(r.body.summits).toEqual([]);
    expect(r.body.alts).toHaveLength(360);
    expect(overpassRequests().map((q) => q.url)).toEqual(OVERPASS_URLS);
  }, 15_000);

  it('answers 502 when a tile request fails, and caches nothing', async () => {
    upstream = { reject: 'ECONNRESET' };
    const r = await call('GET', '/api/horizon?lat=-20.5&lon=140.5&radiusKm=3');
    expect(r).toEqual({
      status: 502,
      body: { error: 'Failed to compute horizon from elevation data' },
    });
    upstream = answer({ status: 200, body: '{"elements":[]}' });
    const retry = await call('GET', '/api/horizon?lat=-20.5&lon=140.5&radiusKm=3');
    expect(retry.status).toBe(200);
  });

  it('answers 502 when a tile is not a readable image', async () => {
    upstream = answer({ status: 200, body: '{"elements":[]}' }, { status: 200, body: 'not a png' });
    const r = await call('GET', '/api/horizon?lat=-30.5&lon=150.5&radiusKm=3');
    expect(r).toEqual({
      status: 502,
      body: { error: 'Failed to compute horizon from elevation data' },
    });
  });

  it('answers 502 before any request when the radius needs more than 400 tiles (clamped to 100 km)', async () => {
    upstream = answer({ status: 200, body: PEAKS });
    for (const radius of ['100', '1000']) {
      const r = await call('GET', `/api/horizon?lat=45.5&lon=7.5&radiusKm=${radius}`);
      expect(r).toEqual({
        status: 502,
        body: { error: 'Failed to compute horizon from elevation data' },
      });
    }
    expect(recorded).toHaveLength(0);
  });

  it('uses a 40 km radius when radiusKm is not a number', async () => {
    upstream = answer({ status: 200, body: '{"elements":[]}' });
    const r = await call('GET', '/api/horizon?lat=60.5&lon=10.5&radiusKm=abc');
    expect(r.status).toBe(200);
    expect(r.body.layers.map((l: any) => l.maxDistKm)).toEqual([2, 4, 7, 11, 16, 23, 40]);
  }, 30_000);
});
// ─── Already-solved files (WP2.7f): no network, synthetic FITS and TIFF ──────

describe('solved-file routes (POST /api/solve-wcs, POST /api/photos/convert)', async () => {
  const { buildFits } = await import('../fixtures/fits-builders');
  const { buildTiff } = await import('../fixtures/tiff-builders');

  // A 40x30 mono FITS whose WCS (0.1 deg per pixel, centred on star 99001) holds the three
  // northern stars of tests/fixtures/stars.test.json.
  const WCS_CARDS = [
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
  const EMPTY_SKY_CARDS = WCS_CARDS.map((c) =>
    c.startsWith('CRVAL1') ? 'CRVAL1  = 10' : c.startsWith('CRVAL2') ? 'CRVAL2  = -40' : c,
  );
  const fits = (extraCards: string[] = WCS_CARDS, naxis1 = 40) =>
    buildFits({
      bitpix: -32,
      naxis1,
      naxis2: 30,
      roworder: 'TOP-DOWN',
      pixels: Array.from({ length: naxis1 * 30 }, (_, i) => (i % 7) / 7),
      extraCards,
    });
  const tiff = () =>
    buildTiff({
      width: 4,
      height: 3,
      bitsPerSample: 8,
      sampleFormat: 1,
      samplesPerPixel: 1,
      photometric: 1,
      pixels: Array.from({ length: 12 }, (_, i) => i * 20),
    });

  let savedCatalog: string | undefined;
  beforeAll(() => {
    savedCatalog = process.env.STAR_CATALOG_PATH;
    process.env.STAR_CATALOG_PATH = path.join(FIXTURES, 'stars.test.json');
  });
  afterAll(() => {
    if (savedCatalog === undefined) delete process.env.STAR_CATALOG_PATH;
    else process.env.STAR_CATALOG_PATH = savedCatalog;
  });

  async function upload(
    url: string,
    file: { name: string; bytes: Uint8Array } | null,
    fields: Record<string, string> = {},
  ) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (file) form.append('photo', new Blob([file.bytes as BlobPart]), file.name);
    const res = await realFetch(base + url, { method: 'POST', body: form });
    return { status: res.status, body: (await res.json()) as any };
  }

  describe('POST /api/solve-wcs', () => {
    it('answers 400 NO_FILE, in English by default and in French when asked', async () => {
      const en = await upload('/api/solve-wcs', null);
      expect(en.status).toBe(400);
      expect(en.body).toEqual({
        success: false,
        error: 'No file provided',
        code: 'NO_FILE',
      });
      const fr = await upload('/api/solve-wcs', null, { lang: 'fr' });
      expect(fr.body.error).toBe('Aucun fichier fourni');
    });

    it('answers 400 UNSUPPORTED_FORMAT for an extension that is not FITS or TIFF', async () => {
      const r = await upload('/api/solve-wcs', {
        name: 'photo.jpg',
        bytes: fits(),
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({
        success: false,
        error: 'Unsupported format. Use TIFF or FITS.',
        code: 'UNSUPPORTED_FORMAT',
      });
    });

    it('answers 200 NO_WCS_DATA for a FITS and a TIFF without a solution', async () => {
      for (const file of [
        { name: 'a.fits', bytes: fits([]) },
        { name: 'a.TIF', bytes: tiff() },
      ]) {
        const r = await upload('/api/solve-wcs', file);
        expect(r.status).toBe(200);
        expect(r.body).toEqual({
          success: false,
          error: 'No WCS metadata found in this file. The file was not plate-solved.',
          code: 'NO_WCS_DATA',
        });
      }
    });

    it('answers 200 NO_IMAGE_DIMENSIONS when the header holds a solution but no size', async () => {
      const r = await upload(
        '/api/solve-wcs',
        { name: 'a.fit', bytes: fits(WCS_CARDS, 0) },
        { lang: 'fr' },
      );
      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        success: false,
        error: "Dimensions de l'image introuvables",
        code: 'NO_IMAGE_DIMENSIONS',
      });
    });

    it('falls back to synthetic points when the field holds no catalogue star', async () => {
      const r = await upload('/api/solve-wcs', {
        name: 'a.fits',
        bytes: fits(EMPTY_SKY_CARDS),
      });
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
      expect(r.body.correspondences.length).toBeGreaterThanOrEqual(3);
      expect(r.body.correspondences[0].starName).toBe('Synthetic 1');
      expect(r.body.correspondences[0].starHip).toBe(0);
    });

    it('answers the correspondences and the header metadata for a solved FITS', async () => {
      const r = await upload('/api/solve-wcs', {
        name: 'a.fits',
        bytes: fits(),
      });
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
      expect(r.body.sourceWidth).toBe(40);
      expect(r.body.sourceHeight).toBe(30);
      expect(r.body.dimensionWarning).toBeUndefined();
      expect(r.body.dateObs).toBe('2025-09-04T21:30:00Z');
      expect(r.body.expTime).toBe(300);
      expect(r.body.stackCnt).toBe(12);
      expect(r.body.filter).toBe('Ha');
      const hips = r.body.correspondences.map((c: any) => c.starHip).sort();
      expect(hips).toEqual([99001, 99002, 99003]);
      const first = r.body.correspondences.find((c: any) => c.starHip === 99001);
      expect(first.photoX).toBeCloseTo(19.5, 3);
      expect(first.photoY).toBeCloseTo(14.5, 3);
      expect(Object.keys(r.body)).toEqual([
        'success',
        'correspondences',
        'sourceWidth',
        'sourceHeight',
        'dateObs',
        'expTime',
        'stackCnt',
        'filter',
      ]);
    });

    it('rescales to the target size and flags an aspect mismatch', async () => {
      const same = await upload(
        '/api/solve-wcs',
        { name: 'a.fits', bytes: fits() },
        { targetWidth: '80', targetHeight: '60' },
      );
      expect(same.body.dimensionWarning).toEqual({
        sourceW: 40,
        sourceH: 30,
        targetW: 80,
        targetH: 60,
        aspectMismatch: false,
      });
      const c1 = same.body.correspondences.find((c: any) => c.starHip === 99001);
      expect(c1.photoX).toBeCloseTo(39, 3);
      expect(c1.photoY).toBeCloseTo(29, 3);
      const skew = await upload(
        '/api/solve-wcs',
        { name: 'a.fits', bytes: fits() },
        { targetWidth: '80', targetHeight: '30' },
      );
      expect(skew.body.dimensionWarning.aspectMismatch).toBe(true);
      // a target equal to the source, or an unusable one, changes nothing
      for (const fields of [
        { targetWidth: '40', targetHeight: '30' },
        { targetWidth: 'abc', targetHeight: '30' },
      ]) {
        const r = await upload('/api/solve-wcs', { name: 'a.fits', bytes: fits() }, fields);
        expect(r.body.dimensionWarning).toBeUndefined();
      }
    });
  });

  describe('POST /api/photos/convert', () => {
    it('answers 400 NO_FILE and 400 UNSUPPORTED_FORMAT', async () => {
      const none = await upload('/api/photos/convert', null);
      expect(none.status).toBe(400);
      expect(none.body).toEqual({
        success: false,
        error: 'No file provided',
        code: 'NO_FILE',
      });
      const jpg = await upload('/api/photos/convert', {
        name: 'x.jpg',
        bytes: tiff(),
      });
      expect(jpg.status).toBe(400);
      expect(jpg.body).toEqual({
        success: false,
        error: 'Unsupported raw format: .jpg. Use TIFF or FITS.',
        code: 'UNSUPPORTED_FORMAT',
      });
    });

    it('answers 400 UNSUPPORTED_RAW_FORMAT when the pixel layout cannot be decoded', async () => {
      const cube = buildFits({
        bitpix: -32,
        naxis1: 2,
        naxis2: 2,
        naxis3: 2,
        pixels: new Array(8).fill(0.5),
      });
      const r = await upload('/api/photos/convert', {
        name: 'x.fits',
        bytes: cube,
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({
        success: false,
        error: 'Could not convert the raw file: Unsupported FITS axis layout: NAXIS=3, NAXIS3=2',
        code: 'UNSUPPORTED_RAW_FORMAT',
      });
    });

    it("answers 500 with the decoder's message when the file is not decodable at all", async () => {
      const r = await upload('/api/photos/convert', {
        name: 'x.tif',
        bytes: new Uint8Array([1, 2, 3, 4]),
      });
      expect(r.status).toBe(500);
      expect(r.body).toEqual({
        success: false,
        error: 'Buffer too small to be a TIFF file',
      });
    });

    it('returns the PNG with success:false and NO_WCS_DATA for a TIFF without a solution', async () => {
      const r = await upload('/api/photos/convert', {
        name: 'x.tiff',
        bytes: tiff(),
      });
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(false);
      expect(r.body.code).toBe('NO_WCS_DATA');
      expect(r.body.error).toBe(
        'No WCS metadata found in this file. The file was not plate-solved.',
      );
      expect(r.body.correspondences).toBeUndefined();
      expect([r.body.sourceWidth, r.body.sourceHeight, r.body.width, r.body.height]).toEqual([
        4, 3, 4, 3,
      ]);
      const png = Buffer.from(r.body.pngBase64, 'base64');
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      const meta = await sharp(png).metadata();
      expect([meta.width, meta.height, meta.channels]).toEqual([4, 3, 1]);
      expect([...(await sharp(png).greyscale().raw().toBuffer())]).toEqual(
        Array.from({ length: 12 }, (_, i) => i * 20),
      );
    });

    it('returns the PNG, the correspondences and the metadata for a solved FITS', async () => {
      const r = await upload('/api/photos/convert', {
        name: 'x.fits',
        bytes: fits(),
      });
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
      expect(r.body.error).toBeUndefined();
      expect(r.body.correspondences.map((c: any) => c.starHip).sort()).toEqual([
        99001, 99002, 99003,
      ]);
      expect([r.body.sourceWidth, r.body.sourceHeight, r.body.width, r.body.height]).toEqual([
        40, 30, 40, 30,
      ]);
      expect(r.body.dateObs).toBe('2025-09-04T21:30:00Z');
      expect(r.body.expTime).toBe(300);
      expect(r.body.stackCnt).toBe(12);
      expect(r.body.filter).toBe('Ha');
      const png = Buffer.from(r.body.pngBase64, 'base64');
      const meta = await sharp(png).metadata();
      expect([meta.format, meta.width, meta.height, meta.channels]).toEqual(['png', 40, 30, 1]);
      expect(Object.keys(r.body)).toEqual([
        'success',
        'correspondences',
        'sourceWidth',
        'sourceHeight',
        'width',
        'height',
        'pngBase64',
        'dateObs',
        'expTime',
        'stackCnt',
        'filter',
      ]);
    });

    it('returns synthetic points with the PNG when the field holds no catalogue star', async () => {
      const r = await upload('/api/photos/convert', {
        name: 'x.fits',
        bytes: fits(EMPTY_SKY_CARDS),
      });
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
      expect(r.body.correspondences[0].starName).toBe('Synthetic 1');
      expect(r.body.pngBase64.length).toBeGreaterThan(10);
    });
  });
});
