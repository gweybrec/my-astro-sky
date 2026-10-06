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
    const headers = headersOf(init);
    let body: string | undefined;
    if (typeof init?.body === 'string') body = init.body;
    else if (init?.body instanceof FormData) {
      // What `fetch` would put on the wire: the multipart text and its content type.
      const wire = new Response(init.body);
      headers['content-type'] ??= wire.headers.get('content-type') ?? '';
      body = Buffer.from(await wire.arrayBuffer()).toString('latin1');
    } else if (init?.body) body = Buffer.from(init.body as Uint8Array).toString('latin1');
    // The background polling of a submitted astrometry.net job (3 s after the upload) is not a request of the case that is running.
    if (!url.startsWith('https://nova.astrometry.net/api/submissions/'))
      recorded.push({ url, method: init?.method ?? 'GET', headers, body });
    const reply = typeof upstream === 'function' ? upstream(url) : upstream;
    if ('reject' in reply) throw new Error(reply.reject);
    return new Response(reply.body as BodyInit, { status: reply.status, headers: reply.headers });
  });
}, 30_000);

afterAll(async () => {
  // Never back to the real `fetch`: a polling timer of an online-solving job may still fire.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('network blocked after the tests')));
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
      body: {
        error: 'SkyBoT error: SkyBoT request failed (503): down for maintenance',
        code: 'SKYBOT_FAILED',
      },
    });
  });

  it('answers 502 in French when asked and the body is an IMCCE error header', async () => {
    upstream = { status: 200, body: '# Flag: -1\n# Ticket: 1\ncalceph_compute_unit error #0' };
    const r = await call('POST', '/api/skybot/conesearch', { ...GOOD, lang: 'fr' });
    expect(r).toEqual({
      status: 502,
      body: {
        error: 'Erreur SkyBoT : SkyBoT error: calceph_compute_unit error #0',
        code: 'SKYBOT_FAILED',
      },
    });
  });

  it('answers 502 when the request itself fails', async () => {
    upstream = { reject: 'ECONNRESET' };
    const r = await call('POST', '/api/skybot/conesearch', GOOD);
    expect(r).toEqual({
      status: 502,
      body: { error: 'SkyBoT error: SkyBoT request failed: ECONNRESET', code: 'SKYBOT_FAILED' },
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
      body: { error: 'TNS error: TNS request failed (500): boom', code: 'TNS_FAILED' },
    });
  });

  it('answers 502 on an HTML page returned with status 200, and on a failed request', async () => {
    upstream = { status: 200, body: '<html>Maintenance</html>' };
    const html = await call('POST', '/api/tns/conesearch', { ...GOOD, raDeg: 30 });
    expect(html).toEqual({
      status: 502,
      body: {
        error: 'TNS error: TNS returned an unexpected response: <html>Maintenance</html>',
        code: 'TNS_FAILED',
      },
    });
    upstream = { reject: 'ECONNRESET' };
    const failed = await call('POST', '/api/tns/conesearch', { ...GOOD, raDeg: 40, lang: 'fr' });
    expect(failed).toEqual({
      status: 502,
      body: { error: 'Erreur TNS : TNS request failed: ECONNRESET', code: 'TNS_FAILED' },
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
        code: 'COMET_ELEMENTS_FAILED',
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
        code: 'COMET_ELEMENTS_FAILED',
      },
    });
    upstream = { reject: 'ECONNRESET' };
    const failed = await call('GET', '/api/comets/elements');
    expect(failed).toEqual({
      status: 502,
      body: {
        error: 'Could not load comet orbits (MPC): MPC request failed: ECONNRESET',
        code: 'COMET_ELEMENTS_FAILED',
      },
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
      body: { error: 'Invalid or missing lat/lon', code: 'INVALID_LAT_LON' },
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
      body: {
        error: 'Failed to compute horizon from elevation data',
        code: 'HORIZON_COMPUTE_FAILED',
      },
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
      body: {
        error: 'Failed to compute horizon from elevation data',
        code: 'HORIZON_COMPUTE_FAILED',
      },
    });
  });

  it('answers 502 before any request when the radius needs more than 400 tiles (clamped to 100 km)', async () => {
    upstream = answer({ status: 200, body: PEAKS });
    for (const radius of ['100', '1000']) {
      const r = await call('GET', `/api/horizon?lat=45.5&lon=7.5&radiusKm=${radius}`);
      expect(r).toEqual({
        status: 502,
        body: {
          error: 'Failed to compute horizon from elevation data',
          code: 'HORIZON_COMPUTE_FAILED',
        },
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
// ─── Online solving (astrometry.net) ─────────────────────────────────────────

describe('online solving routes (astrometry.net)', () => {
  const API = 'https://nova.astrometry.net/api';
  const WCS_FIXTURE = fs.readFileSync(
    path.join(FIXTURES, 'astrometry/10796000-wcs.fits'),
    'latin1',
  );
  const OBJECTS_FIXTURE = fs.readFileSync(
    path.join(FIXTURES, 'astrometry/10796000-objects.json'),
    'utf8',
  );
  const CAL_FIXTURE = fs.readFileSync(
    path.join(FIXTURES, 'astrometry/10796000-calibration.json'),
    'utf8',
  );
  let savedCatalog: string | undefined;
  let png: Uint8Array;

  beforeAll(async () => {
    savedCatalog = process.env.STAR_CATALOG_PATH;
    process.env.STAR_CATALOG_PATH = path.join(FIXTURES, 'stars.test.json');
    png = new Uint8Array(
      await sharp({
        create: {
          width: 8,
          height: 6,
          channels: 3,
          background: { r: 9, g: 9, b: 9 },
        },
      })
        .png()
        .toBuffer(),
    );
  });
  afterAll(() => {
    if (savedCatalog === undefined) delete process.env.STAR_CATALOG_PATH;
    else process.env.STAR_CATALOG_PATH = savedCatalog;
  });

  async function post(
    url: string,
    file: { name: string; bytes: Uint8Array } | null,
    fields: Record<string, string> = {},
  ) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (file)
      form.append('photo', new Blob([file.bytes as BlobPart], { type: 'image/png' }), file.name);
    const res = await realFetch(base + url, { method: 'POST', body: form });
    return { status: res.status, body: (await res.json()) as any };
  }

  const json = (data: unknown): UpstreamReply => ({
    status: 200,
    body: JSON.stringify(data),
  });
  /** The body of the multipart part called `name`, without its trailing CRLF. */
  const partOf = (multipart: string, name: string) =>
    new RegExp(
      `name="${name}"(?:[^\\r\\n]*)\\r\\n(?:[^\\r\\n]+\\r\\n)*\\r\\n([\\s\\S]*?)\\r\\n--`,
    ).exec(multipart)?.[1];
  const formJson = (body: string) =>
    JSON.parse(decodeURIComponent(body.replace('request-json=', '')));

  it('refuses every route with ASTROMETRY_NOT_CONFIGURED while no key is set', async () => {
    const solve = await post('/api/solve-plate', { name: 'a.png', bytes: png });
    expect(solve.status).toBe(400);
    expect(solve.body).toEqual({
      error: 'ASTROMETRY_API_KEY not configured on server',
      code: 'ASTROMETRY_NOT_CONFIGURED',
    });
    const fr = await post('/api/solve-plate', { name: 'a.png', bytes: png }, { lang: 'fr' });
    expect(fr.body.error).toBe('ASTROMETRY_API_KEY non configurée sur le serveur');
    const list = await call('GET', '/api/astrometry/submissions');
    expect(list.status).toBe(400);
    expect(list.body).toEqual({
      error: 'ASTROMETRY_API_KEY not configured',
      code: 'ASTROMETRY_NOT_CONFIGURED',
    });
    const reuse = await post('/api/astrometry/reuse', {
      name: 'a.png',
      bytes: png,
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body).toEqual({
      error: 'ASTROMETRY_API_KEY not configured',
      code: 'ASTROMETRY_NOT_CONFIGURED',
    });
    expect((await post('/api/astrometry/reuse', null, { lang: 'fr' })).body.error).toBe(
      'ASTROMETRY_API_KEY non configurée',
    );
    expect(recorded).toHaveLength(0);
  });

  it('answers 404 JOB_NOT_FOUND for an unknown job', async () => {
    const r = await call('GET', '/api/solve-plate/nope');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'Job introuvable', code: 'JOB_NOT_FOUND' });
  });

  describe('with an API key', () => {
    beforeAll(async () => {
      const r = await call('PUT', '/api/settings', { apiKey: 'test-key' });
      expect(r.status).toBe(200);
    });

    it('rejects a missing file, an unreadable image and an invalid job id before any request', async () => {
      const none = await post('/api/solve-plate', null, { lang: 'fr' });
      expect(none.status).toBe(400);
      expect(none.body).toEqual({
        error: 'Aucun fichier fourni',
        code: 'NO_FILE',
      });
      expect((await post('/api/solve-plate', null)).body.error).toBe('No file provided');

      const bad = await post('/api/solve-plate', {
        name: 'x.txt',
        bytes: new Uint8Array([1, 2, 3]),
      });
      expect(bad.status).toBe(400);
      expect(bad.body).toEqual({
        error: 'Cannot determine image dimensions',
        code: 'CANNOT_DETERMINE_DIMENSIONS',
      });
      const badFr = await post(
        '/api/solve-plate',
        { name: 'x.txt', bytes: new Uint8Array([1]) },
        { lang: 'fr' },
      );
      expect(badFr.body.error).toBe("Impossible de déterminer les dimensions de l'image");

      const noJob = await post('/api/astrometry/reuse', {
        name: 'a.png',
        bytes: png,
      });
      expect(noJob.status).toBe(400);
      expect(noJob.body).toEqual({
        error: 'Invalid job ID',
        code: 'INVALID_JOB_ID',
      });
      const noJobFr = await post(
        '/api/astrometry/reuse',
        { name: 'a.png', bytes: png },
        { jobId: 'abc', lang: 'fr' },
      );
      expect(noJobFr.body.error).toBe('Job ID invalide');
      const reuseBad = await post(
        '/api/astrometry/reuse',
        { name: 'x.txt', bytes: new Uint8Array([1]) },
        { jobId: '5' },
      );
      expect(reuseBad.status).toBe(400);
      expect(reuseBad.body).toEqual({
        error: 'Cannot determine image dimensions',
        code: 'CANNOT_DETERMINE_DIMENSIONS',
      });
      expect(recorded).toHaveLength(0);
    });

    it('answers 500 with the message when the login is refused', async () => {
      upstream = json({ status: 'error', errormessage: 'bad apikey' });
      const r = await post('/api/solve-plate', { name: 'a.png', bytes: png });
      expect(r.status).toBe(500);
      expect(r.body).toEqual({
        error: "Échec de l'authentification astrometry.net: bad apikey",
      });
      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toBe(`${API}/login`);
      expect(recorded[0].method).toBe('POST');
      expect(recorded[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
      expect(recorded[0].body).toMatch(/^request-json=/);
      expect(formJson(recorded[0].body!).apikey).toBe('test-key');
    });

    it('logs in, uploads the file with the request and answers with a local job id', async () => {
      upstream = (url) =>
        url === `${API}/login`
          ? json({ status: 'success', session: 'sess-1' })
          : url === `${API}/upload`
            ? json({ status: 'success', subid: 77 })
            : { status: 404, body: '' };
      const r = await post(
        '/api/solve-plate',
        { name: 'm13.png', bytes: png },
        {
          ra: '250.4',
          dec: '36.5',
          radius: '1.5',
          scale_lower: '1',
          scale_upper: '3',
        },
      );
      expect(r.status).toBe(200);
      expect(Object.keys(r.body)).toEqual(['jobId']);
      expect(r.body.jobId).toMatch(/^[0-9a-f-]{36}$/);
      expect(recorded.map((x) => `${x.method} ${x.url}`)).toEqual([
        `POST ${API}/login`,
        `POST ${API}/upload`,
      ]);
      const up = recorded[1];
      expect(up.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
      expect(JSON.parse(partOf(up.body!, 'request-json')!)).toEqual({
        session: 'sess-1',
        publicly_visible: 'n',
        allow_modifications: 'n',
        allow_commercial_use: 'n',
        center_ra: 250.4,
        center_dec: 36.5,
        radius: 1.5,
        scale_lower: 1,
        scale_upper: 3,
      });
      expect(up.body).toContain('name="file"; filename="m13.png"');
      expect(up.body).toContain('Content-Type: application/octet-stream');
      expect(up.body).toContain(Buffer.from(png).toString('latin1'));

      const status = await call('GET', `/api/solve-plate/${r.body.jobId}`);
      expect(status.status).toBe(200);
      expect(status.body).toEqual({ jobId: r.body.jobId, status: 'solving' });
    });

    it('reuses the session and estimates the scale from the picture when no hint is given', async () => {
      upstream = json({ status: 'success', subid: 78 });
      const r = await post('/api/solve-plate', { name: 'a.png', bytes: png });
      expect(r.status).toBe(200);
      expect(recorded.map((x) => x.url)).toEqual([`${API}/upload`]);
      const request = JSON.parse(partOf(recorded[0].body!, 'request-json')!);
      expect(request.session).toBe('sess-1');
      // 8x6 picture: 2 degrees over the smaller side, from half to double.
      const perPx = (2 * 3600) / 6;
      expect(request).toMatchObject({
        scale_lower: perPx * 0.5,
        scale_upper: perPx * 2,
        scale_units: 'arcsecperpix',
      });
      expect(request.center_ra).toBeUndefined();
    });

    it('turns a rejected upload into a failed job carrying the upstream message', async () => {
      upstream = json({ status: 'error', errormessage: 'bad image format' });
      const r = await post('/api/solve-plate', { name: 'a.png', bytes: png });
      expect(r.status).toBe(200);
      const status = await call('GET', `/api/solve-plate/${r.body.jobId}`);
      expect(status.body).toEqual({
        jobId: r.body.jobId,
        status: 'failed',
        error: 'bad image format',
      });
      upstream = json({ status: 'error' });
      const r2 = await post('/api/solve-plate', { name: 'a.png', bytes: png });
      expect((await call('GET', `/api/solve-plate/${r2.body.jobId}`)).body.error).toBe(
        'Upload rejected',
      );
    });

    it('turns a network failure of the upload into a failed job', async () => {
      upstream = { reject: 'connection refused' };
      const r = await post('/api/solve-plate', { name: 'a.png', bytes: png });
      expect(r.status).toBe(200);
      const status = await call('GET', `/api/solve-plate/${r.body.jobId}`);
      expect(status.body.status).toBe('failed');
      expect(status.body.error).toBe('connection refused');
    });

    it('lists the past submissions, most recent first, with the sizes of their solution', async () => {
      upstream = (url) => {
        if (url === `${API}/myjobs/`) return json({ jobs: [101, null, 200, 150] });
        if (url === `${API}/jobs/101/info/`)
          return json({
            status: 'success',
            original_filename: 'M42.jpg',
            image_width: 800,
            image_height: 600,
          });
        if (url === `${API}/jobs/200/info/`)
          return json({ status: 'success', original_filename: 'M31.jpg' });
        if (url === `${API}/jobs/150/info/`) return { status: 500, body: '' };
        if (url === 'https://nova.astrometry.net/wcs_file/200/')
          return { status: 200, body: WCS_FIXTURE };
        return { status: 404, body: '' };
      };
      const r = await call('GET', '/api/astrometry/submissions');
      expect(r.status).toBe(200);
      expect(r.body.submissions).toEqual([
        {
          submissionId: 200,
          jobId: 200,
          status: 'success',
          filename: 'M31.jpg',
          width: 3840,
          height: 2160,
        },
        { submissionId: 150, jobId: 150, status: 'unknown' },
        {
          submissionId: 101,
          jobId: 101,
          status: 'success',
          filename: 'M42.jpg',
          width: 800,
          height: 600,
        },
      ]);
      const myjobs = recorded.find((x) => x.url === `${API}/myjobs/`)!;
      expect(myjobs.method).toBe('POST');
      expect(myjobs.headers['content-type']).toBe('application/x-www-form-urlencoded');
      expect(formJson(myjobs.body!)).toEqual({ session: 'sess-1' });
    });

    it('answers an empty list when the upstream refuses or fails', async () => {
      upstream = { status: 403, body: '' };
      expect((await call('GET', '/api/astrometry/submissions')).body).toEqual({
        submissions: [],
      });
      upstream = { reject: 'network down' };
      expect((await call('GET', '/api/astrometry/submissions')).body).toEqual({
        submissions: [],
      });
      upstream = json({ something: 'else' });
      expect((await call('GET', '/api/astrometry/submissions')).body).toEqual({
        submissions: [],
      });
    });

    it('reuses a solved job from its WCS file and lists the objects of the field', async () => {
      upstream = (url) => {
        if (url === `${API}/jobs/10796000`) return json({ status: 'success' });
        if (url === 'https://nova.astrometry.net/wcs_file/10796000/')
          return { status: 200, body: WCS_FIXTURE };
        if (url === `${API}/jobs/10796000/objects_in_field/`)
          return { status: 200, body: OBJECTS_FIXTURE };
        return { status: 404, body: '' };
      };
      // A 3840x2160 picture, the size of the solved one.
      const big = new Uint8Array(
        await sharp({
          create: {
            width: 3840,
            height: 2160,
            channels: 3,
            background: { r: 0, g: 0, b: 0 },
          },
        })
          .png({ compressionLevel: 9 })
          .toBuffer(),
      );
      const r = await post(
        '/api/astrometry/reuse',
        { name: 'm13.png', bytes: big },
        { jobId: '10796000' },
      );
      expect(r.status).toBe(200);
      expect(Object.keys(r.body)).toEqual(['success', 'correspondences']);
      expect(r.body.success).toBe(true);
      expect(r.body.correspondences.length).toBeGreaterThanOrEqual(3);
      expect(recorded.map((x) => `${x.method} ${x.url}`)).toEqual([
        `GET ${API}/jobs/10796000`,
        'GET https://nova.astrometry.net/wcs_file/10796000/',
        `GET ${API}/jobs/10796000/objects_in_field/`,
      ]);
    });

    it('refuses a solution that belongs to a picture of another shape', async () => {
      upstream = (url) =>
        url === `${API}/jobs/10796000`
          ? json({ status: 'success' })
          : { status: 200, body: WCS_FIXTURE };
      const r = await post(
        '/api/astrometry/reuse',
        { name: 'a.png', bytes: png },
        { jobId: '10796000' },
      );
      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        success: false,
        error:
          'Selected astrometry solution appears to be for a different image (solution 3840x2160, current 8x6).',
      });
    });

    it('falls back to the calibration when the job has no WCS file', async () => {
      upstream = (url) => {
        if (url === `${API}/jobs/10796000`) return json({ status: 'success' });
        if (url === 'https://nova.astrometry.net/wcs_file/10796000/')
          return { status: 200, body: 'SIMPLE  = T' };
        if (url === `${API}/jobs/10796000/calibration/`) return { status: 200, body: CAL_FIXTURE };
        if (url === `${API}/jobs/10796000/objects_in_field/`)
          return { status: 200, body: OBJECTS_FIXTURE };
        return { status: 404, body: '' };
      };
      const r = await post(
        '/api/astrometry/reuse',
        { name: 'a.png', bytes: png },
        { jobId: '10796000' },
      );
      expect(r.status).toBe(200);
      expect(typeof r.body.success).toBe('boolean');
      expect(recorded.map((x) => x.url).slice(0, 3)).toEqual([
        `${API}/jobs/10796000`,
        'https://nova.astrometry.net/wcs_file/10796000/',
        `${API}/jobs/10796000/calibration/`,
      ]);
    });

    it('reports a job that is not solved, and an upstream failure, as success false', async () => {
      upstream = json({ status: 'failure' });
      const failed = await post(
        '/api/astrometry/reuse',
        { name: 'a.png', bytes: png },
        { jobId: '99' },
      );
      expect(failed.status).toBe(200);
      expect(failed.body).toEqual({
        success: false,
        error: 'Job 99 status: failure',
      });
      upstream = { reject: 'timeout' };
      const down = await post(
        '/api/astrometry/reuse',
        { name: 'a.png', bytes: png },
        { jobId: '99' },
      );
      expect(down.status).toBe(200);
      expect(down.body).toEqual({ success: false, error: 'timeout' });
    });

    it('logs in again after the key is changed', async () => {
      await call('PUT', '/api/settings', { apiKey: 'other-key' });
      upstream = (url) =>
        url === `${API}/login`
          ? json({ status: 'success', session: 'sess-2' })
          : json({ status: 'success', subid: 90 });
      const r = await post('/api/solve-plate', { name: 'a.png', bytes: png });
      expect(r.status).toBe(200);
      expect(recorded.map((x) => x.url)).toEqual([`${API}/login`, `${API}/upload`]);
      expect(formJson(recorded[0].body!).apikey).toBe('other-key');
      expect(JSON.parse(partOf(recorded[1].body!, 'request-json')!).session).toBe('sess-2');
    });
  });
});

// ─── GET /api/version/latest ─────────────────────────────────────────────────

describe('GET /api/version/latest', () => {
  const RELEASES_URL = 'https://api.github.com/repos/gweybrec/my-astro-sky/releases/latest';
  const HOUR = 60 * 60 * 1000;
  const RELEASE = {
    tag_name: 'v9.9.9',
    html_url: 'https://github.com/gweybrec/my-astro-sky/releases/tag/v9.9.9',
    published_at: '2026-01-02T03:04:05Z',
  };
  let clock: number;

  beforeAll(() => {
    // The answer is cached for an hour: only the date is faked, so the test can move past the cache.
    clock = Date.now() + 10 * 24 * HOUR;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const later = (ms: number) => {
    clock += ms;
    vi.setSystemTime(clock);
  };

  it('sends one GET to GitHub and answers with the release, then serves the cache for an hour', async () => {
    upstream = { status: 200, body: JSON.stringify(RELEASE) };
    const r = await call('GET', '/api/version/latest');
    expect(r).toEqual({
      status: 200,
      body: { version: 'v9.9.9', url: RELEASE.html_url, publishedAt: '2026-01-02T03:04:05Z' },
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe(RELEASES_URL);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers).toMatchObject({
      accept: 'application/vnd.github+json',
      'user-agent': 'MyAstroSky',
    });

    later(HOUR - 1);
    upstream = { status: 500, body: 'would fail' };
    const cached = await call('GET', '/api/version/latest');
    expect(cached.body.version).toBe('v9.9.9');
    expect(recorded).toHaveLength(1);
  });

  it('answers null when GitHub answers an error status, and caches the null for an hour', async () => {
    later(2 * HOUR);
    upstream = { status: 403, body: 'rate limited' };
    const r = await call('GET', '/api/version/latest');
    expect(r).toEqual({ status: 200, body: null });
    expect(recorded).toHaveLength(1);

    later(HOUR - 1);
    upstream = { status: 200, body: JSON.stringify(RELEASE) };
    expect((await call('GET', '/api/version/latest')).body).toBeNull();
    expect(recorded).toHaveLength(1);
  });

  it('answers null when the request itself fails', async () => {
    later(2 * HOUR);
    upstream = { reject: 'ENOTFOUND' };
    const r = await call('GET', '/api/version/latest');
    expect(r).toEqual({ status: 200, body: null });
    expect(recorded).toHaveLength(1);
  });

  it('answers null when the payload has no usable tag, and fills the url and date with defaults', async () => {
    later(2 * HOUR);
    upstream = { status: 200, body: JSON.stringify({ name: 'no tag' }) };
    expect((await call('GET', '/api/version/latest')).body).toBeNull();

    later(2 * HOUR);
    upstream = { status: 200, body: JSON.stringify({ tag_name: 'v1.0.0' }) };
    expect((await call('GET', '/api/version/latest')).body).toEqual({
      version: 'v1.0.0',
      url: '',
      publishedAt: null,
    });
  });
});
