import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  // Optional observation metadata from FITS headers
  dateObs?: string; // DATE-OBS (or DATE fallback), normalised to UTC ISO 8601 (Z suffix)
  expTime?: number; // EXPTIME in seconds
  stackCnt?: number; // STACKCNT, number of stacked frames
  filter?: string; // FILTER name (feeds the integration row)
  captureDetails?: Record<string, number | string>; // parsed capture fields (see CAPTURE_FITS_MAP)
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

interface CatalogStar {
  hip: number;
  ra: number;
  dec: number;
  mag: number;
  name?: string;
  bayer?: string;
  constellation?: string;
}

interface Correspondence {
  pointIndex: number;
  photoX: number;
  photoY: number;
  starHip: number;
  starName: string;
  starRa?: number;
  starDec?: number;
}

// Server-side star catalog (loaded lazily)
let serverStars: CatalogStar[] | null = null;

function normalizeRA(ra: number): number {
  while (ra < 0) ra += 360;
  while (ra >= 360) ra -= 360;
  return ra;
}

export function loadServerCatalog(): CatalogStar[] {
  if (serverStars) return serverStars;

  // Check environment variable first, then fall back to the shipped catalog
  const publicDataDir = process.env.PUBLIC_DATA_DIR || path.join(__dirname, '..', 'public', 'data');
  const catalogPaths = [
    process.env.STAR_CATALOG_PATH,
    path.join(publicDataDir, 'stars.14.json'),
  ].filter(Boolean) as string[];

  let starsPath: string | null = null;
  let usedPath = '';

  for (const p of catalogPaths) {
    if (fs.existsSync(p)) {
      starsPath = p;
      usedPath = p;
      break;
    }
  }

  if (!starsPath) {
    console.error('[Catalog] No star catalog found. Tried:', catalogPaths);
    console.error('[Catalog] Run: bash scripts/download-catalog.sh 14');
    throw new Error('Star catalog not found');
  }

  const namesPath = path.join(
    process.env.PUBLIC_DATA_DIR || path.join(__dirname, '..', 'public', 'data'),
    'starnames.json',
  );

  const starsData = JSON.parse(fs.readFileSync(starsPath, 'utf-8'));
  const namesData = fs.existsSync(namesPath) ? JSON.parse(fs.readFileSync(namesPath, 'utf-8')) : {};

  serverStars = [];
  for (const f of starsData.features) {
    const hip: number = f.id;
    const [ra, dec]: [number, number] = f.geometry.coordinates;
    const info = namesData[String(hip)];
    serverStars.push({
      hip,
      ra: normalizeRA(ra),
      dec,
      mag: f.properties.mag,
      name: info?.name || undefined,
      bayer: info?.bayer || undefined,
      constellation: info?.c || undefined,
    });
  }

  serverStars.sort((a, b) => a.mag - b.mag);

  const catalogName = path.basename(usedPath);
  const maxMag = Math.max(...serverStars.map((s) => s.mag));
  console.log(
    `[Catalog] Loaded ${serverStars.length} stars from ${catalogName} (mag ≤ ${maxMag.toFixed(1)})`,
  );

  return serverStars;
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

// --- TIFF Tag 270 Extraction ---

export function extractFITSHeaderFromTIFF(buffer: Buffer): string | null {
  if (buffer.length < 8) return null;

  // Check byte order
  const bo = buffer.toString('ascii', 0, 2);
  const le = bo === 'II';
  if (!le && bo !== 'MM') return null;

  const readU16 = (off: number) => (le ? buffer.readUInt16LE(off) : buffer.readUInt16BE(off));
  const readU32 = (off: number) => (le ? buffer.readUInt32LE(off) : buffer.readUInt32BE(off));

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
        const str = buffer.toString('ascii', dataOffset, dataOffset + count).replace(/\0/g, '');
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

export function extractFITSHeaderFromFITS(buffer: Buffer): string {
  // FITS header starts at byte 0, 80-char records, blocks of 2880 bytes
  let header = '';
  for (let block = 0; block * 2880 < buffer.length; block++) {
    const blockStart = block * 2880;
    const blockEnd = Math.min(blockStart + 2880, buffer.length);
    const blockStr = buffer.toString('ascii', blockStart, blockEnd);
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

function starDisplayLabel(star: CatalogStar): string {
  if (star.name) {
    if (star.bayer && star.constellation) {
      return `${star.name} (${star.bayer} ${star.constellation})`;
    }
    return star.name;
  }
  if (star.bayer && star.constellation) {
    return `${star.bayer} ${star.constellation}`;
  }
  return `HIP ${star.hip}`;
}

// Generate synthetic correspondences from WCS when catalog stars are unavailable
// This creates reference points by sampling the image and computing their RA/Dec
function generateSyntheticCorrespondences(
  wcs: WCSData,
  imageWidth: number,
  imageHeight: number,
  fitsYConvention = false,
): Correspondence[] {
  const result: Correspondence[] = [];

  // Sample points in a grid pattern (corners + center + mid-edges)
  const samplePoints: [number, number][] = [
    [imageWidth * 0.25, imageHeight * 0.25], // Top-left quadrant
    [imageWidth * 0.75, imageHeight * 0.25], // Top-right quadrant
    [imageWidth * 0.5, imageHeight * 0.5], // Center
    [imageWidth * 0.25, imageHeight * 0.75], // Bottom-left quadrant
    [imageWidth * 0.75, imageHeight * 0.75], // Bottom-right quadrant
    [imageWidth * 0.5, imageHeight * 0.25], // Top-center
    [imageWidth * 0.5, imageHeight * 0.75], // Bottom-center
    [imageWidth * 0.25, imageHeight * 0.5], // Left-center
    [imageWidth * 0.75, imageHeight * 0.5], // Right-center
  ];

  // Convert each sample point from pixel to RA/Dec using WCS
  for (let i = 0; i < samplePoints.length; i++) {
    const [px, py] = samplePoints[i];

    // Convert display coords (0-indexed, origin top-left) to WCS coords
    // FITS convention (PixInsight/Siril): Y=1 is the bottom row, Y increases upward
    // Display convention (solve-field/astrometry.net): Y=1 is the top row, Y increases downward
    const wcsX = px + 1;
    const wcsY = fitsYConvention ? imageHeight - py : py + 1;

    // Compute pixel offset from reference pixel
    const dx = wcsX - wcs.CRPIX1;
    const dy = wcsY - wcs.CRPIX2;

    // Apply CD matrix to get standard coordinates (in degrees)
    const xi = wcs.CD1_1 * dx + wcs.CD1_2 * dy;
    const eta = wcs.CD2_1 * dx + wcs.CD2_2 * dy;

    // Convert standard coordinates to RA/Dec using inverse TAN projection
    const ra0Rad = wcs.CRVAL1 * DEG2RAD;
    const dec0Rad = wcs.CRVAL2 * DEG2RAD;
    const xiRad = xi * DEG2RAD;
    const etaRad = eta * DEG2RAD;

    const sinDec0 = Math.sin(dec0Rad);
    const cosDec0 = Math.cos(dec0Rad);

    const denom = cosDec0 - etaRad * sinDec0;
    const raRad = ra0Rad + Math.atan2(xiRad, denom);
    const decRad = Math.atan2(sinDec0 + etaRad * cosDec0, Math.sqrt(xiRad * xiRad + denom * denom));

    let ra = raRad * (180 / Math.PI);
    const dec = decRad * (180 / Math.PI);

    // Normalize RA to [0, 360)
    while (ra < 0) ra += 360;
    while (ra >= 360) ra -= 360;

    result.push({
      pointIndex: i,
      photoX: px,
      photoY: py,
      starHip: 0, // No catalog star
      starName: `Synthetic ${i + 1}`,
      starRa: ra,
      starDec: dec,
    });
  }

  console.log(`[WCS] Generated ${result.length} synthetic correspondences from WCS`);
  for (let i = 0; i < Math.min(result.length, 3); i++) {
    const c = result[i];
    console.log(
      `  [${i}] ${c.starName} at pixel (${c.photoX.toFixed(1)}, ${c.photoY.toFixed(1)}) → RA=${c.starRa?.toFixed(4)}°, Dec=${c.starDec?.toFixed(4)}°`,
    );
  }

  return result;
}

export function wcsToCorrespondences(
  wcs: WCSData,
  imageWidth: number,
  imageHeight: number,
  fitsYConvention = false,
): Correspondence[] {
  console.log('[WCS] Converting WCS to correspondences for image', imageWidth, 'x', imageHeight);
  console.log('[WCS] CRPIX:', wcs.CRPIX1, ',', wcs.CRPIX2, '(FITS coords)');
  console.log('[WCS] CRVAL:', wcs.CRVAL1, ',', wcs.CRVAL2, '(RA/Dec degrees)');

  const catalog = loadServerCatalog();

  // Compute approximate field of view from CD matrix
  const pixscaleX = Math.sqrt(wcs.CD1_1 * wcs.CD1_1 + wcs.CD2_1 * wcs.CD2_1); // deg/pixel
  const pixscaleY = Math.sqrt(wcs.CD1_2 * wcs.CD1_2 + wcs.CD2_2 * wcs.CD2_2);
  const fovX = pixscaleX * imageWidth; // degrees
  const fovY = pixscaleY * imageHeight;
  const searchRadius = Math.max(fovX, fovY) * 0.7; // slightly less than diagonal/2

  const centerRA = wcs.CRVAL1;
  const centerDec = wcs.CRVAL2;

  // Find stars within the field of view
  const starsInField: CatalogStar[] = [];
  for (const star of catalog) {
    const dRA = (star.ra - centerRA) * Math.cos(centerDec * DEG2RAD);
    const dDec = star.dec - centerDec;
    const dist = Math.sqrt(dRA * dRA + dDec * dDec);
    if (dist < searchRadius) {
      starsInField.push(star);
    }
  }

  // Sort by brightness
  starsInField.sort((a, b) => a.mag - b.mag);

  // Invert the CD matrix to convert from sky to pixel
  const det = wcs.CD1_1 * wcs.CD2_2 - wcs.CD1_2 * wcs.CD2_1;

  // Check parity: CD1_1 < 0 typically means RA increases left (astronomical convention)
  // CD1_1 > 0 means RA increases right (mirrored, needs flip)
  const needsFlip = wcs.CD1_1 > 0;
  console.log(
    `[WCS] CD matrix: CD1_1=${wcs.CD1_1.toExponential(3)}, CD1_2=${wcs.CD1_2.toExponential(3)}, CD2_1=${wcs.CD2_1.toExponential(3)}, CD2_2=${wcs.CD2_2.toExponential(3)}`,
  );
  console.log(`[WCS] CD matrix determinant: ${det.toExponential(3)}`);
  console.log(
    `[WCS] Image orientation: ${needsFlip ? 'MIRRORED (needs X flip)' : 'NORMAL (astronomical standard)'}`,
  );
  console.log(
    `[WCS] SIP distortion: ${(wcs as any).AP_ORDER ? `order ${(wcs as any).AP_ORDER}` : 'none'}`,
  );

  if (Math.abs(det) < 1e-20) return [];

  const invCD = {
    a: wcs.CD2_2 / det,
    b: -wcs.CD1_2 / det,
    c: -wcs.CD2_1 / det,
    d: wcs.CD1_1 / det,
  };

  // Convert star RA/Dec to pixel coords using TAN projection
  console.log(
    `[WCS] Converting ${starsInField.length} stars in field to image pixels (image: ${imageWidth}x${imageHeight})`,
  );
  const starsWithPixels: { star: CatalogStar; px: number; py: number }[] = [];

  for (const star of starsInField) {
    const raRad = star.ra * DEG2RAD;
    const decRad = star.dec * DEG2RAD;
    const ra0Rad = centerRA * DEG2RAD;
    const dec0Rad = centerDec * DEG2RAD;

    const sinDec = Math.sin(decRad);
    const cosDec = Math.cos(decRad);
    const sinDec0 = Math.sin(dec0Rad);
    const cosDec0 = Math.cos(dec0Rad);
    const cosDRA = Math.cos(raRad - ra0Rad);
    const sinDRA = Math.sin(raRad - ra0Rad);

    const denom = sinDec0 * sinDec + cosDec0 * cosDec * cosDRA;
    if (denom < 0.01) continue; // behind projection

    // Standard coordinates (gnomonic/TAN projection) in degrees
    const xi = ((cosDec * sinDRA) / denom) * (180 / Math.PI);
    const eta = ((cosDec0 * sinDec - sinDec0 * cosDec * cosDRA) / denom) * (180 / Math.PI);

    // Pixel coordinates via inverse CD matrix
    const dx = invCD.a * xi + invCD.b * eta;
    const dy = invCD.c * xi + invCD.d * eta;

    // Apply inverse SIP distortion if present (AP and BP polynomials)
    // SIP distortion is applied to (dx, dy) before adding to CRPIX
    const applyInverseSIP = (parsed: any, u: number, v: number): { du: number; dv: number } => {
      let du = 0,
        dv = 0;
      const apOrder = parsed.AP_ORDER || 0;
      const bpOrder = parsed.BP_ORDER || 0;

      if (apOrder > 0) {
        for (let i = 0; i <= apOrder; i++) {
          for (let j = 0; j <= apOrder; j++) {
            const coef = parsed[`AP_${i}_${j}`];
            if (typeof coef === 'number') {
              du += coef * Math.pow(u, i) * Math.pow(v, j);
            }
          }
        }
      }

      if (bpOrder > 0) {
        for (let i = 0; i <= bpOrder; i++) {
          for (let j = 0; j <= bpOrder; j++) {
            const coef = parsed[`BP_${i}_${j}`];
            if (typeof coef === 'number') {
              dv += coef * Math.pow(u, i) * Math.pow(v, j);
            }
          }
        }
      }

      return { du, dv };
    };

    // Apply SIP correction (note: we need the full parsed WCS header for SIP coefficients)
    // For now, skip SIP if not available in wcs object
    const sipCorr = (wcs as any).AP_ORDER ? applyInverseSIP(wcs, dx, dy) : { du: 0, dv: 0 };
    const dx_corrected = dx + sipCorr.du;
    const dy_corrected = dy + sipCorr.dv;

    // FITS pixel coordinates (1-indexed from bottom-left)
    const fitsPx = wcs.CRPIX1 + dx_corrected;
    const fitsPy = wcs.CRPIX2 + dy_corrected;

    // Convert WCS pixel coords to display coords (0-indexed, origin top-left)
    // FITS convention (PixInsight/Siril): Y=1 is the bottom row → flip Y
    // Display convention (solve-field/astrometry.net): Y=1 is the top row → just subtract 1
    const px = fitsPx - 1;
    const py = fitsYConvention ? imageHeight - fitsPy : fitsPy - 1;

    // Debug first few stars
    if (starsWithPixels.length < 3) {
      console.log(
        `[WCS] Star ${star.name || 'HIP ' + star.hip}: RA=${star.ra.toFixed(2)}° Dec=${star.dec.toFixed(2)}°`,
      );
      console.log(
        `      → WCS pixel (${fitsPx.toFixed(1)}, ${fitsPy.toFixed(1)}) → Display pixel (${px.toFixed(1)}, ${py.toFixed(1)})`,
      );
    }

    // Check bounds - must be strictly within image (no negative margin for star selection)
    if (px >= 0 && px <= imageWidth && py >= 0 && py <= imageHeight) {
      starsWithPixels.push({ star, px, py });
    }
  }

  console.log(
    `[WCS] ${starsWithPixels.length} stars within image bounds (out of ${starsInField.length} in field)`,
  );

  // If we found fewer than 3 catalog stars, generate synthetic correspondences from WCS
  if (starsWithPixels.length < 3) {
    console.log(
      `[WCS] Only ${starsWithPixels.length} catalog stars found, generating synthetic correspondences from WCS`,
    );
    return generateSyntheticCorrespondences(wcs, imageWidth, imageHeight, fitsYConvention);
  }

  // Filter to stars well within bounds (avoid edges for better accuracy)
  const margin = Math.min(50, imageWidth * 0.05, imageHeight * 0.05);
  const interiorStars = starsWithPixels.filter(
    ({ px, py }) =>
      px >= margin && px <= imageWidth - margin && py >= margin && py <= imageHeight - margin,
  );

  // Use interior stars if we have enough, otherwise fall back to all stars
  const candidates = (interiorStars.length >= 3 ? interiorStars : starsWithPixels).slice(0, 20);

  console.log(
    `[WCS] Found ${starsWithPixels.length} stars in bounds, ${interiorStars.length} interior stars, using ${candidates.length} candidates`,
  );

  // Choose 3 well-separated bright stars forming the largest triangle
  let bestArea = 0;
  let bestTriple: [number, number, number] = [0, 1, 2];

  for (let i = 0; i < candidates.length - 2; i++) {
    for (let j = i + 1; j < candidates.length - 1; j++) {
      for (let k = j + 1; k < candidates.length; k++) {
        const a = candidates[i],
          b = candidates[j],
          c = candidates[k];
        // Shoelace area
        const area = Math.abs((b.px - a.px) * (c.py - a.py) - (c.px - a.px) * (b.py - a.py)) / 2;
        if (area > bestArea) {
          bestArea = area;
          bestTriple = [i, j, k];
        }
      }
    }
  }

  const result: Correspondence[] = bestTriple.map((idx, pointIndex) => {
    const { star, px, py } = candidates[idx];
    return {
      pointIndex,
      photoX: px,
      photoY: py,
      starHip: star.hip,
      starName: starDisplayLabel(star),
      starRa: star.ra,
      starDec: star.dec,
    };
  });

  // Add extra well-spread stars for a least-squares fit in the frontend
  const usedSet = new Set(bestTriple);
  for (let i = 0; i < candidates.length && result.length < 15; i++) {
    if (usedSet.has(i)) continue;
    const { px, py, star } = candidates[i];
    // Candidates are already filtered to be interior stars, so just add them
    result.push({
      pointIndex: result.length,
      photoX: px,
      photoY: py,
      starHip: star.hip,
      starName: starDisplayLabel(star),
      starRa: star.ra,
      starDec: star.dec,
    });
  }

  console.log(`[WCS] Returning ${result.length} correspondences for transform`);
  for (let i = 0; i < Math.min(result.length, 5); i++) {
    const c = result[i];
    console.log(`  [${i}] ${c.starName} at (${c.photoX.toFixed(1)}, ${c.photoY.toFixed(1)})`);
  }

  return result;
}

export function extractWCS(buffer: Buffer, ext: string): WCSData | null {
  let headerStr: string | null = null;

  if (ext === '.fits' || ext === '.fit') {
    headerStr = extractFITSHeaderFromFITS(buffer);
  } else if (ext === '.tif' || ext === '.tiff') {
    headerStr = extractFITSHeaderFromTIFF(buffer);
  }

  if (!headerStr) return null;

  const parsed = parseFITSHeader(headerStr);

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
