import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseFITSHeader,
  extractFITSHeaderFromFITS,
  wcsToCorrespondences,
  normalizeDateObs,
} from '../../server/wcs-reader';
import { checkReferencePoints } from '@myastrosky/core/reference-points';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '../fixtures');

// ─── parseFITSHeader ──────────────────────────────────────────────────────────

describe('parseFITSHeader — newline-delimited format (ASTAP style)', () => {
  const astapHeader = [
    'PLTSOLVD= T',
    'CRPIX1  =  1406.5',
    'CRPIX2  =   849.0',
    'CRVAL1  =  211.0787164',
    'CRVAL2  =   54.3880337',
    'CD1_1   =  1.4251E-4',
    'CD1_2   = -6.4714E-4',
    'CD2_1   = -6.4707E-4',
    'CD2_2   = -1.4220E-4',
  ].join('\n');

  it('parses numeric values correctly', () => {
    const h = parseFITSHeader(astapHeader);
    expect(h.CRPIX1).toBeCloseTo(1406.5, 4);
    expect(h.CRPIX2).toBeCloseTo(849.0, 4);
    expect(h.CRVAL1).toBeCloseTo(211.0787164, 4);
    expect(h.CRVAL2).toBeCloseTo(54.3880337, 4);
  });

  it('parses scientific notation (E notation)', () => {
    const h = parseFITSHeader(astapHeader);
    expect(h.CD1_1).toBeCloseTo(1.4251e-4, 8);
    expect(h.CD1_2).toBeCloseTo(-6.4714e-4, 8);
  });

  it('parses boolean T as true', () => {
    const h = parseFITSHeader(astapHeader);
    expect(h.PLTSOLVD).toBe(true);
  });

  it('parses boolean F as false', () => {
    const h = parseFITSHeader('SOLVED  = F');
    expect(h.SOLVED).toBe(false);
  });

  it('parses string values (single-quoted)', () => {
    const h = parseFITSHeader("CTYPE1  = 'RA---TAN'");
    expect(h.CTYPE1).toBe('RA---TAN');
  });

  it('ignores inline comments after /', () => {
    const h = parseFITSHeader('CRVAL1  =  211.0787 / RA of reference point');
    expect(h.CRVAL1).toBeCloseTo(211.0787, 4);
  });
});

describe('parseFITSHeader — 80-char fixed-width format (FITS binary)', () => {
  it('parses real LDN1235 WCS file (FITS binary)', () => {
    const buf = fs.readFileSync(path.join(FIXTURES, 'solve-field/LDN1235.wcs'));
    const header = extractFITSHeaderFromFITS(buf);
    const h = parseFITSHeader(header);

    // Real values from the solved LDN1235 image
    expect(h.CRVAL1).toBeCloseTo(330.212173031, 4);
    expect(h.CRVAL2).toBeCloseTo(73.0817794918, 4);
    expect(h.CRPIX1).toBeCloseTo(4431.37296549, 2);
    expect(h.CRPIX2).toBeCloseTo(1174.63823795, 2);
    expect(h.CD1_1).toBeCloseTo(-0.000661648450496, 10);
    expect(h.CD2_2).toBeCloseTo(0.000661238355384, 10);
  });

  it('parses real astrometry.net WCS file including SIP coefficients', () => {
    const buf = fs.readFileSync(path.join(FIXTURES, 'astrometry/10796000-wcs.fits'));
    const header = extractFITSHeaderFromFITS(buf);
    const h = parseFITSHeader(header);

    expect(h.CRVAL1).toBeCloseTo(251.072257738, 4);
    expect(h.CRVAL2).toBeCloseTo(36.2137914545, 4);
    expect(h.CRPIX1).toBeCloseTo(1213.09768677, 2);
    expect(h.CRPIX2).toBeCloseTo(1447.24865723, 2);
    // SIP distortion present
    expect(typeof h.AP_ORDER).toBe('number');
    expect(h.AP_ORDER).toBe(2);
  });
});

// ─── parseFITSHeader — observation metadata keywords ─────────────────────────

describe('parseFITSHeader — observation metadata keywords', () => {
  it('parses DATE-OBS string with hyphenated keyword', () => {
    const h = parseFITSHeader(
      "DATE-OBS= '2026-03-17T20:38:44' / YYYY-MM-DDThh:mm:ss observation start, UT",
    );
    expect(h['DATE-OBS']).toBe('2026-03-17T20:38:44');
  });

  it('parses EXPTIME with trailing dot (e.g. 30.)', () => {
    const h = parseFITSHeader('EXPTIME =  30. / [s] Exposure time duration');
    expect(h.EXPTIME).toBe(30);
  });

  it('parses EXPTIME as float', () => {
    const h = parseFITSHeader('EXPTIME = 180.5 / [s] Exposure time');
    expect(h.EXPTIME).toBeCloseTo(180.5, 4);
  });

  it('parses STACKCNT as integer', () => {
    const h = parseFITSHeader('STACKCNT= 89 / Stack frames');
    expect(h.STACKCNT).toBe(89);
  });

  it('returns undefined for missing keywords', () => {
    const h = parseFITSHeader('CRVAL1  = 123.456');
    expect(h['DATE-OBS']).toBeUndefined();
    expect(h.EXPTIME).toBeUndefined();
    expect(h.STACKCNT).toBeUndefined();
  });

  it('parses all three keywords together in a multi-line header', () => {
    const header = [
      "DATE-OBS= '2026-03-17T20:38:44' / observation start",
      'EXPTIME =  30. / [s] Exposure time',
      'STACKCNT= 89 / Stack frames',
      'CRVAL1  = 211.0787',
    ].join('\n');
    const h = parseFITSHeader(header);
    expect(h['DATE-OBS']).toBe('2026-03-17T20:38:44');
    expect(h.EXPTIME).toBe(30);
    expect(h.STACKCNT).toBe(89);
  });
});

// ─── normalizeDateObs ─────────────────────────────────────────────────────────

describe('normalizeDateObs', () => {
  it('appends Z when no timezone info present', () => {
    expect(normalizeDateObs('2026-03-17T20:38:44')).toBe('2026-03-17T20:38:44Z');
  });

  it('keeps value unchanged when Z suffix already present', () => {
    expect(normalizeDateObs('2026-03-17T20:38:44Z')).toBe('2026-03-17T20:38:44Z');
  });

  it('keeps value unchanged when positive UTC offset is present', () => {
    expect(normalizeDateObs('2026-03-17T20:38:44+05:30')).toBe('2026-03-17T20:38:44+05:30');
  });

  it('keeps value unchanged when negative UTC offset is present', () => {
    expect(normalizeDateObs('2026-03-17T20:38:44-08:00')).toBe('2026-03-17T20:38:44-08:00');
  });

  it('handles date-only format (no time component)', () => {
    expect(normalizeDateObs('2026-03-17')).toBe('2026-03-17Z');
  });

  it('handles datetime with fractional seconds', () => {
    expect(normalizeDateObs('2026-03-17T20:38:44.123')).toBe('2026-03-17T20:38:44.123Z');
  });
});

// ─── wcsToCorrespondences ─────────────────────────────────────────────────────

describe('wcsToCorrespondences', () => {
  // LDN1235 WCS: CRPIX1=4431.37, CRPIX2=1174.64, CRVAL=(330.21°, 73.08°), 5760×3239
  const ldn1235Wcs = {
    CRPIX1: 4431.37296549,
    CRPIX2: 1174.63823795,
    CRVAL1: 330.212173031,
    CRVAL2: 73.0817794918,
    CD1_1: -0.000661648450496,
    CD1_2: -4.24673765053e-5,
    CD2_1: -4.23038812204e-5,
    CD2_2: 0.000661238355384,
    NAXIS1: 5760,
    NAXIS2: 3239,
  };

  it('returns 9 points spread over the whole photo, each with a sky position', () => {
    const corrs = wcsToCorrespondences(ldn1235Wcs, 5760, 3239, false);
    expect(corrs).toHaveLength(9);
    expect(checkReferencePoints(corrs, 5760, 3239)).toEqual([]);
    // The corners, 5 % inside the edges, and the centre are among them.
    expect(corrs.map((c) => [c.photoX, c.photoY])).toEqual(
      expect.arrayContaining([
        [288, 3239 * 0.05],
        [5760 * 0.95, 3239 * 0.95],
        [2880, 3239 * 0.5],
      ]),
    );
    for (const c of corrs) {
      expect(isFinite(c.starRa!)).toBe(true);
      expect(isFinite(c.starDec!)).toBe(true);
    }
  });

  it('gives the reference pixel the reference sky position', () => {
    // The centre point sits on CRPIX (display pixel = FITS pixel - 1, rows from the top).
    const wcs = { ...ldn1235Wcs, CRPIX1: 2880 + 1, CRPIX2: 3239 * 0.5 + 1 };
    const centre = wcsToCorrespondences(wcs, 5760, 3239, false).find(
      (c) => c.photoX === 2880 && c.photoY === 3239 * 0.5,
    )!;
    expect(centre.starRa).toBeCloseTo(wcs.CRVAL1, 9);
    expect(centre.starDec).toBeCloseTo(wcs.CRVAL2, 9);
  });

  it('counts rows from the bottom in the FITS convention', () => {
    // The top row in the FITS convention is the bottom row in the display one (one pixel apart).
    const fits = wcsToCorrespondences(ldn1235Wcs, 5760, 3239, true);
    const display = wcsToCorrespondences(ldn1235Wcs, 5760, 3239, false);
    const topLeftFits = fits.find((c) => c.photoX === 288 && c.photoY === 3239 * 0.05)!;
    const bottomLeftDisplay = display.find((c) => c.photoX === 288 && c.photoY === 3239 * 0.95)!;
    expect(topLeftFits.starRa).toBeCloseTo(bottomLeftDisplay.starRa!, 2);
    expect(topLeftFits.starDec).toBeCloseTo(bottomLeftDisplay.starDec!, 2);
    expect(topLeftFits.starDec).not.toBeCloseTo(
      display.find((c) => c.photoX === 288 && c.photoY === 3239 * 0.05)!.starDec!,
      2,
    );
  });

  it('returns no points for a solution that cannot place the photo', () => {
    // Every point at the same sky position: the photo would have no size on the sky.
    const flat = { ...ldn1235Wcs, CD1_1: 0, CD1_2: 0, CD2_1: 0, CD2_2: 0 };
    expect(wcsToCorrespondences(flat, 5760, 3239, false)).toEqual([]);
    expect(wcsToCorrespondences({ ...ldn1235Wcs, CRVAL1: NaN }, 5760, 3239, false)).toEqual([]);
  });

  it('photoX/photoY are within image bounds', () => {
    const w = 5760,
      h = 3239;
    const corrs = wcsToCorrespondences(ldn1235Wcs, w, h, false);
    for (const c of corrs) {
      expect(c.photoX).toBeGreaterThanOrEqual(0);
      expect(c.photoX).toBeLessThan(w);
      expect(c.photoY).toBeGreaterThanOrEqual(0);
      expect(c.photoY).toBeLessThan(h);
    }
  });
});
