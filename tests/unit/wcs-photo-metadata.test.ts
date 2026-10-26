import { describe, it, expect, vi } from 'vitest';
import type { PlateSolveResult } from '@myastrosky/core/types';

const findDsoIds = vi.fn(() => ['M1']);
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  findDSOIdsFromCorrespondences: (...args: unknown[]) => findDsoIds(...args),
}));

const { wcsPhotoMetadata } = await import('@myastrosky/core/wcs-photo-metadata');

const corr = [{ pointIndex: 0, photoX: 1, photoY: 2, starHip: 0, starName: '' }];
const solved = (extra: Partial<PlateSolveResult> = {}): PlateSolveResult => ({
  success: true,
  correspondences: corr,
  ...extra,
});

describe('wcsPhotoMetadata', () => {
  it('is null without a successful result with correspondences', () => {
    expect(wcsPhotoMetadata({ success: false }, 10, 10)).toBeNull();
    expect(wcsPhotoMetadata(solved({ correspondences: [] }), 10, 10)).toBeNull();
  });

  it('takes the objects from the catalog when the solver gave none, and from the solver otherwise', () => {
    expect(wcsPhotoMetadata(solved(), 100, 80)?.dsoIds).toEqual(['M1']);
    expect(findDsoIds).toHaveBeenCalledWith(corr, 100, 80);
    expect(wcsPhotoMetadata(solved({ dsoIds: ['M2'] }), 100, 80)?.dsoIds).toEqual(['M2']);
  });

  it('reads the date, the exposure row and the capture details from the header', () => {
    const meta = wcsPhotoMetadata(
      solved({
        dateObs: '2025-09-14T21:00:00',
        expTime: 10.4,
        stackCnt: 120.2,
        filter: 'L',
        captureDetails: { gain: '100' },
      }),
      10,
      10,
    );
    expect(meta).toEqual({
      dsoIds: ['M1'],
      observationDate: '2025-09-14T21:00:00',
      integrations: [{ frames: 120, seconds: 10, filter: 'L' }],
      captureDetails: { gain: '100' },
    });
  });

  it('has no exposure row without both the exposure time and the frame count', () => {
    expect(wcsPhotoMetadata(solved({ expTime: 10 }), 10, 10)?.integrations).toEqual([]);
  });
});
