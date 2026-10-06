import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// The store only imports these for its async CRUD; the pure getters under test
// never call them, but they must resolve as mocks so the module loads.
vi.mock('@myastrosky/app-state/api', () => ({
  getPlans: vi.fn().mockResolvedValue([]),
  updatePlanSortAPI: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/error-reporter', () => ({ reportUnknownRendererError: vi.fn() }));

import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { getPlans, updatePlanSortAPI, type Plan } from '../../src/api';

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
