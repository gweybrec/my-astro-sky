/**
 * The Ciel tab's sky map: a `SkyMap` on the page's canvas, set up from the display settings and the observing
 * location, as on the desktop. Touch gestures on, density capped at 2, redrawn when the screen rotates;
 * no side panel on the phone, so the mouse's panel test never applies.
 */
import { loadSettings } from '@myastrosky/core/display-settings';
import { isIAUStyle } from '@myastrosky/core/types';
import { readObserverLocation } from '@myastrosky/core/observer-location';
import { loadSkyTimeSettings } from '@myastrosky/core/sky-time-settings';
import { SkyMap } from '@myastrosky/render/sky-map';

/** The most pixels per CSS pixel the map draws: a phone screen's 2.6 to 3.5 costs more than it shows. */
export const MAX_PIXEL_RATIO = 2;
/** How often the simulated clock catches up with the real one. */
export const CLOCK_TICK_MS = 1000;

export interface PhoneSkyMap {
  readonly map: SkyMap;
  /** Re-reads the observing location after it changed in Réglages. */
  refreshLocation(): void;
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

  // As on the desktop: the full sky (live mode) by default, the sky for a date and place when date mode is saved.
  // Date mode starts at the real time and follows the clock; the phone has no time controls yet.
  const time = loadSkyTimeSettings();
  map.setSkyTimeMode(time.mode);
  map.setSimDate(new Date());
  map.setShowMoon(time.showMoon);
  map.setShowSun(time.showSun);
  map.setShowPlanets(time.showPlanets);
  map.setShowAzimuthGrid(time.showAzimuthGrid);
  map.setShowCardinalPoints(time.showCardinalPoints);
  const refreshLocation = () => {
    const { lat, lon } = readObserverLocation();
    map.setObserverLocation(lat, lon);
  };
  refreshLocation();
  map.setLocalSkyMode(time.localSkyMode);

  const clock =
    time.mode === 'date' ? setInterval(() => map.setSimDate(new Date()), CLOCK_TICK_MS) : null;

  return {
    map,
    refreshLocation,
    catalogsLoaded: () => map.refreshCatalogs(),
    destroy() {
      if (clock !== null) clearInterval(clock);
      map.destroy();
    },
  };
}
