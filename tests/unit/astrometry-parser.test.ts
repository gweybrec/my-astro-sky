import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calibrationToCorrespondences } from '@myastrosky/core/astrometry-solution';
import {
  parseFITSHeader,
  extractFITSHeaderFromFITS,
  wcsToCorrespondences,
} from '../../server/wcs-reader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '../fixtures');

// ─── calibrationToCorrespondences ─────────────────────────────────────────────

describe('calibrationToCorrespondences', () => {
  it('returns correspondences from real astrometry.net calibration (job 10796000 — M13 field)', () => {
    const cal = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, 'astrometry/10796000-calibration.json'), 'utf8'),
    );
    // Real calibration: ra=250.3, dec=36.4, pixscale=2.977 arcsec/px, 3840×2160
    const imageWidth = 3840;
    const imageHeight = 2160;

    const corrs = calibrationToCorrespondences(cal, imageWidth, imageHeight);

    // 9 points over the whole photo; the centre one is at the calibration's centre (within a pixel).
    expect(corrs).toHaveLength(9);
    const centre = corrs.find((c) => c.photoX === 1920 && c.photoY === 1080)!;
    expect(centre.starRa).toBeCloseTo(cal.ra, 2);
    expect(centre.starDec).toBeCloseTo(cal.dec, 2);
  });

  it('returns array (possibly empty) without throwing for valid calibration data', () => {
    const cal = {
      ra: 84.05,
      dec: -1.2, // Orion Nebula area
      pixscale: 1.5, // arcsec/pixel
      orientation: 0,
      parity: 1.0,
      radius: 0.5,
    };
    expect(() => calibrationToCorrespondences(cal, 2000, 1500)).not.toThrow();
  });

  it('pixel scale influences CD matrix magnitude', () => {
    const cal1 = { ra: 84.05, dec: -1.2, pixscale: 1.0, orientation: 0, parity: 1.0 };
    const cal2 = { ra: 84.05, dec: -1.2, pixscale: 2.0, orientation: 0, parity: 1.0 };
    // The same points span twice the sky at twice the pixel scale.
    const r1 = calibrationToCorrespondences(cal1, 1000, 1000);
    const r2 = calibrationToCorrespondences(cal2, 1000, 1000);
    const span = (r: typeof r1) => Math.abs(r[8].starDec! - r[0].starDec!);
    expect(span(r2) / span(r1)).toBeCloseTo(2, 3);
  });
});

// ─── WCS file from astrometry.net via parseFITSHeader + wcsToCorrespondences ──

describe('astrometry.net WCS file pipeline (job 10796000 — M13 field)', () => {
  const wcsFile = path.join(FIXTURES, 'astrometry/10796000-wcs.fits');

  it('extractFITSHeaderFromFITS reads the WCS file and contains CRVAL1', () => {
    const buf = fs.readFileSync(wcsFile);
    const header = extractFITSHeaderFromFITS(buf);
    expect(header).toContain('CRVAL1');
    expect(header).toContain('CRPIX1');
  });

  it('parseFITSHeader extracts all required WCS keys from astrometry.net file', () => {
    const buf = fs.readFileSync(wcsFile);
    const header = extractFITSHeaderFromFITS(buf);
    const h = parseFITSHeader(header);

    const required = ['CRPIX1', 'CRPIX2', 'CRVAL1', 'CRVAL2', 'CD1_1', 'CD1_2', 'CD2_1', 'CD2_2'];
    for (const key of required) {
      expect(typeof h[key], `Expected ${key} to be a number`).toBe('number');
    }
  });

  it('CRPIX reference pixel maps near CRVAL sky coordinate', () => {
    const buf = fs.readFileSync(wcsFile);
    const header = extractFITSHeaderFromFITS(buf);
    const h = parseFITSHeader(header);

    // Build WCS data from parsed header (image 3840×2160)
    const wcs = {
      CRPIX1: h.CRPIX1 as number,
      CRPIX2: h.CRPIX2 as number,
      CRVAL1: h.CRVAL1 as number,
      CRVAL2: h.CRVAL2 as number,
      CD1_1: h.CD1_1 as number,
      CD1_2: h.CD1_2 as number,
      CD2_1: h.CD2_1 as number,
      CD2_2: h.CD2_2 as number,
      NAXIS1: 3840,
      NAXIS2: 2160,
    };

    // The reference pixel moved onto the centre point keeps its sky position: CRVAL.
    const centred = { ...wcs, CRPIX1: 1920 + 1, CRPIX2: 1080 + 1 };
    const centre = wcsToCorrespondences(centred, 3840, 2160, false).find(
      (c) => c.photoX === 1920 && c.photoY === 1080,
    )!;
    expect(centre.starRa).toBeCloseTo(wcs.CRVAL1, 9);
    expect(centre.starDec).toBeCloseTo(wcs.CRVAL2, 9);
  });
});
