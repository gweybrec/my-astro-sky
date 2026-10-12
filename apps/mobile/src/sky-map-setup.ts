/**
 * The Ciel tab's sky map: a `SkyMap` on the page's canvas, set up from the display settings and the observing
 * location, as on the desktop. Touch gestures on, density capped at 2, redrawn when the screen rotates;
 * no side panel on the phone, so the mouse's panel test never applies.
 */
import { loadSettings } from '@myastrosky/core/display-settings';
import { isIAUStyle } from '@myastrosky/core/types';
import { readObserverLocation } from '@myastrosky/core/observer-location';
import { watch } from 'vue';
import { useDisplayStore } from '@myastrosky/app-state/stores/display';
import { useMapPortStore } from '@myastrosky/app-state/stores/map-port';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { useHorizonProfileStore } from '@myastrosky/app-state/stores/horizon-profile';
import {
  clearSkySelection,
  skySelection,
  type SkyFocus,
  type SkySelection,
} from './composables/useSkySelection';
import { SkyMap } from '@myastrosky/render/sky-map';
import { PhotoLayer } from '@myastrosky/render/photo-layer';
import type { Photo } from '@myastrosky/core/types';
import { getPhotos, photoFileUrl } from '@myastrosky/app-state/api';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';

/** How long the photos stay hidden after the map stopped moving: large images are not painted on every frame. */
export const PHOTOS_FROZEN_MS = 100;

/** A photo with a placement: two star correspondences or a manual placement. The others are not drawn. */
export const isPlaced = (photo: Photo) =>
  Boolean(photo.manualPlacement) || photo.correspondences.length >= 2;

/** The most pixels per CSS pixel the map draws: a phone screen's 2.6 to 3.5 costs more than it shows. */
export const MAX_PIXEL_RATIO = 2;

export interface PhoneSkyMapOptions {
  /** The box over the canvas that holds the photos. */
  photoContainer: HTMLDivElement;
  /** A photo cannot be placed (its star correspondences do not fit). */
  onPhotoPlacementError(photo: Photo): void;
}

export interface PhoneSkyMap {
  readonly map: SkyMap;
  /** The photos drawn over the sky. */
  readonly photos: PhotoLayer;
  /** Reads the placed photos again (they changed in the gallery, an import or a deletion). */
  reloadPhotos(): Promise<void>;
  /** Re-reads the observing location after it changed in Réglages. */
  refreshLocation(): void;
  /** Highlights the selected object on the map (nothing when null). */
  select(selection: SkySelection | null): void;
  /** Moves the map to a position, zooming in to at least the given scale. */
  focus(focus: SkyFocus): void;
  /** The star and deep-sky catalogues have loaded: the map indexes them and draws again. */
  catalogsLoaded(): void;
  destroy(): void;
}

export function createPhoneSkyMap(
  canvas: HTMLCanvasElement,
  options: PhoneSkyMapOptions,
): PhoneSkyMap {
  const map = new SkyMap(canvas, {
    maxPixelRatio: MAX_PIXEL_RATIO,
    touch: true,
    followCanvasSize: true,
    isOverPanel: () => false,
  });

  const port = useMapPortStore();
  port.skyMap = map;

  // The photos: an `<img>` each in the box over the canvas, moved by the map's view.
  const container = options.photoContainer;
  const layer = new PhotoLayer(container, () => map.getView(), {
    skyMap: map,
    photoUrl: photoFileUrl,
    onPlacementError: options.onPhotoPlacementError,
    onDimensionMismatch: (photo, expected, actual) =>
      reportError(
        'SkyPage.photoDimensions',
        new Error(`${photo.originalName}: ${expected}, ${actual}`),
      ),
  });
  port.overlay = layer;
  map.setPoiPinSource(() => layer.getPoiPins());
  const categories = usePoiCategoriesStore();
  const pushCategories = () => layer.setPoiCategories(categories.categories);
  const stopCategories = categories.$subscribe(pushCategories);
  void categories
    .ensureLoaded?.()
    .then(pushCategories)
    .catch((e) => reportError('SkyPage.poiCategories', e));

  const display = useDisplayStore();
  // The display store keeps the map's rotation, which two fingers can change.

  // A tap on an object or a star selects it; a tap on an empty spot clears the selection.
  map.setOnDSOClick((dso) => (skySelection.value = { kind: 'dso', dso }));
  map.setOnStarTap((star) => (skySelection.value = { kind: 'star', star }));
  map.setOnClearSelection(clearSkySelection);
  // A tap on a photo selects it, by the name the map hit-tests.
  map.setOnPhotoClick((name) => {
    const placed = layer.getPlacedPhotos().find((p) => p.photo.originalName === name);
    if (placed) skySelection.value = { kind: 'photo', photo: placed.photo };
  });

  // The photos follow the view; while it moves they are hidden and come back once it has stopped.
  let frozenTimer: ReturnType<typeof setTimeout> | null = null;
  map.setOnViewChange((reason) => {
    display.onMapViewChanged(map.getView().rotationDeg);
    // A clock tick is not a move of the view.
    if (reason !== 'skyClock') {
      if (!frozenTimer) container.classList.add('photos-frozen');
      else clearTimeout(frozenTimer);
    }
    layer.updateTransforms();
    map.setPhotoOutlines(layer.getPhotoCanvasOutlines(map.getView()));
    if (reason === 'skyClock') return;
    frozenTimer = setTimeout(() => {
      frozenTimer = null;
      container.classList.remove('photos-frozen');
    }, PHOTOS_FROZEN_MS);
  });

  const settings = loadSettings();
  map.setHemisphere(settings.hemisphere, settings.borderLatDeg);
  map.setRotationDeg(settings.mapRotationDeg);
  map.setShowStars(settings.showStars);
  map.setShowConstellationLines(settings.showConstellationLines);
  map.setShowConstellationNames(
    isIAUStyle(settings.constellationStyle) ? settings.showConstellationNames : false,
  );
  if (settings.constellationStyle !== 'western') {
    void map.setConstellationStyle(settings.constellationStyle);
  }
  map.setShowStarLabels(settings.showStarLabels);
  map.setShowDSOLabels(settings.showDSOLabels);
  map.setShowGrid(settings.showGrid);
  map.setSkyOpacity(settings.skyOpacity);
  map.setBackgroundOpacity(settings.backgroundOpacity);
  map.setShowDSOs(settings.showDSOs);
  map.setVisibleDSOTypes(new Set(settings.dsoTypes));
  map.setVisibleDSOCatalogs(new Set(settings.dsoCatalogs));
  map.setMaxStarCount(settings.maxStarCount);
  map.setMaxDSOCount(settings.maxDSOCount);
  map.setAutoStarDensity(settings.autoStarDensity);
  map.setAutoDSODensity(settings.autoDSODensity);
  map.setMotionLOD(settings.reduceDetailWhileMoving);

  // The sky-time store owns the mode, the clock and the location: it pushes each change to the map through the port.
  const time = useSkyTimeStore();
  map.setSkyTimeMode(time.mode);
  map.setSimDate(time.simDate);
  map.setShowMoon(time.showMoon);
  map.setShowSun(time.showSun);
  map.setShowPlanets(time.showPlanets);
  map.setShowAzimuthGrid(time.showAzimuthGrid);
  map.setShowCardinalPoints(time.showCardinalPoints);
  map.setShowTrajectory(time.showTrajectory);
  const refreshLocation = () => {
    const { lat, lon } = readObserverLocation();
    time.setLocation(lat, lon);
  };
  refreshLocation();
  map.setLocalSkyMode(time.localSkyMode);

  // The terrain horizon of the observing location, and whether it is shown.
  const horizon = useHorizonProfileStore();
  const stopHorizon = watch(
    () => [horizon.profile, horizon.enabled] as const,
    ([profile, enabled]) => {
      map.setMountainHorizon(profile);
      map.setShowMountainHorizon(enabled);
    },
    { immediate: true },
  );

  async function reloadPhotos() {
    const photos = (await getPhotos()).filter(isPlaced);
    layer.clearAllPhotos();
    layer.loadPhotos(photos);
    map.setPhotoOutlines(layer.getPhotoCanvasOutlines(map.getView()));
    map.requestRender();
  }

  return {
    map,
    photos: layer,
    reloadPhotos,
    refreshLocation,
    select(selection) {
      map.setHighlightedDSO(selection?.kind === 'dso' ? selection.dso.id : null);
      map.setHighlightedStar(selection?.kind === 'star' ? selection.star.hip : null);
      // A searched deep-sky object is shown even when the deep-sky layer is off, as on the desktop.
      if (selection?.kind === 'dso') map.setShowDSOs(true);
    },
    focus: ({ ra, dec, scale }) => map.navigateTo(ra, dec, Math.max(map.getView().scale, scale)),
    catalogsLoaded: () => map.refreshCatalogs(),
    destroy() {
      stopHorizon();
      stopCategories();
      if (frozenTimer) clearTimeout(frozenTimer);
      port.skyMap = null;
      port.overlay = null;
      map.destroy();
    },
  };
}
