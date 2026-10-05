// @vitest-environment node
/**
 * The sky-region service (WP2.3b) on a private in-memory database.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import { DomainError, isDomainError } from '@myastrosky/core/domain/errors';
import {
  createSkyRegionService,
  type SkyRegionService,
} from '@myastrosky/core/services/sky-regions';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { countingSqlDb, type CountingSqlDb } from '../helpers/counting-sql-db';

const points = [
  { azDeg: 0, altDeg: 10 },
  { azDeg: 90, altDeg: 10 },
  { azDeg: 45, altDeg: 40 },
];

describe('SkyRegionService', () => {
  let conn: Database.Database;
  let db: SqlDb;
  let svc: SkyRegionService;
  let counter: number;

  beforeEach(async () => {
    conn = new Database(':memory:');
    db = createBetterSqliteDb(conn);
    await initSchema(db);
    counter = 0;
    svc = createSkyRegionService({ db, newId: () => `id${++counter}` });
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

  describe('list', () => {
    it('returns an empty list when nothing is stored', async () => {
      expect(await svc.list()).toEqual([]);
    });

    it('orders by position, then insertion order', async () => {
      await svc.importOne({ id: 'b', name: 'B', color: '#111', points, position: 1 });
      await svc.importOne({ id: 'a', name: 'A', color: '#111', points, position: 0 });
      await svc.importOne({ id: 'c', name: 'C', color: '#111', points, position: 1 });
      expect((await svc.list()).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    });

    it('returns an empty polygon for a row whose points cannot be read', async () => {
      await db.run(
        'INSERT INTO sky_regions (id, name, color, points, position) VALUES (?,?,?,?,?)',
        ['bad', 'Bad', '#fff', '{not json', 0],
      );
      expect(await svc.list()).toEqual([
        { id: 'bad', name: 'Bad', color: '#fff', points: [], position: 0 },
      ]);
    });
  });

  describe('create', () => {
    it('stores a trimmed name with the default color and the next position', async () => {
      const first = await svc.create({ name: ' Trees ', points });
      expect(first).toEqual({ id: 'region-id1' });
      await svc.create({ name: 'Roof', color: ' #ff0000 ', points });
      expect(await svc.list()).toEqual([
        { id: 'region-id1', name: 'Trees', color: '#4ea1ff', points, position: 0 },
        { id: 'region-id2', name: 'Roof', color: '#ff0000', points, position: 1 },
      ]);
    });

    it('falls back to the default color for a blank or non-string color', async () => {
      await svc.create({ name: 'A', color: '  ', points });
      await svc.create({ name: 'B', color: 7, points });
      expect((await svc.list()).map((r) => r.color)).toEqual(['#4ea1ff', '#4ea1ff']);
    });

    it('truncates a long name to 60 characters and a long color to 32', async () => {
      await svc.create({ name: 'n'.repeat(80), color: 'c'.repeat(50), points });
      const [r] = await svc.list();
      expect(r.name).toBe('n'.repeat(60));
      expect(r.color).toBe('c'.repeat(32));
    });

    it('rejects a missing, blank or non-string name with the MISSING_NAME body', async () => {
      for (const input of [{ points }, { name: '   ', points }, { name: 5, points }, undefined]) {
        const err = await rejection(svc.create(input));
        expect(err.kind).toBe('invalid');
        expect(err.code).toBe('MISSING_NAME');
        expect(err.body).toEqual({ error: 'name is required', code: 'MISSING_NAME' });
      }
      expect(await svc.list()).toEqual([]);
    });

    it('rejects fewer than 3 vertices and vertices that are not finite numbers', async () => {
      const bad: unknown[] = [
        undefined,
        'x',
        points.slice(0, 2),
        [...points.slice(0, 2), { azDeg: 1 }],
        [...points.slice(0, 2), { azDeg: 'a', altDeg: 2 }],
        [...points.slice(0, 2), null],
        [...points.slice(0, 2), { azDeg: Infinity, altDeg: 2 }],
      ];
      for (const p of bad) {
        const err = await rejection(svc.create({ name: 'x', points: p }));
        expect(err.kind).toBe('invalid');
        expect(err.message).toBe('points must have at least 3 {azDeg,altDeg} vertices');
        expect(err.body).toBeUndefined();
      }
      expect(await svc.list()).toEqual([]);
    });

    it('checks the name before the points', async () => {
      const err = await rejection(svc.create({ points: [] }));
      expect(err.code).toBe('MISSING_NAME');
    });
  });

  describe('update', () => {
    it('changes only the fields that are given and valid', async () => {
      const { id } = await svc.create({ name: 'Trees', points });
      await svc.update(id, { name: ' Roof ', color: '#ff0000' });
      expect(await svc.list()).toEqual([
        { id, name: 'Roof', color: '#ff0000', points, position: 0 },
      ]);

      const newPoints = [...points, { azDeg: 10, altDeg: 20 }];
      await svc.update(id, { points: newPoints, position: 3 });
      expect(await svc.list()).toEqual([
        { id, name: 'Roof', color: '#ff0000', points: newPoints, position: 3 },
      ]);
    });

    it('ignores invalid values and keeps the stored ones', async () => {
      const { id } = await svc.create({ name: 'Trees', points });
      await svc.update(id, { name: '  ', color: 4, points: points.slice(0, 2), position: 'x' });
      expect(await svc.list()).toEqual([
        { id, name: 'Trees', color: '#4ea1ff', points, position: 0 },
      ]);
      await svc.update(id, undefined);
      expect((await svc.list())[0].name).toBe('Trees');
    });

    it('keeps a stored polygon that cannot be read as it is', async () => {
      await db.run(
        'INSERT INTO sky_regions (id, name, color, points, position) VALUES (?,?,?,?,?)',
        ['bad', 'Bad', '#fff', '{not json', 0],
      );
      await svc.update('bad', { name: 'Renamed' });
      const row = await db.get<{ points: string }>('SELECT points FROM sky_regions WHERE id = ?', [
        'bad',
      ]);
      expect(row?.points).toBe('{not json');
    });

    it('throws notFound for an unknown id', async () => {
      const err = await rejection(svc.update('nope', { name: 'x' }));
      expect(err.kind).toBe('notFound');
      expect(err.message).toBe('Region not found');
      expect(err.body).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('deletes one region and leaves the others', async () => {
      const a = await svc.create({ name: 'A', points });
      const b = await svc.create({ name: 'B', points });
      await svc.remove(a.id);
      expect((await svc.list()).map((r) => r.id)).toEqual([b.id]);
    });

    it('throws notFound for an unknown id', async () => {
      const err = await rejection(svc.remove('nope'));
      expect(err.kind).toBe('notFound');
      expect(err.message).toBe('Region not found');
    });
  });

  describe('importOne', () => {
    it('writes without the checks of create and replaces the region with the same id', async () => {
      await svc.importOne({ id: 'r1', name: 'First', color: '#123456', points: [], position: 5 });
      expect(await svc.list()).toEqual([
        { id: 'r1', name: 'First', color: '#123456', points: [], position: 5 },
      ]);
      await svc.importOne({ id: 'r1', name: 'Second', color: '#654321', points, position: 0 });
      expect(await svc.list()).toEqual([
        { id: 'r1', name: 'Second', color: '#654321', points, position: 0 },
      ]);
    });

    it('truncates the name and color like every other write', async () => {
      await svc.importOne({
        id: 'r1',
        name: 'n'.repeat(80),
        color: 'c'.repeat(50),
        points,
        position: 0,
      });
      const [r] = await svc.list();
      expect(r.name).toHaveLength(60);
      expect(r.color).toHaveLength(32);
    });
  });
});

describe('SkyRegionService round trips', () => {
  let conn: Database.Database;
  let db: CountingSqlDb;
  beforeEach(async () => {
    conn = new Database(':memory:');
    db = countingSqlDb(createBetterSqliteDb(conn));
    await initSchema(db);
    db.reset();
  });
  afterEach(() => conn.close());

  /** Round trips made by `fn`. */
  const trips = async (fn: () => Promise<unknown>): Promise<number> => {
    db.reset();
    await fn();
    return db.calls();
  };

  const points = [
    { azDeg: 0, altDeg: 10 },
    { azDeg: 90, altDeg: 10 },
    { azDeg: 180, altDeg: 10 },
  ];

  it('makes a fixed number of round trips per method, whatever the number of rows', async () => {
    let n = 0;
    const svc = createSkyRegionService({ db, newId: () => `t${++n}` });
    for (const id of ['a', 'b', 'c']) {
      await svc.importOne({ id, name: id, color: '#fff', points, position: 0 });
    }
    expect(await trips(() => svc.list())).toBe(1);
    expect(await trips(() => svc.create({ name: 'N', points }))).toBe(1);
    // begin + read the row + write it + commit
    expect(await trips(() => svc.update('a', { name: 'A2' }))).toBe(4);
    expect(
      await trips(() => svc.importOne({ id: 'z', name: 'z', color: '#fff', points, position: 9 })),
    ).toBe(1);
    expect(await trips(() => svc.remove('b'))).toBe(1);
  });
});
