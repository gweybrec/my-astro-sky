import { describe, it, expect } from 'vitest';
import {
  integrationRowComplete,
  integrationRowHasData,
  integrationRowText,
  integrationRowTime,
  integrationTotalSeconds,
  recentIntegrationFilters,
} from '@myastrosky/core/integration-rows';

const row = (frames: number, seconds: number, filter = '') => ({ frames, seconds, filter });

describe('integrationRowHasData', () => {
  it('is true when any one field is given', () => {
    expect(integrationRowHasData(row(183, 0))).toBe(true);
    expect(integrationRowHasData(row(0, 10))).toBe(true);
    expect(integrationRowHasData(row(0, 0, 'Ha'))).toBe(true);
  });

  it('is false for a row with nothing in it, a blank filter included', () => {
    expect(integrationRowHasData(row(0, 0))).toBe(false);
    expect(integrationRowHasData(row(0, 0, '   '))).toBe(false);
  });
});

describe('integrationRowTime', () => {
  it('writes the count and the length', () => {
    expect(integrationRowTime(row(40, 300, 'Ha'), 'N/A', ' s')).toBe('40 × 300 s');
  });

  it('writes a missing count or length as not given', () => {
    expect(integrationRowTime(row(0, 10), 'N/A', ' s')).toBe('N/A × 10 s');
    expect(integrationRowTime(row(183, 0), 'N/A', ' s')).toBe('183 × N/A');
  });

  it('is empty for a row with only a filter', () => {
    expect(integrationRowTime(row(0, 0, 'OIII'), 'N/A', ' s')).toBe('');
  });
});

describe('integrationRowText', () => {
  it('gives the count, the length and the total', () => {
    expect(integrationRowText(row(120, 180, 'Ha'), 'N/A', 's')).toBe('120 × 180s = 6h00');
  });

  it('writes a missing count or length as not given, without a total', () => {
    expect(integrationRowText(row(0, 10), 'N/A', 's')).toBe('N/A × 10s');
    expect(integrationRowText(row(300, 0), 'N/A', 's')).toBe('300 × N/A');
  });

  it('is empty for a row with only a filter', () => {
    expect(integrationRowText(row(0, 0, 'L'), 'N/A', 's')).toBe('');
  });
});

describe('integrationTotalSeconds', () => {
  it('adds up only the rows with both a count and a length', () => {
    expect(integrationTotalSeconds([row(10, 60), row(0, 60), row(5, 0), row(0, 0, 'Ha')])).toBe(
      600,
    );
    expect(integrationRowComplete(row(10, 60))).toBe(true);
    expect(integrationRowComplete(row(10, 0))).toBe(false);
  });

  it('is 0 when no row is complete', () => {
    expect(integrationTotalSeconds([row(0, 60), row(0, 0, 'Ha')])).toBe(0);
  });
});

describe('recentIntegrationFilters', () => {
  const photo = (date: string, filters: string[]) => ({
    createdAt: '2020-01-01T00:00:00Z',
    observationDate: date,
    integrations: filters.map((f) => row(1, 1, f)),
  });

  it('lists the filters of the newest photos first, each once whatever its case', () => {
    const photos = [
      photo('2025-01-01T00:00:00Z', ['L', 'Ha']),
      photo('2025-06-01T00:00:00Z', ['OIII', 'ha', '']),
      photo('2025-03-01T00:00:00Z', ['SII']),
    ];
    expect(recentIntegrationFilters(photos)).toEqual(['OIII', 'ha', 'SII', 'L']);
  });

  it('stops at the limit and uses the date the photo was added when it has no observation date', () => {
    const photos = [
      { createdAt: '2026-01-01T00:00:00Z', observationDate: '', integrations: [row(1, 1, 'R')] },
      photo('2025-01-01T00:00:00Z', ['G', 'B']),
    ];
    expect(recentIntegrationFilters(photos, 2)).toEqual(['R', 'G']);
  });
});
