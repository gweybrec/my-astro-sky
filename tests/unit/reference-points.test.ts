import { describe, it, expect } from 'vitest';
import { checkReferencePoints, type ReferencePoint } from '@myastrosky/core/reference-points';

const W = 2000;
const H = 1000;

/** A point at a fraction of the photo, on a sky that maps 1 px to 0.001° with no rotation. */
const at = (fx: number, fy: number): ReferencePoint => ({
  photoX: fx * W,
  photoY: fy * H,
  starRa: 100 - fx * W * 0.001,
  starDec: 20 - fy * H * 0.001,
});

const grid = (fractions: number[]) => fractions.flatMap((fy) => fractions.map((fx) => at(fx, fy)));

describe('checkReferencePoints()', () => {
  it('accepts points at the corners and the centre', () => {
    expect(checkReferencePoints(grid([0.05, 0.5, 0.95]), W, H)).toEqual([]);
  });

  it('accepts a wide panorama: the spread is measured on the photo scaled to a square', () => {
    const wide = (p: ReferencePoint) => ({ ...p, photoX: p.photoX * 10 });
    const points = [at(0.05, 0.05), at(0.95, 0.05), at(0.5, 0.95)].map(wide);
    expect(checkReferencePoints(points, 10 * W, H)).toEqual([]);
  });

  it('needs at least 3 points with a sky position', () => {
    expect(checkReferencePoints([at(0.1, 0.1), at(0.9, 0.9)], W, H)).toEqual(['tooFew']);
    const noSky = { ...at(0.1, 0.9), starRa: undefined };
    expect(checkReferencePoints([at(0.1, 0.1), at(0.9, 0.9), noSky], W, H)).toEqual(['tooFew']);
  });

  it('rejects a point outside the photo', () => {
    expect(checkReferencePoints([...grid([0.05, 0.95]), at(1.2, 0.5)], W, H)).toContain('outside');
  });

  it('rejects points close to a line', () => {
    const line = [at(0.05, 0.1), at(0.5, 0.5), at(0.95, 0.9), at(0.5, 0.52)];
    expect(checkReferencePoints(line, W, H)).toContain('inALine');
  });

  it('rejects points that sit in one part of the photo', () => {
    expect(checkReferencePoints(grid([0.1, 0.3]), W, H)).toEqual(['notCovering']);
  });

  it('rejects the 4 stars the Abell 24 photo was once stored with', () => {
    // Two of them 10 px apart, nearly in a line, all in the upper right: the far side of the photo was extrapolated.
    const stars: ReferencePoint[] = [
      { photoX: 1607.38, photoY: 412.76, starRa: 117.6975, starDec: 3.2773 },
      { photoX: 1131.47, photoY: 255.62, starRa: 118.03, starDec: 3.2773 },
      { photoX: 2043.71, photoY: 646.17, starRa: 117.3741, starDec: 3.221 },
      { photoX: 2039.97, photoY: 637.79, starRa: 117.3782, starDec: 3.2255 },
    ];
    expect(checkReferencePoints(stars, 2367, 1349)).toEqual(['inALine', 'notCovering']);
  });

  it('rejects sky positions that are all the same or in a line', () => {
    const same = grid([0.05, 0.95]).map((p) => ({ ...p, starRa: 100, starDec: 20 }));
    expect(checkReferencePoints(same, W, H)).toEqual(['skyInALine']);
    const line = grid([0.05, 0.95]).map((p) => ({ ...p, starDec: 20 }));
    expect(checkReferencePoints(line, W, H)).toEqual(['skyInALine']);
  });

  it('measures sky offsets across the 0°/360° line of right ascension', () => {
    const wrapped = grid([0.05, 0.5, 0.95]).map((p) => ({
      ...p,
      starRa: ((p.starRa as number) - 99.5 + 360) % 360,
    }));
    expect(checkReferencePoints(wrapped, W, H)).toEqual([]);
  });
});
