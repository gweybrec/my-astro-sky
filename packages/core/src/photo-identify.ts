/**
 * The identification of objects on a solved photo (asteroids, supernovae, comets, a point of interest placed by hand),
 * at the photo's level: each step turns photo pixels into sky positions, or sky positions into photo pixels, through
 * the photo's solve. The desktop's identification modals and the phone's identification pages share these steps; they
 * only differ in how they show them.
 *
 * Every step runs in the canonical pole projection (`withCanonicalProjection`): the zenith-centred display mode clips
 * a field that is currently below the horizon (collapsing the photo's fit) and rotates with the sky clock.
 */
import {
  buildSearch,
  isoToJd,
  photoPixelToRaDec,
  rankCandidates,
  type RankedCandidate,
  type SkybotCandidate,
} from './asteroid-identify';
import { findComets, candidateToPoi as cometToPoi, type CometSearchResult } from './comet-identify';
import type { CometElements } from './comet-ephemeris';
import type { SkybotSearchParams, TnsSearchParams } from './domain/identify';
import { computePhotoToProjMatrix } from './photo-placement';
import { withCanonicalProjection } from './projection';
import {
  photoFieldCircle,
  placeInImage,
  rankTransients,
  searchWindow,
  type FieldCircle,
  type PlacedTransient,
  type TnsCandidate,
} from './supernova-identify';
import type { Photo, PointOfInterest } from './types';

/**
 * After this long, a search still running says so: the app waits up to a minute for SkyBoT (less for TNS and the MPC), and a spinner alone
 * for that long would look like a frozen app.
 */
export const SLOW_SEARCH_MS = 20_000;

/** A point of the photo, in its pixels (origin at the top left). */
export interface PhotoPixel {
  x: number;
  y: number;
}

type SolvedPhoto = Pick<Photo, 'width' | 'height' | 'correspondences' | 'manualPlacement'>;

/** Whether the photo has a solve: the identifications need one to turn a pixel into a sky position. */
export function isPhotoSolved(photo: SolvedPhoto): boolean {
  return withCanonicalProjection(() => computePhotoToProjMatrix(photo as Photo) !== null);
}

/** The sky position (degrees, RA in [0, 360)) of each pixel; null when the photo has no solve. */
export function photoPixelsToRaDec(
  photo: SolvedPhoto,
  pixels: PhotoPixel[],
): { ra: number; dec: number }[] | null {
  return withCanonicalProjection(() => {
    const matrix = computePhotoToProjMatrix(photo as Photo);
    if (!matrix) return null;
    return pixels.map((p) => {
      const { ra, dec } = photoPixelToRaDec(matrix, p.x, p.y);
      return { ra: ((ra % 360) + 360) % 360, dec };
    });
  });
}

// ── Asteroids ───────────────────────────────────────────────────────────────────────────────────

/** The SkyBoT search for a trail marked on the photo, and the marks the candidates are ranked against. */
export interface AsteroidSearchPlan {
  params: SkybotSearchParams;
  marks: {
    start: { ra: number; dec: number; jd: number };
    end: { ra: number; dec: number; jd: number };
  };
}

/**
 * The SkyBoT search for a trail from `start` (at `startIso`) to `end` (at `endIso`): centred on its middle at its
 * middle time, with the user's radius or, when larger, the one the trail's length calls for. Null without a solve.
 */
export function asteroidSearchPlan(
  photo: SolvedPhoto,
  start: PhotoPixel,
  end: PhotoPixel,
  startIso: string,
  endIso: string,
  radiusArcmin: number,
): AsteroidSearchPlan | null {
  const sky = photoPixelsToRaDec(photo, [start, end]);
  if (!sky) return null;
  const [startRaDec, endRaDec] = sky;
  const startJd = isoToJd(startIso);
  const endJd = isoToJd(endIso);
  const search = buildSearch(startRaDec, endRaDec, startJd, endJd);
  return {
    params: {
      raDeg: search.raDeg,
      decDeg: search.decDeg,
      radiusArcmin: Math.max(radiusArcmin, search.suggestedRadiusArcmin),
      epochJd: search.epochJd,
    },
    marks: { start: { ...startRaDec, jd: startJd }, end: { ...endRaDec, jd: endJd } },
  };
}

/** SkyBoT's candidates, best match first. */
export function rankAsteroids(
  candidates: SkybotCandidate[],
  plan: AsteroidSearchPlan,
): RankedCandidate[] {
  return rankCandidates(candidates, plan.marks, plan.params.epochJd);
}

// ── Supernovae ──────────────────────────────────────────────────────────────────────────────────

/** The TNS search covering the photo around its observation date; null without a solve or a valid date. */
export function supernovaSearchPlan(
  photo: SolvedPhoto,
  obsIso: string,
): { field: FieldCircle; params: TnsSearchParams } | null {
  const field = withCanonicalProjection(() => {
    const matrix = computePhotoToProjMatrix(photo as Photo);
    return matrix ? photoFieldCircle(matrix, photo.width, photo.height) : null;
  });
  const window = obsIso ? searchWindow(obsIso) : null;
  if (!field || !window) return null;
  return {
    field,
    params: {
      raDeg: field.raDeg,
      decDeg: field.decDeg,
      radiusArcmin: field.radiusArcmin,
      ...window,
    },
  };
}

/** The transients that fall inside the photo, on its pixels: confirmed supernovae first. */
export function placeSupernovae(
  photo: SolvedPhoto,
  candidates: TnsCandidate[],
  obsIso: string,
): PlacedTransient[] {
  const placed = withCanonicalProjection(() => {
    const matrix = computePhotoToProjMatrix(photo as Photo);
    return matrix ? placeInImage(candidates, matrix, photo.width, photo.height, obsIso) : [];
  });
  return rankTransients(placed);
}

// ── Comets ──────────────────────────────────────────────────────────────────────────────────────

/** The comets inside the photo at `obsIso` (brightest first) and those just outside it. */
export function cometsInPhoto(
  photo: SolvedPhoto,
  comets: CometElements[],
  obsIso: string,
): CometSearchResult {
  return withCanonicalProjection(() => {
    const matrix = computePhotoToProjMatrix(photo as Photo);
    return matrix
      ? findComets(comets, matrix, photo.width, photo.height, obsIso)
      : { inFrame: [], nearby: [] };
  });
}

/**
 * The points of interest of the chosen comets, each at the pixel the user put its pin on (`moved`, by name), else at
 * its predicted position.
 */
export function cometPois(
  photo: SolvedPhoto,
  chosen: CometSearchResult['inFrame'],
  moved: ReadonlyMap<string, PhotoPixel>,
): PointOfInterest[] {
  return chosen.map((c) => {
    const px = moved.get(c.name);
    const sky = px ? photoPixelsToRaDec(photo, [px])?.[0] : null;
    return cometToPoi(c, sky ?? { ra: c.raDeg, dec: c.decDeg });
  });
}

// ── A point of interest placed by hand, and adding the ones found ─────────────────────────────────

/** A point of interest named `name`, of type `categoryId`, at a pixel of the photo; null without a solve. */
export function poiAtPixel(
  photo: SolvedPhoto,
  px: PhotoPixel,
  name: string,
  categoryId: string,
): PointOfInterest | null {
  const sky = photoPixelsToRaDec(photo, [px]);
  return sky ? { name, categoryId, ra: sky[0].ra, dec: sky[0].dec } : null;
}

/**
 * Adds the points of interest found to a photo's: one already there (same name and type) is skipped rather than
 * listed twice. `fresh` are the ones actually added.
 */
export function mergeIdentifiedPois(
  existing: PointOfInterest[],
  found: PointOfInterest[],
): { merged: PointOfInterest[]; fresh: PointOfInterest[] } {
  const fresh = found.filter(
    (poi) => !existing.some((p) => p.name === poi.name && p.categoryId === poi.categoryId),
  );
  return { merged: [...existing, ...fresh], fresh };
}
