/**
 * Tests for the TNS part of the identify service (`packages/core/src/services/identify.ts`): the IAU Transient Name Server cone-search proxy used by
 * the supernova identification modal.
 *  - colon-separated sexagesimal RA/Dec parsing
 *  - the quoted CSV parser (commas inside fields)
 *  - a real TNS CSV export around NGC 7331 parsed into candidates: SN 2026aaiv and
 *    SN 2025rbs (the two test-photo supernovae) plus unclassified AT rows
 *  - query parameters, 429 → TnsRateLimitError, HTML body rejected, in-memory cache
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseSexagesimalRa,
  parseSexagesimalDec,
  parseCsv,
  parseTnsCsv,
  createIdentifyService,
  TnsRateLimitError,
  snapCone,
} from '@myastrosky/core/services/identify';

const FIXTURE = readFileSync(join(__dirname, '../fixtures/tns/ngc7331-search.csv'), 'utf-8');

const PARAMS = {
  raDeg: 339.2671,
  decDeg: 34.4159,
  radiusArcmin: 20,
  dateStart: '2025-09-04',
  dateEnd: '2026-11-03',
};

function resp(text: string, status = 200, headers: Record<string, string> = {}) {
  return { status, text: async () => text, bytes: async () => new Uint8Array(), headers };
}

let fetchMock: ReturnType<typeof vi.fn>;
let identify: ReturnType<typeof createIdentifyService>;

beforeEach(() => {
  fetchMock = vi.fn();
  identify = createIdentifyService({ http: fetchMock, now: () => 0 });
});

describe('sexagesimal parsing', () => {
  it('parses colon-separated RA into degrees', () => {
    // 22h37m05.628s → 339.27345°
    expect(parseSexagesimalRa('22:37:05.628')).toBeCloseTo(339.27345, 5);
  });

  it('parses signed colon-separated Dec into degrees', () => {
    expect(parseSexagesimalDec('+34:24:35.19')).toBeCloseTo(34.409775, 5);
    expect(parseSexagesimalDec('-05:30:00')).toBeCloseTo(-5.5, 6);
  });

  it('accepts space-separated values too', () => {
    expect(parseSexagesimalRa('22 37 05.628')).toBeCloseTo(339.27345, 5);
  });
});

describe('parseCsv()', () => {
  it('keeps commas and escaped quotes inside quoted fields', () => {
    expect(parseCsv('"a","b, c","d ""e"""\n"1","2","3"')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });

  it('handles CRLF and a missing trailing newline', () => {
    expect(parseCsv('"a","b"\r\n"1","2"')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseTnsCsv() on the NGC 7331 fixture', () => {
  const candidates = parseTnsCsv(FIXTURE);

  it('parses every row', () => {
    expect(candidates).toHaveLength(8);
  });

  it('parses SN 2026aaiv with position, type, discovery date and host', () => {
    const sn = candidates.find((c) => c.name === 'SN 2026aaiv')!;
    expect(sn).toBeDefined();
    expect(sn.classified).toBe(true);
    expect(sn.type).toBe('SN Ia');
    expect(sn.raDeg).toBeCloseTo(339.27345, 4);
    expect(sn.decDeg).toBeCloseTo(34.409775, 4);
    expect(sn.discoveryDate).toBe('2026-09-01T11:23:32.352Z');
    expect(sn.discoveryMag).toBeCloseTo(17.325, 3);
    expect(sn.hostName).toBe('NGC7331');
    expect(sn.tnsUrl).toBe('https://www.wis-tns.org/object/2026aaiv');
  });

  it('parses SN 2025rbs', () => {
    const sn = candidates.find((c) => c.name === 'SN 2025rbs')!;
    expect(sn.discoveryDate).toBe('2025-07-14T03:22:35.616Z');
    expect(sn.classified).toBe(true);
  });

  it('flags AT rows as unclassified with a null type', () => {
    const at = candidates.find((c) => c.name === 'AT 2026acui')!;
    expect(at.classified).toBe(false);
    expect(at.type).toBeNull();
    expect(at.tnsUrl).toBe('https://www.wis-tns.org/object/2026acui');
  });

  it('returns [] for a header-only or empty body', () => {
    expect(parseTnsCsv('')).toEqual([]);
    expect(parseTnsCsv(FIXTURE.split('\n')[0])).toEqual([]);
  });
});

describe('snapCone()', () => {
  it('snaps the centre to 0.01° and pads the radius to cover the snap', () => {
    expect(snapCone({ ...PARAMS, raDeg: 339.2671, decDeg: 34.4159, radiusArcmin: 10.7 })).toEqual({
      ...PARAMS,
      raDeg: 339.27,
      decDeg: 34.42,
      radiusArcmin: 12,
    });
  });

  it('never exceeds the 60′ cap', () => {
    expect(snapCone({ ...PARAMS, radiusArcmin: 60 }).radiusArcmin).toBe(60);
  });
});

describe('searchTransients()', () => {
  it('sends the cone + discovery-date window as CSV search params', async () => {
    fetchMock.mockResolvedValue(resp(FIXTURE));
    await identify.searchTransients(PARAMS);
    const url = new URL(fetchMock.mock.calls[0][0].url);
    expect(url.origin + url.pathname).toBe('https://www.wis-tns.org/search');
    // Centre snapped to 0.01°, radius padded for the snap and rounded up (snapCone).
    expect(url.searchParams.get('ra')).toBe('339.27');
    expect(url.searchParams.get('decl')).toBe('34.42');
    expect(url.searchParams.get('radius')).toBe('21');
    expect(url.searchParams.get('coords_unit')).toBe('arcmin');
    expect(url.searchParams.get('format')).toBe('csv');
    expect(url.searchParams.get('date_start[date]')).toBe('2025-09-04');
    expect(url.searchParams.get('date_end[date]')).toBe('2026-11-03');
  });

  it('serves a search whose centre jittered by a few arcseconds from the cache', async () => {
    fetchMock.mockResolvedValue(resp(FIXTURE));
    await identify.searchTransients(PARAMS);
    await identify.searchTransients({
      ...PARAMS,
      raDeg: PARAMS.raDeg + 0.0008,
      decDeg: PARAMS.decDeg - 0.0006,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves a repeated search from the cache', async () => {
    fetchMock.mockResolvedValue(resp(FIXTURE));
    const first = await identify.searchTransients(PARAMS);
    const second = await identify.searchTransients({ ...PARAMS });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('throws TnsRateLimitError with the reset delay on 429', async () => {
    fetchMock.mockResolvedValue(
      resp('{"id_code":429,"id_message":"Too Many Requests"}', 429, {
        'x-cone-rate-limit-reset': '42',
      }),
    );
    const err = await identify.searchTransients(PARAMS).catch((e) => e);
    expect(err).toBeInstanceOf(TnsRateLimitError);
    expect(err.retryAfterSeconds).toBe(42);
  });

  it('does not cache a failed search', async () => {
    fetchMock.mockResolvedValueOnce(resp('', 429)).mockResolvedValueOnce(resp(FIXTURE));
    await expect(identify.searchTransients(PARAMS)).rejects.toBeInstanceOf(TnsRateLimitError);
    await expect(identify.searchTransients(PARAMS)).resolves.toHaveLength(8);
  });

  it('rejects an HTML page returned with status 200', async () => {
    fetchMock.mockResolvedValue(resp('<html><body>Maintenance</body></html>'));
    await expect(identify.searchTransients(PARAMS)).rejects.toThrow(/unexpected response/);
  });

  it('wraps network failures', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(identify.searchTransients(PARAMS)).rejects.toThrow(
      /TNS request failed: ECONNRESET/,
    );
  });
});
