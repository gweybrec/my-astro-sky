import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  fitPhotoSkyModel,
  linearPhotoSkyModel,
  pixelScaleDeg,
  skyToTangent,
  tangentToSky,
  type PhotoSkyModel,
} from '@myastrosky/core/photo-sky-model';
import {
  computeManualProjMatrix,
  meshDivisions,
  photoSkyModel,
  photoSkyModelAtView,
  projectPhotoMesh,
} from '@myastrosky/core/photo-placement';
import {
  project,
  projectContinued,
  setCenterMode,
  setHemisphere,
  setProjectionMode,
  setProjectionObserver,
  withCanonicalProjection,
} from '@myastrosky/core/projection';
import {
  parseWcsSidecar,
  wcsFromHeader,
  wcsToCorrespondences,
  type WCSData,
} from '@myastrosky/core/wcs';
import type { ManualPlacement, Photo, PhotoCorrespondence } from '@myastrosky/core/types';

const D = Math.PI / 180;

/** The plate solution's own answer (TAN + SIP), display pixel (0-based, rows from the top) → RA/Dec. */
function wcsPixelToSky(w: WCSData, height: number, fitsY: boolean, px: number, py: number) {
  const sum = (t: Record<string, number>, u: number, v: number) =>
    Object.entries(t).reduce((s, [k, c]) => {
      const [i, j] = k.split('_').map(Number);
      return s + c * u ** i * v ** j;
    }, 0);
  const u = px + 1 - w.CRPIX1;
  const v = (fitsY ? height - py : py + 1) - w.CRPIX2;
  const dx = w.sip ? u + sum(w.sip.a, u, v) : u;
  const dy = w.sip ? v + sum(w.sip.b, u, v) : v;
  return tangentToSky(
    (w.CD1_1 * dx + w.CD1_2 * dy) * D,
    (w.CD2_1 * dx + w.CD2_2 * dy) * D,
    w.CRVAL1,
    w.CRVAL2,
  );
}

/** Angular distance in degrees, for the small distances compared here. */
const sep = (a: { ra: number; dec: number }, b: { ra: number; dec: number }) =>
  Math.hypot((((a.ra - b.ra + 540) % 360) - 180) * Math.cos(a.dec * D), a.dec - b.dec);

function loadFixture(name: string) {
  const header = parseWcsSidecar(
    new Uint8Array(readFileSync(join(__dirname, '../fixtures/solve-field', name))),
  );
  const wcs = wcsFromHeader(header)!;
  return { wcs, width: header.IMAGEW as number, height: header.IMAGEH as number };
}

/** Worst distance, in the solution's pixels, between the model and the solution over a 21 × 21 grid. */
function worstErrorPx(model: PhotoSkyModel, wcs: WCSData, fitsY: boolean): number {
  const { width, height } = model;
  const scaleDeg = Math.sqrt(Math.abs(wcs.CD1_1 * wcs.CD2_2 - wcs.CD1_2 * wcs.CD2_1));
  let worst = 0;
  for (let j = 0; j <= 20; j++) {
    for (let i = 0; i <= 20; i++) {
      const x = (width * i) / 20;
      const y = (height * j) / 20;
      worst = Math.max(worst, sep(model.toSky(x, y), wcsPixelToSky(wcs, height, fitsY, x, y)));
    }
  }
  return worst / scaleDeg;
}

const photoOf = (
  width: number,
  height: number,
  correspondences: PhotoCorrespondence[],
  manualPlacement?: ManualPlacement,
) => ({ width, height, correspondences, manualPlacement }) as unknown as Photo;

beforeEach(() => {
  setCenterMode('pole');
  setProjectionMode('stereo');
  setHemisphere('north');
});

describe('photo sky model from a plate solution', () => {
  for (const [name, fitsY] of [
    ['LDN1235.wcs', false],
    ['M1_CCD_siril.wcs', true],
  ] as const) {
    it(`places every pixel of ${name} within half a pixel of its solution, distortion included`, () => {
      const { wcs, width, height } = loadFixture(name);
      const model = photoSkyModel(
        photoOf(width, height, wcsToCorrespondences(wcs, width, height, fitsY)),
      )!;
      expect(worstErrorPx(model, wcs, fitsY)).toBeLessThan(0.5);
    });
  }

  it('places a photo from a few matched stars within a few pixels over its whole frame', () => {
    // LDN1235 is 4.4° across: 6 points in its central part, as stars matched by hand would be.
    const { wcs, width, height } = loadFixture('LDN1235.wcs');
    const stars = [
      [0.2, 0.3],
      [0.7, 0.2],
      [0.5, 0.5],
      [0.3, 0.8],
      [0.8, 0.7],
      [0.6, 0.4],
    ].map(([fx, fy], i) => {
      const sky = wcsPixelToSky(wcs, height, false, fx * width, fy * height);
      return {
        pointIndex: i,
        photoX: fx * width,
        photoY: fy * height,
        starHip: 0,
        starName: `s${i}`,
        starRa: sky.ra,
        starDec: sky.dec,
      };
    });
    const model = photoSkyModel(photoOf(width, height, stars))!;
    expect(worstErrorPx(model, wcs, false)).toBeLessThan(5);
  });

  it('does not depend on how the sky map projects the sky', () => {
    const { wcs, width, height } = loadFixture('LDN1235.wcs');
    const corr = wcsToCorrespondences(wcs, width, height, false);
    const at = () => photoSkyModel(photoOf(width, height, corr))!.toSky(100, 3000);
    const pole = at();
    setProjectionMode('fisheye');
    setCenterMode('zenith');
    setProjectionObserver(3, 45);
    const local = at();
    expect(local.ra).toBeCloseTo(pole.ra, 12);
    expect(local.dec).toBeCloseTo(pole.dec, 12);
  });

  it('finds the pixel of a sky position: the inverse of toSky', () => {
    const { wcs, width, height } = loadFixture('LDN1235.wcs');
    const model = photoSkyModel(
      photoOf(width, height, wcsToCorrespondences(wcs, width, height, false)),
    )!;
    for (const [x, y] of [
      [0, 0],
      [width, 0],
      [1234, 2345],
      [width / 2, height / 2],
      [-500, height + 300], // outside the photo too
    ]) {
      const sky = model.toSky(x, y);
      const back = model.toPixel(sky.ra, sky.dec)!;
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
    // A position on the far side of the sky has no pixel.
    const c = model.toSky(width / 2, height / 2);
    expect(model.toPixel((c.ra + 180) % 360, -c.dec)).toBeNull();
  });
});

describe('fitPhotoSkyModel', () => {
  it('throws when the points cannot place the photo', () => {
    expect(() => fitPhotoSkyModel([{ x: 5, y: 5 }], [{ ra: 10, dec: 10 }], 100, 100)).toThrow();
    // Two points on the same pixel.
    expect(() =>
      fitPhotoSkyModel(
        [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        [
          { ra: 10, dec: 10 },
          { ra: 11, dec: 11 },
        ],
        100,
        100,
      ),
    ).toThrow();
  });

  it('gives the scale of a pixel on the sky', () => {
    const model = linearPhotoSkyModel(
      { ra: 30, dec: 40 },
      { a: (-1 / 3600) * D, b: 0, c: 0, d: (-1 / 3600) * D },
      1000,
      800,
    );
    expect(pixelScaleDeg(model) * 3600).toBeCloseTo(1, 6);
  });
});

describe('the tangent plane', () => {
  it('goes there and back', () => {
    const t = skyToTangent(12.3, 45.6, 10, 44)!;
    const s = tangentToSky(t.x, t.y, 10, 44);
    expect(s.ra).toBeCloseTo(12.3, 12);
    expect(s.dec).toBeCloseTo(45.6, 12);
  });
});

describe('a photo placed by hand', () => {
  const placement: ManualPlacement = {
    centerRa: 83.8,
    centerDec: 22,
    rotationDeg: 30,
    projPerPx: 0.00003,
    mirrorX: false,
    mirrorY: false,
    angleOnSky: true,
  };

  it('is where its placement draws it at its centre, at the same scale and angle', () => {
    const model = photoSkyModel(photoOf(400, 300, [], placement))!;
    const m = computeManualProjMatrix(placement, 400, 300);
    // Around the centre, the model projected matches the placement's own matrix to first order.
    for (const [x, y] of [
      [200, 200],
      [210, 200],
      [200, 210],
      [190, 195],
    ]) {
      const sky = model.toSky(x, y);
      const p = project(sky.ra, sky.dec);
      expect(p.x).toBeCloseTo(m.a * x + m.c * y + m.e, 5);
      expect(p.y).toBeCloseTo(m.b * x + m.d * y + m.f, 5);
    }
    const c = model.toSky(200, 150);
    expect(c.ra).toBeCloseTo(83.8, 9);
    expect(c.dec).toBeCloseTo(22, 9);
  });

  it('keeps the mirror of a mirrored placement', () => {
    const plain = photoSkyModel(photoOf(400, 300, [], placement))!;
    const mirrored = photoSkyModel(photoOf(400, 300, [], { ...placement, mirrorX: true }))!;
    const handedness = (model: PhotoSkyModel) => {
      const c = model.toSky(200, 150);
      const o = skyToTangent(c.ra, c.dec, c.ra, c.dec)!;
      const ex = model.toSky(201, 150);
      const ey = model.toSky(200, 151);
      const px = skyToTangent(ex.ra, ex.dec, c.ra, c.dec)!;
      const py = skyToTangent(ey.ra, ey.dec, c.ra, c.dec)!;
      return Math.sign((px.x - o.x) * (py.y - o.y) - (px.y - o.y) * (py.x - o.x));
    };
    expect(handedness(mirrored)).toBe(-handedness(plain));
  });

  it('turns with the map when it was saved with its angle on screen', () => {
    const legacy = { ...placement, angleOnSky: undefined };
    const photo = photoOf(400, 300, [], legacy);
    const straight = photoSkyModelAtView(photo, { rotationDeg: 0 })!.toSky(0, 0);
    const turned = photoSkyModelAtView(photo, { rotationDeg: 40 })!.toSky(0, 0);
    expect(sep(straight, turned)).toBeGreaterThan(0.001);
    // A placement on the sky does not.
    const onSky = photoOf(400, 300, [], placement);
    const a = photoSkyModelAtView(onSky, { rotationDeg: 0 })!.toSky(0, 0);
    const b = photoSkyModelAtView(onSky, { rotationDeg: 40 })!.toSky(0, 0);
    expect(sep(a, b)).toBeLessThan(1e-12);
  });
});

describe("the sky map's mesh of a photo", () => {
  it('follows the model within half a pixel in every projection mode, for a wide field', () => {
    const { wcs, width, height } = loadFixture('LDN1235.wcs');
    const model = photoSkyModel(
      photoOf(width, height, wcsToCorrespondences(wcs, width, height, false)),
    )!;
    expect(meshDivisions(model)).toBe(16); // 4.4° across
    const modes: Array<() => void> = [
      () => (setCenterMode('pole'), setProjectionMode('stereo')),
      () => (setCenterMode('pole'), setProjectionMode('fisheye')),
      () => (setCenterMode('zenith'), setProjectionMode('stereo'), setProjectionObserver(2, 45)),
      () => (setCenterMode('zenith'), setProjectionMode('fisheye'), setProjectionObserver(2, 45)),
    ];
    for (const set of modes) {
      set();
      const mesh = projectPhotoMesh(model);
      const { n, nodes } = mesh;
      const node = (i: number, j: number) => ({
        x: nodes[(j * (n + 1) + i) * 2],
        y: nodes[(j * (n + 1) + i) * 2 + 1],
      });
      let worst = 0;
      // The middle of each cell's diagonal, where the triangles are farthest from the model.
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const a = node(i + 1, j);
          const b = node(i, j + 1);
          const sky = model.toSky((width * (i + 0.5)) / n, (height * (j + 0.5)) / n);
          const p = projectContinued(sky.ra, sky.dec);
          worst = Math.max(worst, Math.hypot((a.x + b.x) / 2 - p.x, (a.y + b.y) / 2 - p.y));
        }
      }
      expect(worst / mesh.projPerPx).toBeLessThan(0.5);
    }
  });

  it('a small field needs few cells', () => {
    // 0.3° across, like a CCD on a long focal length.
    const s = ((0.3 / 1000) * Math.PI) / 180;
    const model = linearPhotoSkyModel(
      { ra: 83.6, dec: 22 },
      { a: -s, b: 0, c: 0, d: -s },
      1000,
      750,
    );
    expect(meshDivisions(model)).toBe(2);
  });

  it('continues a field past the horizon instead of tearing it', () => {
    setCenterMode('zenith');
    setProjectionObserver(0, 45);
    // A field at Dec −50°, below the horizon of latitude 45° N: clipped by project, continued beyond the rim here.
    expect(project(0, -50)).toEqual({ x: 1e6, y: 1e6 });
    const p = projectContinued(0, -50);
    expect(Math.hypot(p.x, p.y)).toBeGreaterThan(1);
    expect(Math.hypot(p.x, p.y)).toBeLessThan(1e3);
    setProjectionMode('fisheye');
    const q = projectContinued(0, -50);
    expect(Math.hypot(q.x, q.y)).toBeGreaterThan(1);
    expect(Math.hypot(q.x, q.y)).toBeLessThanOrEqual(2);
  });

  it('is the same as the canonical projection in the default mode', () => {
    const p = withCanonicalProjection(() => project(123, 45));
    const q = projectContinued(123, 45);
    expect(q.x).toBeCloseTo(p.x, 12);
    expect(q.y).toBeCloseTo(p.y, 12);
  });
});
