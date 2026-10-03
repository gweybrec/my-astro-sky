/**
 * Pure logic for identifying supernovae (and other transients) in a solved photo:
 * turns the photo's field + observation date into a TNS search, then keeps the
 * returned transients that fall inside the frame and ranks them.
 *
 * Nothing here touches the DOM or fetch — `SupernovaIdentifyModal.vue` composes
 * these functions with `src/api.ts` (which does the `/api/tns/conesearch` call).
 * See `tests/unit/supernova-identify.test.ts`.
 */
import type { AffineMatrix, PointOfInterest } from './types';
import { applyAffine, invertAffine } from './affine';
import { project } from './projection';
import { angularSeparationDeg } from './sky-geometry';
import { photoPixelToRaDec } from './asteroid-identify';
import { t } from './i18n';

export const SUPERNOVA_CATEGORY_ID = 'cat-supernova';

/** A supernova stays photographable for months after discovery (a bright SN Ia
 * fades ~3 mag in 100 days), so look back a year from the observation date. */
export const SEARCH_DAYS_BEFORE_OBS = 365;
/** A photo can also pre-date the discovery report by a few weeks (the SN was
 * already rising, just not reported yet). */
export const SEARCH_DAYS_AFTER_OBS = 60;
/** Server-side cap on the TNS cone radius (arcmin). */
export const MAX_SEARCH_RADIUS_ARCMIN = 60;

const DAY_MS = 86_400_000;

/** One TNS transient — mirrors `TnsCandidate` in server/tns.ts. */
export interface TnsCandidate {
  name: string;
  raDeg: number;
  decDeg: number;
  type: string | null;
  classified: boolean;
  discoveryDate: string | null;
  discoveryMag: number | null;
  hostName: string | null;
  redshift: number | null;
  tnsUrl: string;
}

/** A candidate placed on the photo: pixel position + age at observation time. */
export interface PlacedTransient extends TnsCandidate {
  x: number;
  y: number;
  /** Days from discovery to observation: positive = photo taken after the discovery. */
  daysFromDiscovery: number | null;
}

/** The TNS cone covering the whole photo. */
export interface FieldCircle {
  raDeg: number;
  decDeg: number;
  radiusArcmin: number;
  /** True when the photo is wider than the TNS cone cap — its corners aren't searched. */
  truncated: boolean;
}

/**
 * Centre of the photo + the radius reaching its farthest corner (+5 % margin), so
 * a transient in a corner is still returned. Clamped to `maxRadiusArcmin` — by
 * default the TNS server's 60′ cap.
 */
export function photoFieldCircle(
  photoToProj: AffineMatrix,
  width: number,
  height: number,
  maxRadiusArcmin = MAX_SEARCH_RADIUS_ARCMIN,
): FieldCircle {
  const center = photoPixelToRaDec(photoToProj, width / 2, height / 2);
  const corners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([x, y]) => photoPixelToRaDec(photoToProj, x, y));
  const maxSepDeg = Math.max(
    ...corners.map((c) => angularSeparationDeg(center.ra, center.dec, c.ra, c.dec)),
  );
  const wanted = maxSepDeg * 60 * 1.05;
  return {
    raDeg: ((center.ra % 360) + 360) % 360,
    decDeg: center.dec,
    radiusArcmin: Math.min(maxRadiusArcmin, Math.max(1, wanted)),
    truncated: wanted > maxRadiusArcmin,
  };
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Discovery-date window (YYYY-MM-DD, inclusive) for an observation date. */
export function searchWindow(obsIso: string): { dateStart: string; dateEnd: string } | null {
  const obs = Date.parse(obsIso);
  if (!Number.isFinite(obs)) return null;
  return {
    dateStart: isoDay(obs - SEARCH_DAYS_BEFORE_OBS * DAY_MS),
    dateEnd: isoDay(obs + SEARCH_DAYS_AFTER_OBS * DAY_MS),
  };
}

/** Whole days from discovery to observation (positive = observed after discovery). */
export function daysFromDiscovery(obsIso: string, discoveryIso: string | null): number | null {
  if (!discoveryIso) return null;
  const obs = Date.parse(obsIso);
  const disc = Date.parse(discoveryIso);
  if (!Number.isFinite(obs) || !Number.isFinite(disc)) return null;
  return Math.round((obs - disc) / DAY_MS);
}

/**
 * Projects each candidate onto the photo (the inverse of the photo→projection
 * affine, same round trip as `findDsoPlacementsInImage`) and drops those outside
 * the frame — the TNS cone is a circle around a rectangle.
 */
export function placeInImage(
  candidates: TnsCandidate[],
  photoToProj: AffineMatrix,
  width: number,
  height: number,
  obsIso: string,
): PlacedTransient[] {
  const inv = invertAffine(photoToProj);
  if (!inv) return [];
  const placed: PlacedTransient[] = [];
  for (const c of candidates) {
    const p = applyAffine(inv, project(c.raDeg, c.decDeg));
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) continue;
    placed.push({
      ...c,
      x: p.x,
      y: p.y,
      daysFromDiscovery: daysFromDiscovery(obsIso, c.discoveryDate),
    });
  }
  return placed;
}

/**
 * Confirmed supernovae first, then unclassified transients; within each group the
 * one discovered closest to the observation date first (unknown dates last).
 */
export function rankTransients(list: PlacedTransient[]): PlacedTransient[] {
  const age = (c: PlacedTransient) =>
    c.daysFromDiscovery === null ? Number.POSITIVE_INFINITY : Math.abs(c.daysFromDiscovery);
  return [...list].sort((a, b) => {
    if (a.classified !== b.classified) return a.classified ? -1 : 1;
    return age(a) - age(b);
  });
}

/** "3 days after discovery" / "12 days before discovery" / "discovery day". */
export function formatDaysFromDiscovery(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return t('supernova.discoveryDay');
  return days > 0 ? t('supernova.daysAfter', { n: days }) : t('supernova.daysBefore', { n: -days });
}

/** The POI saved for a chosen transient — carries its position so it can be pinned. */
export function candidateToPoi(c: TnsCandidate): PointOfInterest {
  return { name: c.name, categoryId: SUPERNOVA_CATEGORY_ID, ra: c.raDeg, dec: c.decDeg };
}
