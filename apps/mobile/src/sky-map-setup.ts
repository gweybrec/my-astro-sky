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

/** The most pixels per CSS pixel the map draws: a phone screen's 2.6 to 3.5 costs more than it shows. */
export const MAX_PIXEL_RATIO = 2;

export interface PhoneSkyMap {
  readonly map: SkyMap;
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

export function createPhoneSkyMap(canvas: HTMLCanvasElement): PhoneSkyMap {
  const map = new SkyMap(canvas, {
    maxPixelRatio: MAX_PIXEL_RATIO,
    touch: true,
    followCanvasSize: true,
    isOverPanel: () => false,
  });

  const port = useMapPortStore();
  port.skyMap = map;

  const display = useDisplayStore();
  // The display store keeps the map's rotation, which two fingers can change.
  map.setOnViewChange(() => display.onMapViewChanged(map.getView().rotationDeg));

  // A tap on an object or a star selects it; a tap on an empty spot clears the selection.
  map.setOnDSOClick((dso) => (skySelection.value = { kind: 'dso', dso }));
  map.setOnStarTap((star) => (skySelection.value = { kind: 'star', star }));
  map.setOnClearSelection(clearSkySelection);

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

  return {
    map,
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
      port.skyMap = null;
      map.destroy();
    },
  };
}
