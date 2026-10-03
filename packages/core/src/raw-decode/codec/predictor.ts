/**
 * TIFF Predictor 2 (horizontal differencing) — undoes it in place, per row.
 * Each sample (after the first `samplesPerPixel` in the row) was encoded as the
 * difference from the sample `samplesPerPixel` positions earlier; decoding is a
 * running sum, wrapping at the sample's bit width, matching the encoder's arithmetic.
 *
 * Only integer sample formats use Predictor 2 in this project's scope — Predictor 3
 * (floating-point byte-reordering predictor) is rejected upstream (see tiff-decoder.ts).
 *
 * `row` holds one decompressed image row, exactly `width * samplesPerPixel * bytesPerSample`
 * bytes, in the file's native byte order.
 */
export function applyHorizontalPredictor(
  row: Uint8Array,
  width: number,
  samplesPerPixel: number,
  bitsPerSample: number,
  littleEndian: boolean,
): void {
  if (bitsPerSample === 8) {
    for (let i = samplesPerPixel; i < width * samplesPerPixel; i++) {
      row[i] = (row[i] + row[i - samplesPerPixel]) & 0xff;
    }
    return;
  }

  const view = new DataView(row.buffer, row.byteOffset, row.byteLength);
  if (bitsPerSample === 16) {
    const get = (i: number) => view.getUint16(i * 2, littleEndian);
    const set = (i: number, v: number) => view.setUint16(i * 2, v & 0xffff, littleEndian);
    for (let i = samplesPerPixel; i < width * samplesPerPixel; i++) {
      set(i, get(i) + get(i - samplesPerPixel));
    }
    return;
  }

  if (bitsPerSample === 32) {
    const get = (i: number) => view.getUint32(i * 4, littleEndian);
    const set = (i: number, v: number) => view.setUint32(i * 4, v >>> 0, littleEndian);
    for (let i = samplesPerPixel; i < width * samplesPerPixel; i++) {
      set(i, (get(i) + get(i - samplesPerPixel)) >>> 0);
    }
    return;
  }

  throw new Error(`Predictor 2 unsupported for ${bitsPerSample}-bit samples`);
}
