/** The position on the phone: a refused permission is an expected outcome and never reaches the plugin's request. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const geolocation = {
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getCurrentPosition: vi.fn(),
};
vi.mock('@capacitor/geolocation', () => ({ Geolocation: geolocation }));
vi.mock('../src/platform-init', () => ({ isNativePlatform: () => true }));
const filePicker = { pickFiles: vi.fn(), pickImages: vi.fn() };
vi.mock('@capawesome/capacitor-file-picker', () => ({ FilePicker: filePicker }));

const { getCurrentPosition, pickFiles, pickGalleryPhotos } = await import('../src/platform-device');

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

describe('picking on the phone', () => {
  beforeEach(() => {
    filePicker.pickFiles.mockReset();
    filePicker.pickImages.mockReset();
  });

  it("opens the phone's photo picker for any number of pictures and returns them as files", async () => {
    filePicker.pickImages.mockResolvedValue({
      files: [{ blob: new Blob(['x']), name: 'IMG_1.jpg', mimeType: 'image/jpeg' }],
    });
    const files = await pickGalleryPhotos();
    expect(filePicker.pickImages).toHaveBeenCalledWith({ limit: 0 });
    expect(files.map((f) => [f.name, f.type])).toEqual([['IMG_1.jpg', 'image/jpeg']]);
  });

  it('answers with no file when a picker is closed without a choice, and passes other failures on', async () => {
    filePicker.pickImages.mockRejectedValue(new Error('pickFiles canceled.'));
    expect(await pickGalleryPhotos()).toEqual([]);
    filePicker.pickFiles.mockRejectedValue(new Error('User cancelled'));
    expect(await pickFiles({ mimeTypes: [], extensions: [] }, true)).toEqual([]);
    filePicker.pickFiles.mockRejectedValue(new Error('No activity'));
    await expect(pickFiles({ mimeTypes: [], extensions: [] })).rejects.toThrow('No activity');
  });
});
