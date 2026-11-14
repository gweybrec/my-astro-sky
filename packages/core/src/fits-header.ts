/**
 * What a FITS header (from a FITS file, the ImageDescription of a TIFF, or the FITS keywords of an XISF) tells about
 * a photo apart from its plate solution: the capture data, a few facts used to check that the file belongs to the
 * photo, and the raw cards themselves, kept as they are so the user can read them.
 */
import { extractCaptureDetails, pickObsDate } from './wcs';
import type { SolvedCaptureMetadata } from './domain/solved-import';
import type { Photo } from './types';

/** One header card, as written: the keyword, its value (strings unquoted) and its comment. */
export interface FitsCard {
  key: string;
  value: string;
  comment?: string;
}

/** Header values used to check that a file belongs to a photo; only those present. */
export interface FitsHeaderFacts {
  /** OBJECT, trimmed (may be "Unknown"). */
  object?: string;
  /** Image centre from RA/DEC (degrees) or OBJCTRA/OBJCTDEC (sexagesimal), in degrees. */
  centerRa?: number;
  centerDec?: number;
  /** FOCALLEN, in mm. */
  focalLengthMm?: number;
  /** XPIXSZ, in µm (some writers include the binning, some do not). */
  pixelSizeUm?: number;
  /** XBINNING. */
  binning?: number;
  telescope?: string;
  instrument?: string;
  /** NAXIS1 / NAXIS2: the size of the image the header describes. */
  width?: number;
  height?: number;
  /** The plate solution's scale in arcsec per pixel, when the file is solved. */
  pixelScaleArcsec?: number;
}

/** The most cards kept for one photo (a SIP solution alone writes ~80). */
export const MAX_FITS_CARDS = 2000;
const MAX_CARD_TEXT = 200;

/** Split a card's value field into the value and the comment (after a `/` outside quotes). */
function splitValue(field: string): { value: string; comment?: string } {
  const text = field.trimStart();
  if (text.startsWith("'")) {
    // A FITS string: '' inside it is an escaped quote.
    let i = 1;
    let out = '';
    while (i < text.length) {
      if (text[i] === "'") {
        if (text[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        i++;
        break;
      }
      out += text[i++];
    }
    const rest = text.slice(i);
    const slash = rest.indexOf('/');
    const comment = slash >= 0 ? rest.slice(slash + 1).trim() : '';
    return { value: out.trim(), ...(comment ? { comment } : {}) };
  }
  const slash = text.indexOf('/');
  const value = (slash >= 0 ? text.slice(0, slash) : text).trim();
  const comment = slash >= 0 ? text.slice(slash + 1).trim() : '';
  return { value, ...(comment ? { comment } : {}) };
}

/**
 * Every card of a header, in order, up to END: keyword cards with their value and comment, and the commentary cards
 * (COMMENT, HISTORY, blank keyword) with their text as value. Reads 80-character records and newline-delimited text
 * (ASTAP), like `parseFITSHeader`.
 */
export function parseFitsCards(headerStr: string): FitsCard[] {
  const records: string[] = [];
  if (headerStr.includes('\n')) {
    for (const line of headerStr.split(/\r?\n/)) if (line.trim()) records.push(line);
  } else {
    for (let i = 0; i < headerStr.length; i += 80) records.push(headerStr.substring(i, i + 80));
  }
  const cards: FitsCard[] = [];
  for (const record of records) {
    const key = record.substring(0, 8).trim();
    if (key === 'END') break;
    if (!key && !record.substring(8).trim()) continue; // blank padding
    let card: FitsCard;
    if (record[8] === '=' && key) {
      card = { key, ...splitValue(record.substring(10)) };
    } else {
      card = { key, value: record.substring(8).trim() };
    }
    card.value = card.value.slice(0, MAX_CARD_TEXT);
    if (card.comment) card.comment = card.comment.slice(0, MAX_CARD_TEXT);
    cards.push(card);
    if (cards.length >= MAX_FITS_CARDS) break;
  }
  return cards;
}

/**
 * Keep only well-formed cards (string key ≤ 70 chars, string value, optional string comment), at most
 * `MAX_FITS_CARDS`. Anything else gives an empty list. Used where cards come from outside (API, import).
 */
export function sanitizeFitsCards(raw: unknown): FitsCard[] {
  if (!Array.isArray(raw)) return [];
  const out: FitsCard[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const { key, value, comment } = c as Record<string, unknown>;
    if (typeof key !== 'string' || typeof value !== 'string' || key.length > 70) continue;
    const card: FitsCard = { key, value: value.slice(0, MAX_CARD_TEXT) };
    if (typeof comment === 'string' && comment) card.comment = comment.slice(0, MAX_CARD_TEXT);
    out.push(card);
    if (out.length >= MAX_FITS_CARDS) break;
  }
  return out;
}

const positive = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

/** The frame count: STACKCNT, else NCOMBINE, else LIVETIME ÷ the sub exposure when it is a whole number (±1 %). */
function frameCount(
  parsed: Record<string, number | string | boolean>,
  expTime: number | undefined,
): number | undefined {
  const stack = positive(parsed.STACKCNT) ?? positive(parsed.NCOMBINE);
  if (stack !== undefined) return Math.round(stack);
  const live = positive(parsed.LIVETIME);
  if (live === undefined || expTime === undefined || expTime <= 0) return undefined;
  const ratio = live / expTime;
  const rounded = Math.round(ratio);
  return rounded >= 1 && Math.abs(ratio - rounded) / rounded <= 0.01 ? rounded : undefined;
}

/**
 * The capture data of a parsed header, whether or not it holds a plate solution: the observation date, the sub
 * exposure (EXPTIME, else EXPOSURE), the frame count (see `frameCount`), the filter and the capture fields.
 */
export function captureFromHeader(
  parsed: Record<string, number | string | boolean>,
): SolvedCaptureMetadata {
  const out: SolvedCaptureMetadata = {};
  const obsDate = pickObsDate(parsed['DATE-OBS'], parsed['DATE']);
  if (obsDate) out.dateObs = obsDate;
  const exp = [parsed.EXPTIME, parsed.EXPOSURE].find(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  );
  if (exp !== undefined) out.expTime = exp;
  const frames = frameCount(parsed, exp);
  if (frames !== undefined) out.stackCnt = frames;
  if (typeof parsed.FILTER === 'string' && parsed.FILTER.trim().length > 0) {
    out.filter = parsed.FILTER.trim();
  }
  const captureDetails = extractCaptureDetails(parsed);
  if (Object.keys(captureDetails).length > 0) out.captureDetails = captureDetails;
  return out;
}

/** A sexagesimal "h m s" / "d m s" (spaces or colons) as a number; undefined when it is not one. */
export function parseSexagesimal(raw: string): number | undefined {
  const m =
    /^\s*([+-])?\s*(\d+(?:\.\d+)?)(?:[\s:]+(\d+(?:\.\d+)?))?(?:[\s:]+(\d+(?:\.\d+)?))?\s*$/.exec(
      raw,
    );
  if (!m) return undefined;
  const value = Number(m[2]) + Number(m[3] ?? 0) / 60 + Number(m[4] ?? 0) / 3600;
  return m[1] === '-' ? -value : value;
}

function centre(
  parsed: Record<string, number | string | boolean>,
): { ra: number; dec: number } | null {
  const ra = parsed.RA;
  const dec = parsed.DEC;
  if (
    typeof ra === 'number' &&
    typeof dec === 'number' &&
    ra >= 0 &&
    ra < 360 &&
    Math.abs(dec) <= 90
  ) {
    return { ra, dec };
  }
  for (const [raKey, decKey] of [
    ['OBJCTRA', 'OBJCTDEC'],
    ['RA', 'DEC'],
  ] as const) {
    const r = parsed[raKey];
    const d = parsed[decKey];
    if (typeof r !== 'string' || typeof d !== 'string') continue;
    const hours = parseSexagesimal(r);
    const deg = parseSexagesimal(d);
    if (hours === undefined || deg === undefined) continue;
    if (hours < 0 || hours >= 24 || Math.abs(deg) > 90) continue;
    return { ra: hours * 15, dec: deg };
  }
  return null;
}

const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** The header values used to check that a file belongs to a photo (see `FitsHeaderFacts`). */
export function headerFacts(parsed: Record<string, number | string | boolean>): FitsHeaderFacts {
  const facts: FitsHeaderFacts = {};
  const object = text(parsed.OBJECT);
  if (object) facts.object = object;
  const c = centre(parsed);
  if (c) {
    facts.centerRa = c.ra;
    facts.centerDec = c.dec;
  }
  const focal = positive(parsed.FOCALLEN) ?? positive(parsed.FOCAL);
  if (focal) facts.focalLengthMm = focal;
  const pixel = positive(parsed.XPIXSZ);
  if (pixel) facts.pixelSizeUm = pixel;
  const bin = positive(parsed.XBINNING);
  if (bin) facts.binning = Math.round(bin);
  const telescope = text(parsed.TELESCOP);
  if (telescope) facts.telescope = telescope;
  const instrument = text(parsed.INSTRUME);
  if (instrument) facts.instrument = instrument;
  const w = positive(parsed.NAXIS1);
  const h = positive(parsed.NAXIS2);
  if (w && h) {
    facts.width = Math.round(w);
    facts.height = Math.round(h);
  }
  return facts;
}

/**
 * True when a FITS file is shorter than its header announces: the header blocks plus NAXIS1·…·NAXISn·|BITPIX|/8 bytes
 * of data (an incomplete download or copy). A header-only file (NAXIS = 0, as astrometry.net's wcs.fits) passes.
 */
export function fitsDataTruncated(
  fileLength: number,
  headerLength: number,
  parsed: Record<string, number | string | boolean>,
): boolean {
  const naxis = parsed.NAXIS;
  const bitpix = parsed.BITPIX;
  if (typeof naxis !== 'number' || typeof bitpix !== 'number' || naxis <= 0) return false;
  let samples = 1;
  for (let i = 1; i <= naxis; i++) {
    const n = parsed[`NAXIS${i}`];
    if (typeof n !== 'number' || !(n >= 0)) return false;
    samples *= n;
  }
  return fileLength < headerLength + (samples * Math.abs(bitpix)) / 8;
}

/**
 * Why a photo has no header cards to show, as an i18n key, or null when it has some: placed by hand (a JPEG/PNG placed
 * manually never read a file), or otherwise no WCS/raw file was read for it.
 */
export function fitsHeadersMissingKey(
  photo: Pick<Photo, 'hasFitsHeaders' | 'manualPlacement'>,
): 'modal.fitsHeadersNoneManual' | 'modal.fitsHeadersNone' | null {
  if (photo.hasFitsHeaders) return null;
  return photo.manualPlacement ? 'modal.fitsHeadersNoneManual' : 'modal.fitsHeadersNone';
}

/** The cards whose keyword, value or comment contains `query` (case ignored); all of them for an empty query. */
export function filterFitsCards(cards: readonly FitsCard[], query: string): FitsCard[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...cards];
  return cards.filter((c) =>
    [c.key, c.value, c.comment ?? ''].some((s) => s.toLowerCase().includes(q)),
  );
}
