/**
 * Minimal hand-rolled FITS primary-HDU builder for decoder tests. Not a general encoder —
 * just enough to exercise `server/raw-decode/fits-decoder.ts`. Not a `.test.ts` file, so
 * vitest's `include` glob does not collect it as a test suite.
 */

const BLOCK_SIZE = 2880;
const CARD_SIZE = 80;

function card(keyword: string, value: string): string {
  return (keyword.padEnd(8) + '= ' + value).padEnd(CARD_SIZE).slice(0, CARD_SIZE);
}

export interface BuildFitsOptions {
  bitpix: 8 | 16 | 32 | -32 | -64;
  naxis1: number;
  naxis2: number;
  naxis3?: number; // when set, NAXIS=3 (a colour cube); otherwise NAXIS=2
  bzero?: number;
  bscale?: number;
  roworder?: 'TOP-DOWN' | 'BOTTOM-UP';
  /** Physical pixel values (BZERO + BSCALE*raw already undone), plane-major, row-major. */
  pixels: number[];
  /** Extra raw bytes appended after the data unit, inside the same padded block or beyond. */
  trailingGarbageFloats?: number[];
  extraCards?: string[];
}

export function buildFits(opts: BuildFitsOptions): Buffer {
  const {
    bitpix,
    naxis1,
    naxis2,
    naxis3,
    bzero = 0,
    bscale = 1,
    roworder,
    pixels,
    trailingGarbageFloats,
    extraCards = [],
  } = opts;

  const naxis = naxis3 !== undefined ? 3 : 2;
  const cards: string[] = [];
  cards.push(card('SIMPLE', 'T'));
  cards.push(card('BITPIX', String(bitpix)));
  cards.push(card('NAXIS', String(naxis)));
  cards.push(card('NAXIS1', String(naxis1)));
  cards.push(card('NAXIS2', String(naxis2)));
  if (naxis3 !== undefined) cards.push(card('NAXIS3', String(naxis3)));
  cards.push(card('BZERO', String(bzero)));
  cards.push(card('BSCALE', String(bscale)));
  if (roworder) cards.push(card('ROWORDER', `'${roworder}'`));
  for (const c of extraCards) cards.push(c.padEnd(CARD_SIZE).slice(0, CARD_SIZE));
  cards.push('END'.padEnd(CARD_SIZE));

  let headerStr = cards.join('');
  const pad = BLOCK_SIZE - (headerStr.length % BLOCK_SIZE);
  if (pad < BLOCK_SIZE) headerStr += ' '.repeat(pad);
  const headerBuf = Buffer.from(headerStr, 'ascii');

  const bytesPerSample = Math.abs(bitpix) / 8;
  const dataBuf = Buffer.alloc(pixels.length * bytesPerSample);
  for (let i = 0; i < pixels.length; i++) {
    const raw = (pixels[i] - bzero) / bscale;
    const off = i * bytesPerSample;
    switch (bitpix) {
      case 8:
        dataBuf.writeUInt8(Math.round(raw) & 0xff, off);
        break;
      case 16:
        dataBuf.writeInt16BE(Math.round(raw), off);
        break;
      case 32:
        dataBuf.writeInt32BE(Math.round(raw), off);
        break;
      case -32:
        dataBuf.writeFloatBE(raw, off);
        break;
      case -64:
        dataBuf.writeDoubleBE(raw, off);
        break;
    }
  }

  let trailingBuf = Buffer.alloc(0);
  if (trailingGarbageFloats && trailingGarbageFloats.length > 0) {
    trailingBuf = Buffer.alloc(trailingGarbageFloats.length * 4);
    trailingGarbageFloats.forEach((v, i) => trailingBuf.writeFloatBE(v, i * 4));
  }

  // Pad the data unit (+ any trailing garbage) to a 2880-byte boundary, as real FITS files do.
  const unpaddedLen = dataBuf.length + trailingBuf.length;
  const dataPad = (BLOCK_SIZE - (unpaddedLen % BLOCK_SIZE)) % BLOCK_SIZE;

  return Buffer.concat([headerBuf, dataBuf, trailingBuf, Buffer.alloc(dataPad)]);
}
