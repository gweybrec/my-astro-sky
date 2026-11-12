/**
 * Covers the gaps left by wcs-reader.test.ts:
 *  - extractFITSHeaderFromTIFF  (lines 165-225) — entirely untested
 *  - extractFITSHeaderFromFITS  edge cases (no-END block, multi-block)
 *  - extractWCS                 CDELT+PC form and error paths
 *  - wcsToCorrespondences       SIP distortion
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractFITSHeaderFromTIFF,
  extractFITSHeaderFromFITS,
  parseFITSHeader,
  wcsFromHeader,
  wcsToCorrespondences,
  extractWCS,
} from '../../server/wcs-reader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '../fixtures');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal FITS binary buffer (80-char records, 2880-byte blocks). */
function makeFITSBuffer(
  keywords: Record<string, number | string | boolean>,
  includeEND = true,
): Buffer {
  const records: string[] = [];

  for (const [kw, val] of Object.entries(keywords)) {
    let valStr: string;
    if (typeof val === 'boolean') {
      valStr = val ? 'T' : 'F';
    } else if (typeof val === 'string') {
      valStr = `'${val.padEnd(8)}'`;
    } else {
      // Numeric — right-justified in 20 chars
      valStr = String(val).padStart(20);
    }
    const record = `${kw.padEnd(8)}= ${valStr}`.padEnd(80);
    records.push(record.slice(0, 80));
  }

  if (includeEND) {
    records.push('END'.padEnd(80));
  }

  // Pad to 2880-byte block boundary
  while ((records.length * 80) % 2880 !== 0) {
    records.push(' '.repeat(80));
  }

  return Buffer.from(records.join(''), 'ascii');
}

/** Build a minimal little-endian TIFF buffer with ImageDescription tag set to `description`. */
function makeTIFFBuffer(description: string, bigEndian = false): Buffer {
  const enc = bigEndian ? 'MM' : 'II';
  const le = !bigEndian;

  const descBytes = Buffer.from(description + '\0', 'ascii');
  const count = descBytes.length;

  // Header (8) + IFD numEntries (2) + 1 entry (12) + nextIFD (4) + data
  const dataOffset = 8 + 2 + 12 + 4; // = 26
  const total = dataOffset + count;
  const buf = Buffer.alloc(total);

  const writeU16 = (off: number, v: number) =>
    le ? buf.writeUInt16LE(v, off) : buf.writeUInt16BE(v, off);
  const writeU32 = (off: number, v: number) =>
    le ? buf.writeUInt32LE(v, off) : buf.writeUInt32BE(v, off);

  buf.write(enc, 0, 'ascii'); // byte order
  writeU16(2, 42); // TIFF magic
  writeU32(4, 8); // IFD offset

  writeU16(8, 1); // 1 IFD entry
  writeU16(10, 270); // tag: ImageDescription
  writeU16(12, 2); // type: ASCII
  writeU32(14, count); // count
  writeU32(18, dataOffset); // data offset
  writeU32(22, 0); // next IFD = 0 (end)

  descBytes.copy(buf, dataOffset);
  return buf;
}

// ─── extractFITSHeaderFromTIFF ────────────────────────────────────────────────

describe('extractFITSHeaderFromTIFF()', () => {
  it('returns null for buffer shorter than 8 bytes', () => {
    expect(extractFITSHeaderFromTIFF(Buffer.from([0x49, 0x49, 0x2a, 0x00]))).toBeNull();
  });

  it('returns null for invalid byte-order marker', () => {
    const buf = Buffer.alloc(16, 0x00);
    buf.write('AB', 0, 'ascii');
    expect(extractFITSHeaderFromTIFF(buf)).toBeNull();
  });

  it('returns null for wrong TIFF magic number', () => {
    const buf = Buffer.alloc(16, 0x00);
    buf.write('II', 0, 'ascii');
    buf.writeUInt16LE(43, 2); // wrong magic (should be 42)
    expect(extractFITSHeaderFromTIFF(buf)).toBeNull();
  });

  it('extracts ImageDescription from little-endian TIFF', () => {
    const desc = 'CRVAL1 = 83.82 / RA';
    const buf = makeTIFFBuffer(desc, false);
    const result = extractFITSHeaderFromTIFF(buf);
    expect(result).not.toBeNull();
    expect(result).toContain('CRVAL1');
  });

  it('extracts ImageDescription from big-endian TIFF', () => {
    const desc = 'CRPIX1 = 960.0 / ref pixel';
    const buf = makeTIFFBuffer(desc, true);
    const result = extractFITSHeaderFromTIFF(buf);
    expect(result).not.toBeNull();
    expect(result).toContain('CRPIX1');
  });

  it('returns null when no ImageDescription tag is present', () => {
    // Build a TIFF with a different tag (e.g. tag 256 = ImageWidth)
    const buf = Buffer.alloc(26);
    buf.write('II', 0, 'ascii');
    buf.writeUInt16LE(42, 2);
    buf.writeUInt32LE(8, 4);
    buf.writeUInt16LE(1, 8); // 1 entry
    buf.writeUInt16LE(256, 10); // tag: ImageWidth (not 270)
    buf.writeUInt16LE(3, 12); // type: SHORT
    buf.writeUInt32LE(1, 14); // count
    buf.writeUInt32LE(1920, 18); // value
    buf.writeUInt32LE(0, 22); // next IFD
    expect(extractFITSHeaderFromTIFF(buf)).toBeNull();
  });

  it('returns null when buffer is too small for data at indicated offset', () => {
    const buf = makeTIFFBuffer('CRVAL1=1');
    // Truncate before the data region
    expect(extractFITSHeaderFromTIFF(buf.slice(0, 10))).toBeNull();
  });
});

// ─── extractFITSHeaderFromFITS — edge cases ───────────────────────────────────

describe('extractFITSHeaderFromFITS() — edge cases', () => {
  it('returns the full content when buffer has no END keyword', () => {
    // All-space block — no END record found anywhere
    const buf = Buffer.alloc(2880, 0x20);
    const result = extractFITSHeaderFromFITS(buf);
    // Returns full buffer content (fell through without END)
    expect(result.length).toBe(2880);
  });

  it('handles END in the second 2880-byte block', () => {
    // Block 0: keywords, no END
    const block0 = makeFITSBuffer({ SIMPLE: true }, false /* no END in block 0 */);
    // Block 1: END keyword
    const block1 = makeFITSBuffer({}, true);
    const combined = Buffer.concat([block0, block1]);
    const result = extractFITSHeaderFromFITS(combined);
    expect(result).toContain('SIMPLE');
    expect(result.length).toBeGreaterThan(2880);
  });
});

// ─── parseFITSHeader — boolean and string values ──────────────────────────────

describe('parseFITSHeader() — boolean and string values', () => {
  it('parses T as boolean true', () => {
    const h = parseFITSHeader('SIMPLE  = T'.padEnd(80));
    expect(h['SIMPLE']).toBe(true);
  });

  it('parses F as boolean false', () => {
    const h = parseFITSHeader('EXTEND  = F'.padEnd(80));
    expect(h['EXTEND']).toBe(false);
  });

  it('parses quoted string values', () => {
    const h = parseFITSHeader("CTYPE1  = 'RA---TAN'  / WCS type".padEnd(80));
    expect(h['CTYPE1']).toBe('RA---TAN');
  });

  it('handles slash in a quoted string (does not strip it)', () => {
    const h = parseFITSHeader("ORIGIN  = 'ESO/VLT'  / Observatory".padEnd(80));
    expect(h['ORIGIN']).toBe('ESO/VLT');
  });
});

// ─── extractWCS — CDELT + PC form ─────────────────────────────────────────────

describe('extractWCS() — CDELT+PC matrix form', () => {
  it('constructs a WCS from CDELT1/CDELT2 without CD matrix (identity PC)', () => {
    const buf = makeFITSBuffer({
      CRPIX1: 960.0,
      CRPIX2: 540.0,
      CRVAL1: 83.82,
      CRVAL2: -5.39,
      CDELT1: -0.000277778, // ≈ 1 arcsec/px
      CDELT2: 0.000277778,
      NAXIS1: 1920,
      NAXIS2: 1080,
    });
    const wcs = extractWCS(buf, '.fits');
    expect(wcs).not.toBeNull();
    // With identity PC (default), CD1_1 = CDELT1 * PC1_1 = CDELT1 * 1
    expect(wcs!.CD1_1).toBeCloseTo(-0.000277778, 8);
    expect(wcs!.CD2_2).toBeCloseTo(0.000277778, 8);
    // Off-diagonal should be zero (identity PC)
    expect(wcs!.CD1_2).toBeCloseTo(0, 10);
    expect(wcs!.CD2_1).toBeCloseTo(0, 10);
  });

  it('applies PC matrix when present with CDELT', () => {
    const cos45 = Math.cos(Math.PI / 4); // ≈ 0.7071
    const buf = makeFITSBuffer({
      CRPIX1: 960.0,
      CRPIX2: 540.0,
      CRVAL1: 83.82,
      CRVAL2: -5.39,
      CDELT1: -0.000277778,
      CDELT2: 0.000277778,
      PC1_1: cos45,
      PC1_2: -cos45,
      PC2_1: cos45,
      PC2_2: cos45,
      NAXIS1: 1920,
      NAXIS2: 1080,
    });
    const wcs = extractWCS(buf, '.fits');
    expect(wcs).not.toBeNull();
    // CD1_1 = CDELT1 * PC1_1
    expect(wcs!.CD1_1).toBeCloseTo(-0.000277778 * cos45, 8);
    expect(wcs!.CD1_2).toBeCloseTo(-0.000277778 * -cos45, 8);
  });

  it('returns null when neither CD nor CDELT form is present', () => {
    const buf = makeFITSBuffer({
      CRPIX1: 960.0,
      CRPIX2: 540.0,
      CRVAL1: 83.82,
      CRVAL2: -5.39,
      // No CD, no CDELT
    });
    expect(extractWCS(buf, '.fits')).toBeNull();
  });

  it('returns null when required CRPIX/CRVAL keys are missing', () => {
    const buf = makeFITSBuffer({
      // CRPIX1 missing
      CRPIX2: 540.0,
      CRVAL1: 83.82,
      CRVAL2: -5.39,
      CDELT1: -0.000278,
      CDELT2: 0.000278,
    });
    expect(extractWCS(buf, '.fits')).toBeNull();
  });

  it('returns null for unsupported extension', () => {
    const buf = makeFITSBuffer({ CRPIX1: 1, CRPIX2: 1, CRVAL1: 0, CRVAL2: 0 });
    expect(extractWCS(buf, '.jpg')).toBeNull();
  });
});

// ─── wcsToCorrespondences — SIP distortion ─────────────────────────────────────

describe('wcsToCorrespondences() — SIP distortion', () => {
  // Real M13 solution by astrometry.net: order-2 SIP, 3840 × 2160.
  const header = parseFITSHeader(
    extractFITSHeaderFromFITS(fs.readFileSync(path.join(FIXTURES, 'astrometry/10796000-wcs.fits'))),
  );

  it('reads the SIP terms of the header', () => {
    const wcs = wcsFromHeader(header)!;
    expect(wcs.sip?.a).toEqual({
      '0_2': 8.28609032191e-8,
      '1_1': -1.56145936951e-7,
      '2_0': 2.2860920409e-7,
    });
    expect(Object.keys(wcs.sip!.b)).toEqual(['0_2', '1_1', '2_0']);
  });

  it('moves a corner point by the SIP shift', () => {
    const withSip = wcsFromHeader(header)!;
    const without = { ...withSip, sip: undefined };
    const a = wcsToCorrespondences(withSip, 3840, 2160, false);
    const b = wcsToCorrespondences(without, 3840, 2160, false);
    // Degrees between the two sky positions of a point.
    const apart = (i: number) =>
      Math.hypot(
        (a[i].starRa! - b[i].starRa!) * Math.cos((a[i].starDec! * Math.PI) / 180),
        a[i].starDec! - b[i].starDec!,
      );
    const scale = Math.hypot(withSip.CD1_1, withSip.CD2_1); // degrees per pixel
    // Corner (0.05, 0.05): u, v from CRPIX, then the shift f(u, v), g(u, v) of the terms above.
    const u = 3840 * 0.05 + 1 - withSip.CRPIX1;
    const v = 2160 * 0.05 + 1 - withSip.CRPIX2;
    const f = 8.28609032191e-8 * v * v - 1.56145936951e-7 * u * v + 2.2860920409e-7 * u * u;
    const g = 3.12126986089e-7 * v * v - 4.26348787719e-8 * u * v - 1.97393184059e-7 * u * u;
    expect(apart(0) / scale).toBeCloseTo(Math.hypot(f, g), 1);
    expect(Math.hypot(f, g)).toBeGreaterThan(0.1); // a real shift, not a rounding
  });
});
