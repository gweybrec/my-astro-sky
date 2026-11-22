import { beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '@myastrosky/core/i18n/index';
import { photoFacts, photoSummary, photoSummaryParts } from '@myastrosky/core/photo-facts';
import type { Photo } from '@myastrosky/core/types';

function makePhoto(over: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'M42.jpg',
    width: 100,
    height: 100,
    createdAt: '2025-10-12T00:00:00Z',
    correspondences: [],
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    notes: '',
    ...over,
  };
}

describe('photoSummary', () => {
  beforeEach(() => setLang('en'));

  it('is empty for a photo with no equipment, exposure or date', () => {
    expect(photoSummary(makePhoto())).toBe('');
  });

  it('joins equipment, total exposure and date in that order', () => {
    const photo = makePhoto({
      observationDate: '2025-10-12T21:30:00Z',
      integrations: [
        { filter: 'Ha', frames: 30, seconds: 120 },
        { filter: 'OIII', frames: 30, seconds: 150 },
      ],
    });
    expect(photoSummary(photo, 'Seestar S50')).toBe('Seestar S50 · 2h15 · Oct 12, 2025');
  });

  it('skips incomplete exposure rows and the missing parts', () => {
    const photo = makePhoto({ integrations: [{ filter: 'L', frames: 0, seconds: 300 }] });
    expect(photoSummary(photo, 'Newton 200')).toBe('Newton 200');
  });

  it("names a visited photo's equipment as its sender wrote it", () => {
    const photo = makePhoto({ sharedGear: { setup: 'Askar 103' } });
    expect(photoSummary(photo)).toBe('Askar 103');
  });
});

describe('photoSummaryParts', () => {
  beforeEach(() => setLang('en'));

  it('keeps a long equipment name whole, apart from the time and date', () => {
    const photo = makePhoto({
      observationDate: '2025-10-12T21:30:00Z',
      integrations: [{ filter: 'L', frames: 129, seconds: 300 }],
    });
    expect(photoSummaryParts(photo, 'Celestron EdgeHD 8 + ZWO ASI2600MC Pro')).toEqual([
      'Celestron EdgeHD 8 + ZWO ASI2600MC Pro',
      '10h45',
      'Oct 12, 2025',
    ]);
  });
});

describe('photoFacts', () => {
  beforeEach(() => setLang('en'));

  it('lists only the facts the photo has', () => {
    expect(photoFacts(makePhoto())).toEqual([]);
  });

  it('leaves the sensor temperatures and binning out of the brief list', () => {
    const photo = makePhoto({ captureDetails: { gain: 80, ccdTemp: -10 } });
    const values = photoFacts(photo, { brief: true }).map((f) => f.value);
    expect(values).toContain('80');
    expect(values.some((v) => v.includes('-10'))).toBe(false);
  });

  it('lists every exposure row with something in it, time first and filter after', () => {
    const photo = makePhoto({
      integrations: [
        { filter: 'Ha', frames: 40, seconds: 300 },
        { filter: '', frames: 0, seconds: 10 },
        { filter: 'L', frames: 183, seconds: 0 },
        { filter: 'OIII', frames: 0, seconds: 0 },
      ],
    });
    const facts = photoFacts(photo);
    const exposures = facts.find((f) => f.exposures)!;
    expect(exposures.exposures).toEqual([
      { time: '40 × 300 s', filter: 'Ha' },
      { time: 'N/A × 10 s', filter: '' },
      { time: '183 × N/A', filter: 'L' },
      { time: '', filter: 'OIII' },
    ]);
    expect(exposures.value).toBe('40 × 300 s Ha · N/A × 10 s · 183 × N/A L · OIII');
    expect(exposures.mono).toBeUndefined();
    // Only the complete row makes the total.
    expect(facts.find((f) => f.label === 'Total exposure')?.value).toBe('3h20');
  });

  it('has no total when no row has both a count and a length', () => {
    const photo = makePhoto({ integrations: [{ filter: 'Ha', frames: 0, seconds: 300 }] });
    const facts = photoFacts(photo);
    expect(facts.map((f) => f.label)).toEqual(['Integration']);
  });
});

describe('photoFacts noChips', () => {
  beforeEach(() => setLang('en'));

  it('leaves out the labels and points of interest', () => {
    const photo: Photo = {
      id: 'p2',
      filename: 'p2.jpg',
      originalName: 'M2.jpg',
      width: 1,
      height: 1,
      createdAt: '2025-10-12T00:00:00Z',
      correspondences: [],
      dsoIds: [],
      labels: ['vespera'],
      pointsOfInterest: [{ categoryId: 'comet', name: '10P', x: 0, y: 0 } as never],
      notes: '',
    };
    expect(photoFacts(photo).length).toBe(2);
    expect(photoFacts(photo, { noChips: true })).toEqual([]);
  });
});
