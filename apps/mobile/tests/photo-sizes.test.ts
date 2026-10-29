import { beforeEach, describe, expect, it, vi } from 'vitest';

const reportError = vi.hoisted(() => vi.fn());
vi.mock('@myastrosky/core/platform/error-hook', () => ({ reportError }));

const repairSizes = vi.fn();
const makeMissingMediums = vi.fn();

/** A fresh copy of the module (its promises settle once per start-up), over a backend that has both repairs. */
const load = async () => {
  vi.resetModules();
  const { setBackend } = await import('@myastrosky/app-state/backend');
  setBackend({ photos: { repairSizes, makeMissingMediums } } as never);
  return import('../src/photo-sizes');
};

describe('the start-up repair of the photo sizes', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    repairSizes.mockReset();
    makeMissingMediums.mockReset().mockResolvedValue(0);
    reportError.mockReset();
  });

  it('waits until start-up runs it, then gives the number of photos repaired', async () => {
    const { photoSizesRepaired, repairStoredPhotoSizes } = await load();
    let repaired: number | undefined;
    void photoSizesRepaired().then((n) => (repaired = n));
    await Promise.resolve();
    expect(repaired).toBeUndefined();
    expect(repairSizes).not.toHaveBeenCalled();

    repairSizes.mockResolvedValue(2);
    await repairStoredPhotoSizes();
    expect(await photoSizesRepaired()).toBe(2);
    expect(repaired).toBe(2);
  });

  it('reports a failure and counts it as nothing repaired', async () => {
    const { photoSizesRepaired, repairStoredPhotoSizes } = await load();
    repairSizes.mockRejectedValue(new Error('disk'));
    await repairStoredPhotoSizes();
    expect(await photoSizesRepaired()).toBe(0);
    expect(reportError).toHaveBeenCalledWith('photoSizes.repair', expect.any(Error));
  });

  it('makes the medium-sized copies after the sizes, and gives how many were made', async () => {
    const { photoMediumsMade, photoSizesRepaired, repairStoredPhotoSizes } = await load();
    const order: string[] = [];
    repairSizes.mockImplementation(async () => (order.push('sizes'), 0));
    makeMissingMediums.mockImplementation(async () => (order.push('mediums'), 3));
    await repairStoredPhotoSizes();
    expect(order).toEqual(['sizes', 'mediums']);
    expect(await photoSizesRepaired()).toBe(0);
    expect(await photoMediumsMade()).toBe(3);
  });

  it('makes the medium-sized copies even when the size repair failed, and reports their own failure', async () => {
    const { photoMediumsMade, repairStoredPhotoSizes } = await load();
    repairSizes.mockRejectedValue(new Error('disk'));
    makeMissingMediums.mockRejectedValue(new Error('codec'));
    await repairStoredPhotoSizes();
    expect(makeMissingMediums).toHaveBeenCalledOnce();
    expect(await photoMediumsMade()).toBe(0);
    expect(reportError).toHaveBeenCalledWith('photoSizes.mediums', expect.any(Error));
  });
});
