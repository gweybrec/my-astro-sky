import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildLabelFilterItems,
  getCorrRaDec,
  isCentroidInsideBorder,
  isCentroidViewportCulled,
  computePhotoQuadCorners,
  computePhotoCanvasMesh,
  computePhotoCenterAndScale,
  computePhotoCenter,
  isLabelAllowed,
  computeManualMatrix,
  computeManualProjMatrix,
  computePhotoToProjMatrix,
  buildSyntheticCorrespondences,
  derivePlacementFromCorrespondences,
  currentPlacement,
  photoSkyModel,
  photoSkyModelAtView,
  withAngleOnSky,
  formatZoomPercent,
} from '@myastrosky/core/photo-placement';
import {
  project,
  toCanvas,
  fromCanvas,
  setHemisphere,
  setProjectionMode,
  setCenterMode,
  unproject,
} from '@myastrosky/core/projection';
import type {
  Photo,
  PhotoCorrespondence,
  ManualPlacement,
  ViewState,
} from '@myastrosky/core/types';
import { linearPhotoSkyModel, type PhotoSkyModel } from '@myastrosky/core/photo-sky-model';

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

/**
 * A `width` × `height` photo covering `fieldDeg` of sky across its width, centred on (ra, dec), turned by `angleDeg`,
 * not mirrored (north up and east left at angle 0, as a photo of the sky is).
 */
function fieldAround(
  ra: number,
  dec: number,
  fieldDeg: number,
  width = 100,
  height = 80,
  angleDeg = 0,
): PhotoSkyModel {
  const s = (fieldDeg * Math.PI) / 180 / width;
  const t = (angleDeg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(t), Math.sin(t)];
  return linearPhotoSkyModel(
    { ra, dec },
    { a: -s * cos, b: -s * sin, c: s * sin, d: -s * cos },
    width,
    height,
  );
}

/** A correspondence at a pixel of `field`, with the sky position the field gives it. */
function fieldCorr(field: PhotoSkyModel, i: number, x: number, y: number): PhotoCorrespondence {
  const sky = field.toSky(x, y);
  return corr(i, x, y, sky.ra, sky.dec);
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

describe('geometry getters', () => {
  it("computePhotoCenter is the sky position of the photo's centre", () => {
    const field = fieldAround(123, 45, 1, 100, 80);
    const center = computePhotoCenter(
      makePhoto([
        fieldCorr(field, 0, 10, 10),
        fieldCorr(field, 1, 90, 20),
        fieldCorr(field, 2, 30, 70),
      ]),
    );
    expect(center).not.toBeNull();
    expect(center!.ra).toBeCloseTo(123, 9);
    expect(center!.dec).toBeCloseTo(45, 9);
    // One point cannot place a photo.
    expect(computePhotoCenter(makePhoto([corr(0, 0, 0, 123, 45)]))).toBeNull();
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

  it('computePhotoCenterAndScale returns null when all correspondences map to one point', () => {
    // Distinct photo pixels, identical sky coords → all four projected corners
    // coincide → extentX === extentY === 0 → previously returned { scale: Infinity }.
    const photo = makePhoto([
      corr(0, 0, 0, 30, 45),
      corr(1, 100, 0, 30, 45),
      corr(2, 100, 80, 30, 45),
      corr(3, 0, 80, 30, 45),
    ]);
    expect(computePhotoCenterAndScale(photo, 800, 600)).toBeNull();
  });

  it('computePhotoQuadCorners returns 4 corners or null', () => {
    expect(computePhotoQuadCorners(makePhoto([corr(0, 0, 0, 0, 80)]), VIEW)).toBeNull();
    const corners = computePhotoQuadCorners(
      makePhoto([corr(0, 0, 0, 0, 80), corr(1, 100, 80, 5, 78)]),
      VIEW,
    );
    expect(corners).toHaveLength(4);
  });

  it('computePhotoQuadCorners follows the manual placement, not the correspondences', () => {
    const placement: ManualPlacement = {
      centerRa: 0,
      centerDec: 90,
      rotationDeg: 0,
      projPerPx: 0.002,
      mirrorX: false,
      mirrorY: false,
    };
    // Two correspondences far apart would give a huge outline; the manual placement gives the small one.
    const photo = makePhoto([corr(0, 0, 0, 0, 80), corr(1, 100, 80, 5, 78)], {
      manualPlacement: placement,
      width: 100,
      height: 80,
    });
    // On a small field the corners are where the placement's own matrix puts them (the sky's curvature only shows
    // on a wide one), and nowhere near the correspondences' outline.
    const small = { ...placement, centerDec: 60, projPerPx: 0.00002 };
    const smallPhoto = { ...photo, manualPlacement: small };
    const corners = computePhotoQuadCorners(smallPhoto, VIEW)!;
    const m = computeManualMatrix(small, VIEW, 100, 80);
    const expected = [
      [0, 0],
      [100, 0],
      [100, 80],
      [0, 80],
    ].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
    corners.forEach((c, i) => {
      expect(c.x).toBeCloseTo(expected[i].x, 4);
      expect(c.y).toBeCloseTo(expected[i].y, 4);
    });
    // A manually placed photo has an outline without any correspondence.
    const bare = makePhoto([], { manualPlacement: placement, width: 100, height: 80 });
    expect(computePhotoQuadCorners(bare, VIEW)).toHaveLength(4);
  });

  it('computePhotoCanvasMesh returns null when the centre is outside the border', () => {
    const photo = makePhoto([corr(0, 0, 0, 0, 10), corr(1, 100, 80, 5, 10)]);
    // borderRadiusPU = 0 → nothing can be inside.
    expect(computePhotoCanvasMesh(photo, VIEW, 0)).toBeNull();
    const mesh = computePhotoCanvasMesh(photo, VIEW, Infinity)!;
    expect(mesh.points).toHaveLength((mesh.n + 1) * (mesh.n + 1));
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

  it('computeManualMatrix maps the image centre to the placed canvas point', () => {
    const m = computeManualMatrix(placement, VIEW, 100, 80);
    const p = project(placement.centerRa, placement.centerDec);
    const expected = toCanvas(p.x, p.y, VIEW);
    const mappedX = m.a * 50 + m.c * 40 + m.e;
    const mappedY = m.b * 50 + m.d * 40 + m.f;
    expect(mappedX).toBeCloseTo(expected.x);
    expect(mappedY).toBeCloseTo(expected.y);
  });

  it('computeManualProjMatrix maps the image centre to the placed sky projection point', () => {
    const m = computeManualProjMatrix(placement, 100, 80);
    const expected = project(placement.centerRa, placement.centerDec);
    const mappedX = m.a * 50 + m.c * 40 + m.e;
    const mappedY = m.b * 50 + m.d * 40 + m.f;
    expect(mappedX).toBeCloseTo(expected.x);
    expect(mappedY).toBeCloseTo(expected.y);
  });

  it('computeManualProjMatrix matches computeManualMatrix composed with fromCanvas', () => {
    const p: ManualPlacement = {
      centerRa: 20,
      centerDec: 35,
      rotationDeg: 25,
      projPerPx: 0.0018,
      mirrorX: true,
      mirrorY: false,
    };
    const projM = computeManualProjMatrix(p, 100, 80);
    const canvasM = computeManualMatrix(p, VIEW, 100, 80);
    for (const [x, y] of [
      [0, 0],
      [100, 0],
      [30, 80],
    ]) {
      const viaProj = {
        x: projM.a * x + projM.c * y + projM.e,
        y: projM.b * x + projM.d * y + projM.f,
      };
      const canvasPt = {
        x: canvasM.a * x + canvasM.c * y + canvasM.e,
        y: canvasM.b * x + canvasM.d * y + canvasM.f,
      };
      const viaCanvas = fromCanvas(canvasPt.x, canvasPt.y, VIEW);
      expect(viaProj.x).toBeCloseTo(viaCanvas.x, 6);
      expect(viaProj.y).toBeCloseTo(viaCanvas.y, 6);
    }
  });

  it('computePhotoToProjMatrix uses the manual-placement path when present', () => {
    const photo = makePhoto([], { manualPlacement: placement, width: 100, height: 80 });
    const m = computePhotoToProjMatrix(photo);
    expect(m).not.toBeNull();
    const expected = computeManualProjMatrix(placement, 100, 80);
    expect(m).toEqual(expected);
  });

  it('computePhotoToProjMatrix falls back to correspondences when there is no manual placement', () => {
    const photo = makePhoto([
      corr(0, 0, 0, 10, 80),
      corr(1, 100, 0, 20, 80),
      corr(2, 0, 80, 10, 70),
    ]);
    const m = computePhotoToProjMatrix(photo);
    expect(m).not.toBeNull();
    // The affine map closest to the photo's model: on this 10° field, within a thousandth of a projection unit.
    const p0 = project(10, 80);
    expect(m!.e).toBeCloseTo(p0.x, 3);
    expect(m!.f).toBeCloseTo(p0.y, 3);
  });

  it('places a two-star photo the right way round', () => {
    // Two stars cannot tell a mirror: the fit must take the photo as a photo of the sky is (not mirrored), or objects
    // off the line through them land on the wrong side.
    const truth = fieldAround(210, 54, 2, 100, 80, 35);
    const model = photoSkyModel(
      makePhoto([fieldCorr(truth, 0, 10, 10), fieldCorr(truth, 1, 90, 15)]),
    )!;
    const off = model.toSky(50, 70);
    const expected = truth.toSky(50, 70);
    expect(off.ra).toBeCloseTo(expected.ra, 7);
    expect(off.dec).toBeCloseTo(expected.dec, 7);
    // In projection space (y up) such a photo is mirrored.
    const m = computePhotoToProjMatrix(
      makePhoto([fieldCorr(truth, 0, 10, 10), fieldCorr(truth, 1, 90, 15)]),
    )!;
    expect(m.a * m.d - m.b * m.c).toBeLessThan(0);
  });

  it('computePhotoToProjMatrix returns null with fewer than 2 usable correspondences and no manual placement', () => {
    const photo = makePhoto([corr(0, 0, 0, 10, 80)]);
    expect(computePhotoToProjMatrix(photo)).toBeNull();
  });

  it('places a photo on the sky whatever the rotation of the map', () => {
    const p: ManualPlacement = {
      centerRa: 0,
      centerDec: 80,
      rotationDeg: 25,
      projPerPx: 0.002,
      mirrorX: false,
      mirrorY: false,
      angleOnSky: true,
    };
    const turned = { ...VIEW, rotationDeg: 40 };
    const straight = buildSyntheticCorrespondences(p, 100, 80, VIEW);
    const onTurned = buildSyntheticCorrespondences(p, 100, 80, turned);
    for (let i = 0; i < 3; i++) {
      expect(onTurned[i].starRa).toBeCloseTo(straight[i].starRa!, 6);
      expect(onTurned[i].starDec).toBeCloseTo(straight[i].starDec!, 6);
    }
    // And the photo is at the same place on the sky on either map.
    const photo = makePhoto([], { manualPlacement: p });
    const a = photoSkyModelAtView(photo, VIEW)!.toSky(10, 70);
    const b = photoSkyModelAtView(photo, turned)!.toSky(10, 70);
    expect(b.ra).toBeCloseTo(a.ra, 9);
    expect(b.dec).toBeCloseTo(a.dec, 9);
  });

  it('draws a placement saved before the angle was on the sky at its angle on screen, as it was saved', () => {
    // Saved by v0.12.0 at 20° on screen with the map turned by 30°: still drawn at 20° on that map.
    const old: ManualPlacement = {
      centerRa: 83.8,
      centerDec: 22,
      rotationDeg: 20,
      projPerPx: 0.0005,
      mirrorX: false,
      mirrorY: false,
    };
    const turned = { ...VIEW, rotationDeg: 30 };
    const m = computeManualMatrix(old, turned, 100, 80);
    expect((Math.atan2(m.b, m.a) * 180) / Math.PI).toBeCloseTo(20, 6);
    expect(Math.hypot(m.a, m.b)).toBeCloseTo(0.0005 * VIEW.scale, 9);
    const c = toCanvas(project(83.8, 22).x, project(83.8, 22).y, turned);
    expect(m.a * 50 + m.c * 40 + m.e).toBeCloseTo(c.x, 6);
    expect(m.b * 50 + m.d * 40 + m.f).toBeCloseTo(c.y, 6);
  });

  it('withAngleOnSky turns a placement saved on screen into one on the sky drawn the same at that view', () => {
    const old: ManualPlacement = {
      centerRa: 83.8,
      centerDec: 22,
      rotationDeg: 170,
      projPerPx: 0.0005,
      mirrorX: true,
      mirrorY: false,
    };
    const turned = { ...VIEW, rotationDeg: 30 };
    const onSky = withAngleOnSky(old, turned);
    expect(onSky).toMatchObject({ rotationDeg: -160, angleOnSky: true });
    const before = computeManualMatrix(old, turned, 100, 80);
    const after = computeManualMatrix(onSky, turned, 100, 80);
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const)
      expect(after[k]).toBeCloseTo(before[k], 9);
    // One already on the sky is left as it is.
    expect(withAngleOnSky(onSky, { ...VIEW, rotationDeg: -75 })).toBe(onSky);
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
    expect(derived.rotationDeg).toBeCloseTo(p.rotationDeg, 2);
    expect(derived.mirrorX).toBe(false);
  });

  it('derive gives back the angle and the mirror of a mirrored placement', () => {
    const p: ManualPlacement = {
      centerRa: 210.85,
      centerDec: 54.34,
      rotationDeg: -66,
      projPerPx: 0.0015,
      mirrorX: true,
      mirrorY: false,
    };
    const synth = buildSyntheticCorrespondences(p, 100, 80, VIEW);
    const derived = derivePlacementFromCorrespondences(makePhoto(synth), 100, 80);
    expect(derived.rotationDeg).toBeCloseTo(p.rotationDeg, 2);
    expect(derived.mirrorX).toBe(true);
    // The derived placement puts every photo point where the correspondences say.
    const m = computeManualProjMatrix(derived, 100, 80);
    for (const c of synth) {
      const sky = project(c.starRa!, c.starDec!);
      expect(m.a * c.photoX + m.c * c.photoY + m.e).toBeCloseTo(sky.x, 6);
      expect(m.b * c.photoX + m.d * c.photoY + m.f).toBeCloseTo(sky.y, 6);
    }
  });

  it('currentPlacement gives a manual placement back, its angle on the sky', () => {
    const p: ManualPlacement = {
      centerRa: 40,
      centerDec: 55,
      rotationDeg: 12,
      projPerPx: 0.0015,
      mirrorX: true,
      mirrorY: false,
    };
    const photo = makePhoto([], { manualPlacement: p });
    expect(currentPlacement(photo, { ...VIEW, rotationDeg: 30 })).toEqual({
      ...p,
      rotationDeg: 42,
      angleOnSky: true,
    });
    const onSky = { ...p, angleOnSky: true };
    expect(currentPlacement(makePhoto([], { manualPlacement: onSky }), VIEW)).toEqual(onSky);
  });

  it('currentPlacement draws a plate-solved photo where its correspondences put it', () => {
    const p: ManualPlacement = {
      centerRa: 210.85,
      centerDec: 54.34,
      rotationDeg: -66,
      projPerPx: 0.00002,
      mirrorX: false,
      mirrorY: false,
    };
    const photo = makePhoto(buildSyntheticCorrespondences(p, 100, 80, VIEW));
    const placed = currentPlacement(photo, VIEW);
    expect(placed.rotationDeg).toBe(-66);
    const solved = computePhotoToProjMatrix(photo)!;
    const m = computeManualProjMatrix(placed, 100, 80);
    for (const [x, y] of [
      [0, 0],
      [100, 0],
      [0, 80],
      [100, 80],
    ]) {
      expect(m.a * x + m.c * y + m.e).toBeCloseTo(solved.a * x + solved.c * y + solved.e, 5);
      expect(m.b * x + m.d * y + m.f).toBeCloseTo(solved.b * x + solved.d * y + solved.f, 5);
    }
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
      angleOnSky: true,
    });
  });
});

const NBSP = String.fromCharCode(160);

describe('formatZoomPercent', () => {
  it('reads 100 % at the size the mode opened with', () => {
    expect(formatZoomPercent(0.004, 0.004)).toBe(`100${NBSP}%`);
  });

  it('is the ratio of the current size to the opening size, whatever changed it', () => {
    expect(formatZoomPercent(0.008, 0.004)).toBe(`200${NBSP}%`);
    expect(formatZoomPercent(0.002, 0.004)).toBe(`50${NBSP}%`);
    // three wheel notches of 1.1
    expect(formatZoomPercent(0.004 * 1.1 ** 3, 0.004)).toBe(`133${NBSP}%`);
  });
});

describe('buildLabelFilterItems', () => {
  it('counts the photos of each label, the photos without one under "(no label)", by name', () => {
    expect(
      buildLabelFilterItems([{ labels: ['b', 'a'] }, { labels: ['a'] }, { labels: [] }, {}]),
    ).toEqual([
      { label: '(no label)', count: 2 },
      { label: 'a', count: 2 },
      { label: 'b', count: 1 },
    ]);
  });
});
