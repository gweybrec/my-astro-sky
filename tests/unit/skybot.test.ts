/**
 * Tests for server/skybot.ts: the IMCCE SkyBoT conesearch proxy used by the
 * asteroid identification modal.
 *  - sexagesimal RA/Dec parsing
 *  - the "# Flag: -1" IMCCE error body rejected as an error, never JSON.parse'd
 *  - an empty response returns []
 *  - a real (trimmed) SkyBoT JSON response is parsed into candidates, with 18799
 *    ("1999 JZ73") present — the regression fixture for the asteroid-identify flow
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseRaHms, parseDecDms, skybotConesearch } from '../../server/skybot';

const FIXTURE_PATH = join(__dirname, '../fixtures/skybot/ngc4438-conesearch.json');

function jsonResp(text: string) {
  return { ok: true, status: 200, text: async () => text };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseRaHms()', () => {
  it('parses hours-minutes-seconds into decimal degrees', () => {
    // 12h 27m 51.8342s -> 186.9659758... deg
    expect(parseRaHms('12 27 51.8342')).toBeCloseTo(186.965976, 5);
  });
});

describe('parseDecDms()', () => {
  it('parses a positive degrees-minutes-seconds into decimal degrees', () => {
    expect(parseDecDms('+12 53 24.083')).toBeCloseTo(12.890023, 5);
  });

  it('parses a negative degrees-minutes-seconds into decimal degrees', () => {
    expect(parseDecDms('-11 36 27.61')).toBeCloseTo(-11.607669, 5);
  });
});

describe('skybotConesearch()', () => {
  it('throws on an IMCCE error body instead of parsing it as JSON', async () => {
    fetchMock.mockResolvedValue(
      jsonResp(
        '# Flag: -1\n# Ticket: 187677636008292408\nSkyBoT conesearch -> computeEphemeris: error: planetary_ephem: satellite: calceph_compute_unit error #0',
      ),
    );
    await expect(
      skybotConesearch({ raDeg: 180, decDeg: 10, radiusArcmin: 5, epochJd: 2461139.5 }),
    ).rejects.toThrow(/calceph_compute_unit/);
  });

  it('returns an empty array for an empty response', async () => {
    fetchMock.mockResolvedValue(jsonResp(''));
    const result = await skybotConesearch({
      raDeg: 0,
      decDeg: 0,
      radiusArcmin: 1,
      epochJd: 2461139.5,
    });
    expect(result).toEqual([]);
  });

  it('parses a real SkyBoT response and includes the known asteroid', async () => {
    const fixture = readFileSync(FIXTURE_PATH, 'utf8');
    fetchMock.mockResolvedValue(jsonResp(fixture));

    const candidates = await skybotConesearch({
      raDeg: 186.939296,
      decDeg: 13.00719,
      radiusArcmin: 3,
      epochJd: 2461139.4852199,
    });

    expect(candidates.length).toBeGreaterThan(0);
    const asteroid = candidates.find((c) => c.number === '18799');
    expect(asteroid).toBeDefined();
    expect(asteroid?.name).toBe('1999 JZ73');
    expect(asteroid?.raDeg).toBeCloseTo(186.965976, 4);
    expect(asteroid?.decDeg).toBeCloseTo(12.890023, 4);
    expect(asteroid?.vMag).toBeCloseTo(17.6, 5);
    expect(asteroid?.dRaArcsecPerHour).toBeCloseTo(-33.2244, 4);
    expect(asteroid?.dDecArcsecPerHour).toBeCloseTo(5.4436, 4);
  });

  it('sends the required query parameters', async () => {
    fetchMock.mockResolvedValue(jsonResp('[]'));
    await skybotConesearch({ raDeg: 186.9, decDeg: 13.0, radiusArcmin: 5, epochJd: 2461139.5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('-ra')).toBe('186.9');
    expect(url.searchParams.get('-dec')).toBe('13');
    expect(url.searchParams.get('-rd')).toBe('5');
    expect(url.searchParams.get('-ep')).toBe('2461139.5');
    expect(url.searchParams.get('-objFilter')).toBe('100');
    expect(url.searchParams.get('-mime')).toBe('json');
  });
});
