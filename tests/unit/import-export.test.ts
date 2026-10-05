import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isValidZipEntryPath,
  parseManifestPhotos,
  validateDsoOverrideCoords,
  inspectZipContents,
  buildZipPreviewResponse,
  idsToReplaceByName,
} from '../../server/import-utils';
import type { ZipEntry, ZipInspectResult } from '../../server/import-utils';
import { createGearService } from '@myastrosky/core/services/gear';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { ManualPlacement } from '@myastrosky/core/types';
import { createPhotoService, type PhotoService } from '@myastrosky/core/services/photos';
import { createPlanService } from '@myastrosky/core/services/plans';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { fakeImageCodec, memoryBlobStore } from '../helpers/fake-image-io';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CORRS_A = [
  {
    pointIndex: 0,
    photoX: 100,
    photoY: 200,
    starHip: 27989,
    starName: 'Betelgeuse',
    starRa: 88.7929,
    starDec: 7.4071,
  },
  {
    pointIndex: 1,
    photoX: 400,
    photoY: 600,
    starHip: 32349,
    starName: 'Rigel',
    starRa: 78.6345,
    starDec: -8.2016,
  },
  {
    pointIndex: 2,
    photoX: 700,
    photoY: 100,
    starHip: 24436,
    starName: 'Bellatrix',
    starRa: 81.2827,
    starDec: 6.3497,
  },
];

const CORRS_B = [
  {
    pointIndex: 0,
    photoX: 50,
    photoY: 75,
    starHip: 3179,
    starName: 'Mirach',
    starRa: 17.433,
    starDec: 35.6202,
  },
  {
    pointIndex: 1,
    photoX: 600,
    photoY: 400,
    starHip: 5447,
    starName: 'Alpheratz',
    starRa: 0.1397,
    starDec: 29.0904,
  },
];

/** A minimal Photo[] that covers all fields (correspondences, dsoIds, labels, notes, manualPlacement). */
const MANIFEST_FIXTURE = [
  {
    id: 'aaa-111-aaa',
    filename: 'aaa-111-aaa.jpg',
    originalName: 'M1_crab.jpg',
    width: 1024,
    height: 768,
    createdAt: '2026-05-01T12:00:00.000Z',
    correspondences: CORRS_A,
    dsoIds: ['M1', 'NGC1952'],
    labels: ['supernova remnant', 'red'],
    integrations: [
      { frames: 58, seconds: 300, filter: 'Halpha' },
      { frames: 22, seconds: 180, filter: 'OIII' },
    ],
    notes: 'Crab nebula test note',
  },
  {
    id: 'bbb-222-bbb',
    filename: 'bbb-222-bbb.jpg',
    originalName: 'M31_andromeda.jpg',
    width: 2048,
    height: 1024,
    createdAt: '2026-05-02T12:00:00.000Z',
    correspondences: CORRS_B,
    dsoIds: ['M31'],
    labels: [],
    integrations: [{ frames: 40, seconds: 120, filter: 'Luminance' }],
    notes: '',
    manualPlacement: { ra: 10.6847, dec: 41.2692, projPerPx: 0.00125, rotDeg: 22.5 },
  },
];

// The photo service on the same in-memory database as the legacy `db` module.
const photosOn = (db: typeof import('../../server/db.js')): PhotoService =>
  createPhotoService({
    db: createBetterSqliteDb(db.getConnection()),
    newId: () => 'unused',
    images: fakeImageCodec(),
    blobs: memoryBlobStore(),
  });

/** The positional arguments of the old `createPhotoWithId`, as the object `importPhoto` takes. */
function seedPhoto(
  photos: PhotoService,
  id: string,
  filename: string,
  originalName: string,
  width: number,
  height: number,
  correspondences: unknown[],
  createdAt?: string | null,
  manualPlacement?: string | null,
  dsoIds?: string[],
  labels?: string[],
  notes?: string,
  strategy: 'skip' | 'replace' = 'skip',
  integrations?: unknown[],
) {
  return photos.importPhoto(
    {
      id,
      filename,
      originalName,
      width,
      height,
      correspondences,
      createdAt,
      manualPlacement: manualPlacement ? (JSON.parse(manualPlacement) as ManualPlacement) : null,
      dsoIds,
      labels,
      notes,
      integrations,
    },
    strategy,
  );
}

/** `updateMetadata` as the old `updatePhotoMetadata` answered: true when the photo was updated, false when it does not exist. */
async function updateMeta(
  photos: PhotoService,
  id: string,
  dsoIds: string[],
  labels: string[],
  notes: string,
  originalName?: string,
  integrations?: unknown[],
): Promise<boolean> {
  try {
    await photos.updateMetadata(id, { dsoIds, labels, notes, originalName, integrations } as never);
    return true;
  } catch (e) {
    if (isDomainError(e) && e.code === 'PHOTO_NOT_FOUND') return false;
    throw e;
  }
}

/** `setOrder` as the old `updatePhotoDrawOrder` answered: true when the order was written, false when the list was refused. */
async function reorder(photos: PhotoService, ids: string[]): Promise<boolean> {
  try {
    await photos.setOrder(ids);
    return true;
  } catch (e) {
    if (isDomainError(e) && e.code === 'INVALID_PHOTO_ORDER') return false;
    throw e;
  }
}

// ─── isValidZipEntryPath ──────────────────────────────────────────────────────

describe('isValidZipEntryPath — path traversal guard', () => {
  it.each([
    'manifest.json',
    'images/photo.jpg',
    'images/uuid-with-dashes_and.dots.png',
    'images/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg',
    './manifest.json',
    'images/./photo.jpg',
  ])('accepts valid path: %s', (p) => {
    expect(isValidZipEntryPath(p)).toBe(true);
  });

  it.each([
    '../etc/passwd',
    '../../server/db.ts',
    '/absolute/path.jpg',
    'images/../../../secret.txt',
    './images/../../etc/shadow',
    'images/..\\windows\\system32\\file.dll',
  ])('rejects traversal path: %s', (p) => {
    expect(isValidZipEntryPath(p)).toBe(false);
  });
});

// ─── Manifest JSON round-trip (pure) ─────────────────────────────────────────

describe('Manifest JSON round-trip', () => {
  it('preserves all top-level photo fields', () => {
    const json = JSON.stringify(MANIFEST_FIXTURE);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveLength(2);
    const p = parsed[0];
    expect(p.id).toBe('aaa-111-aaa');
    expect(p.filename).toBe('aaa-111-aaa.jpg');
    expect(p.originalName).toBe('M1_crab.jpg');
    expect(p.width).toBe(1024);
    expect(p.height).toBe(768);
    expect(p.createdAt).toBe('2026-05-01T12:00:00.000Z');
    expect(p.notes).toBe('Crab nebula test note');
  });

  it('preserves correspondence arrays with all coordinate fields', () => {
    const parsed = JSON.parse(JSON.stringify(MANIFEST_FIXTURE));
    const corrs = parsed[0].correspondences;

    expect(corrs).toHaveLength(3);
    expect(corrs[0].pointIndex).toBe(0);
    expect(corrs[0].starHip).toBe(27989);
    expect(corrs[0].starName).toBe('Betelgeuse');
    expect(corrs[0].starRa).toBeCloseTo(88.7929, 4);
    expect(corrs[0].starDec).toBeCloseTo(7.4071, 4);
    expect(corrs[2].photoX).toBe(700);
    expect(corrs[2].photoY).toBe(100);
  });

  it('preserves dsoIds and labels as arrays', () => {
    const parsed = JSON.parse(JSON.stringify(MANIFEST_FIXTURE));
    expect(parsed[0].dsoIds).toEqual(['M1', 'NGC1952']);
    expect(parsed[0].labels).toEqual(['supernova remnant', 'red']);
    expect(parsed[1].dsoIds).toEqual(['M31']);
    expect(parsed[1].labels).toEqual([]);
  });

  it('preserves integrations as structured rows', () => {
    const parsed = JSON.parse(JSON.stringify(MANIFEST_FIXTURE));
    expect(parsed[0].integrations).toEqual([
      { frames: 58, seconds: 300, filter: 'Halpha' },
      { frames: 22, seconds: 180, filter: 'OIII' },
    ]);
    expect(parsed[1].integrations).toEqual([{ frames: 40, seconds: 120, filter: 'Luminance' }]);
  });

  it('preserves manualPlacement when present and omits it when absent', () => {
    const parsed = JSON.parse(JSON.stringify(MANIFEST_FIXTURE));
    expect(parsed[0].manualPlacement).toBeUndefined();
    const mp = parsed[1].manualPlacement;
    expect(mp).toBeDefined();
    expect(mp.ra).toBeCloseTo(10.6847, 4);
    expect(mp.dec).toBeCloseTo(41.2692, 4);
    expect(mp.projPerPx).toBeCloseTo(0.00125, 6);
    expect(mp.rotDeg).toBeCloseTo(22.5, 2);
  });

  it('round-trips an empty manifest without error', () => {
    const json = JSON.stringify([]);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([]);
  });
});

// ─── DB import/export round-trip ─────────────────────────────────────────────
// Uses vi.resetModules() + vi.stubEnv('DB_PATH', ':memory:') so each test
// gets a completely fresh in-memory SQLite database.

describe('DB import/export round-trip', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DB_PATH', ':memory:');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('importPhoto inserts all fields and list returns them correctly', async () => {
    const photos = photosOn(await import('../../server/db.js'));

    const result = await seedPhoto(
      photos,
      'test-id-1',
      'test-id-1.jpg',
      'M101.jpg',
      1920,
      1080,
      CORRS_A,
      '2026-01-15T08:00:00.000Z',
      null,
      ['M101', 'NGC5457'],
      ['galaxy', 'spiral'],
      'Pinwheel galaxy',
      'skip',
      [{ frames: 45, seconds: 240, filter: 'R' }],
    );

    expect(result).toBe('imported');

    const all = await photos.list();
    expect(all).toHaveLength(1);

    const p = all[0];
    expect(p.id).toBe('test-id-1');
    expect(p.filename).toBe('test-id-1.jpg');
    expect(p.originalName).toBe('M101.jpg');
    expect(p.width).toBe(1920);
    expect(p.height).toBe(1080);
    expect(p.dsoIds).toEqual(['M101', 'NGC5457']);
    expect(p.labels).toEqual(['galaxy', 'spiral']);
    expect(p.integrations).toEqual([{ frames: 45, seconds: 240, filter: 'R' }]);
    expect(p.notes).toBe('Pinwheel galaxy');
    expect(p.correspondences).toHaveLength(3);
    expect(p.correspondences[0].starHip).toBe(27989);
    expect(p.correspondences[0].starRa).toBeCloseTo(88.7929, 4);
    expect(p.correspondences[1].starDec).toBeCloseTo(-8.2016, 4);
  });

  it('importPhoto preserves manualPlacement', async () => {
    const photos = photosOn(await import('../../server/db.js'));
    const mp = { ra: 83.82, dec: -5.39, projPerPx: 0.002, rotDeg: 0 };

    await seedPhoto(
      photos,
      'mp-test',
      'mp-test.jpg',
      'Orion.jpg',
      800,
      600,
      CORRS_A,
      null,
      JSON.stringify(mp),
      [],
      [],
      '',
      'skip',
    );

    const p = (await photos.list())[0];
    expect(p.manualPlacement).toBeDefined();
    expect(p.manualPlacement!.ra).toBeCloseTo(83.82, 2);
    expect(p.manualPlacement!.dec).toBeCloseTo(-5.39, 2);
  });

  it('strategy=skip returns "skipped" and leaves existing photo unchanged', async () => {
    const photos = photosOn(await import('../../server/db.js'));
    const minCorrs = [
      {
        pointIndex: 0,
        photoX: 1,
        photoY: 2,
        starHip: 1,
        starName: 'A',
        starRa: null,
        starDec: null,
      },
      {
        pointIndex: 1,
        photoX: 3,
        photoY: 4,
        starHip: 2,
        starName: 'B',
        starRa: null,
        starDec: null,
      },
    ];

    await seedPhoto(
      photos,
      'dup-id',
      'original.jpg',
      'original.jpg',
      100,
      100,
      minCorrs,
      null,
      null,
      [],
      [],
      'original note',
      'skip',
    );

    const r2 = await seedPhoto(
      photos,
      'dup-id',
      'updated.jpg',
      'updated.jpg',
      999,
      999,
      minCorrs,
      null,
      null,
      ['M1'],
      [],
      'new note',
      'skip',
    );
    expect(r2).toBe('skipped');

    const all = await photos.list();
    expect(all).toHaveLength(1);
    expect(all[0].filename).toBe('original.jpg');
    expect(all[0].width).toBe(100);
    expect(all[0].notes).toBe('original note');
    expect(all[0].dsoIds).toEqual([]);
  });

  it('strategy=replace returns "imported" and overwrites the existing photo', async () => {
    const photos = photosOn(await import('../../server/db.js'));
    const minCorrs = [
      {
        pointIndex: 0,
        photoX: 1,
        photoY: 2,
        starHip: 1,
        starName: 'A',
        starRa: null,
        starDec: null,
      },
      {
        pointIndex: 1,
        photoX: 3,
        photoY: 4,
        starHip: 2,
        starName: 'B',
        starRa: null,
        starDec: null,
      },
    ];

    await seedPhoto(
      photos,
      'rep-id',
      'original.jpg',
      'original.jpg',
      100,
      100,
      minCorrs,
      null,
      null,
      [],
      [],
      'old',
      'skip',
      [{ frames: 1, seconds: 30, filter: 'R' }],
    );

    const r2 = await seedPhoto(
      photos,
      'rep-id',
      'replaced.jpg',
      'replaced.jpg',
      800,
      600,
      minCorrs,
      null,
      null,
      ['M42'],
      ['nebula'],
      'updated',
      'replace',
      [{ frames: 12, seconds: 180, filter: 'Halpha' }],
    );
    expect(r2).toBe('imported');

    const all = await photos.list();
    expect(all).toHaveLength(1);
    expect(all[0].filename).toBe('replaced.jpg');
    expect(all[0].width).toBe(800);
    expect(all[0].dsoIds).toEqual(['M42']);
    expect(all[0].labels).toEqual(['nebula']);
    expect(all[0].integrations).toEqual([{ frames: 12, seconds: 180, filter: 'Halpha' }]);
    expect(all[0].notes).toBe('updated');
  });

  it('importPhoto/list sanitizes invalid integrations on read', async () => {
    const photos = photosOn(await import('../../server/db.js'));
    const minCorrs = [
      {
        pointIndex: 0,
        photoX: 1,
        photoY: 2,
        starHip: 1,
        starName: 'A',
        starRa: null,
        starDec: null,
      },
      {
        pointIndex: 1,
        photoX: 3,
        photoY: 4,
        starHip: 2,
        starName: 'B',
        starRa: null,
        starDec: null,
      },
    ];

    await seedPhoto(
      photos,
      'int-invalid',
      'invalid.jpg',
      'invalid.jpg',
      100,
      100,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
      [
        { frames: 5, seconds: 120, filter: 'R' },
        { frames: 0, seconds: 60, filter: 'G' } as any,
        { frames: 3.5, seconds: 60, filter: 'B' } as any,
        { frames: 3, seconds: 60, filter: '   ' } as any,
      ],
    );

    const all = await photos.list();
    expect(all).toHaveLength(1);
    expect(all[0].integrations).toEqual([{ frames: 5, seconds: 120, filter: 'R' }]);
  });

  it('findByOriginalNames returns entries whose original_name matches', async () => {
    const photos = photosOn(await import('../../server/db.js'));
    const minCorrs = [
      {
        pointIndex: 0,
        photoX: 0,
        photoY: 0,
        starHip: 1,
        starName: 'X',
        starRa: null,
        starDec: null,
      },
      {
        pointIndex: 1,
        photoX: 1,
        photoY: 1,
        starHip: 2,
        starName: 'Y',
        starRa: null,
        starDec: null,
      },
    ];

    await seedPhoto(
      photos,
      'byname-id-1',
      'uuid-a.jpg',
      'M42.jpg',
      1,
      1,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );
    await seedPhoto(
      photos,
      'byname-id-2',
      'uuid-b.jpg',
      'M31.jpg',
      1,
      1,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );

    const result = await photos.findByOriginalNames(['M42.jpg', 'ghost.jpg', 'M31.jpg']);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ originalName: 'M42.jpg', id: 'byname-id-1' });
    expect(result).toContainEqual({ originalName: 'M31.jpg', id: 'byname-id-2' });
    expect(result.map((r) => r.originalName)).not.toContain('ghost.jpg');
  });

  it('findByOriginalNames returns empty array when no names match', async () => {
    const photos = photosOn(await import('../../server/db.js'));
    expect(await photos.findByOriginalNames(['no-such-file.jpg', 'also-missing.jpg'])).toEqual([]);
  });

  it('findByOriginalNames matches on original_name, not id or filename column', async () => {
    const photos = photosOn(await import('../../server/db.js'));
    const minCorrs = [
      {
        pointIndex: 0,
        photoX: 0,
        photoY: 0,
        starHip: 1,
        starName: 'X',
        starRa: null,
        starDec: null,
      },
    ];
    // Insert with id='the-uuid', filename='the-uuid.jpg', originalName='original.jpg'
    await seedPhoto(
      photos,
      'the-uuid',
      'the-uuid.jpg',
      'original.jpg',
      1,
      1,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );

    // Should NOT match by id or filename column value
    expect(await photos.findByOriginalNames(['the-uuid'])).toEqual([]);
    expect(await photos.findByOriginalNames(['the-uuid.jpg'])).toEqual([]);
    // Should match by originalName
    const result = await photos.findByOriginalNames(['original.jpg']);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ originalName: 'original.jpg', id: 'the-uuid' });
  });

  it('full round-trip: import manifest → list → JSON matches original fields', async () => {
    const photos = photosOn(await import('../../server/db.js'));

    // Simulate the server-side import loop
    for (const p of MANIFEST_FIXTURE) {
      const result = await seedPhoto(
        photos,
        p.id,
        p.filename,
        p.originalName,
        p.width,
        p.height,
        p.correspondences,
        p.createdAt,
        (p as any).manualPlacement ? JSON.stringify((p as any).manualPlacement) : null,
        p.dsoIds,
        p.labels,
        p.notes,
        'skip',
        (p as any).integrations,
      );
      expect(result).toBe('imported');
    }

    const exported = await photos.list();
    expect(exported).toHaveLength(2);

    // Photo A
    const eA = exported.find((p) => p.id === 'aaa-111-aaa')!;
    expect(eA).toBeDefined();
    expect(eA.originalName).toBe('M1_crab.jpg');
    expect(eA.width).toBe(1024);
    expect(eA.height).toBe(768);
    expect(eA.dsoIds).toEqual(['M1', 'NGC1952']);
    expect(eA.labels).toEqual(['supernova remnant', 'red']);
    expect(eA.integrations).toEqual([
      { frames: 58, seconds: 300, filter: 'Halpha' },
      { frames: 22, seconds: 180, filter: 'OIII' },
    ]);
    expect(eA.notes).toBe('Crab nebula test note');
    expect(eA.correspondences).toHaveLength(3);
    expect(eA.correspondences[0].starHip).toBe(27989);
    expect(eA.correspondences[0].starRa).toBeCloseTo(88.7929, 4);
    expect(eA.correspondences[1].starName).toBe('Rigel');

    // Photo B — with manualPlacement
    const eB = exported.find((p) => p.id === 'bbb-222-bbb')!;
    expect(eB).toBeDefined();
    expect(eB.dsoIds).toEqual(['M31']);
    expect(eB.labels).toEqual([]);
    expect(eB.integrations).toEqual([{ frames: 40, seconds: 120, filter: 'Luminance' }]);
    expect(eB.notes).toBe('');
    expect(eB.manualPlacement).toBeDefined();
    expect(eB.manualPlacement!.ra).toBeCloseTo(10.6847, 4);
    expect(eB.manualPlacement!.dec).toBeCloseTo(41.2692, 4);

    // Simulate the server export: JSON.stringify((await photos.list())) → parse → verify
    const exportJson = JSON.stringify(exported);
    const reimported = JSON.parse(exportJson);
    expect(reimported).toHaveLength(2);

    const rA = reimported.find((p: any) => p.id === 'aaa-111-aaa');
    expect(rA.correspondences[0].starRa).toBeCloseTo(88.7929, 4);
    expect(rA.dsoIds).toEqual(['M1', 'NGC1952']);
    expect(rA.integrations).toEqual([
      { frames: 58, seconds: 300, filter: 'Halpha' },
      { frames: 22, seconds: 180, filter: 'OIII' },
    ]);

    const rB = reimported.find((p: any) => p.id === 'bbb-222-bbb');
    expect(rB.manualPlacement.ra).toBeCloseTo(10.6847, 4);
  });
});

// ─── Plan + mosaic import/export round-trip ──────────────────────────────────
// Regression for the export gap: /api/export must emit each plan's mosaics and
// the per-entry mosaicId/mosaicWDeg/mosaicHDeg so a mosaic survives an
// export→import cycle grouped (not as N ungrouped duplicate frames). This
// mirrors the server's plan import/export mapping at the DB layer (the Express
// route in server/index.ts is integration-only and excluded from the suite).

// The plan service on the same in-memory database as the legacy `db` module.
const plansOn = (db: typeof import('../../server/db.js')) =>
  createPlanService({ db: createBetterSqliteDb(db.getConnection()), newId: () => 'unused' });

describe('Plan + mosaic export/import round-trip', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DB_PATH', ':memory:');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('preserves a mosaic (grouping + tiles) and a smart-scope frame size across a round-trip', async () => {
    const db = await import('../../server/db.js');
    const plans = plansOn(db);

    // ── Seed: a plan with a 2-tile mosaic plus a standalone smart-scope frame. ──
    await plans.importPlan(
      { id: 'plan-1', name: 'Night A', position: 0, nightOf: '2026-06-20', lat: 48.85, lon: 2.35 },
      { replaceIds: [], setupId: null, index: 0 },
    );
    await plans.createMosaic('plan-1', {
      dsoId: 'M31',
      name: 'Andromeda mosaic',
      centerRa: 10.68,
      centerDec: 41.27,
      paDeg: 15,
      overlapPct: 20,
      cols: 2,
      rows: 1,
      tiles: [
        { ra: 10.4, dec: 41.27, paDeg: 15 },
        { ra: 10.9, dec: 41.27, paDeg: 15 },
      ],
    });
    const { id: smartId } = await plans.addEntry('plan-1', { dsoId: 'M42' });
    await plans.updateEntry(smartId, { mosaicWDeg: 3.25, mosaicHDeg: 3.25 });

    // ── Export (the plan list is the plans.json shape). ──
    const bundle = JSON.parse(JSON.stringify(await plans.list())); // survives JSON serialization

    // ── Wipe, then re-import (the /api/import plan loop). ──
    await plans.remove('plan-1');
    expect(await plans.list()).toEqual([]);

    for (const [i, p] of bundle.entries()) {
      expect(await plans.importPlan(p, { replaceIds: [], setupId: p.setupId, index: i })).toBe(
        true,
      );
    }

    // ── The mosaic record survived with its params. ──
    const [plan] = await plans.list();
    expect(plan.mosaics).toHaveLength(1);
    expect(plan.mosaics[0].id).toMatch(/^mo-/);
    expect(plan.mosaics[0].name).toBe('Andromeda mosaic');
    expect(plan.mosaics[0].cols).toBe(2);

    // ── Its two tiles stayed grouped (mosaic id preserved, not nulled). ──
    const tiles = plan.entries.filter((e) => e.mosaicId === plan.mosaics[0].id);
    expect(tiles).toHaveLength(2);

    // ── The standalone smart-scope frame kept its single-frame size. ──
    const smart = plan.entries.find((e) => e.id === smartId)!;
    expect(smart.mosaicId).toBeNull();
    expect(smart.mosaicWDeg).toBe(3.25);
    expect(smart.mosaicHDeg).toBe(3.25);

    // ── Per-plan observing location survived too. ──
    expect(plan.lat).toBeCloseTo(48.85, 2);
    expect(plan.lon).toBeCloseTo(2.35, 2);
  });
});

// ─── Name-based override on import ───────────────────────────────────────────
// The /api/import route matches plans/setups/gear by NAME (not internal id) so a
// re-imported item replaces the hand-recreated one instead of duplicating it.
// The Express route is integration-only/excluded; this mirrors its loop using
// the same `idsToReplaceByName` helper the route calls and the plan service.

describe('Name-based override on import (replace, else add)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DB_PATH', ':memory:');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('plan with a colliding name replaces the existing one (by name, not id)', async () => {
    const db = await import('../../server/db.js');
    const plans = plansOn(db);
    // User hand-created a plan named "Winter" with its own id.
    await plans.importPlan(
      { id: 'local-id', name: 'Winter', position: 0 },
      { replaceIds: [], setupId: null, index: 0 },
    );

    // Import a backup plan also named "Winter" but with a different (bundle) id.
    const importedName = 'Winter';
    await plans.importPlan(
      { id: 'bundle-id', name: importedName, position: 0, nightOf: '2026-06-24' },
      {
        replaceIds: idsToReplaceByName(await plans.listNames(), importedName),
        setupId: null,
        index: 0,
      },
    );

    const list = await plans.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('bundle-id');
    expect(list[0].name).toBe('Winter');
  });

  it('plan with no name match is added alongside existing plans', async () => {
    const db = await import('../../server/db.js');
    const plans = plansOn(db);
    await plans.importPlan(
      { id: 'local-id', name: 'Winter', position: 0 },
      { replaceIds: [], setupId: null, index: 0 },
    );

    const importedName = 'Summer';
    await plans.importPlan(
      { id: 'bundle-id', name: importedName, position: 1 },
      {
        replaceIds: idsToReplaceByName(await plans.listNames(), importedName),
        setupId: null,
        index: 1,
      },
    );

    const names = (await plans.list()).map((p) => p.name).sort();
    expect(names).toEqual(['Summer', 'Winter']);
  });

  // The gear service on the same in-memory database as the legacy `db` module.
  const gearOn = async (db: typeof import('../../server/db.js')) =>
    createGearService({
      db: createBetterSqliteDb(db.getConnection()),
      newId: () => 'unused',
      catalog: { telescopes: [], cameras: [], accessories: [], filters: [] },
    });

  it('gear setup with a colliding name replaces the existing one', async () => {
    const db = await import('../../server/db.js');
    const gear = await gearOn(db);
    await gear.importSetup(
      {
        id: 'local-id',
        name: 'Main rig',
        telescopeId: 't1',
        cameraId: 'c1',
        accessoryId: null,
        enabled: true,
      },
      [],
    );

    const importedName = 'Main rig';
    await gear.importSetup(
      {
        id: 'bundle-id',
        name: importedName,
        telescopeId: 't2',
        cameraId: 'c2',
        accessoryId: null,
        enabled: true,
      },
      idsToReplaceByName(await gear.listSetups(), importedName),
    );

    const setups = await gear.listSetups();
    expect(setups).toHaveLength(1);
    expect(setups[0].id).toBe('bundle-id');
    expect(setups[0].telescopeId).toBe('t2');
  });

  it('custom gear collision is scoped to the same type', async () => {
    const db = await import('../../server/db.js');
    const gear = await gearOn(db);
    // A telescope and an accessory may share a name without colliding.
    await gear.importCustom(
      { id: 'scope-local', type: 'telescope', data: { id: 'scope-local', name: 'Vega' } },
      [],
    );
    await gear.importCustom(
      { id: 'acc-1', type: 'accessory', data: { id: 'acc-1', name: 'Vega' } },
      [],
    );

    // Import a telescope also named "Vega" → replaces only the telescope.
    const importedName = 'Vega';
    const sameType = (await gear.listCustomNames()).filter((r) => r.type === 'telescope');
    await gear.importCustom(
      { id: 'scope-bundle', type: 'telescope', data: { id: 'scope-bundle', name: importedName } },
      idsToReplaceByName(sameType, importedName),
    );

    const all = await gear.listCustomNames();
    const scopes = all.filter((r) => r.type === 'telescope');
    const accessories = all.filter((r) => r.type === 'accessory');
    expect(scopes).toHaveLength(1);
    expect(scopes[0].id).toBe('scope-bundle');
    expect(accessories).toHaveLength(1); // untouched
    expect(accessories[0].id).toBe('acc-1');
  });
});

// ─── updatePhotoMetadata ───────────────────────────────────────────────────────

describe('updateMetadata', () => {
  const minCorrs = [
    {
      pointIndex: 0,
      photoX: 10,
      photoY: 20,
      starHip: 1,
      starName: 'A',
      starRa: null,
      starDec: null,
    },
    {
      pointIndex: 1,
      photoX: 30,
      photoY: 40,
      starHip: 2,
      starName: 'B',
      starRa: null,
      starDec: null,
    },
  ];

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DB_PATH', ':memory:');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('updates dsoIds, labels and notes without touching originalName', async () => {
    const photos = photosOn(await import('../../server/db.js'));

    await seedPhoto(
      photos,
      'upd-1',
      'upd-1.jpg',
      'Orion.jpg',
      800,
      600,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );

    const changed = await updateMeta(
      photos,
      'upd-1',
      ['M42', 'NGC1977'],
      ['narrowband'],
      'Test note',
      undefined,
      [{ frames: 10, seconds: 180, filter: 'Halpha' }],
    );
    expect(changed).toBe(true);

    const p = (await photos.list())[0];
    expect(p.dsoIds).toEqual(['M42', 'NGC1977']);
    expect(p.labels).toEqual(['narrowband']);
    expect(p.integrations).toEqual([{ frames: 10, seconds: 180, filter: 'Halpha' }]);
    expect(p.notes).toBe('Test note');
    expect(p.originalName).toBe('Orion.jpg'); // must be unchanged
  });

  it('drops invalid integrations during metadata update', async () => {
    const photos = photosOn(await import('../../server/db.js'));

    await seedPhoto(
      photos,
      'upd-int',
      'upd-int.jpg',
      'Integration.jpg',
      800,
      600,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );

    const changed = await updateMeta(photos, 'upd-int', [], [], '', undefined, [
      { frames: 18, seconds: 240, filter: 'OIII' },
      { frames: 0, seconds: 100, filter: 'R' } as any,
      { frames: 4, seconds: 0, filter: 'G' } as any,
      { frames: 3, seconds: 120, filter: ' ' } as any,
    ]);
    expect(changed).toBe(true);

    const p = (await photos.list())[0];
    expect(p.integrations).toEqual([{ frames: 18, seconds: 240, filter: 'OIII' }]);
  });

  it('updates originalName when provided', async () => {
    const photos = photosOn(await import('../../server/db.js'));

    await seedPhoto(
      photos,
      'upd-2',
      'upd-2.jpg',
      'M42 original.jpg',
      800,
      600,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );

    const changed = await updateMeta(photos, 'upd-2', ['M42'], [], 'some notes', 'M42 renamed.jpg');
    expect(changed).toBe(true);

    const p = (await photos.list())[0];
    expect(p.originalName).toBe('M42 renamed.jpg');
    expect(p.dsoIds).toEqual(['M42']);
    expect(p.notes).toBe('some notes');
  });

  it('returns false for a non-existent photo ID', async () => {
    const photos = photosOn(await import('../../server/db.js'));

    const changed = await updateMeta(photos, 'no-such-id', [], [], '');
    expect(changed).toBe(false);
  });

  it('returns false for a non-existent ID even when originalName is supplied', async () => {
    const photos = photosOn(await import('../../server/db.js'));

    const changed = await updateMeta(
      photos,
      'no-such-id',
      ['M1'],
      ['label'],
      'note',
      'NewName.jpg',
    );
    expect(changed).toBe(false);
  });

  it('does not affect other photos when updating one', async () => {
    const photos = photosOn(await import('../../server/db.js'));

    await seedPhoto(
      photos,
      'photo-a',
      'a.jpg',
      'PhotoA.jpg',
      1,
      1,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );
    await seedPhoto(
      photos,
      'photo-b',
      'b.jpg',
      'PhotoB.jpg',
      1,
      1,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );

    await updateMeta(photos, 'photo-a', ['M1'], ['red'], 'note a', 'PhotoA renamed.jpg');

    const all = await photos.list();
    const b = all.find((p) => p.id === 'photo-b')!;
    expect(b.originalName).toBe('PhotoB.jpg');
    expect(b.dsoIds).toEqual([]);
    expect(b.labels).toEqual([]);
  });
});

// ─── updatePhotoDrawOrder ────────────────────────────────────────────────────

describe('setOrder', () => {
  const minCorrs = [
    {
      pointIndex: 0,
      photoX: 10,
      photoY: 20,
      starHip: 1,
      starName: 'A',
      starRa: null,
      starDec: null,
    },
    {
      pointIndex: 1,
      photoX: 30,
      photoY: 40,
      starHip: 2,
      starName: 'B',
      starRa: null,
      starDec: null,
    },
  ];

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DB_PATH', ':memory:');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('persists explicit draw order and list returns photos in that order', async () => {
    const photos = photosOn(await import('../../server/db.js'));

    await seedPhoto(
      photos,
      'ord-a',
      'a.jpg',
      'A.jpg',
      1,
      1,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );
    await seedPhoto(
      photos,
      'ord-b',
      'b.jpg',
      'B.jpg',
      1,
      1,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );
    await seedPhoto(
      photos,
      'ord-c',
      'c.jpg',
      'C.jpg',
      1,
      1,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );

    const changed = await reorder(photos, ['ord-b', 'ord-c', 'ord-a']);
    expect(changed).toBe(true);

    const ordered = (await photos.list()).map((p) => p.id);
    expect(ordered).toEqual(['ord-b', 'ord-c', 'ord-a']);
  });

  it('returns false when none of the IDs exist', async () => {
    const photos = photosOn(await import('../../server/db.js'));

    const changed = await reorder(photos, ['nope-1', 'nope-2']);
    expect(changed).toBe(false);
  });
});

// ─── Error serialization ──────────────────────────────────────────────────────
// Regression for the "Import error" fallback bug:
// JSON.stringify({ error: undefined }) → '{}' → client sees no .error field
// → falls back to the generic t('settings.importError') string.
// The fix: always use err?.message ?? String(err) in catch blocks.

describe('Error serialization in catch blocks', () => {
  /** Mirrors the pattern used in server catch blocks after the fix. */
  function serializeError(err: unknown): string {
    return (err as any)?.message ?? String(err);
  }

  it('serializes a standard Error correctly', () => {
    const result = serializeError(new Error('disk full'));
    expect(result).toBe('disk full');
    // Verify it survives JSON round-trip (no undefined stripping)
    expect(JSON.parse(JSON.stringify({ error: result })).error).toBe('disk full');
  });

  it('serializes a thrown string (no .message property)', () => {
    const result = serializeError('ENOENT file not found');
    expect(result).toBe('ENOENT file not found');
    expect(JSON.parse(JSON.stringify({ error: result })).error).toBe('ENOENT file not found');
  });

  it('serializes a thrown number', () => {
    const result = serializeError(42);
    expect(result).toBe('42');
    expect(JSON.parse(JSON.stringify({ error: result })).error).toBe('42');
  });

  it('serializes a thrown object without a message field', () => {
    const result = serializeError({ code: 'ENOENT' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Crucially: the JSON body must contain a non-empty error field
    const body = JSON.parse(JSON.stringify({ error: result }));
    expect(body.error).toBeDefined();
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('old pattern: JSON.stringify strips undefined — demonstrates the bug', () => {
    // This is why the original `err.message` (without fallback) was broken
    // when a non-Error value was thrown: err.message === undefined
    const err = 'a thrown string';
    const oldBody = JSON.parse(JSON.stringify({ error: (err as any).message }));
    expect(oldBody.error).toBeUndefined(); // ← bug: client got {} → "Import error" fallback

    // New pattern is safe:
    const newBody = JSON.parse(JSON.stringify({ error: serializeError(err) }));
    expect(newBody.error).toBe('a thrown string');
  });
});

// ─── Export with stale / deleted IDs ─────────────────────────────────────────
// Regression for the empty-manifest export bug:
// If the overlay holds IDs of photos that were already deleted from the DB,
// (await photos.list()).filter(p => ids.includes(p.id)) returns [] → manifest is [].

describe('Export filtering with stale IDs', () => {
  const minCorrs = [
    { pointIndex: 0, photoX: 0, photoY: 0, starHip: 1, starName: 'X', starRa: null, starDec: null },
    { pointIndex: 1, photoX: 1, photoY: 1, starHip: 2, starName: 'Y', starRa: null, starDec: null },
  ];

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DB_PATH', ':memory:');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns empty array when all requested IDs are absent from the DB', async () => {
    const photos = photosOn(await import('../../server/db.js'));
    const staleIds = ['deleted-a', 'deleted-b'];
    // No photos inserted — simulates post-deletion state
    const selected = (await photos.list()).filter((p) => staleIds.includes(p.id));
    expect(selected).toEqual([]);
    // The manifest written to ZIP would be [] — the source of the bug
    expect(JSON.stringify(selected)).toBe('[]');
  });

  it('returns only the photos whose IDs still exist in the DB', async () => {
    const photos = photosOn(await import('../../server/db.js'));

    await seedPhoto(
      photos,
      'keep-1',
      'k1.jpg',
      'Keep1.jpg',
      1,
      1,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );
    await seedPhoto(
      photos,
      'deleted-1',
      'd1.jpg',
      'Deleted1.jpg',
      1,
      1,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );
    await seedPhoto(
      photos,
      'keep-2',
      'k2.jpg',
      'Keep2.jpg',
      1,
      1,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );

    // Simulate user deleting one photo between export-button click and server handling
    await photos.removeRow('deleted-1');

    const requestedIds = ['keep-1', 'deleted-1', 'keep-2']; // stale: still includes deleted-1
    const selected = (await photos.list()).filter((p) => requestedIds.includes(p.id));

    expect(selected).toHaveLength(2);
    expect(selected.map((p) => p.id)).toContain('keep-1');
    expect(selected.map((p) => p.id)).toContain('keep-2');
    expect(selected.map((p) => p.id)).not.toContain('deleted-1');
  });

  it('exports all photos when ids array is empty (backup-button behaviour)', async () => {
    const photos = photosOn(await import('../../server/db.js'));

    await seedPhoto(
      photos,
      'all-1',
      'a1.jpg',
      'A1.jpg',
      1,
      1,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );
    await seedPhoto(
      photos,
      'all-2',
      'a2.jpg',
      'A2.jpg',
      1,
      1,
      minCorrs,
      null,
      null,
      [],
      [],
      '',
      'skip',
    );

    const ids: string[] = [];
    // Server logic: if ids is empty → export everything
    const selected =
      Array.isArray(ids) && ids.length > 0
        ? (await photos.list()).filter((p) => ids.includes(p.id))
        : await photos.list();

    expect(selected).toHaveLength(2);
  });
});

// ─── parseManifestPhotos (Q1 — manifestVersion) ───────────────────────────────

describe('parseManifestPhotos — manifest format compatibility', () => {
  const PHOTOS = [
    {
      id: 'a',
      filename: 'a.jpg',
      originalName: 'A.jpg',
      width: 100,
      height: 100,
      correspondences: [],
    },
    {
      id: 'b',
      filename: 'b.jpg',
      originalName: 'B.jpg',
      width: 200,
      height: 200,
      correspondences: [],
    },
  ];

  it('accepts legacy format: plain JSON array', () => {
    const result = parseManifestPhotos(PHOTOS);
    expect(result).toHaveLength(2);
    expect((result[0] as any).id).toBe('a');
  });

  it('accepts new format: { manifestVersion: 1, photos: [...] }', () => {
    const result = parseManifestPhotos({ manifestVersion: 1, photos: PHOTOS });
    expect(result).toHaveLength(2);
    expect((result[0] as any).id).toBe('a');
    expect((result[1] as any).id).toBe('b');
  });

  it('new format with empty photos array returns empty array', () => {
    const result = parseManifestPhotos({ manifestVersion: 1, photos: [] });
    expect(result).toEqual([]);
  });

  it('legacy format with empty array returns empty array', () => {
    expect(parseManifestPhotos([])).toEqual([]);
  });

  it('returns empty array for completely unrecognised input (string)', () => {
    expect(parseManifestPhotos('not a manifest')).toEqual([]);
  });

  it('returns empty array for null', () => {
    expect(parseManifestPhotos(null)).toEqual([]);
  });

  it('returns empty array for object with non-array photos field', () => {
    expect(parseManifestPhotos({ manifestVersion: 1, photos: 'wrong' })).toEqual([]);
  });

  it('new format preserves photo fields verbatim', () => {
    const result = parseManifestPhotos({ manifestVersion: 1, photos: PHOTOS });
    expect(result[0]).toBe(PHOTOS[0]); // same reference — no cloning
  });

  it('export round-trip: manifest written with version 1 is parseable', () => {
    const manifest = { manifestVersion: 1, photos: PHOTOS };
    const serialised = JSON.stringify(manifest);
    const result = parseManifestPhotos(JSON.parse(serialised));
    expect(result).toHaveLength(2);
    expect((result[0] as any).filename).toBe('a.jpg');
  });
});

// ─── validateDsoOverrideCoords (Q2 — RA/Dec range validation) ────────────────

describe('validateDsoOverrideCoords — coordinate range guard', () => {
  it('returns null when both RA and Dec are valid', () => {
    expect(validateDsoOverrideCoords({ ra: 180, dec: 45 })).toBeNull();
  });

  it('returns null when neither RA nor Dec is provided', () => {
    expect(validateDsoOverrideCoords({})).toBeNull();
  });

  it('returns null when only a name override is present (no coords)', () => {
    expect(validateDsoOverrideCoords({ names: { en: 'M42' } } as any)).toBeNull();
  });

  it('returns null for RA = 0 (lower boundary)', () => {
    expect(validateDsoOverrideCoords({ ra: 0 })).toBeNull();
  });

  it('returns null for RA = 359.999 (near upper boundary)', () => {
    expect(validateDsoOverrideCoords({ ra: 359.999 })).toBeNull();
  });

  it('returns null for Dec = -90 (lower boundary)', () => {
    expect(validateDsoOverrideCoords({ dec: -90 })).toBeNull();
  });

  it('returns null for Dec = 90 (upper boundary)', () => {
    expect(validateDsoOverrideCoords({ dec: 90 })).toBeNull();
  });

  it('returns INVALID_DSO_RA when RA = 360 (equals upper bound, exclusive)', () => {
    const result = validateDsoOverrideCoords({ ra: 360 });
    expect(result).not.toBeNull();
    expect(result!.code).toBe('INVALID_DSO_RA');
    expect(result!.error).toContain('360');
  });

  it('returns INVALID_DSO_RA when RA is negative', () => {
    const result = validateDsoOverrideCoords({ ra: -1 });
    expect(result).not.toBeNull();
    expect(result!.code).toBe('INVALID_DSO_RA');
  });

  it('returns INVALID_DSO_DEC when Dec = 91', () => {
    const result = validateDsoOverrideCoords({ dec: 91 });
    expect(result).not.toBeNull();
    expect(result!.code).toBe('INVALID_DSO_DEC');
    expect(result!.error).toContain('90');
  });

  it('returns INVALID_DSO_DEC when Dec = -91', () => {
    const result = validateDsoOverrideCoords({ dec: -91 });
    expect(result).not.toBeNull();
    expect(result!.code).toBe('INVALID_DSO_DEC');
  });

  it('RA error takes priority over Dec error when both are invalid', () => {
    const result = validateDsoOverrideCoords({ ra: -5, dec: 999 });
    expect(result).not.toBeNull();
    expect(result!.code).toBe('INVALID_DSO_RA');
  });

  it('ignores non-number RA/Dec (type-safe: only validates numbers)', () => {
    expect(validateDsoOverrideCoords({ ra: '180' as any })).toBeNull();
    expect(validateDsoOverrideCoords({ dec: null as any })).toBeNull();
  });
});

// ─── inspectZipContents ───────────────────────────────────────────────────────

/** Build a mock ZipEntry from a file path and string content. */
function mockEntry(filePath: string, content: string, size?: number): ZipEntry {
  const buf = Buffer.from(content, 'utf8');
  return {
    path: filePath,
    type: 'File',
    uncompressedSize: size ?? buf.byteLength,
    buffer: async () => buf,
  };
}

/** A manifest with two photos, where the second has a thumbFilename. */
const MANIFEST_WITH_THUMBS = JSON.stringify({
  manifestVersion: 1,
  photos: [
    {
      id: 'ph1',
      filename: 'ph1.jpg',
      originalName: 'Orion.jpg',
      width: 800,
      height: 600,
      correspondences: [],
    },
    {
      id: 'ph2',
      filename: 'ph2.jpg',
      originalName: 'M31.jpg',
      width: 1024,
      height: 768,
      correspondences: [],
      thumbFilename: 'ph2_thumb.jpg',
    },
  ],
});

describe('inspectZipContents — ZIP content inspection', () => {
  it('returns all-false for an empty entry list', async () => {
    const result = await inspectZipContents([]);
    expect(result.hasMetadata).toBe(false);
    expect(result.photos).toEqual([]);
    expect(result.hasDsoOverrides).toBe(false);
    expect(result.hasCustomGear).toBe(false);
    expect(result.hasSetups).toBe(false);
    expect(result.imageEntries).toEqual([]);
  });

  it('returns all-false for unrecognised root files', async () => {
    const result = await inspectZipContents([
      mockEntry('readme.txt', 'hello'),
      mockEntry('random.bin', 'data'),
    ]);
    expect(result.hasMetadata).toBe(false);
    expect(result.hasDsoOverrides).toBe(false);
    expect(result.hasCustomGear).toBe(false);
    expect(result.hasSetups).toBe(false);
    expect(result.imageEntries).toHaveLength(0);
  });

  it('detects manifest.json and parses photos (legacy array format)', async () => {
    const manifest = JSON.stringify([
      {
        id: 'a',
        filename: 'a.jpg',
        originalName: 'A.jpg',
        width: 100,
        height: 100,
        correspondences: [],
      },
    ]);
    const result = await inspectZipContents([mockEntry('manifest.json', manifest)]);
    expect(result.hasMetadata).toBe(true);
    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].filename).toBe('a.jpg');
    expect(result.photos[0].originalName).toBe('A.jpg');
    expect(result.photos[0].thumbFilename).toBeNull();
  });

  it('detects manifest.json with manifestVersion:1 wrapper', async () => {
    const result = await inspectZipContents([mockEntry('manifest.json', MANIFEST_WITH_THUMBS)]);
    expect(result.hasMetadata).toBe(true);
    expect(result.photos).toHaveLength(2);
    expect(result.photos[1].thumbFilename).toBe('ph2_thumb.jpg');
  });

  it('returns hasMetadata true for an empty manifest array (file present)', async () => {
    const result = await inspectZipContents([mockEntry('manifest.json', '[]')]);
    expect(result.hasMetadata).toBe(true);
    expect(result.photos).toHaveLength(0);
  });

  it('detects dso-overrides.json with entries → hasDsoOverrides true', async () => {
    const dso = JSON.stringify({ NGC1952: { name_en: 'Crab Nebula' } });
    const result = await inspectZipContents([mockEntry('dso-overrides.json', dso)]);
    expect(result.hasDsoOverrides).toBe(true);
    expect(result.hasCustomGear).toBe(false);
    expect(result.hasSetups).toBe(false);
    expect(result.hasMetadata).toBe(false);
  });

  it('does NOT set hasDsoOverrides for an empty dso-overrides object', async () => {
    const result = await inspectZipContents([mockEntry('dso-overrides.json', '{}')]);
    expect(result.hasDsoOverrides).toBe(false);
  });

  it('detects custom-gear.json with entries → hasCustomGear true + gearItems', async () => {
    const gear = JSON.stringify([
      { id: 'custom-1', type: 'telescope', name: 'MyScope' },
      { id: 'custom-2', type: 'camera' }, // missing name → falls back to id
    ]);
    const result = await inspectZipContents([mockEntry('custom-gear.json', gear)]);
    expect(result.hasCustomGear).toBe(true);
    expect(result.hasDsoOverrides).toBe(false);
    expect(result.gearItems).toEqual([
      { id: 'custom-1', type: 'telescope', name: 'MyScope' },
      { id: 'custom-2', type: 'camera', name: 'custom-2' },
    ]);
  });

  it('does NOT set hasCustomGear for an empty custom-gear array', async () => {
    const result = await inspectZipContents([mockEntry('custom-gear.json', '[]')]);
    expect(result.hasCustomGear).toBe(false);
  });

  it('detects gear-setups.json with entries → hasSetups true + setupItems', async () => {
    const setups = JSON.stringify([
      { id: 's1', telescopeId: 't1', cameraId: 'c1', name: 'Setup A', enabled: true },
    ]);
    const result = await inspectZipContents([mockEntry('gear-setups.json', setups)]);
    expect(result.hasSetups).toBe(true);
    expect(result.setupItems).toEqual([{ id: 's1', name: 'Setup A' }]);
  });

  it('does NOT set hasSetups for an empty gear-setups array', async () => {
    const result = await inspectZipContents([mockEntry('gear-setups.json', '[]')]);
    expect(result.hasSetups).toBe(false);
  });

  it('detects plans.json with entries → hasPlans true (independent of hasSetups) + planItems', async () => {
    const plans = JSON.stringify([
      { id: 'plan-1', name: 'Night A', position: 0, entries: [] },
      { id: 'plan-2', name: 'Night B', position: 1, entries: [] },
    ]);
    const result = await inspectZipContents([mockEntry('plans.json', plans)]);
    expect(result.hasPlans).toBe(true);
    expect(result.hasSetups).toBe(false);
    expect(result.planItems).toEqual([
      { id: 'plan-1', name: 'Night A' },
      { id: 'plan-2', name: 'Night B' },
    ]);
  });

  it('does NOT set hasPlans for an empty plans array', async () => {
    const result = await inspectZipContents([mockEntry('plans.json', '[]')]);
    expect(result.hasPlans).toBe(false);
  });

  it('lists image files from images/ directory', async () => {
    const result = await inspectZipContents([
      mockEntry('images/photo.jpg', 'imgdata', 5000),
      mockEntry('images/another.png', 'pngdata', 8000),
    ]);
    expect(result.imageEntries).toHaveLength(2);
    expect(result.imageEntries.map((e) => e.filename)).toContain('photo.jpg');
    expect(result.imageEntries.map((e) => e.filename)).toContain('another.png');
    expect(result.imageEntries.find((e) => e.filename === 'photo.jpg')!.size).toBe(5000);
  });

  it('excludes thumbnails (listed in manifest thumbFilename) from imageEntries', async () => {
    const result = await inspectZipContents([
      mockEntry('manifest.json', MANIFEST_WITH_THUMBS),
      mockEntry('images/ph1.jpg', 'imgdata', 4000),
      mockEntry('images/ph2.jpg', 'imgdata', 6000),
      mockEntry('images/ph2_thumb.jpg', 'thumbdata', 1000),
    ]);
    expect(result.imageEntries).toHaveLength(2);
    expect(result.imageEntries.map((e) => e.filename)).toContain('ph1.jpg');
    expect(result.imageEntries.map((e) => e.filename)).toContain('ph2.jpg');
    expect(result.imageEntries.map((e) => e.filename)).not.toContain('ph2_thumb.jpg');
  });

  it('images-only ZIP (no manifest): imageEntries lists all images, hasMetadata false', async () => {
    const result = await inspectZipContents([
      mockEntry('images/alpha.jpg', 'data', 3000),
      mockEntry('images/beta.fits', 'fitsdata', 12000),
    ]);
    expect(result.hasMetadata).toBe(false);
    expect(result.photos).toHaveLength(0);
    expect(result.imageEntries).toHaveLength(2);
  });

  it('metadata-only ZIP (manifest, no images/): imageEntries empty', async () => {
    const manifest = JSON.stringify([
      {
        id: 'x',
        filename: 'x.jpg',
        originalName: 'X.jpg',
        width: 1,
        height: 1,
        correspondences: [],
      },
    ]);
    const result = await inspectZipContents([mockEntry('manifest.json', manifest)]);
    expect(result.hasMetadata).toBe(true);
    expect(result.imageEntries).toHaveLength(0);
  });

  it('full ZIP with all sections → all flags true, images list correct', async () => {
    const dso = JSON.stringify({ M1: { name_en: 'Crab Nebula' } });
    const gear = JSON.stringify([{ id: 'custom-t1', type: 'telescope', name: 'RC8' }]);
    const setups = JSON.stringify([
      { id: 's1', telescopeId: 'custom-t1', cameraId: 'c1', name: 'Main', enabled: true },
    ]);
    const result = await inspectZipContents([
      mockEntry('manifest.json', MANIFEST_WITH_THUMBS),
      mockEntry('dso-overrides.json', dso),
      mockEntry('custom-gear.json', gear),
      mockEntry('gear-setups.json', setups),
      mockEntry('images/ph1.jpg', 'data', 5000),
      mockEntry('images/ph2.jpg', 'data', 7000),
      mockEntry('images/ph2_thumb.jpg', 'thumbdata', 1200),
    ]);
    expect(result.hasMetadata).toBe(true);
    expect(result.hasDsoOverrides).toBe(true);
    expect(result.hasCustomGear).toBe(true);
    expect(result.hasSetups).toBe(true);
    expect(result.photos).toHaveLength(2);
    expect(result.imageEntries).toHaveLength(2);
    expect(result.imageEntries.map((e) => e.filename)).not.toContain('ph2_thumb.jpg');
  });

  it('skips image entries with disallowed extensions', async () => {
    const result = await inspectZipContents([
      mockEntry('images/photo.jpg', 'data', 5000),
      mockEntry('images/script.exe', 'malicious', 100),
      mockEntry('images/data.json', '{}', 50),
    ]);
    expect(result.imageEntries).toHaveLength(1);
    expect(result.imageEntries[0].filename).toBe('photo.jpg');
  });

  it('ignores Directory type entries', async () => {
    const dirEntry: ZipEntry = {
      path: 'images/',
      type: 'Directory',
      uncompressedSize: 0,
      buffer: async () => Buffer.alloc(0),
    };
    const result = await inspectZipContents([
      dirEntry,
      mockEntry('images/photo.jpg', 'data', 2000),
    ]);
    expect(result.imageEntries).toHaveLength(1);
  });

  it('gracefully handles malformed JSON in manifest (no throw)', async () => {
    const result = await inspectZipContents([mockEntry('manifest.json', 'NOT JSON')]);
    expect(result.hasMetadata).toBe(false);
    expect(result.photos).toHaveLength(0);
  });

  it('gracefully handles malformed JSON in dso-overrides (no throw)', async () => {
    const result = await inspectZipContents([mockEntry('dso-overrides.json', 'NOT JSON')]);
    expect(result.hasDsoOverrides).toBe(false);
  });
});

describe('buildZipPreviewResponse', () => {
  // A ZipInspectResult with every detectable section present.
  const fullInspect: ZipInspectResult = {
    hasMetadata: true,
    photos: [{ filename: 'a.jpg', originalName: 'A.jpg', thumbFilename: null }],
    hasDsoOverrides: true,
    hasCustomGear: true,
    hasSetups: true,
    hasPlans: true,
    planItems: [{ id: 'plan-1', name: 'Night A' }],
    setupItems: [{ id: 'setup-1', name: 'Main rig' }],
    gearItems: [{ id: 'gear-1', type: 'telescope', name: 'RC8' }],
    imageEntries: [{ filename: 'a.jpg', size: 5000 }],
  };
  const noExtra = {
    hasShortcuts: false,
    shortcuts: undefined,
    images: [],
    plans: [],
    setups: [],
    gear: [],
  };

  it('forwards every has* flag from the inspect result (regression: hasPlans was dropped)', () => {
    const res = buildZipPreviewResponse(fullInspect, noExtra);
    expect(res.hasMetadata).toBe(true);
    expect(res.hasDsoOverrides).toBe(true);
    expect(res.hasCustomGear).toBe(true);
    expect(res.hasSetups).toBe(true);
    expect(res.hasPlans).toBe(true);
  });

  it('hasMetadata is false when the manifest carries no photos', () => {
    const res = buildZipPreviewResponse({ ...fullInspect, hasMetadata: true, photos: [] }, noExtra);
    expect(res.hasMetadata).toBe(false);
    expect(res.photos).toBe(0);
  });

  it('reports the photo count and passes through shortcuts + images', () => {
    const images = [{ filename: 'a.jpg', originalName: 'A.jpg', size: 5000, exists: false }];
    const shortcuts = { save: 'ctrl+s' };
    const res = buildZipPreviewResponse(fullInspect, {
      hasShortcuts: true,
      shortcuts,
      images,
      plans: [],
      setups: [],
      gear: [],
    });
    expect(res.photos).toBe(1);
    expect(res.hasShortcuts).toBe(true);
    expect(res.shortcuts).toEqual(shortcuts);
    expect(res.images).toEqual(images);
  });

  it('passes through the resolved plans/setups/gear arrays (with exists flags)', () => {
    const plans = [{ id: 'plan-1', name: 'Night A', exists: true }];
    const setups = [{ id: 'setup-1', name: 'Main rig', exists: false }];
    const gear = [{ id: 'gear-1', type: 'telescope', name: 'RC8', exists: true }];
    const res = buildZipPreviewResponse(fullInspect, {
      hasShortcuts: false,
      images: [],
      plans,
      setups,
      gear,
    });
    expect(res.plans).toEqual(plans);
    expect(res.setups).toEqual(setups);
    expect(res.gear).toEqual(gear);
  });
});

// ─── idsToReplaceByName ───────────────────────────────────────────────────────

describe('idsToReplaceByName — name-collision resolution', () => {
  const existing = [
    { id: 'a', name: 'Night A' },
    { id: 'b', name: 'Night B' },
    { id: 'c', name: 'Night A' }, // duplicate name with a different id
  ];

  it('returns ids of every existing row whose name matches', () => {
    expect(idsToReplaceByName(existing, 'Night A')).toEqual(['a', 'c']);
  });

  it('returns the single matching id', () => {
    expect(idsToReplaceByName(existing, 'Night B')).toEqual(['b']);
  });

  it('returns an empty array when no name matches (added as new)', () => {
    expect(idsToReplaceByName(existing, 'Night Z')).toEqual([]);
  });

  it('returns an empty array for an empty existing list', () => {
    expect(idsToReplaceByName([], 'Anything')).toEqual([]);
  });
});
