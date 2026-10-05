import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '@myastrosky/core/db/schema';
import { createPhotoService, type PhotoService } from '@myastrosky/core/services/photos';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';

// The POST /api/photos response is built by the photo service's `get`, and the
// GET /api/photos list by `list`. Both go through the shared `rowToPhoto`
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

/** A photo service on its own in-memory database, with the raw connection for schema checks. */
async function makeService(): Promise<{ photos: PhotoService; conn: Database.Database }> {
  const conn = new Database(':memory:');
  const db = createBetterSqliteDb(conn);
  await initSchema(db);
  return { photos: createPhotoService({ db }), conn };
}

describe('photo serialization — get / list parity', () => {
  let photos: PhotoService;
  let conn: Database.Database;

  beforeEach(async () => {
    ({ photos, conn } = await makeService());
  });

  afterEach(() => conn.close());

  async function seedFullyPopulatedPhoto() {
    await photos.insert({
      id: 'photo-1',
      filename: 'photo-1.jpg',
      originalName: 'M2.jpg',
      width: 1920,
      height: 1080,
      correspondences: CORRS,
      manualPlacement: null,
      dsoIds: ['M2', 'NGC7089'],
      labels: ['globular', 'aquarius'],
      notes: 'Great globular in Aquarius',
      integrations: [{ frames: 30, seconds: 120, filter: 'L' }],
      thumbFilename: 'photo-1_thumb.jpg',
      observationDate: '2026-08-15T21:34:00.000Z',
      pointsOfInterest: [{ name: 'C/2023 A3', categoryId: 'cat-comet' }],
      captureDetails: { gain: 120, offset: 30, ccdTemp: -10, binning: '1x1' },
      gearSetupId: 'setup-newt8',
    });
  }

  it('get returns every metadata field it was created with', async () => {
    await seedFullyPopulatedPhoto();
    const p = await photos.get('photo-1');

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

  it('get exposes a key for every metadata field', async () => {
    await seedFullyPopulatedPhoto();
    const p = (await photos.get('photo-1'))!;
    for (const key of METADATA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(p, key), `missing key: ${key}`).toBe(true);
    }
  });

  it('get and the list entry are byte-for-byte identical', async () => {
    await seedFullyPopulatedPhoto();
    const single = await photos.get('photo-1');
    const fromList = (await photos.list()).find((x) => x.id === 'photo-1');
    // Same key set…
    expect(Object.keys(single!).sort()).toEqual(Object.keys(fromList!).sort());
    // …and same values. This is the guard against the upload response drifting
    // from what a page reload would fetch.
    expect(JSON.stringify(single)).toBe(JSON.stringify(fromList));
  });

  it('a photo saved with no optional metadata still carries every metadata key', async () => {
    await photos.insert({
      id: 'bare',
      filename: 'bare.jpg',
      originalName: 'bare.jpg',
      width: 800,
      height: 600,
      correspondences: CORRS,
    });
    const p = (await photos.get('bare'))!;
    for (const key of METADATA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(p, key), `missing key: ${key}`).toBe(true);
    }
    expect(p.observationDate).toBeNull();
    expect(p.gearSetupId).toBeNull();
    expect(p.dsoIds).toEqual([]);
    expect(p.captureDetails).toEqual({});
  });

  it('get returns undefined for an unknown id', async () => {
    expect(await photos.get('does-not-exist')).toBeUndefined();
  });
});

// ── Schema-drift guard ────────────────────────────────────────────────────────
// If someone adds a column to `photos` (a new metadata field) and wires it into
// `insert` but forgets `rowToPhoto`, the functional tests above might still
// pass (they don't know the new field exists). This test reads the live table
// schema and fails until every non-internal column is represented in the
// serialized photo — forcing the serializer to be updated too.

describe('photo serialization — no column left behind', () => {
  /** Columns that are deliberately NOT part of the serialized photo shape. */
  const INTERNAL_COLUMNS = new Set(['display_order']);

  /** photos-table column (snake_case) → serialized key (camelCase). */
  const columnToKey = (col: string): string =>
    col === 'original_name'
      ? 'originalName'
      : col.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

  it('every photos column (bar internal ones) appears in the serialized photo', async () => {
    const { photos, conn } = await makeService();
    await photos.insert({
      id: 'drift-1',
      filename: 'drift-1.jpg',
      originalName: 'drift.jpg',
      width: 100,
      height: 100,
      correspondences: CORRS,
      manualPlacement: JSON.stringify({ ra: 83.82, dec: -5.39, projPerPx: 0.002, rotDeg: 0 }),
      dsoIds: ['M1'],
      labels: ['x'],
      notes: 'n',
      integrations: [{ frames: 1, seconds: 1, filter: 'L' }],
      thumbFilename: 'drift-1_thumb.jpg',
      observationDate: '2026-01-01T00:00:00.000Z',
      pointsOfInterest: [{ name: 'p', categoryId: 'cat-comet' }],
      captureDetails: { gain: 1 },
      gearSetupId: 'setup-1',
    });
    const serialized = (await photos.get('drift-1'))!;

    const columns = (conn.pragma('table_info(photos)') as { name: string }[]).map((r) => r.name);
    conn.close();

    const missing = columns
      .filter((col) => !INTERNAL_COLUMNS.has(col))
      .map(columnToKey)
      .filter((key) => !Object.prototype.hasOwnProperty.call(serialized, key));

    expect(
      missing,
      `photos columns absent from the serialized photo (add them to rowToPhoto in ` +
        `packages/core/src/services/photos.ts, or to INTERNAL_COLUMNS if intentionally private): ` +
        missing.join(', '),
    ).toEqual([]);
  });
});
