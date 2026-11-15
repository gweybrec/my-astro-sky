<template>
  <div class="flex flex-col gap-7 min-w-0" data-test="batch-multi-edit">
    <div class="flex items-center gap-6">
      <div class="flex gap-2">
        <span v-for="item in shownThumbs" :key="item.id" class="bw-thumb !w-[40px] !h-[30px]">
          <img
            v-if="item.thumbBlobUrl"
            :src="item.thumbBlobUrl"
            alt=""
            class="w-full h-full object-cover"
          />
          <span v-else v-html="imageSvg"></span>
        </span>
      </div>
      <span class="flex-1 min-w-0 text-large text-bright">{{
        t('batch.batchTitle', { n: String(items.length) })
      }}</span>
      <button type="button" class="btn-cancel" @click="emit('clear')">
        {{ t('batch.clearSelection') }}
      </button>
    </div>

    <div class="status-info rounded-md px-6 py-4 text-base">
      {{ t('batch.batchNote', { n: String(items.length) }) }}
    </div>

    <div class="grid grid-cols-[260px_1fr] gap-7 items-start">
      <!-- Equipment -->
      <label class="flex flex-col gap-2">
        <span class="bw-field-label">{{ t('modal.metadataGearSetup') }}</span>
        <select
          class="dialog-input !py-[var(--space-2h)] !h-[25.2px] !text-base"
          :class="{ 'italic text-dim': setup.mixed }"
          :value="setup.mixed ? MIXED : (setup.value ?? '')"
          data-test="multi-setup"
          @change="onSetupChange"
        >
          <option v-if="setup.mixed" :value="MIXED" disabled>{{ t('batch.mixedValues') }}</option>
          <option value="">{{ t('modal.metadataGearSetupNone') }}</option>
          <option v-for="s in gearSetups" :key="s.id" :value="s.id">{{ s.name || s.id }}</option>
        </select>
      </label>

      <!-- Common labels: the same field as a photo's "Étiquettes" -->
      <div class="flex flex-col gap-2">
        <span class="bw-field-label">{{ t('batch.commonLabels') }}</span>
        <div v-if="labels.all.length || labels.some.length" class="tag-chips">
          <span v-for="lbl in labels.all" :key="lbl" class="tag-chip label-chip">
            {{ lbl }}
            <button
              type="button"
              class="tag-chip-remove"
              :aria-label="lbl"
              @click="removeLabel(lbl)"
            >
              ×
            </button>
          </span>
          <span
            v-for="lbl in labels.some"
            :key="`some-${lbl}`"
            class="tag-chip label-chip !border-dashed !bg-transparent opacity-80"
            :title="t('batch.someLabels')"
          >
            {{ lbl }}
            <button
              type="button"
              class="tag-chip-remove"
              :aria-label="lbl"
              @click="removeLabel(lbl)"
            >
              ×
            </button>
          </span>
        </div>
        <div class="tag-input-wrap relative">
          <input
            class="tag-input"
            :placeholder="t('batch.addToAll')"
            :aria-label="t('batch.commonLabels')"
            v-model="labelInput"
            data-test="multi-label-input"
            @focus="showSuggest = true"
            @input="showSuggest = true"
            @keydown="onLabelKeydown"
            @blur="onLabelBlur"
          />
          <div v-if="showSuggest && suggestions.length" class="tag-suggest">
            <div
              v-for="s in suggestions"
              :key="s"
              class="tag-suggest-item"
              @mousedown.prevent="addLabel(s)"
            >
              {{ s }}
            </div>
          </div>
        </div>
      </div>

      <!-- Observation date -->
      <label class="flex flex-col gap-2">
        <span class="bw-field-label">{{ t('modal.metadataObsDate') }}</span>
        <input
          type="datetime-local"
          class="dialog-input"
          :class="{ 'text-dim': date.mixed }"
          :title="date.mixed ? t('batch.mixedValues') : t('modal.metadataObsDatePlaceholder')"
          :value="date.mixed ? '' : isoToDatetimeLocal(date.value)"
          @change="onDateChange"
        />
        <span v-if="date.mixed" class="text-small text-dim italic">{{
          t('batch.mixedValues')
        }}</span>
      </label>
      <span></span>
    </div>

    <!-- Capture details -->
    <div class="flex flex-col gap-2">
      <span class="bw-field-label">{{ t('modal.metadataCapture') }}</span>
      <div
        v-if="presentFields.length"
        class="grid grid-cols-[max-content_minmax(0,220px)_max-content] items-center gap-x-4 gap-y-2"
      >
        <template v-for="f in presentFields" :key="f.id">
          <span class="text-small text-label">{{ t(f.labelKey) }}</span>
          <input
            :type="f.type === 'number' ? 'number' : 'text'"
            class="input-base"
            :placeholder="captureText(f.id) === null ? t('batch.mixedValues') : ''"
            :value="captureText(f.id) ?? ''"
            @change="onCaptureChange(f.id, $event)"
          />
          <span class="text-dim">{{ f.unit }}</span>
        </template>
      </div>
      <div class="w-[260px]">
        <select class="input-base" :value="''" @change="onAddField">
          <option value="">{{ t('modal.metadataCaptureAddPlaceholder') }}</option>
          <option v-for="f in addableFields" :key="f.id" :value="f.id">{{ t(f.labelKey) }}</option>
        </select>
      </div>
    </div>

    <!-- Notes -->
    <label class="flex flex-col gap-2">
      <span class="bw-field-label">{{ t('modal.metadataNotes') }}</span>
      <textarea
        class="notes-textarea"
        rows="3"
        :placeholder="notes.mixed ? t('batch.mixedValues') : t('modal.metadataNotesPlaceholder')"
        :value="notes.mixed ? '' : notes.value"
        @change="onNotesChange"
      ></textarea>
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BatchItem } from '../../batch-types';
import type { GearSetupData } from '../../api';
import { t } from '../../i18n';
import { commonLabels, commonValue, markChanged } from '../../batch-utils';
import { CAPTURE_FIELDS } from '@myastrosky/core/capture-fields';
import { filterLabelCandidates } from '@myastrosky/core/photo-metadata-draft';
import { isoToDatetimeLocal, datetimeLocalToIso } from '@myastrosky/core/datetime-local';
import imageSvg from '../../icons/image.svg?raw';

/**
 * "Modifier N photos": a value chosen here replaces that of every ticked photo at once, so a wrong choice is undone
 * by choosing again. A field the photos do not share shows "Valeurs différentes" and changes only when edited.
 */
const props = defineProps<{
  items: BatchItem[];
  gearSetups: GearSetupData[];
  knownLabels: string[];
}>();
const emit = defineEmits<{ clear: [] }>();

const MIXED = '__mixed__';
const shownThumbs = computed(() => props.items.slice(0, 4));

/** Writes a value into every ticked photo; a saved one is then "À réenregistrer". */
function applyAll(write: (item: BatchItem) => void) {
  for (const item of props.items) {
    write(item);
    markChanged(item);
  }
}

// ─── Equipment ────────────────────────────────────────────────────────────────
const setup = computed(() => commonValue(props.items, (i) => i.gearSetupId ?? null));
function onSetupChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value;
  if (value === MIXED) return;
  applyAll((i) => (i.gearSetupId = value || null));
}

// ─── Common labels ────────────────────────────────────────────────────────────
const labels = computed(() => commonLabels(props.items));
const labelInput = ref('');
const showSuggest = ref(false);
const suggestions = computed(() =>
  filterLabelCandidates(props.knownLabels, labels.value.all, labelInput.value),
);

function addLabel(value: string) {
  const label = value.trim();
  labelInput.value = '';
  showSuggest.value = false;
  if (!label) return;
  applyAll((i) => {
    if (!i.labels.includes(label)) i.labels = [...i.labels, label];
  });
}

function removeLabel(label: string) {
  applyAll((i) => (i.labels = i.labels.filter((l) => l !== label)));
}

function onLabelKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addLabel(labelInput.value);
  } else if (e.key === 'Escape') {
    showSuggest.value = false;
  }
}

function onLabelBlur() {
  addLabel(labelInput.value);
  setTimeout(() => (showSuggest.value = false), 150);
}

// ─── Observation date ─────────────────────────────────────────────────────────
const date = computed(() => commonValue(props.items, (i) => i.observationDate || ''));
function onDateChange(e: Event) {
  const local = (e.target as HTMLInputElement).value;
  const iso = local ? (datetimeLocalToIso(local) ?? '') : '';
  applyAll((i) => (i.observationDate = iso));
}

// ─── Capture details ──────────────────────────────────────────────────────────
const presentFields = computed(() =>
  CAPTURE_FIELDS.filter((f) =>
    props.items.some((i) => Object.prototype.hasOwnProperty.call(i.captureDetails, f.id)),
  ),
);
const addableFields = computed(() =>
  CAPTURE_FIELDS.filter((f) => !presentFields.value.includes(f)),
);
const captureValue = (id: string) =>
  commonValue(props.items, (i) => (i.captureDetails[id] ?? '') as number | string);

/** The value the ticked photos share for a capture field, as text; null when they differ. */
const captureText = (id: string): string | null => {
  const v = captureValue(id);
  return v.mixed ? null : String(v.value ?? '');
};

function onAddField(e: Event) {
  const id = (e.target as HTMLSelectElement).value;
  (e.target as HTMLSelectElement).value = '';
  if (!id) return;
  for (const item of props.items) {
    if (!Object.prototype.hasOwnProperty.call(item.captureDetails, id)) {
      item.captureDetails = { ...item.captureDetails, [id]: '' };
    }
  }
}

function onCaptureChange(id: string, e: Event) {
  const field = CAPTURE_FIELDS.find((f) => f.id === id);
  const raw = (e.target as HTMLInputElement).value;
  let value: number | string = raw;
  if (field?.type === 'number') {
    value = raw.trim() === '' ? '' : Number(raw);
    if (typeof value === 'number' && !Number.isFinite(value)) return;
  }
  applyAll((i) => (i.captureDetails = { ...i.captureDetails, [id]: value }));
}

// ─── Notes ────────────────────────────────────────────────────────────────────
const notes = computed(() => commonValue(props.items, (i) => i.notes));
function onNotesChange(e: Event) {
  const value = (e.target as HTMLTextAreaElement).value;
  applyAll((i) => (i.notes = value));
}
</script>
