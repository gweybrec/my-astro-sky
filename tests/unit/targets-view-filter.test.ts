import { describe, it, expect, vi } from 'vitest';
import { filterTargetDSOs, sortCustomFirst } from '../../src/targets-view';
import type { DSOFilterOptions } from '../../src/targets-view';
import type { DSO } from '../../src/types';

vi.mock('../../src/i18n', () => ({ t: (key: string) => key }));

// targets-view imports api.ts (getPhotos/createCustomGear/deleteCustomGear) — stub it out
vi.mock('../../src/api', () => ({
  getPhotos: vi.fn(),
  createCustomGear: vi.fn(),
  deleteCustomGear: vi.fn(),
}));

// gear-catalog and star-catalog are used in TargetsView but not in filterTargetDSOs
vi.mock('../../src/gear-catalog', () => ({
  getTelescopes: vi.fn(),
  getCameras: vi.fn(),
  getAccessories: vi.fn(),
  buildGearPreset: vi.fn(),
  invalidateGearCache: vi.fn(),
  telescopeLabel: vi.fn(),
  cameraLabel: vi.fn(),
  accessoryLabel: vi.fn(),
}));
vi.mock('../../src/star-catalog', () => ({ getConstellationInfos: vi.fn() }));
vi.mock('../../src/target-recommender', () => ({ recommendTargets: vi.fn() }));
vi.mock('../../src/imaging-recipe', () => ({ recommendRecipe: vi.fn() }));
vi.mock('../../src/sky-map', () => ({}));
vi.mock('../../src/tooltip-utils', () => ({
  showKeyValueTooltip: vi.fn(),
  showTextTooltip: vi.fn(),
}));
vi.mock('../../src/chip-utils', () => ({ createTargetsChip: vi.fn(), createFilterBadge: vi.fn() }));

function makeDSO(overrides: Partial<DSO> & { id: string }): DSO {
  return {
    ra: 84,
    dec: 20,
    type: 'EN' as any,
    majAxis: 30,
    minAxis: 20,
    pa: 0,
    mag: 7,
    displayName: overrides.id,
    catalogs: [overrides.id],
    emissionLines: null,
    constellation: 'ORI',
    rating: 3,
    difficulty: 2,
    ...overrides,
  };
}

const baseOpts: DSOFilterOptions = {
  enabledTypes: new Set(['EN', 'Gx', 'OC', 'GC', 'RN', 'PN', 'SNR', 'DN', 'GxS', 'GxE', 'GxI']),
  enabledRatings: new Set([1, 2, 3, 4, 5]),
  enabledDifficulties: new Set([1, 2, 3, 4, 5]),
  enabledCatalogs: new Set(['M', 'NGC', 'IC', 'SH2', 'LBN', 'LDN', 'vdB', 'Abell', 'LPN']),
  photographedIds: null,
  enabledConstellations: null,
};

describe('filterTargetDSOs — photographedIds exclusion', () => {
  it('returns all DSOs when photographedIds is null', () => {
    const dsos = [makeDSO({ id: 'NGC1234' }), makeDSO({ id: 'M42' })];
    const result = filterTargetDSOs(dsos, { ...baseOpts, photographedIds: null });
    expect(result).toHaveLength(2);
  });

  it('excludes DSOs whose id is in photographedIds', () => {
    const dsos = [makeDSO({ id: 'NGC1234' }), makeDSO({ id: 'M42' }), makeDSO({ id: 'NGC7000' })];
    const photographedIds = new Set(['M42']);
    const result = filterTargetDSOs(dsos, { ...baseOpts, photographedIds });
    expect(result.map((d) => d.id)).toEqual(['NGC1234', 'NGC7000']);
  });

  it('excludes multiple photographed DSOs at once', () => {
    const dsos = [makeDSO({ id: 'M31' }), makeDSO({ id: 'M33' }), makeDSO({ id: 'NGC224' })];
    const photographedIds = new Set(['M31', 'M33']);
    const result = filterTargetDSOs(dsos, { ...baseOpts, photographedIds });
    expect(result.map((d) => d.id)).toEqual(['NGC224']);
  });

  it('returns empty array when all DSOs are photographed', () => {
    const dsos = [makeDSO({ id: 'M42' }), makeDSO({ id: 'M43' })];
    const photographedIds = new Set(['M42', 'M43']);
    const result = filterTargetDSOs(dsos, { ...baseOpts, photographedIds });
    expect(result).toHaveLength(0);
  });

  it('empty photographedIds set excludes nothing', () => {
    const dsos = [makeDSO({ id: 'NGC1977' }), makeDSO({ id: 'IC434' })];
    const result = filterTargetDSOs(dsos, { ...baseOpts, photographedIds: new Set() });
    expect(result).toHaveLength(2);
  });

  it('photographedIds with irrelevant IDs excludes nothing', () => {
    const dsos = [makeDSO({ id: 'NGC1977' })];
    const photographedIds = new Set(['M42', 'M43', 'NGC7000']);
    const result = filterTargetDSOs(dsos, { ...baseOpts, photographedIds });
    expect(result).toHaveLength(1);
  });
});

describe('filterTargetDSOs — type / rating / difficulty / catalog filters', () => {
  it('excludes DSOs of disabled types', () => {
    const dsos = [
      makeDSO({ id: 'NGC1234', type: 'Gx' as any }),
      makeDSO({ id: 'NGC5678', type: 'EN' as any }),
    ];
    const result = filterTargetDSOs(dsos, { ...baseOpts, enabledTypes: new Set(['EN']) });
    expect(result.map((d) => d.id)).toEqual(['NGC5678']);
  });

  it('excludes DSOs with disabled rating', () => {
    const dsos = [makeDSO({ id: 'NGC1', rating: 1 }), makeDSO({ id: 'NGC2', rating: 5 })];
    const result = filterTargetDSOs(dsos, { ...baseOpts, enabledRatings: new Set([5]) });
    expect(result.map((d) => d.id)).toEqual(['NGC2']);
  });

  it('does not exclude DSOs with null rating regardless of enabledRatings', () => {
    const dsos = [makeDSO({ id: 'NGC9', rating: null as any })];
    const result = filterTargetDSOs(dsos, { ...baseOpts, enabledRatings: new Set([5]) });
    expect(result).toHaveLength(1);
  });

  it('excludes DSOs from disabled catalog', () => {
    const dsos = [makeDSO({ id: 'M42' }), makeDSO({ id: 'NGC1976' })];
    const result = filterTargetDSOs(dsos, { ...baseOpts, enabledCatalogs: new Set(['NGC']) });
    expect(result.map((d) => d.id)).toEqual(['NGC1976']);
  });

  it('combines photographedIds exclusion with type filter', () => {
    const dsos = [
      makeDSO({ id: 'M42', type: 'EN' as any }),
      makeDSO({ id: 'M31', type: 'Gx' as any }),
      makeDSO({ id: 'NGC1977', type: 'EN' as any }),
    ];
    // Disable Gx type AND mark M42 as photographed
    const result = filterTargetDSOs(dsos, {
      ...baseOpts,
      enabledTypes: new Set(['EN']),
      photographedIds: new Set(['M42']),
    });
    expect(result.map((d) => d.id)).toEqual(['NGC1977']);
  });
});

describe('filterTargetDSOs — constellation filter', () => {
  it('passes all DSOs when enabledConstellations is null', () => {
    const dsos = [
      makeDSO({ id: 'M42', constellation: 'ORI' }),
      makeDSO({ id: 'M31', constellation: 'AND' }),
    ];
    const result = filterTargetDSOs(dsos, { ...baseOpts, enabledConstellations: null });
    expect(result).toHaveLength(2);
  });

  it('keeps DSOs in selected constellations', () => {
    const dsos = [
      makeDSO({ id: 'M42', constellation: 'ORI' }),
      makeDSO({ id: 'M31', constellation: 'AND' }),
    ];
    const result = filterTargetDSOs(dsos, { ...baseOpts, enabledConstellations: new Set(['ORI']) });
    expect(result.map((d) => d.id)).toEqual(['M42']);
  });

  it('excludes DSOs in non-selected constellations', () => {
    const dsos = [
      makeDSO({ id: 'M42', constellation: 'ORI' }),
      makeDSO({ id: 'NGC7000', constellation: 'CYG' }),
    ];
    const result = filterTargetDSOs(dsos, { ...baseOpts, enabledConstellations: new Set(['CYG']) });
    expect(result.map((d) => d.id)).toEqual(['NGC7000']);
  });

  it('always passes DSOs with null constellation regardless of filter', () => {
    const dsos = [makeDSO({ id: 'NGC9999', constellation: null as any })];
    const result = filterTargetDSOs(dsos, { ...baseOpts, enabledConstellations: new Set(['ORI']) });
    expect(result).toHaveLength(1);
  });

  it('returns empty when no constellation matches', () => {
    const dsos = [
      makeDSO({ id: 'M42', constellation: 'ORI' }),
      makeDSO({ id: 'M31', constellation: 'AND' }),
    ];
    const result = filterTargetDSOs(dsos, { ...baseOpts, enabledConstellations: new Set(['CYG']) });
    expect(result).toHaveLength(0);
  });
});

describe('sortCustomFirst', () => {
  it('puts custom gear (custom- prefix) before built-in', () => {
    const input = [
      { id: 'celestron-c8', label: 'C8' },
      { id: 'custom-myscope', label: 'MyScope' },
      { id: 'atik-314', label: 'Atik' },
    ];
    const result = sortCustomFirst(input);
    expect(result[0].id).toBe('custom-myscope');
    expect(result.slice(1).map((r) => r.id)).toEqual(['celestron-c8', 'atik-314']);
  });

  it('preserves relative order within each group', () => {
    const input = [
      { id: 'b-builtin', label: 'B' },
      { id: 'custom-z', label: 'Z' },
      { id: 'a-builtin', label: 'A' },
      { id: 'custom-a', label: 'A custom' },
    ];
    const result = sortCustomFirst(input);
    expect(result.map((r) => r.id)).toEqual(['custom-z', 'custom-a', 'b-builtin', 'a-builtin']);
  });

  it('returns all items when all are custom', () => {
    const input = [
      { id: 'custom-x', label: 'X' },
      { id: 'custom-y', label: 'Y' },
    ];
    expect(sortCustomFirst(input)).toEqual(input);
  });

  it('returns all items when none are custom', () => {
    const input = [
      { id: 'builtin-x', label: 'X' },
      { id: 'builtin-y', label: 'Y' },
    ];
    expect(sortCustomFirst(input)).toEqual(input);
  });

  it('handles empty array', () => {
    expect(sortCustomFirst([])).toEqual([]);
  });
});

// ─── Group 7: filterTargetDSOs — M13/M10/M12 real catalog properties ─────────

describe('filterTargetDSOs — M13/M10/M12 catalog and type filters', () => {
  // Real coordinates and properties of these DSOs
  const m13 = makeDSO({
    id: 'M13',
    type: 'GC' as any,
    constellation: 'Her',
    rating: 5,
    difficulty: 1,
    catalogs: ['M13', 'NGC6205'],
  });
  const m10 = makeDSO({
    id: 'M10',
    type: 'GC' as any,
    constellation: 'Oph',
    rating: 4,
    difficulty: 2,
    catalogs: ['M10', 'NGC6254'],
  });
  const m12 = makeDSO({
    id: 'M12',
    type: 'GC' as any,
    constellation: 'Oph',
    rating: 4,
    difficulty: 2,
    catalogs: ['M12', 'NGC6218'],
  });
  const m92 = makeDSO({
    id: 'M92',
    type: 'GC' as any,
    constellation: 'Her',
    rating: 4,
    difficulty: 1,
    catalogs: ['M92', 'NGC6341'],
  });

  it('all four pass with GC type + Messier catalog enabled', () => {
    const opts: DSOFilterOptions = {
      ...baseOpts,
      enabledTypes: new Set(['GC']),
      enabledCatalogs: new Set(['M']),
    };
    const result = filterTargetDSOs([m13, m10, m12, m92], opts);
    expect(result.map((d) => d.id)).toEqual(['M13', 'M10', 'M12', 'M92']);
  });

  it('M13 is excluded when GC type is disabled', () => {
    const opts: DSOFilterOptions = { ...baseOpts, enabledTypes: new Set(['OC']) };
    const result = filterTargetDSOs([m13], opts);
    expect(result).toHaveLength(0);
  });

  it('M10 is excluded when its constellation (Oph) is not enabled', () => {
    const opts: DSOFilterOptions = {
      ...baseOpts,
      enabledConstellations: new Set(['Her']),
    };
    const result = filterTargetDSOs([m10], opts);
    expect(result).toHaveLength(0);
  });

  it('M13 is excluded when Messier catalog is disabled', () => {
    const opts: DSOFilterOptions = {
      ...baseOpts,
      enabledCatalogs: new Set(['NGC']),
    };
    const result = filterTargetDSOs([m13], opts);
    expect(result).toHaveLength(0);
  });

  it('M13 is kept when its catalog (M) is enabled among others', () => {
    const opts: DSOFilterOptions = {
      ...baseOpts,
      enabledCatalogs: new Set(['M', 'NGC', 'IC']),
    };
    const result = filterTargetDSOs([m13], opts);
    expect(result).toHaveLength(1);
  });

  it('M13 is excluded when its rating (5) is not in enabledRatings', () => {
    const opts: DSOFilterOptions = {
      ...baseOpts,
      enabledRatings: new Set([1, 2, 3, 4]),
    };
    const result = filterTargetDSOs([m13], opts);
    expect(result).toHaveLength(0);
  });

  it('M10 is excluded when its difficulty (2) is not in enabledDifficulties', () => {
    const opts: DSOFilterOptions = {
      ...baseOpts,
      enabledDifficulties: new Set([1]),
    };
    const result = filterTargetDSOs([m10], opts);
    expect(result).toHaveLength(0);
  });

  it('M13 (Her) passes but M10 (Oph) is excluded when only Her constellation enabled', () => {
    const opts: DSOFilterOptions = {
      ...baseOpts,
      enabledConstellations: new Set(['Her']),
    };
    const result = filterTargetDSOs([m13, m10], opts);
    expect(result.map((d) => d.id)).toEqual(['M13']);
  });
});
