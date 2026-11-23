import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { useCanvasStore } from './canvas';
import type { PlacedPhoto } from '../photo-overlay';

export const usePhotosStore = defineStore('photos', () => {
  const canvasStore = useCanvasStore();
  /** The user's own photos (never a visited sky's). */
  const placedPhotos = shallowRef<PlacedPhoto[]>([]);
  /**
   * The photos of the skies shown on the map, own and visited, in drawing order (the last on top). A visited sky's
   * photo is selected, hidden, faded and reordered like the user's own, but never changed.
   */
  const shownPhotos = shallowRef<PlacedPhoto[]>([]);
  /** The photos of the visited skies shown. */
  const visitPhotos = computed(() => shownPhotos.value.filter((p) => !!p.photo.sharedSkyId));
  const selectedPhotoId = ref<string | null>(null);

  function syncFromOverlay() {
    const overlay = canvasStore.overlay;
    // Shallow-clone each entry (not just the array) so components bound to a single
    // PlacedPhoto (e.g. the selected-photo card) see a new object reference when a
    // field like `visible` is mutated in place by the overlay — otherwise Vue's
    // computed/prop equality check sees the same reference and skips the re-render.
    placedPhotos.value = overlay ? overlay.getPlacedPhotos().map((p) => ({ ...p })) : [];
    shownPhotos.value = overlay ? overlay.getShownPhotos().map((p) => ({ ...p })) : [];
  }

  /** A photo of the map by its id: the user's own or a visited sky's shown. */
  function findPhoto(photoId: string): PlacedPhoto | null {
    return (
      placedPhotos.value.find((p) => p.photo.id === photoId) ??
      visitPhotos.value.find((p) => p.photo.id === photoId) ??
      null
    );
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

  return {
    placedPhotos,
    shownPhotos,
    visitPhotos,
    selectedPhotoId,
    syncFromOverlay,
    findPhoto,
    selectPhoto,
    zoomToPhoto,
  };
});
