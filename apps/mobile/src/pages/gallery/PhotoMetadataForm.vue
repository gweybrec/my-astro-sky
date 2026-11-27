<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { CAPTURE_FIELDS } from '@myastrosky/core/capture-fields';
import { datetimeLocalToIso, isoToDatetimeLocal } from '@myastrosky/core/datetime-local';
import { formatIntegrationTotal } from '@myastrosky/core/format-utils';
import { OBS_WINDOW_FILTERS } from '@myastrosky/core/observation-windows';
import {
  filterLabelCandidates,
  type PhotoMetadataDraft,
} from '@myastrosky/core/photo-metadata-draft';
import { resolveCategory } from '@myastrosky/core/poi';
import { searchDSOs } from '@myastrosky/core/search';
import { sortDsoIdsByImportance } from '@myastrosky/core/catalog/dso-registry';
import type { GearSetupData } from '@myastrosky/app-state/api';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { useErrorToast } from '../../composables/useErrorToast';
import { poiTypeIcon } from '../../poi-icons';
import AppIcon from '../../components/AppIcon.vue';
import PhoneAddRow from '../../components/PhoneAddRow.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneHelper from '../../components/PhoneHelper.vue';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import PhoneNativePicker from '../../components/PhoneNativePicker.vue';
import PhoneRadioSheet from '../../components/PhoneRadioSheet.vue';
import PhoneRemoveChips from '../../components/PhoneRemoveChips.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import PhoneTextArea from '../../components/PhoneTextArea.vue';
import PhoneFilterBadge from '../../components/PhoneFilterBadge.vue';
import FilterPickSheet from '../gear/FilterPickSheet.vue';
import { noteFilterUse, recentFilters as recentFilterList } from '../../filter-usage';
import caretIcon from '../../icons/chevron-down.svg?raw';
import plusIcon from '@icons/plus.svg?raw';
import trashIcon from '@icons/trash.svg?raw';
import asteroidIcon from '@icons/poi-asteroid.svg?raw';
import cometIcon from '@icons/poi-comet.svg?raw';
import supernovaIcon from '@icons/poi-supernova.svg?raw';

// The fields of a photo's metadata, in the sections and order of the desktop gallery's photo panel (`MetadataSheet.vue`):
// on "Modifier les infos" (board "Photo, modifier les infos") and on "Photo à ajouter". The page holds the draft and saves it; adding a
// point of interest and the identifications need a solved photo (`solved`), and open the page's own pages (`poi`). An
// exposure row's filter is chosen in a list (board "Photo, modifier les infos, filtre"); "Ajouter un filtre" there asks
// the page to open the filter's add page for that row (`add-filter`).
const draft = defineModel<PhotoMetadataDraft>('draft', { required: true });
const props = defineProps<{
  /** The labels of the other photos, offered while a label is typed. */
  knownLabels: string[];
  /** The filters of the photos' exposure rows, the most recently used first: offered first when a filter is chosen. */
  usedFilters: string[];
  setups: GearSetupData[];
  solved: boolean;
  wcsLoading: boolean;
  /** The page's footer: the toasts sit above it. */
  footerId: string;
}>();
const emit = defineEmits<{ poi: [path: string]; 'load-wcs': []; 'add-filter': [row: number] }>();
const { showError } = useErrorToast({ above: props.footerId });
const categoriesStore = usePoiCategoriesStore();

const known = ref<string[]>([]);
watch(
  () => props.knownLabels,
  (labels) => (known.value = [...labels]),
  { immediate: true },
);
// The objects' chips, the most important catalogue first (Messier, NGC, IC, …); the list itself keeps its order.
const sortedDsoIds = computed(() => sortDsoIdsByImportance(draft.value.dsoIds));
/** The desktop's texts start with a "+" that the board draws as an icon. */
const withoutPlus = (text: string) => text.replace(/^\+\s*/, '');

// ── Objects ───────────────────────────────────────────────────────────────────────────────────────

const dsoQuery = ref('');
const dsoResults = ref<{ id: string; title: string }[]>([]);
let dsoTimer: ReturnType<typeof setTimeout> | undefined;
watch(dsoQuery, (text) => {
  clearTimeout(dsoTimer);
  const q = text.trim();
  if (!q) {
    dsoResults.value = [];
    return;
  }
  dsoTimer = setTimeout(() => {
    dsoResults.value = searchDSOs(q, 8).map(({ dso }) => ({
      id: dso.id,
      title: dso.displayName ? `${dso.id} — ${dso.displayName}` : dso.id,
    }));
  }, 200);
});

function addDso(id: string) {
  if (id && !draft.value.dsoIds.includes(id)) draft.value.dsoIds.push(id);
  dsoQuery.value = '';
}
const addTypedDso = () => addDso(dsoQuery.value.trim().replace(/\s+/g, ''));

// ── Labels ────────────────────────────────────────────────────────────────────────────────────────

const labelInput = ref('');
const labelSuggestions = computed(() =>
  labelInput.value.trim()
    ? filterLabelCandidates(known.value, draft.value.labels, labelInput.value)
    : [],
);

function addLabel(text: string) {
  const label = text.trim();
  if (label && !draft.value.labels.includes(label)) {
    draft.value.labels.push(label);
    if (!known.value.includes(label)) known.value.push(label);
  }
  labelInput.value = '';
}

// ── Points of interest ────────────────────────────────────────────────────────────────────────────

const poiChips = computed(() =>
  draft.value.pointsOfInterest.map((poi) => ({
    label: poi.name,
    icon: poiTypeIcon(poi.categoryId),
    color: resolveCategory(poi.categoryId, categoriesStore.categories).color,
  })),
);

// ── Integration ───────────────────────────────────────────────────────────────────────────────────

const shown = (n: number) => (n >= 1 ? String(n) : '');

function setCount(index: number, key: 'frames' | 'seconds', text: string) {
  const raw = text.trim();
  if (!raw) {
    draft.value.integrations[index][key] = 0;
    return;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    void showError(t('errors.invalidIntegrationNumber'));
    return;
  }
  draft.value.integrations[index][key] = parsed;
}

// The row whose filter is being chosen, in the list of filters.
const filterRow = ref<number | null>(null);
const filterOpen = computed({
  get: () => filterRow.value !== null,
  set: (isOpen: boolean) => {
    if (!isOpen) filterRow.value = null;
  },
});
const filterChoice = computed({
  get: () =>
    filterRow.value === null ? null : draft.value.integrations[filterRow.value]?.filter || null,
  set: (filter: string | null) => {
    const row = filterRow.value === null ? undefined : draft.value.integrations[filterRow.value];
    if (row) row.filter = filter ?? '';
    // Chosen is used: the filter is offered first next time, saved or not.
    if (row && filter) noteFilterUse(filter);
  },
});
// "Tous les filtres": the generic bands, then the filters already used on the photos.
const knownFilters = computed(() => [...OBS_WINDOW_FILTERS, ...props.usedFilters]);
// The recent filters, as many as the board shows: those just chosen first, then those of the photos.
const recentFilters = computed(() => recentFilterList(props.usedFilters, 3));

function addFilter() {
  const index = filterRow.value;
  filterRow.value = null;
  if (index !== null) emit('add-filter', index);
}

const rowTotal = (row: { frames: number; seconds: number }) =>
  row.frames >= 1 && row.seconds >= 1
    ? `= ${formatIntegrationTotal(row.frames * row.seconds)}`
    : '';

// ── Date and equipment ────────────────────────────────────────────────────────────────────────────

const datePicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
const dateLocal = computed(() => isoToDatetimeLocal(draft.value.observationDate));

const setupOpen = ref(false);
const setupChoice = computed({
  get: () => draft.value.gearSetupId ?? '',
  set: (id: string | undefined) => {
    draft.value.gearSetupId = id || null;
  },
});
const setupOptions = computed(() => [
  { value: '', label: t('modal.metadataGearSetupNone') },
  ...props.setups.map((s) => ({ value: s.id, label: s.name || s.id })),
]);
const setupName = computed(
  () => setupOptions.value.find((o) => o.value === setupChoice.value)?.label ?? '',
);

// ── Capture details ───────────────────────────────────────────────────────────────────────────────
// A field's row shows only when its id is in the details; the list offers the others, in the catalog's order.

const has = (id: string) => Object.prototype.hasOwnProperty.call(draft.value.captureDetails, id);
const presentFields = computed(() => CAPTURE_FIELDS.filter((f) => has(f.id)));
const addableFields = computed(() => CAPTURE_FIELDS.filter((f) => !has(f.id)));
const fieldToAdd = ref<string | undefined>(undefined);
const fieldListOpen = ref(false);
const fieldChoice = computed({
  get: () => fieldToAdd.value,
  set: (id: string | undefined) => {
    fieldToAdd.value = id;
  },
});
const fieldOptions = computed(() =>
  addableFields.value.map((f) => ({ value: f.id, label: t(f.labelKey) })),
);
const fieldToAddName = computed(
  () =>
    fieldOptions.value.find((o) => o.value === fieldToAdd.value)?.label ??
    t('modal.metadataCaptureAddPlaceholder'),
);

function setCapture(id: string, text: string) {
  const field = CAPTURE_FIELDS.find((f) => f.id === id);
  // The key stays (as '') while the field is empty, so that its row stays; saving drops it.
  let value: number | string = text;
  if (field?.type === 'number') {
    value = text.trim() === '' ? '' : Number(text);
    if (typeof value === 'number' && !Number.isFinite(value)) return;
  }
  draft.value.captureDetails = { ...draft.value.captureDetails, [id]: value };
}

function removeCapture(id: string) {
  const next = { ...draft.value.captureDetails };
  delete next[id];
  draft.value.captureDetails = next;
}

function addCapture() {
  const id = fieldToAdd.value;
  if (!id || has(id)) return;
  draft.value.captureDetails = { ...draft.value.captureDetails, [id]: '' };
  fieldToAdd.value = undefined;
}
</script>

<template>
  <PhoneSectionHeader>{{ t('modal.metadataFilename') }}</PhoneSectionHeader>
  <PhoneField v-model="draft.displayName" :aria-label="t('modal.metadataFilename')" />

  <PhoneSectionHeader>{{ t('modal.metadataDsos') }}</PhoneSectionHeader>
  <PhoneRemoveChips
    :items="sortedDsoIds.map((id) => ({ label: id }))"
    @remove="draft.dsoIds.splice(draft.dsoIds.indexOf(sortedDsoIds[$event]), 1)"
  />
  <PhoneAddRow
    v-model="dsoQuery"
    :placeholder="t('modal.metadataDsosPlaceholder')"
    :aria-label="t('modal.metadataDsosPlaceholder')"
    @add="addTypedDso"
  />
  <IonList v-if="dsoResults.length" class="mob-list" lines="none">
    <PhoneRow v-for="r in dsoResults" :key="r.id" :title="r.title" button @click="addDso(r.id)" />
  </IonList>

  <PhoneSectionHeader>{{ t('gallery.sheet.sectionAcquisition') }}</PhoneSectionHeader>
  <PhoneField
    :model-value="dateLocal.replace('T', ' ')"
    readonly
    :aria-label="t('modal.metadataObsDate')"
    @click="datePicker?.open()"
  />
  <PhoneNativePicker
    ref="datePicker"
    type="datetime-local"
    :value="dateLocal"
    @pick="draft.observationDate = datetimeLocalToIso($event)"
    @clear="draft.observationDate = ''"
  />

  <PhoneSectionHeader>{{ t('gallery.sheet.sectionGear') }}</PhoneSectionHeader>
  <div class="mob-form-row">
    <PhoneButton
      variant="field"
      text-style="body"
      block
      :aria-label="
        t('mobile.format.labelValue', {
          label: t('modal.metadataGearSetup'),
          value: setupName,
        })
      "
      @click="setupOpen = true"
    >
      <span class="mob-btn-label">{{ setupName }}</span>
      <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
    </PhoneButton>
  </div>

  <!-- No exposure yet: said as the desktop's photo panel says it, above the button that adds one
       (board "Photo, modifier les infos, sans intégration"). -->
  <PhoneHelper v-if="draft.integrations.length === 0">{{
    t('gallery.sheet.noIntegration')
  }}</PhoneHelper>
  <div v-for="(row, index) in draft.integrations" :key="index" class="mob-integration">
    <PhoneField
      bare
      inputmode="numeric"
      :model-value="shown(row.frames)"
      :aria-label="t('modal.metadataIntegrationsFramesTooltip')"
      @update:model-value="setCount(index, 'frames', $event)"
    />
    <span class="mob-integration-unit m-body" aria-hidden="true">×</span>
    <PhoneField
      bare
      inputmode="numeric"
      :model-value="shown(row.seconds)"
      :aria-label="t('modal.metadataIntegrationsSecondsTooltip')"
      @update:model-value="setCount(index, 'seconds', $event)"
    />
    <span class="mob-integration-unit m-body">{{
      t('modal.metadataIntegrationsSecondsSuffix')
    }}</span>
    <span class="mob-integration-total m-mono">{{ rowTotal(row) }}</span>
    <PhoneIconButton
      danger
      :label="t('modal.metadataIntegrationsRemoveRow')"
      @click="draft.integrations.splice(index, 1)"
    >
      <AppIcon :svg="trashIcon" />
    </PhoneIconButton>
    <div class="mob-integration-filter">
      <span class="mob-integration-filter-name"
        ><span class="m-secondary">{{ t('mobile.photo.integrationFilters') }}</span
        ><PhoneFilterBadge v-if="row.filter" :filter="row.filter"
      /></span>
      <PhoneIconButton
        compact
        :label="
          t(row.filter ? 'mobile.photo.changeRowFilter' : 'mobile.photo.chooseRowFilter', {
            n: index + 1,
          })
        "
        @click="filterRow = index"
      >
        <AppIcon :svg="plusIcon" />
      </PhoneIconButton>
    </div>
  </div>
  <div class="mob-form-row mob-section-gap-sm">
    <PhoneButton block @click="draft.integrations.push({ frames: 0, seconds: 0, filter: '' })">
      <AppIcon :svg="plusIcon" />{{ withoutPlus(t('modal.metadataIntegrationsAddRow')) }}
    </PhoneButton>
  </div>

  <PhoneSectionHeader>{{ t('modal.metadataPoi') }}</PhoneSectionHeader>
  <PhoneRemoveChips :items="poiChips" @remove="draft.pointsOfInterest.splice($event, 1)" />
  <!-- As the desktop: adding a point needs a solved photo; the identifications show only for one. -->
  <IonList class="mob-list" lines="none">
    <PhoneRow
      :title="withoutPlus(t('poi.addPoi'))"
      :lead="plusIcon"
      button
      :disabled="!solved"
      @click="emit('poi', 'poi')"
    />
    <template v-if="solved">
      <PhoneRow
        :title="t('asteroid.menuLabel')"
        :lead="asteroidIcon"
        button
        @click="emit('poi', 'identify/asteroid')"
      />
      <PhoneRow
        :title="t('supernova.menuLabel')"
        :lead="supernovaIcon"
        button
        @click="emit('poi', 'identify/supernova')"
      />
      <PhoneRow
        :title="t('comet.menuLabel')"
        :lead="cometIcon"
        button
        @click="emit('poi', 'identify/comet')"
      />
    </template>
  </IonList>

  <PhoneSectionHeader>{{ t('modal.metadataLabels') }}</PhoneSectionHeader>
  <PhoneRemoveChips
    :items="draft.labels.map((label) => ({ label }))"
    @remove="draft.labels.splice($event, 1)"
  />
  <PhoneAddRow
    v-model="labelInput"
    :placeholder="t('modal.metadataLabelsPlaceholder')"
    :aria-label="t('modal.metadataLabelsPlaceholder')"
    @add="addLabel(labelInput)"
  />
  <IonList v-if="labelSuggestions.length" class="mob-list" lines="none">
    <PhoneRow
      v-for="label in labelSuggestions"
      :key="label"
      :title="label"
      button
      @click="addLabel(label)"
    />
  </IonList>

  <PhoneSectionHeader>{{ t('modal.metadataCapture') }}</PhoneSectionHeader>
  <div v-for="f in presentFields" :key="f.id" class="mob-field-row">
    <label class="m-secondary">{{ t(f.labelKey) }}</label>
    <PhoneField
      bare
      :inputmode="f.type === 'number' ? 'decimal' : 'text'"
      :model-value="String(draft.captureDetails[f.id] ?? '')"
      :aria-label="t(f.labelKey)"
      @update:model-value="setCapture(f.id, $event)"
    />
    <span class="mob-integration-unit m-body">{{ f.unit }}</span>
    <PhoneIconButton
      danger
      :label="`${t('modal.metadataCaptureRemove')} ${t(f.labelKey)}`"
      @click="removeCapture(f.id)"
    >
      <AppIcon :svg="trashIcon" />
    </PhoneIconButton>
  </div>
  <PhoneAddRow :disabled="!fieldToAdd" @add="addCapture">
    <PhoneButton
      variant="field"
      text-style="body"
      :disabled="addableFields.length === 0"
      :aria-label="t('modal.metadataCaptureAddPlaceholder')"
      @click="fieldListOpen = true"
    >
      <span class="mob-btn-label">{{ fieldToAddName }}</span>
      <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
    </PhoneButton>
  </PhoneAddRow>

  <PhoneSectionHeader>{{ t('modal.metadataNotes') }}</PhoneSectionHeader>
  <PhoneTextArea
    v-model="draft.notes"
    :label="t('modal.metadataNotes')"
    :placeholder="t('modal.metadataNotesPlaceholder')"
  />

  <div class="mob-form-row mob-section-gap">
    <PhoneButton block :disabled="wcsLoading" @click="emit('load-wcs')">
      {{ wcsLoading ? t('gallery.loadFromWcsLoading') : t('gallery.loadFromWcs') }}
    </PhoneButton>
  </div>
  <PhoneRadioSheet
    v-model:open="setupOpen"
    v-model:value="setupChoice"
    :title="t('modal.metadataGearSetup')"
    :options="setupOptions"
  />
  <FilterPickSheet
    v-model:open="filterOpen"
    v-model:value="filterChoice"
    :known="knownFilters"
    :recent="recentFilters"
    @add="addFilter"
  />
  <PhoneRadioSheet
    v-model:open="fieldListOpen"
    v-model:value="fieldChoice"
    :title="t('modal.metadataCaptureAddPlaceholder')"
    :options="fieldOptions"
  />
</template>
