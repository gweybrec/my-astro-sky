// @vitest-environment node
/**
 * The POI-category service (WP2.3c) on a private in-memory database.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import { DomainError, isDomainError } from '@myastrosky/core/domain/errors';
import {
  createPoiCategoryService,
  type PoiCategoryService,
} from '@myastrosky/core/services/poi-categories';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { SQL_ADAPTERS } from '../helpers/sql-adapters';
import { countingSqlDb, type CountingSqlDb } from '../helpers/counting-sql-db';

const DEFAULTS = [
  { id: 'cat-comet', name: 'Comet', color: '#4ea1ff', position: 0 },
  { id: 'cat-asteroid', name: 'Asteroid', color: '#c9a227', position: 1 },
  { id: 'cat-satellite', name: 'Satellite', color: '#7bd88f', position: 2 },
  { id: 'cat-iss', name: 'ISS', color: '#cbd5e1', position: 3 },
  { id: 'cat-supernova', name: 'Supernova', color: '#ff5a5a', position: 4 },
];

describe.each(SQL_ADAPTERS)('PoiCategoryService (%s)', (_adapter, wrap) => {
  let conn: Database.Database;
  let db: SqlDb;
  let svc: PoiCategoryService;
  let counter: number;

  beforeEach(async () => {
    conn = new Database(':memory:');
    db = wrap(createBetterSqliteDb(conn));
    await initSchema(db);
    counter = 0;
    svc = createPoiCategoryService({ db, newId: () => `id${++counter}` });
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
      await svc.importOne({ id: 'b', name: 'B', color: '#111', position: 1 });
      await svc.importOne({ id: 'a', name: 'A', color: '#111', position: 0 });
      await svc.importOne({ id: 'c', name: 'C', color: '#111', position: 1 });
      expect((await svc.list()).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('ensureDefaults', () => {
    it('inserts the five default categories into an empty table', async () => {
      await svc.ensureDefaults();
      expect(await svc.list()).toEqual(DEFAULTS);
    });

    it('does nothing when the table already has a row', async () => {
      await svc.importOne({ id: 'mine', name: 'Mine', color: '#123456', position: 0 });
      await svc.ensureDefaults();
      expect(await svc.list()).toEqual([
        { id: 'mine', name: 'Mine', color: '#123456', position: 0 },
      ]);
    });

    it('is idempotent and does not bring back categories the user deleted one by one', async () => {
      await svc.ensureDefaults();
      await svc.ensureDefaults();
      expect(await svc.list()).toHaveLength(5);
      await svc.remove('cat-iss');
      await svc.ensureDefaults();
      expect(await svc.list()).toHaveLength(4);
    });

    it('seeds again after every category was removed', async () => {
      await svc.ensureDefaults();
      await svc.removeAll();
      await svc.ensureDefaults();
      expect(await svc.list()).toEqual(DEFAULTS);
    });
  });

  describe('create', () => {
    it('stores a trimmed name with the default color and the next position', async () => {
      expect(await svc.create({ name: ' Meteor ' })).toEqual({ id: 'cat-id1' });
      await svc.create({ name: 'Nova', color: ' #ff0000 ' });
      expect(await svc.list()).toEqual([
        { id: 'cat-id1', name: 'Meteor', color: '#888888', position: 0 },
        { id: 'cat-id2', name: 'Nova', color: '#ff0000', position: 1 },
      ]);
    });

    it('appends after the defaults', async () => {
      await svc.ensureDefaults();
      const { id } = await svc.create({ name: 'Meteor' });
      expect((await svc.list()).find((c) => c.id === id)?.position).toBe(5);
    });

    it('falls back to the default color for a blank or non-string color', async () => {
      await svc.create({ name: 'A', color: '  ' });
      await svc.create({ name: 'B', color: 7 });
      expect((await svc.list()).map((c) => c.color)).toEqual(['#888888', '#888888']);
    });

    it('truncates a long name to 60 characters and a long color to 32', async () => {
      await svc.create({ name: 'n'.repeat(80), color: 'c'.repeat(50) });
      const [c] = await svc.list();
      expect(c.name).toBe('n'.repeat(60));
      expect(c.color).toBe('c'.repeat(32));
    });

    it('rejects a missing, blank or non-string name with the MISSING_NAME body', async () => {
      for (const input of [{}, { name: '   ' }, { name: 5 }, undefined]) {
        const err = await rejection(svc.create(input));
        expect(err.kind).toBe('invalid');
        expect(err.code).toBe('MISSING_NAME');
        expect(err.body).toEqual({ error: 'name is required', code: 'MISSING_NAME' });
      }
      expect(await svc.list()).toEqual([]);
    });
  });

  describe('update', () => {
    it('changes only the fields that are given and valid', async () => {
      const { id } = await svc.create({ name: 'Meteor', color: '#111111' });
      await svc.update(id, { name: ' Nova ' });
      expect(await svc.list()).toEqual([{ id, name: 'Nova', color: '#111111', position: 0 }]);
      await svc.update(id, { color: '#ff0000', position: 3 });
      expect(await svc.list()).toEqual([{ id, name: 'Nova', color: '#ff0000', position: 3 }]);
    });

    it('ignores invalid values and keeps the stored ones', async () => {
      const { id } = await svc.create({ name: 'Meteor' });
      await svc.update(id, { name: '  ', color: 4, position: 'x' });
      expect(await svc.list()).toEqual([{ id, name: 'Meteor', color: '#888888', position: 0 }]);
      await svc.update(id, undefined);
      expect((await svc.list())[0].name).toBe('Meteor');
    });

    it('throws notFound for an unknown id', async () => {
      const err = await rejection(svc.update('nope', { name: 'x' }));
      expect(err.kind).toBe('notFound');
      expect(err.message).toBe('Category not found');
      expect(err.body).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('deletes one category and leaves the others', async () => {
      const a = await svc.create({ name: 'A' });
      const b = await svc.create({ name: 'B' });
      await svc.remove(a.id);
      expect((await svc.list()).map((c) => c.id)).toEqual([b.id]);
    });

    it('throws notFound for an unknown id', async () => {
      const err = await rejection(svc.remove('nope'));
      expect(err.kind).toBe('notFound');
      expect(err.message).toBe('Category not found');
    });
  });

  describe('removeAll', () => {
    it('deletes every category and returns how many there were', async () => {
      await svc.ensureDefaults();
      expect(await svc.removeAll()).toBe(5);
      expect(await svc.list()).toEqual([]);
    });

    it('returns 0 on an empty table', async () => {
      expect(await svc.removeAll()).toBe(0);
    });
  });

  describe('importOne', () => {
    it('writes without the checks of create and replaces the category with the same id', async () => {
      await svc.importOne({ id: 'c1', name: 'First', color: '#123456', position: 5 });
      expect(await svc.list()).toEqual([
        { id: 'c1', name: 'First', color: '#123456', position: 5 },
      ]);
      await svc.importOne({ id: 'c1', name: 'Second', color: '#654321', position: 0 });
      expect(await svc.list()).toEqual([
        { id: 'c1', name: 'Second', color: '#654321', position: 0 },
      ]);
    });

    it('truncates the name and color like every other write', async () => {
      await svc.importOne({
        id: 'c1',
        name: 'n'.repeat(80),
        color: 'c'.repeat(50),
        position: 0,
      });
      const [c] = await svc.list();
      expect(c.name).toHaveLength(60);
      expect(c.color).toHaveLength(32);
    });
  });
});

describe.each(SQL_ADAPTERS)('PoiCategoryService round trips (%s)', (_adapter, wrap) => {
  let conn: Database.Database;
  let db: CountingSqlDb;
  beforeEach(async () => {
    conn = new Database(':memory:');
    db = countingSqlDb(wrap(createBetterSqliteDb(conn)));
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

  it('makes a fixed number of round trips per method, whatever the number of rows', async () => {
    let n = 0;
    const svc = createPoiCategoryService({ db, newId: () => `t${++n}` });
    expect(await trips(() => svc.ensureDefaults())).toBe(1); // empty table
    expect(await trips(() => svc.ensureDefaults())).toBe(1); // already filled
    expect(await trips(() => svc.list())).toBe(1);
    expect(await trips(() => svc.create({ name: 'N' }))).toBe(1);
    // begin + read the row + write it + commit
    expect(await trips(() => svc.update('cat-comet', { name: 'C2' }))).toBe(4);
    expect(
      await trips(() => svc.importOne({ id: 'z', name: 'z', color: '#fff', position: 9 })),
    ).toBe(1);
    expect(await trips(() => svc.remove('z'))).toBe(1);
    expect(await trips(() => svc.removeAll())).toBe(1);
  });
});
