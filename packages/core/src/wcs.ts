import { bytesToAscii7 } from './raw-decode/ascii';
import { logDebug } from './platform/log';
import { checkReferencePoints } from './reference-points';
import { REFERENCE_FRACTIONS } from './photo-sky-model';

export interface WCSData {
  CRPIX1: number;
  CRPIX2: number;
  CRVAL1: number; // RA of reference point (degrees)
  CRVAL2: number; // Dec of reference point (degrees)
  CD1_1: number;
  CD1_2: number;
  CD2_1: number;
  CD2_2: number;
  NAXIS1: number;
  NAXIS2: number;
  /** The SIP distortion of the solution, when it has one (pixel to sky: A for axis 1, B for axis 2). */
  sip?: SipDistortion;
  // Optional observation metadata from FITS headers
  dateObs?: string; // DATE-OBS (or DATE fallback), normalised to UTC ISO 8601 (Z suffix)
  expTime?: number; // EXPTIME in seconds
  stackCnt?: number; // STACKCNT, number of stacked frames
  filter?: string; // FILTER name (feeds the integration row)
  captureDetails?: Record<string, number | string>; // parsed capture fields (see CAPTURE_FITS_MAP)
}

/**
 * SIP polynomials (Shupe et al. 2005): pixel offsets (u, v) from CRPIX become (u + f(u, v), v + g(u, v)) before
 * the CD matrix, with f = Σ a[`i_j`]·u^i·v^j and g the same with `b`.
 */
export interface SipDistortion {
  a: Record<string, number>;
  b: Record<string, number>;
}

/** The SIP distortion of a parsed header (A_ORDER, A_i_j, B_ORDER, B_i_j), or undefined when it has none. */
function sipFromHeader(
  parsed: Record<string, number | string | boolean>,
): SipDistortion | undefined {
  const terms = (prefix: 'A' | 'B') => {
    const order = parsed[`${prefix}_ORDER`];
    const out: Record<string, number> = {};
    if (typeof order !== 'number' || !(order > 0)) return out;
    for (let i = 0; i <= order; i++) {
      for (let j = 0; i + j <= order; j++) {
        const value = parsed[`${prefix}_${i}_${j}`];
        if (typeof value === 'number' && Number.isFinite(value) && value !== 0)
          out[`${i}_${j}`] = value;
      }
    }
    return out;
  };
  const a = terms('A');
  const b = terms('B');
  return Object.keys(a).length > 0 || Object.keys(b).length > 0 ? { a, b } : undefined;
}

/** Σ terms[`i_j`]·u^i·v^j. */
function sipSum(terms: Record<string, number>, u: number, v: number): number {
  let sum = 0;
  for (const [key, coef] of Object.entries(terms)) {
    const [i, j] = key.split('_').map(Number);
    sum += coef * u ** i * v ** j;
  }
  return sum;
}

/** Append 'Z' to a FITS DATE-OBS value that has no timezone designator. */
export function normalizeDateObs(raw: string): string {
  if (/Z|[+-]\d\d:?\d\d$/.test(raw)) return raw;
  return raw + 'Z';
}

/**
 * True for the Siril placeholder timestamp `YYYY-01-01T00:00:00` (midnight, Jan 1),
 * written when a stacked/mosaic image has no single observation time to carry forward.
 */
export function isPlaceholderDate(raw: string): boolean {
  return /^\d{4}-01-01T00:00:00(\.0+)?(Z|[+-]\d\d:?\d\d)?$/.test(raw.trim());
}

/** A header date string we can trust: parseable to a real Date and not the placeholder. */
export function isUsableDate(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.trim().length === 0) return false;
  if (isPlaceholderDate(raw)) return false;
  return !Number.isNaN(new Date(normalizeDateObs(raw.trim())).getTime());
}

/**
 * Pick the best observation date: DATE-OBS if usable, else the DATE card if usable,
 * else undefined. `DATE` is the file-processing timestamp — only a sane fallback.
 */
export function pickObsDate(dateObs?: unknown, date?: unknown): string | undefined {
  if (isUsableDate(dateObs)) return normalizeDateObs(dateObs.trim());
  if (isUsableDate(date)) return normalizeDateObs(date.trim());
  return undefined;
}

/**
 * Canonical map of capture-detail field id → FITS keyword(s) + how to coerce the value.
 * The frontend catalog (`src/capture-fields.ts`) must use the same ids (drift test).
 * `INSTRUME`/`TELESCOP` are intentionally excluded — gear comes from the setup link.
 */
export const CAPTURE_FITS_MAP: Array<{
  id: string;
  keys: string[];
  kind: 'number' | 'string';
}> = [
  { id: 'gain', keys: ['GAIN'], kind: 'number' },
  { id: 'offset', keys: ['OFFSET'], kind: 'number' },
  { id: 'iso', keys: ['ISOSPEED', 'ISO'], kind: 'number' },
  { id: 'ccdTemp', keys: ['CCD-TEMP'], kind: 'number' },
  { id: 'setTemp', keys: ['SET-TEMP'], kind: 'number' },
  { id: 'binning', keys: ['XBINNING'], kind: 'string' }, // formatted "NxM" using YBINNING
];

const CAPTURE_FIELD_KIND = new Map<string, 'number' | 'string'>(
  CAPTURE_FITS_MAP.map((f) => [f.id, f.kind]),
);

/**
 * Keep only known capture-detail fields with valid values: finite numbers, or
 * trimmed non-empty strings (≤64 chars). Unknown keys and bad values are dropped.
 * Shared by the server DB layer and (mirrored) by the client sanitizer.
 */
export function sanitizeCaptureDetails(obj: unknown): Record<string, number | string> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const src = obj as Record<string, unknown>;
  const out: Record<string, number | string> = {};
  for (const [id, kind] of CAPTURE_FIELD_KIND) {
    const raw = src[id];
    if (raw === undefined || raw === null || raw === '') continue;
    if (kind === 'number') {
      const num = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(num)) out[id] = num;
    } else {
      const str = String(raw).trim().slice(0, 64);
      if (str.length > 0) out[id] = str;
    }
  }
  return out;
}

/** Extract the known capture fields from a parsed FITS header, omitting absent/invalid ones. */
export function extractCaptureDetails(
  parsed: Record<string, number | string | boolean>,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const { id, keys, kind } of CAPTURE_FITS_MAP) {
    // First present keyword wins (e.g. ISOSPEED before ISO).
    const key = keys.find((k) => parsed[k] !== undefined);
    if (key === undefined) continue;
    const raw = parsed[key];

    if (kind === 'number') {
      const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
      // Round away 32-bit-float noise from FITS values (e.g. 2.90000009536743 → 2.9).
      if (Number.isFinite(num)) out[id] = Number(num.toFixed(4));
    } else {
      const str = String(raw).trim();
      if (str.length === 0) continue;
      if (id === 'binning') {
        const yb = parsed['YBINNING'];
        const ybStr = yb !== undefined ? String(yb).trim() : str;
        out[id] = `${str}x${ybStr}`;
      } else {
        out[id] = str;
      }
    }
  }
  return out;
}

export interface Correspondence {
  pointIndex: number;
  photoX: number;
  photoY: number;
  starHip: number;
  starName: string;
  starRa?: number;
  starDec?: number;
}

/** Decode bytes `[start, end)` of `buf` as 7-bit ASCII (like Node's `toString('ascii')`; clamps like `subarray`). */
export function bytesToAscii(buf: Uint8Array, start: number, end: number): string {
  return bytesToAscii7(buf, start, end);
}

// --- FITS Header Parsing ---

export function parseFITSHeader(headerStr: string): Record<string, number | string | boolean> {
  const result: Record<string, number | string | boolean> = {};

  // Handle both formats: 80-char fixed-width or newline-delimited
  let records: string[];
  if (headerStr.includes('\n')) {
    // Newline-delimited format (ASTAP text-style WCS)
    records = headerStr.split('\n').filter((line) => line.trim());
  } else {
    // Fixed 80-character records (binary FITS)
    records = [];
    for (let i = 0; i < headerStr.length; i += 80) {
      records.push(headerStr.substring(i, i + 80));
    }
  }

  for (const record of records) {
    if (record.startsWith('END')) break;
    if (record.startsWith('COMMENT')) continue; // Skip comment lines

    const keyword = record.substring(0, 8).trim();
    if (!keyword || record[8] !== '=') continue;

    let valueStr = record.substring(10);
    // Remove inline comment (after /)
    const slashIdx = valueStr.indexOf('/');
    if (slashIdx >= 0) {
      // Check it's not inside a string
      const quoteCount = (valueStr.substring(0, slashIdx).match(/'/g) || []).length;
      if (quoteCount % 2 === 0) {
        valueStr = valueStr.substring(0, slashIdx);
      }
    }
    valueStr = valueStr.trim();

    if (valueStr === 'T') {
      result[keyword] = true;
    } else if (valueStr === 'F') {
      result[keyword] = false;
    } else if (valueStr.startsWith("'")) {
      // String value
      const endQuote = valueStr.indexOf("'", 1);
      result[keyword] =
        endQuote > 0 ? valueStr.substring(1, endQuote).trim() : valueStr.substring(1).trim();
    } else {
      const num = parseFloat(valueStr);
      if (!isNaN(num)) {
        result[keyword] = num;
      }
    }
  }
  return result;
}

/**
 * Parse a plate-solver `.wcs` sidecar (ASTAP `.wcs`, astrometry.net `wcs.fits`) into the same
 * header shape as `parseFITSHeader`. Both are FITS headers: 80-char records (astrometry.net,
 * and ASTAP's binary form) or newline-delimited text (ASTAP's text form); both are handled.
 */
export function parseWcsSidecar(bytes: Uint8Array): Record<string, number | string | boolean> {
  return parseFITSHeader(extractFITSHeaderFromFITS(bytes));
}

// --- TIFF Tag 270 Extraction ---

export function extractFITSHeaderFromTIFF(buffer: Uint8Array): string | null {
  if (buffer.length < 8) return null;

  // Check byte order
  const bo = bytesToAscii(buffer, 0, 2);
  const le = bo === 'II';
  if (!le && bo !== 'MM') return null;

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const readU16 = (off: number) => view.getUint16(off, le);
  const readU32 = (off: number) => view.getUint32(off, le);

  // Check magic number
  if (readU16(2) !== 42) return null;

  // Read IFD offset
  let ifdOffset = readU32(4);

  // Traverse IFDs (usually just one, but support chained)
  while (ifdOffset > 0 && ifdOffset < buffer.length - 2) {
    const numEntries = readU16(ifdOffset);
    let entryOffset = ifdOffset + 2;

    for (let i = 0; i < numEntries; i++) {
      if (entryOffset + 12 > buffer.length) break;

      const tag = readU16(entryOffset);
      if (tag === 270) {
        // ImageDescription
        const type = readU16(entryOffset + 2);
        const count = readU32(entryOffset + 4);

        if (type !== 2) {
          // Not ASCII
          entryOffset += 12;
          continue;
        }

        let dataOffset: number;
        if (count <= 4) {
          dataOffset = entryOffset + 8;
        } else {
          dataOffset = readU32(entryOffset + 8);
        }

        if (dataOffset + count > buffer.length) return null;
        const str = bytesToAscii(buffer, dataOffset, dataOffset + count).replace(/\0/g, '');
        // Check if it looks like a FITS header (contains WCS keywords)
        if (str.includes('CRVAL1') || str.includes('CRPIX1') || str.includes('CD1_1')) {
          return str;
        }
        return str;
      }
      entryOffset += 12;
    }

    // Next IFD offset
    const nextIFDOff = entryOffset;
    if (nextIFDOff + 4 > buffer.length) break;
    ifdOffset = readU32(nextIFDOff);
    if (ifdOffset === 0) break;
  }

  return null;
}

// --- FITS File Header Extraction ---

export function extractFITSHeaderFromFITS(buffer: Uint8Array): string {
  // FITS header starts at byte 0, 80-char records, blocks of 2880 bytes
  let header = '';
  for (let block = 0; block * 2880 < buffer.length; block++) {
    const blockStart = block * 2880;
    const blockEnd = Math.min(blockStart + 2880, buffer.length);
    const blockStr = bytesToAscii(buffer, blockStart, blockEnd);
    header += blockStr;

    // Check for END keyword
    for (let i = 0; i < blockStr.length; i += 80) {
      const record = blockStr.substring(i, i + 80);
      if (record.substring(0, 8).trim() === 'END') {
        return header;
      }
    }
  }
  return header;
}

// --- WCS → Correspondences ---

const DEG2RAD = Math.PI / 180;

/**
 * The reference points a plate-solved photo is stored with: points spread over the whole photo, each with the sky
 * position its plate solution gives. They are exact wherever they are, so they are taken where they place the photo
 * best rather than on catalogue stars, which may be few, close together or in one corner. Empty when the solution
 * gives no usable points (see {@link checkReferencePoints}).
 *
 * @param fitsYConvention - true when the solution counts rows from the bottom (Siril, PixInsight, ASTAP); false when
 *   from the top (solve-field, astrometry.net).
 */
export function wcsToCorrespondences(
  wcs: WCSData,
  imageWidth: number,
  imageHeight: number,
  fitsYConvention = false,
): Correspondence[] {
  const ra0Rad = wcs.CRVAL1 * DEG2RAD;
  const dec0Rad = wcs.CRVAL2 * DEG2RAD;
  const sinDec0 = Math.sin(dec0Rad);
  const cosDec0 = Math.cos(dec0Rad);

  const result: Correspondence[] = [];
  for (const fy of REFERENCE_FRACTIONS) {
    for (const fx of REFERENCE_FRACTIONS) {
      const px = imageWidth * fx;
      const py = imageHeight * fy;
      // Display pixel (0-based, from the top) to the solution's pixel (1-based; from the bottom in the FITS convention).
      const u = px + 1 - wcs.CRPIX1;
      const v = (fitsYConvention ? imageHeight - py : py + 1) - wcs.CRPIX2;
      const dx = wcs.sip ? u + sipSum(wcs.sip.a, u, v) : u;
      const dy = wcs.sip ? v + sipSum(wcs.sip.b, u, v) : v;
      // Standard coordinates, then the inverse TAN projection.
      const xi = (wcs.CD1_1 * dx + wcs.CD1_2 * dy) * DEG2RAD;
      const eta = (wcs.CD2_1 * dx + wcs.CD2_2 * dy) * DEG2RAD;
      const denom = cosDec0 - eta * sinDec0;
      const ra = (ra0Rad + Math.atan2(xi, denom)) / DEG2RAD;
      const dec = Math.atan2(sinDec0 + eta * cosDec0, Math.hypot(xi, denom)) / DEG2RAD;
      result.push({
        pointIndex: result.length,
        photoX: px,
        photoY: py,
        starHip: 0,
        starName: `Synthetic ${result.length + 1}`,
        starRa: ((ra % 360) + 360) % 360,
        starDec: dec,
      });
    }
  }

  const problems = checkReferencePoints(result, imageWidth, imageHeight);
  if (problems.length > 0) {
    logDebug('WCS', `The plate solution gives no usable reference points: ${problems.join(', ')}`);
    return [];
  }
  return result;
}

export function extractWCS(buffer: Uint8Array, ext: string): WCSData | null {
  let headerStr: string | null = null;

  if (ext === '.fits' || ext === '.fit') {
    headerStr = extractFITSHeaderFromFITS(buffer);
  } else if (ext === '.tif' || ext === '.tiff') {
    headerStr = extractFITSHeaderFromTIFF(buffer);
  }

  if (!headerStr) return null;

  return wcsFromHeader(parseFITSHeader(headerStr));
}

/** The plate solution and capture fields of a parsed FITS header; null when it holds no usable solution. */
export function wcsFromHeader(parsed: Record<string, number | string | boolean>): WCSData | null {
  // Check CRPIX/CRVAL as always required
  const baseRequired = ['CRPIX1', 'CRPIX2', 'CRVAL1', 'CRVAL2'];
  for (const key of baseRequired) {
    if (typeof parsed[key] !== 'number') return null;
  }

  // Determine CD matrix: prefer CD form, fall back to PC+CDELT form
  let cd1_1: number, cd1_2: number, cd2_1: number, cd2_2: number;

  if (
    typeof parsed.CD1_1 === 'number' &&
    typeof parsed.CD1_2 === 'number' &&
    typeof parsed.CD2_1 === 'number' &&
    typeof parsed.CD2_2 === 'number'
  ) {
    // CD matrix form
    cd1_1 = parsed.CD1_1 as number;
    cd1_2 = parsed.CD1_2 as number;
    cd2_1 = parsed.CD2_1 as number;
    cd2_2 = parsed.CD2_2 as number;
  } else if (typeof parsed.CDELT1 === 'number' && typeof parsed.CDELT2 === 'number') {
    // PC matrix + CDELT form (PC defaults to identity if absent)
    const pc1_1 = typeof parsed.PC1_1 === 'number' ? (parsed.PC1_1 as number) : 1.0;
    const pc1_2 = typeof parsed.PC1_2 === 'number' ? (parsed.PC1_2 as number) : 0.0;
    const pc2_1 = typeof parsed.PC2_1 === 'number' ? (parsed.PC2_1 as number) : 0.0;
    const pc2_2 = typeof parsed.PC2_2 === 'number' ? (parsed.PC2_2 as number) : 1.0;
    const cdelt1 = parsed.CDELT1 as number;
    const cdelt2 = parsed.CDELT2 as number;
    cd1_1 = cdelt1 * pc1_1;
    cd1_2 = cdelt1 * pc1_2;
    cd2_1 = cdelt2 * pc2_1;
    cd2_2 = cdelt2 * pc2_2;
  } else {
    return null; // No usable WCS transformation matrix
  }

  const wcs: WCSData = {
    CRPIX1: parsed.CRPIX1 as number,
    CRPIX2: parsed.CRPIX2 as number,
    CRVAL1: parsed.CRVAL1 as number,
    CRVAL2: parsed.CRVAL2 as number,
    CD1_1: cd1_1,
    CD1_2: cd1_2,
    CD2_1: cd2_1,
    CD2_2: cd2_2,
    NAXIS1: (parsed.NAXIS1 as number) || 0,
    NAXIS2: (parsed.NAXIS2 as number) || 0,
  };
  const sip = sipFromHeader(parsed);
  if (sip) wcs.sip = sip;

  // DATE-OBS is preferred; fall back to the DATE card only when both are sane.
  // Siril writes the placeholder YYYY-01-01T00:00:00 for multi-session stacks.
  const obsDate = pickObsDate(parsed['DATE-OBS'], parsed['DATE']);
  if (obsDate) {
    wcs.dateObs = obsDate;
  }
  if (typeof parsed.EXPTIME === 'number' && isFinite(parsed.EXPTIME) && parsed.EXPTIME >= 0) {
    wcs.expTime = parsed.EXPTIME;
  }
  if (typeof parsed.STACKCNT === 'number' && isFinite(parsed.STACKCNT)) {
    wcs.stackCnt = Math.round(parsed.STACKCNT);
  }
  if (typeof parsed.FILTER === 'string' && parsed.FILTER.trim().length > 0) {
    wcs.filter = parsed.FILTER.trim();
  }
  const captureDetails = extractCaptureDetails(parsed);
  if (Object.keys(captureDetails).length > 0) {
    wcs.captureDetails = captureDetails;
  }

  return wcs;
}
