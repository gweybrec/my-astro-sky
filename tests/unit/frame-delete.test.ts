import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the most recent toast so tests can trigger its undo action.
let lastToast: any = null;
vi.mock('../../src/toast', () => ({
  showToast: vi.fn((opts: any) => { lastToast = opts; return () => {}; }),
}));
vi.mock('../../src/i18n', () => ({ t: (k: string) => k }));
vi.mock('../../src/pinia-instance', () => ({ pinia: {} }));

const fakeFov = {
  adhoc: [] as any[],
  removeFrame: vi.fn((id: string) => { fakeFov.adhoc = fakeFov.adhoc.filter(f => f.id !== id); }),
  restoreAdhocFrame: vi.fn((frame: any) => { fakeFov.adhoc.push(frame); }),
  deletePlanFrame: vi.fn().mockResolvedValue(undefined),
};
const fakePlans = {
  plans: [] as any[],
  addEntry: vi.fn(async (planId: string, dsoId: string) => {
    fakePlans.plans.find(p => p.id === planId)?.entries.push({ id: 'e-new', dsoId });
  }),
  addCustomEntry: vi.fn(async () => 'e-custom'),
  setEntryPosition: vi.fn(),
};

vi.mock('../../src/stores/fov-frames', () => ({ useFovFramesStore: () => fakeFov }));
vi.mock('../../src/stores/plans', () => ({ usePlansStore: () => fakePlans }));

import { deleteFrameWithUndo } from '../../src/frame-delete';

const flush = () => new Promise(r => setTimeout(r, 0));

describe('deleteFrameWithUndo', () => {
  beforeEach(() => {
    lastToast = null;
    fakeFov.adhoc = [];
    fakePlans.plans = [];
    vi.clearAllMocks();
  });

  it('removes a free frame immediately and restores it on undo', async () => {
    const frame = { id: 'a1', setupId: 's1', anchor: { kind: 'sky', ra: 1, dec: 2, dsoId: null }, rotationDeg: 0 };
    fakeFov.adhoc = [frame];
    const onRemoved = vi.fn();
    const onRestored = vi.fn();

    deleteFrameWithUndo({ kind: 'adhoc', id: 'a1', name: 'Frame' }, { onRemoved, onRestored });

    expect(fakeFov.removeFrame).toHaveBeenCalledWith('a1');
    expect(onRemoved).toHaveBeenCalled();
    expect(lastToast.type).toBe('undo');
    expect(lastToast.actionLabel).toBe('fovOverlay.undo');

    // Undo re-inserts the snapshotted frame.
    lastToast.onAction();
    await flush();
    expect(fakeFov.restoreAdhocFrame).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
    expect(onRestored).toHaveBeenCalled();
  });

  it('deletes a plan (DSO) frame and re-creates it with restored framing on undo', async () => {
    fakePlans.plans = [{ id: 'p1', entries: [{ id: 'e1', dsoId: 'M42', ra: null, dec: null, paDeg: 142, mosaicWDeg: null, mosaicHDeg: null }] }];
    const onRestored = vi.fn();

    deleteFrameWithUndo({ kind: 'plan', planId: 'p1', entryId: 'e1', name: 'M42' }, { onRestored });
    expect(fakeFov.deletePlanFrame).toHaveBeenCalledWith('plan:p1:e1');

    // Simulate the store dropping the entry after deletePlanFrame.
    fakePlans.plans[0].entries = [];

    lastToast.onAction();
    await flush();
    expect(fakePlans.addEntry).toHaveBeenCalledWith('p1', 'M42');
    expect(fakePlans.setEntryPosition).toHaveBeenCalledWith('p1', 'e-new', expect.objectContaining({ paDeg: 142 }));
    expect(onRestored).toHaveBeenCalled();
  });

  it('re-creates a custom-location frame via addCustomEntry on undo', async () => {
    fakePlans.plans = [{ id: 'p1', entries: [{ id: 'e1', dsoId: null, ra: 50, dec: 10, paDeg: null, mosaicWDeg: null, mosaicHDeg: null }] }];

    deleteFrameWithUndo({ kind: 'plan', planId: 'p1', entryId: 'e1', name: 'Custom' });
    lastToast.onAction();
    await flush();
    expect(fakePlans.addCustomEntry).toHaveBeenCalledWith('p1', 50, 10);
    expect(fakePlans.setEntryPosition).toHaveBeenCalledWith('p1', 'e-custom', expect.objectContaining({ ra: 50, dec: 10 }));
  });
});
