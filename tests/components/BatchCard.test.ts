import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reactive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import BatchCard from '../../src/components/modals/BatchCard.vue';
import type { BatchItem } from '../../src/batch-types';
import type { SolverAvailability } from '../../src/api';
import { generateThumbnail } from '../../src/lazy-image';
import { noSolutionMessage } from '@myastrosky/app-state/wcs-load-flow';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../src/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../src/toast', () => ({ showToast: vi.fn() }));
vi.mock('@myastrosky/core/search', () => ({ searchUnified: vi.fn().mockResolvedValue([]) }));
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
  getGearSetups: vi.fn().mockResolvedValue([]),
}));

// The WCS reading flow is shared and calls the package's data functions.
vi.mock('@myastrosky/app-state/api', () => ({
  solveWCS: (...args: unknown[]) => mockSolveWCS(...args),
  getGearSetups: vi.fn().mockResolvedValue([]),
}));

const mockConfirmWarnings = vi.fn();
const mockShowFitsHeaders = vi.fn();
vi.mock('../../src/wcs-dialogs', () => ({
  confirmWcsWarnings: (...args: unknown[]) => mockConfirmWarnings(...args),
  showFitsHeaders: (...args: unknown[]) => mockShowFitsHeaders(...args),
}));

const mockFindDSOIds = vi.fn();
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  findDSOIdsFromCorrespondences: (...args: unknown[]) => mockFindDSOIds(...args),
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
    rawName: null,
    convertProgress: 0,
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
  const input = wrapper.find<HTMLInputElement>('input[accept=".fit,.fits,.tif,.tiff,.xisf"]');
  Object.defineProperty(input.element, 'files', {
    get: () => [wcsFile],
    configurable: true,
  });
  await input.trigger('change');
  // Flush all microtasks (two promise hops: getFileDimensions + solveWCS)
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(generateThumbnail).mockClear();
  mockSolveWCS.mockReset();
  mockGetFileDimensions.mockReset();
  mockFindDSOIds.mockReset();
  mockFindDSOIds.mockReturnValue([]);
  // Default: photo is 1920×1080
  mockGetFileDimensions.mockResolvedValue({ width: 1920, height: 1080 });
  // Default: successful WCS parse with one correspondence
  mockSolveWCS.mockResolvedValue({
    success: true,
    correspondences: [{ pointIndex: 0, photoX: 100, photoY: 100, starHip: 1 }],
    dsoIds: [],
  });

  // IntersectionObserver is not available in happy-dom: report every card as on screen,
  // as a browser does for the cards of a freshly opened window.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.callback([{ isIntersecting: true }]);
      }
      disconnect() {}
    },
  );
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

  it('asks before taking a file whose proportions differ, and takes nothing when cancelled', async () => {
    const mismatch = {
      success: true,
      correspondences: [{ pointIndex: 0, photoX: 100, photoY: 100, starHip: 1 }],
      dsoIds: [],
      dateObs: '2026-03-17T20:38:44Z',
      dimensionWarning: {
        sourceW: 4000,
        sourceH: 4000,
        targetW: 1920,
        targetH: 1080,
        aspectMismatch: true,
      },
    };
    mockSolveWCS.mockResolvedValue(mismatch);

    mockConfirmWarnings.mockResolvedValueOnce(false);
    const cancelled = makeItem();
    const w1 = mountCard(cancelled);
    await triggerWcsChange(w1, new File([''], 'M42.fits'));
    expect(mockConfirmWarnings).toHaveBeenCalledWith('M42.fits', [expect.any(String)]);
    expect(cancelled.status).not.toBe('success');
    expect(cancelled.observationDate).toBe('');
    w1.unmount();

    mockConfirmWarnings.mockResolvedValueOnce(true);
    const taken = makeItem();
    const w2 = mountCard(taken);
    await triggerWcsChange(w2, new File([''], 'M42.fits'));
    expect(taken.status).toBe('success');
    expect(w2.find('.batch-wcs-btn.wcs-warning').exists()).toBe(true);
    w2.unmount();
  });

  it('takes the capture data of a file that is not plate-solved, says so, and shows its headers', async () => {
    const cards = [{ key: 'EXPTIME', value: '30.' }];
    mockSolveWCS.mockResolvedValue({
      success: false,
      code: 'NO_WCS_DATA',
      expTime: 30,
      stackCnt: 44,
      fitsHeaders: cards,
    });
    const item = makeItem();
    const wrapper = mountCard(item);
    await triggerWcsChange(wrapper, new File([''], 'M2.fit'));
    expect(item.status).not.toBe('success');
    expect(item.integrations).toEqual([{ frames: 44, seconds: 30, filter: '' }]);
    expect(item.wcsNotice).toBe(noSolutionMessage('M2.fit'));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.batch-status-upload-error').text()).toBe(noSolutionMessage('M2.fit'));
    await wrapper.find('[data-test=fits-headers-btn]').trigger('click');
    expect(mockShowFitsHeaders).toHaveBeenCalledWith(cards);
    wrapper.unmount();
  });

  it('derives DSOs from correspondences when the WCS server returns none', async () => {
    // The /api/solve-wcs route never populates dsoIds, so the card must fall back
    // to matching the solved correspondences against the local catalog.
    const correspondences = [
      {
        pointIndex: 0,
        photoX: 100,
        photoY: 100,
        starHip: 0,
        starName: 's0',
        starRa: 210,
        starDec: 54,
      },
    ];
    mockSolveWCS.mockResolvedValue({ success: true, correspondences, dsoIds: [] });
    mockFindDSOIds.mockReturnValue(['M101', 'NGC5474']);

    const item = makeItem();
    const wrapper = mountCard(item);
    await triggerWcsChange(wrapper, new File([''], 'M101.fits'));

    expect(mockFindDSOIds).toHaveBeenCalledWith(correspondences, 1920, 1080);
    expect(item.dsoIds).toEqual(['M101', 'NGC5474']);
    wrapper.unmount();
  });

  it('prefers server-provided dsoIds over the correspondence fallback', async () => {
    mockSolveWCS.mockResolvedValue({
      success: true,
      correspondences: [{ pointIndex: 0, photoX: 100, photoY: 100, starHip: 1 }],
      dsoIds: ['M42'],
    });

    const item = makeItem();
    const wrapper = mountCard(item);
    await triggerWcsChange(wrapper, new File([''], 'M42.fits'));

    expect(item.dsoIds).toEqual(['M42']);
    expect(mockFindDSOIds).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('pre-fills the observation date from the WCS DATE-OBS', async () => {
    mockSolveWCS.mockResolvedValue({
      success: true,
      correspondences: [{ pointIndex: 0, photoX: 100, photoY: 100, starHip: 1 }],
      dsoIds: [],
      dateObs: '2026-01-01T00:00:00Z',
    });

    const item = makeItem();
    const wrapper = mountCard(item);
    await triggerWcsChange(wrapper, new File([''], 'M101.fits'));

    expect(item.observationDate).toBe('2026-01-01T00:00:00Z');
    wrapper.unmount();
  });

  it('does not overwrite an observation date the user already set', async () => {
    mockSolveWCS.mockResolvedValue({
      success: true,
      correspondences: [{ pointIndex: 0, photoX: 100, photoY: 100, starHip: 1 }],
      dsoIds: [],
      dateObs: '2026-01-01T00:00:00Z',
    });

    const item = makeItem({ observationDate: '2025-05-05T22:00:00Z' });
    const wrapper = mountCard(item);
    await triggerWcsChange(wrapper, new File([''], 'M101.fits'));

    expect(item.observationDate).toBe('2025-05-05T22:00:00Z');
    wrapper.unmount();
  });

  it('does not show a dimension warning when aspect ratios match', async () => {
    const { showToast } = await import('../../src/toast');
    (showToast as ReturnType<typeof vi.fn>).mockClear();
    mockSolveWCS.mockResolvedValue({
      success: true,
      correspondences: [{ pointIndex: 0, photoX: 100, photoY: 100, starHip: 1 }],
      dsoIds: [],
      dimensionWarning: {
        sourceW: 4000,
        sourceH: 3000,
        targetW: 1920,
        targetH: 1080,
        aspectMismatch: false,
      },
    });

    const item = makeItem();
    const wrapper = mountCard(item);
    await triggerWcsChange(wrapper, new File([''], 'M42.fits'));

    expect(showToast).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe('BatchCard — controls locked while solving', () => {
  const allAvailable: SolverAvailability = { solveField: true, astap: true, astrometry: true };

  function mountWithStatus(status: BatchItem['status']) {
    return mount(BatchCard, {
      props: {
        item: makeItem({ status }),
        solverAvailability: allAvailable,
        knownFilterMap: new Map(),
      },
      global: { stubs: { BatchSolveStatus: true, MetadataEditorPanel: true } },
      attachTo: document.body,
    });
  }

  it('disables the solver dropdown and the WCS/manual buttons while solving', () => {
    const wrapper = mountWithStatus('solving');

    expect(wrapper.find('.batch-solver-select').attributes('disabled')).toBeDefined();
    // Two .batch-wcs-btn buttons: WCS (first) and Manual (second).
    const actionBtns = wrapper.findAll('.batch-wcs-btn');
    expect(actionBtns).toHaveLength(2);
    expect(actionBtns[0].attributes('disabled')).toBeDefined();
    expect(actionBtns[1].attributes('disabled')).toBeDefined();
    // The reuse-online button is locked too.
    expect(wrapper.find('.batch-reuse-btn').attributes('disabled')).toBeDefined();

    wrapper.unmount();
  });

  it('leaves the controls enabled when the item is pending', () => {
    const wrapper = mountWithStatus('pending');

    expect(wrapper.find('.batch-solver-select').attributes('disabled')).toBeUndefined();
    const actionBtns = wrapper.findAll('.batch-wcs-btn');
    expect(actionBtns[0].attributes('disabled')).toBeUndefined();
    expect(actionBtns[1].attributes('disabled')).toBeUndefined();

    wrapper.unmount();
  });

  it('disables the solver dropdown and the WCS/manual buttons while converting a raw file', () => {
    const wrapper = mountWithStatus('converting');

    expect(wrapper.find('.batch-solver-select').attributes('disabled')).toBeDefined();
    const actionBtns = wrapper.findAll('.batch-wcs-btn');
    expect(actionBtns[0].attributes('disabled')).toBeDefined();
    expect(actionBtns[1].attributes('disabled')).toBeDefined();

    wrapper.unmount();
  });
});

describe('BatchCard — raw conversion progress', () => {
  const allAvailable: SolverAvailability = { solveField: true, astap: true, astrometry: true };

  it('shows an upload-percentage placeholder while converting, then a decode message', () => {
    // reactive(): the production code mounts BatchCard against a reactive item too
    // (BatchUploadModal's `items` array), so mutating a field after mount must re-render.
    const item = reactive(
      makeItem({
        status: 'converting',
        rawName: 'M101.fit',
        convertProgress: 0.4,
        file: new File(['raw'], 'M101.fit'),
      }),
    );
    const wrapper = mount(BatchCard, {
      props: { item, solverAvailability: allAvailable, knownFilterMap: new Map() },
      global: { stubs: { BatchSolveStatus: true, MetadataEditorPanel: true } },
      attachTo: document.body,
    });

    expect(wrapper.find('.batch-item-thumb-placeholder').text()).toBe('batch.convertingUpload');
    expect(wrapper.find('.batch-item-thumb').exists()).toBe(false);

    item.convertProgress = 1;
    return wrapper.vm.$nextTick().then(() => {
      expect(wrapper.find('.batch-item-thumb-placeholder').text()).toBe('batch.convertingDecode');
      wrapper.unmount();
    });
  });

  it('regenerates the thumbnail once the raw file is swapped for the converted PNG', async () => {
    const rawFile = new File(['raw'], 'M101.fit');
    const item = reactive(makeItem({ status: 'converting', rawName: 'M101.fit', file: rawFile }));
    const wrapper = mount(BatchCard, {
      props: { item, solverAvailability: allAvailable, knownFilterMap: new Map() },
      global: { stubs: { BatchSolveStatus: true, MetadataEditorPanel: true } },
      attachTo: document.body,
    });
    await flushPromises();

    // While converting, the lazy-thumbnail observer must never touch the raw file.
    expect(generateThumbnail).not.toHaveBeenCalled();

    const pngFile = new File(['png'], 'M101.png', { type: 'image/png' });
    item.file = pngFile;
    item.status = 'success';
    await wrapper.vm.$nextTick();
    await flushPromises();

    expect(generateThumbnail).toHaveBeenCalledWith(pngFile, 240);
    wrapper.unmount();
  });

  // Regression (came back several times): the modal swaps in the PNG, awaits the setup
  // suggested by the header, and only then changes the status. The preview must show up
  // whatever the order and however long the gap between the two.
  it.each([
    ['the file first, the status after a wait', ['file', 'wait', 'status']],
    ['the status first, the file after a wait', ['status', 'wait', 'file']],
  ])('makes the preview of a converted raw photo with %s', async (_label, steps) => {
    vi.mocked(generateThumbnail).mockResolvedValue('blob:preview');
    const rawFile = new File(['raw'], 'M101.fit');
    const item = reactive(makeItem({ status: 'converting', rawName: 'M101.fit', file: rawFile }));
    const wrapper = mount(BatchCard, {
      props: { item, solverAvailability: allAvailable, knownFilterMap: new Map() },
      global: { stubs: { BatchSolveStatus: true, MetadataEditorPanel: true } },
      attachTo: document.body,
    });
    await flushPromises();
    const pngFile = new File(['png'], 'M101.png', { type: 'image/png' });

    for (const step of steps) {
      if (step === 'file') item.file = pngFile;
      else if (step === 'status') item.status = 'pending';
      await flushPromises(); // the watchers run here, between the two changes
    }

    expect(generateThumbnail).toHaveBeenCalledTimes(1);
    expect(generateThumbnail).toHaveBeenCalledWith(pngFile, 240);
    expect(wrapper.find('img.batch-item-thumb').attributes('src')).toBe('blob:preview');
    wrapper.unmount();
    vi.mocked(generateThumbnail).mockResolvedValue('');
  });

  it('never tries to make a preview from a raw file whose conversion failed', async () => {
    const item = reactive(
      makeItem({ status: 'failed', rawName: 'M101.fit', file: new File(['raw'], 'M101.fit') }),
    );
    const wrapper = mount(BatchCard, {
      props: { item, solverAvailability: allAvailable, knownFilterMap: new Map() },
      global: { stubs: { BatchSolveStatus: true, MetadataEditorPanel: true } },
      attachTo: document.body,
    });
    await flushPromises();
    expect(generateThumbnail).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
