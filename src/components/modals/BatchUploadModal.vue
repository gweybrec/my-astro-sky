<template>
  <div class="modal-backdrop">
    <div class="modal batch-modal" @click.stop>
      <!-- Header -->
      <div class="modal-header">
        <div class="batch-modal-title-group">
          <h2>{{ t('batch.modalTitle') }}</h2>
          <span
            ref="infoIconEl"
            class="hints-info-icon"
            :title="t('batch.infoTitle')"
            @click.stop="toggleInfoTooltip"
            >ℹ</span
          >
        </div>
        <button class="modal-close" :title="t('batch.closeTitle')" @click="close">&times;</button>
      </div>

      <!-- Batch labels bar -->
      <div class="batch-labels-bar">
        <div class="batch-labels-bar-main">
          <span class="batch-labels-bar-title">{{ t('batch.labelsForAll') }}</span>
          <div class="batch-labels-input-row">
            <div v-if="batchLabels.length > 0" class="tag-chips">
              <span v-for="lbl in batchLabels" :key="lbl" class="tag-chip label-chip">
                {{ lbl }}
                <button type="button" class="tag-chip-remove" @click="removeBatchLabel(lbl)">
                  ×
                </button>
              </span>
            </div>
            <div class="tag-input-wrap relative">
              <input
                class="tag-input"
                :placeholder="t('modal.metadataLabelsPlaceholder')"
                v-model="batchLabelInput"
                @input="showBatchLabelSuggest = true"
                @focus="showBatchLabelSuggest = true"
                @keydown="onBatchLabelKeydown"
                @blur="onBatchLabelBlur"
              />
              <div v-if="showBatchLabelSuggest && batchLabelSuggestions.length" class="tag-suggest">
                <div
                  v-for="suggestion in batchLabelSuggestions"
                  :key="suggestion"
                  class="tag-suggest-item"
                  @mousedown.prevent="selectBatchLabelSuggestion(suggestion)"
                >
                  {{ suggestion }}
                </div>
              </div>
            </div>
          </div>
          <p class="batch-labels-bar-hint">{{ t('batch.labelsForAllHint') }}</p>
        </div>
        <button
          class="btn-action batch-add-more-btn"
          :title="t('batch.addMore')"
          @click="addMorePhotos"
        >
          <span class="batch-add-more-icon" v-html="addPhotoSvg"></span>
          <span>{{ t('batch.addMore') }}</span>
        </button>
      </div>

      <!-- Card list -->
      <div class="batch-list">
        <BatchCard
          v-for="item in items"
          :key="item.id"
          :item="item"
          :solver-availability="solverAvailability"
          :known-filter-map="knownFilterMap"
          @remove="removeItem(item)"
          @retry="retryItem(item)"
          @retry-upload="retryUploadItem(item)"
        />
      </div>

      <!-- Footer -->
      <div class="batch-footer">
        <div class="batch-footer-labels">
          <span class="batch-progress-label">{{ progressText }}</span>
          <span v-if="placedCount > 0" class="batch-placed-label">{{ placedText }}</span>
          <template v-if="isUploading">
            <span class="auto-solve-spinner batch-placing-spinner"></span>
            <span class="batch-placing-label">{{ t('batch.placingProgress') }}</span>
          </template>
        </div>
        <div class="batch-footer-actions">
          <CheckRow :label="t('batch.autoPlace')" v-model="autoPlace" :disabled="isStarting" />
          <div class="batch-footer-buttons">
            <button class="btn-danger" :disabled="!isStarting" @click="cancelAllSolving">
              {{ t('batch.cancelAll') }}
            </button>
            <button
              class="btn-action"
              :disabled="isStarting || allSolversDisabled"
              :title="allSolversDisabled ? t('batch.noSolverConfigured') : undefined"
              @click="startSolving"
            >
              {{ startBtnText }}
            </button>
            <button
              class="btn-confirm"
              :disabled="!canPlace || autoPlace"
              :title="autoPlace ? t('batch.autoPlaceDisabledTooltip') : undefined"
              @click="placeAll"
            >
              {{ t('batch.placeButton') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Info tooltip (teleported to body to avoid overflow clipping) -->
  <Teleport to="body">
    <div v-if="infoTooltipVisible" class="hints-info-tooltip" :style="infoTooltipStyle" @click.stop>
      <button class="hints-info-close" @click.stop="infoTooltipVisible = false">&times;</button>
      <h3>{{ t('batch.infoTitle') }}</h3>
      <p>{{ t('batch.infoIntro') }}</p>
      <h4>{{ t('batch.infoSolversTitle') }}</h4>
      <p>{{ t('batch.infoSolvers') }}</p>
      <h4>{{ t('batch.infoWcsTitle') }}</h4>
      <p>{{ t('batch.infoWcs') }}</p>
      <h4>{{ t('batch.infoHintTitle') }}</h4>
      <p>{{ t('batch.infoHint') }}</p>
      <h4>{{ t('batch.infoPlacementTitle') }}</h4>
      <p>{{ t('batch.infoPlacement') }}</p>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import type { BatchItem, SolverType } from '../../batch-types';
import type { PlateSolveResult } from '../../types';
import { t } from '../../i18n';
import { useCanvasStore } from '../../stores/canvas';
import { useSettingsStore } from '../../stores/settings';
import { useUiStore } from '../../stores/ui';
import {
  submitPlateSolve,
  pollPlateSolve,
  submitLocalSolveJob,
  pollLocalSolveJob,
  cancelLocalSolveJob,
  uploadPhoto,
  getSolverAvailability,
} from '../../api';
import type { SolverAvailability } from '../../api';
import { reportUnknownRendererError } from '../../error-reporter';
import { findDSOIdsFromCorrespondences } from '../../dso-catalog';
import { stripExtension } from '../../file-utils';
import {
  sanitizeIntegrationRows,
  DEFAULT_INTEGRATION_FILTERS,
  normalizeIntegrationFilterKey,
} from '../../batch-utils';
import { filterLabelCandidates } from '../../autocomplete-utils';
import { placeBatchItem } from '../../batch-place';
import { confirmDiscardUnsavedSolves } from '../../photo-delete-confirm';
import { showToast } from '../../toast';
import BatchCard from './BatchCard.vue';
import CheckRow from '../base/CheckRow.vue';
import addPhotoSvg from '../../icons/add-photo.svg?raw';

const emit = defineEmits<{ close: [] }>();

const canvasStore = useCanvasStore();
const settingsStore = useSettingsStore();
const uiStore = useUiStore();

// ─── Items ────────────────────────────────────────────────────────────────────
const solverAvailability = computed<SolverAvailability>(() =>
  settingsStore.serverSettings
    ? getSolverAvailability(settingsStore.serverSettings)
    : { solveField: true, astap: true, astrometry: true },
);

function defaultSolver(): SolverType {
  const avail = solverAvailability.value;
  if (avail.solveField) return 'solve-field';
  if (avail.astap) return 'astap';
  return 'astrometry';
}

// No local solver and no astrometry.net key: nothing can plate-solve, so the
// Start button is disabled (otherwise it would fall back to astrometry.net).
const allSolversDisabled = computed(() => {
  const a = solverAvailability.value;
  return !a.solveField && !a.astap && !a.astrometry;
});

function isSolverAvailable(solver: SolverType): boolean {
  const a = solverAvailability.value;
  if (solver === 'solve-field') return a.solveField;
  if (solver === 'astap') return a.astap;
  return a.astrometry;
}

onMounted(async () => {
  if (!settingsStore.serverSettings) {
    await settingsStore.load();
  }
});

const knownFilterMap = reactive(new Map<string, string>());

function rememberFilters(filters: string[]) {
  for (const filter of filters) {
    const trimmed = filter.trim();
    if (!trimmed) continue;
    const key = normalizeIntegrationFilterKey(trimmed);
    if (!knownFilterMap.has(key)) knownFilterMap.set(key, trimmed);
  }
}
rememberFilters(DEFAULT_INTEGRATION_FILTERS);
rememberFilters(
  canvasStore.overlay
    ?.getPlacedPhotos()
    .flatMap((p) => (p.photo.integrations ?? []).map((r) => r.filter)) ?? [],
);

const pendingFiles = uiStore.pendingBatchFiles ?? [];
uiStore.pendingBatchFiles = null;

// Running counter so appended items always get a unique id (Date.now() alone can
// collide when several files are added within the same millisecond).
let itemSeq = 0;

function createBatchItem(file: File): BatchItem {
  return {
    id: `batch-${Date.now()}-${itemSeq++}`,
    file,
    thumbBlobUrl: null,
    solver: defaultSolver(),
    hintCoords: null,
    hintTargetName: '',
    fovDeg: null,
    wcsResult: null,
    solveCorrespondences: null,
    status: 'pending',
    photo: null,
    error: '',
    diagnostics: undefined,
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    integrations: [],
    observationDate: '',
    notes: '',
    customName: stripExtension(file.name),
    elapsedSeconds: 0,
    localJobId: null,
    solveTimer: null,
    pollingTimer: null,
    solveAbort: null,
    metaOpen: false,
  };
}

const items = reactive<BatchItem[]>(pendingFiles.map(createBatchItem));

// ─── Add more photos without closing the modal ─────────────────────────────────
function addMorePhotos() {
  const allowedExt = /\.(jpe?g|png|webp)$/i;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/jpg';
  input.multiple = true;
  input.onchange = () => {
    if (!input.files || input.files.length === 0) return;
    const selected = Array.from(input.files);
    const valid = selected.filter((f) => allowedExt.test(f.name));
    if (valid.length === 0) {
      showToast({ message: t('errors.invalidPhotoFormat'), type: 'error', duration: 3500 });
      return;
    }
    if (valid.length !== selected.length) {
      showToast({ message: t('errors.someFilesSkipped'), type: 'error', duration: 3500 });
    }
    // New items join as 'pending', bumping the total/unsolved count in the footer.
    items.push(...valid.map(createBatchItem));
  };
  input.click();
}

// ─── Close / cleanup ──────────────────────────────────────────────────────────
let cancelled = false;

// Generation token for the current solve run. Bumping it invalidates the queue
// loop so a "Cancel solving" click stops launching further items.
let activeSolveRun = 0;

async function close() {
  // Warn before discarding photos that solved but were never saved/placed.
  const unsavedSolved = items.filter((i) => i.status === 'success').length;
  if (unsavedSolved > 0 && !(await confirmDiscardUnsavedSolves(unsavedSolved))) return;
  emit('close');
}

function cleanupItem(item: BatchItem) {
  if (item.solveTimer !== null) {
    clearInterval(item.solveTimer);
    item.solveTimer = null;
  }
  if (item.pollingTimer !== null) {
    clearInterval(item.pollingTimer);
    item.pollingTimer = null;
  }
  item.solveAbort = null;
}

onBeforeUnmount(() => {
  cancelled = true;
  for (const item of items) {
    item.solveAbort?.abort();
    cleanupItem(item);
  }
});

// ─── Remove item ──────────────────────────────────────────────────────────────
function removeItem(item: BatchItem) {
  if (item.status === 'solving' || item.status === 'placing') return;
  const idx = items.indexOf(item);
  if (idx !== -1) items.splice(idx, 1);
}

// ─── Footer computed ──────────────────────────────────────────────────────────
const isPlacing = ref(false);
const autoPlace = ref(localStorage.getItem('batch-auto-place') === 'true');
watch(autoPlace, (v) => localStorage.setItem('batch-auto-place', String(v)));

const solvedCount = computed(
  () =>
    items.filter((i) => i.status === 'success' || i.status === 'placing' || i.status === 'placed')
      .length,
);
const placedCount = computed(() => items.filter((i) => i.status === 'placed').length);
const canPlace = computed(() => items.some((i) => i.status === 'success') && !isPlacing.value);
const isUploading = computed(() => isPlacing.value || items.some((i) => i.status === 'placing'));
const progressText = computed(() =>
  t('batch.progress', { solved: String(solvedCount.value), total: String(items.length) }),
);
const placedText = computed(() => t('batch.progressPlaced', { placed: String(placedCount.value) }));

const isStarting = ref(false);
const startBtnText = computed(() =>
  isStarting.value ? t('batch.startingLabel') : t('batch.startButton'),
);

// ─── Solving logic ─────────────────────────────────────────────────────────────
async function pollUntilDone(
  item: BatchItem,
  jobId: string,
  signal: AbortSignal,
): Promise<PlateSolveResult> {
  return new Promise((resolve, reject) => {
    const stopPolling = () => {
      if (item.pollingTimer !== null) {
        clearInterval(item.pollingTimer);
        item.pollingTimer = null;
      }
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      stopPolling();
      // No server-side cancel endpoint for online astrometry — we just stop polling.
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    item.pollingTimer = setInterval(async () => {
      if (cancelled) {
        stopPolling();
        reject(new Error('cancelled'));
        return;
      }
      try {
        const status = await pollPlateSolve(jobId);
        // The poll request can resolve after an abort fired — bail without
        // overwriting the canceled status the abort handler set.
        if (signal.aborted) return;
        if (status.status === 'solved' && status.correspondences) {
          stopPolling();
          resolve({
            success: true,
            correspondences: status.correspondences,
            dsoIds: status.dsoIds,
          });
        } else if (status.status === 'failed' || status.status === 'timeout') {
          stopPolling();
          reject(new Error(status.error || t('modal.solveFailed')));
        }
      } catch (err) {
        stopPolling();
        reject(err);
      }
    }, 2000);
  });
}

async function pollUntilLocalDone(
  item: BatchItem,
  endpoint: '/api/solve-field' | '/api/solve-astap',
  jobId: string,
  signal: AbortSignal,
): Promise<PlateSolveResult> {
  return new Promise((resolve, reject) => {
    const stopPolling = (err?: unknown) => {
      if (item.pollingTimer !== null) {
        clearInterval(item.pollingTimer);
        item.pollingTimer = null;
      }
      signal.removeEventListener('abort', onAbort);
      if (err !== undefined) reject(err);
    };

    const onAbort = () => {
      stopPolling();
      cancelLocalSolveJob(endpoint, jobId).catch((e) =>
        reportUnknownRendererError('batch-solve', e),
      );
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    item.pollingTimer = setInterval(async () => {
      if (cancelled) {
        stopPolling(new Error('cancelled'));
        return;
      }
      try {
        const status = await pollLocalSolveJob(endpoint, jobId);
        if (status.status === 'success') {
          stopPolling();
          resolve(status.result ?? { success: false, error: t('modal.solveFailed') });
        } else if (status.status === 'failed') {
          // Resolve (don't reject) with the result so its diagnostics survive into
          // solveItem's failure branch and populate the error-details collapsible.
          stopPolling();
          resolve(
            status.result ?? { success: false, error: status.error || t('modal.solveFailed') },
          );
        } else if (status.status === 'canceled') {
          stopPolling();
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        }
      } catch (err) {
        stopPolling();
        reportUnknownRendererError('batch-solve', err);
        reject(err);
      }
    }, 2000);
  });
}

async function handleSolveSuccess(item: BatchItem, result: PlateSolveResult) {
  const correspondences = result.correspondences!;

  if (result.dsoIds && result.dsoIds.length > 0) {
    item.dsoIds = [...result.dsoIds];
  } else {
    const bm = await createImageBitmap(item.file).catch(() => null);
    item.dsoIds = findDSOIdsFromCorrespondences(correspondences, bm?.width || 0, bm?.height || 0);
    bm?.close();
  }

  if (cancelled) return;

  item.solveCorrespondences = correspondences;
  item.status = 'success';
  if (autoPlace.value) autoPlaceItem(item);
}

async function solveItem(item: BatchItem) {
  if (cancelled) return;
  if (item.status === 'solving') return;

  // Guard against attempting a solver that isn't configured (e.g. the button was
  // enabled but the item's selected solver has no path/API key available).
  if (!isSolverAvailable(item.solver)) {
    item.status = 'failed';
    item.error = t('batch.noSolverConfigured');
    item.diagnostics = undefined;
    return;
  }

  item.status = 'solving';
  item.elapsedSeconds = 0;

  item.solveTimer = setInterval(() => {
    item.elapsedSeconds++;
  }, 1000);

  try {
    let result: PlateSolveResult;
    const hints = item.hintCoords
      ? { ra: item.hintCoords.ra, dec: item.hintCoords.dec, fov: item.fovDeg ?? undefined }
      : item.fovDeg != null
        ? { fov: item.fovDeg }
        : undefined;

    if (item.solver === 'solve-field' || item.solver === 'astap') {
      const endpoint = item.solver === 'solve-field' ? '/api/solve-field' : '/api/solve-astap';
      item.solveAbort = new AbortController();
      const { jobId } = await submitLocalSolveJob(
        endpoint,
        item.file,
        hints,
        item.solveAbort.signal,
      );
      item.localJobId = jobId;
      result = await pollUntilLocalDone(item, endpoint, jobId, item.solveAbort.signal);
    } else {
      item.solveAbort = new AbortController();
      if (cancelled) {
        cleanupItem(item);
        return;
      }
      const { jobId } = await submitPlateSolve(
        item.file,
        hints ? { ra: hints.ra!, dec: hints.dec!, radius: 2.0 } : undefined,
      );
      result = await pollUntilDone(item, jobId, item.solveAbort.signal);
    }

    if (cancelled) {
      cleanupItem(item);
      return;
    }

    if (result.success && result.correspondences && result.correspondences.length >= 1) {
      await handleSolveSuccess(item, result);
    } else {
      if (result.code === 'SOLVE_CANCELED') {
        item.status = 'canceled';
        item.error = '';
        item.diagnostics = undefined;
      } else {
        item.status = 'failed';
        item.error = result.error || t('batch.statusFailed');
        item.diagnostics = result.diagnostics;
      }
    }
  } catch (err: any) {
    if (!cancelled) {
      const wasCanceled = err?.name === 'AbortError' || err?.code === 'SOLVE_CANCELED';
      item.status = wasCanceled ? 'canceled' : 'failed';
      item.error = wasCanceled ? '' : err.message || t('batch.statusFailed');
      if (wasCanceled) item.diagnostics = undefined;
    }
  } finally {
    cleanupItem(item);
  }
}

async function runWcsItem(item: BatchItem) {
  item.solveAbort = null;
  item.status = 'solving';
  item.elapsedSeconds = 0;
  item.solveTimer = setInterval(() => {
    item.elapsedSeconds++;
  }, 1000);
  try {
    await handleSolveSuccess(item, item.wcsResult!);
  } catch (err: any) {
    if (!cancelled) {
      item.status = 'failed';
      item.error = err.message || t('batch.statusFailed');
    }
  } finally {
    cleanupItem(item);
  }
}

function retryItem(item: BatchItem) {
  item.status = 'pending';
  item.error = '';
  item.diagnostics = undefined;
  void solveItem(item);
}

// ─── Start solving queue ───────────────────────────────────────────────────────
function startSolving() {
  const runId = ++activeSolveRun;
  isStarting.value = true;

  const maxParallel = Math.max(
    1,
    parseInt(settingsStore.serverSettings?.MAX_PARALLEL_SOLVES || '4', 10) || 4,
  );
  let localActiveSlots = 0;
  let onlineActiveCount = 0;
  const localQueue: BatchItem[] = [];
  const onlineQueue: BatchItem[] = [];

  for (const item of items) {
    if (cancelled) break;
    if (item.status === 'success' || item.status === 'placing' || item.status === 'placed')
      continue;
    if (item.status === 'failed') {
      item.error = '';
      item.diagnostics = undefined;
    }
    if (item.solver === 'astrometry' && item.wcsResult == null) {
      onlineQueue.push(item);
    } else {
      localQueue.push(item);
    }
  }

  for (let i = maxParallel; i < localQueue.length; i++) {
    localQueue[i].status = 'waiting';
  }

  function checkAllDone() {
    if (
      !cancelled &&
      runId === activeSolveRun &&
      localActiveSlots === 0 &&
      localQueue.length === 0 &&
      onlineActiveCount === 0
    ) {
      isStarting.value = false;
    }
  }

  function startNextLocalItem() {
    while (localActiveSlots < maxParallel && localQueue.length > 0) {
      const item = localQueue.shift()!;
      if (item.status === 'waiting') item.status = 'pending';
      localActiveSlots++;
      const promise = item.wcsResult != null ? runWcsItem(item) : solveItem(item);
      void promise.finally(() => {
        localActiveSlots--;
        if (!cancelled && runId === activeSolveRun) {
          startNextLocalItem();
          checkAllDone();
        }
      });
    }
    checkAllDone();
  }

  // Online items bypass local semaphore — start immediately, staggered 1s apart
  onlineQueue.forEach((item, idx) => {
    onlineActiveCount++;
    setTimeout(() => {
      if (cancelled || runId !== activeSolveRun) {
        onlineActiveCount--;
        return;
      }
      void solveItem(item).finally(() => {
        onlineActiveCount--;
        if (!cancelled && runId === activeSolveRun) checkAllDone();
      });
    }, idx * 1000);
  });

  startNextLocalItem();
}

// ─── Cancel all in-progress solves ─────────────────────────────────────────────
// Stops every photo currently solving or queued, leaving already solved/placed/
// failed photos untouched.
function cancelAllSolving() {
  activeSolveRun++; // invalidate the running queue → no new launches
  for (const item of items) {
    if (item.status === 'solving') {
      // Local & online solves both carry an AbortController; aborting routes
      // through solveItem's catch (AbortError → 'canceled') and finally cleanup.
      item.solveAbort?.abort();
    } else if (item.status === 'waiting') {
      // Queued but not yet started — no controller/timers to abort.
      cleanupItem(item);
      item.status = 'canceled';
    }
  }
  isStarting.value = false;
}

// ─── Place all solved photos ───────────────────────────────────────────────────
async function placeAll() {
  const toPlace = items.filter((i) => i.status === 'success');
  if (toPlace.length === 0 || isPlacing.value) return;
  isPlacing.value = true;
  for (const item of toPlace) {
    await placeBatchItem(
      item,
      batchLabels.value,
      uploadPhoto,
      (photo) => {
        canvasStore.overlay?.placeUploadedPhoto(photo);
      },
      t,
    );
  }
  isPlacing.value = false;
}

// ─── Auto-place a single item after it succeeds ────────────────────────────────
function autoPlaceItem(item: BatchItem) {
  placeBatchItem(
    item,
    batchLabels.value,
    uploadPhoto,
    (photo) => {
      canvasStore.overlay?.placeUploadedPhoto(photo);
    },
    t,
  );
}

// ─── Retry failed upload (emitted from BatchCard) ─────────────────────────────
function retryUploadItem(item: BatchItem) {
  if (item.status !== 'success') return;
  if (autoPlace.value) {
    autoPlaceItem(item);
  } else {
    placeAll();
  }
}

// ─── Batch labels ─────────────────────────────────────────────────────────────
const batchLabels = ref<string[]>([]);
const batchLabelInput = ref('');
const showBatchLabelSuggest = ref(false);
const localKnownBatchLabels = ref<string[]>([
  ...new Set(canvasStore.overlay?.getPlacedPhotos().flatMap((p) => p.photo.labels) ?? []),
]);

const batchLabelSuggestions = computed(() =>
  filterLabelCandidates(localKnownBatchLabels.value, batchLabels.value, batchLabelInput.value),
);

function commitBatchLabel(val: string) {
  const trimmed = val.trim();
  if (!trimmed || batchLabels.value.includes(trimmed)) return;
  batchLabels.value = [...batchLabels.value, trimmed];
  if (!localKnownBatchLabels.value.includes(trimmed)) localKnownBatchLabels.value.push(trimmed);
}

function selectBatchLabelSuggestion(suggestion: string) {
  commitBatchLabel(suggestion);
  batchLabelInput.value = '';
  showBatchLabelSuggest.value = false;
}

function onBatchLabelKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    commitBatchLabel(batchLabelInput.value);
    batchLabelInput.value = '';
    showBatchLabelSuggest.value = false;
  } else if (e.key === 'Escape') {
    showBatchLabelSuggest.value = false;
  }
}

function onBatchLabelBlur() {
  commitBatchLabel(batchLabelInput.value);
  batchLabelInput.value = '';
  setTimeout(() => {
    showBatchLabelSuggest.value = false;
  }, 150);
}

function removeBatchLabel(lbl: string) {
  batchLabels.value = batchLabels.value.filter((l) => l !== lbl);
}

// ─── Info tooltip ─────────────────────────────────────────────────────────────
const infoIconEl = ref<HTMLElement | null>(null);
const infoTooltipVisible = ref(false);
const infoTooltipStyle = ref<Record<string, string>>({ position: 'fixed' });
let docClickForTooltip: ((e: MouseEvent) => void) | null = null;

watch(infoTooltipVisible, (visible) => {
  if (visible) {
    setTimeout(() => {
      docClickForTooltip = (e: MouseEvent) => {
        const tip = document.querySelector('.hints-info-tooltip');
        if (tip && !tip.contains(e.target as Node) && e.target !== infoIconEl.value) {
          infoTooltipVisible.value = false;
        }
      };
      document.addEventListener('click', docClickForTooltip);
    }, 100);
  } else {
    if (docClickForTooltip) {
      document.removeEventListener('click', docClickForTooltip);
      docClickForTooltip = null;
    }
  }
});

onBeforeUnmount(() => {
  if (docClickForTooltip) {
    document.removeEventListener('click', docClickForTooltip);
    docClickForTooltip = null;
  }
});

async function toggleInfoTooltip() {
  infoTooltipVisible.value = !infoTooltipVisible.value;
  if (infoTooltipVisible.value) {
    await nextTick();
    if (!infoIconEl.value) return;
    const rect = infoIconEl.value.getBoundingClientRect();
    const tip = document.querySelector('.hints-info-tooltip') as HTMLElement | null;
    if (!tip) return;
    const tipRect = tip.getBoundingClientRect();
    let left = rect.right + 10;
    if (left + tipRect.width > window.innerWidth - 20) left = rect.left - tipRect.width - 10;
    let top = rect.top;
    if (top + tipRect.height > window.innerHeight - 20)
      top = window.innerHeight - tipRect.height - 20;
    infoTooltipStyle.value = { position: 'fixed', left: `${left}px`, top: `${top}px` };
  }
}
</script>
