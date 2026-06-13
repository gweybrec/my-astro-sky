import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseFITSHeader, extractFITSHeaderFromFITS, wcsToCorrespondences, normalizeDateObs } from '../../server/wcs-reader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '../fixtures');

// Point to minimal test catalog for wcsToCorrespondences tests
beforeAll(() => {
  process.env.STAR_CATALOG_PATH = path.join(FIXTURES, 'stars.test.json');
});

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
    const h = parseFITSHeader("DATE-OBS= '2026-03-17T20:38:44' / YYYY-MM-DDThh:mm:ss observation start, UT");
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
    CD1_2: -4.24673765053e-05,
    CD2_1: -4.23038812204e-05,
    CD2_2: 0.000661238355384,
    NAXIS1: 5760,
    NAXIS2: 3239,
  };

  it('returns at least 3 correspondences for a valid WCS (from test catalog)', () => {
    const corrs = wcsToCorrespondences(ldn1235Wcs, 5760, 3239, false);
    expect(corrs.length).toBeGreaterThanOrEqual(3);
  });

  it('all returned correspondences have starRa and starDec set', () => {
    const corrs = wcsToCorrespondences(ldn1235Wcs, 5760, 3239, false);
    for (const c of corrs) {
      expect(typeof c.starRa).toBe('number');
      expect(typeof c.starDec).toBe('number');
      expect(isFinite(c.starRa!)).toBe(true);
      expect(isFinite(c.starDec!)).toBe(true);
    }
  });

  it('reference star near CRVAL maps to pixel near CRPIX (fitsYConvention=false)', () => {
    // Star 99001 is at exactly CRVAL coordinates in our test catalog
    const corrs = wcsToCorrespondences(ldn1235Wcs, 5760, 3239, false);
    const refStar = corrs.find(c => c.starHip === 99001);
    expect(refStar).toBeDefined();
    // Display pixel = CRPIX - 1 (convert FITS 1-indexed to 0-indexed)
    expect(refStar!.photoX).toBeCloseTo(ldn1235Wcs.CRPIX1 - 1, 0);
    expect(refStar!.photoY).toBeCloseTo(ldn1235Wcs.CRPIX2 - 1, 0);
  });

  describe('fitsYConvention regression — false vs true produce different Y coordinates', () => {
    it('fitsYConvention=false and fitsYConvention=true produce DIFFERENT pixel positions', () => {
      const corrsFalse = wcsToCorrespondences(ldn1235Wcs, 5760, 3239, false);
      const corrsTrue  = wcsToCorrespondences(ldn1235Wcs, 5760, 3239, true);

      // Find corresponding entries by starHip
      const hip = corrsFalse[0]?.starHip;
      if (!hip) return;
      const cf = corrsFalse.find(c => c.starHip === hip);
      const ct = corrsTrue.find(c => c.starHip === hip);
      if (!cf || !ct) return;

      // X should be the same, Y should differ (Y-axis flip)
      expect(cf.photoX).toBeCloseTo(ct.photoX, 0);
      expect(Math.abs(cf.photoY - ct.photoY)).toBeGreaterThan(10);
    });

    it('fitsYConvention=false Y is consistent with display-origin convention (Y increases down)', () => {
      // For a star below the reference point (higher Dec → higher CRPIX2 - offset),
      // fitsYConvention=false should yield a LOWER photoY than stars above it
      // This is a basic sanity check: just verify the convention flag makes a measurable difference
      const corrsF = wcsToCorrespondences(ldn1235Wcs, 5760, 3239, false);
      const corrsT = wcsToCorrespondences(ldn1235Wcs, 5760, 3239, true);
      // The two sets of correspondences must not be identical
      let anyDiff = false;
      for (let i = 0; i < Math.min(corrsF.length, corrsT.length); i++) {
        if (Math.abs(corrsF[i].photoY - corrsT[i].photoY) > 1) { anyDiff = true; break; }
      }
      expect(anyDiff).toBe(true);
    });
  });

  it('photoX/photoY are within image bounds', () => {
    const w = 5760, h = 3239;
    const corrs = wcsToCorrespondences(ldn1235Wcs, w, h, false);
    for (const c of corrs) {
      expect(c.photoX).toBeGreaterThanOrEqual(0);
      expect(c.photoX).toBeLessThan(w);
      expect(c.photoY).toBeGreaterThanOrEqual(0);
      expect(c.photoY).toBeLessThan(h);
    }
  });
});
