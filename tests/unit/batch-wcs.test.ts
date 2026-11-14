import { describe, it, expect, vi } from 'vitest';
import type { BatchItem } from '../../src/batch-types';
import type { PlateSolveResult } from '@myastrosky/core/types';

const mockFindDSOIds = vi.fn(() => ['DERIVED_DSO']);
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  findDSOIdsFromCorrespondences: (...args: unknown[]) => mockFindDSOIds(...args),
}));

const { applyWcsResultToItem, applyWcsMetadataToItem } = await import('../../src/batch-wcs');

function makeItem(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    id: 'batch-1',
    file: new File([new Uint8Array([1, 2, 3])], 'M101.fit'),
    rawName: 'M101.fit',
    convertProgress: 1,
    thumbBlobUrl: null,
    solver: 'astap',
    hintCoords: null,
    hintTargetName: '',
    fovDeg: null,
    wcsResult: null,
    solveCorrespondences: null,
    status: 'converting',
    photo: null,
    error: '',
    diagnostics: undefined,
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    integrations: [],
    observationDate: '',
    captureDetails: {},
    gearSetupId: null,
    notes: '',
    customName: 'M101',
    elapsedSeconds: 0,
    localJobId: null,
    solveTimer: null,
    pollingTimer: null,
    solveAbort: null,
    metaOpen: false,
    ...overrides,
  };
}

const goodResult: PlateSolveResult = {
  success: true,
  correspondences: [
    { pointIndex: 0, photoX: 1, photoY: 1, starHip: 1, starName: 'a', starRa: 10, starDec: 20 },
    { pointIndex: 1, photoX: 2, photoY: 2, starHip: 2, starName: 'b', starRa: 11, starDec: 21 },
    { pointIndex: 2, photoX: 3, photoY: 3, starHip: 3, starName: 'c', starRa: 12, starDec: 22 },
  ],
  dateObs: '2026-03-17T20:38:44Z',
  expTime: 30,
  stackCnt: 89,
  filter: 'L',
  captureDetails: { gain: 100, iso: '' },
};

describe('applyWcsResultToItem', () => {
  it('returns applied:false without touching the item when the result has no correspondences', () => {
    const item = makeItem();
    const result = applyWcsResultToItem(item, { success: false }, 100, 100);
    expect(result).toEqual({ applied: false, aspectMismatch: false });
    expect(item.status).toBe('converting');
    expect(item.solveCorrespondences).toBeNull();
  });

  it('sets status to success and stores correspondences on a good result', () => {
    const item = makeItem();
    const result = applyWcsResultToItem(item, goodResult, 100, 100);
    expect(result.applied).toBe(true);
    expect(item.status).toBe('success');
    expect(item.solveCorrespondences).toEqual(goodResult.correspondences);
    expect(item.wcsResult).toBe(goodResult);
  });

  it('derives dsoIds via the catalog when the server did not supply any', () => {
    const item = makeItem();
    applyWcsResultToItem(item, goodResult, 100, 100);
    expect(mockFindDSOIds).toHaveBeenCalledWith(goodResult.correspondences, 100, 100);
    expect(item.dsoIds).toEqual(['DERIVED_DSO']);
  });

  it('uses server-provided dsoIds when present, without calling the catalog', () => {
    mockFindDSOIds.mockClear();
    const item = makeItem();
    applyWcsResultToItem(item, { ...goodResult, dsoIds: ['M101'] }, 100, 100);
    expect(item.dsoIds).toEqual(['M101']);
    expect(mockFindDSOIds).not.toHaveBeenCalled();
  });

  it('sets observationDate from dateObs only when not already set', () => {
    const item = makeItem({ observationDate: '2020-01-01T00:00:00Z' });
    applyWcsResultToItem(item, goodResult, 100, 100);
    expect(item.observationDate).toBe('2020-01-01T00:00:00Z'); // untouched

    const item2 = makeItem();
    applyWcsResultToItem(item2, goodResult, 100, 100);
    expect(item2.observationDate).toBe(goodResult.dateObs);
  });

  it('builds one integration row from expTime/stackCnt only when integrations is empty', () => {
    const item = makeItem();
    applyWcsResultToItem(item, goodResult, 100, 100);
    expect(item.integrations).toEqual([{ frames: 89, seconds: 30, filter: 'L' }]);

    const item2 = makeItem({ integrations: [{ frames: 1, seconds: 1, filter: 'existing' }] });
    applyWcsResultToItem(item2, goodResult, 100, 100);
    expect(item2.integrations).toEqual([{ frames: 1, seconds: 1, filter: 'existing' }]);
  });

  it('merges captureDetails, keeping values the user already entered', () => {
    const item = makeItem({ captureDetails: { gain: 999, offset: 5 } });
    applyWcsResultToItem(item, goodResult, 100, 100);
    // gain: user's 999 wins over the server's 100; offset: user's own value untouched;
    // iso: absent from the item, so the server's (blank) value is copied in as-is.
    expect(item.captureDetails).toEqual({ gain: 999, offset: 5, iso: '' });
  });

  it('reports aspectMismatch from the result dimension warning', () => {
    const item = makeItem();
    const result = applyWcsResultToItem(
      item,
      {
        ...goodResult,
        dimensionWarning: {
          sourceW: 100,
          sourceH: 50,
          targetW: 200,
          targetH: 90,
          aspectMismatch: true,
        },
      },
      100,
      100,
    );
    expect(result.aspectMismatch).toBe(true);
  });
});

describe('a file without a plate solution', () => {
  const unsolved: PlateSolveResult = {
    success: false,
    code: 'NO_WCS_DATA',
    dateObs: '2026-09-04T21:51:11Z',
    expTime: 30,
    stackCnt: 44,
    captureDetails: { ccdTemp: 9.9 },
    fitsHeaders: [{ key: 'EXPTIME', value: '30.' }],
  };

  it('still gives its capture data and header cards, without placing the item', () => {
    const item = makeItem({ status: 'pending' });
    expect(applyWcsResultToItem(item, unsolved, 100, 100).applied).toBe(false);
    expect(item.status).toBe('pending');
    expect(item.solveCorrespondences).toBeNull();
    expect(item.observationDate).toBe('2026-09-04T21:51:11Z');
    expect(item.integrations).toEqual([{ frames: 44, seconds: 30, filter: '' }]);
    expect(item.captureDetails).toEqual({ ccdTemp: 9.9 });
    expect(item.fitsHeaders).toEqual([{ key: 'EXPTIME', value: '30.' }]);
  });

  it('keeps what the user entered and takes the suggested setup only when there is none', () => {
    const item = makeItem({
      observationDate: '2020-01-01T00:00:00Z',
      integrations: [{ frames: 1, seconds: 1, filter: 'L' }],
      gearSetupId: 'mine',
    });
    applyWcsMetadataToItem(item, unsolved, 's30');
    expect(item.observationDate).toBe('2020-01-01T00:00:00Z');
    expect(item.integrations).toEqual([{ frames: 1, seconds: 1, filter: 'L' }]);
    expect(item.gearSetupId).toBe('mine');
    const bare = makeItem();
    applyWcsMetadataToItem(bare, unsolved, 's30');
    expect(bare.gearSetupId).toBe('s30');
  });
});
