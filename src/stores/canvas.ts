import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type { SkyMap } from '../sky-map';
import type { FovFrameSpec } from '../sky-map-types';
import type { PhotoOverlay } from '../photo-overlay';
import type { Photo } from '../types';
import type { PoiFilterGroup } from '../poi';
import type { GearSetupData } from '../api';

/** Minimal interface for objects that can show/hide themselves. */
export interface ShowHide {
  show(): void;
  hide(): void;
}

/** Extended interface for the Plans/Targets view, exposing the "Find targets"
 * recommend surface so the TargetsOverlay Vue component can mount it. */
export interface TargetsViewInterface extends ShowHide {
  getRecommendElement(): HTMLElement;
}

/** Extended interface for the Gallery, exposing filter methods to Vue components. */
export interface GalleryInterface extends ShowHide {
  loadPhotos(photos: Photo[]): void;
  setSearchQuery(q: string): void;
  setLabelFilter(labels: string[] | null): void;
  setSetupFilter(setupIds: string[] | null): void;
  setDSOTypeFilter(types: string[]): void;
  setDSOCatalogFilter(catalogs: string[]): void;
  setPoiFilter(selected: Map<string, Set<string>> | null): void;
  setGearSetups(setups: GearSetupData[]): void;
  getAllPois(): PoiFilterGroup[];
  getAllLabels(): { label: string; count: number }[];
  getAllSetups(): { setupId: string; name: string; count: number }[];
  getFilteredPhotos(): Photo[];
}

export const useCanvasStore = defineStore('canvas', () => {
  const skyMap = shallowRef<SkyMap | null>(null);
  const overlay = shallowRef<PhotoOverlay | null>(null);
  const gallery = shallowRef<GalleryInterface | null>(null);
  const targetsView = shallowRef<TargetsViewInterface | null>(null);
  // Consumed once by FOVRibbon.onMounted to override the DB-loaded frame state.
  const pendingFovOverride = shallowRef<FovFrameSpec[] | null>(null);

  function init(sm: SkyMap, ov: PhotoOverlay, gal?: GalleryInterface, tv?: TargetsViewInterface) {
    skyMap.value = sm;
    overlay.value = ov;
    if (gal) gallery.value = gal;
    if (tv) targetsView.value = tv;
  }

  return { skyMap, overlay, gallery, targetsView, pendingFovOverride, init };
});
