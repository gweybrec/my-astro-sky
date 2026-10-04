// @vitest-environment node
/**
 * Pins the export / import bridge between a user's devices (WP2.4a). It exports everything
 * from a seeded instance A through the real routes, imports the ZIP into an empty instance B
 * through the real routes, and checks that the data of B is the data of A. It is the safety
 * net every later service card must keep green.
 *
 * Characterisation test: behaviour that looks odd is recorded as it is, marked `KNOWN GAP`.
 *
 * Fields ignored when A is compared with B (everything else must be equal):
 *   - none for photos, plans, gear setups, custom gear, POI categories, sky regions and DSO
 *     overrides: the import keeps the bundle's ids, creation dates, positions and file names,
 *     so those lists come back identical. (Verified by running the test; if a later change
 *     regenerates an id or a timestamp, add it here with the reason.)
 *
 * Not part of the bundle by design: the editable settings (solver paths, API key) are
 * per-machine and are not exported.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import sharp from 'sharp';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const nodeRequire = createRequire(import.meta.url);
const unzipper = nodeRequire('unzipper') as typeof import('unzipper');

// ─── Instance harness ────────────────────────────────────────────────────────

interface Instance {
  base: string;
  uploadsDir: string;
  call: (method: string, url: string, body?: unknown) => Promise<{ status: number; body: any }>;
  stop: () => Promise<void>;
}

const tempDirs: string[] = [];
let savedApiKeyEnv: string | undefined;
let live: Instance | null = null;

/** Builds a fresh app on a new in-memory database and a new uploads folder. */
async function startInstance(): Promise<Instance> {
  vi.resetModules();
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myastrosky-backup-test-'));
  tempDirs.push(uploadsDir);
  vi.stubEnv('DB_PATH', ':memory:');
  vi.stubEnv('UPLOADS_DIR', uploadsDir);
  vi.stubEnv('ENABLE_SWAGGER', 'false');
  delete process.env.ASTROMETRY_API_KEY;

  const mod = await import('../../server/app.js');
  const app = await mod.createApp();
  const closeDatabase = (await import('../../server/db.js')).closeDatabase;
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const instance: Instance = {
    base,
    uploadsDir,
    async call(method, url, body) {
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
        /* not JSON */
      }
      return { status: res.status, body: parsed };
    },
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      closeDatabase();
      live = null;
    },
  };
  live = instance;
  return instance;
}

beforeAll(() => {
  savedApiKeyEnv = process.env.ASTROMETRY_API_KEY;
});

afterAll(async () => {
  if (live) await live.stop();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  if (savedApiKeyEnv !== undefined) process.env.ASTROMETRY_API_KEY = savedApiKeyEnv;
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const OK = { status: 200, body: { ok: true } };

async function makePng(width: number, height: number, rgb: [number, number, number]) {
  return sharp({
    create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  })
    .png()
    .toBuffer();
}

function photoForm(png: Buffer, name: string, fields: Record<string, unknown>): FormData {
  const form = new FormData();
  form.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), name);
  form.append(
    'correspondences',
    JSON.stringify([
      { pointIndex: 0, photoX: 5, photoY: 5, starHip: 32349, starName: 'Sirius' },
      { pointIndex: 1, photoX: 20, photoY: 15, starHip: 27989 },
    ]),
  );
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return form;
}

/** Everything the comparison looks at, read through the list routes. */
async function snapshot(inst: Instance) {
  const get = async (url: string) => {
    const r = await inst.call('GET', url);
    expect(r.status, url).toBe(200);
    return r.body;
  };
  const custom = (list: any[]) => list.filter((g) => String(g.id).startsWith('custom-'));
  return {
    photos: await get('/api/photos'),
    plans: await get('/api/plans'),
    gearSetups: await get('/api/gear-setups'),
    telescopes: custom(await get('/api/telescopes')),
    cameras: custom(await get('/api/cameras')),
    accessories: custom(await get('/api/accessories')),
    filters: custom(await get('/api/filters')),
    poiCategories: await get('/api/poi-categories'),
    skyRegions: await get('/api/sky-regions'),
    dsoOverrides: await get('/api/dso-overrides'),
  };
}

async function exportZip(inst: Instance, body: unknown): Promise<Buffer> {
  const res = await fetch(`${inst.base}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('application/zip');
  return Buffer.from(await res.arrayBuffer());
}

async function openZip(zip: Buffer) {
  const dir = await unzipper.Open.buffer(zip);
  const files = dir.files.filter((f) => f.type === 'File');
  const read = async (name: string) => {
    const entry = files.find((f) => f.path === name);
    if (!entry) throw new Error(`missing zip entry ${name}`);
    return entry.buffer();
  };
  return { names: files.map((f) => f.path).sort(), read };
}

function bundleForm(zip: Buffer, fields: Record<string, string>): FormData {
  const form = new FormData();
  form.append('bundle', new Blob([new Uint8Array(zip)], { type: 'application/zip' }), 'backup.zip');
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

/** The form fields a user gets by ticking everything in the import dialog. */
function selectEverything(preview: any): Record<string, string> {
  return {
    importMetadata: '1',
    importDsoOverrides: '1',
    importPoiCategories: '1',
    importSkyRegions: '1',
    selectedImages: JSON.stringify(preview.images.map((i: any) => i.filename)),
    selectedPlans: JSON.stringify(preview.plans.map((p: any) => p.id)),
    selectedSetups: JSON.stringify(preview.setups.map((s: any) => s.id)),
    selectedGear: JSON.stringify(preview.gear.map((g: any) => g.id)),
  };
}

// ─── State shared by the ordered steps below ────────────────────────────────

const SHORTCUTS = { 'toggle-grid': 'g', 'toggle-labels': 'l' };
const customIds: { telescope: string; camera: string } = { telescope: '', camera: '' };
let setupId = '';
let planId = '';
let poiCatId = '';
let photoIds: string[] = [];
let snapA: Awaited<ReturnType<typeof snapshot>>;
let aImages: Record<string, Buffer> = {};
let zip: Buffer;
let manifest: any;
let previewOnEmpty: any;
let snapB: Awaited<ReturnType<typeof snapshot>>;
let instanceB: Instance;

describe('export and import round trip', () => {
  it('seeds instance A through the API only', async () => {
    const a = await startInstance();
    const call = a.call;

    // Custom gear
    const tel = await call('POST', '/api/custom-gear', {
      type: 'telescope',
      data: {
        brand: 'Zed',
        model: 'Test 100',
        name: 'Zed Test 100',
        focalLength: 600,
        aperture: 100,
      },
    });
    expect(tel.status).toBe(200);
    customIds.telescope = tel.body.id;
    const cam = await call('POST', '/api/custom-gear', {
      type: 'camera',
      data: {
        brand: 'Zed',
        model: 'Cam 7',
        name: 'Zed Cam 7',
        sensorWidth: 12.5,
        sensorHeight: 8.3,
      },
    });
    expect(cam.status).toBe(200);
    customIds.camera = cam.body.id;

    // Gear setup using them
    const setup = await call('POST', '/api/gear-setups', {
      name: 'Rig Zed',
      telescopeId: customIds.telescope,
      cameraId: customIds.camera,
      accessoryId: 'askar-130phq-reducer',
    });
    expect(setup.status).toBe(200);
    setupId = setup.body.id;

    // POI category beyond the five defaults + a change to a default
    const cat = await call('POST', '/api/poi-categories', { name: 'Meteor', color: '#abcdef' });
    expect(cat.status).toBe(200);
    poiCatId = cat.body.id;
    expect(await call('PATCH', '/api/poi-categories/cat-comet', { color: '#123456' })).toEqual(OK);

    // Sky region
    const region = await call('POST', '/api/sky-regions', {
      name: 'Trees',
      color: '#00aa00',
      points: [
        { azDeg: 0, altDeg: 10 },
        { azDeg: 90, altDeg: 10 },
        { azDeg: 45, altDeg: 40 },
      ],
    });
    expect(region.status).toBe(200);

    // DSO override
    expect(
      await call('PUT', '/api/dso-overrides/M31', { name: 'Andromeda (mine)', rating: 5 }),
    ).toEqual(OK);

    // Editable setting
    expect(await call('PUT', '/api/settings', { ASTAP_PATH: '/opt/astap-a' })).toEqual(OK);

    // Plan: two entries, an observation window, a mosaic
    const plan = await call('POST', '/api/plans', { name: 'Night Zed' });
    expect(plan.status).toBe(200);
    planId = plan.body.id;
    expect(
      await call('PUT', `/api/plans/${planId}`, {
        nightOf: '2026-10-04',
        lat: 48.5,
        lon: 2.25,
        setupId,
        sortBy: 'name',
      }),
    ).toEqual(OK);
    const e1 = await call('POST', `/api/plans/${planId}/entries`, { dsoId: 'M31' });
    const e2 = await call('POST', `/api/plans/${planId}/entries`, { ra: 10.5, dec: -20.25 });
    expect(e1.status).toBe(200);
    expect(e2.status).toBe(200);
    expect(
      await call('PATCH', `/api/plans/${planId}/entries/${e1.body.id}`, {
        paDeg: 45,
        notes: 'first target',
        observationWindows: [
          {
            id: 'win-1',
            startFrac: 0.1,
            endFrac: 0.5,
            filter: 'Ha',
            color: '#ff0000',
            frameSeconds: 120,
            snap: true,
          },
        ],
      }),
    ).toEqual(OK);
    expect(
      await call('PUT', `/api/plans/${planId}/entries/order`, { ids: [e2.body.id, e1.body.id] }),
    ).toEqual(OK);
    const mosaic = await call('POST', `/api/plans/${planId}/mosaics`, {
      name: 'Pair',
      centerRa: 11,
      centerDec: -21,
      paDeg: 10,
      tiles: [
        { ra: 10.9, dec: -21 },
        { ra: 11.1, dec: -21, paDeg: 5 },
      ],
    });
    expect(mosaic.status).toBe(200);

    // Two photos, each with metadata; one with a manual placement
    const png1 = await makePng(64, 48, [200, 30, 30]);
    const png2 = await makePng(48, 64, [30, 30, 200]);
    const up1 = await call(
      'POST',
      '/api/photos',
      photoForm(png1, 'm31.png', {
        labels: ['wide', 'mosaic'],
        dsoIds: ['M31', 'M32'],
        notes: 'first photo',
        observationDate: '2026-10-04',
        pointsOfInterest: [{ name: 'Leonid', categoryId: poiCatId, ra: 150.5, dec: 22.25 }],
        integrations: [
          { frames: 30, seconds: 120, filter: 'Ha' },
          { frames: 10, seconds: 60, filter: 'OIII' },
        ],
        captureDetails: { gain: 100, offset: 30, binning: '1x1', ccdTemp: -10.5 },
        gearSetupId: setupId,
        manualPlacement: { projPerPx: 0.001, centerX: 0.1, centerY: 0.2, rotation: 15 },
      }),
    );
    expect(up1.status).toBe(200);
    const up2 = await call(
      'POST',
      '/api/photos',
      photoForm(png2, 'orion.png', {
        labels: ['narrow'],
        dsoIds: ['M42'],
        notes: 'second photo',
        pointsOfInterest: [{ name: 'Probe', categoryId: 'cat-comet' }],
        integrations: [{ frames: 5, seconds: 300, filter: 'L' }],
        captureDetails: { iso: 800 },
      }),
    );
    expect(up2.status).toBe(200);
    photoIds = [up1.body.id, up2.body.id];

    // Draw order: reverse the upload order
    expect(
      await call('PATCH', '/api/photos/order', { photoIds: [photoIds[1], photoIds[0]] }),
    ).toEqual(OK);

    snapA = await snapshot(a);
    expect(snapA.photos.map((p: any) => p.id)).toEqual([photoIds[1], photoIds[0]]);
    expect(snapA.photos).toHaveLength(2);
    expect(snapA.plans[0].entries).toHaveLength(4);
    expect(snapA.plans[0].mosaics).toHaveLength(1);
    expect(snapA.telescopes).toHaveLength(1);
    expect(snapA.cameras).toHaveLength(1);
    expect(snapA.poiCategories).toHaveLength(6);
    expect(snapA.skyRegions).toHaveLength(1);
    expect(snapA.dsoOverrides).toHaveProperty('M31');
    // The comparison below is only meaningful if A really holds the rich data.
    const m31 = snapA.photos.find((p: any) => p.id === photoIds[0]);
    expect(m31.pointsOfInterest).toEqual([
      { name: 'Leonid', categoryId: poiCatId, ra: 150.5, dec: 22.25 },
    ]);
    expect(m31.integrations).toHaveLength(2);
    expect(m31.captureDetails).toEqual({ gain: 100, offset: 30, ccdTemp: -10.5, binning: '1x1' });
    expect(m31.manualPlacement).toEqual({
      projPerPx: 0.001,
      centerX: 0.1,
      centerY: 0.2,
      rotation: 15,
    });
    expect(m31.gearSetupId).toBe(setupId);
    expect(m31.correspondences).toHaveLength(2);
    expect(snapA.plans[0].setupId).toBe(setupId);
    expect(snapA.plans[0].entries.some((e: any) => e.observationWindows.length === 1)).toBe(true);
    expect(snapA.plans[0].entries.filter((e: any) => e.mosaicId).length).toBe(2);

    // Image bytes as they are on disk in A
    for (const p of snapA.photos) {
      for (const name of [p.filename, p.thumbFilename]) {
        aImages[name] = fs.readFileSync(path.join(a.uploadsDir, name));
      }
    }
  }, 30_000);

  it('exports everything to a ZIP', async () => {
    zip = await exportZip(live!, {
      options: {
        includeImages: true,
        includeMetadata: true,
        includeDsoOverrides: true,
        includeCustomGear: true,
        includeSetups: true,
        includePlans: true,
        includeShortcuts: true,
        includePoiCategories: true,
        includeSkyRegions: true,
      },
      ids: photoIds,
      shortcuts: SHORTCUTS,
    });
    // ZIP local file header signature
    expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304');

    const z = await openZip(zip);
    const imageNames = Object.keys(aImages).map((n) => `images/${n}`);
    expect(z.names).toEqual(
      [
        'custom-gear.json',
        'dso-overrides.json',
        'gear-setups.json',
        'manifest.json',
        'plans.json',
        'poi-categories.json',
        'shortcuts.json',
        'sky-regions.json',
        ...imageNames,
      ].sort(),
    );

    for (const name of z.names.filter((n) => n.endsWith('.json'))) {
      const text = (await z.read(name)).toString('utf8');
      expect(() => JSON.parse(text), name).not.toThrow();
    }

    manifest = JSON.parse((await z.read('manifest.json')).toString('utf8'));
    expect(Object.keys(manifest).sort()).toEqual(['manifestVersion', 'photos']);
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.photos.map((p: any) => p.id)).toEqual([photoIds[1], photoIds[0]]);
    // The manifest holds the photos as GET /api/photos returns them, minus the on-disk
    // `fileSize` that route adds.
    expect(manifest.photos).toEqual(
      snapA.photos.map((p: any) => {
        const { fileSize, ...rest } = p;
        expect(fileSize).toBe(aImages[p.filename].length);
        return rest;
      }),
    );

    for (const [name, bytes] of Object.entries(aImages)) {
      expect((await z.read(`images/${name}`)).equals(bytes), name).toBe(true);
    }

    // The editable settings are not part of the bundle.
    expect(z.names).not.toContain('settings.json');
    expect(
      JSON.stringify(
        await Promise.all(
          z.names
            .filter((n) => n.endsWith('.json'))
            .map(async (n) => (await z.read(n)).toString('utf8')),
        ),
      ),
    ).not.toContain('/opt/astap-a');

    expect(JSON.parse((await z.read('shortcuts.json')).toString('utf8'))).toEqual(SHORTCUTS);
  }, 30_000);

  it('previews the bundle on an empty instance B', async () => {
    await live!.stop();
    instanceB = await startInstance();
    const r = await (async () => {
      const res = await fetch(`${instanceB.base}/api/import/preview`, {
        method: 'POST',
        body: bundleForm(zip, {}),
      });
      return { status: res.status, body: await res.json() };
    })();
    expect(r.status).toBe(200);
    previewOnEmpty = r.body;

    expect(Object.keys(previewOnEmpty).sort()).toEqual(
      [
        'gear',
        'hasCustomGear',
        'hasDsoOverrides',
        'hasMetadata',
        'hasPlans',
        'hasPoiCategories',
        'hasSetups',
        'hasShortcuts',
        'hasSkyRegions',
        'images',
        'photos',
        'plans',
        'setups',
        'shortcuts',
      ].sort(),
    );
    expect(previewOnEmpty).toMatchObject({
      hasMetadata: true,
      photos: 2,
      hasDsoOverrides: true,
      hasCustomGear: true,
      hasSetups: true,
      hasPoiCategories: true,
      hasSkyRegions: true,
      hasPlans: true,
      hasShortcuts: true,
      shortcuts: SHORTCUTS,
    });
    // Images: the two full-size files only (thumbnails are not listed), none marked as
    // existing. The order is the ZIP's entry order, which archiver does not guarantee, so
    // compare sorted by filename.
    const byFilename = (a: any, b: any) => a.filename.localeCompare(b.filename);
    expect([...previewOnEmpty.images].sort(byFilename)).toEqual(
      snapA.photos
        .map((p: any) => ({
          filename: p.filename,
          originalName: p.originalName,
          size: aImages[p.filename].length,
          exists: false,
        }))
        .sort(byFilename),
    );
    expect(previewOnEmpty.plans).toEqual([{ id: planId, name: 'Night Zed', exists: false }]);
    expect(previewOnEmpty.setups).toEqual([{ id: setupId, name: 'Rig Zed', exists: false }]);
    // Gear order follows the database scan; compare sorted by type.
    expect([...previewOnEmpty.gear].sort((a: any, b: any) => a.type.localeCompare(b.type))).toEqual(
      [
        { id: customIds.camera, type: 'camera', name: 'Zed Cam 7', exists: false },
        { id: customIds.telescope, type: 'telescope', name: 'Zed Test 100', exists: false },
      ],
    );
  }, 30_000);

  it('imports the bundle into B and B matches A', async () => {
    const r = await instanceB.call(
      'POST',
      '/api/import',
      bundleForm(zip, selectEverything(previewOnEmpty)),
    );
    expect(r).toEqual({
      status: 200,
      body: { imported: 2, skipped: 0, dsoOverridesImported: 1 },
    });

    snapB = await snapshot(instanceB);
    for (const key of Object.keys(snapA) as (keyof typeof snapA)[]) {
      expect(snapB[key], key).toEqual(snapA[key]);
    }

    // B's uploads folder holds the two images and their thumbnails.
    expect(fs.readdirSync(instanceB.uploadsDir).sort()).toEqual(Object.keys(aImages).sort());
    for (const [name, bytes] of Object.entries(aImages)) {
      const got = fs.readFileSync(path.join(instanceB.uploadsDir, name));
      if (name.endsWith('_thumb.jpg')) {
        // Thumbnails are not in selectedImages (the preview does not list them), so the
        // import regenerates them from the full image instead of copying them.
        expect(got.length, name).toBeGreaterThan(0);
        expect(got.equals(bytes), name).toBe(true);
      } else {
        expect(got.equals(bytes), name).toBe(true);
      }
    }

    // The editable settings did not travel.
    const settings = await instanceB.call('GET', '/api/settings');
    expect(settings.body.ASTAP_PATH).toBe('');
  }, 30_000);

  it('a second import of the same ZIP finds everything as existing and adds no duplicate', async () => {
    const res = await fetch(`${instanceB.base}/api/import/preview`, {
      method: 'POST',
      body: bundleForm(zip, {}),
    });
    expect(res.status).toBe(200);
    const preview = await res.json();
    expect(preview.images.map((i: any) => i.exists)).toEqual([true, true]);
    expect(preview.plans.map((p: any) => p.exists)).toEqual([true]);
    expect(preview.setups.map((s: any) => s.exists)).toEqual([true]);
    expect(preview.gear.map((g: any) => g.exists)).toEqual([true, true]);

    const r = await instanceB.call(
      'POST',
      '/api/import',
      bundleForm(zip, selectEverything(preview)),
    );
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ imported: 2, skipped: 0, dsoOverridesImported: 1 });

    const again = await snapshot(instanceB);
    for (const key of Object.keys(snapB) as (keyof typeof snapB)[]) {
      expect(again[key], key).toEqual(snapB[key]);
    }
  }, 30_000);

  it('imports only the plans on a third instance C: plans arrive, photos do not', async () => {
    await instanceB.stop();
    const c = await startInstance();
    const r = await c.call(
      'POST',
      '/api/import',
      bundleForm(zip, { selectedPlans: JSON.stringify([planId]) }),
    );
    expect(r).toEqual({ status: 200, body: { imported: 0, skipped: 0, dsoOverridesImported: 0 } });

    const plans = (await c.call('GET', '/api/plans')).body;
    // The plan keeps its setupId although the setup itself was not imported: the reference
    // dangles until the setup arrives (no foreign key, no error).
    expect(plans).toEqual(snapA.plans);
    expect((await c.call('GET', '/api/photos')).body).toEqual([]);
    expect((await c.call('GET', '/api/gear-setups')).body).toEqual([]);
    expect((await c.call('GET', '/api/sky-regions')).body).toEqual([]);
    expect((await c.call('GET', '/api/dso-overrides')).body).toEqual({});
    expect((await c.call('GET', '/api/poi-categories')).body).toHaveLength(5);
    // KNOWN GAP: with no selectedImages field the route writes every image and thumbnail of the ZIP to the
    // uploads folder even when the photos' metadata is not imported, leaving orphan files.
    expect(fs.readdirSync(c.uploadsDir).sort()).toEqual(Object.keys(aImages).sort());
  }, 30_000);
});
