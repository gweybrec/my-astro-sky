/**
 * Pure logic for identifying comets in a solved photo: propagates the MPC comet
 * elements (`src/comet-ephemeris.ts`) to the observation date, keeps the comets
 * that land inside the frame, and lists those just outside it — a comet moves
 * fast enough that a wrong observation date pushes it degrees away, and the
 * "nearby" list makes that diagnosable.
 *
 * Nothing here touches the DOM or fetch — `CometIdentifyModal.vue` composes these
 * functions with `src/api.ts` (`/api/comets/elements`).
 * See `tests/unit/comet-identify.test.ts`.
 */
import type { AffineMatrix, PointOfInterest } from './types';
import { applyAffine, invertAffine } from './affine';
import { project } from './projection';
import { angularSeparationDeg } from './sky-geometry';
import { isoToJd } from './asteroid-identify';
import { photoFieldCircle } from './supernova-identify';
import {
  cometRaDec,
  cometRateArcminPerHour,
  cometTotalMag,
  type CometElements,
} from './comet-ephemeris';

export const COMET_CATEGORY_ID = 'cat-comet';

/** Comets predicted fainter than this are ignored (beyond amateur reach). */
export const MAX_COMET_MAG = 20;
/** Comets outside the frame but within this distance of its edge are listed as "nearby". */
export const NEARBY_RADIUS_DEG = 3;

/** A comet predicted inside the photo, in photo pixels. */
export interface PlacedComet {
  designation: string;
  name: string;
  raDeg: number;
  decDeg: number;
  x: number;
  y: number;
  mag: number | null;
  rateArcminPerHour: number;
}

/** A comet predicted outside the photo, but close to it. */
export interface NearbyComet {
  designation: string;
  name: string;
  mag: number | null;
  /** Angular distance from the photo centre, degrees. */
  separationDeg: number;
}

export interface CometSearchResult {
  inFrame: PlacedComet[];
  nearby: NearbyComet[];
}

/**
 * Places every comet at the observation time: inside the frame (pixel position,
 * brightest first) or within {@link NEARBY_RADIUS_DEG} of it (closest first).
 * `photoToProj` and the projections here must share one projection state: call
 * inside `withCanonicalProjection` (the display modes clip and rotate).
 */
export function findComets(
  elements: CometElements[],
  photoToProj: AffineMatrix,
  width: number,
  height: number,
  obsIso: string,
): CometSearchResult {
  const empty: CometSearchResult = { inFrame: [], nearby: [] };
  const obsMs = Date.parse(obsIso);
  const inv = invertAffine(photoToProj);
  if (!Number.isFinite(obsMs) || !inv) return empty;
  const jd = isoToJd(obsIso);
  const field = photoFieldCircle(photoToProj, width, height, Number.POSITIVE_INFINITY);
  const maxSepDeg = field.radiusArcmin / 60 + NEARBY_RADIUS_DEG;

  const inFrame: PlacedComet[] = [];
  const nearby: NearbyComet[] = [];
  for (const el of elements) {
    const pos = cometRaDec(el, jd);
    const separationDeg = angularSeparationDeg(field.raDeg, field.decDeg, pos.raDeg, pos.decDeg);
    if (!(separationDeg <= maxSepDeg)) continue;
    const mag = cometTotalMag(el, pos.rAu, pos.deltaAu);
    if (mag !== null && mag > MAX_COMET_MAG) continue;

    const p = applyAffine(inv, project(pos.raDeg, pos.decDeg));
    const inside =
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      p.x >= 0 &&
      p.x <= width &&
      p.y >= 0 &&
      p.y <= height;
    if (inside) {
      inFrame.push({
        designation: el.designation,
        name: el.name,
        raDeg: pos.raDeg,
        decDeg: pos.decDeg,
        x: p.x,
        y: p.y,
        mag,
        rateArcminPerHour: cometRateArcminPerHour(el, jd),
      });
    } else {
      nearby.push({ designation: el.designation, name: el.name, mag, separationDeg });
    }
  }

  const byMag = (a: { mag: number | null }, b: { mag: number | null }) =>
    (a.mag ?? Number.POSITIVE_INFINITY) - (b.mag ?? Number.POSITIVE_INFINITY);
  inFrame.sort(byMag);
  nearby.sort((a, b) => a.separationDeg - b.separationDeg);
  return { inFrame, nearby };
}

/** JPL Small-Body Database page for a comet designation. */
export function jplLookupUrl(designation: string): string {
  return `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(designation)}`;
}

/**
 * The POI saved for a chosen comet, pinned at `position` — the predicted one, or
 * wherever the user clicked the nucleus when the prediction was off.
 */
export function candidateToPoi(
  c: Pick<PlacedComet, 'name'>,
  position: { ra: number; dec: number },
): PointOfInterest {
  const ra = ((position.ra % 360) + 360) % 360;
  return { name: c.name, categoryId: COMET_CATEGORY_ID, ra, dec: position.dec };
}
