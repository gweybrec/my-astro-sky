<template>
  <div class="flex flex-col gap-6" data-test="metadata-sheet">
    <!-- ── Objects ─────────────────────────────────────────────────────────── -->
    <SheetSection
      id="sheet-objects"
      :title="t('modal.metadataDsos')"
      :summary="summaries.objects"
      data-test="sheet-objects"
    >
      <template #actions="{ expand }">
        <button
          type="button"
          :class="addingDso ? 'sheet-icon-btn--on' : 'sheet-icon-btn'"
          :title="t('gallery.sheet.addObject')"
          :aria-label="t('gallery.sheet.addObject')"
          :aria-expanded="addingDso"
          data-test="add-object"
          @click="addingDso ? closeAddDso() : (expand(), openAddDso())"
          v-html="plusSvg"
        ></button>
      </template>
      <div v-if="addingDso" class="relative mb-1">
        <input
          ref="dsoInputEl"
          v-model="dsoQuery"
          type="text"
          class="sheet-input"
          :placeholder="t('modal.metadataDsosPlaceholder')"
          :aria-label="t('gallery.sheet.addObject')"
          data-test="object-search"
          @input="onDsoInput"
          @keydown.enter.prevent="addDsoFromInput"
          @keydown.esc.stop.prevent="closeAddDso"
          @blur="onAddBlur(closeAddDso)"
        />
        <div v-if="dsoResults.length" class="tag-suggest" role="listbox">
          <div
            v-for="r in dsoResults"
            :key="r.dso.id"
            class="tag-suggest-item"
            role="option"
            data-test="object-suggestion"
            @mousedown.prevent="addDso(r.dso.id)"
          >
            {{ r.dso.id }}{{ r.dso.displayName ? ` — ${r.dso.displayName}` : '' }}
          </div>
        </div>
      </div>
      <div v-if="sortedDsoIds.length" ref="dsoChipsEl" class="tag-chips" data-test="object-chips">
        <span
          v-for="(id, i) in sortedDsoIds"
          v-show="showAllDsos || measuringDsos || i < dsoFoldCount"
          :key="id"
          class="tag-chip group"
        >
          {{ id }}
          <button
            type="button"
            class="tag-chip-remove opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            :title="t('gallery.sheet.remove', { name: id })"
            :aria-label="t('gallery.sheet.remove', { name: id })"
            @click="removeDso(id)"
          >
            ×
          </button>
        </span>
      </div>
      <button
        v-if="dsoFoldCount < sortedDsoIds.length"
        type="button"
        class="sheet-fold"
        :aria-expanded="showAllDsos"
        data-test="objects-fold"
        @click="showAllDsos = !showAllDsos"
      >
        <span
          class="inline-flex [&>svg]:w-[12px] [&>svg]:h-[12px]"
          v-html="showAllDsos ? chevronUpSvg : chevronDownSvg"
        ></span>
        {{
          showAllDsos
            ? t('gallery.sheet.collapse')
            : t('gallery.sheet.showAllObjects', { n: String(sortedDsoIds.length) })
        }}
      </button>
    </SheetSection>

    <!-- ── Acquisition ─────────────────────────────────────────────────────── -->
    <SheetSection
      id="sheet-acquisition"
      :title="t('gallery.sheet.sectionAcquisition')"
      :summary="summaries.acquisition"
      data-test="sheet-acquisition"
    >
      <InlineEditRow
        :label="t('gallery.sheet.date')"
        icon="calendar"
        popup
        :edit-label="t('gallery.sheet.chooseDate')"
        :value-class="dateText ? '' : 'sheet-value--dim'"
        :save="saveDate"
        test-id="row-date"
      >
        {{ dateText ?? t('gallery.sheet.dateNotSet') }}
        <template #editor="{ commit, cancel, busy }">
          <DateTimePicker
            :value="dateLocal"
            :busy="busy"
            @confirm="
              (v) => {
                pendingDate = v;
                commit();
              }
            "
            @cancel="cancel"
          />
        </template>
      </InlineEditRow>
    </SheetSection>

    <!-- ── Equipment and exposures ─────────────────────────────────────────── -->
    <SheetSection
      id="sheet-gear"
      :title="t('gallery.sheet.sectionGear')"
      :summary="summaries.gear"
      data-test="sheet-gear"
    >
      <template #actions="{ expand }">
        <button
          type="button"
          class="sheet-icon-btn"
          :title="t('gallery.sheet.addExposure')"
          :aria-label="t('gallery.sheet.addExposure')"
          data-test="add-exposure"
          @click="(expand(), addIntegrationRow())"
          v-html="plusSvg"
        ></button>
      </template>

      <InlineEditRow
        :label="t('modal.metadataGearSetup')"
        :edit-label="t('gallery.sheet.edit')"
        :value-class="setupName ? '' : 'sheet-value--dim'"
        :save="saveSetup"
        test-id="row-setup"
        @open="setupBuf = draft.gearSetupId ?? ''"
      >
        {{ setupName ?? t('gallery.sheet.noSetup') }}
        <template #editor>
          <select v-model="setupBuf" class="sheet-input" data-test="setup-select">
            <option value="">{{ t('modal.metadataGearSetupNone') }}</option>
            <option v-for="s in gearSetups" :key="s.id" :value="s.id">{{ s.name || s.id }}</option>
          </select>
        </template>
      </InlineEditRow>

      <!-- No exposure yet: a placeholder whose pen opens a new row's editor. -->
      <div v-if="rows.length === 0" class="sheet-row group" data-test="row-no-exposure">
        <span class="sheet-value col-span-2 sheet-value--dim">{{
          t('gallery.sheet.noIntegration')
        }}</span>
        <button
          type="button"
          class="sheet-icon-btn"
          :title="t('gallery.sheet.addExposure')"
          :aria-label="t('gallery.sheet.addExposure')"
          data-test="row-edit"
          @click="addIntegrationRow"
          v-html="penSvg"
        ></button>
      </div>

      <InlineEditRow
        v-for="row in rows"
        :key="row._id"
        :start-open="row._new"
        wide
        removable
        :edit-label="t('modal.metadataIntegrationsEditRow')"
        :remove-label="t('modal.metadataIntegrationsRemoveRow')"
        :save="() => saveIntegrationRow(row._id)"
        test-id="row-exposure"
        @open="openIntegrationRow(row._id)"
        @cancel="cancelIntegrationRow(row._id)"
        @remove="removeIntegrationRow(row._id)"
      >
        <span class="flex items-center gap-3 min-w-0">
          <span v-if="integrationRowText(row, naText, secondsSuffix)" class="flex-none">{{
            integrationRowText(row, naText, secondsSuffix)
          }}</span>
          <span
            v-if="row.filter"
            :class="filterBadgeAttrs(row.filter).class"
            :style="filterBadgeAttrs(row.filter).style"
            :title="catalogBadgeTitle(row.filter) ?? row.filter"
            class="min-w-0 truncate"
            >{{ row.filter }}</span
          >
        </span>
        <template #editor>
          <input
            type="number"
            min="0"
            step="1"
            class="sheet-input !w-[52px] !px-2"
            :placeholder="t('modal.metadataIntegrationsFramesPlaceholder')"
            :title="t('modal.metadataIntegrationsFramesTooltip')"
            :value="buffer(row._id).frames || ''"
            data-test="exposure-frames"
            @input="buffer(row._id).frames = wholeNumber($event)"
          />
          <span class="text-dim">×</span>
          <input
            type="number"
            min="0"
            step="1"
            class="sheet-input !w-[52px] !px-2"
            :placeholder="t('modal.metadataIntegrationsSecondsPlaceholder')"
            :title="t('modal.metadataIntegrationsSecondsTooltip')"
            :value="buffer(row._id).seconds || ''"
            data-test="exposure-seconds"
            @input="buffer(row._id).seconds = wholeNumber($event)"
          />
          <span class="text-base text-dim">{{ secondsSuffix }}</span>
          <FilterInput
            :model-value="buffer(row._id).filter"
            :known-filter-map="knownFilterMap"
            :placeholder="t('modal.metadataIntegrationsFilterPlaceholder')"
            :tooltip="t('modal.metadataIntegrationsFilterTooltip')"
            @update:model-value="(v) => (buffer(row._id).filter = v)"
            @commit="rememberFilter"
          />
        </template>
      </InlineEditRow>

      <div v-if="totalText" class="sheet-row hover:!bg-transparent" data-test="row-total">
        <!-- Starts at the left edge, like the exposure lines above it. -->
        <span class="sheet-value col-span-2 flex items-baseline gap-3">
          <span class="text-base text-label">{{ t('gallery.sheet.total') }}</span>
          <span class="font-medium text-bright">{{ totalText }}</span>
        </span>
      </div>
    </SheetSection>

    <!-- ── Points of interest ──────────────────────────────────────────────── -->
    <SheetSection
      id="sheet-pois"
      :title="t('modal.metadataPoi')"
      :summary="summaries.pois"
      data-test="sheet-pois"
    >
      <template #actions="{ expand }">
        <button
          type="button"
          :class="poiMenuOpen ? 'sheet-icon-btn--on' : 'sheet-icon-btn'"
          :title="t('gallery.sheet.addPoi')"
          :aria-label="t('gallery.sheet.addPoi')"
          :aria-expanded="poiMenuOpen"
          data-test="add-poi"
          @click="(expand(), (poiMenuOpen = !poiMenuOpen))"
          v-html="plusSvg"
        ></button>
        <div
          v-if="poiMenuOpen"
          ref="poiMenuEl"
          class="sheet-pop right-0 top-full mt-1 min-w-[220px]"
          role="menu"
          data-test="poi-menu"
        >
          <button
            type="button"
            class="sheet-pop-item"
            role="menuitem"
            :disabled="!isSolved"
            :title="isSolved ? undefined : t('poi.addNeedsSolve')"
            @click="runPoi(triggerPoiAddModal, 'poi.added')"
          >
            {{ t('gallery.sheet.addPoi') }}
          </button>
          <template v-if="isSolved">
            <button
              type="button"
              class="sheet-pop-item"
              role="menuitem"
              @click="runPoi(triggerAsteroidModal, 'asteroid.added')"
            >
              {{ t('asteroid.menuLabel') }}
            </button>
            <button
              type="button"
              class="sheet-pop-item"
              role="menuitem"
              @click="runPoi(triggerSupernovaModal, 'supernova.added')"
            >
              {{ t('supernova.menuLabel') }}
            </button>
            <button
              type="button"
              class="sheet-pop-item"
              role="menuitem"
              @click="runPoi(triggerCometModal, 'comet.added')"
            >
              {{ t('comet.menuLabel') }}
            </button>
          </template>
        </div>
      </template>
      <div v-if="draft.pointsOfInterest.length" class="tag-chips" data-test="poi-chips">
        <span
          v-for="(poi, idx) in draft.pointsOfInterest"
          :key="`${poi.categoryId}|${poi.name}|${idx}`"
          class="tag-chip poi-chip group"
          :class="{ 'poi-chip--icon': poiTypeIcon(poi.categoryId) }"
          :style="{ '--poi-color': resolveCategory(poi.categoryId, categories).color }"
          :title="resolveCategory(poi.categoryId, categories).name"
        >
          <span
            v-if="poiTypeIcon(poi.categoryId)"
            class="poi-marker"
            v-html="poiTypeIcon(poi.categoryId)"
          ></span>
          {{ poi.name }}
          <button
            type="button"
            class="tag-chip-remove opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            :title="t('gallery.sheet.remove', { name: poi.name })"
            :aria-label="t('gallery.sheet.remove', { name: poi.name })"
            @click="removePoi(idx)"
          >
            ×
          </button>
        </span>
      </div>
    </SheetSection>

    <!-- ── Labels ──────────────────────────────────────────────────────────── -->
    <SheetSection
      id="sheet-labels"
      :title="t('modal.metadataLabels')"
      :summary="summaries.labels"
      data-test="sheet-labels"
    >
      <template #actions="{ expand }">
        <button
          type="button"
          :class="addingLabel ? 'sheet-icon-btn--on' : 'sheet-icon-btn'"
          :title="t('gallery.sheet.addLabel')"
          :aria-label="t('gallery.sheet.addLabel')"
          :aria-expanded="addingLabel"
          data-test="add-label"
          @click="addingLabel ? closeAddLabel() : (expand(), openAddLabel())"
          v-html="plusSvg"
        ></button>
      </template>
      <div v-if="addingLabel" class="relative mb-1">
        <input
          ref="labelInputEl"
          v-model="labelQuery"
          type="text"
          class="sheet-input"
          :placeholder="t('modal.metadataLabelsPlaceholder')"
          :aria-label="t('gallery.sheet.addLabel')"
          data-test="label-input"
          @keydown="onLabelKeydown"
          @blur="onAddBlur(closeAddLabel)"
        />
        <div v-if="labelSuggestions.length" class="tag-suggest" role="listbox">
          <div
            v-for="s in labelSuggestions"
            :key="s"
            class="tag-suggest-item"
            role="option"
            data-test="label-suggestion"
            @mousedown.prevent="addLabel(s)"
          >
            {{ s }}
          </div>
        </div>
      </div>
      <div v-if="draft.labels.length" class="tag-chips" data-test="label-chips">
        <span v-for="lbl in draft.labels" :key="lbl" class="tag-chip label-chip group">
          {{ lbl }}
          <button
            type="button"
            class="tag-chip-remove opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            :title="t('gallery.sheet.remove', { name: lbl })"
            :aria-label="t('gallery.sheet.remove', { name: lbl })"
            @click="removeLabel(lbl)"
          >
            ×
          </button>
        </span>
      </div>
    </SheetSection>

    <!-- ── Capture details (binning, temperatures, gain…) ──────────────────── -->
    <SheetSection
      id="sheet-capture"
      :title="t('modal.metadataCapture')"
      :summary="summaries.capture"
      data-test="sheet-capture"
    >
      <template #actions="{ expand }">
        <button
          ref="captureAddBtn"
          type="button"
          :class="captureMenuOpen ? 'sheet-icon-btn--on' : 'sheet-icon-btn'"
          :disabled="addableCaptureFields.length === 0"
          :title="t('gallery.sheet.addCapture')"
          :aria-label="t('gallery.sheet.addCapture')"
          :aria-expanded="captureMenuOpen"
          data-test="add-capture"
          @click="(expand(), (captureMenuOpen = !captureMenuOpen))"
          v-html="plusSvg"
        ></button>
        <div
          v-if="captureMenuOpen"
          ref="captureMenuEl"
          class="sheet-pop right-0 top-full mt-1 min-w-[180px]"
          role="menu"
          data-test="capture-menu"
        >
          <button
            v-for="f in addableCaptureFields"
            :key="f.id"
            type="button"
            class="sheet-pop-item"
            role="menuitem"
            @click="addCaptureField(f.id)"
          >
            {{ t(f.labelKey) }}
          </button>
        </div>
      </template>

      <InlineEditRow
        v-for="f in shownCaptureFields"
        :key="f.id"
        :label="t(f.labelKey)"
        :start-open="f.id === pendingCapture"
        removable
        :edit-label="t('gallery.sheet.edit')"
        :remove-label="t('modal.metadataCaptureRemove')"
        :save="() => saveCapture(f.id)"
        :test-id="`row-capture-${f.id}`"
        @open="captureBuf = String(draft.captureDetails[f.id] ?? '')"
        @cancel="onCaptureCancel(f.id)"
        @remove="removeCapture(f.id)"
      >
        {{ captureText(f.id) }}
        <template #editor>
          <input
            v-model="captureBuf"
            :type="f.type === 'number' ? 'number' : 'text'"
            class="sheet-input"
            data-test="capture-input"
          />
          <span v-if="f.unit" class="text-base text-dim">{{ f.unit }}</span>
        </template>
      </InlineEditRow>
    </SheetSection>

    <!-- ── Notes ───────────────────────────────────────────────────────────── -->
    <SheetSection
      id="sheet-notes"
      :title="t('modal.metadataNotes')"
      :summary="summaries.notes"
      data-test="sheet-notes"
    >
      <InlineEditRow
        wide
        :edit-label="t('gallery.sheet.edit')"
        :value-class="
          draft.notes.trim()
            ? '!whitespace-pre-wrap !overflow-visible text-secondary leading-[1.45]'
            : 'sheet-value--dim'
        "
        multiline
        :save="saveNotes"
        test-id="row-notes"
        @open="notesBuf = draft.notes"
      >
        {{ draft.notes.trim() || t('gallery.sheet.noNotes') }}
        <template #editor>
          <textarea
            v-model="notesBuf"
            class="notes-textarea"
            rows="3"
            :placeholder="t('modal.metadataNotesPlaceholder')"
            data-test="notes-input"
          ></textarea>
        </template>
      </InlineEditRow>
    </SheetSection>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, provide, onMounted, onBeforeUnmount } from 'vue';
import type { Photo, PhotoIntegration, PointOfInterest } from '@myastrosky/core/types';
import type { PhotoMetadataDraft } from '@myastrosky/core/photo-metadata-draft';
import { filterLabelCandidates } from '@myastrosky/core/photo-metadata-draft';
import { CAPTURE_FIELDS } from '@myastrosky/core/capture-fields';
import { searchDSOs } from '@myastrosky/core/search';
import { sortDsoIdsByImportance } from '@myastrosky/core/catalog/dso-registry';
import { isoToDatetimeLocal, datetimeLocalToIso } from '@myastrosky/core/datetime-local';
import { formatIntegrationTotal } from '@myastrosky/core/format-utils';
import { resolveCategory } from '@myastrosky/core/poi';
import { isPhotoSolved, mergeIdentifiedPois } from '@myastrosky/core/photo-identify';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import type { GearSetupData } from '../../api';
import { t, getLang } from '../../i18n';
import { showToast } from '../../toast';
import { filterBadgeAttrs, catalogBadgeTitle } from '../../chip-utils';
import { normalizeIntegrationFilterKey } from '../../batch-utils';
import { poiTypeIcon } from '../../poi-icons';
import {
  triggerAsteroidModal,
  triggerSupernovaModal,
  triggerCometModal,
  triggerPoiAddModal,
} from '../../ui';
import {
  foldedChipCount,
  integrationsTotalText,
  observationDateText,
} from '../../metadata-sheet-utils';
import { integrationRowHasData, integrationRowText } from '@myastrosky/core/integration-rows';
import InlineEditRow, { EDIT_TRACKER_KEY, type EditTracker } from '../base/InlineEditRow.vue';
import DateTimePicker from '../base/DateTimePicker.vue';
import SheetSection from '../base/SheetSection.vue';
import FilterInput from './FilterInput.vue';
import plusSvg from '../../icons/plus.svg?raw';
import penSvg from '../../icons/pen.svg?raw';

const chevronDownSvg =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const chevronUpSvg =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

/**
 * The gallery's photo information, read like a sheet: each fact is text with a pen, and becomes a field only while
 * it is changed. Every ✓ (and every chip added or removed) saves at once through `save`, which gives true once the
 * photo is saved; the draft it was given then holds the new values.
 */
const props = defineProps<{
  draft: PhotoMetadataDraft;
  gearSetups: GearSetupData[];
  knownFilterMap: Map<string, string>;
  knownLabels: string[];
  photo: Photo;
  save: (patch: Partial<PhotoMetadataDraft>) => Promise<boolean>;
}>();

const emit = defineEmits<{
  /** How many lines are being edited (the gallery asks before closing over unsaved typing). */
  editing: [count: number];
}>();

let editingCount = 0;
provide<EditTracker>(EDIT_TRACKER_KEY, {
  change(delta) {
    editingCount += delta;
    emit('editing', editingCount);
  },
});

/** A pop-up add field closes when it loses the focus (a suggestion is picked on mousedown, before that). */
function onAddBlur(close: () => void) {
  setTimeout(close, 150);
}

// ─── Objects ──────────────────────────────────────────────────────────────────
const sortedDsoIds = computed(() => sortDsoIdsByImportance(props.draft.dsoIds));
const addingDso = ref(false);
const dsoQuery = ref('');
const dsoResults = ref<ReturnType<typeof searchDSOs>>([]);
const dsoInputEl = ref<HTMLInputElement>();
let dsoTimer: ReturnType<typeof setTimeout> | null = null;

function openAddDso() {
  addingDso.value = true;
  void nextTick(() => dsoInputEl.value?.focus());
}
function closeAddDso() {
  addingDso.value = false;
  dsoQuery.value = '';
  dsoResults.value = [];
}
function onDsoInput() {
  if (dsoTimer) clearTimeout(dsoTimer);
  const q = dsoQuery.value.trim();
  if (!q) {
    dsoResults.value = [];
    return;
  }
  dsoTimer = setTimeout(() => {
    dsoResults.value = searchDSOs(q, 8).filter((r) => !props.draft.dsoIds.includes(r.dso.id));
  }, 200);
}
async function addDso(id: string) {
  if (!id || props.draft.dsoIds.includes(id)) return;
  if (await props.save({ dsoIds: [...props.draft.dsoIds, id] })) {
    dsoQuery.value = '';
    dsoResults.value = [];
    dsoInputEl.value?.focus();
  }
}
function addDsoFromInput() {
  void addDso(dsoQuery.value.trim().replace(/\s+/g, ''));
}
function removeDso(id: string) {
  void props.save({ dsoIds: props.draft.dsoIds.filter((d) => d !== id) });
}

// The list folds to three lines; the chips' tops are measured with all of them shown.
const dsoChipsEl = ref<HTMLElement>();
const showAllDsos = ref(false);
const measuringDsos = ref(false);
const dsoFoldCount = ref(Number.POSITIVE_INFINITY);
async function measureDsos() {
  measuringDsos.value = true;
  await nextTick();
  const el = dsoChipsEl.value;
  dsoFoldCount.value = el
    ? foldedChipCount(Array.from(el.children, (c) => (c as HTMLElement).offsetTop))
    : Number.POSITIVE_INFINITY;
  measuringDsos.value = false;
}
watch(sortedDsoIds, () => void measureDsos());
let resizeObserver: ResizeObserver | null = null;
let lastWidth = 0;
onMounted(() => {
  void measureDsos();
  if (typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    if (Math.abs(width - lastWidth) < 1) return;
    lastWidth = width;
    void measureDsos();
  });
  watch(
    dsoChipsEl,
    (el, old) => {
      if (old) resizeObserver?.unobserve(old);
      if (el) resizeObserver?.observe(el);
    },
    { immediate: true },
  );
});

// ─── Date ─────────────────────────────────────────────────────────────────────
const dateText = computed(() => observationDateText(props.draft.observationDate, getLang()));
const dateLocal = computed(() => isoToDatetimeLocal(props.draft.observationDate));
const pendingDate = ref('');
function saveDate(): Promise<boolean> {
  return props.save({ observationDate: datetimeLocalToIso(pendingDate.value) });
}

// ─── Exposure rows ────────────────────────────────────────────────────────────
// Local rows carry a stable key and `_new` (added with "+", not saved yet); each open row edits a buffer.
type Row = PhotoIntegration & { _id: number; _new: boolean };
let rowSeq = 0;
const toRows = (list: PhotoIntegration[]): Row[] =>
  list.map((r) => ({ ...r, _id: ++rowSeq, _new: false }));
const rows = ref<Row[]>(toRows(props.draft.integrations));
watch(
  () => props.draft.integrations,
  (next) => {
    // Rows just added and not yet saved stay at the end.
    rows.value = [...toRows(next), ...rows.value.filter((r) => r._new)];
  },
);
const buffers = reactive(new Map<number, PhotoIntegration>());
function buffer(id: number): PhotoIntegration {
  let b = buffers.get(id);
  if (!b) {
    const row = rows.value.find((r) => r._id === id);
    b = { frames: row?.frames ?? 0, seconds: row?.seconds ?? 0, filter: row?.filter ?? '' };
    buffers.set(id, b);
  }
  return b;
}
const naText = computed(() => t('modal.metadataIntegrationsFieldNA'));
const secondsSuffix = computed(() => t('modal.metadataIntegrationsSecondsSuffix'));
const totalText = computed(() => integrationsTotalText(props.draft.integrations));

function wholeNumber(e: Event): number {
  const n = Number.parseInt((e.target as HTMLInputElement).value, 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
function addIntegrationRow() {
  rows.value.push({ frames: 0, seconds: 0, filter: '', _id: ++rowSeq, _new: true });
}
function openIntegrationRow(id: number) {
  buffers.delete(id);
}
function cancelIntegrationRow(id: number) {
  buffers.delete(id);
  rows.value = rows.value.filter((r) => !(r._id === id && r._new));
}
const strip = (r: PhotoIntegration): PhotoIntegration => ({
  frames: r.frames,
  seconds: r.seconds,
  filter: r.filter,
});
async function saveIntegrationRow(id: number): Promise<boolean> {
  const b = buffer(id);
  // Any one field is enough ("N/A × 10 s", a filter alone); a row with nothing in it is refused.
  if (!integrationRowHasData(b)) {
    showToast({ message: t('errors.integrationRowIncomplete'), type: 'error', duration: 4000 });
    return false;
  }
  const saved = rows.value.filter((r) => !r._new || r._id === id);
  const next = saved.map((r) => (r._id === id ? strip(b) : strip(r)));
  rows.value = rows.value.filter((r) => r._id !== id || !r._new);
  const ok = await props.save({ integrations: next });
  if (ok) buffers.delete(id);
  else if (!rows.value.some((r) => r._id === id)) rows.value.push({ ...b, _id: id, _new: true });
  return ok;
}
async function removeIntegrationRow(id: number) {
  const row = rows.value.find((r) => r._id === id);
  if (!row) return;
  if (row._new) {
    cancelIntegrationRow(id);
    return;
  }
  await props.save({
    integrations: rows.value.filter((r) => !r._new && r._id !== id).map(strip),
  });
}
function rememberFilter(v: string) {
  if (!v) return;
  const key = normalizeIntegrationFilterKey(v);
  if (!props.knownFilterMap.has(key)) props.knownFilterMap.set(key, v.trim());
}

// ─── Equipment and capture details ────────────────────────────────────────────
const setupName = computed(() => {
  const id = props.draft.gearSetupId;
  if (!id) return null;
  const setup = props.gearSetups.find((s) => s.id === id);
  return setup ? setup.name || setup.id : null;
});
const setupBuf = ref('');
function saveSetup(): Promise<boolean> {
  return props.save({ gearSetupId: setupBuf.value || null });
}

const has = (id: string) => Object.prototype.hasOwnProperty.call(props.draft.captureDetails, id);
/** A field added with "+" and not saved yet: shown open until ✓ or ✕. */
const pendingCapture = ref<string | null>(null);
const shownCaptureFields = computed(() =>
  CAPTURE_FIELDS.filter((f) => has(f.id) || f.id === pendingCapture.value),
);
const addableCaptureFields = computed(() =>
  CAPTURE_FIELDS.filter((f) => !has(f.id) && f.id !== pendingCapture.value),
);
const captureMenuOpen = ref(false);
const captureBuf = ref<string | number>('');
function captureText(id: string): string {
  const field = CAPTURE_FIELDS.find((f) => f.id === id);
  const value = props.draft.captureDetails[id];
  if (value === undefined || value === '') return '';
  return field?.unit ? `${value} ${field.unit}` : String(value);
}
function addCaptureField(id: string) {
  captureMenuOpen.value = false;
  captureBuf.value = '';
  pendingCapture.value = id;
}
async function saveCapture(id: string): Promise<boolean> {
  const field = CAPTURE_FIELDS.find((f) => f.id === id);
  // A number field gives back a number.
  const raw = String(captureBuf.value ?? '').trim();
  if (!raw) {
    showToast({ message: t('gallery.sheet.emptyCapture'), type: 'error', duration: 4000 });
    return false;
  }
  let value: number | string = raw;
  if (field?.type === 'number') {
    value = Number(raw);
    if (!Number.isFinite(value)) {
      showToast({ message: t('errors.invalidIntegrationNumber'), type: 'error', duration: 4000 });
      return false;
    }
  }
  const ok = await props.save({ captureDetails: { ...props.draft.captureDetails, [id]: value } });
  if (ok && pendingCapture.value === id) pendingCapture.value = null;
  return ok;
}
function onCaptureCancel(id: string) {
  if (pendingCapture.value === id) pendingCapture.value = null;
}
async function removeCapture(id: string) {
  if (pendingCapture.value === id) {
    pendingCapture.value = null;
    return;
  }
  const next = { ...props.draft.captureDetails };
  delete next[id];
  await props.save({ captureDetails: next });
}

// ─── Labels ───────────────────────────────────────────────────────────────────
const addingLabel = ref(false);
const labelQuery = ref('');
const labelInputEl = ref<HTMLInputElement>();
const localKnownLabels = ref<string[]>([...new Set([...props.knownLabels, ...props.draft.labels])]);
const labelSuggestions = computed(() =>
  filterLabelCandidates(localKnownLabels.value, props.draft.labels, labelQuery.value),
);
function openAddLabel() {
  addingLabel.value = true;
  void nextTick(() => labelInputEl.value?.focus());
}
function closeAddLabel() {
  addingLabel.value = false;
  labelQuery.value = '';
}
async function addLabel(value: string) {
  const label = value.trim();
  if (!label || props.draft.labels.includes(label)) {
    labelQuery.value = '';
    return;
  }
  if (await props.save({ labels: [...props.draft.labels, label] })) {
    if (!localKnownLabels.value.includes(label)) localKnownLabels.value.push(label);
    labelQuery.value = '';
    labelInputEl.value?.focus();
  }
}
function onLabelKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    void addLabel(labelQuery.value);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeAddLabel();
  }
}
function removeLabel(label: string) {
  void props.save({ labels: props.draft.labels.filter((l) => l !== label) });
}

// ─── Points of interest ───────────────────────────────────────────────────────
const categoriesStore = usePoiCategoriesStore();
categoriesStore.ensureLoaded();
const categories = computed(() => categoriesStore.categories);
const isSolved = computed(() => isPhotoSolved(props.photo));
const poiMenuOpen = ref(false);

type PoiTrigger = (
  photo: Photo,
  onIdentified: (photo: Photo, pois: PointOfInterest[]) => void,
) => void;
function runPoi(trigger: PoiTrigger, toastKey: string) {
  poiMenuOpen.value = false;
  // Several can be added at once; one already on the photo (same name and type) is skipped.
  trigger(props.photo, (_photo, pois) => {
    const { merged, fresh } = mergeIdentifiedPois(props.draft.pointsOfInterest, pois);
    if (!fresh.length) {
      if (pois.length) showToast({ message: t('poi.alreadyListed'), type: 'info', duration: 3000 });
      return;
    }
    void props.save({ pointsOfInterest: merged }).then((ok) => {
      if (!ok) return;
      showToast({
        message: t(toastKey, { names: fresh.map((p) => p.name).join(', ') }),
        type: 'info',
        duration: 3000,
      });
    });
  });
}
function removePoi(idx: number) {
  void props.save({ pointsOfInterest: props.draft.pointsOfInterest.filter((_, i) => i !== idx) });
}

// ─── What a folded section shows beside its title ─────────────────────────────
const count = (n: number) => (n > 0 ? String(n) : undefined);
const summaries = computed(() => {
  const complete = props.draft.integrations.filter((r) => r.frames >= 1 && r.seconds >= 1);
  const seconds = complete.reduce((sum, r) => sum + r.frames * r.seconds, 0);
  const gear = [setupName.value, seconds > 0 ? formatIntegrationTotal(seconds) : null].filter(
    Boolean,
  );
  return {
    objects: count(props.draft.dsoIds.length),
    acquisition: dateText.value ?? undefined,
    gear: gear.length ? gear.join(' · ') : undefined,
    pois: count(props.draft.pointsOfInterest.length),
    labels: props.draft.labels.length ? props.draft.labels.join(', ') : undefined,
    capture: count(shownCaptureFields.value.length),
    notes: props.draft.notes.trim().split('\n')[0] || undefined,
  };
});

// ─── Notes ────────────────────────────────────────────────────────────────────
const notesBuf = ref('');
function saveNotes(): Promise<boolean> {
  return props.save({ notes: notesBuf.value });
}

// ─── Pop-up menus close on a click elsewhere ──────────────────────────────────
const captureMenuEl = ref<HTMLElement>();
const captureAddBtn = ref<HTMLElement>();
const poiMenuEl = ref<HTMLElement>();
function onDocMouseDown(e: MouseEvent) {
  const target = e.target as Node;
  if (
    captureMenuOpen.value &&
    !captureMenuEl.value?.contains(target) &&
    !captureAddBtn.value?.contains(target)
  )
    captureMenuOpen.value = false;
  if (poiMenuOpen.value && !poiMenuEl.value?.parentElement?.contains(target))
    poiMenuOpen.value = false;
}
onMounted(() => document.addEventListener('mousedown', onDocMouseDown));
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown);
  resizeObserver?.disconnect();
  if (dsoTimer) clearTimeout(dsoTimer);
});
</script>
