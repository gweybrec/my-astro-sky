import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// The store only imports these for its async CRUD; the pure getters under test
// never call them, but they must resolve as mocks so the module loads.
vi.mock('../../src/api', () => ({
  getPlans: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/error-reporter', () => ({ reportUnknownRendererError: vi.fn() }));

import { usePlansStore } from '../../src/stores/plans';
import type { Plan } from '../../src/api';

function makePlan(id: string, setupId: string | null): Plan {
  return {
    id,
    name: `Plan ${id}`,
    position: 0,
    nightOf: null,
    setupId,
    lat: null,
    lon: null,
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
    expect(using.map(p => p.id)).toEqual(['a', 'c']);
  });

  it('returns an empty array when no plan uses the setup', () => {
    const store = usePlansStore();
    store.plans = [makePlan('a', 's1'), makePlan('b', null)];

    expect(store.plansUsingSetup('s2')).toEqual([]);
  });
});
