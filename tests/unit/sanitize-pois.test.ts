/**
 * Tests for server/db.ts `sanitizePois`: the gate every POI write goes through
 * (upload, metadata update, import). A POI identified on the photo (e.g. a
 * supernova) carries an ra/dec position that must survive; malformed positions
 * are dropped without losing the POI itself.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

let sanitizePois: typeof import('../../server/db.js').sanitizePois;

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv('DB_PATH', ':memory:');
  ({ sanitizePois } = await import('../../server/db.js'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('sanitizePois()', () => {
  it('keeps name + categoryId only for a POI without position', () => {
    expect(sanitizePois([{ name: ' C/2023 A3 ', categoryId: 'cat-comet', extra: 1 }])).toEqual([
      { name: 'C/2023 A3', categoryId: 'cat-comet' },
    ]);
  });

  it('keeps a valid ra/dec position', () => {
    expect(
      sanitizePois([
        { name: 'SN 2026aaiv', categoryId: 'cat-supernova', ra: 339.27345, dec: 34.409775 },
      ]),
    ).toEqual([
      { name: 'SN 2026aaiv', categoryId: 'cat-supernova', ra: 339.27345, dec: 34.409775 },
    ]);
  });

  it.each([
    ['ra out of range', { ra: 360, dec: 10 }],
    ['dec out of range', { ra: 10, dec: 91 }],
    ['ra as a string', { ra: '10', dec: 10 }],
    ['dec missing', { ra: 10 }],
    ['NaN', { ra: NaN, dec: 10 }],
  ])('drops the position (not the POI) when %s', (_label, pos) => {
    expect(sanitizePois([{ name: 'SN X', categoryId: 'cat-supernova', ...pos }])).toEqual([
      { name: 'SN X', categoryId: 'cat-supernova' },
    ]);
  });

  it('still rejects entries without a name or category', () => {
    expect(sanitizePois([{ name: '', categoryId: 'x' }, { name: 'a' }, null])).toEqual([]);
    expect(sanitizePois('nope')).toEqual([]);
  });
});
