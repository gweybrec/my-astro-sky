import { IN_A_LINE_SPREAD, pointSpread } from './affine';

/** A point of a photo whose sky position is known: what a plate solution or a matched star gives. */
export interface ReferencePoint {
  photoX: number;
  photoY: number;
  starRa?: number | null;
  starDec?: number | null;
}

/**
 * Why a photo's reference points would not place it well enough:
 * - `tooFew`: fewer than 3 points with a sky position (2 cannot tell a mirrored photo);
 * - `outside`: a point lies outside the photo;
 * - `inALine`: the points are close to a line, so a position away from it is poorly known;
 * - `notCovering`: the points sit in one part of the photo, so its far side is extrapolated, and the
 *   photo's centre and extent on the sky (taken from the points) are wrong;
 * - `skyInALine`: their sky positions are all the same or in a line, so the photo has no size or shape on the sky.
 */
export type ReferencePointProblem = 'tooFew' | 'outside' | 'inALine' | 'notCovering' | 'skyInALine';

/** Least spread, on the photo scaled to a unit square: the points' spread across their line at least a fifth of along. */
const MIN_SPREAD = 0.04;
/** Least share of the photo's width and of its height that the points must span. */
const MIN_COVER = 0.5;

/**
 * The problems that keep `points` from placing a `width` × `height` photo for everything that is computed from them:
 * its place on the sky map, the objects and asteroids drawn on it, the objects listed at import, and the photo's
 * centre and extent on the sky. Empty when they are good.
 */
export function checkReferencePoints(
  points: readonly ReferencePoint[],
  width: number,
  height: number,
): ReferencePointProblem[] {
  const usable = points.filter(
    (p) =>
      Number.isFinite(p.photoX) &&
      Number.isFinite(p.photoY) &&
      Number.isFinite(p.starRa) &&
      Number.isFinite(p.starDec),
  );
  if (usable.length < 3 || !(width > 0) || !(height > 0)) return ['tooFew'];

  const problems: ReferencePointProblem[] = [];
  const unit = usable.map((p) => ({ x: p.photoX / width, y: p.photoY / height }));
  if (unit.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) problems.push('outside');
  if (pointSpread(unit) < MIN_SPREAD) problems.push('inALine');
  const xs = unit.map((p) => p.x);
  const ys = unit.map((p) => p.y);
  if (
    Math.max(...xs) - Math.min(...xs) < MIN_COVER ||
    Math.max(...ys) - Math.min(...ys) < MIN_COVER
  ) {
    problems.push('notCovering');
  }
  // Offsets on the sky from the first point, in degrees (RA scaled by cos Dec, across the 0°/360° line).
  const first = usable[0];
  const cosDec = Math.cos(((first.starDec as number) * Math.PI) / 180);
  const sky = usable.map((p) => ({
    x: ((((p.starRa as number) - (first.starRa as number) + 540) % 360) - 180) * cosDec,
    y: (p.starDec as number) - (first.starDec as number),
  }));
  if (!(pointSpread(sky) > IN_A_LINE_SPREAD)) problems.push('skyInALine');
  return problems;
}
