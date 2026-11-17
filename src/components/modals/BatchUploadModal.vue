<template>
  <div class="modal-backdrop">
    <div class="modal batch-modal !max-w-[1180px] !w-[90vw] !h-[88vh]" @click.stop>
      <!-- Header: the title, the help, the close button -->
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
        <button
          class="modal-close"
          :title="t('batch.closeTitle')"
          :aria-label="t('batch.closeTitle')"
          @click="finish"
        >
          &times;
        </button>
      </div>

      <div class="flex-1 min-h-0 grid grid-cols-[380px_1fr]">
        <!-- Left: the photos -->
        <div
          class="flex flex-col min-h-0 border-r border-subtle bg-[var(--bg-surface-lo)]"
          data-test="batch-list"
        >
          <div
            class="shrink-0 flex flex-wrap gap-2 px-6 pt-6 pb-4"
            role="group"
            :aria-label="t('batch.filterLabel')"
          >
            <button
              v-for="f in BATCH_FILTERS"
              :key="f"
              type="button"
              :class="filter === f ? 'bw-filter--on' : 'bw-filter'"
              :aria-pressed="filter === f"
              :disabled="f !== 'all' && counts.byFilter[f] === 0"
              :data-test="`filter-${f}`"
              @click="filter = filter === f ? 'all' : f"
            >
              {{ t(FILTER_KEYS[f]) }} <b>{{ counts.byFilter[f] }}</b>
            </button>
          </div>
          <label
            class="shrink-0 flex items-center gap-4 px-8 py-3 border-b border-subtle text-base text-secondary"
          >
            <input
              type="checkbox"
              class="m-0 accent-[var(--accent-color)]"
              :checked="allTicked"
              :indeterminate.prop="someTicked"
              data-test="tick-all"
              @change="tickAll(($event.target as HTMLInputElement).checked)"
            />
            {{ t('batch.selectAll') }}
            <span class="ml-auto text-dim">{{ tickedLabel }}</span>
          </label>
          <div
            ref="listEl"
            class="flex-1 min-h-0 overflow-y-auto flex flex-col px-4 pt-3"
            tabindex="0"
            @keydown="onListKeydown"
          >
            <BatchListRow
              v-for="item in shownItems"
              :key="item.id"
              :item="item"
              :selected="!multiEdit && item.id === selectedId"
              @select="select(item.id)"
              @tick="(on) => (item.ticked = on)"
            />
          </div>
          <button
            type="button"
            class="shrink-0 mx-6 mt-4 mb-6 flex items-center justify-center gap-4 p-5 border border-dashed border-[var(--border-white-md)] rounded-lg bg-transparent text-secondary cursor-pointer hover:text-primary"
            @click="addMorePhotos"
          >
            <span class="[&_svg]:w-4 [&_svg]:h-4" v-html="addPhotoSvg"></span>
            <span>{{ t('batch.addMore') }}</span>
          </button>
        </div>

        <!-- Right: the selected photo, or the ticked ones together -->
        <div class="min-h-0 overflow-y-auto px-9 py-7">
          <BatchMultiEdit
            v-if="multiEdit"
            :items="tickedItems"
            :gear-setups="gearSetups"
            :known-labels="knownLabels"
            @clear="tickAll(false)"
          />
          <BatchPhotoDetail
            v-else-if="selectedItem"
            :key="selectedItem.id"
            :item="selectedItem"
            :solver-availability="solverAvailability"
            :known-filter-map="knownFilterMap"
            :gear-setups="gearSetups"
            @remove="removeItem(selectedItem)"
            @solve="(solver) => solveOne(selectedItem!, solver)"
            @fetch="fetchOnline(selectedItem!)"
            @cancel="cancelItem(selectedItem!)"
          />
        </div>
      </div>

      <!-- Footer: the counted buttons, then Terminer -->
      <div
        class="shrink-0 flex items-center gap-4 px-8 py-6 border-t border-subtle bg-[var(--bg-panel-hdr)]"
      >
        <span class="flex-1"></span>
        <button
          v-if="counts.solving > 0"
          type="button"
          class="btn-danger"
          data-test="cancel-all"
          @click="cancelAllSolving"
        >
          {{ t('batch.cancelAll') }}
        </button>
        <button
          type="button"
          class="btn-action"
          data-test="solve-all"
          :disabled="counts.toSolve === 0 || allSolversDisabled"
          :title="allSolversDisabled ? t('batch.noSolverConfigured') : undefined"
          @click="startSolving"
        >
          {{ solveLabel }}
        </button>
        <button
          type="button"
          class="btn-confirm"
          data-test="save-all"
          :disabled="counts.toSave === 0 || saving"
          @click="saveAll"
        >
          {{ saveLabel }}
        </button>
        <span class="w-px self-stretch bg-[var(--border-subtle)] mx-3"></span>
        <button type="button" class="btn-cancel" data-test="finish" @click="finish">
          {{ t('batch.finish') }}
        </button>
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
      <h4>{{ t('batch.infoManualTitle') }}</h4>
      <p>{{ t('batch.infoManual') }}</p>
      <h4>{{ t('batch.infoPlacementTitle') }}</h4>
      <p>{{ t('batch.infoPlacement') }}</p>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import type { BatchItem, SolverType } from '../../batch-types';
import type { AstrometrySolveStatus, Photo, PlateSolveResult } from '@myastrosky/core/types';
import { t } from '../../i18n';
import { useCanvasStore } from '../../stores/canvas';
import { useSettingsStore } from '@myastrosky/app-state/stores/settings';
import { useUiStore } from '../../stores/ui';
import { usePhotosStore } from '../../stores/photos';
import {
  submitPlateSolve,
  pollPlateSolve,
  resumePlateSolve,
  submitLocalSolveJob,
  pollLocalSolveJob,
  cancelLocalSolveJob,
  uploadPhoto,
  updatePhotoMetadata,
  setPhotoPlacement,
  setPhotoOnlineSolve,
  setPhotoFitsHeaders,
  storedPhotoFile,
  getSolverAvailability,
  getGearSetups,
  convertRawPhoto,
} from '../../api';
import type { SolverAvailability, GearSetupData } from '../../api';
import { reportUnknownRendererError } from '../../error-reporter';
import { findDSOIdsFromCorrespondences } from '../../dso-catalog';
import { stripExtension } from '../../file-utils';
import {
  BATCH_FILTERS,
  DEFAULT_INTEGRATION_FILTERS,
  batchCounts,
  isSolvable,
  markChanged,
  matchesFilter,
  needsSaving,
  normalizeIntegrationFilterKey,
  type BatchFilter,
} from '../../batch-utils';
import { onlineSolveOf, saveBatchItem, type BatchSaveApi } from '../../batch-place';
import { confirmFinishBatch } from '../../photo-delete-confirm';
import { showToast } from '../../toast';
import {
  ANY_PHOTO_EXT_RE,
  PHOTO_PICKER_ACCEPT,
  isRawAstroFile,
  solveInputFile,
} from '@myastrosky/core/photo-formats';
import { isPlacedPhoto } from '@myastrosky/core/photo-placement';
import { onlineSolveHints } from '@myastrosky/core/domain/solve';
import { isFollowingStoredSolve } from '@myastrosky/app-state/stored-solve';
import { noSolutionMessage, suggestedSetupFor } from '../../wcs-load-flow';
import { applyWcsResultToItem } from '../../batch-wcs';
import BatchListRow from './BatchListRow.vue';
import BatchPhotoDetail from './BatchPhotoDetail.vue';
import BatchMultiEdit from './BatchMultiEdit.vue';
import addPhotoSvg from '../../icons/add-photo.svg?raw';

const emit = defineEmits<{ close: [] }>();

const canvasStore = useCanvasStore();
const settingsStore = useSettingsStore();
const uiStore = useUiStore();
const photosStore = usePhotosStore();

const FILTER_KEYS: Record<BatchFilter, string> = {
  all: 'batch.filterAll',
  toPlace: 'batch.filterToPlace',
  failed: 'batch.filterFailed',
  unsaved: 'batch.filterUnsaved',
  saved: 'batch.filterSaved',
};

// ─── Solvers ──────────────────────────────────────────────────────────────────
const solverAvailability = computed<SolverAvailability>(() =>
  settingsStore.serverSettings
    ? getSolverAvailability(settingsStore.serverSettings)
    : { solveField: true, astap: true, astrometry: true },
);

function defaultSolver(): SolverType {
  const avail = solverAvailability.value;
  if (avail.astap) return 'astap';
  if (avail.solveField) return 'solve-field';
  return 'astrometry';
}

// No local solver and no astrometry.net key: nothing can plate-solve.
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

// Gear setups, shared by every photo's metadata.
const gearSetups = ref<GearSetupData[]>([]);

onMounted(async () => {
  if (!settingsStore.serverSettings) await settingsStore.load();
  try {
    gearSetups.value = await getGearSetups();
  } catch {
    /* leave empty on failure — the picker just shows "none" */
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
const storedPhotos = () => canvasStore.overlay?.getPlacedPhotos().map((p) => p.photo) ?? [];
rememberFilters(DEFAULT_INTEGRATION_FILTERS);
rememberFilters(storedPhotos().flatMap((p) => (p.integrations ?? []).map((r) => r.filter)));

const knownLabels = computed(() => [
  ...new Set([...storedPhotos().flatMap((p) => p.labels), ...items.flatMap((i) => i.labels)]),
]);

// ─── Items ────────────────────────────────────────────────────────────────────
// Running counter so appended items always get a unique id.
let itemSeq = 0;

function baseItem(file: File): BatchItem {
  return {
    id: `batch-${Date.now()}-${itemSeq++}`,
    file,
    rawFile: null,
    rawName: null,
    convertProgress: 0,
    thumbBlobUrl: null,
    solver: defaultSolver(),
    hintCoords: null,
    hintTargetName: '',
    fovDeg: null,
    wcsResult: null,
    solveCorrespondences: null,
    status: 'pending',
    saveState: 'new',
    placementSaved: false,
    online: null,
    ticked: false,
    photo: null,
    error: '',
    diagnostics: undefined,
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    integrations: [],
    observationDate: '',
    captureDetails: {},
    gearSetupId: null,
    notes: '',
    customName: stripExtension(file.name),
    elapsedSeconds: 0,
    localJobId: null,
    solveTimer: null,
    pollingTimer: null,
    solveAbort: null,
  };
}

function createBatchItem(file: File): BatchItem {
  const item = baseItem(file);
  if (isRawAstroFile(file.name)) {
    item.rawFile = file;
    item.rawName = file.name;
    item.status = 'converting';
  }
  return item;
}

/** A stored photo opened again (a gallery photo "À résoudre"): saved, its online solve going on if it has one. */
function itemFromPhoto(photo: Photo, file: File): BatchItem {
  const item = baseItem(file);
  const solve = photo.onlineSolve;
  Object.assign(item, {
    photo,
    saveState: 'saved',
    placementSaved: true,
    customName: photo.originalName,
    dsoIds: [...photo.dsoIds],
    labels: [...photo.labels],
    pointsOfInterest: photo.pointsOfInterest.map((p) => ({ ...p })),
    integrations: (photo.integrations ?? []).map((r) => ({ ...r })),
    observationDate: photo.observationDate ?? '',
    captureDetails: { ...(photo.captureDetails ?? {}) },
    gearSetupId: photo.gearSetupId ?? null,
    notes: photo.notes,
  });
  if (isPlacedPhoto(photo)) {
    item.status = 'success';
    item.solveCorrespondences = photo.correspondences;
    item.manualPlacement = photo.manualPlacement ?? null;
  } else if (solve?.submissionId && solve.state !== 'failed') {
    item.status = 'unfinished';
    item.solver = 'astrometry';
    item.online = {
      submissionId: solve.submissionId,
      sentAt: solve.sentAt,
      ...(solve.checkedAt ? { checkedAt: solve.checkedAt } : {}),
      fits: !!solve.fits,
    };
  } else if (solve?.state === 'failed') {
    item.status = 'failed';
    item.error = solve.error ?? '';
  }
  return item;
}

const pendingFiles = uiStore.pendingBatchFiles ?? [];
uiStore.pendingBatchFiles = null;
const pendingPhotos = uiStore.pendingBatchPhotos ?? [];
uiStore.pendingBatchPhotos = null;

const items = reactive<BatchItem[]>(pendingFiles.map(createBatchItem));

// ─── Selection, filters, tick boxes ───────────────────────────────────────────
const filter = ref<BatchFilter>('all');
const selectedId = ref<string | null>(items[0]?.id ?? null);
const listEl = ref<HTMLElement | null>(null);

const shownItems = computed(() => items.filter((i) => matchesFilter(i, filter.value)));
const selectedItem = computed(() => items.find((i) => i.id === selectedId.value) ?? null);
const tickedItems = computed(() => items.filter((i) => i.ticked));
const multiEdit = computed(() => tickedItems.value.length >= 2);
const allTicked = computed(() => items.length > 0 && tickedItems.value.length === items.length);
const someTicked = computed(() => tickedItems.value.length > 0 && !allTicked.value);
const tickedLabel = computed(() => {
  const n = tickedItems.value.length;
  if (n === 0) return '';
  return n === 1 ? t('batch.selectedOne') : t('batch.selectedMany', { n: String(n) });
});

function select(id: string) {
  selectedId.value = id;
}

function tickAll(on: boolean) {
  for (const item of items) item.ticked = on;
}

// Stored photos come with their picture, read from the store.
void (async () => {
  for (const photo of pendingPhotos) {
    try {
      const file = await storedPhotoFile(photo);
      items.push(itemFromPhoto(photo, file));
      if (!selectedId.value) selectedId.value = items[items.length - 1].id;
    } catch (err) {
      reportUnknownRendererError('batch-open-stored', err);
    }
  }
})();

// The selection stays on a shown photo when the filter changes.
watch(shownItems, (shown) => {
  if (shown.length && !shown.some((i) => i.id === selectedId.value)) {
    selectedId.value = shown[0].id;
  }
});

function onListKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const shown = shownItems.value;
  if (!shown.length) return;
  e.preventDefault();
  const at = shown.findIndex((i) => i.id === selectedId.value);
  const next = e.key === 'ArrowDown' ? Math.min(shown.length - 1, at + 1) : Math.max(0, at - 1);
  selectedId.value = shown[next].id;
  void nextTick(() =>
    listEl.value
      ?.querySelector(`[data-item-id="${shown[next].id}"]`)
      ?.scrollIntoView({ block: 'nearest' }),
  );
}

// ─── Counts and the footer's labels ───────────────────────────────────────────
const counts = computed(() => batchCounts(items));
const saving = ref(false);
const solveLabel = computed(() => {
  const n = counts.value.toSolve;
  if (n === 0) return t('batch.nothingToSolve');
  return n === 1 ? t('batch.solveOne') : t('batch.solveMany', { n: String(n) });
});
const saveLabel = computed(() => {
  const n = counts.value.toSave;
  if (n === 0) return t('batch.nothingToSave');
  return n === 1 ? t('batch.saveOne') : t('batch.saveMany', { n: String(n) });
});

// ─── Raw file conversion (TIFF/FITS → PNG, server-side) ────────────────────────
// Serialized: a 200+ MB raw body plus its decode buffers must not be held in memory for several items at once.
const rawConvertQueue: BatchItem[] = [];
let convertQueueActive = false;

function enqueueForConversion(newItems: BatchItem[]) {
  const rawItems = newItems.filter((i) => i.rawName !== null && i.status === 'converting');
  if (rawItems.length === 0) return;
  rawConvertQueue.push(...rawItems);
  void processConvertQueue();
}

async function processConvertQueue() {
  if (convertQueueActive) return;
  convertQueueActive = true;
  while (rawConvertQueue.length > 0) {
    const item = rawConvertQueue.shift()!;
    if (!items.includes(item)) continue; // removed while queued
    await convertOneItem(item);
  }
  convertQueueActive = false;
}

async function convertOneItem(item: BatchItem) {
  const abort = new AbortController();
  item.solveAbort = abort;
  try {
    const { png, meta } = await convertRawPhoto(
      item.file,
      (fraction) => {
        item.convertProgress = fraction;
      },
      abort.signal,
    );
    if (!items.includes(item)) return;
    item.file = png;
    item.solveAbort = null;
    // The raw file is the photo itself: nothing to compare it with, but its header may point to a saved setup.
    const suggested = await suggestedSetupFor(meta);
    if (!items.includes(item)) return;
    const applied = applyWcsResultToItem(item, meta, meta.width, meta.height, suggested);
    if (applied.applied) {
      item.status = 'success';
      item.placedBy = 'file';
      item.wcsFileName = item.rawName ?? undefined;
    } else {
      item.status = 'pending';
      // No plate solution in the file: its capture data was taken, the photo still has to be placed.
      item.wcsNotice = noSolutionMessage(item.rawName ?? item.file.name);
    }
  } catch (err: any) {
    if (!items.includes(item)) return;
    item.solveAbort = null;
    item.status = 'failed';
    item.error = t('errors.convertRawFailed', {
      filename: item.rawName ?? item.file.name,
      detail: err?.message || 'unknown error',
    });
  }
}

/** A raw file whose conversion failed still holds the raw file, not its PNG. */
function needsConversion(item: BatchItem): boolean {
  return item.rawName !== null && isRawAstroFile(item.file.name);
}

function retryConversion(item: BatchItem) {
  item.status = 'converting';
  item.convertProgress = 0;
  item.error = '';
  item.diagnostics = undefined;
  enqueueForConversion([item]);
}

enqueueForConversion(items);

// ─── Add more photos without closing the window ───────────────────────────────
function addMorePhotos() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = PHOTO_PICKER_ACCEPT;
  input.multiple = true;
  input.onchange = () => {
    if (!input.files || input.files.length === 0) return;
    const selected = Array.from(input.files);
    const valid = selected.filter((f) => ANY_PHOTO_EXT_RE.test(f.name));
    if (valid.length === 0) {
      showToast({ message: t('errors.invalidPhotoFormat'), type: 'error', duration: 3500 });
      return;
    }
    if (valid.length !== selected.length) {
      showToast({ message: t('errors.someFilesSkipped'), type: 'error', duration: 3500 });
    }
    // Enqueue the reactive items read back from the array, not the plain objects pushed: conversion progress and
    // status written to a plain object never reach the window.
    const start = items.length;
    items.push(...valid.map(createBatchItem));
    if (!selectedId.value && items[start]) selectedId.value = items[start].id;
    enqueueForConversion(items.slice(start));
  };
  input.click();
}

// ─── Remove a photo not saved yet ─────────────────────────────────────────────
function removeItem(item: BatchItem) {
  if (item.saveState !== 'new' || ['solving', 'waiting', 'converting'].includes(item.status)) {
    return;
  }
  const idx = items.indexOf(item);
  if (idx === -1) return;
  if (item.thumbBlobUrl) URL.revokeObjectURL(item.thumbBlobUrl);
  items.splice(idx, 1);
  if (selectedId.value === item.id) {
    selectedId.value = (items[idx] ?? items[idx - 1])?.id ?? null;
  }
}

// ─── Close / cleanup ──────────────────────────────────────────────────────────
let cancelled = false;

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
  rawConvertQueue.length = 0;
  for (const item of items) {
    item.solveAbort?.abort();
    cleanupItem(item);
    if (item.thumbBlobUrl) URL.revokeObjectURL(item.thumbBlobUrl);
  }
});

/**
 * "Terminer" (and the close button): with photos not saved, asks Revenir / Abandonner / Enregistrer et terminer. A
 * solve astrometry.net goes on with stays with a saved photo and is followed again later.
 */
async function finish() {
  const unsaved = items.filter((i) => i.saveState !== 'saved').length;
  if (unsaved > 0) {
    const choice = await confirmFinishBatch(unsaved);
    if (choice === 'back') return;
    if (choice === 'save') {
      await saveAll();
      if (items.some(needsSaving)) return; // a save failed: the window shows why
    }
  }
  emit('close');
}

// ─── Solving ──────────────────────────────────────────────────────────────────
const maxParallel = () =>
  Math.max(1, parseInt(settingsStore.serverSettings?.MAX_PARALLEL_SOLVES || '4', 10) || 4);

/** astrometry.net's job, followed until it ends, the item's online solve kept up to date meanwhile. */
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
      // No server-side cancel for online astrometry: following stops, the solve goes on there.
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
        const status: AstrometrySolveStatus = await pollPlateSolve(jobId);
        if (signal.aborted) return;
        if (item.online) {
          item.online.checkedAt = new Date().toISOString();
          if (status.submissionId && status.submissionId !== item.online.submissionId) {
            item.online.submissionId = status.submissionId;
            keepOnlineSolve(item);
          }
        }
        if (status.status === 'solved' && status.correspondences) {
          stopPolling();
          resolve({
            success: true,
            correspondences: status.correspondences,
            dsoIds: status.dsoIds,
          });
        } else if (status.status === 'timeout') {
          // Not a failure: astrometry.net goes on solving after the app stopped following it.
          stopPolling();
          reject(Object.assign(new Error('unfinished'), { code: 'SOLVE_UNFINISHED' }));
        } else if (status.status === 'failed') {
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
          // Resolve with the result so its diagnostics reach the failure branch.
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

/** A saved photo keeps its astrometry.net solve, so that it is followed again if the window is left. */
function keepOnlineSolve(item: BatchItem) {
  if (!item.photo) return;
  const solve = onlineSolveOf(item);
  setPhotoOnlineSolve(item.photo.id, solve).then(
    () => {
      if (item.photo) item.photo = { ...item.photo, ...(solve ? { onlineSolve: solve } : {}) };
    },
    (err) => reportUnknownRendererError('batch-keep-online-solve', err),
  );
}

async function handleSolveSuccess(item: BatchItem, result: PlateSolveResult) {
  const correspondences = result.correspondences!;
  let found = result.dsoIds ?? [];
  if (found.length === 0) {
    const bm = await createImageBitmap(item.file).catch(() => null);
    found = findDSOIdsFromCorrespondences(correspondences, bm?.width || 0, bm?.height || 0);
    bm?.close();
  }
  if (cancelled) return;
  item.dsoIds = [...new Set([...item.dsoIds, ...found])];
  item.solveCorrespondences = correspondences;
  item.manualPlacement = null;
  item.status = 'success';
  item.placedBy = item.solver === 'astrometry' ? 'online' : 'local';
  item.online = null;
  markChanged(item, { placement: true });
}

/** The end of a solve that did not place the photo: failed, canceled, or still going on on astrometry.net. */
function handleSolveError(item: BatchItem, err: any) {
  if (cancelled) return;
  if (err?.code === 'SOLVE_UNFINISHED') {
    item.status = 'unfinished';
    item.error = '';
    item.diagnostics = undefined;
    keepOnlineSolve(item);
    showToast({ message: t('batch.statusUnfinished'), type: 'warning', duration: 6000 });
    return;
  }
  const wasCanceled = err?.name === 'AbortError' || err?.code === 'SOLVE_CANCELED';
  // A canceled online solve goes on on astrometry.net: it stays "En cours", its result fetched later.
  if (wasCanceled && item.solver === 'astrometry' && item.online?.submissionId) {
    item.status = 'unfinished';
    keepOnlineSolve(item);
    return;
  }
  item.status = wasCanceled ? 'canceled' : 'failed';
  item.error = wasCanceled ? '' : err?.message || t('batch.statusFailed');
  if (wasCanceled) item.diagnostics = undefined;
}

function startTimer(item: BatchItem) {
  item.elapsedSeconds = 0;
  item.solveTimer = setInterval(() => {
    item.elapsedSeconds++;
  }, 1000);
}

async function solveItem(item: BatchItem) {
  if (cancelled || item.status === 'solving') return;
  if (!isSolverAvailable(item.solver)) {
    item.status = 'failed';
    item.error = t('batch.noSolverConfigured');
    item.diagnostics = undefined;
    return;
  }
  item.status = 'solving';
  item.error = '';
  item.diagnostics = undefined;
  startTimer(item);
  try {
    let result: PlateSolveResult;
    const hints = item.hintCoords
      ? { ra: item.hintCoords.ra, dec: item.hintCoords.dec, fov: item.fovDeg ?? undefined }
      : item.fovDeg != null
        ? { fov: item.fovDeg }
        : undefined;

    item.solveAbort = new AbortController();
    if (item.solver === 'solve-field' || item.solver === 'astap') {
      const endpoint = item.solver === 'solve-field' ? '/api/solve-field' : '/api/solve-astap';
      const { jobId } = await submitLocalSolveJob(
        endpoint,
        solveInputFile(item.solver, item.rawFile ?? null, item.file),
        hints,
        item.solveAbort.signal,
      );
      item.localJobId = jobId;
      result = await pollUntilLocalDone(item, endpoint, jobId, item.solveAbort.signal);
    } else {
      const sent = solveInputFile('astrometry', item.rawFile ?? null, item.file);
      const { jobId } = await submitPlateSolve(
        sent,
        onlineSolveHints(item.hintCoords, item.fovDeg),
      );
      item.online = {
        sentAt: new Date().toISOString(),
        jobId,
        fits: /\.(fits?|fts)$/i.test(sent.name),
      };
      result = await pollUntilDone(item, jobId, item.solveAbort.signal);
    }
    if (cancelled) return;
    if (result.success && result.correspondences && result.correspondences.length >= 1) {
      await handleSolveSuccess(item, result);
    } else if (result.code === 'SOLVE_CANCELED') {
      handleSolveError(item, { code: 'SOLVE_CANCELED' });
    } else {
      item.status = 'failed';
      item.error = result.error || t('batch.statusFailed');
      item.diagnostics = result.diagnostics;
    }
  } catch (err) {
    handleSolveError(item, err);
  } finally {
    cleanupItem(item);
  }
}

/** "Récupérer le résultat d'astrometry.net": follows the submission again, nothing is uploaded. */
async function fetchOnline(item: BatchItem) {
  const submissionId = item.online?.submissionId;
  if (!submissionId || item.status === 'solving') return;
  if (item.photo && isFollowingStoredSolve(item.photo.id)) return;
  item.solver = 'astrometry';
  item.status = 'solving';
  startTimer(item);
  item.solveAbort = new AbortController();
  try {
    const { jobId } = await resumePlateSolve(item.rawFile ?? item.file, submissionId, {
      fits: item.online!.fits,
    });
    item.online!.jobId = jobId;
    const result = await pollUntilDone(item, jobId, item.solveAbort.signal);
    if (cancelled) return;
    if (result.success && result.correspondences?.length) await handleSolveSuccess(item, result);
  } catch (err) {
    handleSolveError(item, err);
  } finally {
    cleanupItem(item);
  }
}

// The run: local solves share `maxParallel` slots, online ones start at once, one second apart.
const localQueue: BatchItem[] = [];
let localActive = 0;
let onlineStagger = 0;

function pumpLocal() {
  while (localActive < maxParallel() && localQueue.length > 0) {
    const item = localQueue.shift()!;
    if (!items.includes(item) || item.status !== 'waiting') continue;
    item.status = 'pending';
    localActive++;
    void solveItem(item).finally(() => {
      localActive--;
      if (!cancelled) pumpLocal();
    });
  }
}

function enqueueSolves(toSolve: BatchItem[]) {
  for (const item of toSolve) {
    if (needsConversion(item) && item.status === 'failed') {
      retryConversion(item);
      continue;
    }
    if (item.solver === 'astrometry') {
      const delay = onlineStagger++ * 1000;
      item.status = 'waiting';
      setTimeout(() => {
        onlineStagger = Math.max(0, onlineStagger - 1);
        if (cancelled || item.status !== 'waiting') return;
        item.status = 'pending';
        void solveItem(item);
      }, delay);
    } else {
      item.status = 'waiting';
      localQueue.push(item);
    }
  }
  pumpLocal();
}

/** "Résoudre N photos": every photo to place, failed or canceled, each with its own solver. */
function startSolving() {
  enqueueSolves(items.filter(isSolvable));
}

/** A photo's own "Résoudre" row. */
function solveOne(item: BatchItem, solver: SolverType) {
  if (!isSolvable(item)) return;
  item.solver = solver;
  enqueueSolves([item]);
}

function cancelItem(item: BatchItem) {
  item.solveAbort?.abort();
}

/** "Annuler la résolution": stops every photo being solved or waiting; the others stay as they are. */
function cancelAllSolving() {
  localQueue.length = 0;
  for (const item of items) {
    if (item.status === 'solving') {
      item.solveAbort?.abort();
    } else if (item.status === 'waiting') {
      cleanupItem(item);
      item.status = 'canceled';
    }
  }
}

// ─── Saving ───────────────────────────────────────────────────────────────────
const saveApi: BatchSaveApi = {
  upload: (file, correspondences, manualPlacement, onProgress, metadata) =>
    uploadPhoto(file, correspondences, manualPlacement, onProgress, metadata),
  updateMetadata: (id, metadata) => updatePhotoMetadata(id, metadata),
  setPlacement: (id, placement) => setPhotoPlacement(id, placement),
  setOnlineSolve: (id, solve) => setPhotoOnlineSolve(id, solve),
  saveFitsHeaders: (id, cards) => setPhotoFitsHeaders(id, cards),
};

/** "Enregistrer N photos": stores the new ones, saves the changed ones again. The window stays open. */
async function saveAll() {
  if (saving.value) return;
  saving.value = true;
  const overlay = canvasStore.overlay;
  try {
    for (const item of items.filter(needsSaving)) {
      const isNew = !item.photo;
      try {
        const photo = await saveBatchItem(item, saveApi);
        if (isNew) overlay?.placeUploadedPhoto(photo);
        else overlay?.updatePhotoData(photo);
      } catch {
        // The item shows why (saveError); the others are still saved.
      }
    }
  } finally {
    saving.value = false;
    photosStore.syncFromOverlay();
    canvasStore.gallery?.loadPhotos(storedPhotos());
  }
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
  } else if (docClickForTooltip) {
    document.removeEventListener('click', docClickForTooltip);
    docClickForTooltip = null;
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
  if (!infoTooltipVisible.value) return;
  infoTooltipStyle.value = { position: 'fixed' }; // measure its full height, not the last opening's
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
  // Never above the window: a window shorter than the text scrolls it instead.
  top = Math.max(20, top);
  infoTooltipStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    maxHeight: `${window.innerHeight - top - 20}px`,
    overflowY: 'auto',
  };
}
</script>
