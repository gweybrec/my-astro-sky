<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="requestClose">
      <!-- `w-fit`: the modal is as wide as its widest row, no wider. At `.modal`'s
           default 90vw/960px the name column stretched and left a ~570px void
           between each name and its edit widget. -->
      <div class="modal !w-fit !min-w-[480px] !max-w-[92vw]" @click.stop>
        <!-- Header -->
        <div class="modal-header">
          <h2>
            {{
              isLabelMode ? t('gallery.batchEdit.titleLabels') : t('gallery.batchEdit.titleSetups')
            }}
          </h2>
          <button class="modal-close" :title="t('gallery.cancelEdit')" @click="requestClose">
            &times;
          </button>
        </div>

        <!-- Sub-header: the value applied to every checked photo on save. `items-end`
             (the bar centers by default) lines the search box up with the labelled
             widget beside it instead of with the middle of its two-line column. -->
        <div class="batch-labels-bar !items-end">
          <div class="batch-labels-bar-main">
            <div class="flex items-center gap-2">
              <span class="batch-labels-bar-title">{{
                isLabelMode
                  ? t('gallery.batchEdit.labelsForChecked')
                  : t('gallery.batchEdit.setupForChecked')
              }}</span>
              <span
                ref="infoIconEl"
                class="hints-info-icon"
                :title="t('gallery.batchEdit.info')"
                @click.stop="toggleInfo"
                >ℹ</span
              >
            </div>
            <LabelTagInput
              v-if="isLabelMode"
              v-model="pendingLabels"
              :known="knownLabels"
              input-class="!h-[32px] !py-0"
              class="w-full"
            />
            <select v-else class="dialog-input !w-[240px] !h-[32px] !py-0" v-model="pendingSetupId">
              <option :value="SETUP_NO_CHANGE">{{ t('gallery.batchEdit.noChange') }}</option>
              <option value="">{{ t('modal.metadataGearSetupNone') }}</option>
              <option v-for="s in gearSetups" :key="s.id" :value="s.id">
                {{ s.name || s.id }}
              </option>
            </select>
          </div>
          <input
            type="text"
            class="dialog-input !w-[220px] !h-[32px] !py-0 shrink-0"
            :placeholder="t('photos.searchPlaceholder')"
            v-model="searchQuery"
          />
        </div>

        <!-- Photo list. One grid for the whole table (not one per row) so `max-content`
             sizes the name column to the widest name and every row lines up by
             construction — the name then sits beside its widget instead of across a
             void. `!pt-0`: the scroll container's own top padding would offset the
             sticky header cells; they carry that padding instead. -->
        <!-- `!grid` / `!gap-*`: .modal-form-body--scroll is a flex column, so the
             display and gap must be overridden for the table layout. -->
        <div
          class="modal-form-body--scroll !grid !gap-x-4 !gap-y-0 !pt-0 !overflow-x-hidden items-center"
          :class="gridColsClass"
        >
          <!-- Header row 1: the three column captions, on one line. -->
          <span
            class="text-micro text-dim text-center sticky top-0 z-1 bg-[var(--bg-deep)] pt-3 h-full flex items-end justify-center"
            >{{ t('gallery.batchEdit.applyToColumn') }}</span
          >
          <span
            class="text-micro text-dim sticky top-0 z-1 bg-[var(--bg-deep)] pt-3 h-full flex items-end"
            >{{ t('gallery.batchEdit.photoColumn') }}</span
          >
          <span
            class="text-micro text-dim sticky top-0 z-1 bg-[var(--bg-deep)] pt-3 h-full flex items-end"
            >{{
              isLabelMode ? t('gallery.batchEdit.labelsColumn') : t('gallery.batchEdit.setupColumn')
            }}</span
          >

          <!-- Header row 2: the select-all box alone. `top-[19px]` = the measured
               height of the caption row above, so both stay stuck together. -->
          <label
            class="flex justify-center cursor-pointer sticky top-[19px] z-1 bg-[var(--bg-deep)] pt-1 pb-2 border-b border-[var(--border-subtle)]"
          >
            <input
              ref="selectAllRef"
              type="checkbox"
              :title="t('display.selectAll')"
              :checked="allChecked"
              @change="toggleAll(($event.target as HTMLInputElement).checked)"
            />
          </label>
          <span
            aria-hidden="true"
            class="sticky top-[19px] z-1 bg-[var(--bg-deep)] pt-1 pb-2 border-b border-[var(--border-subtle)] h-full"
          ></span>
          <span
            aria-hidden="true"
            class="sticky top-[19px] z-1 bg-[var(--bg-deep)] pt-1 pb-2 border-b border-[var(--border-subtle)] h-full"
          ></span>

          <div v-if="visiblePhotos.length === 0" class="col-span-3 px-6 py-3 text-muted text-base">
            {{ photos.length === 0 ? t('gallery.noPhotos') : t('gallery.noMatches') }}
          </div>

          <template v-for="photo in visiblePhotos" :key="photo.id">
            <input
              type="checkbox"
              class="batch-row-check justify-self-center py-2 border-b border-[var(--border-subtle)] h-full"
              :title="t('gallery.batchEdit.applyToColumn')"
              :checked="checked.has(photo.id)"
              @change="toggleOne(photo.id, ($event.target as HTMLInputElement).checked)"
            />
            <!-- max-w caps the max-content column so one very long name can't widen
                 the whole table; it truncates and keeps its title tooltip instead. -->
            <span
              class="batch-row-name truncate max-w-[320px] text-base text-label py-2 border-b border-[var(--border-subtle)] h-full flex items-center"
              :title="photo.originalName"
              >{{ photo.originalName }}</span
            >
            <div
              class="batch-row-widget py-2 border-b border-[var(--border-subtle)] h-full flex items-center"
            >
              <LabelTagInput
                v-if="isLabelMode"
                :model-value="draftFor(photo).labels"
                :known="knownLabels"
                input-class="!h-[32px] !py-0"
                class="w-full"
                @update:model-value="(labels) => setDraftLabels(photo.id, labels)"
              />
              <select
                v-else
                class="dialog-input !h-[32px] !py-0 !text-base !text-secondary"
                :value="draftFor(photo).gearSetupId ?? ''"
                @change="setDraftSetup(photo.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ t('modal.metadataGearSetupNone') }}</option>
                <option v-for="s in gearSetups" :key="s.id" :value="s.id">
                  {{ s.name || s.id }}
                </option>
              </select>
            </div>
          </template>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <button class="btn-confirm" :disabled="saving || edits.length === 0" @click="save">
            {{ saving ? '…' : t('gallery.saveMetadata') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import type { Photo } from '../../types';
import type { GearSetupData } from '../../api';
import { getGearSetups, updatePhotoMetadata } from '../../api';
import { useCanvasStore } from '../../stores/canvas';
import { usePhotosStore } from '../../stores/photos';
import { useI18n } from '../../composables/useI18n';
import { smartSortPhotos } from '../../gallery';
import {
  SETUP_NO_CHANGE,
  applyBatchEdit,
  buildMetadataPayload,
  collectBatchEdits,
  draftFromPhoto,
  type BatchEditMode,
  type PhotoEditDraft,
} from '../../batch-photo-edit';
import { confirmUnsavedChanges } from '../../photo-delete-confirm';
import { showTextTooltip } from '../../tooltip-utils';
import { showToast } from '../../toast';
import { reportUnknownRendererError } from '../../error-reporter';
import LabelTagInput from '../base/LabelTagInput.vue';

const props = defineProps<{ mode: BatchEditMode }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const { t } = useI18n();
const canvasStore = useCanvasStore();
const photosStore = usePhotosStore();

const isLabelMode = computed(() => props.mode === 'label');
// Fixed first column (so the header and the rows line up despite being separate
// grids) and a wider value column for the label chips than for the setup dropdown.
// `max-content` on the name column: CSS sizes it to the widest name across the whole
// table, so names sit next to their widget with no void, and every row aligns.
const gridColsClass = computed(() =>
  isLabelMode.value ? 'grid-cols-[4rem_max-content_340px]' : 'grid-cols-[4rem_max-content_240px]',
);

// ── Photos (every photo, gallery filters deliberately ignored) ─────────────────
const photos = ref<Photo[]>(
  smartSortPhotos(canvasStore.overlay?.getPlacedPhotos().map((p) => p.photo) ?? []),
);

const knownLabels = computed(() => [...new Set(photos.value.flatMap((p) => p.labels))]);

const searchQuery = ref('');
const visiblePhotos = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return photos.value;
  return photos.value.filter(
    (p) =>
      p.originalName.toLowerCase().includes(q) || p.labels.some((l) => l.toLowerCase().includes(q)),
  );
});

// ── Drafts (per-row edits) + checked set (bulk apply targets) ──────────────────
const drafts = reactive(new Map<string, PhotoEditDraft>());
const checked = reactive(new Set<string>());

function draftFor(photo: Photo): PhotoEditDraft {
  let draft = drafts.get(photo.id);
  if (!draft) {
    draft = draftFromPhoto(photo);
    drafts.set(photo.id, draft);
  }
  return draft;
}

function setDraftLabels(photoId: string, labels: string[]) {
  const draft = drafts.get(photoId);
  if (draft) drafts.set(photoId, { ...draft, labels });
}

function setDraftSetup(photoId: string, setupId: string) {
  const draft = drafts.get(photoId);
  if (draft) drafts.set(photoId, { ...draft, gearSetupId: setupId || null });
}

function toggleOne(photoId: string, isChecked: boolean) {
  if (isChecked) checked.add(photoId);
  else checked.delete(photoId);
}

// Select-all applies to the rows currently visible (the search filters the list).
function toggleAll(isChecked: boolean) {
  for (const photo of visiblePhotos.value) toggleOne(photo.id, isChecked);
}

const allChecked = computed(
  () => visiblePhotos.value.length > 0 && visiblePhotos.value.every((p) => checked.has(p.id)),
);
const someChecked = computed(() => visiblePhotos.value.some((p) => checked.has(p.id)));

const selectAllRef = ref<HTMLInputElement>();
watch([allChecked, someChecked], () => {
  if (selectAllRef.value) selectAllRef.value.indeterminate = someChecked.value && !allChecked.value;
});

// ── Sub-header (applied to checked photos on save) ─────────────────────────────
const pendingLabels = ref<string[]>([]);
const pendingSetupId = ref<string>(SETUP_NO_CHANGE);

const edits = computed(() =>
  collectBatchEdits(props.mode, photos.value, drafts, checked, {
    labels: pendingLabels.value,
    setupId: pendingSetupId.value,
  }),
);

// ── Gear setups ───────────────────────────────────────────────────────────────
const gearSetups = ref<GearSetupData[]>([]);

onMounted(async () => {
  try {
    const setups = await getGearSetups();
    gearSetups.value = setups;
    // Push into the gallery too so its setup chips/filter resolve names, exactly
    // like GalleryFilterBar.refreshSetups() does.
    canvasStore.gallery?.setGearSetups(setups);
  } catch (err) {
    reportUnknownRendererError('batch_photo_edit_setups', err);
  }
});

// ── Info tooltip ──────────────────────────────────────────────────────────────
const infoIconEl = ref<HTMLElement>();

function toggleInfo() {
  if (infoIconEl.value) showTextTooltip(infoIconEl.value, t('gallery.batchEdit.info'));
}

// ── Close (with unsaved-changes guard) ────────────────────────────────────────
const saving = ref(false);

async function requestClose() {
  if (saving.value) return;
  if (edits.value.length > 0 && !(await confirmUnsavedChanges())) return;
  emit('close');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') void requestClose();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

// ── Save ──────────────────────────────────────────────────────────────────────
async function save() {
  const pendingEdits = edits.value;
  if (pendingEdits.length === 0 || saving.value) return;
  saving.value = true;

  const updated: Photo[] = [];
  let failed = 0;

  for (const edit of pendingEdits) {
    try {
      await updatePhotoMetadata(
        edit.photo.id,
        buildMetadataPayload(edit.photo, { labels: edit.labels, gearSetupId: edit.gearSetupId }),
      );
      updated.push(applyBatchEdit(edit));
    } catch (err) {
      failed++;
      reportUnknownRendererError('batch_photo_edit_save', err, {
        photoId: edit.photo.id,
        mode: props.mode,
      });
    }
  }

  if (updated.length > 0) {
    // One overlay call for the whole batch → a single map re-render + gallery reload.
    canvasStore.overlay?.updatePhotosData(updated);
    photosStore.syncFromOverlay();
    // Re-seed the saved rows so they stop counting as unsaved changes.
    for (const photo of updated) {
      const idx = photos.value.findIndex((p) => p.id === photo.id);
      if (idx !== -1) photos.value[idx] = photo;
      drafts.set(photo.id, draftFromPhoto(photo));
    }
    pendingLabels.value = [];
    pendingSetupId.value = SETUP_NO_CHANGE;
    checked.clear();
    emit('saved');
  }

  saving.value = false;

  if (failed > 0) {
    showToast({
      message: t('gallery.batchEdit.saveError', { count: String(failed) }),
      type: 'error',
      duration: 4000,
    });
    return;
  }

  showToast({
    message: t('gallery.batchEdit.savedToast', { count: String(updated.length) }),
    type: 'info',
    duration: 2500,
  });
  emit('close');
}
</script>
