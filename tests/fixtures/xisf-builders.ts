/**
 * Minimal hand-rolled XISF monolithic-file builder for decoder tests. Not a general
 * encoder — the signature, header length and XML header, and optionally one pixel block
 * placed right after the header. Not a `.test.ts` file, so vitest does not collect it as a suite.
 */

export interface XisfKeyword {
  name: string;
  /** Raw XISF `value` attribute (string values carry their own quotes, e.g. `'M31'`). */
  value: string;
  comment?: string;
}

export interface BuildXisfOptions {
  geometry?: string;
  sampleFormat?: string;
  colorSpace?: string;
  location?: string;
  compression?: string;
  keywords?: XisfKeyword[];
  /** Omit the `Image` element entirely. */
  noImage?: boolean;
  /** Replace the 8-byte signature. */
  signature?: string;
  /** Override the declared header length. */
  headerLength?: number;
  /** Extra raw XML placed after the first Image element (e.g. a second Image). */
  trailingXml?: string;
  /** Extra raw attributes of the Image element (e.g. `bounds="0:1"`). */
  imageAttrs?: string;
  /** The pixel block, appended after the header; `location` is then computed. */
  pixels?: Uint8Array;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildXisf(opts: BuildXisfOptions = {}): Uint8Array {
  const {
    geometry = '4:3:1',
    sampleFormat = 'UInt16',
    colorSpace = 'Gray',
    location = 'attachment:4096:24',
    compression,
    keywords = [],
    noImage = false,
    signature = 'XISF0100',
    headerLength,
    trailingXml = '',
    imageAttrs = '',
    pixels,
  } = opts;

  if (pixels) {
    // The block's position depends on the header's length, which depends on the position's digits:
    // build with a fixed-width placeholder first.
    const probe = buildXisf({
      ...opts,
      pixels: undefined,
      location: `attachment:${'0'.repeat(10)}:${pixels.length}`,
    });
    const position = String(probe.length).padStart(10, '0');
    const header = buildXisf({
      ...opts,
      pixels: undefined,
      location: `attachment:${position}:${pixels.length}`,
    });
    const file = new Uint8Array(header.length + pixels.length);
    file.set(header);
    file.set(pixels, header.length);
    return file;
  }

  const kw = keywords
    .map(
      (k) =>
        `<FITSKeyword name="${esc(k.name)}" value="${esc(k.value)}" comment="${esc(k.comment ?? '')}"/>`,
    )
    .join('');
  const image = noImage
    ? ''
    : `<Image geometry="${geometry}" sampleFormat="${sampleFormat}" colorSpace="${colorSpace}" location="${location}"${
        compression ? ` compression="${compression}"` : ''
      }${imageAttrs ? ` ${imageAttrs}` : ''}>${kw}</Image>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">${image}${trailingXml}</xisf>`;
  const xmlBytes = new TextEncoder().encode(xml);

  const out = new Uint8Array(16 + xmlBytes.length);
  for (let i = 0; i < 8; i++) out[i] = signature.charCodeAt(i);
  new DataView(out.buffer).setUint32(8, headerLength ?? xmlBytes.length, true);
  out.set(xmlBytes, 16);
  return out;
}
