/**
 * Minimal hand-rolled XISF monolithic-file builder for header-decoder tests. Not a general
 * encoder — only the signature, header length and XML header (no pixel blocks). Not a
 * `.test.ts` file, so vitest does not collect it as a suite.
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
  } = opts;

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
      }>${kw}</Image>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">${image}${trailingXml}</xisf>`;
  const xmlBytes = new TextEncoder().encode(xml);

  const out = new Uint8Array(16 + xmlBytes.length);
  for (let i = 0; i < 8; i++) out[i] = signature.charCodeAt(i);
  new DataView(out.buffer).setUint32(8, headerLength ?? xmlBytes.length, true);
  out.set(xmlBytes, 16);
  return out;
}
