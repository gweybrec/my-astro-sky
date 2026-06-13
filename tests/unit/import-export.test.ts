import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isValidZipEntryPath, parseManifestPhotos, validateDsoOverrideCoords, inspectZipContents } from '../../server/import-utils';
import type { ZipEntry } from '../../server/import-utils';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CORRS_A = [
  { pointIndex: 0, photoX: 100, photoY: 200, starHip: 27989, starName: 'Betelgeuse', starRa: 88.7929, starDec: 7.4071 },
  { pointIndex: 1, photoX: 400, photoY: 600, starHip: 32349, starName: 'Rigel',      starRa: 78.6345, starDec: -8.2016 },
  { pointIndex: 2, photoX: 700, photoY: 100, starHip: 24436, starName: 'Bellatrix',  starRa: 81.2827, starDec:  6.3497 },
];

const CORRS_B = [
  { pointIndex: 0, photoX:  50, photoY:  75, starHip: 3179, starName: 'Mirach',     starRa: 17.4330, starDec: 35.6202 },
  { pointIndex: 1, photoX: 600, photoY: 400, starHip: 5447, starName: 'Alpheratz',  starRa:  0.1397, starDec: 29.0904 },
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

  it('createPhotoWithId inserts all fields and getAllPhotos returns them correctly', async () => {
    const { createPhotoWithId, getAllPhotos } = await import('../../server/db.js');

    const result = createPhotoWithId(
      'test-id-1', 'test-id-1.jpg', 'M101.jpg', 1920, 1080,
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

    const all = getAllPhotos();
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

  it('createPhotoWithId preserves manualPlacement', async () => {
    const { createPhotoWithId, getAllPhotos } = await import('../../server/db.js');
    const mp = { ra: 83.82, dec: -5.39, projPerPx: 0.002, rotDeg: 0 };

    createPhotoWithId(
      'mp-test', 'mp-test.jpg', 'Orion.jpg', 800, 600,
      CORRS_A,
      null,
      JSON.stringify(mp),
      [], [], '',
      'skip',
    );

    const p = getAllPhotos()[0];
    expect(p.manualPlacement).toBeDefined();
    expect(p.manualPlacement!.ra).toBeCloseTo(83.82, 2);
    expect(p.manualPlacement!.dec).toBeCloseTo(-5.39, 2);
  });

  it('strategy=skip returns "skipped" and leaves existing photo unchanged', async () => {
    const { createPhotoWithId, getAllPhotos } = await import('../../server/db.js');
    const minCorrs = [
      { pointIndex: 0, photoX: 1, photoY: 2, starHip: 1, starName: 'A', starRa: null, starDec: null },
      { pointIndex: 1, photoX: 3, photoY: 4, starHip: 2, starName: 'B', starRa: null, starDec: null },
    ];

    createPhotoWithId('dup-id', 'original.jpg', 'original.jpg', 100, 100, minCorrs, null, null, [], [], 'original note', 'skip');

    const r2 = createPhotoWithId('dup-id', 'updated.jpg', 'updated.jpg', 999, 999, minCorrs, null, null, ['M1'], [], 'new note', 'skip');
    expect(r2).toBe('skipped');

    const all = getAllPhotos();
    expect(all).toHaveLength(1);
    expect(all[0].filename).toBe('original.jpg');
    expect(all[0].width).toBe(100);
    expect(all[0].notes).toBe('original note');
    expect(all[0].dsoIds).toEqual([]);
  });

  it('strategy=replace returns "imported" and overwrites the existing photo', async () => {
    const { createPhotoWithId, getAllPhotos } = await import('../../server/db.js');
    const minCorrs = [
      { pointIndex: 0, photoX: 1, photoY: 2, starHip: 1, starName: 'A', starRa: null, starDec: null },
      { pointIndex: 1, photoX: 3, photoY: 4, starHip: 2, starName: 'B', starRa: null, starDec: null },
    ];

    createPhotoWithId('rep-id', 'original.jpg', 'original.jpg', 100, 100, minCorrs, null, null, [], [], 'old', 'skip', [{ frames: 1, seconds: 30, filter: 'R' }]);

    const r2 = createPhotoWithId('rep-id', 'replaced.jpg', 'replaced.jpg', 800, 600, minCorrs, null, null, ['M42'], ['nebula'], 'updated', 'replace', [{ frames: 12, seconds: 180, filter: 'Halpha' }]);
    expect(r2).toBe('imported');

    const all = getAllPhotos();
    expect(all).toHaveLength(1);
    expect(all[0].filename).toBe('replaced.jpg');
    expect(all[0].width).toBe(800);
    expect(all[0].dsoIds).toEqual(['M42']);
    expect(all[0].labels).toEqual(['nebula']);
    expect(all[0].integrations).toEqual([{ frames: 12, seconds: 180, filter: 'Halpha' }]);
    expect(all[0].notes).toBe('updated');
  });

  it('createPhotoWithId/getAllPhotos sanitizes invalid integrations on read', async () => {
    const { createPhotoWithId, getAllPhotos } = await import('../../server/db.js');
    const minCorrs = [
      { pointIndex: 0, photoX: 1, photoY: 2, starHip: 1, starName: 'A', starRa: null, starDec: null },
      { pointIndex: 1, photoX: 3, photoY: 4, starHip: 2, starName: 'B', starRa: null, starDec: null },
    ];

    createPhotoWithId(
      'int-invalid', 'invalid.jpg', 'invalid.jpg', 100, 100,
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

    const all = getAllPhotos();
    expect(all).toHaveLength(1);
    expect(all[0].integrations).toEqual([{ frames: 5, seconds: 120, filter: 'R' }]);
  });

  it('checkPhotosExist returns only IDs present in the DB', async () => {
    const { createPhotoWithId, checkPhotosExist } = await import('../../server/db.js');
    const minCorrs = [
      { pointIndex: 0, photoX: 0, photoY: 0, starHip: 1, starName: 'X', starRa: null, starDec: null },
      { pointIndex: 1, photoX: 1, photoY: 1, starHip: 2, starName: 'Y', starRa: null, starDec: null },
    ];

    createPhotoWithId('exists-1', 'f1.jpg', 'f1.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');
    createPhotoWithId('exists-2', 'f2.jpg', 'f2.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');

    const result = checkPhotosExist(['exists-1', 'ghost-a', 'exists-2', 'ghost-b']);
    expect(result).toHaveLength(2);
    expect(result).toContain('exists-1');
    expect(result).toContain('exists-2');
    expect(result).not.toContain('ghost-a');
    expect(result).not.toContain('ghost-b');
  });

  it('checkPhotosExist returns empty array when no IDs match', async () => {
    const { checkPhotosExist } = await import('../../server/db.js');
    expect(checkPhotosExist(['no-such-id', 'also-missing'])).toEqual([]);
  });

  it('checkPhotosExistByName returns entries whose original_name matches', async () => {
    const { createPhotoWithId, checkPhotosExistByName } = await import('../../server/db.js');
    const minCorrs = [
      { pointIndex: 0, photoX: 0, photoY: 0, starHip: 1, starName: 'X', starRa: null, starDec: null },
      { pointIndex: 1, photoX: 1, photoY: 1, starHip: 2, starName: 'Y', starRa: null, starDec: null },
    ];

    createPhotoWithId('byname-id-1', 'uuid-a.jpg', 'M42.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');
    createPhotoWithId('byname-id-2', 'uuid-b.jpg', 'M31.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');

    const result = checkPhotosExistByName(['M42.jpg', 'ghost.jpg', 'M31.jpg']);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ originalName: 'M42.jpg', id: 'byname-id-1' });
    expect(result).toContainEqual({ originalName: 'M31.jpg', id: 'byname-id-2' });
    expect(result.map(r => r.originalName)).not.toContain('ghost.jpg');
  });

  it('checkPhotosExistByName returns empty array when no names match', async () => {
    const { checkPhotosExistByName } = await import('../../server/db.js');
    expect(checkPhotosExistByName(['no-such-file.jpg', 'also-missing.jpg'])).toEqual([]);
  });

  it('checkPhotosExistByName matches on original_name, not id or filename column', async () => {
    const { createPhotoWithId, checkPhotosExistByName } = await import('../../server/db.js');
    const minCorrs = [
      { pointIndex: 0, photoX: 0, photoY: 0, starHip: 1, starName: 'X', starRa: null, starDec: null },
    ];
    // Insert with id='the-uuid', filename='the-uuid.jpg', originalName='original.jpg'
    createPhotoWithId('the-uuid', 'the-uuid.jpg', 'original.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');

    // Should NOT match by id or filename column value
    expect(checkPhotosExistByName(['the-uuid'])).toEqual([]);
    expect(checkPhotosExistByName(['the-uuid.jpg'])).toEqual([]);
    // Should match by originalName
    const result = checkPhotosExistByName(['original.jpg']);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ originalName: 'original.jpg', id: 'the-uuid' });
  });

  it('full round-trip: import manifest → getAllPhotos → JSON matches original fields', async () => {
    const { createPhotoWithId, getAllPhotos } = await import('../../server/db.js');

    // Simulate the server-side import loop
    for (const p of MANIFEST_FIXTURE) {
      const result = createPhotoWithId(
        p.id, p.filename, p.originalName, p.width, p.height,
        p.correspondences,
        p.createdAt,
        (p as any).manualPlacement ? JSON.stringify((p as any).manualPlacement) : null,
        p.dsoIds, p.labels, p.notes,
        'skip',
        (p as any).integrations,
      );
      expect(result).toBe('imported');
    }

    const exported = getAllPhotos();
    expect(exported).toHaveLength(2);

    // Photo A
    const eA = exported.find(p => p.id === 'aaa-111-aaa')!;
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
    const eB = exported.find(p => p.id === 'bbb-222-bbb')!;
    expect(eB).toBeDefined();
    expect(eB.dsoIds).toEqual(['M31']);
    expect(eB.labels).toEqual([]);
    expect(eB.integrations).toEqual([{ frames: 40, seconds: 120, filter: 'Luminance' }]);
    expect(eB.notes).toBe('');
    expect(eB.manualPlacement).toBeDefined();
    expect(eB.manualPlacement!.ra).toBeCloseTo(10.6847, 4);
    expect(eB.manualPlacement!.dec).toBeCloseTo(41.2692, 4);

    // Simulate the server export: JSON.stringify(getAllPhotos()) → parse → verify
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

// ─── updatePhotoMetadata ───────────────────────────────────────────────────────

describe('updatePhotoMetadata', () => {
  const minCorrs = [
    { pointIndex: 0, photoX: 10, photoY: 20, starHip: 1, starName: 'A', starRa: null, starDec: null },
    { pointIndex: 1, photoX: 30, photoY: 40, starHip: 2, starName: 'B', starRa: null, starDec: null },
  ];

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DB_PATH', ':memory:');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('updates dsoIds, labels and notes without touching originalName', async () => {
    const { createPhotoWithId, updatePhotoMetadata, getAllPhotos } = await import('../../server/db.js');

    createPhotoWithId('upd-1', 'upd-1.jpg', 'Orion.jpg', 800, 600, minCorrs, null, null, [], [], '', 'skip');

    const changed = updatePhotoMetadata('upd-1', ['M42', 'NGC1977'], ['narrowband'], 'Test note', undefined, [{ frames: 10, seconds: 180, filter: 'Halpha' }]);
    expect(changed).toBe(true);

    const p = getAllPhotos()[0];
    expect(p.dsoIds).toEqual(['M42', 'NGC1977']);
    expect(p.labels).toEqual(['narrowband']);
    expect(p.integrations).toEqual([{ frames: 10, seconds: 180, filter: 'Halpha' }]);
    expect(p.notes).toBe('Test note');
    expect(p.originalName).toBe('Orion.jpg'); // must be unchanged
  });

  it('drops invalid integrations during metadata update', async () => {
    const { createPhotoWithId, updatePhotoMetadata, getAllPhotos } = await import('../../server/db.js');

    createPhotoWithId('upd-int', 'upd-int.jpg', 'Integration.jpg', 800, 600, minCorrs, null, null, [], [], '', 'skip');

    const changed = updatePhotoMetadata('upd-int', [], [], '', undefined, [
      { frames: 18, seconds: 240, filter: 'OIII' },
      { frames: 0, seconds: 100, filter: 'R' } as any,
      { frames: 4, seconds: 0, filter: 'G' } as any,
      { frames: 3, seconds: 120, filter: ' ' } as any,
    ]);
    expect(changed).toBe(true);

    const p = getAllPhotos()[0];
    expect(p.integrations).toEqual([{ frames: 18, seconds: 240, filter: 'OIII' }]);
  });

  it('updates originalName when provided', async () => {
    const { createPhotoWithId, updatePhotoMetadata, getAllPhotos } = await import('../../server/db.js');

    createPhotoWithId('upd-2', 'upd-2.jpg', 'M42 original.jpg', 800, 600, minCorrs, null, null, [], [], '', 'skip');

    const changed = updatePhotoMetadata('upd-2', ['M42'], [], 'some notes', 'M42 renamed.jpg');
    expect(changed).toBe(true);

    const p = getAllPhotos()[0];
    expect(p.originalName).toBe('M42 renamed.jpg');
    expect(p.dsoIds).toEqual(['M42']);
    expect(p.notes).toBe('some notes');
  });

  it('returns false for a non-existent photo ID', async () => {
    const { updatePhotoMetadata } = await import('../../server/db.js');

    const changed = updatePhotoMetadata('no-such-id', [], [], '');
    expect(changed).toBe(false);
  });

  it('returns false for a non-existent ID even when originalName is supplied', async () => {
    const { updatePhotoMetadata } = await import('../../server/db.js');

    const changed = updatePhotoMetadata('no-such-id', ['M1'], ['label'], 'note', 'NewName.jpg');
    expect(changed).toBe(false);
  });

  it('does not affect other photos when updating one', async () => {
    const { createPhotoWithId, updatePhotoMetadata, getAllPhotos } = await import('../../server/db.js');

    createPhotoWithId('photo-a', 'a.jpg', 'PhotoA.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');
    createPhotoWithId('photo-b', 'b.jpg', 'PhotoB.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');

    updatePhotoMetadata('photo-a', ['M1'], ['red'], 'note a', 'PhotoA renamed.jpg');

    const all = getAllPhotos();
    const b = all.find(p => p.id === 'photo-b')!;
    expect(b.originalName).toBe('PhotoB.jpg');
    expect(b.dsoIds).toEqual([]);
    expect(b.labels).toEqual([]);
  });
});

// ─── updatePhotoDrawOrder ────────────────────────────────────────────────────

describe('updatePhotoDrawOrder', () => {
  const minCorrs = [
    { pointIndex: 0, photoX: 10, photoY: 20, starHip: 1, starName: 'A', starRa: null, starDec: null },
    { pointIndex: 1, photoX: 30, photoY: 40, starHip: 2, starName: 'B', starRa: null, starDec: null },
  ];

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DB_PATH', ':memory:');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('persists explicit draw order and getAllPhotos returns photos in that order', async () => {
    const { createPhotoWithId, updatePhotoDrawOrder, getAllPhotos } = await import('../../server/db.js');

    createPhotoWithId('ord-a', 'a.jpg', 'A.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');
    createPhotoWithId('ord-b', 'b.jpg', 'B.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');
    createPhotoWithId('ord-c', 'c.jpg', 'C.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');

    const changed = updatePhotoDrawOrder(['ord-b', 'ord-c', 'ord-a']);
    expect(changed).toBe(true);

    const ordered = getAllPhotos().map(p => p.id);
    expect(ordered).toEqual(['ord-b', 'ord-c', 'ord-a']);
  });

  it('returns false when none of the IDs exist', async () => {
    const { updatePhotoDrawOrder } = await import('../../server/db.js');

    const changed = updatePhotoDrawOrder(['nope-1', 'nope-2']);
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
// getAllPhotos().filter(p => ids.includes(p.id)) returns [] → manifest is [].

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
    const { getAllPhotos } = await import('../../server/db.js');
    const staleIds = ['deleted-a', 'deleted-b'];
    // No photos inserted — simulates post-deletion state
    const selected = getAllPhotos().filter(p => staleIds.includes(p.id));
    expect(selected).toEqual([]);
    // The manifest written to ZIP would be [] — the source of the bug
    expect(JSON.stringify(selected)).toBe('[]');
  });

  it('returns only the photos whose IDs still exist in the DB', async () => {
    const { createPhotoWithId, deletePhoto, getAllPhotos } = await import('../../server/db.js');

    createPhotoWithId('keep-1', 'k1.jpg', 'Keep1.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');
    createPhotoWithId('deleted-1', 'd1.jpg', 'Deleted1.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');
    createPhotoWithId('keep-2', 'k2.jpg', 'Keep2.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');

    // Simulate user deleting one photo between export-button click and server handling
    deletePhoto('deleted-1');

    const requestedIds = ['keep-1', 'deleted-1', 'keep-2']; // stale: still includes deleted-1
    const selected = getAllPhotos().filter(p => requestedIds.includes(p.id));

    expect(selected).toHaveLength(2);
    expect(selected.map(p => p.id)).toContain('keep-1');
    expect(selected.map(p => p.id)).toContain('keep-2');
    expect(selected.map(p => p.id)).not.toContain('deleted-1');
  });

  it('exports all photos when ids array is empty (backup-button behaviour)', async () => {
    const { createPhotoWithId, getAllPhotos } = await import('../../server/db.js');

    createPhotoWithId('all-1', 'a1.jpg', 'A1.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');
    createPhotoWithId('all-2', 'a2.jpg', 'A2.jpg', 1, 1, minCorrs, null, null, [], [], '', 'skip');

    const ids: string[] = [];
    // Server logic: if ids is empty → export everything
    const selected = Array.isArray(ids) && ids.length > 0
      ? getAllPhotos().filter(p => ids.includes(p.id))
      : getAllPhotos();

    expect(selected).toHaveLength(2);
  });
});

// ─── parseManifestPhotos (Q1 — manifestVersion) ───────────────────────────────

describe('parseManifestPhotos — manifest format compatibility', () => {
  const PHOTOS = [
    { id: 'a', filename: 'a.jpg', originalName: 'A.jpg', width: 100, height: 100, correspondences: [] },
    { id: 'b', filename: 'b.jpg', originalName: 'B.jpg', width: 200, height: 200, correspondences: [] },
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
    { id: 'ph1', filename: 'ph1.jpg', originalName: 'Orion.jpg', width: 800, height: 600, correspondences: [] },
    { id: 'ph2', filename: 'ph2.jpg', originalName: 'M31.jpg', width: 1024, height: 768, correspondences: [], thumbFilename: 'ph2_thumb.jpg' },
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
      { id: 'a', filename: 'a.jpg', originalName: 'A.jpg', width: 100, height: 100, correspondences: [] },
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
    const dso = JSON.stringify({ 'NGC1952': { name_en: 'Crab Nebula' } });
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

  it('detects custom-gear.json with entries → hasCustomGear true', async () => {
    const gear = JSON.stringify([{ id: 'custom-1', type: 'telescope', name: 'MyScope' }]);
    const result = await inspectZipContents([mockEntry('custom-gear.json', gear)]);
    expect(result.hasCustomGear).toBe(true);
    expect(result.hasDsoOverrides).toBe(false);
  });

  it('does NOT set hasCustomGear for an empty custom-gear array', async () => {
    const result = await inspectZipContents([mockEntry('custom-gear.json', '[]')]);
    expect(result.hasCustomGear).toBe(false);
  });

  it('detects gear-setups.json with entries → hasSetups true', async () => {
    const setups = JSON.stringify([{ id: 's1', telescopeId: 't1', cameraId: 'c1', name: 'Setup A', enabled: true }]);
    const result = await inspectZipContents([mockEntry('gear-setups.json', setups)]);
    expect(result.hasSetups).toBe(true);
  });

  it('does NOT set hasSetups for an empty gear-setups array', async () => {
    const result = await inspectZipContents([mockEntry('gear-setups.json', '[]')]);
    expect(result.hasSetups).toBe(false);
  });

  it('lists image files from images/ directory', async () => {
    const result = await inspectZipContents([
      mockEntry('images/photo.jpg', 'imgdata', 5000),
      mockEntry('images/another.png', 'pngdata', 8000),
    ]);
    expect(result.imageEntries).toHaveLength(2);
    expect(result.imageEntries.map(e => e.filename)).toContain('photo.jpg');
    expect(result.imageEntries.map(e => e.filename)).toContain('another.png');
    expect(result.imageEntries.find(e => e.filename === 'photo.jpg')!.size).toBe(5000);
  });

  it('excludes thumbnails (listed in manifest thumbFilename) from imageEntries', async () => {
    const result = await inspectZipContents([
      mockEntry('manifest.json', MANIFEST_WITH_THUMBS),
      mockEntry('images/ph1.jpg', 'imgdata', 4000),
      mockEntry('images/ph2.jpg', 'imgdata', 6000),
      mockEntry('images/ph2_thumb.jpg', 'thumbdata', 1000),
    ]);
    expect(result.imageEntries).toHaveLength(2);
    expect(result.imageEntries.map(e => e.filename)).toContain('ph1.jpg');
    expect(result.imageEntries.map(e => e.filename)).toContain('ph2.jpg');
    expect(result.imageEntries.map(e => e.filename)).not.toContain('ph2_thumb.jpg');
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
      { id: 'x', filename: 'x.jpg', originalName: 'X.jpg', width: 1, height: 1, correspondences: [] },
    ]);
    const result = await inspectZipContents([mockEntry('manifest.json', manifest)]);
    expect(result.hasMetadata).toBe(true);
    expect(result.imageEntries).toHaveLength(0);
  });

  it('full ZIP with all sections → all flags true, images list correct', async () => {
    const dso = JSON.stringify({ 'M1': { name_en: 'Crab Nebula' } });
    const gear = JSON.stringify([{ id: 'custom-t1', type: 'telescope', name: 'RC8' }]);
    const setups = JSON.stringify([{ id: 's1', telescopeId: 'custom-t1', cameraId: 'c1', name: 'Main', enabled: true }]);
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
    expect(result.imageEntries.map(e => e.filename)).not.toContain('ph2_thumb.jpg');
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
