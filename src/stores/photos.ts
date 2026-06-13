import { ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { useCanvasStore } from './canvas';
import type { PlacedPhoto } from '../photo-overlay';

export const usePhotosStore = defineStore('photos', () => {
  const canvasStore = useCanvasStore();
  const placedPhotos = shallowRef<PlacedPhoto[]>([]);
  const selectedPhotoId = ref<string | null>(null);

  function syncFromOverlay() {
    const overlay = canvasStore.overlay;
    placedPhotos.value = overlay ? [...overlay.getPlacedPhotos()] : [];
  }

  function selectPhoto(photoId: string | null) {
    selectedPhotoId.value = photoId;
  }

  function zoomToPhoto(photoId: string): boolean {
    const overlay = canvasStore.overlay;
    const skyMap = canvasStore.skyMap;
    if (!overlay || !skyMap) return false;
    const view = skyMap.getView();
    const fit = overlay.getPhotoCenterAndScale(photoId, view.width, view.height);
    if (!fit) return false;
    skyMap.navigateTo(fit.ra, fit.dec, fit.scale);
    return true;
  }

  return { placedPhotos, selectedPhotoId, syncFromOverlay, selectPhoto, zoomToPhoto };
});
