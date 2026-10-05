// @vitest-environment node
/**
 * The plan service (WP2.3f) on a private in-memory database, on both SQL adapters.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import { DomainError, isDomainError } from '@myastrosky/core/domain/errors';
import { PLAN_SORT_KEYS, type MosaicParams, type PlanSortKey } from '@myastrosky/core/domain/plans';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import {
  createPlanService,
  sanitizeObservationWindows,
  type PlanService,
} from '@myastrosky/core/services/plans';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { SQL_ADAPTERS } from '../helpers/sql-adapters';
import { countingSqlDb, type CountingSqlDb } from '../helpers/counting-sql-db';

const mosaic = (over: Record<string, unknown> = {}): MosaicParams =>
  ({
    dsoId: 'M31',
    name: 'Mosaic',
    centerRa: 10,
    centerDec: 41,
    paDeg: 15,
    overlapPct: 20,
    cols: 2,
    rows: 1,
    tiles: [
      { ra: 10.1, dec: 41, paDeg: 15 },
      { ra: 10.2, dec: 41, paDeg: null },
    ],
    ...over,
  }) as MosaicParams;

describe('PLAN_SORT_KEYS', () => {
  it('is the single list the PlanSortKey type is derived from', () => {
    expectTypeOf<PlanSortKey>().toEqualTypeOf<(typeof PLAN_SORT_KEYS)[number]>();
    expect(PLAN_SORT_KEYS).toEqual([
      'transit',
      'altitude',
      'rating',
      'magnitude',
      'size',
      'name',
      'difficulty',
      'window',
    ]);
  });
});

describe('sanitizeObservationWindows', () => {
  const one = (w: Record<string, unknown>) => JSON.parse(sanitizeObservationWindows([w]))[0];

  it('returns [] for a value that is not an array', () => {
    for (const v of [undefined, null, 'x', 3, {}]) expect(sanitizeObservationWindows(v)).toBe('[]');
  });

  it('skips items that are not objects or whose bounds are not finite numbers', () => {
    const raw = [
      null,
      'x',
      4,
      { startFrac: 'a', endFrac: 0.5 },
      { startFrac: 0.1 },
      { startFrac: 0.1, endFrac: 0.5 },
    ];
    expect(JSON.parse(sanitizeObservationWindows(raw))).toHaveLength(1);
  });

  it('clamps the bounds to [0,1], swaps them when reversed, and widens a window under 0.02', () => {
    expect(one({ startFrac: -1, endFrac: 2 })).toMatchObject({ startFrac: 0, endFrac: 1 });
    expect(one({ startFrac: 0.8, endFrac: 0.2 })).toMatchObject({ startFrac: 0.2, endFrac: 0.8 });
    const narrow = one({ startFrac: 0.5, endFrac: 0.51 });
    expect(narrow.startFrac).toBe(0.5);
    expect(narrow.endFrac).toBeCloseTo(0.52, 10);
    expect(one({ startFrac: 1, endFrac: 1 })).toMatchObject({ startFrac: 0.98, endFrac: 1 });
  });

  it('trims the filter (40 characters) and the colour (64), and nulls blanks and non-strings', () => {
    const w = { startFrac: 0, endFrac: 1 };
    expect(one({ ...w, filter: '  Ha  ' }).filter).toBe('Ha');
    expect(one({ ...w, filter: 'x'.repeat(50) }).filter).toHaveLength(40);
    expect(one({ ...w, filter: '  ' }).filter).toBeNull();
    expect(one({ ...w, filter: 3 }).filter).toBeNull();
    expect(one({ ...w, color: ' red ' }).color).toBe('red');
    expect(one({ ...w, color: 'c'.repeat(80) }).color).toHaveLength(64);
    expect(one({ ...w, color: '' }).color).toBeNull();
  });

  it('keeps frameSeconds only when it is a positive number', () => {
    const w = { startFrac: 0, endFrac: 1 };
    expect(one({ ...w, frameSeconds: 30 }).frameSeconds).toBe(30);
    expect(one({ ...w, frameSeconds: '45' }).frameSeconds).toBe(45);
    expect(one({ ...w, frameSeconds: 0 }).frameSeconds).toBeNull();
    expect(one({ ...w, frameSeconds: -5 }).frameSeconds).toBeNull();
    expect(one({ ...w, frameSeconds: 'abc' }).frameSeconds).toBeNull();
  });

  it('keeps snap only when it is a boolean (default false)', () => {
    const w = { startFrac: 0, endFrac: 1 };
    expect(one({ ...w, snap: true }).snap).toBe(true);
    expect(one({ ...w, snap: 'yes' }).snap).toBe(false);
    expect(one(w).snap).toBe(false);
  });

  it('trims the id (64 characters) and makes one up when it is missing or blank', () => {
    const w = { startFrac: 0, endFrac: 1 };
    expect(one({ ...w, id: ' abc ' }).id).toBe('abc');
    expect(one({ ...w, id: 'i'.repeat(80) }).id).toHaveLength(64);
    expect(one({ ...w, id: '  ' }).id).toMatch(/^ow-/);
    expect(one(w).id).toMatch(/^ow-/);
  });
});

describe.each(SQL_ADAPTERS)('PlanService (%s)', (_adapter, wrap) => {
  let conn: Database.Database;
  let db: SqlDb;
  let svc: PlanService;
  let counter: number;

  beforeEach(async () => {
    conn = new Database(':memory:');
    db = wrap(createBetterSqliteDb(conn));
    await initSchema(db);
    counter = 0;
    svc = createPlanService({ db, newId: () => `id${++counter}` });
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
  const expectRejected = async (
    p: Promise<unknown>,
    kind: DomainError['kind'],
    message: string,
    code: string,
  ) => {
    const e = await rejection(p);
    expect([e.kind, e.message, e.code]).toEqual([kind, message, code]);
    return e;
  };
  const plan = async (id: string) => (await svc.list()).find((p) => p.id === id)!;
  const rows = (table: string) => conn.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();

  describe('create and list', () => {
    it('creates a plan with a plan- id, a trimmed name and defaults, at the end', async () => {
      expect(await svc.create({ name: '  Night A  ' })).toEqual({ id: 'plan-id1' });
      await svc.create({ name: 'B' });
      const list = await svc.list();
      expect(list.map((p) => [p.id, p.name, p.position])).toEqual([
        ['plan-id1', 'Night A', 0],
        ['plan-id2', 'B', 1],
      ]);
      expect(list[0]).toEqual({
        id: 'plan-id1',
        name: 'Night A',
        position: 0,
        nightOf: null,
        setupId: null,
        lat: null,
        lon: null,
        sortBy: 'transit',
        entries: [],
        mosaics: [],
      });
    });

    it.each([[undefined], [null], [''], ['   '], [5], [['x']]])(
      'rejects the name %j',
      async (name) => {
        await expectRejected(
          svc.create({ name } as never),
          'invalid',
          'name is required',
          'PLAN_NAME_REQUIRED',
        );
        expect(await svc.list()).toEqual([]);
      },
    );

    it('lists the entries and the mosaics of each plan only, in position order', async () => {
      const a = (await svc.create({ name: 'A' })).id;
      const b = (await svc.create({ name: 'B' })).id;
      const e1 = (await svc.addEntry(a, { dsoId: 'M1' })).id;
      const e2 = (await svc.addEntry(a, { ra: 1, dec: 2, paDeg: 30 })).id;
      await svc.addEntry(b, { dsoId: 'M2' });
      const { id: mo } = await svc.createMosaic(b, mosaic({ dsoId: null }));
      const pa = await plan(a);
      expect(pa.entries.map((e) => e.id)).toEqual([e1, e2]);
      expect(pa.entries[1]).toEqual({
        id: e2,
        dsoId: null,
        position: 1,
        paDeg: 30,
        ra: 1,
        dec: 2,
        notes: null,
        mosaicId: null,
        mosaicWDeg: null,
        mosaicHDeg: null,
        observationWindows: [],
      });
      expect(pa.mosaics).toEqual([]);
      const pb = await plan(b);
      expect(pb.mosaics.map((m) => m.id)).toEqual([mo]);
      expect(pb.entries.filter((e) => e.mosaicId === mo)).toHaveLength(2);
    });

    it('reads a stored observation_windows that is not JSON as an empty list', async () => {
      const a = (await svc.create({ name: 'A' })).id;
      const e = (await svc.addEntry(a, { dsoId: 'M1' })).id;
      conn.prepare('UPDATE plan_entries SET observation_windows = ? WHERE id = ?').run('{oops', e);
      expect((await plan(a)).entries[0].observationWindows).toEqual([]);
    });

    it('lists the names and ids in position order', async () => {
      await svc.create({ name: 'A' });
      await svc.create({ name: 'B' });
      expect(await svc.listNames()).toEqual([
        { id: 'plan-id1', name: 'A' },
        { id: 'plan-id2', name: 'B' },
      ]);
    });
  });

  describe('reorder', () => {
    it('gives each listed plan the position of its index and ignores unknown ids', async () => {
      const a = (await svc.create({ name: 'A' })).id;
      const b = (await svc.create({ name: 'B' })).id;
      const c = (await svc.create({ name: 'C' })).id;
      await svc.reorder([c, 'nope', a]);
      expect((await svc.list()).map((p) => [p.id, p.position])).toEqual([
        [c, 0],
        [b, 1],
        [a, 2],
      ]);
    });

    it('accepts an empty list and rejects a value that is not an array', async () => {
      await svc.reorder([]);
      for (const ids of [undefined, null, 'a', { 0: 'a' }]) {
        await expectRejected(
          svc.reorder(ids as never),
          'invalid',
          'ids must be an array',
          'PLAN_IDS_NOT_ARRAY',
        );
      }
    });
  });

  describe('update', () => {
    it('renames with a trimmed name', async () => {
      const id = (await svc.create({ name: 'A' })).id;
      await svc.update(id, { name: '  New ' });
      expect((await plan(id)).name).toBe('New');
    });

    it('stores the settings, clears with empty values and keeps the absent keys', async () => {
      const id = (await svc.create({ name: 'A' })).id;
      await svc.update(id, { nightOf: '2026-10-05', setupId: 's', lat: 10, lon: 20 });
      expect(await plan(id)).toMatchObject({
        nightOf: '2026-10-05',
        setupId: 's',
        lat: 10,
        lon: 20,
      });
      await svc.update(id, { nightOf: '' });
      expect(await plan(id)).toMatchObject({ nightOf: null, setupId: 's', lat: 10, lon: 20 });
      await svc.update(id, { setupId: 0 as never, lat: null });
      expect(await plan(id)).toMatchObject({ setupId: null, lat: null, lon: 20 });
      await svc.update(id, { lon: '9' as never });
      expect((await plan(id)).lon).toBeNull();
    });

    it.each(PLAN_SORT_KEYS)('accepts the sort key %s', async (key) => {
      const id = (await svc.create({ name: 'A' })).id;
      await svc.update(id, { sortBy: key });
      expect((await plan(id)).sortBy).toBe(key);
    });

    it('rejects a body with none of the three groups, before looking the plan up', async () => {
      const message = 'name, settings (nightOf/setupId/lat/lon), or sortBy required';
      for (const body of [{}, { foo: 1 }]) {
        await expectRejected(svc.update('nope', body), 'invalid', message, 'PLAN_UPDATE_EMPTY');
      }
    });

    it('rejects an unknown plan', async () => {
      await expectRejected(
        svc.update('nope', { name: 'x' }),
        'notFound',
        'Plan not found',
        'PLAN_NOT_FOUND',
      );
    });

    it.each([[''], ['  '], [null], [3]])('rejects the name %j', async (name) => {
      const id = (await svc.create({ name: 'A' })).id;
      await expectRejected(
        svc.update(id, { name } as never),
        'invalid',
        'name is required',
        'PLAN_NAME_REQUIRED',
      );
    });

    it('rejects a latitude or a longitude out of range and accepts the bounds', async () => {
      const id = (await svc.create({ name: 'A' })).id;
      await svc.update(id, { lat: -90, lon: 180 });
      await svc.update(id, { lat: 90, lon: -180 });
      for (const lat of [91, -91, Infinity]) {
        await expectRejected(
          svc.update(id, { lat }),
          'invalid',
          'lat must be between -90 and 90',
          'PLAN_LAT_OUT_OF_RANGE',
        );
      }
      for (const lon of [181, -181]) {
        await expectRejected(
          svc.update(id, { lon }),
          'invalid',
          'lon must be between -180 and 180',
          'PLAN_LON_OUT_OF_RANGE',
        );
      }
    });

    it('rejects a sort key that is not in the list, with the list in the message', async () => {
      const id = (await svc.create({ name: 'A' })).id;
      for (const sortBy of ['nope', 3, null]) {
        await expectRejected(
          svc.update(id, { sortBy } as never),
          'invalid',
          'sortBy must be one of: transit, altitude, rating, magnitude, size, name, difficulty, window',
          'PLAN_SORT_INVALID',
        );
      }
    });

    it('writes nothing when a later part of the body is rejected (all or nothing)', async () => {
      const id = (await svc.create({ name: 'Before' })).id;
      await expectRejected(
        svc.update(id, { name: 'After', lat: 95 }),
        'invalid',
        'lat must be between -90 and 90',
        'PLAN_LAT_OUT_OF_RANGE',
      );
      expect((await plan(id)).name).toBe('Before');
      const e = await rejection(
        svc.update(id, { name: 'After', lat: 12, sortBy: 'nope' as never }),
      );
      expect(e.code).toBe('PLAN_SORT_INVALID');
      expect(await plan(id)).toMatchObject({ name: 'Before', lat: null });
    });

    it('applies the name, the settings and the sort key of one body together', async () => {
      const id = (await svc.create({ name: 'A' })).id;
      await svc.update(id, { name: 'B', lat: 1, sortBy: 'name' });
      expect(await plan(id)).toMatchObject({ name: 'B', lat: 1, sortBy: 'name' });
    });
  });

  describe('remove', () => {
    it('deletes the plan with its entries and mosaics, and nothing of the others', async () => {
      const a = (await svc.create({ name: 'A' })).id;
      const b = (await svc.create({ name: 'B' })).id;
      await svc.addEntry(a, { dsoId: 'M1' });
      await svc.createMosaic(a, mosaic());
      await svc.addEntry(b, { dsoId: 'M2' });
      await svc.remove(a);
      expect((await svc.list()).map((p) => p.id)).toEqual([b]);
      expect(rows('plan_entries')).toHaveLength(1);
      expect(rows('plan_mosaics')).toHaveLength(0);
    });

    it('rejects an unknown plan', async () => {
      await expectRejected(svc.remove('nope'), 'notFound', 'Plan not found', 'PLAN_NOT_FOUND');
    });
  });

  describe('entries', () => {
    let planId: string;
    beforeEach(async () => {
      planId = (await svc.create({ name: 'A' })).id;
    });

    it('adds a catalogue target and a custom location with pe- ids at the end of the plan', async () => {
      expect(await svc.addEntry(planId, { dsoId: 'M1', paDeg: 12 })).toEqual({ id: 'pe-id2' });
      await svc.addEntry(planId, { ra: 5, dec: -6 });
      expect((await plan(planId)).entries).toMatchObject([
        { id: 'pe-id2', dsoId: 'M1', position: 0, paDeg: 12, ra: null, dec: null },
        { id: 'pe-id3', dsoId: null, position: 1, paDeg: null, ra: 5, dec: -6 },
      ]);
    });

    it('rejects an unknown plan before it checks the body', async () => {
      await expectRejected(
        svc.addEntry('nope', {}),
        'notFound',
        'Plan not found',
        'PLAN_NOT_FOUND',
      );
    });

    it('rejects a body with neither dsoId nor numeric ra/dec', async () => {
      for (const body of [{}, { ra: 10 }, { ra: '10', dec: 20 }, { dsoId: null, dec: 1 }]) {
        await expectRejected(
          svc.addEntry(planId, body as never),
          'invalid',
          'dsoId or ra/dec is required',
          'ENTRY_TARGET_REQUIRED',
        );
      }
    });

    it('rejects a dsoId that is not a string', async () => {
      await expectRejected(
        svc.addEntry(planId, { dsoId: 5 } as never),
        'invalid',
        'dsoId must be a string',
        'ENTRY_DSO_NOT_STRING',
      );
    });

    it('rejects a second entry for the same DSO with the code in the body, and allows it in another plan', async () => {
      await svc.addEntry(planId, { dsoId: 'M1' });
      const e = await expectRejected(
        svc.addEntry(planId, { dsoId: 'M1' }),
        'conflict',
        'Target already in plan',
        'DUPLICATE_ENTRY',
      );
      expect(e.body).toEqual({ error: 'Target already in plan', code: 'DUPLICATE_ENTRY' });
      const other = (await svc.create({ name: 'B' })).id;
      await svc.addEntry(other, { dsoId: 'M1' });
    });

    it('reorders entries by index within the plan only and ignores unknown ids', async () => {
      const a = (await svc.addEntry(planId, { dsoId: 'A' })).id;
      const b = (await svc.addEntry(planId, { dsoId: 'B' })).id;
      const other = (await svc.create({ name: 'O' })).id;
      const o = (await svc.addEntry(other, { dsoId: 'O' })).id;
      await svc.reorderEntries(planId, [b, 'nope', o, a]);
      expect((await plan(planId)).entries.map((e) => [e.id, e.position])).toEqual([
        [b, 0],
        [a, 3],
      ]);
      expect((await plan(other)).entries[0].position).toBe(0);
      await svc.reorderEntries(planId, []);
    });

    it('rejects an ids value that is not an array', async () => {
      await expectRejected(
        svc.reorderEntries(planId, undefined as never),
        'invalid',
        'ids must be an array',
        'PLAN_IDS_NOT_ARRAY',
      );
    });

    it('removes an entry, and rejects an unknown one', async () => {
      const e = (await svc.addEntry(planId, { dsoId: 'A' })).id;
      await svc.removeEntry(e);
      expect((await plan(planId)).entries).toEqual([]);
      await expectRejected(svc.removeEntry(e), 'notFound', 'Entry not found', 'ENTRY_NOT_FOUND');
    });

    it('updates only the fields present, nulls allowed', async () => {
      const e = (await svc.addEntry(planId, { dsoId: 'A', paDeg: 10 })).id;
      await svc.updateEntry(e, { ra: 1, dec: 2, mosaicWDeg: 3, mosaicHDeg: 4 });
      expect((await plan(planId)).entries[0]).toMatchObject({
        dsoId: 'A',
        paDeg: 10,
        ra: 1,
        dec: 2,
        mosaicWDeg: 3,
        mosaicHDeg: 4,
      });
      await svc.updateEntry(e, { paDeg: null, ra: null, dsoId: null, mosaicWDeg: null });
      expect((await plan(planId)).entries[0]).toMatchObject({
        dsoId: null,
        paDeg: null,
        ra: null,
        dec: 2,
        mosaicWDeg: null,
        mosaicHDeg: 4,
      });
    });

    it('sanitises the observation windows it stores', async () => {
      const e = (await svc.addEntry(planId, { dsoId: 'A' })).id;
      await svc.updateEntry(e, {
        observationWindows: [{ id: 'w', startFrac: 0.9, endFrac: 0.1, filter: ' Ha ' }] as never,
      });
      expect((await plan(planId)).entries[0].observationWindows).toEqual([
        {
          id: 'w',
          startFrac: 0.1,
          endFrac: 0.9,
          filter: 'Ha',
          color: null,
          frameSeconds: null,
          snap: false,
        },
      ]);
    });

    it.each([
      ['paDeg', 'x'],
      ['ra', 'x'],
      ['dec', undefined],
      ['mosaicWDeg', '3'],
      ['mosaicHDeg', true],
    ])('rejects %s = %j', async (key, value) => {
      const e = (await svc.addEntry(planId, { dsoId: 'A' })).id;
      await expectRejected(
        svc.updateEntry(e, { [key]: value } as never),
        'invalid',
        `${key} must be a number or null`,
        'ENTRY_FIELD_INVALID',
      );
    });

    it('rejects a dsoId that is neither a string nor null, and windows that are not an array', async () => {
      const e = (await svc.addEntry(planId, { dsoId: 'A' })).id;
      await expectRejected(
        svc.updateEntry(e, { dsoId: 3 } as never),
        'invalid',
        'dsoId must be a string or null',
        'ENTRY_FIELD_INVALID',
      );
      await expectRejected(
        svc.updateEntry(e, { observationWindows: 'x' } as never),
        'invalid',
        'observationWindows must be an array',
        'ENTRY_FIELD_INVALID',
      );
    });

    it('rejects a body with no updatable field, and an unknown entry', async () => {
      const e = (await svc.addEntry(planId, { dsoId: 'A' })).id;
      await expectRejected(
        svc.updateEntry(e, { notes: 'x' } as never),
        'invalid',
        'No updatable fields provided',
        'ENTRY_NO_FIELDS',
      );
      await expectRejected(
        svc.updateEntry('nope', { ra: 1 }),
        'notFound',
        'Entry not found',
        'ENTRY_NOT_FOUND',
      );
    });
  });

  describe('mosaics', () => {
    let planId: string;
    beforeEach(async () => {
      planId = (await svc.create({ name: 'A' })).id;
    });
    const tileIds = async () =>
      (await plan(planId)).entries.filter((e) => e.mosaicId).map((e) => e.id);

    it('creates a mosaic with an mo- id and its tiles as tile-<mosaicId>-<position> entries', async () => {
      await svc.addEntry(planId, { dsoId: 'X' });
      expect(await svc.createMosaic(planId, mosaic())).toEqual({ id: 'mo-id3' });
      const p = await plan(planId);
      expect(p.mosaics).toEqual([
        {
          id: 'mo-id3',
          dsoId: 'M31',
          name: 'Mosaic',
          centerRa: 10,
          centerDec: 41,
          paDeg: 15,
          overlapPct: 20,
          cols: 2,
          rows: 1,
          position: 0,
        },
      ]);
      expect(p.entries.filter((e) => e.mosaicId)).toMatchObject([
        { id: 'tile-mo-id3-1', dsoId: 'M31', position: 1, paDeg: 15, ra: 10.1, dec: 41 },
        { id: 'tile-mo-id3-2', dsoId: 'M31', position: 2, paDeg: null, ra: 10.2, dec: 41 },
      ]);
    });

    it('puts a second mosaic at the next mosaic position', async () => {
      await svc.createMosaic(planId, mosaic({ dsoId: null }));
      await svc.createMosaic(planId, mosaic({ dsoId: null }));
      expect((await plan(planId)).mosaics.map((m) => m.position)).toEqual([0, 1]);
    });

    it('coerces and clamps the parameters', async () => {
      await svc.createMosaic(
        planId,
        mosaic({
          dsoId: 5,
          name: 7,
          paDeg: 'x',
          overlapPct: 150,
          cols: 2.5,
          rows: 0,
          replaceEntryIds: 'x',
        }),
      );
      expect((await plan(planId)).mosaics[0]).toMatchObject({
        dsoId: null,
        name: null,
        paDeg: 0,
        overlapPct: 90,
        cols: 2,
        rows: 1,
      });
      await svc.createMosaic(planId, mosaic({ overlapPct: -5, cols: 0, rows: 3 }));
      expect((await plan(planId)).mosaics[1]).toMatchObject({ overlapPct: 0, cols: 1, rows: 3 });
      await svc.createMosaic(planId, mosaic({ overlapPct: undefined, cols: undefined }));
      expect((await plan(planId)).mosaics[2]).toMatchObject({ overlapPct: 20, cols: 2 });
    });

    it('replaces the standalone frame of the same DSO and the listed entries, and keeps the other frames', async () => {
      await svc.addEntry(planId, { dsoId: 'M31' });
      const custom = (await svc.addEntry(planId, { ra: 1, dec: 2 })).id;
      const keep = (await svc.addEntry(planId, { dsoId: 'M42' })).id;
      await svc.createMosaic(planId, mosaic({ replaceEntryIds: [custom, 3, 'nope'] }));
      const ids = (await plan(planId)).entries.filter((e) => !e.mosaicId).map((e) => e.id);
      expect(ids).toEqual([keep]);
    });

    it('rejects an unknown plan before it checks the body', async () => {
      await expectRejected(
        svc.createMosaic('nope', {} as never),
        'notFound',
        'Plan not found',
        'PLAN_NOT_FOUND',
      );
    });

    it('rejects each invalid body with its message', async () => {
      await expectRejected(
        svc.createMosaic(planId, mosaic({ centerRa: '1' })),
        'invalid',
        'centerRa/centerDec must be numbers',
        'MOSAIC_CENTER_INVALID',
      );
      await expectRejected(
        svc.createMosaic(planId, mosaic({ centerDec: undefined })),
        'invalid',
        'centerRa/centerDec must be numbers',
        'MOSAIC_CENTER_INVALID',
      );
      for (const tiles of [undefined, [], 'x']) {
        await expectRejected(
          svc.createMosaic(planId, mosaic({ tiles })),
          'invalid',
          'tiles must be a non-empty array',
          'MOSAIC_TILES_INVALID',
        );
      }
      for (const tiles of [
        [{ ra: 1 }],
        [null],
        [
          { ra: 1, dec: 2 },
          { ra: '1', dec: 2 },
        ],
      ]) {
        await expectRejected(
          svc.createMosaic(planId, mosaic({ tiles })),
          'invalid',
          'each tile needs numeric ra/dec',
          'MOSAIC_TILE_COORDS_INVALID',
        );
      }
      expect(rows('plan_mosaics')).toEqual([]);
    });

    it('creates nothing when a tile cannot be written (all or nothing)', async () => {
      const keep = (await svc.addEntry(planId, { dsoId: 'M31' })).id;
      // The new mosaic will be mo-id3 and its first tile tile-mo-id3-1: take that id.
      conn
        .prepare(
          "INSERT INTO plan_entries (id, plan_id, dso_id, position) VALUES ('tile-mo-id3-1', ?, 'Z', 0)",
        )
        .run(planId);
      await expect(svc.createMosaic(planId, mosaic())).rejects.toThrow();
      expect(rows('plan_mosaics')).toEqual([]);
      // The standalone frame of M31 that the mosaic would have replaced is still there.
      expect((await plan(planId)).entries.map((e) => e.id).sort()).toEqual(
        [keep, 'tile-mo-id3-1'].sort(),
      );
    });

    it('updates the parameters and replaces the tiles after the other entries', async () => {
      const { id } = await svc.createMosaic(planId, mosaic());
      const other = (await svc.addEntry(planId, { dsoId: 'Y' })).id;
      await svc.updateMosaic(
        planId,
        id,
        mosaic({ name: 'Renamed', cols: 3, tiles: [{ ra: 1, dec: 2 }] }),
      );
      const p = await plan(planId);
      expect(p.mosaics[0]).toMatchObject({ id, name: 'Renamed', cols: 3 });
      const tiles = p.entries.filter((e) => e.mosaicId === id);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toMatchObject({ ra: 1, dec: 2, paDeg: null });
      expect(p.entries.some((e) => e.id === other)).toBe(true);
    });

    it('leaves the stored name alone when the body has none', async () => {
      const { id } = await svc.createMosaic(planId, mosaic({ name: 'Keep me' }));
      await svc.updateMosaic(planId, id, mosaic({ name: undefined, centerRa: 99 }));
      expect((await plan(planId)).mosaics[0]).toMatchObject({ name: 'Keep me', centerRa: 99 });
    });

    it('deletes the standalone entries a merge absorbs, on update', async () => {
      const { id } = await svc.createMosaic(planId, mosaic());
      const merged = (await svc.addEntry(planId, { ra: 1, dec: 1 })).id;
      await svc.updateMosaic(planId, id, mosaic({ replaceEntryIds: [merged] }));
      expect((await plan(planId)).entries.some((e) => e.id === merged)).toBe(false);
    });

    it('rejects a mosaic that does not exist or belongs to another plan, before checking the body', async () => {
      const { id } = await svc.createMosaic(planId, mosaic());
      const other = (await svc.create({ name: 'B' })).id;
      for (const [p, m] of [
        [planId, 'nope'],
        [other, id],
      ]) {
        await expectRejected(
          svc.updateMosaic(p, m, {} as never),
          'notFound',
          'Mosaic not found',
          'MOSAIC_NOT_FOUND',
        );
        await expectRejected(
          svc.removeMosaic(p, m),
          'notFound',
          'Mosaic not found',
          'MOSAIC_NOT_FOUND',
        );
      }
    });

    it('rejects an invalid body on update', async () => {
      const { id } = await svc.createMosaic(planId, mosaic());
      await expectRejected(
        svc.updateMosaic(planId, id, mosaic({ tiles: [] })),
        'invalid',
        'tiles must be a non-empty array',
        'MOSAIC_TILES_INVALID',
      );
    });

    it('changes nothing when a tile cannot be written on update (all or nothing)', async () => {
      const { id } = await svc.createMosaic(planId, mosaic({ name: 'Orig' }));
      const before = await tileIds();
      // After the tiles are deleted the next position is 1; its tiles would be tile-<id>-1 and tile-<id>-2.
      conn
        .prepare("INSERT INTO plan_entries (id, plan_id, dso_id, position) VALUES (?, ?, 'Z', 0)")
        .run(`tile-${id}-2`, planId);
      const merged = (await svc.addEntry(planId, { dsoId: 'W' })).id;
      await expect(
        svc.updateMosaic(planId, id, mosaic({ name: 'New', replaceEntryIds: [merged] })),
      ).rejects.toThrow();
      const p = await plan(planId);
      expect(p.mosaics[0].name).toBe('Orig');
      expect(await tileIds()).toEqual(before);
      expect(p.entries.some((e) => e.id === merged)).toBe(true);
    });

    it('deletes the mosaic and its tiles', async () => {
      const { id } = await svc.createMosaic(planId, mosaic());
      const keep = (await svc.addEntry(planId, { dsoId: 'K' })).id;
      await svc.removeMosaic(planId, id);
      const p = await plan(planId);
      expect(p.mosaics).toEqual([]);
      expect(p.entries.map((e) => e.id)).toEqual([keep]);
    });
  });

  describe('importPlan', () => {
    const opts = { replaceIds: [] as string[], setupId: null, index: 0 };
    const full = {
      id: 'bundle-1',
      name: 'Imported',
      position: 4,
      nightOf: '2026-06-20',
      lat: 48.8,
      lon: 2.3,
      sortBy: 'name',
      entries: [
        {
          id: 'e1',
          dsoId: 'M1',
          position: 3,
          paDeg: 5,
          notes: 'n',
          mosaicId: 'mo-1',
          mosaicWDeg: 2,
          mosaicHDeg: 3,
          observationWindows: [{ startFrac: 0.2, endFrac: 0.4 }],
        },
        { id: 'e2', dsoId: null, ra: 1, dec: 2 },
      ],
      mosaics: [
        {
          id: 'mo-1',
          dsoId: 'M1',
          name: 'Mo',
          centerRa: 1,
          centerDec: 2,
          paDeg: 3,
          overlapPct: 30,
          cols: 2,
          rows: 3,
          position: 7,
        },
      ],
    };

    it('writes the plan, its entries and its mosaics with the values of the file', async () => {
      expect(await svc.importPlan(full, { ...opts, setupId: 'setup-9' })).toBe(true);
      const p = await plan('bundle-1');
      expect(p).toMatchObject({
        name: 'Imported',
        position: 4,
        nightOf: '2026-06-20',
        setupId: 'setup-9',
        lat: 48.8,
        lon: 2.3,
        sortBy: 'name',
      });
      // listed by position: e2 got the index 1 of its place in the file, e1 has position 3
      expect(p.entries[0]).toMatchObject({ id: 'e2', position: 1, ra: 1, dec: 2, dsoId: null });
      expect(p.entries[1]).toMatchObject({
        id: 'e1',
        position: 3,
        paDeg: 5,
        notes: 'n',
        mosaicId: 'mo-1',
        mosaicWDeg: 2,
        mosaicHDeg: 3,
      });
      expect(p.entries[1].observationWindows).toHaveLength(1);
      expect(p.entries[1].observationWindows[0]).toMatchObject({ startFrac: 0.2, endFrac: 0.4 });
      expect(p.mosaics).toEqual([
        {
          id: 'mo-1',
          dsoId: 'M1',
          name: 'Mo',
          centerRa: 1,
          centerDec: 2,
          paDeg: 3,
          overlapPct: 30,
          cols: 2,
          rows: 3,
          position: 7,
        },
      ]);
    });

    it('uses the index as position, "transit" for an unknown sort key, and null for wrong types', async () => {
      await svc.importPlan(
        { id: 'p', name: 'N', sortBy: 'nope', nightOf: 5, lat: '1', lon: null },
        { ...opts, index: 6 },
      );
      expect(await plan('p')).toMatchObject({
        position: 6,
        sortBy: 'transit',
        nightOf: null,
        lat: null,
        lon: null,
      });
    });

    it('skips the entries with no id, or with neither a DSO nor coordinates, and fills defaults', async () => {
      await svc.importPlan(
        {
          id: 'p',
          name: 'N',
          entries: [
            { dsoId: 'M1' },
            { id: 'a' },
            { id: 'b', ra: 1 },
            { id: 'c', dsoId: 'M2', ra: 'x', dec: 3 },
            { id: 'd', ra: 1, dec: 2, observationWindows: 'x' },
          ],
        },
        opts,
      );
      const entries = (await plan('p')).entries;
      expect(entries.map((e) => e.id)).toEqual(['c', 'd']);
      expect(entries[0]).toMatchObject({ dsoId: 'M2', ra: null, dec: null, position: 3 });
      expect(entries[1]).toMatchObject({
        dsoId: null,
        ra: 1,
        dec: 2,
        position: 4,
        observationWindows: [],
      });
    });

    it('skips the mosaics with no id or non-numeric centre, and fills defaults', async () => {
      await svc.importPlan(
        {
          id: 'p',
          name: 'N',
          mosaics: [
            { centerRa: 1, centerDec: 2 },
            { id: 'a', centerRa: '1', centerDec: 2 },
            { id: 'b', centerRa: 1, centerDec: 2, cols: 1.5 },
          ],
        },
        opts,
      );
      expect((await plan('p')).mosaics).toEqual([
        {
          id: 'b',
          dsoId: null,
          name: null,
          centerRa: 1,
          centerDec: 2,
          paDeg: 0,
          overlapPct: 20,
          cols: 1,
          rows: 1,
          position: 2,
        },
      ]);
    });

    it('returns false and writes nothing for a plan with no string id or name', async () => {
      for (const p of [{}, { id: 'x' }, { name: 'x' }, { id: 1, name: 'x' }, null]) {
        expect(await svc.importPlan(p as never, opts)).toBe(false);
      }
      expect(await svc.list()).toEqual([]);
    });

    it('deletes the plans to replace and the plan with the same id, with their entries and mosaics', async () => {
      const old = (await svc.create({ name: 'Winter' })).id;
      await svc.addEntry(old, { dsoId: 'M1' });
      await svc.createMosaic(old, mosaic());
      const sameId = (await svc.create({ name: 'Other' })).id;
      await svc.addEntry(sameId, { dsoId: 'M2' });
      const keep = (await svc.create({ name: 'Keep' })).id;
      await svc.addEntry(keep, { dsoId: 'M3' });
      await svc.importPlan({ id: sameId, name: 'Winter' }, { ...opts, replaceIds: [old] });
      expect((await svc.list()).map((p) => [p.id, p.name, p.entries.length])).toEqual([
        [sameId, 'Winter', 0],
        [keep, 'Keep', 1],
      ]);
      expect(rows('plan_mosaics')).toEqual([]);
      expect(rows('plan_entries')).toHaveLength(1);
    });

    it('leaves the database as it was when one row cannot be written (all or nothing)', async () => {
      await svc.importPlan({ id: 'p', name: 'Old', entries: [{ id: 'old-e', dsoId: 'M1' }] }, opts);
      await expect(
        svc.importPlan(
          {
            id: 'p',
            name: 'New',
            entries: [
              { id: 'dup', dsoId: 'M1' },
              { id: 'dup', dsoId: 'M2' },
            ],
          },
          opts,
        ),
      ).rejects.toThrow();
      const p = await plan('p');
      expect(p.name).toBe('Old');
      expect(p.entries.map((e) => e.id)).toEqual(['old-e']);
    });
  });
});

describe.each(SQL_ADAPTERS)('PlanService round trips (%s)', (_adapter, wrap) => {
  let conn: Database.Database;
  let db: CountingSqlDb;
  let svc: PlanService;
  beforeEach(async () => {
    conn = new Database(':memory:');
    db = countingSqlDb(wrap(createBetterSqliteDb(conn)));
    await initSchema(db);
    let n = 0;
    svc = createPlanService({ db, newId: () => `t${++n}` });
    db.reset();
  });
  afterEach(() => conn.close());

  /** Round trips made by `fn`. */
  const trips = async (fn: () => Promise<unknown>): Promise<number> => {
    db.reset();
    await fn();
    return db.calls();
  };

  /** Fills a plan with `n` entries and a mosaic of `n` tiles, so the counts show they do not grow. */
  const fill = async (n: number) => {
    const planId = (await svc.create({ name: `P${n}` })).id;
    for (let i = 0; i < n; i++) await svc.addEntry(planId, { dsoId: `D${i}` });
    const tiles = Array.from({ length: n }, (_, i) => ({ ra: i, dec: i, paDeg: null }));
    const { id } = await svc.createMosaic(planId, mosaic({ dsoId: null, tiles }));
    return { planId, mosaicId: id };
  };

  it.each([2, 12])(
    'makes a fixed number of round trips whatever the number of rows (%i)',
    async (n) => {
      const { planId, mosaicId } = await fill(n);
      const ids = Array.from({ length: n }, (_, i) => `x${i}`);
      const tiles = Array.from({ length: n }, (_, i) => ({ ra: i, dec: i, paDeg: null }));

      expect(await trips(() => svc.list())).toBe(3);
      expect(await trips(() => svc.listNames())).toBe(1);
      expect(await trips(() => svc.create({ name: 'N' }))).toBe(1);
      expect(await trips(() => svc.reorder(ids))).toBe(1);
      expect(await trips(() => svc.update(planId, { name: 'R', lat: 1, sortBy: 'name' }))).toBe(2);
      // begin, plan, duplicate check, insert, commit
      expect(await trips(() => svc.addEntry(planId, { dsoId: 'NEW' }))).toBe(5);
      expect(await trips(() => svc.addEntry(planId, { ra: 1, dec: 2 }))).toBe(4);
      expect(await trips(() => svc.reorderEntries(planId, ids))).toBe(1);
      const e = (await svc.addEntry(planId, { dsoId: 'E' })).id;
      expect(await trips(() => svc.updateEntry(e, { ra: 1, dec: 2, observationWindows: [] }))).toBe(
        1,
      );
      expect(await trips(() => svc.removeEntry(e))).toBe(1);
      // begin, plan, deletes and mosaic insert, next position, tiles, commit
      expect(await trips(() => svc.createMosaic(planId, mosaic({ tiles })))).toBe(6);
      // begin, mosaic, replace/update/tile deletes, next position, tiles, commit
      expect(await trips(() => svc.updateMosaic(planId, mosaicId, mosaic({ tiles })))).toBe(6);
      // begin, mosaic, tile delete, mosaic delete, commit
      expect(await trips(() => svc.removeMosaic(planId, mosaicId))).toBe(5);
      // begin, three deletes, commit
      expect(await trips(() => svc.remove(planId))).toBe(5);
    },
  );

  it.each([0, 5, 30])('imports a plan in one round trip (%i entries and mosaics)', async (n) => {
    const plan = {
      id: 'p',
      name: 'N',
      entries: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, dsoId: `D${i}` })),
      mosaics: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, centerRa: 1, centerDec: 2 })),
    };
    expect(
      await trips(() =>
        svc.importPlan(plan, { replaceIds: ['a', 'b', 'c'], setupId: null, index: 0 }),
      ),
    ).toBe(1);
  });
});
