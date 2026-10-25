import { describe, expect, it } from 'vitest';
import { photoAsShown, quarterTurnsOf, rotatePhotoRight } from '@myastrosky/core/photo-rotation';
import { computePhotoToProjMatrix } from '@myastrosky/core/photo-placement';
import { applyAffine } from '@myastrosky/core/affine';
import type { ManualPlacement, Photo, PhotoCorrespondence } from '@myastrosky/core/types';

const W = 4000;
const H = 3000;
/** Where a pixel of the photo falls in the sky's projection. */
const sky = (photo: Photo, x: number, y: number) =>
  applyAffine(computePhotoToProjMatrix(photo)!, { x, y });
/** The pixel (x, y) of the photo before it was turned right, in the turned picture. */
const turned = (x: number, y: number): [number, number] => [H - y, x];

const photo = (over: Partial<Photo>): Photo =>
  ({
    id: 'p1',
    width: W,
    height: H,
    correspondences: [],
    dsoIds: ['M31'],
    pointsOfInterest: [{ name: 'C/2023 A3', categoryId: 'c', ra: 10, dec: 41 }],
    ...over,
  }) as Photo;

describe('rotatePhotoRight', () => {
  it('swaps the size and moves the matched stars with their pixels', () => {
    const correspondences: PhotoCorrespondence[] = [
      {
        pointIndex: 0,
        photoX: 100,
        photoY: 200,
        starHip: 0,
        starName: 'a',
        starRa: 10,
        starDec: 41,
      },
      {
        pointIndex: 1,
        photoX: 3500,
        photoY: 400,
        starHip: 0,
        starName: 'b',
        starRa: 11.5,
        starDec: 41.2,
      },
      {
        pointIndex: 2,
        photoX: 1800,
        photoY: 2700,
        starHip: 0,
        starName: 'c',
        starRa: 10.6,
        starDec: 40.1,
      },
    ];
    const before = photo({ correspondences });
    const after = rotatePhotoRight(before);
    expect([after.width, after.height]).toEqual([H, W]);
    expect(after.correspondences.map((c) => [c.photoX, c.photoY])).toEqual([
      [2800, 100],
      [2600, 3500],
      [300, 1800],
    ]);
    expect(after.correspondences.map((c) => c.starName)).toEqual(['a', 'b', 'c']);
    // a point of the sky lands on the turned pixel
    for (const [x, y] of [
      [0, 0],
      [1234, 567],
      [W, H],
    ]) {
      const [tx, ty] = turned(x, y);
      const a = sky(before, x, y);
      const b = sky(after, tx, ty);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
    }
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('keeps a hand-placed photo on the same sky (mirrors %s, %s)', (mirrorX, mirrorY) => {
    const manualPlacement: ManualPlacement = {
      centerRa: 83.8,
      centerDec: -5.4,
      rotationDeg: 30,
      projPerPx: 0.0003,
      mirrorX,
      mirrorY,
    };
    const before = photo({ manualPlacement });
    const after = rotatePhotoRight(before);
    expect(after.manualPlacement).toMatchObject({
      centerRa: 83.8,
      projPerPx: 0.0003,
      mirrorX,
      mirrorY,
    });
    for (const [x, y] of [
      [0, 0],
      [1234, 567],
      [W, H],
      [W / 2, H / 2],
    ]) {
      const [tx, ty] = turned(x, y);
      const a = sky(before, x, y);
      const b = sky(after, tx, ty);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
    }
  });

  it('comes back to the photo after four turns, and leaves the sky-side data alone', () => {
    const before = photo({
      manualPlacement: {
        centerRa: 1,
        centerDec: 2,
        rotationDeg: -170,
        projPerPx: 0.001,
        mirrorX: false,
        mirrorY: false,
      },
    });
    let p = before;
    for (let i = 0; i < 4; i++) p = rotatePhotoRight(p);
    expect(p.width).toBe(W);
    expect(p.manualPlacement!.rotationDeg).toBeCloseTo(-170);
    expect(
      rotatePhotoRight(photo({ manualPlacement: { ...before.manualPlacement!, angleOnSky: true } }))
        .manualPlacement!.angleOnSky,
    ).toBe(true);
    expect(p.dsoIds).toEqual(['M31']);
    expect(p.pointsOfInterest).toEqual(before.pointsOfInterest);
  });
});

describe('photoAsShown', () => {
  const correspondences: PhotoCorrespondence[] = [
    { pointIndex: 0, photoX: 100, photoY: 200, starHip: 0, starName: 'a', starRa: 10, starDec: 41 },
    {
      pointIndex: 1,
      photoX: 3500,
      photoY: 400,
      starHip: 0,
      starName: 'b',
      starRa: 11.5,
      starDec: 41.2,
    },
  ];

  it('is the photo itself, without quarterTurns, when it is not turned', () => {
    const p = photo({ correspondences });
    expect(photoAsShown(p)).toEqual(p);
    expect(photoAsShown({ ...p, quarterTurns: 0 })).toEqual(p);
  });

  it('is the photo turned right as many times as quarterTurns says, and is not turned again', () => {
    const p = photo({ correspondences });
    let expected = p;
    for (const turns of [1, 2, 3] as const) {
      expected = rotatePhotoRight(expected);
      const shown = photoAsShown({ ...p, quarterTurns: turns });
      expect(shown).toEqual(expected);
      expect(shown).not.toHaveProperty('quarterTurns');
      expect(photoAsShown(shown)).toEqual(shown);
    }
  });

  it('keeps every pixel of the shown photo on the same place of the sky', () => {
    const p = photo({ correspondences });
    const shown = photoAsShown({ ...p, quarterTurns: 3 });
    // three turns right are one turn left: (x, y) of the W x H picture becomes (y, W - x)
    const a = sky(p, 1234, 567);
    const b = sky(shown, 567, W - 1234);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  });

  it('reads 1, 2 and 3 as turns and anything else as none', () => {
    expect(
      [1, 2, 3, 0, 4, -1, 1.5, undefined, null].map((q) => quarterTurnsOf({ quarterTurns: q })),
    ).toEqual([1, 2, 3, 0, 0, 0, 0, 0, 0]);
  });
});
