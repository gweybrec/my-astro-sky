import { describe, it, expect } from 'vitest';
import { parseXisfHeader, UnsupportedXisfError } from '@myastrosky/core/raw-decode/xisf';
import { parseWcsSidecar } from '@myastrosky/core/wcs';
import { buildFits } from '../fixtures/fits-builders';
import { buildXisf } from '../fixtures/xisf-builders';

describe('parseXisfHeader', () => {
  it('reads geometry, sample format and an attachment location', () => {
    const h = parseXisfHeader(
      buildXisf({ geometry: '4096:2048:3', sampleFormat: 'Float32', colorSpace: 'RGB' }),
    );
    expect(h.image).toMatchObject({
      width: 4096,
      height: 2048,
      channels: 3,
      sampleFormat: 'Float32',
      colorSpace: 'RGB',
      location: { kind: 'attachment', position: 4096, size: 24 },
    });
    expect(h.image?.compression).toBeUndefined();
  });

  it('reads FITSKeyword elements into the parseFITSHeader shape', () => {
    const h = parseXisfHeader(
      buildXisf({
        keywords: [
          { name: 'OBJECT', value: "'M 31'", comment: 'target' },
          { name: 'CRVAL1', value: '10.6847', comment: 'RA' },
          { name: 'CRVAL2', value: '+41.2687' },
          { name: 'CD1_1', value: '-1.5E-04' },
          { name: 'EQUINOX', value: '2000' },
          { name: 'SIMPLE', value: 'T' },
          { name: 'FLIPPED', value: 'F' },
          { name: 'NOTE', value: "'a/b <c> & d'", comment: 'has / and > chars' },
          { name: 'COMMENT', value: '' },
          { name: 'HISTORY', value: '' },
          { name: 'HIERARCH ESO X', value: '1' },
        ],
      }),
    );
    expect(h.fitsKeywords).toEqual({
      OBJECT: 'M 31',
      CRVAL1: 10.6847,
      CRVAL2: 41.2687,
      CD1_1: -1.5e-4,
      EQUINOX: 2000,
      SIMPLE: true,
      FLIPPED: false,
      NOTE: 'a/b <c> & d',
    });
  });

  it('exposes inline/embedded locations and the compression attribute', () => {
    expect(parseXisfHeader(buildXisf({ location: 'inline:base64' })).image?.location).toEqual({
      kind: 'inline',
    });
    expect(parseXisfHeader(buildXisf({ location: 'embedded' })).image?.location).toEqual({
      kind: 'embedded',
    });
    expect(parseXisfHeader(buildXisf({ compression: 'zlib:48' })).image?.compression).toBe(
      'zlib:48',
    );
  });

  it('returns image null and no keywords when the header has no Image element', () => {
    const h = parseXisfHeader(buildXisf({ noImage: true }));
    expect(h.image).toBeNull();
    expect(h.fitsKeywords).toEqual({});
  });

  it('only reads keywords from the first Image', () => {
    const h = parseXisfHeader(
      buildXisf({
        keywords: [{ name: 'A', value: '1' }],
        trailingXml:
          '<Image geometry="2:2:1" sampleFormat="UInt8" location="attachment:9:4"><FITSKeyword name="B" value="2" comment=""/></Image>',
      }),
    );
    expect(h.fitsKeywords).toEqual({ A: 1 });
    expect(h.image?.width).toBe(4);
  });

  it('handles a Uint8Array view with a non-zero byteOffset', () => {
    const inner = buildXisf({ geometry: '5:6:1' });
    const padded = new Uint8Array(inner.length + 7);
    padded.set(inner, 7);
    expect(parseXisfHeader(padded.subarray(7)).image).toMatchObject({ width: 5, height: 6 });
  });

  it('rejects a bad signature or a too-short file', () => {
    expect(() => parseXisfHeader(buildXisf({ signature: 'XISF0200' }))).toThrow(
      UnsupportedXisfError,
    );
    expect(() => parseXisfHeader(new Uint8Array(4))).toThrow(UnsupportedXisfError);
  });

  it('rejects a header length exceeding the file', () => {
    expect(() => parseXisfHeader(buildXisf({ headerLength: 1_000_000 }))).toThrow(
      UnsupportedXisfError,
    );
  });

  it('rejects unusable geometry or a malformed attachment', () => {
    expect(() => parseXisfHeader(buildXisf({ geometry: '4:3' }))).toThrow(UnsupportedXisfError);
    expect(() => parseXisfHeader(buildXisf({ geometry: '4:3:1:2' }))).toThrow(UnsupportedXisfError);
    expect(() => parseXisfHeader(buildXisf({ location: 'attachment:abc:2' }))).toThrow(
      UnsupportedXisfError,
    );
  });
});

describe('parseWcsSidecar', () => {
  it('parses a binary FITS-style wcs.fits (astrometry.net)', () => {
    const buf = buildFits({
      bitpix: 8,
      naxis1: 0,
      naxis2: 0,
      pixels: [],
      extraCards: ['CRVAL1  =              83.8221 / RA', "CTYPE1  = 'RA---TAN'"],
    });
    const h = parseWcsSidecar(buf);
    expect(h.CRVAL1).toBe(83.8221);
    expect(h.CTYPE1).toBe('RA---TAN');
  });

  it('parses a newline-delimited text .wcs (ASTAP)', () => {
    const text =
      "SIMPLE  =                    T\nCRPIX1  =               1024.5\nCTYPE1  = 'RA---TAN'\nEND\nCRVAL1  = 1\n";
    const h = parseWcsSidecar(new TextEncoder().encode(text));
    expect(h.SIMPLE).toBe(true);
    expect(h.CRPIX1).toBe(1024.5);
    expect(h.CTYPE1).toBe('RA---TAN');
    expect(h.CRVAL1).toBeUndefined(); // after END
  });

  it('returns an empty header for empty input', () => {
    expect(parseWcsSidecar(new Uint8Array(0))).toEqual({});
  });
});
