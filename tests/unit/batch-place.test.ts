import { describe, it, expect, vi } from 'vitest';
import { placeBatchItem } from '../../src/batch-place';
import type { BatchItem } from '../../src/batch-types';
import type { Photo } from '../../src/types';

const t = (key: string) => key;

const fakePhoto: Photo = {
  id: 'photo-1',
  filename: 'uploads/photo-1.jpg',
  originalName: 'test.jpg',
  width: 1000,
  height: 800,
  correspondences: [],
  thumbnailFilename: 'uploads/photo-1-thumb.jpg',
  labels: [],
} as any;

function makeItem(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    id: 'item-1',
    file: new File([''], 'test.jpg', { type: 'image/jpeg' }),
    thumbBlobUrl: null,
    solver: 'solve-field',
    hintCoords: null,
    hintTargetName: '',
    fovDeg: null,
    wcsResult: null,
    solveCorrespondences: [{ pointIndex: 0, photoX: 100, photoY: 100, starHip: 1 } as any],
    status: 'success',
    photo: null,
    error: '',
    dsoIds: [],
    labels: [],
    integrations: [],
    observationDate: '',
    notes: '',
    customName: '',
    elapsedSeconds: 0,
    solveTimer: null,
    pollingTimer: null,
    solveAbort: null,
    metaOpen: false,
    ...overrides,
  };
}

describe('placeBatchItem — state transitions', () => {
  it('transitions success → placing → placed on successful upload', async () => {
    const item = makeItem();
    const onPlaced = vi.fn();
    const uploadFn = vi.fn().mockResolvedValue(fakePhoto);

    await placeBatchItem(item, [], uploadFn as any, onPlaced, t);

    expect(item.status).toBe('placed');
    expect(item.photo).toBe(fakePhoto);
    expect(onPlaced).toHaveBeenCalledWith(fakePhoto);
    expect(item.uploadError).toBeUndefined();
  });

  it('transitions success → placing → success (with uploadError) on failure', async () => {
    const item = makeItem();
    const onPlaced = vi.fn();
    const uploadFn = vi.fn().mockRejectedValue(new Error('Server error'));

    await placeBatchItem(item, [], uploadFn as any, onPlaced, t);

    expect(item.status).toBe('success');
    expect(item.photo).toBeNull();
    expect(item.uploadError).toBe('Server error');
    expect(onPlaced).not.toHaveBeenCalled();
  });

  it('sets status to placing synchronously before the upload resolves', async () => {
    const item = makeItem();
    let observedStatus = '';
    const uploadFn = () =>
      new Promise<Photo>(resolve => {
        observedStatus = item.status;
        setTimeout(() => resolve(fakePhoto), 0);
      });

    await placeBatchItem(item, [], uploadFn as any, vi.fn(), t);

    expect(observedStatus).toBe('placing');
    expect(item.status).toBe('placed');
  });

  it('clears a previous uploadError before uploading', async () => {
    const item = makeItem({ uploadError: 'Previous error' } as any);
    const uploadFn = vi.fn().mockResolvedValue(fakePhoto);

    await placeBatchItem(item, [], uploadFn as any, vi.fn(), t);

    expect(item.uploadError).toBeUndefined();
    expect(item.status).toBe('placed');
  });

  it('merges batchLabels with item.labels (deduped)', async () => {
    const item = makeItem({ labels: ['A', 'B'] });
    let capturedLabels: string[] = [];
    const uploadFn = vi.fn().mockImplementation((_file, _corr, _mp, _prog, meta) => {
      capturedLabels = meta?.labels ?? [];
      return Promise.resolve(fakePhoto);
    });

    await placeBatchItem(item, ['B', 'C'], uploadFn as any, vi.fn(), t);

    expect(capturedLabels).toContain('A');
    expect(capturedLabels).toContain('B');
    expect(capturedLabels).toContain('C');
    expect(capturedLabels.filter(l => l === 'B').length).toBe(1);
  });

  it('does not call onPlaced on failure', async () => {
    const item = makeItem();
    const onPlaced = vi.fn();
    const uploadFn = vi.fn().mockRejectedValue(new Error('Network error'));

    await placeBatchItem(item, [], uploadFn as any, onPlaced, t);

    expect(onPlaced).not.toHaveBeenCalled();
  });

  it('uses t() fallback message when error has no message', async () => {
    const item = makeItem();
    const uploadFn = vi.fn().mockRejectedValue({});

    await placeBatchItem(item, [], uploadFn as any, vi.fn(), t);

    expect(item.uploadError).toBe('batch.statusFailed');
  });
});
