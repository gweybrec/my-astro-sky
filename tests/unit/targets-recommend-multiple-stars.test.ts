import { describe, it, expect, vi } from 'vitest';
import type { AccessoryData, CameraData, TelescopeData } from '@myastrosky/core/gear-catalog';
import type { DSO } from '@myastrosky/core/types';
import { runTargetRecommendation } from '@myastrosky/core/targets/recommend';

// Two multiple stars high in a June night at 45° N (Albireo-like in Cygnus, one in Hercules).
vi.mock('@myastrosky/core/targets/multiple-stars', () => ({
  buildMultipleStarTargets: (): DSO[] =>
    [
      { id: 'star:1', ra: 292.7, dec: 27.96, constellation: 'CYG', rating: 5 },
      { id: 'star:2', ra: 258.7, dec: 14.39, constellation: 'HER', rating: 2 },
    ].map(
      (s) =>
        ({
          ...s,
          type: 'MS',
          majAxis: null,
          minAxis: null,
          pa: 0,
          mag: 3,
          displayName: s.id,
          catalogs: [s.id],
          emissionLines: null,
          difficulty: null,
          containerId: null,
          priority: 0,
        }) as DSO,
    ),
}));

vi.mock('@myastrosky/core/catalog/star-registry', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getConstellationInfos: () => [{ id: 'CYG' }, { id: 'HER' }, { id: 'LYR' }],
}));

const gear = {
  setups: [{ id: 's1', name: 'Setup 1', telescopeId: 't1', cameraId: 'c1', accessoryId: null }],
  telescopes: [
    {
      id: 't1',
      aperture_mm: 100,
      focal_length_mm: 500,
      f_ratio: 5,
      is_smart_telescope: false,
      integrated_camera_id: null,
    } as TelescopeData,
  ],
  cameras: [
    {
      id: 'c1',
      sensor_width_mm: 10,
      sensor_height_mm: 10,
      pixel_size_um: 5,
      resolution_x: 2000,
      resolution_y: 2000,
      color_type: 'OSC',
    } as CameraData,
  ],
  accessories: [] as AccessoryData[],
};

const found = (prefs: object) => {
  const result = runTargetRecommendation({
    prefs: {
      setupId: 's1',
      lat: 45,
      lon: 5,
      lastDateISO: null,
      enabledTypes: ['MS'],
      minAltDeg: 0,
      maxAltDeg: 90,
      ...prefs,
    },
    dateStr: '2026-06-12',
    gear,
    dsos: [],
  });
  return result.kind === 'ok' ? result.suggestions.map((s) => s.dso.id).sort() : [];
};

describe('runTargetRecommendation with multiple stars', () => {
  it('applies the rating, constellation and photographed filters to them', () => {
    expect(found({})).toEqual(['star:1', 'star:2']);
    expect(found({ enabledRatings: [1, 2, 3, 4] })).toEqual(['star:2']);
    expect(found({ enabledConstellations: ['HER'] })).toEqual(['star:2']);
    const result = runTargetRecommendation({
      prefs: {
        setupId: 's1',
        lat: 45,
        lon: 5,
        lastDateISO: null,
        enabledTypes: ['MS'],
        minAltDeg: 0,
        maxAltDeg: 90,
        excludePhotographed: true,
      },
      dateStr: '2026-06-12',
      gear,
      dsos: [],
      photographedIds: new Set(['star:1']),
    });
    expect(result.kind === 'ok' && result.suggestions.map((s) => s.dso.id)).toEqual(['star:2']);
  });
});
