import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import type { Photo } from '@myastrosky/core/types';
import { computePhotoToProjMatrix } from '@myastrosky/core/photo-placement';
import { withCanonicalProjection } from '@myastrosky/core/projection';
import { findDsoPlacementsInImage } from '@myastrosky/core/catalog/dso-registry';
import { resolveCategory } from '@myastrosky/core/poi';
import { drawPhotoOverlay } from '@myastrosky/render/photo-dso-overlay-render';
import { poiPinsInImage } from '@myastrosky/render/poi-pins';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { catalogsReady } from '../catalogs';
import { fittedSize, type PhotoZoom } from './usePhotoZoom';

/**
 * The objects and the points of interest drawn over a photo (board "Photo, objets affichés"), as the desktop's photo
 * detail draws them (`drawPhotoOverlay`): a canvas over the photo's area, redrawn as the photo is zoomed and moved,
 * clipped to the part of the photo in view. The objects are those of the chosen catalogues (`catalogs`); the points of
 * interest are the ones with a sky position. `canShowObjects` is false for a photo not placed on the sky,
 * `canShowPois` while none of its points of interest has a position.
 */
export function usePhotoOverlay(options: {
  canvas: Ref<HTMLCanvasElement | null>;
  area: Ref<HTMLElement | null>;
  photo: Ref<Photo | null>;
  zoom: Ref<PhotoZoom>;
  objects: Ref<boolean>;
  pois: Ref<boolean>;
  catalogs: Ref<string[]>;
}) {
  const { canvas, area, photo, zoom, objects, pois, catalogs } = options;
  const categories = usePoiCategoriesStore();
  // The deep-sky catalogue is loaded after start-up: the objects are found once it is in.
  const catalogLoaded = ref(false);
  void catalogsReady().then(() => (catalogLoaded.value = true));

  // The canonical pole projection, as the desktop: the zenith-centred mode would clip a photo below the horizon.
  const solved = computed(() =>
    photo.value
      ? withCanonicalProjection(() => computePhotoToProjMatrix(photo.value!)) !== null
      : false,
  );
  const placements = computed(() => {
    const p = photo.value;
    if (!p || !objects.value || !catalogLoaded.value) return [];
    return withCanonicalProjection(() => {
      const matrix = computePhotoToProjMatrix(p);
      return matrix
        ? findDsoPlacementsInImage(matrix, p.width, p.height, new Set(catalogs.value))
        : [];
    });
  });
  const pins = computed(() => {
    const p = photo.value;
    if (!p) return [];
    return withCanonicalProjection(() => {
      const matrix = computePhotoToProjMatrix(p);
      return matrix ? poiPinsInImage(p.pointsOfInterest ?? [], matrix, p.width, p.height) : [];
    });
  });

  function draw() {
    const el = canvas.value;
    const box = area.value?.getBoundingClientRect();
    const p = photo.value;
    if (!el || !box) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(box.width * dpr);
    el.height = Math.round(box.height * dpr);
    const ctx = el.getContext('2d');
    if (!ctx || !p) return;
    ctx.clearRect(0, 0, el.width, el.height);
    const drawnPins = pois.value ? pins.value : [];
    if (!placements.value.length && !drawnPins.length) return;
    // Where the photo is in the area: fitted, then zoomed about the area's centre and moved.
    const fitted = fittedSize(p, box);
    const width = fitted.width * zoom.value.scale;
    const height = fitted.height * zoom.value.scale;
    const left = box.width / 2 + zoom.value.tx - width / 2;
    const top = box.height / 2 + zoom.value.ty - height / 2;
    // The part of the photo in view, in the photo's own CSS px (the space the drawing uses).
    const view = {
      left: Math.max(0, -left),
      top: Math.max(0, -top),
      right: Math.min(width, box.width - left),
      bottom: Math.min(height, box.height - top),
    };
    if (view.right <= view.left || view.bottom <= view.top) return;
    ctx.setTransform(dpr, 0, 0, dpr, left * dpr, top * dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.left, view.top, view.right - view.left, view.bottom - view.top);
    ctx.clip();
    drawPhotoOverlay(ctx, {
      placements: placements.value,
      pins: drawnPins,
      dispScale: width / p.width,
      viewport: view,
      pinColor: (poi) => resolveCategory(poi.categoryId, categories.categories).color,
    });
    ctx.restore();
  }

  watch([placements, pins, pois, zoom, () => categories.categories], draw, { flush: 'post' });
  let observer: ResizeObserver | null = null;
  onMounted(() => {
    draw();
    if (area.value && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(draw);
      observer.observe(area.value);
    }
  });
  onBeforeUnmount(() => observer?.disconnect());

  return {
    canShowObjects: solved,
    canShowPois: computed(() => pins.value.length > 0),
    draw,
  };
}
