import { describe, it, expect, vi } from 'vitest';
import { onlineSolveOf, saveBatchItem, type BatchSaveApi } from '../../src/batch-place';
import type { Photo } from '@myastrosky/core/types';
import { makeItem } from '../helpers/batch-item';

const CORR = [
  { pointIndex: 0, photoX: 1, photoY: 1, starHip: 1, starName: '' },
  { pointIndex: 1, photoX: 9, photoY: 9, starHip: 2, starName: '' },
];

function stored(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'photo-1',
    filename: 'photo-1.jpg',
    originalName: 'test',
    width: 100,
    height: 80,
    createdAt: '',
    correspondences: [],
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    notes: '',
    ...overrides,
  };
}

function fakeApi(): BatchSaveApi & { [k: string]: ReturnType<typeof vi.fn> } {
  return {
    // As the server: the photo comes back with the online solve sent with it.
    upload: vi.fn(async (_f, correspondences, _m, _p, metadata) =>
      stored({
        correspondences,
        ...(metadata?.onlineSolve ? { onlineSolve: metadata.onlineSolve } : {}),
      }),
    ),
    updateMetadata: vi.fn(async () => undefined),
    setPlacement: vi.fn(async (_id, p) => stored({ correspondences: p.correspondences ?? [] })),
    setOnlineSolve: vi.fn(async () => undefined),
    saveFitsHeaders: vi.fn(async () => undefined),
  } as never;
}

const placedItem = () =>
  makeItem({
    status: 'success',
    placedBy: 'local',
    solveCorrespondences: CORR,
    customName: 'Orion',
    labels: ['hiver'],
  });

describe('saveBatchItem', () => {
  it('stores a placed photo with its placement and metadata, and the window keeps it as saved', async () => {
    const api = fakeApi();
    const item = placedItem();
    const photo = await saveBatchItem(item, api);
    expect(api.upload).toHaveBeenCalledWith(
      item.file,
      CORR,
      undefined,
      undefined,
      expect.objectContaining({ displayName: 'Orion', labels: ['hiver'] }),
    );
    expect(item).toMatchObject({ saveState: 'saved', placementSaved: true, photo });
  });

  it('stores a photo dragged into place with its manual placement', async () => {
    const api = fakeApi();
    const placement = {
      centerRa: 83.8,
      centerDec: -5.4,
      rotationDeg: 10,
      projPerPx: 0.001,
      mirrorX: false,
      mirrorY: false,
    };
    const item = makeItem({
      status: 'success',
      placedBy: 'hand',
      solveCorrespondences: CORR,
      manualPlacement: placement,
    });
    await saveBatchItem(item, api);
    expect(api.upload.mock.calls[0][2]).toEqual(placement);
  });

  it('stores a photo not placed without a placement ("À résoudre")', async () => {
    const api = fakeApi();
    const item = makeItem();
    await saveBatchItem(item, api);
    expect(api.upload.mock.calls[0][1]).toEqual([]);
    expect(api.upload.mock.calls[0][2]).toBeUndefined();
    expect(api.upload.mock.calls[0][4]).not.toHaveProperty('onlineSolve');
    expect(api.setOnlineSolve).not.toHaveBeenCalled();
    expect(item.placementSaved).toBe(false);
  });

  it('stores the astrometry.net solve with a photo saved while astrometry.net has not finished, in the same request', async () => {
    const api = fakeApi();
    const item = makeItem({
      status: 'unfinished',
      online: { submissionId: 42, sentAt: '2026-11-15T21:42:00.000Z', fits: true },
    });
    const photo = await saveBatchItem(item, api);
    const solve = {
      state: 'unfinished',
      submissionId: 42,
      sentAt: '2026-11-15T21:42:00.000Z',
      fits: true,
    };
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.upload.mock.calls[0][4]).toMatchObject({ onlineSolve: solve });
    // No second request: a photo is never stored without its solve.
    expect(api.setOnlineSolve).not.toHaveBeenCalled();
    expect(photo.onlineSolve).toEqual(solve);
  });

  it('saves a changed photo again: its metadata, and its placement when it was placed since', async () => {
    const api = fakeApi();
    const item = placedItem();
    item.photo = stored({ originalName: 'Orion' });
    item.saveState = 'modified';
    item.placementSaved = false;
    await saveBatchItem(item, api);
    expect(api.upload).not.toHaveBeenCalled();
    expect(api.updateMetadata).toHaveBeenCalledWith(
      'photo-1',
      expect.objectContaining({ labels: ['hiver'], originalName: 'Orion' }),
    );
    expect(api.setPlacement).toHaveBeenCalledWith('photo-1', {
      correspondences: CORR,
      manualPlacement: null,
    });
    expect(item).toMatchObject({ saveState: 'saved', placementSaved: true });
    expect(item.photo!.correspondences).toEqual(CORR);
  });

  it('does not send the placement again when only the metadata changed', async () => {
    const api = fakeApi();
    const item = placedItem();
    item.photo = stored({ correspondences: CORR });
    item.saveState = 'modified';
    item.placementSaved = true;
    await saveBatchItem(item, api);
    expect(api.setPlacement).not.toHaveBeenCalled();
  });

  it('keeps the state and the reason when saving fails', async () => {
    const api = fakeApi();
    api.upload.mockRejectedValue(new Error('disk full'));
    const item = placedItem();
    await expect(saveBatchItem(item, api)).rejects.toThrow('disk full');
    expect(item).toMatchObject({ saveState: 'new', saveError: 'disk full', photo: null });
  });
});

describe('onlineSolveOf', () => {
  it('only for a photo not placed whose solve runs or waits on astrometry.net', () => {
    const online = { submissionId: 1, sentAt: 'x', fits: false };
    expect(onlineSolveOf(makeItem({ status: 'unfinished', online }))).toMatchObject({
      state: 'unfinished',
    });
    expect(onlineSolveOf(makeItem({ status: 'solving', online }))).toMatchObject({
      state: 'solving',
    });
    expect(onlineSolveOf(makeItem({ status: 'failed', online }))).toBeNull();
    expect(
      onlineSolveOf(makeItem({ status: 'unfinished', online: { sentAt: 'x', fits: false } })),
    ).toBeNull();
    expect(onlineSolveOf(makeItem({ status: 'success', online }))).toBeNull();
  });
});
