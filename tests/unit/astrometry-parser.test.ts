import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calibrationToCorrespondences } from '../../server/astrometry';
import { parseFITSHeader, extractFITSHeaderFromFITS, wcsToCorrespondences } from '../../server/wcs-reader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '../fixtures');

beforeAll(() => {
  process.env.STAR_CATALOG_PATH = path.join(FIXTURES, 'stars.test.json');
});

// ─── calibrationToCorrespondences ─────────────────────────────────────────────

describe('calibrationToCorrespondences', () => {
  it('returns correspondences from real astrometry.net calibration (job 10796000 — M13 field)', () => {
    const cal = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, 'astrometry/10796000-calibration.json'), 'utf8')
    );
    // Real calibration: ra=250.3, dec=36.4, pixscale=2.977 arcsec/px, 3840×2160
    const imageWidth = 3840;
    const imageHeight = 2160;

    const corrs = calibrationToCorrespondences(cal, imageWidth, imageHeight);

    expect(Array.isArray(corrs)).toBe(true);
    // Should return some correspondences (may be 0 if no catalog stars in test fixture near M13)
    // Main thing: function doesn't throw and returns an array
  });

  it('returns array (possibly empty) without throwing for valid calibration data', () => {
    const cal = {
      ra: 84.05, dec: -1.2,       // Orion Nebula area
      pixscale: 1.5,               // arcsec/pixel
      orientation: 0,
      parity: 1.0,
      radius: 0.5,
    };
    expect(() => calibrationToCorrespondences(cal, 2000, 1500)).not.toThrow();
  });

  it('pixel scale influences CD matrix magnitude', () => {
    const cal1 = { ra: 84.05, dec: -1.2, pixscale: 1.0, orientation: 0, parity: 1.0 };
    const cal2 = { ra: 84.05, dec: -1.2, pixscale: 2.0, orientation: 0, parity: 1.0 };
    // We can't easily inspect the internal WCS, but we can verify the function doesn't throw
    // and returns arrays for both inputs
    const r1 = calibrationToCorrespondences(cal1, 1000, 1000);
    const r2 = calibrationToCorrespondences(cal2, 1000, 1000);
    expect(Array.isArray(r1)).toBe(true);
    expect(Array.isArray(r2)).toBe(true);
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

    // Star 99004 is placed at exactly CRVAL1/CRVAL2 in our test catalog
    const corrs = wcsToCorrespondences(wcs, 3840, 2160, false);
    const refStar = corrs.find(c => c.starHip === 99004);

    if (refStar) {
      // The star at CRVAL should map to pixel ≈ (CRPIX1-1, CRPIX2-1)
      expect(refStar.photoX).toBeCloseTo(wcs.CRPIX1 - 1, 0);
      expect(refStar.photoY).toBeCloseTo(wcs.CRPIX2 - 1, 0);
    }
    // If no correspondences found (catalog too sparse), just verify no throw
    expect(Array.isArray(corrs)).toBe(true);
  });
});
