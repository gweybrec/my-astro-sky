import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { setDsoCatalog, getDSOById } from '@myastrosky/core/catalog/dso-registry';
import { linearPhotoSkyModel, type PhotoSkyModel } from '@myastrosky/core/photo-sky-model';
import {
  gearNamesMatch,
  objectMatches,
  suggestGearSetup,
  wcsFileWarnings,
  type WcsCheckContext,
} from '@myastrosky/core/wcs-file-checks';
import type { SetupOptics } from '@myastrosky/core/gear-catalog';
import type { PlateSolveResult } from '@myastrosky/core/types';

const W = 3000;
const H = 2000;

beforeAll(() => {
  setDsoCatalog(JSON.parse(readFileSync('public/data/dso.json', 'utf8')), {}, 'en');
});

/** A photo of W × H pixels centred on (ra, dec), `arcsec` per pixel, north up. */
function model(ra: number, dec: number, arcsec = 2): PhotoSkyModel {
  const s = (arcsec / 3600) * (Math.PI / 180);
  return linearPhotoSkyModel({ ra, dec }, { a: -s, b: 0, c: 0, d: -s }, W, H);
}

/** A solved file result whose correspondences follow `m`. */
function solved(m: PhotoSkyModel, extra: Partial<PlateSolveResult> = {}): PlateSolveResult {
  const correspondences = [0.05, 0.5, 0.95].flatMap((fy) =>
    [0.05, 0.5, 0.95].map((fx, i) => {
      const sky = m.toSky(fx * W, fy * H);
      return {
        pointIndex: i,
        photoX: fx * W,
        photoY: fy * H,
        starHip: 0,
        starName: '',
        starRa: sky.ra,
        starDec: sky.dec,
      };
    }),
  );
  return { success: true, correspondences, ...extra };
}

const ctx = (over: Partial<WcsCheckContext> = {}): WcsCheckContext => ({
  dsoIds: [],
  skyModel: null,
  width: W,
  height: H,
  setup: null,
  ...over,
});

const kinds = (r: PlateSolveResult, c: WcsCheckContext) => wcsFileWarnings(r, c).map((w) => w.kind);

const M51 = () => getDSOById('M51')!;
const M63 = () => getDSOById('M63')!;

describe('objects in the field of a solved file', () => {
  it('says nothing when the file shows the photo', () => {
    const m = model(M51().ra, M51().dec);
    expect(kinds(solved(m), ctx({ dsoIds: ['M51'], skyModel: m }))).toEqual([]);
  });

  it('compares nothing for a photo with no objects and no placement yet', () => {
    const file = model(M63().ra, M63().dec);
    expect(kinds(solved(file), ctx())).toEqual([]);
  });

  it('lists the Messier objects that differ, both ways', () => {
    const photo = model(M51().ra, M51().dec);
    const file = model(M63().ra, M63().dec);
    const warnings = wcsFileWarnings(solved(file), ctx({ dsoIds: ['M51'], skyModel: photo }));
    expect(warnings).toContainEqual({ kind: 'messierMissing', dsoIds: ['M51'] });
    expect(warnings).toContainEqual({ kind: 'messierExtra', dsoIds: ['M63'] });
  });

  it('warns when the main object, not a Messier one, is not in the field', () => {
    const ngc7331 = getDSOById('NGC7331')!;
    const file = model(M63().ra, M63().dec);
    const warnings = wcsFileWarnings(solved(file), ctx({ dsoIds: ['NGC7331'] }));
    expect(warnings).toContainEqual({ kind: 'mainObject', dsoId: ngc7331.id });
  });
});

describe('a file without a solution', () => {
  it('warns when the centre its header gives is outside the placed photo', () => {
    const photo = model(M51().ra, M51().dec);
    const far = { success: false, facts: { centerRa: M63().ra, centerDec: M63().dec } };
    const close = { success: false, facts: { centerRa: M51().ra, centerDec: M51().dec } };
    expect(kinds(far, ctx({ skyModel: photo }))).toEqual(['centerOutside']);
    expect(kinds(close, ctx({ skyModel: photo }))).toEqual([]);
    expect(kinds(far, ctx())).toEqual([]); // an unplaced photo cannot be compared
  });

  it('warns about the size and an incomplete file', () => {
    const r: PlateSolveResult = {
      success: false,
      truncated: true,
      dimensionWarning: {
        sourceW: 674,
        sourceH: 507,
        targetW: 3000,
        targetH: 1000,
        aspectMismatch: true,
      },
    };
    expect(kinds(r, ctx())).toEqual(['dimensions', 'truncated']);
  });
});

describe('the OBJECT header', () => {
  it('matches ids with spaces, any case, and names', () => {
    expect(objectMatches('M 63 ATR533C C11EF1.9 ZWOUVIR -15C', [M63()])).toBe(true);
    expect(objectMatches('m51', [M51()])).toBe(true);
    expect(objectMatches('M 6', [M63()])).toBe(false);
    expect(objectMatches('M 631', [M63()])).toBe(false);
  });

  it('warns when it names none of the photo objects, and ignores "Unknown"', () => {
    const r = (object: string) => ({ success: false, facts: { object } });
    expect(kinds(r('M 42'), ctx({ dsoIds: ['M51'] }))).toEqual(['object']);
    expect(kinds(r('M 51'), ctx({ dsoIds: ['M51'] }))).toEqual([]);
    expect(kinds(r('Unknown'), ctx({ dsoIds: ['M51'] }))).toEqual([]);
    expect(kinds(r('M 42'), ctx())).toEqual([]); // nothing to compare with
  });
});

const C11: SetupOptics = {
  setupId: 'c11',
  nativeFocalMm: 2800,
  effectiveFocalMm: 1764, // 0.63× reducer
  pixelSizeUm: 3.76,
  telescopeName: 'Celestron EdgeHD 11',
  cameraName: 'ZWO ASI2600MC Pro',
  setupName: 'C11 réducteur',
};
const S30: SetupOptics = {
  setupId: 's30',
  nativeFocalMm: 150,
  effectiveFocalMm: 150,
  pixelSizeUm: 2.9,
  telescopeName: 'ZWO Seestar S30',
  cameraName: 'ZWO Seestar S30',
  setupName: 'Seestar',
};

describe('the gear', () => {
  it('accepts either focal length and warns beyond 10 %', () => {
    const r = (focalLengthMm: number) => ({ success: false, facts: { focalLengthMm } });
    expect(kinds(r(2750), ctx({ setup: C11 }))).toEqual([]);
    expect(kinds(r(1800), ctx({ setup: C11 }))).toEqual([]);
    expect(wcsFileWarnings(r(540), ctx({ setup: C11 }))).toEqual([
      { kind: 'focalLength', headerMm: 540, setupMm: 1764 },
    ]);
  });

  it('checks the pixel scale of a solved file, binned or not', () => {
    const expected = (206.265 * 3.76) / 1764; // 0.44″
    const r = (pixelScaleArcsec: number, binning?: number) => ({
      success: false,
      facts: { pixelScaleArcsec, binning },
    });
    expect(kinds(r(expected), ctx({ setup: C11 }))).toEqual([]);
    expect(kinds(r(expected * 2, 2), ctx({ setup: C11 }))).toEqual([]);
    expect(kinds(r(expected * 2), ctx({ setup: C11 }))).toEqual(['pixelScale']);
  });

  it('matches names by containment or a shared model word, never by the brand alone', () => {
    expect(gearNamesMatch('ATIK-314L: fw rev 3.01', 'Atik 314L+')).toBe(true);
    expect(gearNamesMatch('S30_0289c34b', 'ZWO Seestar S30')).toBe(true);
    expect(gearNamesMatch('ZWO ASI2600MC Pro', 'ZWO ASI2600MC Pro')).toBe(true);
    expect(gearNamesMatch('ZWO AM5', 'ZWO ASI2600MC Pro')).toBe(false);
    expect(gearNamesMatch('QSI CCD', 'ATIK 314L')).toBe(false);
  });

  it('warns about a telescope or camera name that matches nothing of the setup', () => {
    const r = { success: false, facts: { telescope: 'S30_0289c34b', instrument: 'QHY268M' } };
    expect(wcsFileWarnings(r, ctx({ setup: S30 }))).toEqual([
      { kind: 'instrument', header: 'QHY268M' },
    ]);
  });

  it('suggests the one setup the header points to', () => {
    const facts = { telescope: 'S30_0289c34b', instrument: 'Seestar S30', focalLengthMm: 150 };
    expect(suggestGearSetup(facts, [C11, S30])).toBe('s30');
    expect(suggestGearSetup({ ...facts, focalLengthMm: 600 }, [C11, S30])).toBeNull();
    expect(suggestGearSetup(facts, [S30, { ...S30, setupId: 'twin' }])).toBeNull();
    expect(suggestGearSetup({ instrument: 'Seestar S30' }, [S30])).toBeNull(); // one name, no focal
    expect(suggestGearSetup(undefined, [S30])).toBeNull();
  });
});
