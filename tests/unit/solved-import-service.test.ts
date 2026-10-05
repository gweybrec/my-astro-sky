// @vitest-environment node
/**
 * The solved-import service on a fake image codec and a small catalogue: the checks of each
 * method, the results (a file with no usable solution is a result, not an error), the rescale,
 * and the codec calls. The routes that use it are pinned by server-app-network.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { CatalogStar } from '@myastrosky/core/wcs';
import {
  createSolvedImportService,
  type CatalogStarSource,
} from '@myastrosky/core/services/solved-import';
import { createSharpImageCodec } from '../../server/image-codec';
import { buildFits } from '../fixtures/fits-builders';
import { buildTiff } from '../fixtures/tiff-builders';
import { fakeImageCodec } from '../helpers/fake-image-io';

const STARS: CatalogStar[] = [
  { hip: 99001, ra: 330.21217, dec: 73.08178, mag: 5 },
  { hip: 99002, ra: 331.5, dec: 73.5, mag: 6 },
  { hip: 99003, ra: 329, dec: 72.5, mag: 6.5 },
];

const WCS_CARDS = [
  'CRPIX1  = 20.5',
  'CRPIX2  = 15.5',
  'CRVAL1  = 330.21217',
  'CRVAL2  = 73.08178',
  'CD1_1   = -0.1',
  'CD1_2   = 0',
  'CD2_1   = 0',
  'CD2_2   = 0.1',
  "DATE-OBS= '2025-09-04T21:30:00'",
  'EXPTIME = 300',
  'STACKCNT= 12',
  "FILTER  = 'Ha'",
];

const fits = (extraCards: string[] = WCS_CARDS, naxis1 = 40) =>
  new Uint8Array(
    buildFits({
      bitpix: -32,
      naxis1,
      naxis2: 30,
      roworder: 'TOP-DOWN',
      pixels: Array.from({ length: naxis1 * 30 }, (_, i) => (i % 7) / 7),
      extraCards,
    }),
  );

/** A TIFF whose only tag is an ImageDescription holding a newline-delimited WCS header. */
function tiffWithHeader(header: string): Uint8Array {
  const text = new TextEncoder().encode(header + '\0');
  const out = new Uint8Array(8 + 2 + 12 + 4 + text.length);
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49], 0); // 'II'
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 270, true);
  view.setUint16(12, 2, true);
  view.setUint32(14, text.length, true);
  view.setUint32(18, 26, true);
  out.set(text, 26);
  return out;
}

const plainTiff = () =>
  new Uint8Array(
    buildTiff({
      width: 4,
      height: 3,
      bitsPerSample: 8,
      sampleFormat: 1,
      samplesPerPixel: 1,
      photometric: 1,
      pixels: Array.from({ length: 12 }, (_, i) => i * 20),
    }),
  );

function setup(stars: CatalogStarSource = STARS) {
  const images = fakeImageCodec();
  const probe = vi.spyOn(images, 'probe');
  const encode = vi.spyOn(images, 'encode');
  return { service: createSolvedImportService({ images, stars }), images, probe, encode };
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  const err = await p.then(
    () => undefined,
    (e) => e,
  );
  return isDomainError(err) ? `${err.kind}:${err.code}` : undefined;
}

describe('solveWcs()', () => {
  it('accepts .fits, .FIT, .tif and .tiff and rejects any other extension, whatever the content', async () => {
    const { service } = setup();
    for (const name of ['a.fits', 'a.FIT', 'dir.x/a.fit']) {
      await expect(service.solveWcs({ fileName: name, bytes: fits() })).resolves.toBeDefined();
    }
    for (const name of ['a.tif', 'a.TIFF']) {
      await expect(service.solveWcs({ fileName: name, bytes: plainTiff() })).resolves.toEqual({
        success: false,
        code: 'NO_WCS_DATA',
      });
    }
    for (const name of ['a.jpg', 'a', '.fits', 'a.fits.png']) {
      expect(await codeOf(service.solveWcs({ fileName: name, bytes: fits() }))).toBe(
        'invalid:UNSUPPORTED_FORMAT',
      );
    }
  });

  it('rejects a call without a file', async () => {
    const { service } = setup();
    expect(await codeOf(service.solveWcs({ fileName: 'a.fits' } as any))).toBe('invalid:NO_FILE');
    expect(await codeOf(service.solveWcs(undefined as any))).toBe('invalid:NO_FILE');
  });

  it('returns the correspondences and the capture metadata of a solved FITS', async () => {
    const { service, probe } = setup();
    const r = await service.solveWcs({ fileName: 'a.fits', bytes: fits() });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect([r.sourceWidth, r.sourceHeight]).toEqual([40, 30]);
    expect(r.dimensionWarning).toBeUndefined();
    expect(r.correspondences.map((c) => c.starHip).sort()).toEqual([99001, 99002, 99003]);
    const first = r.correspondences.find((c) => c.starHip === 99001)!;
    expect(first.photoX).toBeCloseTo(19.5, 3);
    expect(first.photoY).toBeCloseTo(14.5, 3);
    expect(r.dateObs).toBe('2025-09-04T21:30:00Z');
    expect([r.expTime, r.stackCnt, r.filter]).toEqual([300, 12, 'Ha']);
    expect(probe).not.toHaveBeenCalled();
  });

  it('answers NO_WCS_DATA when the header holds no solution', async () => {
    const { service } = setup();
    expect(await service.solveWcs({ fileName: 'a.fits', bytes: fits([]) })).toEqual({
      success: false,
      code: 'NO_WCS_DATA',
    });
  });

  it('answers NO_IMAGE_DIMENSIONS for a FITS without a size, and asks the codec for the size of a TIFF', async () => {
    const { service, probe, images } = setup();
    expect(await service.solveWcs({ fileName: 'a.fit', bytes: fits(WCS_CARDS, 0) })).toEqual({
      success: false,
      code: 'NO_IMAGE_DIMENSIONS',
    });
    expect(probe).not.toHaveBeenCalled();

    const header = WCS_CARDS.map((c) => c.replace(/= {2,}/, '= ')).join('\n');
    images.info = { width: 40, height: 30 };
    const ok = await service.solveWcs({ fileName: 'a.tif', bytes: tiffWithHeader(header) });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(ok.success).toBe(true);
    if (ok.success) expect([ok.sourceWidth, ok.sourceHeight]).toEqual([40, 30]);

    images.info = null; // an unreadable TIFF has no size
    expect(await service.solveWcs({ fileName: 'a.tif', bytes: tiffWithHeader(header) })).toEqual({
      success: false,
      code: 'NO_IMAGE_DIMENSIONS',
    });
  });

  it('rescales to the target size, flags an aspect mismatch, and ignores a target that is absent, equal or not positive', async () => {
    const { service } = setup();
    const file = { fileName: 'a.fits', bytes: fits() };
    const same = await service.solveWcs({ ...file, targetWidth: 80, targetHeight: 60 });
    if (!same.success) throw new Error('expected a solution');
    expect(same.dimensionWarning).toEqual({
      sourceW: 40,
      sourceH: 30,
      targetW: 80,
      targetH: 60,
      aspectMismatch: false,
    });
    const c = same.correspondences.find((x) => x.starHip === 99001)!;
    expect([c.photoX, c.photoY].map((v) => Math.round(v * 1000) / 1000)).toEqual([39, 29]);

    const skew = await service.solveWcs({ ...file, targetWidth: 80, targetHeight: 30 });
    expect(skew.success && skew.dimensionWarning?.aspectMismatch).toBe(true);

    for (const target of [
      {},
      { targetWidth: 40, targetHeight: 30 },
      { targetWidth: 0, targetHeight: 30 },
      { targetWidth: NaN, targetHeight: 30 },
    ]) {
      const r = await service.solveWcs({ ...file, ...target });
      expect(r.success && r.dimensionWarning).toBeFalsy();
    }
  });

  it('falls back to synthetic points when the field holds no catalogue star (so NOT_ENOUGH_CATALOG_STARS is only a guard)', async () => {
    const empty = WCS_CARDS.map((c) =>
      c.startsWith('CRVAL1') ? 'CRVAL1  = 10' : c.startsWith('CRVAL2') ? 'CRVAL2  = -40' : c,
    );
    const { service } = setup([]);
    const r = await service.solveWcs({ fileName: 'a.fits', bytes: fits(empty) });
    expect(r.success && r.correspondences[0].starName).toBe('Synthetic 1');
  });

  it('takes the catalogue as a list, a loader or an asynchronous loader, loaded when a solution is read and again on each call', async () => {
    const loader = vi.fn(() => STARS);
    const { service } = setup(loader);
    expect(loader).not.toHaveBeenCalled();
    await service.solveWcs({ fileName: 'a.fits', bytes: fits([]) });
    expect(loader).not.toHaveBeenCalled(); // no solution, no catalogue
    await service.solveWcs({ fileName: 'a.fits', bytes: fits() });
    await service.solveWcs({ fileName: 'a.fits', bytes: fits() });
    expect(loader).toHaveBeenCalledTimes(2);

    const asyncOne = setup(async () => STARS).service;
    const r = await asyncOne.solveWcs({ fileName: 'a.fits', bytes: fits() });
    expect(r.success && r.correspondences.length).toBe(3);
  });

  it('passes on the error of a catalogue that cannot be loaded', async () => {
    const { service } = setup(() => {
      throw new Error('Star catalog not found');
    });
    await expect(service.solveWcs({ fileName: 'a.fits', bytes: fits() })).rejects.toThrow(
      'Star catalog not found',
    );
  });
});

describe('convert()', () => {
  it('rejects a call without a file and an extension that is not FITS or TIFF', async () => {
    const { service } = setup();
    expect(await codeOf(service.convert({ fileName: 'a.fits' } as any))).toBe('invalid:NO_FILE');
    for (const name of ['a.jpg', 'a.cr2', 'a']) {
      expect(await codeOf(service.convert({ fileName: name, bytes: fits() }))).toBe(
        'invalid:UNSUPPORTED_FORMAT',
      );
    }
  });

  it('rejects a layout the decoder does not support with its message', async () => {
    const { service } = setup();
    const cube = new Uint8Array(
      buildFits({ bitpix: -32, naxis1: 2, naxis2: 2, naxis3: 2, pixels: new Array(8).fill(0.5) }),
    );
    const err = await service.convert({ fileName: 'a.fits', bytes: cube }).catch((e) => e);
    expect(isDomainError(err) && [err.kind, err.code, err.message]).toEqual([
      'invalid',
      'UNSUPPORTED_RAW_FORMAT',
      'Unsupported FITS axis layout: NAXIS=3, NAXIS3=2',
    ]);
  });

  it('lets any other decoding failure through', async () => {
    const { service } = setup();
    await expect(
      service.convert({ fileName: 'a.tif', bytes: new Uint8Array([1, 2, 3, 4]) }),
    ).rejects.toThrow('Buffer too small to be a TIFF file');
  });

  it('encodes the picture once and returns the solution of a solved FITS', async () => {
    const { service, encode } = setup();
    const r = await service.convert({ fileName: 'a.fits', bytes: fits() });
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode.mock.calls[0][1]).toBe('png');
    expect(encode.mock.calls[0][0]).toMatchObject({ width: 40, height: 30, channels: 1 });
    expect(r.success).toBe(true);
    expect(r.code).toBeUndefined();
    expect(r.correspondences?.map((c) => c.starHip).sort()).toEqual([99001, 99002, 99003]);
    expect([r.sourceWidth, r.sourceHeight, r.width, r.height]).toEqual([40, 30, 40, 30]);
    expect([r.dateObs, r.expTime, r.stackCnt, r.filter]).toEqual([
      '2025-09-04T21:30:00Z',
      300,
      12,
      'Ha',
    ]);
    expect([...r.png]).toEqual([1]);
  });

  it('returns the picture with NO_WCS_DATA when the file holds no solution, and does not load the catalogue', async () => {
    const loader = vi.fn(() => STARS);
    const { service } = setup(loader);
    const r = await service.convert({ fileName: 'a.tiff', bytes: plainTiff() });
    expect(r.success).toBe(false);
    expect(r.code).toBe('NO_WCS_DATA');
    expect(r.correspondences).toBeUndefined();
    expect([r.width, r.height]).toEqual([4, 3]);
    expect(loader).not.toHaveBeenCalled();
  });

  it('makes a single-channel PNG through the real codec, pixel for pixel', async () => {
    const sharp = (await import('sharp')).default;
    const service = createSolvedImportService({ images: createSharpImageCodec(), stars: STARS });
    const r = await service.convert({ fileName: 'a.tiff', bytes: plainTiff() });
    const png = Buffer.from(r.png);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect((await sharp(png).metadata()).channels).toBe(1);
    expect([...(await sharp(png).greyscale().raw().toBuffer())]).toEqual(
      Array.from({ length: 12 }, (_, i) => i * 20),
    );
  });
});
