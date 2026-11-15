import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import BatchUploadModal from '../../src/components/modals/BatchUploadModal.vue';
import type { BatchItem } from '../../src/batch-types';
import type { Photo } from '@myastrosky/core/types';

// ─── Shared mutable state for the mocks ─────────────────────────────────────────
const state = vi.hoisted(() => ({
  pendingFiles: [] as File[],
  pendingPhotos: null as unknown[] | null,
  maxParallel: '2',
  availability: { solveField: true, astap: true, astrometry: true },
  jobSeq: 0,
  pollResponder: (_jobId: string) => ({
    status: 'running' as string,
    result: undefined as unknown,
  }),
  finishChoice: 'back' as 'back' | 'discard' | 'save',
}));

// ─── Module mocks ───────────────────────────────────────────────────────────────
// A text shows its key, then its parameters: "batch.solveMany|3".
vi.mock('../../src/i18n', () => ({
  t: (key: string, params?: Record<string, string>) =>
    params ? `${key}|${Object.values(params).join(',')}` : key,
}));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../../src/toast', () => ({ showToast }));
vi.mock('../../src/error-reporter', () => ({ reportUnknownRendererError: vi.fn() }));
vi.mock('../../src/dso-catalog', () => ({ findDSOIdsFromCorrespondences: () => [] }));
vi.mock('@myastrosky/core/catalog/dso-registry', () => ({
  findDSOIdsFromCorrespondences: () => [],
}));
vi.mock('../../src/file-utils', () => ({
  stripExtension: (s: string) => s.replace(/\.[^.]+$/, ''),
}));
vi.mock('../../src/icons/add-photo.svg?raw', () => ({ default: '<svg/>' }));
const confirmFinishBatch = vi.hoisted(() => vi.fn(async () => state.finishChoice));
vi.mock('../../src/photo-delete-confirm', () => ({ confirmFinishBatch }));

const overlay = vi.hoisted(() => ({
  getPlacedPhotos: () => [],
  placeUploadedPhoto: vi.fn(),
  updatePhotoData: vi.fn(),
}));
vi.mock('../../src/stores/canvas', () => ({
  useCanvasStore: () => ({ overlay, gallery: { loadPhotos: vi.fn() } }),
}));
vi.mock('../../src/stores/photos', () => ({
  usePhotosStore: () => ({ syncFromOverlay: vi.fn() }),
}));
vi.mock('@myastrosky/app-state/stores/settings', () => ({
  useSettingsStore: () => ({
    serverSettings: { MAX_PARALLEL_SOLVES: state.maxParallel },
    load: vi.fn(),
  }),
}));
vi.mock('../../src/stores/ui', () => ({
  useUiStore: () => ({
    pendingBatchFiles: state.pendingFiles,
    pendingBatchPhotos: state.pendingPhotos,
  }),
}));

const submitLocalSolveJob = vi.fn(async () => ({ jobId: `job-${state.jobSeq++}` }));
const pollLocalSolveJob = vi.fn(async (_endpoint: string, jobId: string) =>
  state.pollResponder(jobId),
);
const cancelLocalSolveJob = vi.fn(async () => {});
const submitPlateSolve = vi.fn();
const pollPlateSolve = vi.fn();
const resumePlateSolve = vi.fn();
const uploadPhoto = vi.fn();
const setPhotoOnlineSolve = vi.fn(async () => undefined);
const storedPhotoFile = vi.fn(async (p: Photo) => new File(['x'], p.filename));
vi.mock('../../src/api', () => ({
  getSolverAvailability: () => state.availability,
  submitLocalSolveJob: (...a: unknown[]) => submitLocalSolveJob(...(a as [])),
  pollLocalSolveJob: (...a: unknown[]) => pollLocalSolveJob(...(a as [string, string])),
  cancelLocalSolveJob: (...a: unknown[]) => cancelLocalSolveJob(...(a as [])),
  // astrometry.net is never reached: every online call is mocked.
  submitPlateSolve: (...a: unknown[]) => submitPlateSolve(...a),
  pollPlateSolve: (...a: unknown[]) => pollPlateSolve(...a),
  resumePlateSolve: (...a: unknown[]) => resumePlateSolve(...a),
  uploadPhoto: (...a: unknown[]) => uploadPhoto(...a),
  updatePhotoMetadata: vi.fn(async () => undefined),
  setPhotoPlacement: vi.fn(),
  setPhotoOnlineSolve: (...a: unknown[]) => setPhotoOnlineSolve(...(a as [])),
  setPhotoFitsHeaders: vi.fn(),
  storedPhotoFile: (p: Photo) => storedPhotoFile(p),
  convertRawPhoto: vi.fn(),
  getGearSetups: vi.fn().mockResolvedValue([]),
}));
vi.mock('@myastrosky/app-state/api', () => ({
  solveWCS: vi.fn(),
  getGearSetups: vi.fn().mockResolvedValue([]),
}));
vi.mock('@myastrosky/app-state/stored-solve', () => ({ isFollowingStoredSolve: () => false }));

// ─── Helpers ────────────────────────────────────────────────────────────────────
const jpeg = (name: string) => new File(['x'], name, { type: 'image/jpeg' });
const CORR = [
  { pointIndex: 0, photoX: 1, photoY: 1, starHip: 1, starName: '' },
  { pointIndex: 1, photoX: 9, photoY: 9, starHip: 2, starName: '' },
];

function mountModal() {
  return mount(BatchUploadModal, {
    attachTo: document.body,
    global: { stubs: { BatchListRow: true, BatchPhotoDetail: true, BatchMultiEdit: true } },
  });
}
type Wrapper = ReturnType<typeof mountModal>;
const vm = (w: Wrapper) =>
  w.vm as unknown as { items: BatchItem[]; createBatchItem: (f: File) => BatchItem };
const statuses = (w: Wrapper) => vm(w).items.map((i) => i.status);
const button = (w: Wrapper, name: string) => w.find(`[data-test="${name}"]`);

function storedPhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    filename: 'p1.png',
    originalName: 'NGC7000',
    width: 100,
    height: 80,
    createdAt: '',
    correspondences: [],
    dsoIds: [],
    labels: ['été'],
    pointsOfInterest: [],
    notes: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  state.pendingFiles = [jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg')];
  state.pendingPhotos = null;
  state.maxParallel = '2';
  state.availability = { solveField: true, astap: true, astrometry: true };
  state.jobSeq = 0;
  state.pollResponder = () => ({ status: 'running', result: undefined });
  state.finishChoice = 'back';
  for (const fn of [
    submitLocalSolveJob,
    pollLocalSolveJob,
    cancelLocalSolveJob,
    submitPlateSolve,
    pollPlateSolve,
    resumePlateSolve,
    uploadPhoto,
    setPhotoOnlineSolve,
    showToast,
    confirmFinishBatch,
    overlay.placeUploadedPhoto,
  ]) {
    fn.mockClear();
  }
  uploadPhoto.mockImplementation(async (_f: File, correspondences: unknown) =>
    storedPhoto({ id: `p-${Math.random()}`, correspondences: correspondences as never }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('BatchUploadModal — the counted buttons', () => {
  it('counts the photos each button takes', async () => {
    const w = mountModal();
    await flushPromises();
    expect(button(w, 'solve-all').text()).toBe('batch.solveMany|3');
    expect(button(w, 'save-all').text()).toBe('batch.saveMany|3');
    expect(button(w, 'cancel-all').exists()).toBe(false);
  });

  it('has nothing to solve when every photo is already placed', async () => {
    const w = mountModal();
    await flushPromises();
    for (const item of vm(w).items) {
      item.status = 'success';
      item.solveCorrespondences = CORR;
    }
    await flushPromises();
    expect(button(w, 'solve-all').text()).toBe('batch.nothingToSolve');
    expect(button(w, 'solve-all').attributes('disabled')).toBeDefined();
  });
});

describe('BatchUploadModal — solving', () => {
  it('runs the local solves in parallel slots, and "Annuler la résolution" stops them all', async () => {
    const w = mountModal();
    await flushPromises();
    await button(w, 'solve-all').trigger('click');
    await flushPromises();
    expect(statuses(w)).toEqual(['solving', 'solving', 'waiting']);
    expect(submitLocalSolveJob).toHaveBeenCalledTimes(2);

    await button(w, 'cancel-all').trigger('click');
    await flushPromises();
    expect(statuses(w)).toEqual(['canceled', 'canceled', 'canceled']);
    expect(cancelLocalSolveJob).toHaveBeenCalledTimes(2);
    expect(submitLocalSolveJob).toHaveBeenCalledTimes(2);
  });

  it('offers to solve photos added while a run goes on', async () => {
    const w = mountModal();
    await flushPromises();
    await button(w, 'solve-all').trigger('click');
    await flushPromises();
    expect(button(w, 'solve-all').text()).toBe('batch.nothingToSolve');

    vm(w).items.push(vm(w).createBatchItem(jpeg('d.jpg')));
    await flushPromises();
    expect(button(w, 'cancel-all').exists()).toBe(true);
    expect(button(w, 'solve-all').text()).toBe('batch.solveOne');
    expect(button(w, 'solve-all').attributes('disabled')).toBeUndefined();
  });

  it('keeps a solve astrometry.net has not finished as "En cours", with its submission', async () => {
    state.pendingFiles = [jpeg('a.jpg')];
    const w = mountModal();
    await flushPromises();
    const item = vm(w).items[0];
    item.solver = 'astrometry';
    submitPlateSolve.mockResolvedValue({ jobId: 'online-job' });
    pollPlateSolve.mockResolvedValue({ jobId: 'online-job', status: 'timeout', submissionId: 42 });

    await button(w, 'solve-all').trigger('click');
    await vi.advanceTimersByTimeAsync(2100);
    await flushPromises();
    expect(item.status).toBe('unfinished');
    expect(item.online).toMatchObject({ submissionId: 42, fits: false });
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'batch.statusUnfinished' }),
    );
  });
});

describe('BatchUploadModal — saving and finishing', () => {
  it('saves placed and unplaced photos and stays open', async () => {
    state.pendingFiles = [jpeg('a.jpg'), jpeg('b.jpg')];
    const w = mountModal();
    await flushPromises();
    const [placed, unplaced] = vm(w).items;
    placed.status = 'success';
    placed.placedBy = 'local';
    placed.solveCorrespondences = CORR;

    await button(w, 'save-all').trigger('click');
    await flushPromises();
    expect(uploadPhoto).toHaveBeenCalledTimes(2);
    expect(uploadPhoto.mock.calls[0][1]).toEqual(CORR);
    expect(uploadPhoto.mock.calls[1][1]).toEqual([]);
    expect([placed.saveState, unplaced.saveState]).toEqual(['saved', 'saved']);
    expect(overlay.placeUploadedPhoto).toHaveBeenCalledTimes(2);
    expect(w.emitted('close')).toBeUndefined();
    expect(button(w, 'save-all').text()).toBe('batch.nothingToSave');
  });

  it('Terminer closes at once when everything is saved', async () => {
    state.pendingFiles = [jpeg('a.jpg')];
    const w = mountModal();
    await flushPromises();
    await button(w, 'save-all').trigger('click');
    await flushPromises();
    await button(w, 'finish').trigger('click');
    await flushPromises();
    expect(confirmFinishBatch).not.toHaveBeenCalled();
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('Terminer with photos not saved asks: back, discard, or save and finish', async () => {
    state.pendingFiles = [jpeg('a.jpg')];
    const w = mountModal();
    await flushPromises();

    state.finishChoice = 'back';
    await button(w, 'finish').trigger('click');
    await flushPromises();
    expect(confirmFinishBatch).toHaveBeenCalledWith(1);
    expect(w.emitted('close')).toBeUndefined();

    state.finishChoice = 'save';
    await button(w, 'finish').trigger('click');
    await flushPromises();
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('Abandonner closes without saving', async () => {
    const w = mountModal();
    await flushPromises();
    state.finishChoice = 'discard';
    await button(w, 'finish').trigger('click');
    await flushPromises();
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(w.emitted('close')).toHaveLength(1);
  });
});

describe('BatchUploadModal — list and batch edit', () => {
  it('edits the ticked photos together once two or more are ticked', async () => {
    const w = mountModal();
    await flushPromises();
    expect(w.find('batch-multi-edit-stub').exists()).toBe(false);
    vm(w).items[0].ticked = true;
    vm(w).items[1].ticked = true;
    await flushPromises();
    expect(w.find('batch-multi-edit-stub').exists()).toBe(true);

    // A half-ticked box ticks every photo, then unticks them all.
    await w.find('[data-test="tick-all"]').setValue(true);
    expect(vm(w).items.every((i) => i.ticked)).toBe(true);
    await w.find('[data-test="tick-all"]').setValue(false);
    expect(vm(w).items.every((i) => !i.ticked)).toBe(true);
  });

  it('opens a saved photo "À résoudre" with its astrometry.net solve still going on', async () => {
    state.pendingFiles = [];
    state.pendingPhotos = [
      storedPhoto({
        onlineSolve: {
          state: 'unfinished',
          submissionId: 42,
          sentAt: '2026-11-15T21:42:00.000Z',
          fits: true,
        },
      }),
    ];
    const w = mountModal();
    await flushPromises();
    const [item] = vm(w).items;
    expect(item).toMatchObject({
      status: 'unfinished',
      saveState: 'saved',
      customName: 'NGC7000',
      labels: ['été'],
      online: { submissionId: 42, fits: true },
    });
    // Nothing to save until something changes.
    expect(button(w, 'save-all').text()).toBe('batch.nothingToSave');
  });
});
