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
