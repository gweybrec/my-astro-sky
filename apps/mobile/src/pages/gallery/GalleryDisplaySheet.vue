<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import type { Photo } from '@myastrosky/core/types';
import { DSO_TYPES_ALL } from '@myastrosky/core/display-settings';
import { buildPoiFilterGroups, poiKey, type PoiFilterGroup } from '@myastrosky/core/poi';
import { buildLabelFilterItems, NO_LABEL } from '@myastrosky/core/photo-placement';
import { gallerySetupItems, NO_SETUP } from '@myastrosky/core/gallery-filter';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import {
  clearGalleryFilters,
  galleryFiltered,
  galleryFilters,
  PER_LINE_CHOICES,
  photosPerLine,
  setPhotosPerLine,
  type Orientation,
} from '../../gallery-display';
import { dsoCatalogOptions } from '../../catalog-options';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import PhoneSegmented from '../../components/PhoneSegmented.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneNativePicker from '../../components/PhoneNativePicker.vue';
import AppIcon from '../../components/AppIcon.vue';
import SkyCheckSheet, { type CheckGroup, type CheckOption } from '../sky/SkyCheckSheet.vue';
import caretIcon from '../../icons/chevron-down.svg?raw';

// The boards "Galerie, affichage et filtres": how the gallery is shown, then the desktop gallery's filters. The number
// of photos per line is kept for each way of holding the phone; the numbers stand side by side (a list of four rows
// did not fit the sheet in landscape). Each filter field opens a tick-box sheet whose values are those of the gallery's
// photos, with their number of photos, as the sky map's "Affichage" does: every value is ticked while the filter is
// off, unticking one hides its photos. "Du" alone keeps that day, "Du" and "Au" the days between them; "Au" waits for
// "Du". Every choice applies at once.
const props = defineProps<{
  open: boolean;
  orientation: Orientation;
  /** The gallery's photos, whose values the filters offer. */
  photos: readonly Photo[];
  /** The equipments' names by id. */
  setupNames: ReadonlyMap<string, string>;
}>();
const emit = defineEmits<{ 'update:open': [open: boolean] }>();

const options = computed(() =>
  PER_LINE_CHOICES[props.orientation].map((n) => ({ value: String(n), label: String(n) })),
);
const chosen = computed({
  get: () => String(photosPerLine[props.orientation]),
  set: (value: string | undefined) => {
    if (value !== undefined) setPhotosPerLine(props.orientation, Number(value));
  },
});

// ── Filters ──────────────────────────────────────────────────────────────────
type ListFilter = 'setups' | 'labels' | 'dsoTypes' | 'dsoCatalogs';
type Picker = ListFilter | 'pois';
const pickerOpen = ref<Picker | null>(null);
const pickerIs = (name: Picker) =>
  computed({
    get: () => pickerOpen.value === name,
    set: (v: boolean) => {
      if (v) pickerOpen.value = name;
      else if (pickerOpen.value === name) pickerOpen.value = null;
    },
  });
const setupsOpen = pickerIs('setups');
const labelsOpen = pickerIs('labels');
const poisOpen = pickerIs('pois');
const typesOpen = pickerIs('dsoTypes');
const catalogsOpen = pickerIs('dsoCatalogs');

const categories = usePoiCategoriesStore();
const photoCount = (n: number) =>
  n === 1 ? t('mobile.sky.photoCountOne') : t('mobile.sky.photoCountMany', { n });

// The values are those of the photos when the sheet opens (the desktop's dropdowns count them on opening too).
const setupOptions = shallowRef<CheckOption[]>([]);
const labelOptions = shallowRef<CheckOption[]>([]);
const poiFilterGroups = shallowRef<PoiFilterGroup[]>([]);
const poiGroups = shallowRef<CheckGroup[]>([]);
const poiOptions = computed(() => poiGroups.value.flatMap((g) => g.options));
const typeOptions = DSO_TYPES_ALL.map((value) => ({ value, label: t(`dso.typeLabels.${value}`) }));
const catalogOptions = dsoCatalogOptions();

function readPhotos() {
  const photos = [...props.photos];
  setupOptions.value = gallerySetupItems(photos, props.setupNames).map((i) => ({
    value: i.setupId,
    label: i.setupId === NO_SETUP ? t('display.noSetup') : i.name,
    sub: photoCount(i.count),
  }));
  labelOptions.value = buildLabelFilterItems(photos).map((i) => ({
    value: i.label,
    label: i.label === NO_LABEL ? t('display.noLabel') : i.label,
    sub: photoCount(i.count),
  }));
  poiFilterGroups.value = buildPoiFilterGroups(
    photos.map((p) => p.pointsOfInterest ?? []),
    categories.categories,
  );
  poiGroups.value = poiFilterGroups.value.map((g) => ({
    id: g.category.id,
    label: g.category.name,
    color: g.category.color,
    options: g.names.map((n) => ({
      value: poiKey(g.category.id, n.name),
      label: n.name,
      sub: photoCount(n.count),
    })),
  }));
}
watch(
  () => props.open,
  (isOpen) => isOpen && readPhotos(),
  { immediate: true },
);

const listOptions: Record<ListFilter, () => readonly CheckOption[]> = {
  setups: () => setupOptions.value,
  labels: () => labelOptions.value,
  dsoTypes: () => typeOptions,
  dsoCatalogs: () => catalogOptions,
};
/** The ticked values of a filter: all of them while it is off. */
const shownOf = (kind: ListFilter) =>
  galleryFilters[kind] ?? listOptions[kind]().map((o) => o.value);
/** Ticking every value turns the filter off. */
function setShown(kind: ListFilter, shown: string[]) {
  galleryFilters[kind] = shown.length === listOptions[kind]().length ? null : shown;
}
const listModel = (kind: ListFilter) =>
  computed({ get: () => shownOf(kind), set: (v: string[]) => setShown(kind, v) });
const setupsShown = listModel('setups');
const labelsShown = listModel('labels');
const typesShown = listModel('dsoTypes');
const catalogsShown = listModel('dsoCatalogs');

const poisShown = computed({
  get: () => {
    const sel = galleryFilters.pois;
    if (!sel) return poiOptions.value.map((o) => o.value);
    return poiFilterGroups.value.flatMap((g) => {
      const names = sel.get(g.category.id);
      if (!names) return [];
      return g.names
        .filter((n) => names.size === 0 || names.has(n.name))
        .map((n) => poiKey(g.category.id, n.name));
    });
  },
  set: (shown: string[]) => {
    if (shown.length === poiOptions.value.length) {
      galleryFilters.pois = null;
      return;
    }
    const on = new Set(shown);
    const sel = new Map<string, Set<string>>();
    for (const g of poiFilterGroups.value) {
      const names = g.names.filter((n) => on.has(poiKey(g.category.id, n.name))).map((n) => n.name);
      if (names.length) sel.set(g.category.id, new Set(names));
    }
    galleryFilters.pois = sel;
  },
});

const countAria = (label: string, n: number, total: number) =>
  t('mobile.targets.countAria', { label, n, total });
const countOf = (n: number, total: number) => t('mobile.targets.countOf', { n, total });
/** The filter fields, in the board's order: name, values shown out of all, and the sheet each opens. */
const fields = computed(() => [
  {
    label: t('gallery.filterSetups'),
    n: setupsShown.value.length,
    total: setupOptions.value.length,
    open: setupsOpen,
  },
  {
    label: t('gallery.filterLabels'),
    n: labelsShown.value.length,
    total: labelOptions.value.length,
    open: labelsOpen,
  },
  {
    label: t('gallery.filterPoi'),
    n: poisShown.value.length,
    total: poiOptions.value.length,
    open: poisOpen,
  },
  {
    label: t('gallery.filterTypes'),
    n: typesShown.value.length,
    total: typeOptions.length,
    open: typesOpen,
  },
  {
    label: t('gallery.filterCatalogs'),
    n: catalogsShown.value.length,
    total: catalogOptions.length,
    open: catalogsOpen,
  },
]);

// ── Dates ────────────────────────────────────────────────────────────────────
const fromPicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
const toPicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
const dateAria = (label: string, value: string | null) =>
  t('mobile.format.labelValue', { label, value: value ?? t('mobile.gallery.noDate') });
function setFrom(day: string | null) {
  galleryFilters.dateFrom = day;
  if (!day) galleryFilters.dateTo = null;
}
</script>

<template>
  <PhoneSheet :open="open" :title="t('display.section')" @update:open="emit('update:open', $event)">
    <PhoneSectionHeader>{{ t('mobile.gallery.perLine') }}</PhoneSectionHeader>
    <PhoneSegmented v-model="chosen" :options="options" :label="t('mobile.gallery.perLine')" />

    <PhoneSectionHeader>{{ t('mobile.targets.filtersTitle') }}</PhoneSectionHeader>
    <div v-for="field in fields" :key="field.label" class="mob-form-row mob-form-row--field">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="countAria(field.label, field.n, field.total)"
        @click="field.open.value = true"
      >
        <span class="mob-btn-key">{{ field.label }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{ countOf(field.n, field.total) }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <div class="mob-form-row mob-form-row--field">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="dateAria(t('gallery.dateFrom'), galleryFilters.dateFrom)"
        @click="fromPicker?.open()"
      >
        <span class="mob-btn-key">{{ t('gallery.dateFrom') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{
          galleryFilters.dateFrom ?? '—'
        }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <div class="mob-form-row mob-form-row--field">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :disabled="!galleryFilters.dateFrom"
        :aria-label="dateAria(t('gallery.dateTo'), galleryFilters.dateTo)"
        @click="toPicker?.open()"
      >
        <span class="mob-btn-key">{{ t('gallery.dateTo') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{ galleryFilters.dateTo ?? '—' }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <div class="mob-form-row mob-form-row--field">
      <PhoneButton block :disabled="!galleryFiltered()" @click="clearGalleryFilters">
        {{ t('mobile.gallery.clearFilters') }}
      </PhoneButton>
    </div>
    <PhoneNativePicker
      ref="fromPicker"
      type="date"
      :value="galleryFilters.dateFrom ?? ''"
      @pick="setFrom"
      @clear="setFrom(null)"
    />
    <PhoneNativePicker
      ref="toPicker"
      type="date"
      :value="galleryFilters.dateTo ?? galleryFilters.dateFrom ?? ''"
      @pick="galleryFilters.dateTo = $event"
      @clear="galleryFilters.dateTo = null"
    />

    <SkyCheckSheet
      v-model:open="setupsOpen"
      v-model:selected="setupsShown"
      :title="t('gallery.filterSetups')"
      :options="setupOptions"
    />
    <SkyCheckSheet
      v-model:open="labelsOpen"
      v-model:selected="labelsShown"
      :title="t('gallery.filterLabels')"
      :options="labelOptions"
    />
    <SkyCheckSheet
      v-model:open="poisOpen"
      v-model:selected="poisShown"
      :title="t('gallery.filterPoi')"
      :options="poiOptions"
      :groups="poiGroups"
    />
    <SkyCheckSheet
      v-model:open="typesOpen"
      v-model:selected="typesShown"
      :title="t('gallery.filterTypes')"
      :options="typeOptions"
    />
    <SkyCheckSheet
      v-model:open="catalogsOpen"
      v-model:selected="catalogsShown"
      :title="t('gallery.filterCatalogs')"
      :options="catalogOptions"
    />
  </PhoneSheet>
</template>
