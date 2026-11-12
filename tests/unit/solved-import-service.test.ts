// @vitest-environment node
/**
 * The solved-import service on a fake image codec: the checks of each
 * method, the results (a file with no usable solution is a result, not an error), the rescale,
 * and the codec calls. The routes that use it are pinned by server-app-network.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { isDomainError } from '@myastrosky/core/domain/errors';
import { createSolvedImportService } from '@myastrosky/core/services/solved-import';
import { checkReferencePoints } from '@myastrosky/core/reference-points';
import { applyAffine, computeAffineLSQ, invertAffine } from '@myastrosky/core/affine';
import { createSharpImageCodec } from '../../server/image-codec';
import { buildFits } from '../fixtures/fits-builders';
import { buildTiff } from '../fixtures/tiff-builders';
import { buildXisf } from '../fixtures/xisf-builders';
import { fakeImageCodec } from '../helpers/fake-image-io';

const CRVAL = { ra: 330.21217, dec: 73.08178 };

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

/** A 40 × 30 XISF of 8-bit samples carrying the same solution as `fits()`, or none. */
const xisf = (solved = true) =>
  buildXisf({
    geometry: '40:30:1',
    sampleFormat: 'UInt8',
    pixels: Uint8Array.from({ length: 40 * 30 }, (_, i) => i % 256),
    keywords: solved
      ? WCS_CARDS.map((card) => ({
          name: card.slice(0, 8).trim(),
          value: card.slice(card.indexOf('=') + 1).trim(),
        }))
      : [],
  });

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

function setup() {
  const images = fakeImageCodec();
  const probe = vi.spyOn(images, 'probe');
  const encode = vi.spyOn(images, 'encode');
  return { service: createSolvedImportService({ images }), images, probe, encode };
}

type Points = { photoX: number; photoY: number; starRa?: number; starDec?: number }[];

/**
 * The pixel of the picture whose sky position is `sky`: the points go onto the plane tangent to the sky at `sky`
 * (gnomonic), where a plate solution is linear in pixels, and the fitted affine is inverted at its origin.
 */
function pixelOf(points: Points, sky: { ra: number; dec: number }) {
  const r = Math.PI / 180;
  const tangent = (ra: number, dec: number) => {
    const d = Math.sin(dec * r) * Math.sin(sky.dec * r);
    const c = Math.cos(dec * r) * Math.cos(sky.dec * r) * Math.cos((ra - sky.ra) * r);
    return {
      x: (Math.cos(dec * r) * Math.sin((ra - sky.ra) * r)) / (d + c),
      y:
        (Math.cos(sky.dec * r) * Math.sin(dec * r) -
          Math.sin(sky.dec * r) * Math.cos(dec * r) * Math.cos((ra - sky.ra) * r)) /
        (d + c),
    };
  };
  const m = computeAffineLSQ(
    points.map((p) => ({ x: p.photoX, y: p.photoY })),
    points.map((p) => tangent(p.starRa!, p.starDec!)),
  );
  return applyAffine(invertAffine(m)!, { x: 0, y: 0 });
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
    expect(r.correspondences).toHaveLength(9);
    expect(checkReferencePoints(r.correspondences, 40, 30)).toEqual([]);
    // The reference sky position is on the reference pixel: FITS (20.5, 15.5), rows from the bottom.
    const ref = pixelOf(r.correspondences, CRVAL);
    expect(ref.x).toBeCloseTo(19.5, 1);
    expect(ref.y).toBeCloseTo(14.5, 1);
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
    const ref = pixelOf(same.correspondences, CRVAL);
    expect(ref.x).toBeCloseTo(39, 1);
    expect(ref.y).toBeCloseTo(29, 1);

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

  it('answers NOT_ENOUGH_CATALOG_STARS for a solution that cannot place the photo', async () => {
    const flat = WCS_CARDS.map((c) => (/^CD/.test(c) ? `${c.slice(0, 8)}= 0` : c));
    const { service } = setup();
    const r = await service.solveWcs({ fileName: 'a.fits', bytes: fits(flat) });
    expect(r).toMatchObject({ success: false, code: 'NOT_ENOUGH_CATALOG_STARS' });
  });
});

describe('an XISF file', () => {
  it('gives the same solution and capture metadata as the FITS with the same header', async () => {
    const { service } = setup();
    const fromFits = await service.solveWcs({ fileName: 'a.fits', bytes: fits() });
    const fromXisf = await service.solveWcs({ fileName: 'a.XISF', bytes: xisf() });
    expect(fromXisf).toEqual(fromFits);
    expect(fromXisf.success).toBe(true);
  });

  it('is converted to a picture of its own size, with its solution', async () => {
    const { service, encode } = setup();
    const result = await service.convert({ fileName: 'a.xisf', bytes: xisf() });
    expect([result.success, result.width, result.height]).toEqual([true, 40, 30]);
    expect(result.correspondences!.length).toBeGreaterThanOrEqual(3);
    expect(result.dateObs).toBe('2025-09-04T21:30:00Z');
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode.mock.calls[0][0]).toMatchObject({ width: 40, height: 30, channels: 1 });
  });

  it('without a solution is a picture to place, and an unreadable one has no solution', async () => {
    const { service } = setup();
    const result = await service.convert({ fileName: 'a.xisf', bytes: xisf(false) });
    expect([result.success, result.code]).toEqual([false, 'NO_WCS_DATA']);
    expect(await service.solveWcs({ fileName: 'a.xisf', bytes: new Uint8Array(40) })).toEqual({
      success: false,
      code: 'NO_WCS_DATA',
    });
    expect(await codeOf(service.convert({ fileName: 'a.xisf', bytes: new Uint8Array(40) }))).toBe(
      'invalid:UNSUPPORTED_RAW_FORMAT',
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
    expect(r.correspondences).toHaveLength(9);
    expect([r.sourceWidth, r.sourceHeight, r.width, r.height]).toEqual([40, 30, 40, 30]);
    expect([r.dateObs, r.expTime, r.stackCnt, r.filter]).toEqual([
      '2025-09-04T21:30:00Z',
      300,
      12,
      'Ha',
    ]);
    expect([...r.png]).toEqual([1]);
  });

  it('returns the picture with NO_WCS_DATA when the file holds no solution', async () => {
    const { service } = setup();
    const r = await service.convert({ fileName: 'a.tiff', bytes: plainTiff() });
    expect(r.success).toBe(false);
    expect(r.code).toBe('NO_WCS_DATA');
    expect(r.correspondences).toBeUndefined();
    expect([r.width, r.height]).toEqual([4, 3]);
  });

  // Regression: a TOP-DOWN file was drawn with its first stored row at the top while its stars
  // were placed with that row at the bottom, so every overlay came out mirrored top to bottom.
  it.each(['TOP-DOWN', 'BOTTOM-UP', undefined] as const)(
    'puts the reference sky position on its own pixel of the picture it makes (ROWORDER %s)',
    async (roworder) => {
      const sharp = (await import('sharp')).default;
      const [W, H] = [40, 30];
      // The reference pixel is FITS pixel (6, 4), i.e. stored
      // column 5 of stored row 3, far from the middle row so a mirror would miss it.
      const cards = WCS_CARDS.map((c) =>
        c.startsWith('CRPIX1') ? 'CRPIX1  = 6' : c.startsWith('CRPIX2') ? 'CRPIX2  = 4' : c,
      );
      const pixels = new Array<number>(W * H).fill(0);
      pixels[3 * W + 5] = 1;
      const bytes = new Uint8Array(
        buildFits({
          bitpix: -32,
          naxis1: W,
          naxis2: H,
          ...(roworder ? { roworder } : {}),
          pixels,
          extraCards: cards,
        }),
      );
      const service = createSolvedImportService({ images: createSharpImageCodec() });
      const r = await service.convert({ fileName: 'a.fits', bytes });
      const ref = pixelOf(r.correspondences!, CRVAL);
      const raw = await sharp(Buffer.from(r.png)).greyscale().raw().toBuffer();
      expect(ref.x).toBeCloseTo(5, 0);
      expect(ref.y).toBeCloseTo(26, 0);
      expect(raw[Math.round(ref.y) * W + Math.round(ref.x)]).toBe(255);
    },
  );

  it('makes a single-channel PNG through the real codec, pixel for pixel', async () => {
    const sharp = (await import('sharp')).default;
    const service = createSolvedImportService({ images: createSharpImageCodec() });
    const r = await service.convert({ fileName: 'a.tiff', bytes: plainTiff() });
    const png = Buffer.from(r.png);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect((await sharp(png).metadata()).channels).toBe(1);
    expect([...(await sharp(png).greyscale().raw().toBuffer())]).toEqual(
      Array.from({ length: 12 }, (_, i) => i * 20),
    );
  });
});
