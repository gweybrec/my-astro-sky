import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DSO, DSOType, Star, ViewState } from '../../src/types';
import type { HorizonProfile } from '../../src/horizon-io';

/**
 * Cursor hit-testing against the star/DSO spatial indexes and the terrain summits.
 *
 * Both indexes are deliberately a *superset* of what is drawn — the precise "would this
 * render?" gate is separate — so these tests check the index build/cache rules and the
 * query geometry, not the density gate.
 */

let stars: Star[] = [];
let dsos: DSO[] = [];
/** Counts index rebuild passes, so cache-key behaviour is observable. */
let starScans = 0;
let dsoScans = 0;

vi.mock('../../src/star-catalog', () => ({
  getStars: () => {
    starScans++;
    return stars;
  },
}));

vi.mock('../../src/dso-catalog', () => ({
  getDSOs: () => {
    dsoScans++;
    return dsos;
  },
}));

import { SkyHitTest, isStarRendered, type DsoIndexFilters } from '../../src/sky-hit-test';
import {
  setCenterMode,
  setHemisphere,
  setProjectionMode,
  project,
  toCanvas,
} from '../../src/projection';
import { raDecFromAltAz } from '../../src/sky-geometry';
import { starAreaBudget } from '../../src/star-budget';

function makeStar(over: Partial<Star> & { hip: number }): Star {
  return { ra: 0, dec: 85, mag: 4, bv: 0.5, ...over };
}

function makeDSO(over: Partial<DSO> & { id: string }): DSO {
  return {
    ra: 0,
    dec: 85,
    type: 'GxS' as DSOType,
    majAxis: 10,
    minAxis: 10,
    pa: 0,
    mag: 8,
    displayName: over.id,
    catalogs: [over.id],
    emissionLines: null,
    constellation: 'UMi',
    rating: 3,
    difficulty: 2,
    containerId: null,
    priority: 0,
    catalog: 'NGC',
    ...over,
  };
}

function view(over: Partial<ViewState> = {}): ViewState {
  return { centerX: 0, centerY: 0, scale: 600, rotationDeg: 0, width: 1000, height: 800, ...over };
}

const FILTERS: DsoIndexFilters = {
  visibleTypes: new Set(['GxS', 'PN', 'EN']),
  visibleCatalogs: new Set(['NGC', 'M']),
  highlightedId: null,
};

/** Canvas position a sky object projects to under `v` (uses the real projection). */
function canvasOf(ra: number, dec: number, v: ViewState): { x: number; y: number } {
  const p = project(ra, dec);
  return toCanvas(p.x, p.y, v);
}

describe('SkyHitTest', () => {
  beforeEach(() => {
    setCenterMode('pole');
    setProjectionMode('stereo');
    setHemisphere('north');
    stars = [];
    dsos = [];
    starScans = 0;
    dsoScans = 0;
  });

  describe('index cache keys', () => {
    it('rebuilds the star index only when the magnitude limit changes', () => {
      stars = [makeStar({ hip: 1 })];
      const h = new SkyHitTest();
      h.findClosestStar(0, 0, view(), 6);
      expect(starScans).toBe(1);
      h.findClosestStar(10, 10, view(), 6); // same limit → reuse
      expect(starScans).toBe(1);
      h.findClosestStar(10, 10, view(), 7); // new limit → rebuild
      expect(starScans).toBe(2);
    });

    it('rebuilds after invalidate()', () => {
      stars = [makeStar({ hip: 1 })];
      const h = new SkyHitTest();
      h.findClosestStar(0, 0, view(), 6);
      h.invalidate();
      h.findClosestStar(0, 0, view(), 6);
      expect(starScans).toBe(2);
    });

    it('invalidateStarIndex does not force a DSO rebuild', () => {
      stars = [makeStar({ hip: 1 })];
      dsos = [makeDSO({ id: 'A' })];
      const h = new SkyHitTest();
      h.findClosestStar(0, 0, view(), 6);
      h.findClosestDSO(0, 0, view(), FILTERS);
      expect(dsoScans).toBe(1);
      h.invalidateStarIndex();
      h.findClosestStar(0, 0, view(), 6);
      h.findClosestDSO(0, 0, view(), FILTERS);
      expect(starScans).toBe(2);
      expect(dsoScans).toBe(1);
    });

    it('treats the unlimited-magnitude query as its own cache key', () => {
      dsos = [makeDSO({ id: 'A' })];
      const h = new SkyHitTest();
      const v = view();
      const geo = { corners: [], cx: 0, cy: 0, halfW: 1, halfH: 1 };
      h.findClosestDSO(0, 0, v, FILTERS); // maxMag null → key -999
      expect(dsoScans).toBe(1);
      h.findClosestDSO(5, 5, v, FILTERS); // same key → reuse
      expect(dsoScans).toBe(1);
      h.dsosInFrame(geo, v, 12, FILTERS); // key 12 → rebuild
      expect(dsoScans).toBe(2);
      h.findClosestDSO(0, 0, v, FILTERS); // back to -999 → rebuild
      expect(dsoScans).toBe(3);
    });
  });

  describe('findClosestStar', () => {
    it('finds a star under the cursor and ignores one far away', () => {
      const v = view();
      const target = makeStar({ hip: 1, ra: 0, dec: 85 });
      stars = [target, makeStar({ hip: 2, ra: 180, dec: 85 })];
      const c = canvasOf(0, 85, v);
      expect(new SkyHitTest().findClosestStar(c.x, c.y, v, 6)?.hip).toBe(1);
      expect(new SkyHitTest().findClosestStar(c.x + 200, c.y, v, 6)).toBeNull();
    });

    it('excludes stars fainter than the magnitude limit from the index', () => {
      const v = view();
      stars = [makeStar({ hip: 1, mag: 9 })];
      const c = canvasOf(0, 85, v);
      expect(new SkyHitTest().findClosestStar(c.x, c.y, v, 6)).toBeNull();
      expect(new SkyHitTest().findClosestStar(c.x, c.y, v, 10)?.hip).toBe(1);
    });
  });

  describe('findClosestDSO', () => {
    it('hits a large DSO from inside its ellipse, well away from its centre', () => {
      // The generous 200 px collect radius exists for exactly this: zoomed in, a 90′
      // object renders ~130 px across, so the cursor can sit inside the drawn shape yet
      // far outside the tight 20 px nearest-centre fallback.
      const v = view({ scale: 20000 });
      dsos = [makeDSO({ id: 'big', majAxis: 90 })];
      const c = canvasOf(0, 85, v);
      const h = new SkyHitTest();
      expect(h.findClosestDSO(c.x, c.y, v, FILTERS)?.id).toBe('big');
      expect(h.findClosestDSO(c.x + 100, c.y, v, FILTERS)?.id).toBe('big');
      // Past the rendered ellipse, and past the 20 px fallback: nothing.
      expect(h.findClosestDSO(c.x + 160, c.y, v, FILTERS)).toBeNull();
    });

    it('indexes every catalog DSO regardless of magnitude (superset of what is drawn)', () => {
      const v = view();
      dsos = [makeDSO({ id: 'faint', mag: 18 }), makeDSO({ id: 'nomag', mag: null })];
      const c = canvasOf(0, 85, v);
      expect(new SkyHitTest().findClosestDSO(c.x, c.y, v, FILTERS)).not.toBeNull();
    });

    it('respects the type and catalog filters', () => {
      const v = view();
      dsos = [makeDSO({ id: 'hidden', type: 'DN' as DSOType })];
      const c = canvasOf(0, 85, v);
      expect(new SkyHitTest().findClosestDSO(c.x, c.y, v, FILTERS)).toBeNull();

      dsos = [makeDSO({ id: 'hidden', catalog: 'LBN' })];
      expect(new SkyHitTest().findClosestDSO(c.x, c.y, v, FILTERS)).toBeNull();
    });

    it('indexes the highlighted DSO even when its type is filtered out', () => {
      const v = view();
      dsos = [makeDSO({ id: 'H', type: 'DN' as DSOType, catalog: 'LBN' })];
      const c = canvasOf(0, 85, v);
      const hit = new SkyHitTest().findClosestDSO(c.x, c.y, v, { ...FILTERS, highlightedId: 'H' });
      expect(hit?.id).toBe('H');
    });
  });

  describe('dsosInFrame', () => {
    it('returns only centres inside the polygon, nearest to the frame centre first', () => {
      const v = view({ scale: 600 });
      // 'near'/'far' sit just off the pole at increasing RA so they spread across the
      // frame; 'outside' is at a far lower dec, well beyond it. (RA alone is not enough
      // to separate them near the pole — every RA converges there.)
      dsos = [
        makeDSO({ id: 'far', ra: 6, dec: 88 }),
        makeDSO({ id: 'near', ra: 2, dec: 88 }),
        makeDSO({ id: 'outside', ra: 0, dec: 40 }),
      ];
      const centre = canvasOf(0, 88, v);
      const half = 120;
      const geo = {
        corners: [
          { x: centre.x - half, y: centre.y - half },
          { x: centre.x + half, y: centre.y - half },
          { x: centre.x + half, y: centre.y + half },
          { x: centre.x - half, y: centre.y + half },
        ],
        cx: centre.x,
        cy: centre.y,
        halfW: half,
        halfH: half,
      };
      const got = new SkyHitTest().dsosInFrame(geo, v, 12, FILTERS).map((d) => d.id);
      expect(got).not.toContain('outside');
      // 'near' is closer to the frame centre than 'far', so it sorts first.
      expect(got.indexOf('near')).toBeLessThan(got.indexOf('far'));
    });

    it('returns nothing for a frame over empty sky', () => {
      const v = view();
      dsos = [makeDSO({ id: 'A', ra: 180, dec: 88 })];
      const geo = {
        corners: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        cx: 10,
        cy: 10,
        halfW: 10,
        halfH: 10,
      };
      expect(new SkyHitTest().dsosInFrame(geo, v, 12, FILTERS)).toEqual([]);
    });
  });

  describe('findClosestSummit', () => {
    const profile = (summits: { azDeg: number; altDeg: number; name?: string }[]) =>
      ({ summits, azStepDeg: 1, altDeg: [] }) as unknown as HorizonProfile;

    it('returns null when the profile is null (horizon hidden)', () => {
      const h = new SkyHitTest();
      expect(h.findClosestSummit(500, 400, view(), null, { lstH: 0, latDeg: 45 })).toBeNull();
    });

    it('returns null when there is no observer (horizon params null)', () => {
      const h = new SkyHitTest();
      expect(
        h.findClosestSummit(500, 400, view(), profile([{ azDeg: 0, altDeg: 5 }]), null),
      ).toBeNull();
    });

    it('returns null when the profile carries no summits', () => {
      const h = new SkyHitTest();
      expect(
        h.findClosestSummit(500, 400, view(), profile([]), { lstH: 0, latDeg: 45 }),
      ).toBeNull();
    });

    it('finds a summit at its projected position and misses one 100 px away', () => {
      const v = view();
      const hp = { lstH: 0, latDeg: 45 };
      const summits = [{ azDeg: 180, altDeg: 20, name: 'Peak' }];
      // Project the summit exactly the way the hit-test does, then aim at it.
      const { raDeg, decDeg } = raDecFromAltAz(20, 180, hp.lstH, hp.latDeg);
      const c = canvasOf(raDeg, decDeg, v);
      const h = new SkyHitTest();

      const hit = h.findClosestSummit(c.x, c.y, v, profile(summits), hp);
      expect(hit?.summit.name).toBe('Peak');
      expect(hit!.dist).toBeLessThanOrEqual(12 / v.scale);

      expect(h.findClosestSummit(c.x + 100, c.y, v, profile(summits), hp)).toBeNull();
    });

    it('picks the nearer of two summits', () => {
      const v = view();
      const hp = { lstH: 0, latDeg: 45 };
      const summits = [
        { azDeg: 180, altDeg: 20, name: 'Near' },
        { azDeg: 180, altDeg: 21, name: 'Far' },
      ];
      const { raDeg, decDeg } = raDecFromAltAz(20, 180, hp.lstH, hp.latDeg);
      const c = canvasOf(raDeg, decDeg, v);
      expect(
        new SkyHitTest().findClosestSummit(c.x, c.y, v, profile(summits), hp)?.summit.name,
      ).toBe('Near');
    });
  });
});

describe('isStarRendered', () => {
  const budget = () =>
    starAreaBudget(
      view(),
      45,
      2000,
      Array.from({ length: 20000 }, (_, i) => 15 * Math.cbrt(i / 20000)),
    );

  beforeEach(() => {
    setCenterMode('pole');
    setProjectionMode('stereo');
    setHemisphere('north');
  });

  it('accepts a bright star inside the viewport', () => {
    expect(isStarRendered(makeStar({ hip: 1, mag: 1, dec: 85 }), view(), budget(), null)).toBe(
      true,
    );
  });

  it('rejects a star fainter than the per-position limit', () => {
    expect(isStarRendered(makeStar({ hip: 1, mag: 14, dec: 85 }), view(), budget(), null)).toBe(
      false,
    );
  });

  it('accepts the highlighted star however faint', () => {
    const faint = makeStar({ hip: 42, mag: 14, dec: 85 });
    expect(isStarRendered(faint, view(), budget(), 42)).toBe(true);
  });

  it('rejects a bright star projected off the canvas', () => {
    // dec 0 lands far outside the viewport at this zoom.
    expect(isStarRendered(makeStar({ hip: 1, mag: 1, dec: 0 }), view(), budget(), null)).toBe(
      false,
    );
  });

  it('rejects the highlighted star when it is off the canvas', () => {
    expect(isStarRendered(makeStar({ hip: 42, mag: 1, dec: 0 }), view(), budget(), 42)).toBe(false);
  });
});
