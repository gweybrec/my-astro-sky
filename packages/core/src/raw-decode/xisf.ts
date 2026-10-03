import { parseFITSHeader } from '../wcs';

/**
 * XISF (PixInsight) monolithic-file header decoding: the `XISF0100` signature, the 4-byte
 * little-endian header length, the XML header, the first `Image` element's geometry /
 * sample format / data location, and its `FITSKeyword` elements in the same shape
 * `parseFITSHeader` returns (so WCS/capture-detail code can consume them unchanged).
 *
 * Known limit: XISF files whose astrometric solution is stored only as XISF Properties
 * (`PCL:AstrometricSolution:*`), not as FITS keywords, are not handled — their `fitsKeywords`
 * carry no CRVAL/CD cards. That needs a real sample to implement. Pixel decoding (attachment
 * blocks, compression, byte shuffling) is also out of scope here; this module only locates the
 * data.
 */

export class UnsupportedXisfError extends Error {}

export interface XisfImageLocation {
  /** `attachment` (byte range in the file), `inline`/`embedded` (in the XML), or `other`. */
  kind: 'attachment' | 'inline' | 'embedded' | 'other';
  /** attachment only: byte offset from the start of the file. */
  position?: number;
  /** attachment only: block size in bytes. */
  size?: number;
}

export interface XisfImageInfo {
  width: number;
  height: number;
  channels: number;
  /** e.g. `UInt16`, `Float32`. */
  sampleFormat: string;
  colorSpace?: string;
  pixelStorage?: string;
  /** Raw `compression` attribute (e.g. `zlib:1234`), absent for uncompressed data. */
  compression?: string;
  location: XisfImageLocation;
}

export interface XisfHeader {
  /** `FITSKeyword` elements, in the `parseFITSHeader` shape. */
  fitsKeywords: Record<string, number | string | boolean>;
  /** The first `Image` element, or null when the header has none. */
  image: XisfImageInfo | null;
}

const SIGNATURE = 'XISF0100';
const FIXED_HEADER_BYTES = 16; // signature(8) + length(4) + reserved(4)

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : m;
    }
    return ENTITIES[body] ?? m;
  });
}

/** Parse the attributes of one start tag's text (everything between the tag name and `>`). */
function parseAttributes(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagBody)) !== null) {
    attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

function parseLocation(raw: string | undefined): XisfImageLocation {
  if (!raw) return { kind: 'other' };
  const parts = raw.split(':');
  if (parts[0] === 'attachment') {
    const position = Number(parts[1]);
    const size = Number(parts[2]);
    if (!Number.isInteger(position) || !Number.isInteger(size) || position < 0 || size < 0) {
      throw new UnsupportedXisfError(`Malformed XISF attachment location: ${raw}`);
    }
    return { kind: 'attachment', position, size };
  }
  if (parts[0] === 'inline') return { kind: 'inline' };
  if (parts[0] === 'embedded') return { kind: 'embedded' };
  return { kind: 'other' };
}

function parseGeometry(raw: string | undefined): {
  width: number;
  height: number;
  channels: number;
} {
  const dims = (raw ?? '').split(':').map(Number);
  if (dims.length < 3 || dims.some((d) => !Number.isInteger(d) || d <= 0)) {
    throw new UnsupportedXisfError(`Unsupported XISF image geometry: ${raw ?? '(missing)'}`);
  }
  // `w:h:c`; 3-D+ geometries (w:h:d:c) are not images this app can place.
  if (dims.length > 3) throw new UnsupportedXisfError(`Unsupported XISF image geometry: ${raw}`);
  return { width: dims[0], height: dims[1], channels: dims[2] };
}

/** FITSKeyword name/value attributes as one fixed-width-style record `parseFITSHeader` reads. */
function keywordRecords(xml: string): string {
  const lines: string[] = [];
  const re = /<FITSKeyword\b((?:"[^"]*"|'[^']*'|[^>"'])*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = parseAttributes(m[1]);
    const name = (attrs.name ?? '').trim();
    // Cards longer than 8 chars (HIERARCH) and COMMENT/HISTORY have no FITS value form here.
    if (!name || name.length > 8 || name === 'COMMENT' || name === 'HISTORY') continue;
    const value = (attrs.value ?? '').replace(/[\r\n]+/g, ' ');
    lines.push(name.padEnd(8) + '= ' + value);
  }
  return lines.join('\n') + '\nEND';
}

/**
 * Decode an XISF monolithic file's XML header. Throws `UnsupportedXisfError` on a bad
 * signature, a truncated file or an unusable `Image` element.
 */
export function parseXisfHeader(buf: Uint8Array): XisfHeader {
  if (buf.length < FIXED_HEADER_BYTES) throw new UnsupportedXisfError('XISF file too short');
  let sig = '';
  for (let i = 0; i < SIGNATURE.length; i++) sig += String.fromCharCode(buf[i]);
  if (sig !== SIGNATURE) throw new UnsupportedXisfError('Not an XISF file (bad signature)');

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerLength = view.getUint32(8, true);
  const end = FIXED_HEADER_BYTES + headerLength;
  if (headerLength === 0 || end > buf.length) {
    throw new UnsupportedXisfError('XISF header length exceeds file size');
  }

  const xml = new TextDecoder('utf-8')
    .decode(buf.subarray(FIXED_HEADER_BYTES, end))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\0+$/, '');

  // First <Image ...> element; its FITSKeyword children live up to the matching close tag.
  const imageStart = /<Image\b((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/.exec(xml);
  let image: XisfImageInfo | null = null;
  let scope = xml;
  if (imageStart) {
    const attrs = parseAttributes(imageStart[1]);
    const geometry = parseGeometry(attrs.geometry);
    if (!attrs.sampleFormat) throw new UnsupportedXisfError('XISF image missing sampleFormat');
    image = {
      ...geometry,
      sampleFormat: attrs.sampleFormat,
      colorSpace: attrs.colorSpace,
      pixelStorage: attrs.pixelStorage,
      compression: attrs.compression,
      location: parseLocation(attrs.location),
    };
    if (imageStart[2] === '/') {
      scope = '';
    } else {
      const bodyStart = imageStart.index + imageStart[0].length;
      const close = xml.indexOf('</Image>', bodyStart);
      scope = xml.slice(bodyStart, close >= 0 ? close : undefined);
    }
  }

  return { fitsKeywords: parseFITSHeader(keywordRecords(scope)), image };
}
