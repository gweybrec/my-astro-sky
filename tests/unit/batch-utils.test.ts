import { describe, it, expect } from 'vitest';
import { clearWcsSolution, sanitizeIntegrationRows } from '../../src/batch-utils';
import type { BatchItem } from '../../src/batch-types';

function makeItem(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    id: 'item-1',
    file: new File([''], 'test.jpg', { type: 'image/jpeg' }),
    thumbBlobUrl: null,
    solver: 'solve-field',
    hintCoords: null,
    hintTargetName: '',
    fovDeg: null,
    wcsResult: { success: true } as any,
    solveCorrespondences: [{ pointIndex: 0, photoX: 100, photoY: 100, starHip: 1 } as any],
    status: 'success',
    photo: null,
    error: '',
    dsoIds: ['M31'],
    labels: ['galaxy'],
    integrations: [{ frames: 10, seconds: 60, filter: 'L' }],
    observationDate: '2024-01-01T00:00:00.000Z',
    notes: 'my notes',
    customName: 'Andromeda',
    elapsedSeconds: 0,
    localJobId: null,
    solveTimer: null,
    pollingTimer: null,
    solveAbort: null,
    metaOpen: false,
    ...overrides,
  };
}

describe('clearWcsSolution', () => {
  it('drops the solution and WCS-prefilled metadata', () => {
    const item = makeItem();
    clearWcsSolution(item);
    expect(item.wcsResult).toBeNull();
    expect(item.solveCorrespondences).toBeNull();
    expect(item.dsoIds).toEqual([]);
    expect(item.integrations).toEqual([]);
    expect(item.observationDate).toBe('');
  });

  it('resets status success → pending (subtracts from solved count)', () => {
    const item = makeItem({ status: 'success' });
    clearWcsSolution(item);
    expect(item.status).toBe('pending');
  });

  it('resets status wcs-ready → pending', () => {
    const item = makeItem({ status: 'wcs-ready' });
    clearWcsSolution(item);
    expect(item.status).toBe('pending');
  });

  it('leaves placed / placing status untouched', () => {
    const placed = makeItem({ status: 'placed' });
    clearWcsSolution(placed);
    expect(placed.status).toBe('placed');

    const placing = makeItem({ status: 'placing' });
    clearWcsSolution(placing);
    expect(placing.status).toBe('placing');
  });

  it('leaves non-WCS fields untouched', () => {
    const file = new File([''], 'keep.jpg', { type: 'image/jpeg' });
    const item = makeItem({ file, labels: ['galaxy'], customName: 'Andromeda', notes: 'my notes' });
    clearWcsSolution(item);
    expect(item.labels).toEqual(['galaxy']);
    expect(item.customName).toBe('Andromeda');
    expect(item.notes).toBe('my notes');
    expect(item.file).toBe(file);
  });
});

describe('sanitizeIntegrationRows', () => {
  it('trims filters and keeps valid frames/seconds', () => {
    const rows = sanitizeIntegrationRows([{ frames: 10, seconds: 60, filter: '  L  ' }]);
    expect(rows).toEqual([{ frames: 10, seconds: 60, filter: 'L' }]);
  });

  it('coerces invalid / negative / non-integer numbers to 0', () => {
    const rows = sanitizeIntegrationRows([
      { frames: -5, seconds: 1.5, filter: 'R' } as any,
      { frames: NaN, seconds: -1, filter: 'G' } as any,
    ]);
    expect(rows).toEqual([
      { frames: 0, seconds: 0, filter: 'R' },
      { frames: 0, seconds: 0, filter: 'G' },
    ]);
  });
});
