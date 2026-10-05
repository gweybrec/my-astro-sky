// @vitest-environment node
/**
 * The photo service, data part (WP2.3g), on a private in-memory database, on both SQL adapters.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import { DomainError, isDomainError } from '@myastrosky/core/domain/errors';
import type { NewPhotoInput, UploadFields } from '@myastrosky/core/domain/photos';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import {
  ALLOWED_PHOTO_EXTENSIONS,
  MAX_CORRESPONDENCES,
  createPhotoService,
  photoNotFound,
  sanitizeIntegrationRows,
  sanitizePois,
  type PhotoService,
} from '@myastrosky/core/services/photos';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { SQL_ADAPTERS } from '../helpers/sql-adapters';
import { countingSqlDb, type CountingSqlDb } from '../helpers/counting-sql-db';

// ─── The two functions this service replaces, as they were ───────────────────

/** The old `server/routes/shared.ts` function: maps each row and keeps the invalid ones as zeros. */
function oldRouteSanitize(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input.map((entry: any) => ({
    frames:
      Number.isInteger(Number(entry?.frames)) && Number(entry?.frames) >= 1
        ? Number(entry.frames)
        : 0,
    seconds:
      Number.isInteger(Number(entry?.seconds)) && Number(entry?.seconds) >= 1
        ? Number(entry.seconds)
        : 0,
    filter: typeof entry?.filter === 'string' ? entry.filter.trim() : '',
  }));
}

/** The old private `server/db.ts` function: maps, then drops the invalid rows. Ran on every write and read. */
function oldDbSanitize(rows: any) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((entry: any) => ({
      frames: Number.isInteger(Number(entry?.frames)) ? Number(entry.frames) : 0,
      seconds: Number.isInteger(Number(entry?.seconds)) ? Number(entry.seconds) : 0,
      filter: typeof entry?.filter === 'string' ? entry.filter.trim() : '',
    }))
    .filter((entry) => entry.frames >= 1 && entry.seconds >= 1 && entry.filter.length > 0);
}

const INTEGRATION_INPUTS: [string, unknown][] = [
  ['a valid row', [{ frames: 10, seconds: 120, filter: 'L' }]],
  [
    'two valid rows',
    [
      { frames: 3, seconds: 60, filter: 'R' },
      { frames: 4, seconds: 90, filter: 'Ha' },
    ],
  ],
  ['frames 0', [{ frames: 0, seconds: 60, filter: 'L' }]],
  ['seconds 0', [{ frames: 5, seconds: 0, filter: 'L' }]],
  ['negative frames', [{ frames: -3, seconds: 60, filter: 'L' }]],
  ['negative seconds', [{ frames: 3, seconds: -60, filter: 'L' }]],
  ['fractional frames', [{ frames: 3.5, seconds: 60, filter: 'L' }]],
  ['fractional seconds', [{ frames: 3, seconds: 0.5, filter: 'L' }]],
  ['numeric strings', [{ frames: '12', seconds: '300', filter: 'O3' }]],
  ['a non-numeric string', [{ frames: 'abc', seconds: 60, filter: 'L' }]],
  ['a blank frames string', [{ frames: '', seconds: 60, filter: 'L' }]],
  ['null frames', [{ frames: null, seconds: 60, filter: 'L' }]],
  ['an empty filter', [{ frames: 3, seconds: 60, filter: '' }]],
  ['a blank filter', [{ frames: 3, seconds: 60, filter: '   ' }]],
  ['a padded filter', [{ frames: 3, seconds: 60, filter: '  OIII  ' }]],
  ['a numeric filter', [{ frames: 3, seconds: 60, filter: 5 }]],
  ['a missing filter', [{ frames: 3, seconds: 60 }]],
  ['null entries', [null, { frames: 1, seconds: 1, filter: 'L' }]],
  ['non-object entries', ['x', 4, true, { frames: 2, seconds: 2, filter: 'G' }]],
  ['an empty object', [{}]],
  ['an empty array', []],
  ['a string', 'not an array'],
  ['an object', { frames: 3, seconds: 60, filter: 'L' }],
  ['null', null],
  ['undefined', undefined],
  [
    'valid and invalid mixed',
    [
      { frames: 18, seconds: 240, filter: 'OIII' },
      { frames: 0, seconds: 100, filter: 'R' },
      { frames: 4, seconds: 0, filter: 'G' },
      { frames: 3, seconds: 120, filter: ' ' },
    ],
  ],
];

describe('sanitizeIntegrationRows (the one function that replaces two)', () => {
  it('has at least twenty inputs in its table', () => {
    expect(INTEGRATION_INPUTS.length).toBeGreaterThanOrEqual(20);
  });

  it.each(INTEGRATION_INPUTS)(
    'returns what the db function returned, and what route then db returned: %s',
    (_label, input) => {
      const now = sanitizeIntegrationRows(input);
      expect(now).toEqual(oldDbSanitize(input));
      expect(now).toEqual(oldDbSanitize(oldRouteSanitize(input)));
    },
  );
});

describe('sanitizePois', () => {
  it('keeps a trimmed name, a category and a valid position, and drops the rest', () => {
    expect(
      sanitizePois([
        { name: '  SN 2026a  ', categoryId: 'c', ra: 10, dec: 20, extra: 1 },
        { name: 'bad pos', categoryId: 'c', ra: 400, dec: 0 },
        { name: '', categoryId: 'c' },
        { name: 'no cat' },
        null,
      ]),
    ).toEqual([
      { name: 'SN 2026a', categoryId: 'c', ra: 10, dec: 20 },
      { name: 'bad pos', categoryId: 'c' },
    ]);
    expect(sanitizePois('x')).toEqual([]);
  });
});

describe('PHOTO_NOT_FOUND', () => {
  it('is a notFound DomainError with the exact body of the routes', () => {
    const e = photoNotFound();
    expect(e).toBeInstanceOf(DomainError);
    expect([e.kind, e.code, e.message]).toEqual([
      'notFound',
      'PHOTO_NOT_FOUND',
      'Photo introuvable',
    ]);
    expect(e.body).toEqual({ error: 'Photo introuvable', code: 'PHOTO_NOT_FOUND' });
  });
});

// ─── The service ─────────────────────────────────────────────────────────────

const corr = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    pointIndex: i,
    photoX: i * 10,
    photoY: i * 20,
    starHip: 100 + i,
    starName: `S${i}`,
    starRa: i === 0 ? 12.5 : null,
    starDec: i === 0 ? -3.25 : null,
  }));

const newPhoto = (id: string, over: Partial<NewPhotoInput> = {}): NewPhotoInput => ({
  id,
  filename: `${id}.jpg`,
  originalName: `${id}-name.jpg`,
  width: 800,
  height: 600,
  correspondences: corr(2),
  ...over,
});

const validFields = (over: Record<string, unknown> = {}): UploadFields => ({
  correspondences: JSON.stringify([
    { pointIndex: 0, photoX: 5, photoY: 5, starHip: 32349, starName: 'Sirius' },
    { pointIndex: 1, photoX: 20, photoY: 15, starHip: 27989 },
  ]),
  ...over,
});

describe.each(SQL_ADAPTERS)('PhotoService (%s)', (_adapter, wrap) => {
  let conn: Database.Database;
  let db: SqlDb;
  let counting: CountingSqlDb;
  let svc: PhotoService;

  beforeEach(async () => {
    conn = new Database(':memory:');
    db = wrap(createBetterSqliteDb(conn));
    await initSchema(db);
    counting = countingSqlDb(db);
    svc = createPhotoService({ db: counting });
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

  const invalid = (fn: () => unknown): DomainError => {
    try {
      fn();
    } catch (e) {
      expect(isDomainError(e)).toBe(true);
      return e as DomainError;
    }
    throw new Error('expected a DomainError');
  };

  const calls = async (fn: () => Promise<unknown>): Promise<number> => {
    counting.reset();
    await fn();
    return counting.calls();
  };

  const ids = async () => (await svc.list()).map((p) => p.id);

  describe('insert, get, list', () => {
    it('stores the photo with its correspondences and returns it', async () => {
      const photo = await svc.insert(
        newPhoto('p1', {
          manualPlacement: JSON.stringify({ projPerPx: 0.002 }),
          dsoIds: ['M31'],
          labels: ['galaxy'],
          notes: 'note',
          integrations: [{ frames: 3, seconds: 60, filter: 'L' }],
          thumbFilename: 'p1_thumb.jpg',
          observationDate: '2026-10-05T20:00:00Z',
          pointsOfInterest: [{ name: 'SN', categoryId: 'c' }],
          captureDetails: { gain: 120 },
          gearSetupId: 'setup-1',
        }),
      );
      expect(photo).toMatchObject({
        id: 'p1',
        filename: 'p1.jpg',
        originalName: 'p1-name.jpg',
        width: 800,
        height: 600,
        manualPlacement: { projPerPx: 0.002 },
        dsoIds: ['M31'],
        labels: ['galaxy'],
        notes: 'note',
        integrations: [{ frames: 3, seconds: 60, filter: 'L' }],
        thumbFilename: 'p1_thumb.jpg',
        observationDate: '2026-10-05T20:00:00Z',
        pointsOfInterest: [{ name: 'SN', categoryId: 'c' }],
        captureDetails: { gain: 120 },
        gearSetupId: 'setup-1',
      });
      expect(photo.createdAt).toEqual(expect.any(String));
      expect(photo.correspondences).toEqual([
        {
          pointIndex: 0,
          photoX: 0,
          photoY: 0,
          starHip: 100,
          starName: 'S0',
          starRa: 12.5,
          starDec: -3.25,
        },
        { pointIndex: 1, photoX: 10, photoY: 20, starHip: 101, starName: 'S1' },
      ]);
      expect(await svc.get('p1')).toEqual(photo);
    });

    it('applies the defaults, and cleans integrations, points, capture details and the setup id', async () => {
      const bare = await svc.insert(newPhoto('bare'));
      expect(bare).toMatchObject({
        dsoIds: [],
        labels: [],
        notes: '',
        integrations: [],
        pointsOfInterest: [],
        captureDetails: {},
        gearSetupId: null,
        thumbFilename: null,
        observationDate: null,
      });
      expect(bare).not.toHaveProperty('manualPlacement');
      const dirty = await svc.insert(
        newPhoto('dirty', {
          integrations: [
            { frames: 2, seconds: 30, filter: ' R ' },
            { frames: 0, seconds: 30, filter: 'G' },
          ],
          pointsOfInterest: [{ name: '', categoryId: 'c' }],
          captureDetails: { gain: 5, bogus: 1 } as never,
          gearSetupId: `  ${'g'.repeat(80)}  `,
        }),
      );
      expect(dirty.integrations).toEqual([{ frames: 2, seconds: 30, filter: 'R' }]);
      expect(dirty.pointsOfInterest).toEqual([]);
      expect(dirty.captureDetails).toEqual({ gain: 5 });
      expect(dirty.gearSetupId).toBe('g'.repeat(64));
      expect((await svc.insert(newPhoto('blank', { gearSetupId: '   ' }))).gearSetupId).toBeNull();
    });

    it('puts each new photo last in the draw order', async () => {
      await svc.insert(newPhoto('a'));
      await svc.insert(newPhoto('b'));
      await svc.insert(newPhoto('c'));
      expect(await ids()).toEqual(['a', 'b', 'c']);
    });

    it('writes nothing when two correspondences share a pointIndex', async () => {
      const dup = [corr(1)[0], { ...corr(1)[0], photoX: 99 }];
      await expect(svc.insert(newPhoto('dup', { correspondences: dup }))).rejects.toThrow(
        /UNIQUE constraint failed/,
      );
      expect(await svc.list()).toEqual([]);
      expect(await svc.get('dup')).toBeUndefined();
    });

    it('get is undefined for an unknown id; list returns every photo with only its own correspondences', async () => {
      expect(await svc.get('nope')).toBeUndefined();
      await svc.insert(newPhoto('a', { correspondences: corr(3) }));
      await svc.insert(newPhoto('b', { correspondences: corr(2) }));
      const list = await svc.list();
      expect(list.map((p) => [p.id, p.correspondences.length])).toEqual([
        ['a', 3],
        ['b', 2],
      ]);
    });

    it('serialises a stored placement and survives damaged JSON columns', async () => {
      await svc.insert(newPhoto('p'));
      conn
        .prepare(
          "UPDATE photos SET dso_ids = 'x', labels = '{}', points_of_interest = 'x', integrations = 'x', capture_details = 'x' WHERE id = 'p'",
        )
        .run();
      expect(await svc.get('p')).toMatchObject({
        dsoIds: [],
        labels: [],
        pointsOfInterest: [],
        integrations: [],
        captureDetails: {},
      });
    });

    it('makes a fixed number of round trips whatever the number of rows', async () => {
      expect(await calls(() => svc.insert(newPhoto('a', { correspondences: corr(2) })))).toBe(3);
      expect(await calls(() => svc.insert(newPhoto('b', { correspondences: corr(60) })))).toBe(3);
      expect(await calls(() => svc.list())).toBe(2);
      for (let i = 0; i < 10; i++) await svc.insert(newPhoto(`x${i}`));
      expect(await calls(() => svc.list())).toBe(2);
      expect(await calls(() => svc.get('a'))).toBe(2);
      expect(await calls(() => svc.get('nope'))).toBe(1);
    });
  });

  describe('fileNameOf', () => {
    it('answers the file name, or undefined', async () => {
      await svc.insert(newPhoto('a', { filename: 'a-file.png' }));
      expect(await svc.fileNameOf('a')).toBe('a-file.png');
      expect(await svc.fileNameOf('nope')).toBeUndefined();
      expect(await calls(() => svc.fileNameOf('a'))).toBe(1);
    });
  });

  describe('validateUpload', () => {
    it('accepts a valid form and returns the correspondences as they are stored', () => {
      expect(svc.validateUpload('Photo.JPG', validFields())).toEqual([
        {
          pointIndex: 0,
          photoX: 5,
          photoY: 5,
          starHip: 32349,
          starName: 'Sirius',
          starRa: null,
          starDec: null,
        },
        {
          pointIndex: 1,
          photoX: 20,
          photoY: 15,
          starHip: 27989,
          starName: '',
          starRa: null,
          starDec: null,
        },
      ]);
    });

    it('accepts the four extensions in any case and refuses the others', () => {
      expect([...ALLOWED_PHOTO_EXTENSIONS].sort()).toEqual(['.jpeg', '.jpg', '.png', '.webp']);
      for (const name of ['a.jpg', 'a.JPEG', 'dir/a.png', 'C:\\dir\\a.WebP', 'a.b.png']) {
        expect(() => svc.validateUpload(name, validFields())).not.toThrow();
      }
      for (const [name, shown] of [
        ['a.gif', '.gif'],
        ['noext', ''],
        ['.png', ''],
        ['a.', '.'],
        ['dir.png/file', ''],
      ] as const) {
        const e = invalid(() => svc.validateUpload(name, validFields()));
        expect([e.kind, e.code, e.message]).toEqual([
          'invalid',
          'INVALID_EXTENSION',
          `Extension non autorisée : ${shown}`,
        ]);
        expect(e.body).toEqual({ error: e.message, code: 'INVALID_EXTENSION' });
      }
    });

    it('checks the extension before the correspondences', () => {
      expect(invalid(() => svc.validateUpload('a.gif', {})).code).toBe('INVALID_EXTENSION');
    });

    it('refuses a missing or unparsable correspondences field', () => {
      expect(invalid(() => svc.validateUpload('a.png', {})).code).toBe('MISSING_CORRESPONDENCES');
      expect(invalid(() => svc.validateUpload('a.png', { correspondences: '' })).code).toBe(
        'MISSING_CORRESPONDENCES',
      );
      const e = invalid(() => svc.validateUpload('a.png', { correspondences: 'not json' }));
      expect([e.code, e.message]).toEqual(['INVALID_JSON', 'JSON des correspondances invalide']);
    });

    it('wants 2 to 100 correspondences', () => {
      const withCount = (n: number) =>
        validFields({
          correspondences: JSON.stringify(
            Array.from({ length: n }, (_, i) => ({
              pointIndex: i,
              photoX: 1,
              photoY: 1,
              starHip: 1,
            })),
          ),
        });
      for (const bad of ['{}', '"x"', '[]', JSON.stringify([corr(1)[0]])]) {
        const e = invalid(() => svc.validateUpload('a.png', { correspondences: bad }));
        expect([e.code, e.message]).toEqual([
          'MIN_CORRESPONDENCES',
          'Au moins 2 correspondances requises',
        ]);
      }
      expect(() => svc.validateUpload('a.png', withCount(MAX_CORRESPONDENCES))).not.toThrow();
      const e = invalid(() => svc.validateUpload('a.png', withCount(MAX_CORRESPONDENCES + 1)));
      expect([e.code, e.message]).toEqual([
        'MAX_CORRESPONDENCES',
        'Trop de correspondances (max 100)',
      ]);
    });

    it('checks every item, in the order pointIndex, photoX, photoY, starHip', () => {
      const ok = { pointIndex: 0, photoX: 1, photoY: 1, starHip: 5 };
      const check = (item: Record<string, unknown>) =>
        invalid(() =>
          svc.validateUpload('a.png', {
            correspondences: JSON.stringify([ok, { ...ok, ...item }]),
          }),
        );
      expect(check({ pointIndex: -1 })).toMatchObject({
        code: 'INVALID_POINT_INDEX',
        message: 'pointIndex invalide (entier >= 0 attendu)',
      });
      expect(check({ pointIndex: 1.5 }).code).toBe('INVALID_POINT_INDEX');
      expect(check({ pointIndex: '1' }).code).toBe('INVALID_POINT_INDEX');
      expect(check({ photoX: -1 })).toMatchObject({
        code: 'INVALID_PHOTO_X',
        message: 'photoX invalide (nombre positif attendu)',
      });
      expect(check({ photoX: '5' }).code).toBe('INVALID_PHOTO_X');
      expect(check({ photoY: -0.5 })).toMatchObject({
        code: 'INVALID_PHOTO_Y',
        message: 'photoY invalide (nombre positif attendu)',
      });
      expect(check({ photoY: null }).code).toBe('INVALID_PHOTO_Y');
      expect(check({ starHip: 0 })).toMatchObject({
        code: 'INVALID_STAR_HIP',
        message: 'starRa/starDec requis quand starHip=0',
      });
      expect(check({ starHip: 0, starRa: 1 }).code).toBe('INVALID_STAR_HIP');
      expect(check({ starHip: -3 })).toMatchObject({
        code: 'INVALID_STAR_HIP',
        message: 'starHip invalide (entier positif attendu)',
      });
      expect(check({ starHip: 1.5 }).code).toBe('INVALID_STAR_HIP');
      // two faults: the first in the order wins
      expect(check({ pointIndex: -1, photoX: -1 }).code).toBe('INVALID_POINT_INDEX');
      // a direct RA/Dec correspondence is accepted
      expect(() =>
        svc.validateUpload('a.png', {
          correspondences: JSON.stringify([ok, { ...ok, starHip: 0, starRa: 10, starDec: -5 }]),
        }),
      ).not.toThrow();
    });

    it('lets a null item throw a TypeError, as the route always did', () => {
      expect(() => svc.validateUpload('a.png', { correspondences: '[null,null]' })).toThrow(
        TypeError,
      );
    });
  });

  describe('readUploadMetadata', () => {
    it('falls back to empty values and the file name', () => {
      expect(svc.readUploadMetadata('orig.png', {})).toEqual({
        manualPlacement: null,
        dsoIds: [],
        labels: [],
        pointsOfInterest: [],
        integrations: [],
        notes: '',
        observationDate: null,
        captureDetails: {},
        gearSetupId: null,
        displayName: 'orig.png',
      });
    });

    it('parses and cleans each field', () => {
      const meta = svc.readUploadMetadata('orig.png', {
        dsoIds: JSON.stringify(['M31']),
        labels: JSON.stringify(['a']),
        pointsOfInterest: JSON.stringify([{ name: 'SN', categoryId: 'c' }, { name: '' }]),
        integrations: JSON.stringify([{ frames: 3, seconds: 60, filter: 'L' }, { frames: 0 }]),
        captureDetails: JSON.stringify({ gain: '120', bogus: 1 }),
        notes: 'n'.repeat(6000),
        observationDate: '  2026-10-05T20:00:00Z  ',
        gearSetupId: ` ${'g'.repeat(80)} `,
        displayName: '  Nice name  ',
      });
      expect(meta).toMatchObject({
        dsoIds: ['M31'],
        labels: ['a'],
        pointsOfInterest: [{ name: 'SN', categoryId: 'c' }],
        integrations: [{ frames: 3, seconds: 60, filter: 'L' }],
        captureDetails: { gain: 120 },
        observationDate: '2026-10-05T20:00:00Z',
        gearSetupId: 'g'.repeat(64),
        displayName: 'Nice name',
      });
      expect(meta.notes).toHaveLength(5000);
    });

    it('cuts a long observation date and display name, and ignores blank ones', () => {
      expect(
        svc.readUploadMetadata('f.png', { observationDate: 'z'.repeat(80) }).observationDate,
      ).toBe('z'.repeat(50));
      expect(svc.readUploadMetadata('f.png', { displayName: 'x'.repeat(300) }).displayName).toBe(
        'x'.repeat(255),
      );
      const blank = svc.readUploadMetadata('f.png', {
        displayName: '   ',
        observationDate: '  ',
        gearSetupId: '',
      });
      expect([blank.displayName, blank.observationDate, blank.gearSetupId]).toEqual([
        'f.png',
        null,
        null,
      ]);
    });

    it('turns a field that is not the right JSON into its empty value', () => {
      const meta = svc.readUploadMetadata('f.png', {
        dsoIds: 'not json',
        labels: '{"a":1}',
        pointsOfInterest: 'not json',
        integrations: 'not json',
        captureDetails: 'not json',
        manualPlacement: 'not json',
      });
      expect(meta).toMatchObject({
        dsoIds: [],
        labels: [],
        pointsOfInterest: [],
        integrations: [],
        captureDetails: {},
        manualPlacement: null,
      });
    });

    it('keeps a placement with its projPerPx, and stores a missing one as null', () => {
      const keep = svc.readUploadMetadata('f.png', {
        manualPlacement: JSON.stringify({ projPerPx: 0.002, centerX: 1 }),
      });
      expect(JSON.parse(keep.manualPlacement!)).toEqual({ projPerPx: 0.002, centerX: 1 });
      const none = svc.readUploadMetadata('f.png', {
        manualPlacement: JSON.stringify({ centerX: 1 }),
      });
      expect(JSON.parse(none.manualPlacement!)).toEqual({ centerX: 1, projPerPx: null });
      // JSON null throws inside the parse step and is ignored
      expect(
        svc.readUploadMetadata('f.png', { manualPlacement: 'null' }).manualPlacement,
      ).toBeNull();
    });
  });

  describe('updateMetadata', () => {
    it('replaces the metadata and leaves the name alone when none is given', async () => {
      await svc.insert(newPhoto('a', { originalName: 'Orion.jpg' }));
      const r = await svc.updateMetadata('a', {
        dsoIds: ['M42'],
        labels: ['narrow'],
        notes: 'N',
        integrations: [{ frames: 10, seconds: 180, filter: 'Ha' }],
        observationDate: '  2026-01-01T00:00:00Z ',
        pointsOfInterest: [{ name: 'p', categoryId: 'c' }],
        captureDetails: { gain: 3 },
        gearSetupId: ' s1 ',
      });
      expect(r).toEqual({});
      expect(await svc.get('a')).toMatchObject({
        originalName: 'Orion.jpg',
        dsoIds: ['M42'],
        labels: ['narrow'],
        notes: 'N',
        integrations: [{ frames: 10, seconds: 180, filter: 'Ha' }],
        observationDate: '2026-01-01T00:00:00Z',
        pointsOfInterest: [{ name: 'p', categoryId: 'c' }],
        captureDetails: { gain: 3 },
        gearSetupId: 's1',
      });
    });

    it('renames when a name is given, trimmed and cut to 255, and returns it', async () => {
      await svc.insert(newPhoto('a'));
      expect(await svc.updateMetadata('a', { originalName: '  New  ' })).toEqual({
        originalName: 'New',
      });
      expect((await svc.get('a'))!.originalName).toBe('New');
      const long = await svc.updateMetadata('a', { originalName: 'a'.repeat(300) });
      expect(long.originalName).toHaveLength(255);
      for (const blank of ['   ', 5, null, undefined]) {
        expect(await svc.updateMetadata('a', { originalName: blank as never })).toEqual({});
        expect((await svc.get('a'))!.originalName).toHaveLength(255);
      }
    });

    it('cleans what the form sent: non-arrays, long notes, non-strings and dirty rows', async () => {
      await svc.insert(newPhoto('a'));
      await svc.updateMetadata('a', {
        dsoIds: 'x' as never,
        labels: { a: 1 } as never,
        notes: 5 as never,
        integrations: [{ frames: 0, seconds: 1, filter: 'L' }],
        observationDate: 5 as never,
        gearSetupId: 5 as never,
      });
      expect(await svc.get('a')).toMatchObject({
        dsoIds: [],
        labels: [],
        notes: '',
        integrations: [],
        observationDate: null,
        gearSetupId: null,
      });
      await svc.updateMetadata('a', { notes: 'n'.repeat(6000), observationDate: 'z'.repeat(80) });
      const p = (await svc.get('a'))!;
      expect(p.notes).toHaveLength(5000);
      expect(p.observationDate).toHaveLength(50);
      // a missing body behaves like an empty one
      await expect(svc.updateMetadata('a', undefined as never)).resolves.toEqual({});
    });

    it('does not touch the other photos', async () => {
      await svc.insert(newPhoto('a'));
      await svc.insert(newPhoto('b', { originalName: 'B.jpg' }));
      await svc.updateMetadata('a', { dsoIds: ['M1'], originalName: 'A2.jpg' });
      expect(await svc.get('b')).toMatchObject({ originalName: 'B.jpg', dsoIds: [] });
    });

    it('throws PHOTO_NOT_FOUND for an unknown id, with or without a name', async () => {
      for (const changes of [{}, { originalName: 'x.jpg' }]) {
        const e = await rejection(svc.updateMetadata('nope', changes));
        expect([e.kind, e.code, e.body]).toEqual([
          'notFound',
          'PHOTO_NOT_FOUND',
          { error: 'Photo introuvable', code: 'PHOTO_NOT_FOUND' },
        ]);
      }
    });

    it('makes one round trip', async () => {
      await svc.insert(newPhoto('a'));
      expect(await calls(() => svc.updateMetadata('a', { dsoIds: ['M1'] }))).toBe(1);
      expect(await calls(() => svc.updateMetadata('a', { originalName: 'n' }))).toBe(1);
    });
  });

  describe('setManualPlacement', () => {
    it('stores the placement as JSON and clears it with a falsy value', async () => {
      await svc.insert(newPhoto('a'));
      await svc.setManualPlacement('a', { projPerPx: 1 } as never);
      expect((await svc.get('a'))!.manualPlacement).toEqual({ projPerPx: 1 });
      for (const clear of [null, undefined, 0 as never, '' as never]) {
        await svc.setManualPlacement('a', { projPerPx: 1 } as never);
        await svc.setManualPlacement('a', clear);
        expect(await svc.get('a')).not.toHaveProperty('manualPlacement');
      }
      await svc.setManualPlacement('a', 'text' as never);
      expect((await svc.get('a'))!.manualPlacement).toBe('text');
    });

    it('throws PHOTO_NOT_FOUND for an unknown id, and makes one round trip', async () => {
      expect((await rejection(svc.setManualPlacement('nope', null))).code).toBe('PHOTO_NOT_FOUND');
      await svc.insert(newPhoto('a'));
      expect(await calls(() => svc.setManualPlacement('a', null))).toBe(1);
    });
  });

  describe('setOrder', () => {
    beforeEach(async () => {
      for (const id of ['a', 'b', 'c']) await svc.insert(newPhoto(id));
    });

    it('writes the order of the list', async () => {
      await svc.setOrder(['c', 'a', 'b']);
      expect(await ids()).toEqual(['c', 'a', 'b']);
    });

    it('refuses what is not a list of non-empty strings', async () => {
      for (const bad of [undefined, 'a', ['a', 5], ['a', null], [''], {}]) {
        const e = await rejection(svc.setOrder(bad as never));
        expect([e.kind, e.code, e.message]).toEqual([
          'invalid',
          'INVALID_PHOTO_ORDER',
          'photoIds must be a non-empty array of strings',
        ]);
        expect(e.body).toEqual({ error: e.message, code: 'INVALID_PHOTO_ORDER' });
      }
    });

    it('refuses duplicates before it reads the database', async () => {
      counting.reset();
      const e = await rejection(svc.setOrder(['a', 'a']));
      expect(e.message).toBe('photoIds contains duplicates');
      expect(counting.calls()).toBe(0);
    });

    it('refuses a list that misses a photo or holds an unknown one, and changes nothing', async () => {
      for (const bad of [['a'], ['a', 'b'], ['a', 'b', 'zzz'], ['a', 'b', 'c', 'd'], []]) {
        const e = await rejection(svc.setOrder(bad));
        expect(e.message).toBe('photoIds must include all existing photos exactly once');
      }
      expect(await ids()).toEqual(['a', 'b', 'c']);
    });

    it('accepts an empty list when there are no photos', async () => {
      await svc.removeAllRows();
      await expect(svc.setOrder([])).resolves.toBeUndefined();
    });

    it('makes four round trips whatever the number of photos', async () => {
      expect(await calls(() => svc.setOrder(['c', 'b', 'a']))).toBe(4);
      for (let i = 0; i < 20; i++) await svc.insert(newPhoto(`x${i}`));
      const all = await ids();
      expect(await calls(() => svc.setOrder([...all].reverse()))).toBe(4);
    });
  });

  describe('removing rows', () => {
    it('removeRow says whether there was a row, and the correspondences go with it', async () => {
      await svc.insert(newPhoto('a', { correspondences: corr(3) }));
      expect(await svc.removeRow('a')).toBe(true);
      expect(await svc.removeRow('a')).toBe(false);
      expect(conn.prepare('SELECT COUNT(*) AS n FROM star_correspondences').get()).toEqual({
        n: 0,
      });
      expect(await calls(() => svc.removeRow('a'))).toBe(1);
    });

    it('removeRows deletes the existing ones, ignores the rest and counts', async () => {
      for (const id of ['a', 'b', 'c']) await svc.insert(newPhoto(id));
      expect(await svc.removeRows(['a', 'zzz', 5 as never, 'a', null as never, 'c'])).toBe(2);
      expect(await ids()).toEqual(['b']);
      expect(await svc.removeRows([])).toBe(0);
      expect(await svc.removeRows(['nope'])).toBe(0);
    });

    it('removeRows makes four round trips whatever the number of ids', async () => {
      for (let i = 0; i < 30; i++) await svc.insert(newPhoto(`x${i}`));
      const some = Array.from({ length: 5 }, (_, i) => `x${i}`);
      const many = Array.from({ length: 25 }, (_, i) => `x${i + 5}`);
      expect(await calls(() => svc.removeRows(some))).toBe(4);
      expect(await calls(() => svc.removeRows(many))).toBe(4);
    });

    it('removeAllRows deletes everything and returns the count', async () => {
      expect(await svc.removeAllRows()).toBe(0);
      for (const id of ['a', 'b']) await svc.insert(newPhoto(id));
      expect(await svc.removeAllRows()).toBe(2);
      expect(await svc.list()).toEqual([]);
      expect(conn.prepare('SELECT COUNT(*) AS n FROM star_correspondences').get()).toEqual({
        n: 0,
      });
      expect(await calls(() => svc.removeAllRows())).toBe(1);
    });
  });

  describe('findByOriginalNames', () => {
    it('answers the id of each name that is stored, in the order of the names', async () => {
      await svc.insert(newPhoto('a', { originalName: 'M42.jpg' }));
      await svc.insert(newPhoto('b', { originalName: 'M31.jpg' }));
      expect(await svc.findByOriginalNames(['M42.jpg', 'ghost.jpg', 'M31.jpg'])).toEqual([
        { originalName: 'M42.jpg', id: 'a' },
        { originalName: 'M31.jpg', id: 'b' },
      ]);
      expect(await svc.findByOriginalNames(['ghost.jpg'])).toEqual([]);
      expect(await svc.findByOriginalNames([])).toEqual([]);
    });

    it('matches only the display name and answers the first photo when two share a name', async () => {
      await svc.insert(newPhoto('first', { originalName: 'same.jpg', filename: 'f1.jpg' }));
      await svc.insert(newPhoto('second', { originalName: 'same.jpg', filename: 'f2.jpg' }));
      expect(await svc.findByOriginalNames(['first', 'f1.jpg'])).toEqual([]);
      expect(await svc.findByOriginalNames(['same.jpg'])).toEqual([
        { originalName: 'same.jpg', id: 'first' },
      ]);
    });

    it('makes one round trip whatever the number of names', async () => {
      for (let i = 0; i < 10; i++) await svc.insert(newPhoto(`x${i}`, { originalName: `n${i}` }));
      expect(await calls(() => svc.findByOriginalNames(['n1']))).toBe(1);
      const names = Array.from({ length: 10 }, (_, i) => `n${i}`);
      expect(await calls(() => svc.findByOriginalNames(names))).toBe(1);
    });
  });

  describe('importPhoto', () => {
    const backup = (over: Record<string, unknown> = {}) => ({
      id: 'imp',
      filename: 'imp.jpg',
      originalName: 'Imp.jpg',
      width: 10,
      height: 20,
      createdAt: '2026-05-01T12:00:00.000Z',
      correspondences: corr(2),
      ...over,
    });

    it('imports every field with the id and creation date of the backup', async () => {
      const r = await svc.importPhoto(
        backup({
          manualPlacement: { projPerPx: 0.5 },
          dsoIds: ['M1'],
          labels: ['x'],
          notes: 'n',
          integrations: [
            { frames: 2, seconds: 3, filter: 'L' },
            { frames: 0, seconds: 3, filter: 'L' },
          ],
          thumbFilename: 'imp_thumb.jpg',
          observationDate: '2026-01-01',
          pointsOfInterest: [{ name: 'p', categoryId: 'c' }, null],
          captureDetails: { gain: 1, bogus: 2 },
          gearSetupId: ` ${'s'.repeat(70)} `,
        }),
        'skip',
      );
      expect(r).toBe('imported');
      expect(await svc.get('imp')).toMatchObject({
        id: 'imp',
        filename: 'imp.jpg',
        originalName: 'Imp.jpg',
        width: 10,
        height: 20,
        createdAt: '2026-05-01T12:00:00.000Z',
        manualPlacement: { projPerPx: 0.5 },
        dsoIds: ['M1'],
        labels: ['x'],
        notes: 'n',
        integrations: [{ frames: 2, seconds: 3, filter: 'L' }],
        thumbFilename: 'imp_thumb.jpg',
        observationDate: '2026-01-01',
        pointsOfInterest: [{ name: 'p', categoryId: 'c' }],
        captureDetails: { gain: 1 },
        gearSetupId: 's'.repeat(64),
      });
      expect((await svc.get('imp'))!.correspondences).toHaveLength(2);
    });

    it('fills what the backup lacks: file name, display name, size, date, empty lists', async () => {
      await svc.importPhoto({ id: 'min' }, 'skip');
      expect(await svc.get('min')).toMatchObject({
        filename: 'min.jpg',
        originalName: 'min',
        width: 0,
        height: 0,
        dsoIds: [],
        notes: '',
        thumbFilename: null,
        observationDate: null,
        gearSetupId: null,
        correspondences: [],
      });
      expect((await svc.get('min'))!.createdAt).toEqual(expect.any(String));
      await svc.importPhoto({ id: 'named', filename: 'f.png' }, 'skip');
      expect((await svc.get('named'))!.originalName).toBe('f.png');
    });

    it('skip leaves an existing photo unchanged and says so', async () => {
      await svc.importPhoto(backup({ notes: 'old' }), 'skip');
      expect(
        await svc.importPhoto(backup({ notes: 'new', correspondences: corr(3) }), 'skip'),
      ).toBe('skipped');
      const p = (await svc.get('imp'))!;
      expect(p.notes).toBe('old');
      expect(p.correspondences).toHaveLength(2);
    });

    it('replace deletes the existing photo first, correspondences included', async () => {
      await svc.importPhoto(backup({ notes: 'old' }), 'skip');
      expect(
        await svc.importPhoto(backup({ notes: 'new', correspondences: corr(3) }), 'replace'),
      ).toBe('imported');
      const p = (await svc.get('imp'))!;
      expect(p.notes).toBe('new');
      expect(p.correspondences).toHaveLength(3);
      expect(await ids()).toEqual(['imp']);
    });

    it('is all or nothing: repeated pointIndex rolls the photo back', async () => {
      await expect(
        svc.importPhoto(backup({ correspondences: [corr(1)[0], corr(1)[0]] }), 'skip'),
      ).rejects.toThrow(/UNIQUE constraint failed/);
      expect(await svc.list()).toEqual([]);
      // a failed replace keeps the photo it was about to replace
      await svc.importPhoto(backup({ notes: 'keep' }), 'skip');
      await expect(
        svc.importPhoto(backup({ correspondences: [corr(1)[0], corr(1)[0]] }), 'replace'),
      ).rejects.toThrow();
      expect((await svc.get('imp'))!.notes).toBe('keep');
    });

    it('appends to the draw order', async () => {
      await svc.insert(newPhoto('a'));
      await svc.importPhoto(backup(), 'skip');
      expect(await ids()).toEqual(['a', 'imp']);
    });

    it('makes a fixed number of round trips whatever the number of correspondences', async () => {
      expect(
        await calls(() => svc.importPhoto(backup({ id: 'x1', correspondences: corr(2) }), 'skip')),
      ).toBe(4);
      expect(
        await calls(() => svc.importPhoto(backup({ id: 'x2', correspondences: corr(80) }), 'skip')),
      ).toBe(4);
      expect(
        await calls(() =>
          svc.importPhoto(backup({ id: 'x3', correspondences: corr(80) }), 'replace'),
        ),
      ).toBe(5);
      // skipped: begin, the ignored insert, commit
      expect(await calls(() => svc.importPhoto(backup({ id: 'x3' }), 'skip'))).toBe(3);
    });
  });
});
