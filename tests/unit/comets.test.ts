/**
 * Tests for the comet part of the identify service (`packages/core/src/services/identify.ts`): the cached proxy over the MPC's CometEls.txt used
 * by the comet identification modal.
 *  - fixed-width parsing of real MPC lines (tests/fixtures/comets/CometEls-sample.txt):
 *    elliptic, hyperbolic and near-parabolic orbits, numbered/fragment designations
 *  - perihelion calendar date → Julian Date
 *  - 24 h in-memory cache, stale cache served when the MPC is down, HTTP/empty errors
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseCometEls,
  calendarToJd,
  designationFromName,
  createIdentifyService,
} from '@myastrosky/core/services/identify';

const FIXTURE = readFileSync(join(__dirname, '../fixtures/comets/CometEls-sample.txt'), 'utf-8');

function resp(text: string, status = 200) {
  return { status, headers: {}, text: async () => text, bytes: async () => new Uint8Array() };
}

let fetchMock: ReturnType<typeof vi.fn>;
let clock: number;
let identify: ReturnType<typeof createIdentifyService>;

beforeEach(() => {
  fetchMock = vi.fn();
  clock = 0;
  identify = createIdentifyService({ http: fetchMock, now: () => clock });
});

describe('calendarToJd()', () => {
  it('matches the J2000 epoch and a fractional perihelion day', () => {
    expect(calendarToJd(2000, 1, 1.5)).toBe(2451545);
    expect(calendarToJd(2026, 8, 2.1044)).toBeCloseTo(2461254.6044, 6);
  });
});

describe('designationFromName()', () => {
  it('keeps the number of a periodic comet and strips a discoverer name', () => {
    expect(designationFromName('10P/Tempel')).toBe('10P');
    expect(designationFromName('51P-A/Harrington')).toBe('51P-A');
    expect(designationFromName('C/2025 R2 (SWAN)')).toBe('C/2025 R2');
  });
});

describe('parseCometEls()', () => {
  const comets = parseCometEls(FIXTURE);

  it('parses every fixture line', () => {
    expect(comets.map((c) => c.designation)).toEqual([
      '10P',
      'C/2024 E1',
      'C/2025 R2',
      'C/2008 S3',
      'C/2014 R3',
      '51P-A',
      '2P',
    ]);
  });

  it('reads the orbital elements and magnitude parameters', () => {
    const r2 = comets.find((c) => c.designation === 'C/2025 R2')!;
    expect(r2).toMatchObject({
      name: 'C/2025 R2 (SWAN)',
      q: 0.50428,
      e: 0.994162,
      peri: 308.3762,
      node: 335.3135,
      incl: 4.4729,
      h: 12.4,
      k: 4,
    });
    expect(r2.tpJd).toBeCloseTo(calendarToJd(2025, 9, 12.8087), 6);
    expect(comets.find((c) => c.designation === 'C/2024 E1')!.e).toBeGreaterThan(1);
  });

  it('skips short, blank and malformed lines', () => {
    const good = FIXTURE.split('\n')[0];
    const broken = good.slice(0, 30) + '   abc   ' + good.slice(39);
    expect(parseCometEls(`\n${good}\nshort line\n${broken}\n`)).toHaveLength(1);
  });

  it('reports missing magnitude parameters as null', () => {
    const line = FIXTURE.split('\n')[0];
    const noMag = line.slice(0, 91) + '         ' + line.slice(100);
    expect(parseCometEls(noMag)[0]).toMatchObject({ h: null, k: null });
  });
});

describe('getCometElements()', () => {
  it('fetches the MPC file once and serves the cache afterwards', async () => {
    fetchMock.mockResolvedValue(resp(FIXTURE));
    const first = await identify.getCometElements();
    const second = await identify.getCometElements();
    expect(first).toHaveLength(7);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].url).toBe(
      'https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt',
    );
  });

  it('refetches after a day, and falls back to the stale cache when the MPC is down', async () => {
    fetchMock.mockResolvedValueOnce(resp(FIXTURE));
    const first = await identify.getCometElements();

    clock += 25 * 60 * 60 * 1000;
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await identify.getCometElements()).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on an HTTP error with nothing cached', async () => {
    fetchMock.mockResolvedValue(resp('Service Unavailable', 503));
    await expect(identify.getCometElements()).rejects.toThrow('MPC request failed (503)');
  });

  it('throws when the body holds no comet (e.g. an HTML maintenance page)', async () => {
    fetchMock.mockResolvedValue(resp('<html>maintenance</html>'));
    await expect(identify.getCometElements()).rejects.toThrow('MPC returned no comet elements');
  });
});
