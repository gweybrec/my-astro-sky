import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlateSolveResult } from '@myastrosky/core/types';

const api = vi.hoisted(() => ({ solveWCS: vi.fn(), getGearSetups: vi.fn() }));
const confirmWcsWarnings = vi.hoisted(() => vi.fn());
const loadSetupOptics = vi.hoisted(() => vi.fn());

vi.mock('@myastrosky/app-state/api', () => api);
vi.mock('../../src/wcs-dialogs', () => ({ confirmWcsWarnings }));
vi.mock('@myastrosky/core/gear-catalog', () => ({ loadSetupOptics }));

// The flow is shared (app-state) and gets the app's dialog as `confirm`; the desktop's module passes its own.
const shared = await import('@myastrosky/app-state/wcs-load-flow');
const desktop = await import('../../src/wcs-load-flow');
const { suggestedSetupFor, isSolved } = shared;
const readWcsFileForPhoto = (f: File, tgt: typeof target, checks = true) =>
  shared.readWcsFileForPhoto(f, tgt, confirmWcsWarnings, checks);

const S30 = {
  setupId: 's30',
  nativeFocalMm: 150,
  effectiveFocalMm: 150,
  pixelSizeUm: 2.9,
  telescopeName: 'ZWO Seestar S30',
  cameraName: 'ZWO Seestar S30',
  setupName: 'Seestar',
};

const target = {
  width: 1080,
  height: 1920,
  dsoIds: [],
  skyModel: null,
  gearSetupId: null as string | null,
};
const file = new File(['x'], 'M42.fit');

const unsolved = (facts: PlateSolveResult['facts']): PlateSolveResult => ({
  success: false,
  code: 'NO_WCS_DATA',
  facts,
  fitsHeaders: [{ key: 'SIMPLE', value: 'T' }],
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getGearSetups.mockResolvedValue([{ id: 's30', name: 'Seestar' }]);
  loadSetupOptics.mockResolvedValue([S30]);
  confirmWcsWarnings.mockResolvedValue(true);
});

describe('readWcsFileForPhoto', () => {
  it('explains a file that has neither a solution nor a header', async () => {
    api.solveWCS.mockResolvedValue({ success: false, code: 'NO_WCS_DATA' });
    const outcome = await readWcsFileForPhoto(file, target);
    expect(outcome.kind).toBe('error');
  });

  it('reads a file without a solution, and suggests the setup its header points to', async () => {
    api.solveWCS.mockResolvedValue(
      unsolved({ telescope: 'S30_0289c34b', instrument: 'Seestar S30', focalLengthMm: 150 }),
    );
    const outcome = await readWcsFileForPhoto(file, target);
    expect(outcome).toMatchObject({
      kind: 'read',
      solved: false,
      suggestedSetup: { id: 's30', name: 'Seestar' },
    });
    expect(api.solveWCS).toHaveBeenCalledWith(file, 1080, 1920);
    expect(confirmWcsWarnings).not.toHaveBeenCalled();
  });

  it("compares the header with the photo's setup and stops when the user cancels", async () => {
    api.solveWCS.mockResolvedValue(unsolved({ focalLengthMm: 540 }));
    confirmWcsWarnings.mockResolvedValue(false);
    const outcome = await readWcsFileForPhoto(file, { ...target, gearSetupId: 's30' });
    expect(confirmWcsWarnings).toHaveBeenCalledWith('M42.fit', [expect.stringContaining('540')]);
    expect(outcome).toEqual({ kind: 'cancelled' });
  });

  it('skips the comparison when asked to', async () => {
    api.solveWCS.mockResolvedValue(unsolved({ focalLengthMm: 540 }));
    const outcome = await readWcsFileForPhoto(file, { ...target, gearSetupId: 's30' }, false);
    expect(outcome.kind).toBe('read');
    expect(confirmWcsWarnings).not.toHaveBeenCalled();
  });

  it('goes on without the gear checks when the setups cannot be read', async () => {
    api.getGearSetups.mockRejectedValue(new Error('offline'));
    api.solveWCS.mockResolvedValue(unsolved({ focalLengthMm: 540 }));
    const outcome = await readWcsFileForPhoto(file, { ...target, gearSetupId: 's30' });
    expect(outcome.kind).toBe('read');
    expect(confirmWcsWarnings).not.toHaveBeenCalled();
  });
});

describe('the desktop flow', () => {
  it('asks the warnings in the desktop dialog', async () => {
    api.solveWCS.mockResolvedValue(unsolved({ focalLengthMm: 540 }));
    confirmWcsWarnings.mockResolvedValue(false);
    const outcome = await desktop.readWcsFileForPhoto(file, { ...target, gearSetupId: 's30' });
    expect(confirmWcsWarnings).toHaveBeenCalledWith('M42.fit', [expect.stringContaining('540')]);
    expect(outcome).toEqual({ kind: 'cancelled' });
  });
});

describe('isSolved', () => {
  it('needs a success with at least one reference point', () => {
    expect(isSolved({ success: true, correspondences: [] })).toBe(false);
    expect(isSolved(unsolved({}))).toBe(false);
    expect(
      isSolved({
        success: true,
        correspondences: [{ photoX: 0, photoY: 0, ra: 1, dec: 2 }],
      } as PlateSolveResult),
    ).toBe(true);
  });
});

describe('suggestedSetupFor', () => {
  it('gives the setup id, or null without header facts', async () => {
    expect(
      await suggestedSetupFor(
        unsolved({ telescope: 'S30_0289c34b', instrument: 'Seestar S30', focalLengthMm: 150 }),
      ),
    ).toBe('s30');
    expect(await suggestedSetupFor({ success: false })).toBeNull();
  });
});
