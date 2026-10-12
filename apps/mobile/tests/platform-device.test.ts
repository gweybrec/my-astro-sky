/** The position on the phone: a refused permission is an expected outcome and never reaches the plugin's request. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const geolocation = {
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getCurrentPosition: vi.fn(),
};
vi.mock('@capacitor/geolocation', () => ({ Geolocation: geolocation }));
vi.mock('../src/platform-init', () => ({ isNativePlatform: () => true }));

const { getCurrentPosition } = await import('../src/platform-device');

const status = (location: string) => ({ location, coarseLocation: location });

describe('getCurrentPosition on the phone', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rejects without asking for a position when the permission is refused', async () => {
    geolocation.checkPermissions.mockResolvedValue(status('prompt'));
    geolocation.requestPermissions.mockResolvedValue(status('denied'));
    await expect(getCurrentPosition()).rejects.toThrow(/denied/);
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('does not ask again when the permission is already given', async () => {
    geolocation.checkPermissions.mockResolvedValue(status('granted'));
    geolocation.getCurrentPosition.mockResolvedValue({
      coords: { latitude: 48.5, longitude: 7.7 },
    });
    await expect(getCurrentPosition()).resolves.toEqual({ latitude: 48.5, longitude: 7.7 });
    expect(geolocation.requestPermissions).not.toHaveBeenCalled();
  });
});
