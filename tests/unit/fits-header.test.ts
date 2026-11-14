import { describe, expect, it } from 'vitest';
import {
  captureFromHeader,
  fitsDataTruncated,
  fitsHeadersMissingKey,
  filterFitsCards,
  headerFacts,
  parseFitsCards,
  parseSexagesimal,
  sanitizeFitsCards,
} from '@myastrosky/core/fits-header';
import { parseFITSHeader } from '@myastrosky/core/wcs';

/** An 80-column header from card texts, ended by END. */
const header = (cards: string[]) => [...cards, 'END'].map((c) => c.padEnd(80)).join('');

describe('parseFitsCards()', () => {
  it('keeps every card in order with its value and comment, commentary cards included, up to END', () => {
    const cards = parseFitsCards(
      header([
        'SIMPLE  =                    T / file does conform to FITS standard',
        "INSTRUME= 'ATIK-314L: fw rev 3.01' / Instrument name",
        "OBJECT  = 'O''Neil / test' / quotes and slash inside",
        'EXPTIME =                  30. / [s]  Exposure time duration',
        'HISTORY Background extraction',
        'COMMENT made by Siril',
      ]) + 'IGNORED =                    1'.padEnd(80),
    );
    expect(cards).toEqual([
      { key: 'SIMPLE', value: 'T', comment: 'file does conform to FITS standard' },
      { key: 'INSTRUME', value: 'ATIK-314L: fw rev 3.01', comment: 'Instrument name' },
      { key: 'OBJECT', value: "O'Neil / test", comment: 'quotes and slash inside' },
      { key: 'EXPTIME', value: '30.', comment: '[s]  Exposure time duration' },
      { key: 'HISTORY', value: 'Background extraction' },
      { key: 'COMMENT', value: 'made by Siril' },
    ]);
  });

  it('reads the newline-delimited form', () => {
    expect(parseFitsCards("NAXIS1  = 40\nFILTER  = 'Ha'\nEND")).toEqual([
      { key: 'NAXIS1', value: '40' },
      { key: 'FILTER', value: 'Ha' },
    ]);
  });
});

describe('sanitizeFitsCards()', () => {
  it('keeps well-formed cards only, and nothing from a value that is not a list', () => {
    expect(
      sanitizeFitsCards([
        { key: 'A', value: '1', comment: 'c' },
        { key: 'B', value: 2 },
        null,
        { key: 'C', value: 'x', comment: '' },
      ]),
    ).toEqual([
      { key: 'A', value: '1', comment: 'c' },
      { key: 'C', value: 'x' },
    ]);
    expect(sanitizeFitsCards('nope')).toEqual([]);
  });
});

describe('captureFromHeader()', () => {
  const parse = (cards: string[]) => parseFITSHeader(header(cards));

  it('reads the ATIK stack: EXPTIME, STACKCNT, CCD temperature and binning', () => {
    expect(
      captureFromHeader(
        parse([
          "DATE-OBS= '2026-09-04T21:51:11'",
          'EXPTIME =                  30.',
          'XBINNING=                    2',
          'YBINNING=                    2',
          'CCD-TEMP=                  9.9',
          'STACKCNT=                   44',
          'LIVETIME=                1320.',
        ]),
      ),
    ).toEqual({
      dateObs: '2026-09-04T21:51:11Z',
      expTime: 30,
      stackCnt: 44,
      captureDetails: { ccdTemp: 9.9, binning: '2x2' },
    });
  });

  it('counts the frames from NCOMBINE, else LIVETIME ÷ EXPTIME when that is whole, and reads EXPOSURE', () => {
    expect(captureFromHeader(parse(['EXPTIME = 120', 'NCOMBINE= 8'])).stackCnt).toBe(8);
    expect(captureFromHeader(parse(['EXPOSURE= 300', 'LIVETIME= 3900'])).stackCnt).toBe(13);
    expect(captureFromHeader(parse(['EXPTIME = 300', 'LIVETIME= 3950'])).stackCnt).toBeUndefined();
    // PixInsight master light: the sub exposure only, no count.
    const pi = captureFromHeader(parse(["FILTER  = 'UVIR'", 'EXPTIME = 180.']));
    expect([pi.expTime, pi.stackCnt, pi.filter]).toEqual([180, undefined, 'UVIR']);
  });

  it('skips the Siril placeholder date', () => {
    expect(captureFromHeader(parse(["DATE-OBS= '2026-01-01T00:00:00'"])).dateObs).toBeUndefined();
  });
});

describe('headerFacts()', () => {
  const facts = (cards: string[]) => headerFacts(parseFITSHeader(header(cards)));

  it('reads the centre from RA/DEC in degrees, else OBJCTRA/OBJCTDEC', () => {
    expect(facts(['RA      = 84.15', 'DEC     = -5.383056'])).toMatchObject({
      centerRa: 84.15,
      centerDec: -5.383056,
    });
    const s = facts(["OBJCTRA = '1 36 42.44'", "OBJCTDEC= '15 47 21.99'"]);
    expect(s.centerRa).toBeCloseTo(24.17683, 4);
    expect(s.centerDec).toBeCloseTo(15.78944, 4);
  });

  it('reads the object, the optics and the names', () => {
    expect(
      facts([
        "OBJECT  = 'M 42    '",
        'FOCALLEN=                 150.',
        'XPIXSZ  =                  2.9',
        'XBINNING=                    1',
        "TELESCOP= 'S30_0289c34b'",
        "INSTRUME= 'Seestar S30'",
        'NAXIS1  = 1080',
        'NAXIS2  = 1920',
      ]),
    ).toEqual({
      object: 'M 42',
      focalLengthMm: 150,
      pixelSizeUm: 2.9,
      binning: 1,
      telescope: 'S30_0289c34b',
      instrument: 'Seestar S30',
      width: 1080,
      height: 1920,
    });
  });
});

describe('parseSexagesimal()', () => {
  it('reads spaces and colons, signs, and refuses anything else', () => {
    expect(parseSexagesimal('-00 49 19.424')).toBeCloseTo(-0.82206, 4);
    expect(parseSexagesimal('13:15:46.2')).toBeCloseTo(13.26283, 4);
    expect(parseSexagesimal('+47')).toBe(47);
    expect(parseSexagesimal('abc')).toBeUndefined();
  });
});

describe('fitsDataTruncated()', () => {
  const parsed = { NAXIS: 3, NAXIS1: 10, NAXIS2: 10, NAXIS3: 3, BITPIX: -32 };
  it('compares the file length with the header plus the data it announces', () => {
    expect(fitsDataTruncated(2880 + 1200, 2880, parsed)).toBe(false);
    expect(fitsDataTruncated(2880 + 1199, 2880, parsed)).toBe(true);
    expect(fitsDataTruncated(2880, 2880, { NAXIS: 0, BITPIX: 8 })).toBe(false);
  });
});

describe('fitsHeadersMissingKey()', () => {
  const placement = {
    centerRa: 10,
    centerDec: 41,
    rotationDeg: 0,
    projPerPx: 1e-5,
    mirrorX: false,
    mirrorY: false,
  };

  it('is null for a photo whose headers are stored', () => {
    expect(fitsHeadersMissingKey({ hasFitsHeaders: true, manualPlacement: placement })).toBeNull();
  });

  it('says a manually placed photo never read a file', () => {
    expect(fitsHeadersMissingKey({ manualPlacement: placement })).toBe(
      'modal.fitsHeadersNoneManual',
    );
  });

  it('says no file was read for any other photo without headers', () => {
    expect(fitsHeadersMissingKey({ hasFitsHeaders: false })).toBe('modal.fitsHeadersNone');
  });
});

describe('filterFitsCards()', () => {
  const cards = [
    { key: 'EXPTIME', value: '180.', comment: '[s] Exposure time' },
    { key: 'OBJECT', value: 'M31' },
    { key: 'GAIN', value: '100', comment: 'Sensor gain' },
  ];

  it('keeps every card for an empty query', () => {
    expect(filterFitsCards(cards, '  ')).toEqual(cards);
  });

  it('matches the keyword, the value or the comment, case ignored', () => {
    expect(filterFitsCards(cards, 'exp').map((c) => c.key)).toEqual(['EXPTIME']);
    expect(filterFitsCards(cards, 'm31').map((c) => c.key)).toEqual(['OBJECT']);
    expect(filterFitsCards(cards, 'sensor').map((c) => c.key)).toEqual(['GAIN']);
  });
});
