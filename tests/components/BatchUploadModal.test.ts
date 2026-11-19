import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import BatchUploadModal from '../../src/components/modals/BatchUploadModal.vue';
import BatchListRow from '../../src/components/modals/BatchListRow.vue';
import type { BatchItem } from '../../src/batch-types';
import type { Photo } from '@myastrosky/core/types';
import {
  configureBatchKeep,
  keptStateOf,
  type BatchKeepStore,
  type KeptBatchItem,
} from '../../src/batch-keep';
import { makeItem } from '../helpers/batch-item';

// ─── Shared mutable state for the mocks ─────────────────────────────────────────
const state = vi.hoisted(() => ({
  pendingFiles: [] as File[],
  pendingPhotos: null as unknown[] | null,
  restored: null as unknown[] | null,
  maxParallel: '2',
  availability: { solveField: true, astap: true, astrometry: true },
  jobSeq: 0,
  pollResponder: (_jobId: string) => ({
    status: 'running' as string,
    result: undefined as unknown,
  }),
  finishChoice: 'back' as 'back' | 'discard' | 'save',
  addedPhotos: [] as Photo[],
}));
/** The store the window read at mount: reactive, so a test can hand it files while it is open. */
const ui = vi.hoisted(() => ({ store: null as null | { pendingBatchFiles: File[] | null } }));

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
vi.mock('../../src/stores/ui', async () => {
  const { reactive } = await import('vue');
  return {
    useUiStore: () =>
      (ui.store = reactive({
        pendingBatchFiles: state.pendingFiles as File[] | null,
        pendingBatchPhotos: state.pendingPhotos,
        pendingBatchRestored: state.restored,
      })),
  };
});

const submitLocalSolveJob = vi.fn(async () => ({ jobId: `job-${state.jobSeq++}` }));
const pollLocalSolveJob = vi.fn(async (_endpoint: string, jobId: string) =>
  state.pollResponder(jobId),
);
const cancelLocalSolveJob = vi.fn(async () => {});
const submitPlateSolve = vi.fn();
const pollPlateSolve = vi.fn();
const resumePlateSolve = vi.fn();
const pictureSize = vi.fn(async (_f: Blob) => ({ width: 64, height: 48 }));
const following = { value: false };
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
  pictureSize: (f: Blob) => pictureSize(f),
  uploadPhoto: (...a: unknown[]) => uploadPhoto(...a),
  updatePhotoMetadata: vi.fn(async () => undefined),
  setPhotoPlacement: vi.fn(),
  setPhotoOnlineSolve: (...a: unknown[]) => setPhotoOnlineSolve(...(a as [])),
  setPhotoFitsHeaders: vi.fn(),
  storedPhotoFile: (p: Photo) => storedPhotoFile(p),
  convertRawPhoto: vi.fn(),
  getGearSetups: vi.fn().mockResolvedValue([]),
  getPhotos: async () => state.addedPhotos,
}));
vi.mock('@myastrosky/app-state/api', () => ({
  solveWCS: vi.fn(),
  getGearSetups: vi.fn().mockResolvedValue([]),
}));
vi.mock('@myastrosky/app-state/stored-solve', () => ({
  isFollowingStoredSolve: () => following.value,
}));

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
  state.restored = null;
  configureBatchKeep(null);
  state.maxParallel = '2';
  state.availability = { solveField: true, astap: true, astrometry: true };
  state.jobSeq = 0;
  state.pollResponder = () => ({ status: 'running', result: undefined });
  state.finishChoice = 'back';
  state.addedPhotos = [];
  following.value = false;
  for (const fn of [
    submitLocalSolveJob,
    pollLocalSolveJob,
    cancelLocalSolveJob,
    submitPlateSolve,
    pollPlateSolve,
    resumePlateSolve,
    pictureSize,
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

  it('saves the submission of a photo already stored as soon as astrometry.net gives it, then "En cours"', async () => {
    state.pendingFiles = [jpeg('a.jpg')];
    const w = mountModal();
    await flushPromises();
    const item = vm(w).items[0];
    item.photo = storedPhoto({ id: 'p1' });
    item.solver = 'astrometry';
    submitPlateSolve.mockResolvedValue({ jobId: 'online-job' });
    pollPlateSolve
      .mockResolvedValueOnce({ jobId: 'online-job', status: 'running', submissionId: 42 })
      .mockResolvedValue({ jobId: 'online-job', status: 'timeout', submissionId: 42 });

    await button(w, 'solve-all').trigger('click');
    await vi.advanceTimersByTimeAsync(2100);
    await flushPromises();
    // Saved while the solve still runs: the app can be closed now and the solve is followed again later.
    expect(setPhotoOnlineSolve).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ state: 'solving', submissionId: 42 }),
    );

    await vi.advanceTimersByTimeAsync(2100);
    await flushPromises();
    expect(item.status).toBe('unfinished');
    expect(setPhotoOnlineSolve).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ state: 'unfinished', submissionId: 42 }),
    );
  });

  it('sends the hint to astrometry.net: the target object and the field width typed', async () => {
    state.pendingFiles = [jpeg('a.jpg')];
    const w = mountModal();
    await flushPromises();
    const item = vm(w).items[0];
    item.solver = 'astrometry';
    item.hintCoords = { ra: 10.68, dec: 41.27 };
    item.fovDeg = 2.5;
    submitPlateSolve.mockResolvedValue({ jobId: 'online-job' });
    pollPlateSolve.mockResolvedValue({ jobId: 'online-job', status: 'timeout', submissionId: 1 });

    await button(w, 'solve-all').trigger('click');
    await vi.advanceTimersByTimeAsync(2100);
    await flushPromises();
    const hints = submitPlateSolve.mock.calls[0][1];
    expect(hints).toMatchObject({ ra: 10.68, dec: 41.27, radius: 2 });
    expect(hints.scale_lower).toBeCloseTo(2);
    expect(hints.scale_upper).toBeCloseTo(3);
  });

  it('sends no field width to astrometry.net when none is typed', async () => {
    state.pendingFiles = [jpeg('a.jpg')];
    const w = mountModal();
    await flushPromises();
    const item = vm(w).items[0];
    item.solver = 'astrometry';
    submitPlateSolve.mockResolvedValue({ jobId: 'online-job' });
    pollPlateSolve.mockResolvedValue({ jobId: 'online-job', status: 'timeout', submissionId: 1 });

    await button(w, 'solve-all').trigger('click');
    await vi.advanceTimersByTimeAsync(2100);
    await flushPromises();
    expect(submitPlateSolve.mock.calls[0][1]).toEqual({});
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

describe('BatchUploadModal — kept until saved', () => {
  /** The browser's database, as a map: id → what was last written. */
  function memoryStore() {
    const kept = new Map<string, Partial<KeptBatchItem>>();
    const store: BatchKeepStore = {
      all: async () => [...kept.values()] as KeptBatchItem[],
      putFiles: async (id, file, rawFile) =>
        void kept.set(id, { ...kept.get(id), id, file, rawFile }),
      putState: async (id, order, s) => void kept.set(id, { ...kept.get(id), id, order, state: s }),
      delete: async (id) => void kept.delete(id),
      clear: async () => kept.clear(),
    };
    return { kept, store };
  }

  it('keeps the photos not stored yet as they change, and forgets them once the window is closed', async () => {
    const { kept, store } = memoryStore();
    configureBatchKeep(store);
    state.pendingFiles = [jpeg('a.jpg'), jpeg('b.jpg')];
    const w = mountModal();
    await vi.advanceTimersByTimeAsync(400);
    expect([...kept.values()].map((k) => k.file?.name)).toEqual(['a.jpg', 'b.jpg']);

    vm(w).items[0].labels.push('hiver');
    await vi.advanceTimersByTimeAsync(400);
    expect([...kept.values()][0].state?.labels).toEqual(['hiver']);

    // Stored: no longer kept here, the photo store has it.
    await button(w, 'save-all').trigger('click');
    await flushPromises();
    await vi.advanceTimersByTimeAsync(400);
    expect(kept.size).toBe(0);

    vm(w).items.push(vm(w).createBatchItem(jpeg('c.jpg')));
    await vi.advanceTimersByTimeAsync(400);
    expect(kept.size).toBe(1);
    w.unmount();
    await flushPromises();
    expect(kept.size).toBe(0);
  });

  it('opens with the photos kept when the app was left, and follows their astrometry.net solve again', async () => {
    state.pendingFiles = [];
    const fits = new File(['fits'], 'M31.fit', { type: 'application/fits' });
    state.restored = [
      {
        id: 'kept-1',
        order: 0,
        file: jpeg('M42.jpg'),
        rawFile: null,
        state: { ...keptStateOf(makeItem()), labels: ['hiver'], customName: 'Orion' },
      },
      {
        id: 'kept-2',
        order: 1,
        file: new File(['png'], 'M31.png', { type: 'image/png' }),
        rawFile: fits,
        state: {
          ...keptStateOf(makeItem()),
          rawName: 'M31.fit',
          customName: 'M31',
          solver: 'astrometry',
          status: 'unfinished',
          online: { submissionId: 42, sentAt: 's', fits: true },
        },
      },
    ] satisfies KeptBatchItem[];
    resumePlateSolve.mockResolvedValue({ jobId: 'new-job' });
    pollPlateSolve.mockResolvedValue({ jobId: 'new-job', status: 'running', submissionId: 42 });

    const w = mountModal();
    await flushPromises();
    expect(vm(w).items.map((i) => [i.id, i.customName])).toEqual([
      ['kept-1', 'Orion'],
      ['kept-2', 'M31'],
    ]);
    expect(vm(w).items[0].labels).toEqual(['hiver']);
    // Followed from its submission: only the size is sent, read from the PNG's header, never the FITS file.
    expect(pictureSize).toHaveBeenCalledWith(vm(w).items[1].file);
    expect(resumePlateSolve).toHaveBeenCalledWith({ width: 64, height: 48 }, 42, { fits: true });
    expect(submitPlateSolve).not.toHaveBeenCalled();
    expect(vm(w).items[1].status).toBe('solving');
  });

  it('says so when "Récupérer" is pressed on a saved photo astrometry.net is being asked about', async () => {
    const w = mountModal();
    await flushPromises();
    const item = vm(w).createBatchItem(jpeg('d.jpg'));
    item.online = { submissionId: 42, sentAt: 's' };
    item.photo = { id: 'p9', width: 64, height: 48 } as Photo;
    vm(w).items.push(item);
    following.value = true;
    await vm(w).fetchOnline(vm(w).items.at(-1));
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'batch.fetchAlreadyAsked', type: 'info' }),
    );
    expect(resumePlateSolve).not.toHaveBeenCalled();
  });
});

describe('files opened while the window is open', () => {
  it('join the list', async () => {
    state.pendingFiles = [jpeg('a.jpg')];
    const w = mountModal();
    ui.store!.pendingBatchFiles = [jpeg('d.jpg'), jpeg('e.jpg')];
    await flushPromises();
    expect(vm(w).items.map((i) => i.file.name)).toEqual(['a.jpg', 'd.jpg', 'e.jpg']);
    expect(ui.store!.pendingBatchFiles).toBeNull();
    w.unmount();
  });
});

describe('"Déjà dans vos photos"', () => {
  it('marks a file not saved yet that is named like a photo already added', async () => {
    state.pendingFiles = [jpeg('NGC7000.jpg'), jpeg('M31.jpg')];
    state.addedPhotos = [storedPhoto()];
    const w = mountModal();
    await flushPromises();
    const rows = w.findAllComponents(BatchListRow);
    expect(rows.map((r) => r.props('alreadyAdded'))).toEqual([true, false]);
    w.unmount();
  });
});
