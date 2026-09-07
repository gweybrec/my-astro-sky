import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The POST /api/photos response is built by db.ts's `getPhotoById`, and the
// GET /api/photos list by `getAllPhotos`. Both go through the shared `rowToPhoto`
// serializer. These tests pin that contract so a newly added metadata field can
// never again be persisted but dropped from the upload response (the symptom:
// metadata shows in the add-photo preview, vanishes after save, reappears only
// after a full reload — and never reappears in the Electron build).

const CORRS = [
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
];

/** Every metadata key the serialized photo must always carry (non-correspondence). */
const METADATA_KEYS = [
  'dsoIds',
  'labels',
  'pointsOfInterest',
  'notes',
  'integrations',
  'observationDate',
  'captureDetails',
  'gearSetupId',
  'thumbFilename',
] as const;

describe('db photo serialization — getPhotoById / getAllPhotos parity', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DB_PATH', ':memory:');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function seedFullyPopulatedPhoto() {
    const db = await import('../../server/db.js');
    db.createPhoto(
      'photo-1',
      'photo-1.jpg',
      'M2.jpg',
      1920,
      1080,
      CORRS,
      null, // manualPlacement
      ['M2', 'NGC7089'], // dsoIds
      ['globular', 'aquarius'], // labels
      'Great globular in Aquarius', // notes
      [{ frames: 30, seconds: 120, filter: 'L' }], // integrations
      'photo-1_thumb.jpg', // thumbFilename
      '2026-08-15T21:34:00.000Z', // observationDate
      [{ name: 'C/2023 A3', categoryId: 'cat-comet' }], // pointsOfInterest
      { gain: 120, offset: 30, ccdTemp: -10, binning: '1x1' }, // captureDetails
      'setup-newt8', // gearSetupId
    );
    return db;
  }

  it('getPhotoById returns every metadata field it was created with', async () => {
    const db = await seedFullyPopulatedPhoto();
    const p = db.getPhotoById('photo-1');

    expect(p).toBeDefined();
    expect(p!.observationDate).toBe('2026-08-15T21:34:00.000Z');
    expect(p!.dsoIds).toEqual(['M2', 'NGC7089']);
    expect(p!.labels).toEqual(['globular', 'aquarius']);
    expect(p!.notes).toBe('Great globular in Aquarius');
    expect(p!.integrations).toEqual([{ frames: 30, seconds: 120, filter: 'L' }]);
    expect(p!.pointsOfInterest).toEqual([{ name: 'C/2023 A3', categoryId: 'cat-comet' }]);
    expect(p!.captureDetails).toEqual({ gain: 120, offset: 30, ccdTemp: -10, binning: '1x1' });
    expect(p!.gearSetupId).toBe('setup-newt8');
    expect(p!.thumbFilename).toBe('photo-1_thumb.jpg');
    expect(p!.correspondences).toHaveLength(2);
  });

  it('getPhotoById exposes a key for every metadata field', async () => {
    const db = await seedFullyPopulatedPhoto();
    const p = db.getPhotoById('photo-1')!;
    for (const key of METADATA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(p, key), `missing key: ${key}`).toBe(true);
    }
  });

  it('getPhotoById and the getAllPhotos entry are byte-for-byte identical', async () => {
    const db = await seedFullyPopulatedPhoto();
    const single = db.getPhotoById('photo-1');
    const fromList = db.getAllPhotos().find((x: { id: string }) => x.id === 'photo-1');
    // Same key set…
    expect(Object.keys(single!).sort()).toEqual(Object.keys(fromList!).sort());
    // …and same values. This is the guard against the upload response drifting
    // from what a page reload would fetch.
    expect(JSON.stringify(single)).toBe(JSON.stringify(fromList));
  });

  it('a photo saved with no optional metadata still carries every metadata key', async () => {
    const db = await import('../../server/db.js');
    db.createPhoto('bare', 'bare.jpg', 'bare.jpg', 800, 600, CORRS);
    const p = db.getPhotoById('bare')!;
    for (const key of METADATA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(p, key), `missing key: ${key}`).toBe(true);
    }
    expect(p.observationDate).toBeNull();
    expect(p.gearSetupId).toBeNull();
    expect(p.dsoIds).toEqual([]);
    expect(p.captureDetails).toEqual({});
  });

  it('getPhotoById returns undefined for an unknown id', async () => {
    const db = await import('../../server/db.js');
    expect(db.getPhotoById('does-not-exist')).toBeUndefined();
  });
});

// ── Schema-drift guard ────────────────────────────────────────────────────────
// If someone adds a column to `photos` (a new metadata field) and wires it into
// `createPhoto` but forgets `rowToPhoto`, the functional tests above might still
// pass (they don't know the new field exists). This test reads the live table
// schema and fails until every non-internal column is represented in the
// serialized photo — forcing the serializer to be updated too.

describe('db photo serialization — no column left behind', () => {
  let tmpDir: string;
  let dbApi: typeof import('../../server/db.js');

  /** Columns that are deliberately NOT part of the serialized photo shape. */
  const INTERNAL_COLUMNS = new Set(['display_order']);

  /** photos-table column (snake_case) → serialized key (camelCase). */
  const columnToKey = (col: string): string =>
    col === 'original_name'
      ? 'originalName'
      : col.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-db-test-'));
    vi.resetModules();
    vi.stubEnv('DB_PATH', path.join(tmpDir, 'schema-drift.db'));
    dbApi = await import('../../server/db.js');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    // Best-effort: the db.js module keeps its SQLite handle (WAL) open for the
    // life of the process, so on Windows the file stays locked. The OS reaps its
    // own temp dir; a failed unlink here must not fail the suite.
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* locked by the still-open better-sqlite3 handle — ignore */
    }
  });

  it('every photos column (bar internal ones) appears in the serialized photo', () => {
    dbApi.createPhoto(
      'drift-1',
      'drift-1.jpg',
      'drift.jpg',
      100,
      100,
      CORRS,
      JSON.stringify({ ra: 83.82, dec: -5.39, projPerPx: 0.002, rotDeg: 0 }), // manualPlacement
      ['M1'],
      ['x'],
      'n',
      [{ frames: 1, seconds: 1, filter: 'L' }],
      'drift-1_thumb.jpg',
      '2026-01-01T00:00:00.000Z',
      [{ name: 'p', categoryId: 'cat-comet' }],
      { gain: 1 },
      'setup-1',
    );
    const serialized = dbApi.getPhotoById('drift-1')!;

    const raw = new Database(path.join(tmpDir, 'schema-drift.db'), { readonly: true });
    const columns = (raw.pragma('table_info(photos)') as { name: string }[]).map((r) => r.name);
    raw.close();

    const missing = columns
      .filter((col) => !INTERNAL_COLUMNS.has(col))
      .map(columnToKey)
      .filter((key) => !Object.prototype.hasOwnProperty.call(serialized, key));

    expect(
      missing,
      `photos columns absent from the serialized photo (add them to rowToPhoto in server/db.ts, ` +
        `or to INTERNAL_COLUMNS if intentionally private): ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
