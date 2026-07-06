import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCorrRaDec,
  fitPhotoAffine,
  buildPhotoProjPoints,
  buildPhotoPoints,
  projCentroidAndHalfDiag,
  isCentroidInsideBorder,
  isCentroidViewportCulled,
  mapPhotoCorners,
  computePhotoQuadCorners,
  computePhotoMatrixForView,
  computePhotoCenterAndScale,
  computePhotoCenter,
  isLabelAllowed,
  isPoiAllowed,
  manualPlacementCentroid,
  computeManualMatrix,
  buildSyntheticCorrespondences,
  extractMatrixFromTransform,
  derivePlacementFromCorrespondences,
  derivePlacementFromMatrix,
} from '../../src/photo-placement';
import {
  project,
  toCanvas,
  setHemisphere,
  setProjectionMode,
  setCenterMode,
} from '../../src/projection';
import type { Photo, PhotoCorrespondence, ManualPlacement, ViewState } from '../../src/types';

const VIEW: ViewState = {
  centerX: 0,
  centerY: 0,
  scale: 100,
  rotationDeg: 0,
  width: 800,
  height: 600,
};

function corr(
  pointIndex: number,
  photoX: number,
  photoY: number,
  ra: number,
  dec: number,
): PhotoCorrespondence {
  return {
    pointIndex,
    photoX,
    photoY,
    starHip: 0,
    starRa: ra,
    starDec: dec,
    starName: `pt${pointIndex}`,
  };
}

function makePhoto(correspondences: PhotoCorrespondence[], extra?: Partial<Photo>): Photo {
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'p1',
    width: 100,
    height: 80,
    correspondences,
    ...extra,
  } as Photo;
}

// The module reads global projection state; pin it so results are deterministic.
beforeEach(() => {
  setCenterMode('pole');
  setProjectionMode('stereo');
  setHemisphere('north');
});

describe('getCorrRaDec', () => {
  it('uses stored starRa/starDec when present', () => {
    expect(getCorrRaDec(corr(0, 0, 0, 12.5, -3.25))).toEqual({ ra: 12.5, dec: -3.25 });
  });

  it('returns null when neither stored coords nor a HIP number resolve', () => {
    const c = { pointIndex: 0, photoX: 0, photoY: 0, starHip: 0, starName: 'x' } as any;
    expect(getCorrRaDec(c)).toBeNull();
  });
});

describe('fitPhotoAffine', () => {
  it('fits an identity similarity from 2 matched points', () => {
    const m = fitPhotoAffine(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    );
    expect(m.a).toBeCloseTo(1);
    expect(m.b).toBeCloseTo(0);
    expect(m.c).toBeCloseTo(0);
    expect(m.d).toBeCloseTo(1);
    expect(m.e).toBeCloseTo(0);
    expect(m.f).toBeCloseTo(0);
  });

  it('fits an exact affine from 3 points (recovers a known translation+scale)', () => {
    const src = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const dst = src.map((p) => ({ x: 2 * p.x + 5, y: 3 * p.y - 1 }));
    const m = fitPhotoAffine(src, dst);
    for (const p of src) {
      expect(m.a * p.x + m.c * p.y + m.e).toBeCloseTo(2 * p.x + 5);
      expect(m.b * p.x + m.d * p.y + m.f).toBeCloseTo(3 * p.y - 1);
    }
  });

  it('throws on colinear (degenerate) points', () => {
    expect(() =>
      fitPhotoAffine(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
      ),
    ).toThrow();
  });
});

describe('buildPhotoProjPoints / buildPhotoPoints', () => {
  it('skips correspondences whose star cannot be resolved', () => {
    const photo = makePhoto([
      corr(0, 10, 10, 0, 80),
      { pointIndex: 1, photoX: 20, photoY: 20, starHip: 0, starName: 'unresolved' } as any,
      corr(2, 30, 30, 90, 60),
    ]);
    const { photoPoints, projPoints } = buildPhotoProjPoints(photo);
    expect(photoPoints).toHaveLength(2);
    expect(projPoints).toHaveLength(2);
    expect(photoPoints[0]).toEqual({ x: 10, y: 10 });
  });

  it('buildPhotoPoints also yields canvas points at the view', () => {
    const photo = makePhoto([corr(0, 0, 0, 0, 90)]);
    const { projPoints, canvasPoints } = buildPhotoPoints(photo, VIEW);
    // Dec 90 → celestial pole → projection origin → canvas centre.
    expect(projPoints[0].x).toBeCloseTo(0);
    expect(projPoints[0].y).toBeCloseTo(0);
    expect(canvasPoints[0].x).toBeCloseTo(VIEW.width / 2);
    expect(canvasPoints[0].y).toBeCloseTo(VIEW.height / 2);
  });
});

describe('projCentroidAndHalfDiag', () => {
  it('computes the average centroid and max radius', () => {
    const { centroid, halfDiag } = projCentroidAndHalfDiag([
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 2 },
    ]);
    expect(centroid.x).toBeCloseTo(0);
    expect(centroid.y).toBeCloseTo(2 / 3);
    // Farthest point is (0,2): distance = |2 - 2/3| = 4/3.
    expect(halfDiag).toBeCloseTo(4 / 3);
  });
});

describe('border + viewport culling predicates', () => {
  it('isCentroidInsideBorder is inclusive of the boundary', () => {
    expect(isCentroidInsideBorder({ x: 0.6, y: 0.8 }, 1)).toBe(true); // r = 1.0 exactly
    expect(isCentroidInsideBorder({ x: 1, y: 1 }, 1)).toBe(false); // r ≈ 1.41
  });

  it('isCentroidViewportCulled: on-screen not culled, far off-screen culled', () => {
    expect(isCentroidViewportCulled({ x: 0, y: 0 }, 0.5, VIEW)).toBe(false);
    expect(isCentroidViewportCulled({ x: 100, y: 0 }, 0.5, VIEW)).toBe(true);
  });
});

describe('mapPhotoCorners', () => {
  it('maps the four photo corners through the matrix', () => {
    const m = { a: 1, b: 0, c: 0, d: 1, e: 5, f: 7 };
    const corners = mapPhotoCorners(m, 10, 20);
    expect(corners).toEqual([
      { x: 5, y: 7 },
      { x: 15, y: 7 },
      { x: 15, y: 27 },
      { x: 5, y: 27 },
    ]);
  });
});

describe('geometry getters', () => {
  it('computePhotoCenter round-trips a single correspondence position', () => {
    const center = computePhotoCenter(makePhoto([corr(0, 0, 0, 123, 45)]));
    expect(center).not.toBeNull();
    expect(center!.ra).toBeCloseTo(123);
    expect(center!.dec).toBeCloseTo(45);
  });

  it('computePhotoCenter returns null with no correspondences', () => {
    expect(computePhotoCenter(makePhoto([]))).toBeNull();
  });

  it('computePhotoCenterAndScale needs ≥2 correspondences', () => {
    expect(computePhotoCenterAndScale(makePhoto([corr(0, 0, 0, 0, 80)]), 800, 600)).toBeNull();
    const fit = computePhotoCenterAndScale(
      makePhoto([corr(0, 0, 0, 0, 80), corr(1, 100, 0, 5, 80), corr(2, 0, 80, 0, 78)]),
      800,
      600,
    );
    expect(fit).not.toBeNull();
    expect(Number.isFinite(fit!.scale)).toBe(true);
    expect(fit!.scale).toBeGreaterThan(0);
  });

  it('computePhotoQuadCorners returns 4 corners or null', () => {
    expect(computePhotoQuadCorners(makePhoto([corr(0, 0, 0, 0, 80)]), VIEW)).toBeNull();
    const corners = computePhotoQuadCorners(
      makePhoto([corr(0, 0, 0, 0, 80), corr(1, 100, 80, 5, 78)]),
      VIEW,
    );
    expect(corners).toHaveLength(4);
  });

  it('computePhotoMatrixForView returns null when centroid is outside the border', () => {
    // borderRadiusPU = 0 → nothing can be inside.
    const m = computePhotoMatrixForView(
      makePhoto([corr(0, 0, 0, 0, 10), corr(1, 100, 80, 5, 10)]),
      VIEW,
      0,
    );
    expect(m).toBeNull();
  });
});

describe('visibility predicates', () => {
  it('isLabelAllowed honours the filter map', () => {
    const photo = makePhoto([], { labels: ['A'] });
    expect(isLabelAllowed(photo, {})).toBe(true); // no filter
    expect(isLabelAllowed(photo, { A: true, B: false })).toBe(true);
    expect(isLabelAllowed(photo, { A: false })).toBe(false);
  });

  it('isLabelAllowed uses the (no label) key for unlabeled photos', () => {
    const photo = makePhoto([], { labels: [] });
    expect(isLabelAllowed(photo, { '(no label)': false })).toBe(false);
    expect(isLabelAllowed(photo, { '(no label)': true })).toBe(true);
  });

  it('isPoiAllowed allows everything when no POI filter is set', () => {
    expect(isPoiAllowed(makePhoto([]), [], null)).toBe(true);
  });
});

describe('manual placement math', () => {
  const placement: ManualPlacement = {
    centerRa: 0,
    centerDec: 90,
    rotationDeg: 0,
    projPerPx: 0.002,
    mirrorX: false,
    mirrorY: false,
  };

  it('manualPlacementCentroid centres on the placed sky point', () => {
    const { centroid, halfDiag } = manualPlacementCentroid(placement, 100, 80);
    const expected = project(placement.centerRa, placement.centerDec);
    expect(centroid.x).toBeCloseTo(expected.x);
    expect(centroid.y).toBeCloseTo(expected.y);
    expect(halfDiag).toBeCloseTo(Math.hypot(50, 40) * 0.002);
  });

  it('computeManualMatrix maps the image centre to the placed canvas point', () => {
    const m = computeManualMatrix(placement, VIEW, 100, 80);
    const p = project(placement.centerRa, placement.centerDec);
    const expected = toCanvas(p.x, p.y, VIEW);
    const mappedX = m.a * 50 + m.c * 40 + m.e;
    const mappedY = m.b * 50 + m.d * 40 + m.f;
    expect(mappedX).toBeCloseTo(expected.x);
    expect(mappedY).toBeCloseTo(expected.y);
  });

  it('derivePlacementFromMatrix inverts computeManualMatrix', () => {
    const p: ManualPlacement = {
      centerRa: 10,
      centerDec: 45,
      rotationDeg: 30,
      projPerPx: 0.002,
      mirrorX: false,
      mirrorY: false,
    };
    const m = computeManualMatrix(p, VIEW, 100, 80);
    const back = derivePlacementFromMatrix(m, VIEW, 100, 80);
    expect(back.centerRa).toBeCloseTo(p.centerRa, 3);
    expect(back.centerDec).toBeCloseTo(p.centerDec, 3);
    expect(back.rotationDeg).toBeCloseTo(p.rotationDeg, 3);
    expect(back.projPerPx).toBeCloseTo(p.projPerPx, 6);
    expect(back.mirrorY).toBe(false);
  });

  it('manual → synthetic correspondences → derive round-trips the placement', () => {
    const p: ManualPlacement = {
      centerRa: 40,
      centerDec: 55,
      rotationDeg: 12,
      projPerPx: 0.0015,
      mirrorX: false,
      mirrorY: false,
    };
    const synth = buildSyntheticCorrespondences(p, 100, 80, VIEW);
    expect(synth).toHaveLength(3);
    expect(synth.map((c) => c.pointIndex)).toEqual([0, 1, 2]);
    expect(synth.every((c) => c.starHip === 0 && Number.isFinite(c.starRa!))).toBe(true);

    const derived = derivePlacementFromCorrespondences(makePhoto(synth), 100, 80);
    expect(derived.centerRa).toBeCloseTo(p.centerRa, 2);
    expect(derived.centerDec).toBeCloseTo(p.centerDec, 2);
    expect(derived.projPerPx).toBeCloseTo(p.projPerPx, 4);
  });

  it('derivePlacementFromCorrespondences falls back to the default with <3 points', () => {
    const d = derivePlacementFromCorrespondences(makePhoto([corr(0, 0, 0, 0, 80)]), 100, 80);
    expect(d).toEqual({
      centerRa: 0,
      centerDec: 60,
      rotationDeg: 0,
      projPerPx: 0.002,
      mirrorX: false,
      mirrorY: false,
    });
  });
});

describe('extractMatrixFromTransform', () => {
  it('parses a CSS matrix(...) string', () => {
    expect(extractMatrixFromTransform('matrix(1, 2, 3, 4, 5, 6)')).toEqual({
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      e: 5,
      f: 6,
    });
  });

  it('returns null for none / missing / malformed transforms', () => {
    expect(extractMatrixFromTransform('none')).toBeNull();
    expect(extractMatrixFromTransform('')).toBeNull();
    expect(extractMatrixFromTransform('translate(1px, 2px)')).toBeNull();
    expect(extractMatrixFromTransform('matrix(1, 2, 3)')).toBeNull();
  });
});
