/**
 * Removes the position a camera or a phone wrote into a picture file (JPEG, PNG or WebP) before the file is shared.
 * The picture itself is not decoded nor re-encoded: only the GPS entries of its EXIF data are wiped and the GPS values
 * of its XMP text blanked, in place, so every other byte of the file is the one it had.
 */
import { crc32 } from './zip-writer';

const ascii = (b: Uint8Array, at: number, text: string): boolean => {
  if (at < 0 || at + text.length > b.length) return false;
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

/** Bytes per value of each EXIF type (1 = byte … 12 = double); 0 for an unknown type. */
const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
/** The entry of the first directory that points at the GPS directory. */
const GPS_POINTER_TAG = 0x8825;
const XMP_JPEG_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const XMP_PNG_KEYWORD = 'XML:com.adobe.xmp\0';

/**
 * Wipes the GPS directory of a TIFF structure (the content of an EXIF block) between `start` and `end`, and takes
 * its pointer out of the first directory. Returns whether there was one.
 */
function clearGpsOfTiff(b: Uint8Array, start: number, end: number): boolean {
  if (end - start < 8) return false;
  const little = b[start] === 0x49 && b[start + 1] === 0x49;
  if (!little && !(b[start] === 0x4d && b[start + 1] === 0x4d)) return false;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (at: number): number => view.getUint16(at, little);
  const u32 = (at: number): number => view.getUint32(at, little);
  if (u16(start + 2) !== 42) return false;
  const ifd = start + u32(start + 4);
  if (ifd < start || ifd + 2 > end) return false;
  const count = u16(ifd);
  // The entries, then the 4 bytes that point at the next directory.
  const ifdEnd = ifd + 2 + count * 12 + 4;
  if (ifdEnd > end) return false;

  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) !== GPS_POINTER_TAG) continue;

    const gps = start + u32(entry + 8);
    if (gps >= start && gps + 2 <= end) {
      const gpsCount = Math.min(u16(gps), Math.floor((end - gps - 2) / 12));
      for (let j = 0; j < gpsCount; j++) {
        const gpsEntry = gps + 2 + j * 12;
        const size = (TYPE_SIZES[u16(gpsEntry + 2)] ?? 0) * u32(gpsEntry + 4);
        // A value over 4 bytes is kept elsewhere in the block, at the offset the entry gives.
        if (size > 4) {
          const at = start + u32(gpsEntry + 8);
          if (at >= start && at + size <= end) b.fill(0, at, at + size);
        }
        b.fill(0, gpsEntry, gpsEntry + 12);
      }
      view.setUint16(gps, 0, little);
    }

    // The entries after the pointer move up by one, with the pointer to the next directory.
    b.copyWithin(entry, entry + 12, ifdEnd);
    b.fill(0, ifdEnd - 12, ifdEnd);
    view.setUint16(ifd, count - 1, little);
    return true;
  }
  return false;
}

const isNameChar = (c: number): boolean =>
  (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39);

/**
 * Replaces by spaces the value of every `exif:GPS…` attribute or element of an XMP text between `start` and `end`
 * (the text keeps its length). Returns whether any value was blanked.
 */
function blankGpsOfXmp(b: Uint8Array, start: number, end: number): boolean {
  let changed = false;
  for (let i = start; i + 8 <= end; i++) {
    if (!ascii(b, i, 'exif:GPS')) continue;
    let at = i + 8;
    while (at < end && isNameChar(b[at])) at++;
    let until: number;
    if (b[at] === 0x3d && (b[at + 1] === 0x22 || b[at + 1] === 0x27)) {
      // name="value"
      until = b[at + 1];
      at += 2;
    } else if (b[at] === 0x3e && b[i - 1] === 0x3c) {
      // <name>value</name>
      until = 0x3c;
      at += 1;
    } else {
      continue;
    }
    for (; at < end && b[at] !== until; at++) {
      if (b[at] !== 0x20) {
        b[at] = 0x20;
        changed = true;
      }
    }
    i = at;
  }
  return changed;
}

function stripJpeg(b: Uint8Array): boolean {
  let changed = false;
  let pos = 2;
  while (pos + 4 <= b.length) {
    if (b[pos] !== 0xff) break;
    const marker = b[pos + 1];
    if (marker === 0xff) {
      pos++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    // The picture data starts: no metadata after it.
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (b[pos + 2] << 8) | b[pos + 3];
    if (length < 2) break;
    const data = pos + 4;
    const end = Math.min(pos + 2 + length, b.length);
    if (marker === 0xe1) {
      if (ascii(b, data, 'Exif\0\0')) changed = clearGpsOfTiff(b, data + 6, end) || changed;
      else if (ascii(b, data, XMP_JPEG_HEADER)) {
        changed = blankGpsOfXmp(b, data + XMP_JPEG_HEADER.length, end) || changed;
      }
    }
    pos += 2 + length;
  }
  return changed;
}

function stripPng(b: Uint8Array): boolean {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let changed = false;
  let pos = 8;
  while (pos + 12 <= b.length) {
    const length = view.getUint32(pos);
    const data = pos + 8;
    const end = data + length;
    if (end + 4 > b.length) break;
    let touched = false;
    if (ascii(b, pos + 4, 'eXIf')) {
      touched = clearGpsOfTiff(b, data, end);
    } else if (ascii(b, pos + 4, 'iTXt') && ascii(b, data, XMP_PNG_KEYWORD)) {
      // After the keyword: a compression flag (0 = plain text), a method, then the language and the translated keyword.
      const flag = data + XMP_PNG_KEYWORD.length;
      if (b[flag] === 0) touched = blankGpsOfXmp(b, flag + 2, end);
    }
    if (touched) {
      // A chunk ends with the CRC of its type and data.
      view.setUint32(end, crc32(b.subarray(pos + 4, end)));
      changed = true;
    }
    if (ascii(b, pos + 4, 'IEND')) break;
    pos = end + 4;
  }
  return changed;
}

function stripWebp(b: Uint8Array): boolean {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let changed = false;
  let pos = 12;
  while (pos + 8 <= b.length) {
    const length = view.getUint32(pos + 4, true);
    const data = pos + 8;
    const end = Math.min(data + length, b.length);
    if (ascii(b, pos, 'EXIF')) {
      const tiff = ascii(b, data, 'Exif\0\0') ? data + 6 : data;
      changed = clearGpsOfTiff(b, tiff, end) || changed;
    } else if (ascii(b, pos, 'XMP ')) {
      changed = blankGpsOfXmp(b, data, end) || changed;
    }
    pos = data + length + (length & 1);
  }
  return changed;
}

/**
 * The bytes of a picture file without the position its metadata held. A file that holds none, or that is not a JPEG,
 * PNG or WebP, comes back as it is (the same array); otherwise a copy of the same length is returned.
 */
export function stripGps(bytes: Uint8Array): Uint8Array {
  const strip =
    bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8
      ? stripJpeg
      : bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG\r\n\x1a\n')
        ? stripPng
        : bytes.length >= 16 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')
          ? stripWebp
          : null;
  if (!strip) return bytes;
  const copy = bytes.slice();
  return strip(copy) ? copy : bytes;
}
