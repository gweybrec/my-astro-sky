/**
 * Reads the stored size and the EXIF orientation of a JPEG, PNG or WebP from the file's header, without
 * decoding the picture. The size is the one stored in the file, before any rotation.
 */
export interface ImageHeader {
  format: 'jpeg' | 'png' | 'webp';
  width: number;
  height: number;
  /** EXIF orientation 1..8, when the file has one. */
  orientation?: number;
}

const unreadable = (): Error => new Error('Unreadable image');

const ascii = (b: Uint8Array, at: number, text: string): boolean => {
  if (at + text.length > b.length) return false;
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

/** The orientation (1..8) in a TIFF structure (the content of an EXIF segment, after `Exif\0\0`), or undefined. */
function orientationOfTiff(b: Uint8Array, start: number, end: number): number | undefined {
  if (end - start < 8) return undefined;
  const little = b[start] === 0x49 && b[start + 1] === 0x49;
  if (!little && !(b[start] === 0x4d && b[start + 1] === 0x4d)) return undefined;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (at: number): number => view.getUint16(at, little);
  const u32 = (at: number): number => view.getUint32(at, little);
  if (u16(start + 2) !== 42) return undefined;
  const ifd = start + u32(start + 4);
  if (ifd + 2 > end) return undefined;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return undefined;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : undefined;
    }
  }
  return undefined;
}

function readJpeg(b: Uint8Array): ImageHeader {
  let orientation: number | undefined;
  let pos = 2;
  while (pos + 4 <= b.length) {
    if (b[pos] !== 0xff) throw unreadable();
    const marker = b[pos + 1];
    if (marker === 0xff) {
      pos++; // fill byte
      continue;
    }
    // Markers without a length: standalone ones.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) throw unreadable();
    const length = (b[pos + 2] << 8) | b[pos + 3];
    if (length < 2) throw unreadable();
    const dataStart = pos + 4;
    const end = Math.min(pos + 2 + length, b.length);
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      if (dataStart + 5 > b.length) throw unreadable();
      const height = (b[dataStart + 1] << 8) | b[dataStart + 2];
      const width = (b[dataStart + 3] << 8) | b[dataStart + 4];
      if (!width || !height) throw unreadable();
      return { format: 'jpeg', width, height, ...(orientation ? { orientation } : {}) };
    }
    if (marker === 0xe1 && orientation === undefined && ascii(b, dataStart, 'Exif\0\0')) {
      orientation = orientationOfTiff(b, dataStart + 6, end);
    }
    pos += 2 + length;
  }
  throw unreadable();
}

function readPng(b: Uint8Array): ImageHeader {
  if (b.length < 24 || !ascii(b, 12, 'IHDR')) throw unreadable();
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height) throw unreadable();
  return { format: 'png', width, height };
}

function readWebp(b: Uint8Array): ImageHeader {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let size: { width: number; height: number } | undefined;
  let orientation: number | undefined;
  let extended = false;
  let pos = 12;
  while (pos + 8 <= b.length) {
    const tag = String.fromCharCode(b[pos], b[pos + 1], b[pos + 2], b[pos + 3]);
    const length = view.getUint32(pos + 4, true);
    const data = pos + 8;
    const end = Math.min(data + length, b.length);
    if (tag === 'VP8X' && data + 10 <= b.length) {
      extended = true;
      size = {
        width: 1 + (b[data + 4] | (b[data + 5] << 8) | (b[data + 6] << 16)),
        height: 1 + (b[data + 7] | (b[data + 8] << 8) | (b[data + 9] << 16)),
      };
    } else if (tag === 'VP8 ' && !size && data + 10 <= b.length) {
      if (b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a) throw unreadable();
      size = {
        width: view.getUint16(data + 6, true) & 0x3fff,
        height: view.getUint16(data + 8, true) & 0x3fff,
      };
    } else if (tag === 'VP8L' && !size && data + 5 <= b.length) {
      if (b[data] !== 0x2f) throw unreadable();
      const bits = view.getUint32(data + 1, true);
      size = { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    } else if (tag === 'EXIF' && orientation === undefined) {
      const tiff = ascii(b, data, 'Exif\0\0') ? data + 6 : data;
      orientation = orientationOfTiff(b, tiff, end);
    }
    // A simple (non-VP8X) file has nothing after its one image chunk worth reading.
    if (size && !extended) break;
    pos = data + length + (length & 1);
  }
  if (!size || !size.width || !size.height) throw unreadable();
  return { format: 'webp', ...size, ...(orientation ? { orientation } : {}) };
}

/** Reads the header of a JPEG, PNG or WebP file. Throws when the bytes are none of these or the header is cut. */
export function readImageHeader(bytes: Uint8Array): ImageHeader {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes);
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG\r\n\x1a\n')) {
    return readPng(bytes);
  }
  if (bytes.length >= 16 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) {
    return readWebp(bytes);
  }
  throw unreadable();
}
