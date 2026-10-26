import { beforeEach, describe, expect, it, vi } from 'vitest';

const reportError = vi.hoisted(() => vi.fn());
vi.mock('@myastrosky/core/platform/error-hook', () => ({ reportError }));

const repairSizes = vi.fn();

/** A fresh copy of the module (its promise settles once per start-up), over a backend that has `repairSizes`. */
const load = async () => {
  vi.resetModules();
  const { setBackend } = await import('@myastrosky/app-state/backend');
  setBackend({ photos: { repairSizes } } as never);
  return import('../src/photo-sizes');
};

describe('the start-up repair of the photo sizes', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    repairSizes.mockReset();
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
});
