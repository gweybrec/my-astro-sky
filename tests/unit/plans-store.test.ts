import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// The store only imports these for its async CRUD; the pure getters under test
// never call them, but they must resolve as mocks so the module loads.
vi.mock('@myastrosky/app-state/api', () => ({
  getPlans: vi.fn().mockResolvedValue([]),
  updatePlanSortAPI: vi.fn().mockResolvedValue(undefined),
  renamePlanAPI: vi.fn().mockResolvedValue(undefined),
  updatePlanEntryPositionAPI: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/error-reporter', () => ({ reportUnknownRendererError: vi.fn() }));

import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import {
  getPlans,
  updatePlanSortAPI,
  renamePlanAPI,
  updatePlanEntryPositionAPI,
  type Plan,
  type PlanEntry,
} from '../../src/api';

function makePlan(id: string, setupId: string | null): Plan {
  return {
    id,
    name: `Plan ${id}`,
    position: 0,
    nightOf: null,
    setupId,
    lat: null,
    lon: null,
    sortBy: 'transit',
    entries: [],
    mosaics: [],
  };
}

function makeEntry(id: string, paDeg: number | null): PlanEntry {
  return {
    id,
    dsoId: 'NGC7000',
    position: 0,
    paDeg,
    ra: null,
    dec: null,
    notes: null,
    mosaicId: null,
    mosaicWDeg: null,
    mosaicHDeg: null,
    observationWindows: [],
  };
}

/** A plan holding one entry, as the backend returns it (a fresh object each call). */
function planWithEntry(paDeg: number | null): Plan {
  return { ...makePlan('p', null), entries: [makeEntry('e', paDeg)] };
}

describe('plans store · plansUsingSetup', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('returns only the plans that reference the given setup', () => {
    const store = usePlansStore();
    store.plans = [makePlan('a', 's1'), makePlan('b', 's2'), makePlan('c', 's1')];

    const using = store.plansUsingSetup('s1');
    expect(using.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('returns an empty array when no plan uses the setup', () => {
    const store = usePlansStore();
    store.plans = [makePlan('a', 's1'), makePlan('b', null)];

    expect(store.plansUsingSetup('s2')).toEqual([]);
  });
});

describe('plans store · setPlanSort', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(updatePlanSortAPI).mockClear();
  });

  it('updates the in-memory sort key immediately and persists it', () => {
    const store = usePlansStore();
    store.plans = [makePlan('a', 's1')];

    store.setPlanSort('a', 'window');

    expect(store.plans[0].sortBy).toBe('window');
    expect(updatePlanSortAPI).toHaveBeenCalledWith('a', 'window');
  });

  it('is a no-op on the cache for an unknown plan id but still calls the API', () => {
    const store = usePlansStore();
    store.plans = [makePlan('a', 's1')];

    store.setPlanSort('missing', 'altitude');

    expect(store.plans[0].sortBy).toBe('transit');
    expect(updatePlanSortAPI).toHaveBeenCalledWith('missing', 'altitude');
  });
});

describe('plans store · renamePlan', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(getPlans).mockClear();
    vi.mocked(renamePlanAPI).mockClear();
  });

  it('renames the cached plan in place, so a view holding it still sorts it', async () => {
    const store = usePlansStore();
    store.plans = [makePlan('a', null)];
    const held = store.plans[0];

    await store.renamePlan('a', 'Orion night');

    expect(renamePlanAPI).toHaveBeenCalledWith('a', 'Orion night');
    expect(getPlans).not.toHaveBeenCalled();
    expect(store.plans[0]).toBe(held);
    expect(held.name).toBe('Orion night');
    store.setPlanSort('a', 'name');
    expect(held.sortBy).toBe('name');
  });

  it('keeps the old name when the backend refuses the rename', async () => {
    vi.mocked(renamePlanAPI).mockRejectedValueOnce(new Error('offline'));
    const store = usePlansStore();
    store.plans = [makePlan('a', null)];

    await store.renamePlan('a', 'Orion night');

    expect(store.plans[0].name).toBe('Plan a');
  });
});

describe('plans store · load', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('replaces the cache with the latest server list', async () => {
    const store = usePlansStore();
    store.plans = [makePlan('old', null)];
    vi.mocked(getPlans).mockResolvedValueOnce([makePlan('a', null), makePlan('b', null)]);

    await store.load();

    expect(store.plans.map((p) => p.id)).toEqual(['a', 'b']);
    expect(store.loaded).toBe(true);
  });

  it('ignores a slow earlier load that resolves after a newer one', async () => {
    const store = usePlansStore();
    let resolveSlow: (v: Plan[]) => void = () => {};
    vi.mocked(getPlans)
      .mockReturnValueOnce(new Promise<Plan[]>((r) => (resolveSlow = r)))
      .mockResolvedValueOnce([makePlan('new', null)]);

    const slow = store.load();
    await store.load();
    resolveSlow([]);
    await slow;

    expect(store.plans.map((p) => p.id)).toEqual(['new']);
  });
});

describe('plans store · pending entry edits survive a refresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.mocked(updatePlanEntryPositionAPI).mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a refresh inside the debounce keeps the edit and writes it, not the old value', async () => {
    const store = usePlansStore();
    store.plans = [planWithEntry(0)];
    vi.mocked(getPlans).mockResolvedValueOnce([planWithEntry(0)]);

    store.setEntryPosition('p', 'e', { paDeg: 45 });
    await store.load();

    expect(store.plans[0].entries[0].paDeg).toBe(45);
    await vi.advanceTimersByTimeAsync(250);
    expect(updatePlanEntryPositionAPI).toHaveBeenCalledWith(
      'p',
      'e',
      expect.objectContaining({ paDeg: 45 }),
    );
  });

  it('a refresh fetched before the write confirmed still shows the edit', async () => {
    const store = usePlansStore();
    store.plans = [planWithEntry(0)];
    let resolveFetch: (v: Plan[]) => void = () => {};
    vi.mocked(getPlans).mockReturnValueOnce(new Promise<Plan[]>((r) => (resolveFetch = r)));

    store.setEntryPosition('p', 'e', { paDeg: 45 });
    const loading = store.load();
    await vi.advanceTimersByTimeAsync(250); // write sent and confirmed
    resolveFetch([planWithEntry(0)]); // list read before the write landed
    await loading;

    expect(store.plans[0].entries[0].paDeg).toBe(45);
  });

  it('a confirmed edit no longer overrides later backend values', async () => {
    const store = usePlansStore();
    store.plans = [planWithEntry(0)];
    store.setEntryPosition('p', 'e', { paDeg: 45 });
    await vi.advanceTimersByTimeAsync(250);

    vi.mocked(getPlans).mockResolvedValueOnce([planWithEntry(90)]);
    await store.load();

    expect(store.plans[0].entries[0].paDeg).toBe(90);
  });

  it('a move then a rotation in one debounce window write both fields', async () => {
    const store = usePlansStore();
    store.plans = [planWithEntry(0)];

    store.setEntryPosition('p', 'e', { ra: 10, dec: 20 });
    store.setEntryPA('p', 'e', 30);
    await vi.advanceTimersByTimeAsync(250);

    expect(updatePlanEntryPositionAPI).toHaveBeenCalledTimes(1);
    expect(updatePlanEntryPositionAPI).toHaveBeenCalledWith(
      'p',
      'e',
      expect.objectContaining({ paDeg: 30, ra: 10, dec: 20 }),
    );
  });

  it('a refresh inside the debounce keeps edited observation windows', async () => {
    const store = usePlansStore();
    store.plans = [planWithEntry(0)];
    vi.mocked(getPlans).mockResolvedValueOnce([planWithEntry(0)]);
    const windows = [{ startMs: 1, endMs: 2 }] as unknown as PlanEntry['observationWindows'];

    store.setEntryObservationWindows('p', 'e', windows);
    await store.load();

    expect(store.plans[0].entries[0].observationWindows).toEqual(windows);
    await vi.advanceTimersByTimeAsync(250);
    expect(updatePlanEntryPositionAPI).toHaveBeenCalledWith('p', 'e', {
      observationWindows: windows,
    });
  });
});
