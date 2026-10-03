/**
 * Minimal TIFF (classic, 32-bit offsets) IFD parser — reads only the tags the raw-astro
 * decoder needs. Not a general-purpose TIFF library: no BigTIFF, no writing.
 */

export interface TiffField {
  tag: number;
  type: number; // TIFF field type (1=BYTE, 3=SHORT, 4=LONG, 2=ASCII, ...)
  count: number;
  /** Resolved values, one per `count` — numbers for numeric types, a decoded string for ASCII. */
  values: number[];
  ascii?: string;
}

export interface TiffIfd {
  fields: Map<number, TiffField>;
  nextIfdOffset: number;
}

export interface TiffHeaderInfo {
  littleEndian: boolean;
  ifds: TiffIfd[];
}

const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

/** Get the (first, or only) numeric value of a field, or `undefined` if absent. */
export function fieldValue(ifd: TiffIfd, tag: number): number | undefined {
  return ifd.fields.get(tag)?.values[0];
}

export function fieldValues(ifd: TiffIfd, tag: number): number[] | undefined {
  return ifd.fields.get(tag)?.values;
}

export function fieldAscii(ifd: TiffIfd, tag: number): string | undefined {
  return ifd.fields.get(tag)?.ascii;
}

export function parseTiffHeader(buf: Uint8Array): TiffHeaderInfo {
  if (buf.length < 8) throw new Error('Buffer too small to be a TIFF file');
  const bo = new TextDecoder('latin1').decode(buf.subarray(0, 2));
  const littleEndian = bo === 'II';
  if (!littleEndian && bo !== 'MM') throw new Error('Not a TIFF file (bad byte-order marker)');

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o: number) => view.getUint16(o, littleEndian);
  const u32 = (o: number) => view.getUint32(o, littleEndian);

  if (u16(2) !== 42) throw new Error('Not a TIFF file (bad magic number)');

  const ifds: TiffIfd[] = [];
  let ifdOffset = u32(4);
  let guard = 0;
  while (ifdOffset > 0 && ifdOffset + 2 <= buf.length && guard++ < 64) {
    const numEntries = u16(ifdOffset);
    const fields = new Map<number, TiffField>();

    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      if (entryOffset + 12 > buf.length) break;

      const tag = u16(entryOffset);
      const type = u16(entryOffset + 2);
      const count = u32(entryOffset + 4);
      const typeSize = TYPE_SIZES[type];
      if (!typeSize) continue; // unknown field type, skip

      const totalSize = typeSize * count;
      const dataOffset = totalSize <= 4 ? entryOffset + 8 : u32(entryOffset + 8);
      if (dataOffset + totalSize > buf.length) continue;

      const field: TiffField = { tag, type, count, values: [] };

      if (type === 2) {
        // ASCII, NUL-terminated
        field.ascii = new TextDecoder('latin1')
          .decode(buf.subarray(dataOffset, dataOffset + count))
          .replace(/\0.*$/s, '');
      } else {
        for (let k = 0; k < count; k++) {
          const off = dataOffset + k * typeSize;
          let v: number;
          switch (type) {
            case 1: // BYTE
            case 6: // SBYTE
            case 7: // UNDEFINED
              v = view.getUint8(off);
              break;
            case 3: // SHORT
              v = u16(off);
              break;
            case 8: // SSHORT
              v = view.getInt16(off, littleEndian);
              break;
            case 4: // LONG
              v = u32(off);
              break;
            case 9: // SLONG
              v = view.getInt32(off, littleEndian);
              break;
            case 11: // FLOAT
              v = view.getFloat32(off, littleEndian);
              break;
            case 12: // DOUBLE
              v = view.getFloat64(off, littleEndian);
              break;
            case 5: {
              // RATIONAL (unsigned numerator/denominator)
              const num = u32(off);
              const den = u32(off + 4);
              v = den === 0 ? 0 : num / den;
              break;
            }
            case 10: {
              // SRATIONAL
              const num = view.getInt32(off, littleEndian);
              const den = view.getInt32(off + 4, littleEndian);
              v = den === 0 ? 0 : num / den;
              break;
            }
            default:
              v = 0;
          }
          field.values.push(v);
        }
      }

      fields.set(tag, field);
    }

    const nextIfdOffset = u32(ifdOffset + 2 + numEntries * 12);
    ifds.push({ fields, nextIfdOffset });
    ifdOffset = nextIfdOffset;
  }

  return { littleEndian, ifds };
}
