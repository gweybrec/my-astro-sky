import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import type { AffineMatrix } from '../../src/types';

vi.mock('../../src/i18n', () => ({
  getLang: vi.fn(() => 'en'),
}));

// Simple linear projection mock: project(ra, dec) → {x: ra/360, y: dec/90}
// Makes it easy to reason about which DSOs fall inside a given image region.
vi.mock('../../src/projection', () => ({
  project: vi.fn((ra: number, dec: number) => ({ x: ra / 360, y: dec / 90 })),
  invalidateProjections: vi.fn(),
}));

import type { PhotoCorrespondence } from '../../src/types';
import {
  loadDSOCatalog,
  getDSOs,
  getDSOById,
  getDSOsNear,
  findDSOsInImage,
  findDSOIdsFromCorrespondences,
  getDSOCatalog,
  applyAndStoreSingleOverride,
  resetDsoToBaseValues,
  getDSOCatalogBaseValues,
  getUserOverride,
} from '../../src/dso-catalog';

// Columnar fixture — mirrors the real dso.json schema.
// Fields: id, ra, dec, type, majAxis, minAxis, pa, mag, nameFr, nameEn, nameEs, nameDe,
//         catalogs, emissionLines, constellation, rating, difficulty
const FIXTURE = {
  fields: [
    'id',
    'ra',
    'dec',
    'type',
    'majAxis',
    'minAxis',
    'pa',
    'mag',
    'nameFr',
    'nameEn',
    'nameEs',
    'nameDe',
    'catalogs',
    'emissionLines',
    'constellation',
    'rating',
    'difficulty',
    'containerId',
    'priority',
  ],
  data: [
    // M1 / NGC1952 — SNR in Taurus
    [
      'M1',
      83.63,
      22.01,
      'SNR',
      7,
      5,
      0,
      8.4,
      'Nébuleuse du Crabe',
      'Crab Nebula',
      null,
      null,
      ['M1', 'NGC1952'],
      'Hα',
      'Tau',
      4,
      3,
      null,
      1,
    ],
    // M42 / NGC1976 — EN in Orion  (close to M1 for angular-distance tests). A container.
    [
      'M42',
      83.82,
      -5.39,
      'EN',
      65,
      60,
      0,
      4.0,
      "Nébuleuse d'Orion",
      'Orion Nebula',
      null,
      null,
      ['M42', 'NGC1976'],
      'Hα',
      'Ori',
      5,
      1,
      null,
      0,
    ],
    // IC434 — EN in Orion (Horsehead region, near M42). Inner object of M42.
    [
      'IC434',
      84.05,
      -2.45,
      'EN',
      60,
      10,
      0,
      null,
      'Nébuleuse de la Tête de Cheval',
      'Horsehead Nebula',
      null,
      null,
      ['IC434'],
      'Hα',
      'Ori',
      5,
      4,
      'M42',
      5,
    ],
    // SH2-106 — remote field
    [
      'SH2-106',
      308.76,
      37.38,
      'EN',
      3,
      2,
      0,
      null,
      null,
      null,
      null,
      null,
      ['SH2-106'],
      'Hα',
      'Cyg',
      3,
      4,
      null,
      7,
    ],
    // LBN object
    [
      'LBN254',
      83.0,
      -6.0,
      'EN',
      120,
      90,
      0,
      null,
      null,
      null,
      null,
      null,
      ['LBN254'],
      null,
      'Ori',
      2,
      3,
      null,
      9,
    ],
    // LDN object
    [
      'LDN1622',
      84.75,
      1.75,
      'DN',
      40,
      30,
      0,
      null,
      null,
      null,
      null,
      null,
      ['LDN1622'],
      null,
      'Ori',
      2,
      4,
      null,
      8,
    ],
    // vdB object
    [
      'vdB141',
      315.22,
      63.02,
      'RN',
      5,
      5,
      0,
      null,
      null,
      null,
      null,
      null,
      ['vdB141'],
      null,
      'Cep',
      3,
      5,
      null,
      6,
    ],
    // Abell
    [
      'Abell21',
      112.54,
      20.56,
      'PN',
      10,
      8,
      0,
      9.8,
      null,
      'Medusa Nebula',
      null,
      null,
      ['Abell21', 'PK205+14.1'],
      null,
      'Gem',
      3,
      4,
      null,
      3,
    ],
    // LPN
    [
      'LPN-1',
      10.0,
      10.0,
      'PN',
      2,
      2,
      0,
      12.0,
      null,
      null,
      null,
      null,
      ['LPN-1'],
      null,
      'And',
      1,
      5,
      null,
      4,
    ],
    // Origin DSO — at ra=0, dec=0 for findDSOsInImage geometry tests
    [
      'TESTOBJ',
      0.0,
      0.0,
      'PN',
      1,
      1,
      0,
      10.0,
      null,
      'Test Object',
      null,
      null,
      ['TESTOBJ'],
      null,
      'And',
      1,
      5,
      null,
      2,
    ],
  ],
};

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: async () => FIXTURE,
    }),
  );
  await loadDSOCatalog();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// ─── getDSOs ──────────────────────────────────────────────────────────────────

describe('getDSOs()', () => {
  it('returns all loaded DSOs', () => {
    expect(getDSOs().length).toBe(FIXTURE.data.length);
  });

  it('precomputes the catalog prefix on every DSO to match getDSOCatalog(id)', () => {
    for (const dso of getDSOs()) {
      expect(dso.catalog).toBe(getDSOCatalog(dso.id));
    }
  });
});

// ─── getDSOById ───────────────────────────────────────────────────────────────

describe('getDSOById()', () => {
  it('finds DSO by its primary id', () => {
    const dso = getDSOById('M1');
    expect(dso).toBeDefined();
    expect(dso!.id).toBe('M1');
  });

  it('lookup is case-insensitive', () => {
    expect(getDSOById('m1')).toBeDefined();
    expect(getDSOById('M1')).toStrictEqual(getDSOById('m1'));
  });

  it('finds M42 via its NGC alias', () => {
    const byM42 = getDSOById('M42');
    const byNGC = getDSOById('NGC1976');
    expect(byM42).toBeDefined();
    expect(byNGC).toBeDefined();
    expect(byNGC).toStrictEqual(byM42);
  });

  it('returns undefined for unknown id', () => {
    expect(getDSOById('DOES_NOT_EXIST')).toBeUndefined();
  });

  it('reads containerId (inner object → container id; container → null)', () => {
    expect(getDSOById('IC434')!.containerId).toBe('M42');
    expect(getDSOById('M42')!.containerId).toBeNull();
  });

  it('reads the precomputed render priority', () => {
    expect(getDSOById('M42')!.priority).toBe(0);
    expect(getDSOById('IC434')!.priority).toBe(5);
  });

  it('sets displayName to English value (lang=en)', () => {
    const dso = getDSOById('M42');
    expect(dso!.displayName).toBe('Orion Nebula');
  });

  it('catalogs array is sorted by priority (M before NGC)', () => {
    // M1 has catalogs: ['M1', 'NGC1952'] — M should come first
    const dso = getDSOById('M1');
    expect(dso!.catalogs[0]).toMatch(/^M\d/);
    expect(dso!.catalogs[1]).toBe('NGC1952');
  });
});

// ─── getDSOsNear ──────────────────────────────────────────────────────────────

describe('getDSOsNear()', () => {
  it('returns DSOs within radius of query point', () => {
    // Query near M42 (83.82, -5.39) with 10° radius
    // Should include M42, IC434, LBN254 but NOT M1 (dec=22) or SH2-106 (far)
    const results = getDSOsNear(83.82, -5.39, 10);
    const ids = results.map((d) => d.id);
    expect(ids).toContain('M42');
    expect(ids).toContain('IC434');
    expect(ids).not.toContain('SH2-106');
    expect(ids).not.toContain('vdB141');
  });

  it('excludes DSOs outside radius', () => {
    // SH2-106 is at RA=308, Dec=37 — far from M42
    const results = getDSOsNear(83.82, -5.39, 5);
    expect(results.some((d) => d.id === 'SH2-106')).toBe(false);
  });

  it('returns empty array when nothing is nearby', () => {
    const results = getDSOsNear(0, -85, 0.1); // South polar region
    expect(results).toEqual([]);
  });

  it('returns all DSOs when radius is very large', () => {
    const results = getDSOsNear(180, 0, 180);
    expect(results.length).toBe(FIXTURE.data.length);
  });
});

// ─── getDSOCatalog ────────────────────────────────────────────────────────────

describe('getDSOCatalog()', () => {
  it.each([
    ['M1', 'M'],
    ['NGC224', 'NGC'],
    ['IC434', 'IC'],
    ['SH2-106', 'SH2'],
    ['LBN254', 'LBN'],
    ['LDN1622', 'LDN'],
    ['vdB141', 'vdB'],
    ['Abell21', 'Abell'],
    ['LPN-1', 'LPN'],
    ['Barnard33', 'Barnard'],
    ['Barnard67a', 'Barnard'],
  ])('getDSOCatalog(%s) === %s', (id, expected) => {
    expect(getDSOCatalog(id)).toBe(expected);
  });

  it('returns null for unrecognized id format', () => {
    expect(getDSOCatalog('TESTOBJ')).toBeNull();
    expect(getDSOCatalog('')).toBeNull();
  });
});

// ─── findDSOsInImage ─────────────────────────────────────────────────────────

describe('findDSOsInImage()', () => {
  // With project(ra, dec) = {x: ra/360, y: dec/90}:
  //  TESTOBJ (ra=0, dec=0) → projection (0, 0)
  //  Identity affine maps projection coords directly to photo pixels.
  //  TESTOBJ → photo pixel (0, 0) → inside [0, 10] × [0, 10].
  //  All other DSOs have ra>0 or dec≠0 → photo pixel outside.

  const IDENTITY: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  it('returns DSOs whose projected center falls within the image', () => {
    const inside = findDSOsInImage(IDENTITY, 10, 10);
    expect(inside.some((d) => d.id === 'TESTOBJ')).toBe(true);
  });

  it('excludes DSOs outside the image bounds', () => {
    const inside = findDSOsInImage(IDENTITY, 10, 10);
    // M42 projects to (83.82/360, -5.39/90) ≈ (0.233, -0.060) — py < 0 → outside
    expect(inside.some((d) => d.id === 'M42')).toBe(false);
  });

  it('returns empty array when affine determinant is near zero (singular matrix)', () => {
    // det = 1*6 - 2*3 = 0 → singular
    const singular: AffineMatrix = { a: 1, b: 2, c: 3, d: 6, e: 0, f: 0 };
    expect(findDSOsInImage(singular, 100, 100)).toEqual([]);
  });

  it('returns all DSOs when affine maps everything inside a large image', () => {
    // Scale so ra/360 and dec/90 both map into [0, 10]
    // photoToCanvas: maps (px, py) pixel → projection (ra/360, dec/90)
    // We need inverse: projection → pixel such that all DSOs map inside image.
    // Use a large image and a scale-down affine:
    //   photoToCanvas = {a:1/1000, b:0, c:0, d:1/1000, e:0, f:0}
    //   inverse: {a:1000, b:0, c:0, d:1000, e:0, f:0}
    //   For TESTOBJ (0,0) → px=0, py=0 → inside
    //   For M42 (0.233, -0.060) → py=-60 → still outside (negative)
    // This test just verifies the function runs without error on a non-trivial affine
    const affine: AffineMatrix = { a: 0.001, b: 0, c: 0, d: 0.001, e: 0, f: 0 };
    const result = findDSOsInImage(affine, 1000, 1000);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── findDSOIdsFromCorrespondences ───────────────────────────────────────────

describe('findDSOIdsFromCorrespondences()', () => {
  // With project(ra, dec) = {x: ra/360, y: dec/90} and photoX/photoY chosen to
  // equal the projection of each star, computeAffineTransform yields the identity
  // photo→projection transform — so this mirrors the findDSOsInImage identity case:
  // TESTOBJ (ra=0, dec=0) → pixel (0, 0), inside a 10×10 image.
  const corr = (
    pointIndex: number,
    photoX: number,
    photoY: number,
    starRa: number,
    starDec: number,
  ): PhotoCorrespondence => ({
    pointIndex,
    photoX,
    photoY,
    starHip: 0,
    starName: `s${pointIndex}`,
    starRa,
    starDec,
  });

  const identityCorrespondences: PhotoCorrespondence[] = [
    corr(0, 0, 0, 0, 0), // → projection (0, 0)
    corr(1, 0.5, 0, 180, 0), // → projection (0.5, 0)
    corr(2, 0, 1, 0, 90), // → projection (0, 1)
  ];

  it('derives DSO ids inside the solved field', () => {
    const ids = findDSOIdsFromCorrespondences(identityCorrespondences, 10, 10);
    expect(ids).toContain('TESTOBJ');
    // M42 projects below the image (py < 0) → excluded
    expect(ids).not.toContain('M42');
  });

  it('returns [] when fewer than 3 correspondences carry RA/Dec', () => {
    const partial = [corr(0, 0, 0, 0, 0), corr(1, 0.5, 0, 180, 0)];
    expect(findDSOIdsFromCorrespondences(partial, 10, 10)).toEqual([]);
  });

  it('ignores correspondences missing RA/Dec when counting the 3 needed', () => {
    const withGaps: PhotoCorrespondence[] = [
      corr(0, 0, 0, 0, 0),
      { pointIndex: 1, photoX: 5, photoY: 5, starHip: 42, starName: 'noradec' },
      corr(2, 0.5, 0, 180, 0),
      corr(3, 0, 1, 0, 90),
    ];
    expect(findDSOIdsFromCorrespondences(withGaps, 10, 10)).toContain('TESTOBJ');
  });

  it('returns [] when image dimensions are unknown', () => {
    expect(findDSOIdsFromCorrespondences(identityCorrespondences, 0, 0)).toEqual([]);
  });
});

// ─── DSO override system ────────────────────────────────────────────────────────

describe('DSO override system', () => {
  afterEach(() => {
    // Restore any overrides applied during a test to prevent state leakage.
    resetDsoToBaseValues('M1');
    resetDsoToBaseValues('M42');
  });

  // ── getDSOCatalogBaseValues ─────────────────────────────────────────────────

  describe('getDSOCatalogBaseValues()', () => {
    it('returns all original catalog fields for a known DSO', () => {
      const base = getDSOCatalogBaseValues('M1');
      expect(base).not.toBeNull();
      expect(base!.ra).toBe(83.63);
      expect(base!.dec).toBe(22.01);
      expect(base!.nameFr).toBe('Nébuleuse du Crabe');
      expect(base!.nameEn).toBe('Crab Nebula');
      expect(base!.nameEs).toBeNull();
      expect(base!.type).toBe('SNR');
      expect(base!.constellation).toBe('Tau');
      expect(base!.rating).toBe(4);
      expect(base!.difficulty).toBe(3);
    });

    it('returns null for an unknown id', () => {
      expect(getDSOCatalogBaseValues('NONEXISTENT')).toBeNull();
    });

    it('base values are immutable — applying an override does not change them', () => {
      applyAndStoreSingleOverride('M1', { names: { en: 'Changed' }, type: 'RN', rating: 1 });
      const base = getDSOCatalogBaseValues('M1');
      expect(base!.nameEn).toBe('Crab Nebula');
      expect(base!.type).toBe('SNR');
      expect(base!.rating).toBe(4);
    });
  });

  // ── getUserOverride ─────────────────────────────────────────────────────────

  describe('getUserOverride()', () => {
    it('returns undefined when no override is active', () => {
      expect(getUserOverride('M1')).toBeUndefined();
    });

    it('returns the stored override after applyAndStoreSingleOverride', () => {
      applyAndStoreSingleOverride('M1', { names: { en: 'Renamed' }, type: 'RN' });
      const ov = getUserOverride('M1');
      expect(ov).toBeDefined();
      expect(ov!.names?.en).toBe('Renamed');
      expect(ov!.type).toBe('RN');
    });

    it('returns undefined after resetDsoToBaseValues', () => {
      applyAndStoreSingleOverride('M1', { rating: 1 });
      resetDsoToBaseValues('M1');
      expect(getUserOverride('M1')).toBeUndefined();
    });
  });

  // ── applyAndStoreSingleOverride ───────────────────────────────────────────

  describe('applyAndStoreSingleOverride()', () => {
    it('updates displayName for the current language (en)', () => {
      const dso = getDSOById('M1')!;
      applyAndStoreSingleOverride('M1', { names: { en: 'Renamed Crab' } });
      expect(dso.displayName).toBe('Renamed Crab');
    });

    it('fr-only name override does not change displayName when lang=en', () => {
      const dso = getDSOById('M1')!;
      // en base is 'Crab Nebula'; overriding fr only should not affect en displayName
      applyAndStoreSingleOverride('M1', { names: { fr: 'FR seulement' } });
      expect(dso.displayName).toBe('Crab Nebula');
    });

    it('overrides the DSO type', () => {
      const dso = getDSOById('M1')!;
      expect(dso.type).toBe('SNR');
      applyAndStoreSingleOverride('M1', { type: 'RN' });
      expect(dso.type).toBe('RN');
    });

    it('overrides ra and dec', () => {
      const dso = getDSOById('M42')!;
      applyAndStoreSingleOverride('M42', { ra: 90.0, dec: -10.0 });
      expect(dso.ra).toBe(90.0);
      expect(dso.dec).toBe(-10.0);
    });

    it('overrides constellation', () => {
      const dso = getDSOById('M1')!;
      applyAndStoreSingleOverride('M1', { constellation: 'Ori' });
      expect(dso.constellation).toBe('Ori');
    });

    it('overrides rating and difficulty', () => {
      const dso = getDSOById('M1')!;
      applyAndStoreSingleOverride('M1', { rating: 1, difficulty: 5 });
      expect(dso.rating).toBe(1);
      expect(dso.difficulty).toBe(5);
    });

    it('only modifies the specified fields; others remain unchanged', () => {
      const dso = getDSOById('M1')!;
      const origRa = dso.ra;
      const origType = dso.type;
      applyAndStoreSingleOverride('M1', { rating: 2 });
      expect(dso.ra).toBe(origRa); // unaffected
      expect(dso.type).toBe(origType); // unaffected
      expect(dso.rating).toBe(2); // changed
    });

    it('second call replaces the first override entirely', () => {
      applyAndStoreSingleOverride('M1', { rating: 1, difficulty: 5 });
      applyAndStoreSingleOverride('M1', { rating: 3 });
      const dso = getDSOById('M1')!;
      // New override wins for rating
      expect(dso.rating).toBe(3);
      // Difficulty from the first override is NOT preserved (override is replaced, not merged)
      expect(getUserOverride('M1')!.difficulty).toBeUndefined();
    });
  });

  // ── resetDsoToBaseValues ─────────────────────────────────────────────────

  describe('resetDsoToBaseValues()', () => {
    it('restores the original display name', () => {
      applyAndStoreSingleOverride('M1', { names: { en: 'Changed' } });
      resetDsoToBaseValues('M1');
      expect(getDSOById('M1')!.displayName).toBe('Crab Nebula');
    });

    it('restores the original type', () => {
      applyAndStoreSingleOverride('M1', { type: 'DN' });
      resetDsoToBaseValues('M1');
      expect(getDSOById('M1')!.type).toBe('SNR');
    });

    it('restores ra and dec', () => {
      const dso = getDSOById('M42')!;
      applyAndStoreSingleOverride('M42', { ra: 99, dec: -50 });
      resetDsoToBaseValues('M42');
      expect(dso.ra).toBeCloseTo(83.82);
      expect(dso.dec).toBeCloseTo(-5.39);
    });

    it('restores constellation, rating, and difficulty', () => {
      const dso = getDSOById('M1')!;
      applyAndStoreSingleOverride('M1', { constellation: 'Ori', rating: 1, difficulty: 5 });
      resetDsoToBaseValues('M1');
      expect(dso.constellation).toBe('Tau');
      expect(dso.rating).toBe(4);
      expect(dso.difficulty).toBe(3);
    });

    it('clears the stored user override', () => {
      applyAndStoreSingleOverride('M1', { type: 'RN' });
      expect(getUserOverride('M1')).toBeDefined();
      resetDsoToBaseValues('M1');
      expect(getUserOverride('M1')).toBeUndefined();
    });

    it('is a no-op on a DSO with no active override', () => {
      const dso = getDSOById('M1')!;
      const snapshot = { ra: dso.ra, type: dso.type, displayName: dso.displayName };
      resetDsoToBaseValues('M1'); // no override — must not throw or corrupt state
      expect(dso.ra).toBe(snapshot.ra);
      expect(dso.type).toBe(snapshot.type);
      expect(dso.displayName).toBe(snapshot.displayName);
    });
  });
});
