/**
 * Tests for the capture-metadata additions to wcs-reader:
 *  - the DATE-OBS sane-date picker (Siril Jan-1 placeholder + DATE fallback)
 *  - extractCaptureDetails (FITS keyword → field id mapping)
 *  - FILTER extraction
 * plus the frontend/server catalog drift guard and the client sanitizer.
 */
import { describe, it, expect } from 'vitest';
import {
  isPlaceholderDate,
  isUsableDate,
  pickObsDate,
  extractCaptureDetails,
  sanitizeCaptureDetails as serverSanitize,
  CAPTURE_FITS_MAP,
} from '../../server/wcs-reader';
import { CAPTURE_FIELDS, sanitizeCaptureDetails as clientSanitize } from '../../src/capture-fields';

// ─── Date placeholder handling ─────────────────────────────────────────────────

describe('isPlaceholderDate', () => {
  it('matches the Siril Jan-1 midnight placeholder', () => {
    expect(isPlaceholderDate('2026-01-01T00:00:00')).toBe(true);
    expect(isPlaceholderDate('2020-01-01T00:00:00Z')).toBe(true);
    expect(isPlaceholderDate('2026-01-01T00:00:00.000')).toBe(true);
    expect(isPlaceholderDate(' 2026-01-01T00:00:00 ')).toBe(true);
  });

  it('does not match real dates', () => {
    expect(isPlaceholderDate('2026-03-17T20:38:44')).toBe(false);
    expect(isPlaceholderDate('2026-01-01T00:00:01')).toBe(false); // one second past
    expect(isPlaceholderDate('2026-01-02T00:00:00')).toBe(false); // Jan 2
  });
});

describe('isUsableDate', () => {
  it('accepts a real parseable non-placeholder date', () => {
    expect(isUsableDate('2026-03-17T20:38:44')).toBe(true);
  });
  it('rejects the placeholder, empty, and garbage', () => {
    expect(isUsableDate('2026-01-01T00:00:00')).toBe(false);
    expect(isUsableDate('')).toBe(false);
    expect(isUsableDate('   ')).toBe(false);
    expect(isUsableDate('not-a-date')).toBe(false);
    expect(isUsableDate(undefined)).toBe(false);
    expect(isUsableDate(12345)).toBe(false);
  });
});

describe('pickObsDate', () => {
  it('keeps a real DATE-OBS (normalised to UTC)', () => {
    expect(pickObsDate('2026-03-17T20:38:44', '2026-04-25T10:26:45')).toBe('2026-03-17T20:38:44Z');
  });

  it('falls back to DATE when DATE-OBS is the placeholder', () => {
    // Real Vespera/Siril case: DATE-OBS is Jan-1 placeholder, DATE is the real processing date.
    expect(pickObsDate('2026-01-01T00:00:00', '2026-04-25T10:26:45')).toBe('2026-04-25T10:26:45Z');
  });

  it('returns undefined when both DATE-OBS and DATE are placeholders/missing', () => {
    expect(pickObsDate('2026-01-01T00:00:00', '2025-01-01T00:00:00')).toBeUndefined();
    expect(pickObsDate('2026-01-01T00:00:00', undefined)).toBeUndefined();
    expect(pickObsDate(undefined, undefined)).toBeUndefined();
  });

  it('uses DATE when DATE-OBS is absent', () => {
    expect(pickObsDate(undefined, '2026-06-15T21:16:20')).toBe('2026-06-15T21:16:20Z');
  });
});

// ─── Capture-detail extraction ─────────────────────────────────────────────────

describe('extractCaptureDetails', () => {
  it('maps known keywords to field ids with the right types', () => {
    const parsed = {
      GAIN: 120,
      OFFSET: 30,
      'CCD-TEMP': -10.2,
      'SET-TEMP': -10,
      XBINNING: 2,
      YBINNING: 2,
    };
    const out = extractCaptureDetails(parsed);
    expect(out).toEqual({
      gain: 120,
      offset: 30,
      ccdTemp: -10.2,
      setTemp: -10,
      binning: '2x2',
    });
  });

  it('ignores gear-derived keywords (focal length, f-ratio, aperture, pixel size, bayer, object)', () => {
    const out = extractCaptureDetails({
      FOCALLEN: 250,
      FOCRATIO: 4.9,
      APTDIA: 51,
      XPIXSZ: 2.9,
      BAYERPAT: 'RGGB',
      OBJECT: 'M51',
    });
    expect(out).toEqual({});
  });

  it('prefers ISOSPEED over ISO for the iso field', () => {
    expect(extractCaptureDetails({ ISOSPEED: 800, ISO: 100 }).iso).toBe(800);
    expect(extractCaptureDetails({ ISO: 100 }).iso).toBe(100);
  });

  it('omits absent, empty, and non-finite values', () => {
    expect(extractCaptureDetails({})).toEqual({});
    expect(extractCaptureDetails({ GAIN: 'not-a-number' })).toEqual({});
    expect(extractCaptureDetails({ OBJECT: '   ' })).toEqual({});
    expect(extractCaptureDetails({ CCD_TEMP: -5 })).toEqual({}); // wrong key (underscore)
  });

  it('formats binning as NxM from X/Y binning', () => {
    expect(extractCaptureDetails({ XBINNING: 2, YBINNING: 2 }).binning).toBe('2x2');
    // Missing YBINNING falls back to the X value.
    expect(extractCaptureDetails({ XBINNING: 3 }).binning).toBe('3x3');
  });
});

// ─── Catalog drift guard ───────────────────────────────────────────────────────

describe('capture-field catalog', () => {
  it('client CAPTURE_FIELDS ids match the server CAPTURE_FITS_MAP ids exactly', () => {
    const serverIds = CAPTURE_FITS_MAP.map((f) => f.id).sort();
    const clientIds = CAPTURE_FIELDS.map((f) => f.id).sort();
    expect(clientIds).toEqual(serverIds);
  });

  it('client and server agree on each field kind/type', () => {
    const serverKind = new Map(CAPTURE_FITS_MAP.map((f) => [f.id, f.kind]));
    for (const f of CAPTURE_FIELDS) {
      const expected = f.type === 'number' ? 'number' : 'string';
      expect(serverKind.get(f.id)).toBe(expected);
    }
  });
});

// ─── Sanitizers (client + server parity) ───────────────────────────────────────

describe('sanitizeCaptureDetails (client and server)', () => {
  for (const [label, sanitize] of [
    ['server', serverSanitize],
    ['client', clientSanitize],
  ] as const) {
    describe(label, () => {
      it('keeps valid known fields', () => {
        expect(sanitize({ gain: 120, ccdTemp: -10, binning: '2x2' })).toEqual({
          gain: 120,
          ccdTemp: -10,
          binning: '2x2',
        });
      });

      it('drops unknown keys (incl. gear-derived and instrument)', () => {
        expect(sanitize({ gain: 100, bogus: 5, focalLength: 250, INSTRUME: 'ATIK' })).toEqual({
          gain: 100,
        });
      });

      it('drops non-finite numbers and empty strings', () => {
        expect(sanitize({ gain: NaN, offset: Infinity, binning: '' })).toEqual({});
        expect(sanitize({ gain: '' })).toEqual({});
      });

      it('coerces numeric strings to numbers and trims strings', () => {
        expect(sanitize({ gain: '120', binning: '  2x2  ' })).toEqual({
          gain: 120,
          binning: '2x2',
        });
      });

      it('caps string length at 64 chars', () => {
        const long = 'x'.repeat(200);
        expect((sanitize({ binning: long }).binning as string).length).toBe(64);
      });

      it('returns {} for non-object input', () => {
        expect(sanitize(null)).toEqual({});
        expect(sanitize([1, 2, 3])).toEqual({});
        expect(sanitize('nope')).toEqual({});
      });
    });
  }
});
