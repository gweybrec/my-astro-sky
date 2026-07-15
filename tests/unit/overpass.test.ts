import { describe, it, expect } from 'vitest';
import { parseOverpassPeaks } from '../../server/overpass';

describe('parseOverpassPeaks', () => {
  it('maps named peak nodes with an ele tag', () => {
    const json = {
      elements: [
        {
          type: 'node',
          lat: 45.83,
          lon: 6.86,
          tags: { natural: 'peak', name: 'Mont Blanc', ele: '4808' },
        },
        {
          type: 'node',
          lat: 45.87,
          lon: 6.88,
          tags: { natural: 'peak', name: 'Aiguille du Midi', ele: '3842 m' },
        },
      ],
    };
    const peaks = parseOverpassPeaks(json);
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toEqual({ name: 'Mont Blanc', lat: 45.83, lon: 6.86, eleM: 4808 });
    expect(peaks[1].eleM).toBe(3842); // "3842 m" → 3842
  });

  it('parses ele with thousands separators and leaves missing ele as null', () => {
    const json = {
      elements: [
        { lat: 1, lon: 2, tags: { name: 'A', ele: '4,808' } },
        { lat: 3, lon: 4, tags: { name: 'B' } },
      ],
    };
    const peaks = parseOverpassPeaks(json);
    expect(peaks[0].eleM).toBe(4808);
    expect(peaks[1].eleM).toBeNull();
  });

  it('drops unnamed peaks and nodes without coordinates', () => {
    const json = {
      elements: [
        { lat: 1, lon: 2, tags: { natural: 'peak' } }, // no name
        { tags: { name: 'NoCoords' } }, // no lat/lon
        { lat: 5, lon: 6, tags: { name: '  ' } }, // blank name
        { lat: 7, lon: 8, tags: { name: 'Keep' } },
      ],
    };
    const peaks = parseOverpassPeaks(json);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].name).toBe('Keep');
  });

  it('returns [] for malformed input', () => {
    expect(parseOverpassPeaks(null)).toEqual([]);
    expect(parseOverpassPeaks({})).toEqual([]);
    expect(parseOverpassPeaks({ elements: 'nope' })).toEqual([]);
    expect(parseOverpassPeaks('string')).toEqual([]);
  });
});
