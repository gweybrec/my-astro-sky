import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DSO, DSOType, ViewState } from '../../src/types';

/**
 * DSO render selection: the single source of truth for which DSOs are drawn in a
 * frame, shared by the shape pass, the label pass and hover/click hit-test gating.
 *
 * The catalog is mocked so each test controls exactly which objects exist; the
 * projection module is real, so the viewport cull and the area-weighted rank are
 * exercised against the actual stereographic maths.
 */

/** Catalog contents for the current test — swapped per test via `setCatalog`. */
let catalog: DSO[] = [];

vi.mock('../../src/dso-catalog', () => ({
  getDSOs: () => catalog,
  getDSOById: (id: string) => catalog.find((d) => d.id === id) ?? null,
  // Rank by array order: index 0 is the "best" object. Keeps the effective-priority
  // maths predictable without depending on the real rating heuristic.
  getDSOImportanceRank: () => new Map(catalog.map((d, i) => [d.id, i])),
}));

import { DsoRenderSelection } from '../../src/dso-render-select';
import { setCenterMode, setHemisphere, setProjectionMode } from '../../src/projection';

function makeDSO(over: Partial<DSO> & { id: string }): DSO {
  return {
    ra: 0,
    dec: 80,
    type: 'GxS' as DSOType,
    majAxis: 10,
    minAxis: 10,
    pa: 0,
    mag: 9,
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

function setCatalog(dsos: DSO[]): void {
  catalog = dsos;
}

function view(over: Partial<ViewState> = {}): ViewState {
  return {
    centerX: 0,
    centerY: 0,
    scale: 600,
    rotationDeg: 0,
    width: 1000,
    height: 800,
    ...over,
  };
}

const ALL_TYPES = new Set(['GxS', 'GxE', 'Gx', 'OC', 'GC', 'EN', 'RN', 'PN', 'SNR', 'DN', '?']);
const ALL_CATALOGS = new Set(['M', 'NGC', 'IC', 'SH2']);

function options(over: Partial<Parameters<DsoRenderSelection['select']>[0]> = {}) {
  return {
    view: view(),
    borderLatDeg: 45,
    hemisphere: 'north' as const,
    localSkyMode: false,
    fisheyeMode: false,
    visibleTypes: ALL_TYPES,
    visibleCatalogs: ALL_CATALOGS,
    highlightedId: null,
    horizon: null,
    priorityThreshold: 1e9, // effectively "no density limit" unless a test lowers it
    ...over,
  };
}

/** A fresh instance per test — the position index is keyed by projection generation. */
function fresh(): DsoRenderSelection {
  const s = new DsoRenderSelection();
  // Force an index rebuild for this test's catalog: the generation is global and
  // unchanged between tests, so toggle the hemisphere to bump it.
  setHemisphere('south');
  setHemisphere('north');
  return s;
}

const ids = (dsos: DSO[]) => dsos.map((d) => d.id).sort();

describe('DsoRenderSelection', () => {
  beforeEach(() => {
    setCenterMode('pole');
    setProjectionMode('stereo');
    setHemisphere('north');
    catalog = [];
  });

  describe('type and catalog filters', () => {
    it('drops DSOs whose type is not visible', () => {
      setCatalog([makeDSO({ id: 'A', type: 'GxS' as DSOType }), makeDSO({ id: 'B', type: 'PN' })]);
      const sel = fresh().select(options({ visibleTypes: new Set(['GxS']) }));
      expect(ids(sel)).toEqual(['A']);
    });

    it('drops DSOs whose catalog is not visible', () => {
      setCatalog([makeDSO({ id: 'A', catalog: 'NGC' }), makeDSO({ id: 'B', catalog: 'SH2' })]);
      const sel = fresh().select(options({ visibleCatalogs: new Set(['NGC']) }));
      expect(ids(sel)).toEqual(['A']);
    });

    it('keeps a DSO with no catalog prefix regardless of the catalog filter', () => {
      setCatalog([makeDSO({ id: 'A', catalog: null })]);
      const sel = fresh().select(options({ visibleCatalogs: new Set(['M']) }));
      expect(ids(sel)).toEqual(['A']);
    });
  });

  describe('highlighted DSO', () => {
    it('bypasses the type and catalog filters', () => {
      setCatalog([makeDSO({ id: 'A', type: 'PN', catalog: 'SH2' })]);
      const sel = fresh().select(
        options({
          visibleTypes: new Set(['GxS']),
          visibleCatalogs: new Set(['M']),
          highlightedId: 'A',
        }),
      );
      expect(ids(sel)).toEqual(['A']);
    });

    it('bypasses the density threshold', () => {
      setCatalog([makeDSO({ id: 'A' }), makeDSO({ id: 'B' })]);
      // A threshold of 0 keeps nothing on priority alone.
      const sel = fresh().select(options({ priorityThreshold: 0, highlightedId: 'B' }));
      expect(ids(sel)).toEqual(['B']);
    });

    it('bypasses the dec pre-filter', () => {
      // Panned off the origin so the query cap is wider than the dec cut and the
      // filter is what would drop this object (see the dec pre-filter block below).
      setCatalog([makeDSO({ id: 'A', dec: -48 })]);
      const panned = options({ view: view({ centerX: 3, scale: 100 }), borderLatDeg: 45 });
      expect(fresh().select(panned)).toEqual([]);
      expect(ids(fresh().select({ ...panned, highlightedId: 'A' }))).toEqual(['A']);
    });

    it('does NOT rescue an object outside the spatial query cap', () => {
      // Highlighting skips the type/catalog/dec/container filters, but those run *after*
      // the query — an object beyond capR is never collected, so it cannot be rescued.
      // Masked in practice: such objects also sit outside the border-circle canvas clip.
      setCatalog([makeDSO({ id: 'A', dec: -80 })]);
      const sel = fresh().select(options({ view: view({ scale: 30 }), highlightedId: 'A' }));
      expect(sel).toEqual([]);
    });

    it('does NOT bypass the viewport bbox cull', () => {
      // The on-canvas bbox test runs unconditionally, highlighted or not.
      setCatalog([makeDSO({ id: 'A', dec: 20 })]);
      const sel = fresh().select(options({ view: view({ scale: 4000 }), highlightedId: 'A' }));
      expect(sel).toEqual([]);
    });
  });

  describe('dec pre-filter', () => {
    it('drops far-southern objects in the northern hemisphere', () => {
      setCatalog([makeDSO({ id: 'north', dec: 80 }), makeDSO({ id: 'south', dec: -80 })]);
      const sel = fresh().select(options({ hemisphere: 'north', borderLatDeg: 45 }));
      expect(ids(sel)).toEqual(['north']);
    });

    it('cuts at borderLatDeg + 2°, not at borderLatDeg', () => {
      // Panned off the origin so both candidates are inside the spatial query cap and
      // the dec filter is the only thing separating them. (Centred on the origin the
      // cap radius equals borderRadiusPU(borderLat + 2) exactly — the same boundary the
      // dec filter enforces — so the two coincide and the filter looks like a no-op.)
      setCatalog([makeDSO({ id: 'inside', dec: -46 }), makeDSO({ id: 'outside', dec: -48 })]);
      const sel = fresh().select(
        options({
          hemisphere: 'north',
          borderLatDeg: 45,
          view: view({ centerX: 3, scale: 100 }),
        }),
      );
      expect(ids(sel)).toEqual(['inside']);
    });

    it('mirrors the cut in the southern hemisphere', () => {
      setHemisphere('south');
      setCatalog([makeDSO({ id: 'north', dec: 80 }), makeDSO({ id: 'south', dec: -80 })]);
      const s = new DsoRenderSelection();
      const sel = s.select(options({ hemisphere: 'south', borderLatDeg: 45 }));
      expect(ids(sel)).toEqual(['south']);
    });

    it('is skipped in fisheye mode (the far hemisphere is clipped by the projection)', () => {
      setProjectionMode('fisheye');
      setCatalog([makeDSO({ id: 'A', dec: 80 })]);
      const s = new DsoRenderSelection();
      const sel = s.select(options({ fisheyeMode: true }));
      expect(ids(sel)).toEqual(['A']);
    });
  });

  describe('container gate', () => {
    it('hides an inner object while its container renders small', () => {
      setCatalog([
        makeDSO({ id: 'container', majAxis: 2 }), // tiny on screen at this zoom
        makeDSO({ id: 'inner', containerId: 'container' }),
      ]);
      const sel = fresh().select(options({ view: view({ scale: 100 }) }));
      expect(ids(sel)).toEqual(['container']);
    });

    it('reveals the inner object once the container is large enough on screen', () => {
      setCatalog([
        makeDSO({ id: 'container', majAxis: 120 }),
        makeDSO({ id: 'inner', containerId: 'container' }),
      ]);
      const sel = fresh().select(options({ view: view({ scale: 4000 }) }));
      expect(ids(sel)).toEqual(['container', 'inner']);
    });

    it('does not gate an inner object whose container is the highlighted one', () => {
      setCatalog([
        makeDSO({ id: 'container', majAxis: 2 }),
        makeDSO({ id: 'inner', containerId: 'container' }),
      ]);
      const sel = fresh().select(
        options({ view: view({ scale: 100 }), highlightedId: 'container' }),
      );
      expect(ids(sel)).toEqual(['container', 'inner']);
    });

    it('ignores a containerId that is not in the catalog', () => {
      setCatalog([makeDSO({ id: 'inner', containerId: 'missing' })]);
      const sel = fresh().select(options());
      expect(ids(sel)).toEqual(['inner']);
    });
  });

  describe('viewport cull', () => {
    it('drops an object projected well outside the canvas', () => {
      // dec 80 projects near the pole (map centre); dec 0 lands far out at this zoom.
      setCatalog([makeDSO({ id: 'centre', dec: 89 }), makeDSO({ id: 'faraway', dec: 0 })]);
      const sel = fresh().select(options({ view: view({ scale: 4000 }) }));
      expect(ids(sel)).toEqual(['centre']);
    });

    it('keeps a giant object whose centre is off-screen but whose body overlaps it', () => {
      // Giant bodies bypass the position index entirely and are always considered;
      // the bbox test then admits this one because its radius reaches the canvas.
      setCatalog([makeDSO({ id: 'giant', dec: 85, majAxis: 600 })]);
      const sel = fresh().select(options({ view: view({ scale: 1200 }) }));
      expect(ids(sel)).toEqual(['giant']);
    });
  });

  describe('density threshold', () => {
    it('keeps only candidates below the effective priority cutoff', () => {
      // Importance rank follows array order, so 'best' outranks 'worst'.
      setCatalog([makeDSO({ id: 'best', dec: 89 }), makeDSO({ id: 'worst', dec: 89 })]);
      const all = fresh().select(options({ priorityThreshold: 1e9 }));
      expect(ids(all)).toEqual(['best', 'worst']);

      const some = fresh().select(options({ priorityThreshold: 1 }));
      expect(ids(some)).toEqual(['best']);
    });

    it('keeps nothing at a zero threshold', () => {
      setCatalog([makeDSO({ id: 'A', dec: 89 })]);
      expect(fresh().select(options({ priorityThreshold: 0 }))).toEqual([]);
    });
  });

  describe('per-frame cache', () => {
    it('reuses the selection until invalidate()', () => {
      setCatalog([makeDSO({ id: 'A', dec: 89 })]);
      const s = fresh();
      const first = s.select(options());
      // A different options object that would select nothing is ignored while cached.
      const second = s.select(options({ priorityThreshold: 0 }));
      expect(second).toBe(first);

      s.invalidate();
      expect(s.select(options({ priorityThreshold: 0 }))).toEqual([]);
    });

    it('has() answers for the cached selection and agrees with select()', () => {
      setCatalog([makeDSO({ id: 'kept', dec: 89 }), makeDSO({ id: 'dropped', dec: 89 })]);
      const s = fresh();
      const sel = s.select(options({ priorityThreshold: 1 }));
      expect(ids(sel)).toEqual(['kept']);
      expect(s.has('kept')).toBe(true);
      expect(s.has('dropped')).toBe(false);
    });

    it('has() is false for everything before any select()', () => {
      setCatalog([makeDSO({ id: 'A', dec: 89 })]);
      expect(new DsoRenderSelection().has('A')).toBe(false);
    });

    it('has() is false again after invalidate()', () => {
      setCatalog([makeDSO({ id: 'A', dec: 89 })]);
      const s = fresh();
      s.select(options());
      expect(s.has('A')).toBe(true);
      s.invalidate();
      expect(s.has('A')).toBe(false);
    });
  });
});
