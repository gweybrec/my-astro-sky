import { followStoredSolves } from '@myastrosky/app-state/stored-solve';
import type { Photo } from '@myastrosky/core/types';
import type { SkyMap } from '@myastrosky/render/sky-map';
import type { PhotoOverlay } from './photo-overlay';
import type { GalleryInterface } from './stores/canvas';

/**
 * Photos stored while astrometry.net had not finished (saved that way, or restored from a backup): their solve went on
 * there; its result is fetched now, without a new upload, and a solved photo takes its place on the map. A photo
 * already followed is skipped, so calling this again (after a backup is restored) follows only the new ones.
 */
export function followDesktopStoredSolves(
  photos: readonly Photo[],
  overlay: PhotoOverlay,
  skyMap: SkyMap | null,
  gallery: Pick<GalleryInterface, 'loadPhotos'> | null,
): Promise<void> {
  return followStoredSolves(photos, {
    onChange: (photo) => {
      overlay.updatePhotoData(photo);
      overlay.updateTransforms();
      gallery?.loadPhotos(overlay.getPlacedPhotos().map((p) => p.photo));
      if (skyMap) {
        skyMap.setPhotoOutlines(overlay.getPhotoCanvasOutlines(skyMap.getView()));
        skyMap.render();
      }
    },
  });
}
