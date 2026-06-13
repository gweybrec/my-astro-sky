import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import BatchCard from '../../src/components/modals/BatchCard.vue';
import type { BatchItem } from '../../src/batch-types';
import type { SolverAvailability } from '../../src/api';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../src/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../src/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../src/search', () => ({ searchUnified: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/lazy-image', () => ({ generateThumbnail: vi.fn().mockResolvedValue('') }));
vi.mock('../../src/batch-utils', () => ({ sanitizeIntegrationRows: (rows: unknown) => rows }));
vi.mock('../../src/stores/canvas', () => ({ useCanvasStore: vi.fn(() => ({ overlay: null })) }));
vi.mock('../../src/icons/trash.svg?raw', () => ({ default: '<svg/>' }));

const mockSolveWCS = vi.fn();
const mockGetFileDimensions = vi.fn();

vi.mock('../../src/api', () => ({
  solveWCS: (...args: unknown[]) => mockSolveWCS(...args),
  reuseAstrometrySubmission: vi.fn(),
  updatePhotoMetadata: vi.fn(),
}));

vi.mock('../../src/file-utils', () => ({
  stripExtension: (s: string) => s.replace(/\.[^.]+$/, ''),
  getFileDimensions: (...args: unknown[]) => mockGetFileDimensions(...args),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const solverAvailability: SolverAvailability = {
  solveField: false,
  astap: false,
  astrometry: false,
};

function makeItem(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    id: 'item-1',
    file: new File(['jpeg-data'], 'M42.jpg', { type: 'image/jpeg' }),
    thumbBlobUrl: null,
    solver: 'solve-field',
    hintCoords: null,
    hintTargetName: '',
    fovDeg: null,
    wcsResult: null,
    solveCorrespondences: null,
    status: 'pending',
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

function mountCard(item: BatchItem) {
  return mount(BatchCard, {
    props: { item, solverAvailability, knownFilterMap: new Map() },
    global: {
      stubs: { BatchSolveStatus: true, MetadataEditorPanel: true },
    },
    attachTo: document.body,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function triggerWcsChange(wrapper: ReturnType<typeof mountCard>, wcsFile: File) {
  const input = wrapper.find<HTMLInputElement>('input[accept=".fit,.fits,.tif,.tiff"]');
  Object.defineProperty(input.element, 'files', {
    get: () => [wcsFile],
    configurable: true,
  });
  await input.trigger('change');
  // Flush all microtasks (two promise hops: getFileDimensions + solveWCS)
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockSolveWCS.mockReset();
  mockGetFileDimensions.mockReset();
  // Default: photo is 1920×1080
  mockGetFileDimensions.mockResolvedValue({ width: 1920, height: 1080 });
  // Default: successful WCS parse with one correspondence
  mockSolveWCS.mockResolvedValue({
    success: true,
    correspondences: [{ pointIndex: 0, photoX: 100, photoY: 100, starHip: 1 }],
    dsoIds: [],
  });

  // IntersectionObserver is not available in happy-dom
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BatchCard — open WCS file', () => {
  it('passes the photo image dimensions to solveWCS', async () => {
    const item = makeItem();
    const wrapper = mountCard(item);
    const wcsFile = new File(['fits-data'], 'M42.fits');

    await triggerWcsChange(wrapper, wcsFile);

    expect(mockGetFileDimensions).toHaveBeenCalledWith(item.file);
    expect(mockSolveWCS).toHaveBeenCalledWith(wcsFile, 1920, 1080);
    wrapper.unmount();
  });

  it('passes undefined dimensions when getFileDimensions returns zero (unreadable image)', async () => {
    mockGetFileDimensions.mockResolvedValue({ width: 0, height: 0 });
    const item = makeItem();
    const wrapper = mountCard(item);
    const wcsFile = new File(['fits-data'], 'M42.fits');

    await triggerWcsChange(wrapper, wcsFile);

    expect(mockSolveWCS).toHaveBeenCalledWith(wcsFile, undefined, undefined);
    wrapper.unmount();
  });

  it('marks the item as success and sets wcsLoaded when the WCS parse succeeds', async () => {
    const item = makeItem();
    const wrapper = mountCard(item);

    await triggerWcsChange(wrapper, new File([''], 'M42.fits'));

    expect(item.status).toBe('success');
    expect(item.solveCorrespondences).not.toBeNull();
    wrapper.unmount();
  });

  it('shows a toast warning when the server reports an aspect-ratio mismatch', async () => {
    const { showToast } = await import('../../src/toast');
    mockSolveWCS.mockResolvedValue({
      success: true,
      correspondences: [{ pointIndex: 0, photoX: 100, photoY: 100, starHip: 1 }],
      dsoIds: [],
      dimensionWarning: { sourceW: 4000, sourceH: 3000, targetW: 1920, targetH: 1080, aspectMismatch: true },
    });

    const item = makeItem();
    const wrapper = mountCard(item);
    await triggerWcsChange(wrapper, new File([''], 'M42.fits'));

    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    wrapper.unmount();
  });

  it('does not show a dimension warning when aspect ratios match', async () => {
    const { showToast } = await import('../../src/toast');
    (showToast as ReturnType<typeof vi.fn>).mockClear();
    mockSolveWCS.mockResolvedValue({
      success: true,
      correspondences: [{ pointIndex: 0, photoX: 100, photoY: 100, starHip: 1 }],
      dsoIds: [],
      dimensionWarning: { sourceW: 4000, sourceH: 3000, targetW: 1920, targetH: 1080, aspectMismatch: false },
    });

    const item = makeItem();
    const wrapper = mountCard(item);
    await triggerWcsChange(wrapper, new File([''], 'M42.fits'));

    expect(showToast).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
