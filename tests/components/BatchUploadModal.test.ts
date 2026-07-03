import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import BatchUploadModal from '../../src/components/modals/BatchUploadModal.vue';

// ─── Shared mutable state for the mocks ─────────────────────────────────────────
// `vi.hoisted` makes this available inside the (hoisted) vi.mock factories below.
const state = vi.hoisted(() => ({
  pendingFiles: [] as File[],
  maxParallel: '2',
  availability: { solveField: true, astap: true, astrometry: true },
  jobSeq: 0,
  // Per-test poll behaviour, keyed by jobId. Default: still running.
  pollResponder: (_jobId: string) => ({
    status: 'running' as string,
    result: undefined as unknown,
  }),
}));

// ─── Module mocks ───────────────────────────────────────────────────────────────
vi.mock('../../src/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../src/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../src/error-reporter', () => ({ reportUnknownRendererError: vi.fn() }));
vi.mock('../../src/batch-place', () => ({ placeBatchItem: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/autocomplete-utils', () => ({ filterLabelCandidates: () => [] }));
vi.mock('../../src/dso-catalog', () => ({ findDSOIdsFromCorrespondences: () => [] }));
vi.mock('../../src/file-utils', () => ({
  stripExtension: (s: string) => s.replace(/\.[^.]+$/, ''),
}));
vi.mock('../../src/icons/add-photo.svg?raw', () => ({ default: '<svg/>' }));
vi.mock('../../src/batch-utils', () => ({
  sanitizeIntegrationRows: (rows: unknown) => rows,
  DEFAULT_INTEGRATION_FILTERS: [] as string[],
  normalizeIntegrationFilterKey: (s: string) => s.toLowerCase(),
}));

vi.mock('../../src/stores/canvas', () => ({
  useCanvasStore: () => ({ overlay: null, gallery: null }),
}));
vi.mock('../../src/stores/settings', () => ({
  useSettingsStore: () => ({
    serverSettings: { MAX_PARALLEL_SOLVES: state.maxParallel },
    load: vi.fn(),
  }),
}));
vi.mock('../../src/stores/ui', () => ({
  useUiStore: () => ({ pendingBatchFiles: state.pendingFiles }),
}));

const submitLocalSolveJob = vi.fn(async () => ({ jobId: `job-${state.jobSeq++}` }));
const pollLocalSolveJob = vi.fn(async (_endpoint: string, jobId: string) =>
  state.pollResponder(jobId),
);
const cancelLocalSolveJob = vi.fn(async () => {});
vi.mock('../../src/api', () => ({
  getSolverAvailability: () => state.availability,
  submitLocalSolveJob: (...args: unknown[]) => submitLocalSolveJob(...(args as [])),
  pollLocalSolveJob: (...args: unknown[]) => pollLocalSolveJob(...(args as [string, string])),
  cancelLocalSolveJob: (...args: unknown[]) => cancelLocalSolveJob(...(args as [])),
  submitPlateSolve: vi.fn(),
  pollPlateSolve: vi.fn(),
  uploadPhoto: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────────
function jpeg(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

function mountModal() {
  return mount(BatchUploadModal, {
    attachTo: document.body,
    global: { stubs: { BatchCard: true, CheckRow: true } },
  });
}

// The card components are stubbed, so read status straight off the reactive items.
function statuses(wrapper: ReturnType<typeof mountModal>): string[] {
  return (wrapper.vm as unknown as { items: { status: string }[] }).items.map((i) => i.status);
}

beforeEach(() => {
  vi.useFakeTimers();
  state.pendingFiles = [jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg')];
  state.maxParallel = '2';
  state.jobSeq = 0;
  state.pollResponder = () => ({ status: 'running', result: undefined });
  submitLocalSolveJob.mockClear();
  pollLocalSolveJob.mockClear();
  cancelLocalSolveJob.mockClear();
  localStorage.setItem('batch-auto-place', 'false');
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('BatchUploadModal — cancel all solving', () => {
  it('cancels both in-progress and queued solves, and stops the queue from launching the waiting item', async () => {
    // 3 local items, max 2 parallel → 2 solving, 1 waiting. Polls never resolve.
    const wrapper = mountModal();
    await flushPromises();

    // `.btn-action` also matches the "add more photos" button; scope to the footer.
    await wrapper.find('.batch-footer-buttons .btn-action').trigger('click'); // Start plate solving
    await flushPromises();

    expect(statuses(wrapper)).toEqual(['solving', 'solving', 'waiting']);
    // Only the two active items reached the server; the waiting one never submitted.
    expect(submitLocalSolveJob).toHaveBeenCalledTimes(2);

    await wrapper.find('.btn-danger').trigger('click'); // Cancel solving
    await flushPromises();

    expect(statuses(wrapper)).toEqual(['canceled', 'canceled', 'canceled']);
    // Server-side cancel fired only for the two that had actually started.
    expect(cancelLocalSolveJob).toHaveBeenCalledTimes(2);
    // The queue must not have launched the previously-waiting item after cancel.
    expect(submitLocalSolveJob).toHaveBeenCalledTimes(2);

    wrapper.unmount();
  });

  it('leaves an already-solved item untouched while cancelling the rest', async () => {
    // First job solves; the others keep running.
    state.pollResponder = (jobId: string) =>
      jobId === 'job-0'
        ? {
            status: 'success',
            result: { success: true, correspondences: [{ pointIndex: 0 }], dsoIds: ['M1'] },
          }
        : { status: 'running', result: undefined };

    const wrapper = mountModal();
    await flushPromises();

    await wrapper.find('.batch-footer-buttons .btn-action').trigger('click'); // Start
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2000); // first poll round
    await flushPromises();

    // item[0] solved → its slot freed → the waiting item[2] was launched.
    expect(statuses(wrapper)).toEqual(['success', 'solving', 'solving']);

    await wrapper.find('.btn-danger').trigger('click'); // Cancel solving
    await flushPromises();

    // Finished item is preserved; the two in-progress solves are cancelled.
    expect(statuses(wrapper)).toEqual(['success', 'canceled', 'canceled']);

    wrapper.unmount();
  });
});
