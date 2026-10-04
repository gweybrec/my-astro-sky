// @vitest-environment node
/**
 * The DSO override service (WP2.3a) on a private in-memory database.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import { DomainError, isDomainError } from '@myastrosky/core/domain/errors';
import {
  createDsoOverrideService,
  validateDsoOverrideCoords,
  type DsoOverrideService,
} from '@myastrosky/core/services/dso-overrides';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';

describe('DsoOverrideService', () => {
  let conn: Database.Database;
  let db: SqlDb;
  let svc: DsoOverrideService;

  beforeEach(async () => {
    conn = new Database(':memory:');
    db = createBetterSqliteDb(conn);
    await initSchema(db);
    svc = createDsoOverrideService({ db });
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

  describe('getAll', () => {
    it('returns an empty object when nothing is stored', async () => {
      expect(await svc.getAll()).toEqual({});
    });

    it('returns every override by id and skips rows whose JSON is unreadable', async () => {
      await svc.upsert('M31', { name: 'Andromeda' });
      await svc.upsert('M42', { ra: 83.8, dec: -5.4 });
      await db.run('INSERT INTO dso_overrides (id, data) VALUES (?, ?)', ['BAD', '{not json']);
      expect(await svc.getAll()).toEqual({
        M31: { name: 'Andromeda' },
        M42: { ra: 83.8, dec: -5.4 },
      });
    });
  });

  describe('upsert', () => {
    it('accepts a valid id and data, and replaces an existing override', async () => {
      await svc.upsert('M31', { name: 'first' });
      await svc.upsert('M31', { name: 'second' });
      expect(await svc.getAll()).toEqual({ M31: { name: 'second' } });
    });

    it('accepts an id of exactly 100 characters and RA/Dec on the range edges', async () => {
      const id = 'x'.repeat(100);
      await svc.upsert(id, { ra: 0, dec: -90 });
      await svc.upsert('B', { ra: 359.999, dec: 90 });
      expect(Object.keys(await svc.getAll())).toEqual(expect.arrayContaining([id, 'B']));
    });

    it('rejects an empty id, a long id and a non-string id', async () => {
      for (const id of ['', 'x'.repeat(101), undefined, 42]) {
        const err = await rejection(svc.upsert(id, { name: 'x' }));
        expect(err.kind).toBe('invalid');
        expect(err.message).toBe('Invalid DSO id');
        expect(err.body).toBeUndefined();
      }
      expect(await svc.getAll()).toEqual({});
    });

    it('rejects data that is not a plain object', async () => {
      for (const data of [[], null, undefined, 'text', 12]) {
        const err = await rejection(svc.upsert('M31', data));
        expect(err.kind).toBe('invalid');
        expect(err.message).toBe('Invalid override data');
      }
      expect(await svc.getAll()).toEqual({});
    });

    it('checks the id before the data', async () => {
      const err = await rejection(svc.upsert('', []));
      expect(err.message).toBe('Invalid DSO id');
    });

    it('rejects an out-of-range RA with the coordinate body', async () => {
      const err = await rejection(svc.upsert('M31', { ra: 360 }));
      expect(err.kind).toBe('invalid');
      expect(err.code).toBe('INVALID_DSO_RA');
      expect(err.body).toEqual({ error: 'RA must be in [0, 360)', code: 'INVALID_DSO_RA' });
    });

    it('rejects an out-of-range Dec with the coordinate body', async () => {
      const err = await rejection(svc.upsert('M31', { dec: 91 }));
      expect(err.code).toBe('INVALID_DSO_DEC');
      expect(err.body).toEqual({ error: 'Dec must be in [-90, 90]', code: 'INVALID_DSO_DEC' });
      expect(await svc.getAll()).toEqual({});
    });
  });

  describe('remove', () => {
    it('deletes one override and leaves the others', async () => {
      await svc.upsert('M31', { name: 'a' });
      await svc.upsert('M42', { name: 'b' });
      await svc.remove('M31');
      expect(await svc.getAll()).toEqual({ M42: { name: 'b' } });
    });

    it('does nothing for an id that is not stored', async () => {
      await expect(svc.remove('nope')).resolves.toBeUndefined();
    });
  });

  describe('removeAll', () => {
    it('deletes every override and returns the count', async () => {
      await svc.upsert('M31', { name: 'a' });
      await svc.upsert('M42', { name: 'b' });
      expect(await svc.removeAll()).toBe(2);
      expect(await svc.getAll()).toEqual({});
    });

    it('returns 0 when nothing is stored', async () => {
      expect(await svc.removeAll()).toBe(0);
    });
  });

  describe('importOne', () => {
    it('writes without the checks of upsert', async () => {
      await svc.importOne('M31', { ra: 999, name: 'unchecked' });
      expect(await svc.getAll()).toEqual({ M31: { ra: 999, name: 'unchecked' } });
    });
  });
});

describe('validateDsoOverrideCoords', () => {
  it('returns null for in-range or non-numeric values and an error body otherwise', () => {
    expect(validateDsoOverrideCoords({ ra: 180, dec: 45 })).toBeNull();
    expect(validateDsoOverrideCoords({ ra: '180' })).toBeNull();
    expect(validateDsoOverrideCoords({ ra: -1 })?.code).toBe('INVALID_DSO_RA');
    expect(validateDsoOverrideCoords({ ra: -5, dec: 999 })?.code).toBe('INVALID_DSO_RA');
  });
});
