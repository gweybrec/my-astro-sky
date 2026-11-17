import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Photo } from '@myastrosky/core/types';

const followStoredSolves = vi.fn();
vi.mock('@myastrosky/app-state/stored-solve', () => ({
  followStoredSolves: (...args: unknown[]) => followStoredSolves(...args),
}));

import { followDesktopStoredSolves } from '../../src/follow-stored-solves';

function setup() {
  const placed = [{ photo: { id: 'p1' } }];
  const overlay = {
    updatePhotoData: vi.fn(),
    updateTransforms: vi.fn(),
    getPlacedPhotos: vi.fn(() => placed),
    getPhotoCanvasOutlines: vi.fn(() => ['outline']),
  };
  const skyMap = { setPhotoOutlines: vi.fn(), render: vi.fn(), getView: vi.fn(() => 'view') };
  const gallery = { loadPhotos: vi.fn() };
  return { overlay, skyMap, gallery };
}

describe('followDesktopStoredSolves', () => {
  beforeEach(() => followStoredSolves.mockReset().mockResolvedValue(undefined));

  it('follows the given photos and puts a solved one on the map and in the gallery', async () => {
    const { overlay, skyMap, gallery } = setup();
    const photos = [{ id: 'p1' }] as Photo[];
    await followDesktopStoredSolves(photos, overlay as never, skyMap as never, gallery);
    expect(followStoredSolves).toHaveBeenCalledWith(photos, expect.any(Object));

    const solved = { id: 'p1', correspondences: [] } as unknown as Photo;
    followStoredSolves.mock.calls[0][1].onChange(solved);
    expect(overlay.updatePhotoData).toHaveBeenCalledWith(solved);
    expect(overlay.updateTransforms).toHaveBeenCalled();
    expect(gallery.loadPhotos).toHaveBeenCalledWith([{ id: 'p1' }]);
    expect(skyMap.setPhotoOutlines).toHaveBeenCalledWith(['outline']);
    expect(skyMap.render).toHaveBeenCalled();
  });

  it('updates the overlay alone when there is no map or gallery yet', async () => {
    const { overlay } = setup();
    await followDesktopStoredSolves([], overlay as never, null, null);
    followStoredSolves.mock.calls[0][1].onChange({ id: 'p1' });
    expect(overlay.updatePhotoData).toHaveBeenCalled();
  });
});
