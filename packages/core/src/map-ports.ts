import type { ConstellationStyle } from './types';

/** What the shared display and time stores ask of the sky map. `SkyMap` satisfies it; each app holds its own instance. */
export interface SkyMapPort {
  setShowStars(v: boolean): void;
  setShowConstellationLines(v: boolean): void;
  setShowConstellationNames(v: boolean): void;
  setConstellationStyle(style: ConstellationStyle): Promise<void>;
  setShowStarLabels(v: boolean): void;
  setShowDSOLabels(v: boolean): void;
  setShowGrid(v: boolean): void;
  setShowPhotoOutlines(v: boolean): void;
  setSkyOpacity(v: number): void;
  setBackgroundOpacity(v: number): void;
  setMaxStarCount(count: number): void;
  setMaxDSOCount(count: number): void;
  setAutoStarDensity(v: boolean): void;
  setAutoDSODensity(v: boolean): void;
  setMotionLOD(v: boolean): void;
  setShowDSOs(v: boolean): void;
  setVisibleDSOTypes(types: Set<string>): void;
  setVisibleDSOCatalogs(catalogs: Set<string>): void;
  setHemisphere(h: 'north' | 'south', borderLatDeg?: number): void;
  setBorderLatDeg(deg: number): void;
  setRotationDeg(deg: number): void;
  setFisheyeMode(v: boolean): void;

  setSkyTimeMode(mode: 'live' | 'date'): void;
  setSimDate(date: Date): void;
  setObserverLocation(lat: number | null, lon: number | null): void;
  setShowMoon(v: boolean): void;
  setShowSun(v: boolean): void;
  setShowPlanets(v: boolean): void;
  setShowAzimuthGrid(v: boolean): void;
  setShowCardinalPoints(v: boolean): void;
  setShowTrajectory(v: boolean): void;
  setLocalSkyMode(v: boolean): void;
}

/** The photo layer, which only the desktop has: the stores call it when it is there. */
export interface PhotoOverlayPort {
  setShowPhotos(v: boolean): void;
  setVisibleLabels(labels: { [label: string]: boolean }): void;
  setShowPois(v: boolean): void;
  setVisiblePois(pois: { [poiKey: string]: boolean }): void;
  setBorderParams(hemisphere: 'north' | 'south', borderLatDeg: number): void;
  updateTransforms(): void;
}
