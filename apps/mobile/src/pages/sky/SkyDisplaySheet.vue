<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '@myastrosky/core/i18n/index';
import { DSO_TYPES_ALL } from '@myastrosky/core/display-settings';
import type { ConstellationStyle } from '@myastrosky/core/types';
import { DSO_CATALOGS_ALL } from '@myastrosky/core/catalog/dso-registry';
import { buildPoiFilterGroups, poiKey } from '@myastrosky/core/poi';
import { buildLabelFilterItems, NO_LABEL } from '@myastrosky/core/photo-placement';
import type { PhotoLayer } from '@myastrosky/render/photo-layer';
import {
  budgetToSliderPos,
  DSO_DENSITY_MAX,
  SLIDER_STEPS,
  sliderPosToBudget,
  STAR_DENSITY_MAX,
} from '@myastrosky/core/density-slider';
import { useDisplayStore } from '@myastrosky/app-state/stores/display';
import { useFisheyeStore } from '@myastrosky/app-state/stores/fisheye';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import PhoneToggleRow from '../../components/PhoneToggleRow.vue';
import PhoneSliderRow from '../../components/PhoneSliderRow.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import { dsoCatalogOptions } from '../../catalog-options';
import SkyCheckSheet, { type CheckGroup, type CheckOption } from './SkyCheckSheet.vue';
import PhoneRadioSheet from '../../components/PhoneRadioSheet.vue';
import AppIcon from '../../components/AppIcon.vue';
import caretIcon from '../../icons/chevron-down.svg?raw';

// The board "Ciel, affichage": the map's display settings of the desktop's side panel. Every change applies at once.
// The field buttons open a choice sheet: tick boxes when several values can be kept (types, catalogues), a radio
// choice when there is one (drawing style, hemisphere, projection). The points of interest and the photo labels are
// those of the photos placed on the map (`layer`), counted each time the sheet opens, as the desktop's dropdowns do;
// their sheets list them with the number of photos ("Ciel, affichage, points d'intérêt" / "étiquettes").
const props = defineProps<{ layer?: PhotoLayer | null }>();
const open = defineModel<boolean>('open', { required: true });

const display = useDisplayStore();
const fisheye = useFisheyeStore();
const {
  showPhotos,
  showPhotoOutlines,
  showPois,
  visiblePois,
  visibleLabels,
  showStars,
  showStarLabels,
  showConstellationLines,
  showConstellationNames,
  constellationStyle,
  showDSOs,
  showDSOLabels,
  dsoTypes,
  dsoCatalogs,
  showGrid,
  hemisphere,
  borderLatDeg,
  skyOpacity,
  backgroundOpacity,
  maxStarCount,
  maxDSOCount,
  autoStarDensity,
  autoDSODensity,
  reduceDetailWhileMoving,
} = storeToRefs(display);

type Picker = 'pois' | 'labels' | 'types' | 'catalogs' | 'style' | 'hemisphere' | 'projection';
const pickerOpen = ref<Picker | null>(null);
const pickerIs = (name: Picker) =>
  computed({
    get: () => pickerOpen.value === name,
    set: (v: boolean) => {
      if (v) pickerOpen.value = name;
      else if (pickerOpen.value === name) pickerOpen.value = null;
    },
  });
const poisOpen = pickerIs('pois');
const labelsOpen = pickerIs('labels');
const typesOpen = pickerIs('types');
const catalogsOpen = pickerIs('catalogs');
const styleOpen = pickerIs('style');
const hemisphereOpen = pickerIs('hemisphere');
const projectionOpen = pickerIs('projection');

const STYLES: ConstellationStyle[] = ['western', 'stellarium', 'rey', 'chinese', 'arabic'];
const styleLabel = (style: string) =>
  t(`display.constellationStyle${style.charAt(0).toUpperCase()}${style.slice(1)}`);
const styleOptions = STYLES.map((value) => ({ value, label: styleLabel(value) }));
const hemisphereOptions = [
  { value: 'north' as const, label: t('display.hemisphereNorth') },
  { value: 'south' as const, label: t('display.hemisphereSouth') },
];
const projectionOptions = [
  { value: 'stereo' as const, label: t('display.projStereo') },
  { value: 'fisheye' as const, label: t('display.projFisheye') },
];
const typeOptions = DSO_TYPES_ALL.map((value) => ({ value, label: t(`dso.typeLabels.${value}`) }));
const catalogOptions = dsoCatalogOptions();
const projection = computed({
  get: () => (fisheye.active ? ('fisheye' as const) : ('stereo' as const)),
  set: (v?: 'stereo' | 'fisheye') => fisheye.setActive(v === 'fisheye'),
});

const countAria = (label: string, n: number, total: number) =>
  t('mobile.targets.countAria', { label, n, total });
const countOf = (n: number, total: number) => t('mobile.targets.countOf', { n, total });
/** How many of the keys are shown: a key is shown unless its flag is off. */
const count = (keys: string[], flags: Record<string, boolean>) => ({
  n: keys.filter((k) => flags[k] !== false).length,
  total: keys.length,
});
const categories = usePoiCategoriesStore();
const photoCount = (n: number) =>
  n === 1 ? t('mobile.sky.photoCountOne') : t('mobile.sky.photoCountMany', { n });
const poiGroups = shallowRef<CheckGroup[]>([]);
const poiOptions = computed(() => poiGroups.value.flatMap((g) => g.options));
const labelOptions = shallowRef<CheckOption[]>([]);
function readPhotos() {
  const photos = props.layer?.getPlacedPhotos().map((p) => p.photo) ?? [];
  poiGroups.value = buildPoiFilterGroups(
    photos.map((p) => p.pointsOfInterest ?? []),
    categories.categories,
  ).map((g) => ({
    id: g.category.id,
    label: g.category.name,
    color: g.category.color,
    options: g.names.map((n) => ({
      value: poiKey(g.category.id, n.name),
      label: n.name,
      sub: photoCount(n.count),
    })),
  }));
  labelOptions.value = buildLabelFilterItems(photos).map((i) => ({
    value: i.label,
    label: i.label === NO_LABEL ? t('display.noLabel') : i.label,
    sub: photoCount(i.count),
  }));
}
watch(open, (isOpen) => isOpen && readPhotos(), { immediate: true });
const keysOf = (options: CheckOption[]) => options.map((o) => o.value);
const poi = computed(() => count(keysOf(poiOptions.value), visiblePois.value));
const labels = computed(() => count(keysOf(labelOptions.value), visibleLabels.value));
/** The keys shown (every key is shown unless its flag is off). */
const shownOf = (options: CheckOption[], flags: Record<string, boolean>) =>
  keysOf(options).filter((k) => flags[k] !== false);
const poisShown = computed({
  get: () => shownOf(poiOptions.value, visiblePois.value),
  set: (shown: string[]) => {
    const on = new Set(shown);
    const keys = keysOf(poiOptions.value);
    display.setAllPois(
      keys.filter((k) => on.has(k)),
      true,
    );
    display.setAllPois(
      keys.filter((k) => !on.has(k)),
      false,
    );
  },
});
const labelsShown = computed({
  get: () => shownOf(labelOptions.value, visibleLabels.value),
  // the store's `setAllLabels` forgets the labels it is not given: each changed label is set on its own
  set: (shown: string[]) => {
    const on = new Set(shown);
    for (const k of keysOf(labelOptions.value))
      if ((visibleLabels.value[k] !== false) !== on.has(k)) display.setVisibleLabel(k, on.has(k));
  },
});
const styleName = computed(() => styleLabel(constellationStyle.value));
const hemisphereName = computed(() =>
  t(hemisphere.value === 'north' ? 'display.hemisphereNorth' : 'display.hemisphereSouth'),
);
const projectionName = computed(() =>
  t(fisheye.active ? 'display.projFisheye' : 'display.projStereo'),
);

// A slider that holds a number and applies it at once through the store's setter.
const latitude = computed({ get: () => borderLatDeg.value, set: display.setBorderLatDeg });
const skyOp = computed({ get: () => skyOpacity.value, set: display.setSkyOpacity });
const backgroundOp = computed({
  get: () => backgroundOpacity.value,
  set: display.setBackgroundOpacity,
});
// The density sliders move along the desktop's curve: a position from 0 to 1000 stands for a budget.
const starDensity = computed({
  get: () => budgetToSliderPos(maxStarCount.value, STAR_DENSITY_MAX),
  set: (pos: number) => display.setMaxStarCount(sliderPosToBudget(pos, STAR_DENSITY_MAX)),
});
const dsoDensity = computed({
  get: () => budgetToSliderPos(maxDSOCount.value, DSO_DENSITY_MAX),
  set: (pos: number) => display.setMaxDSOCount(sliderPosToBudget(pos, DSO_DENSITY_MAX)),
});
</script>

<template>
  <PhoneSheet v-model:open="open" :title="t('display.section')" tall>
    <PhoneSectionHeader>{{ t('display.photos') }}</PhoneSectionHeader>
    <PhoneToggleRow
      :model-value="showPhotos"
      :title="t('display.showPhotos')"
      @update:model-value="display.setShowPhotos"
    />
    <PhoneToggleRow
      :model-value="showPhotoOutlines"
      :title="t('display.photoOutlines')"
      @update:model-value="display.setShowPhotoOutlines"
    />
    <PhoneToggleRow
      :model-value="showPois"
      :title="t('display.showPois')"
      @update:model-value="display.setShowPois"
    />
    <div class="mob-form-row mob-form-row--field">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="countAria(t('gallery.filterPoi'), poi.n, poi.total)"
        @click="poisOpen = true"
      >
        <span class="mob-btn-key">{{ t('gallery.filterPoi') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{ countOf(poi.n, poi.total) }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <div class="mob-form-row mob-form-row--field">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="countAria(t('gallery.filterLabels'), labels.n, labels.total)"
        @click="labelsOpen = true"
      >
        <span class="mob-btn-key">{{ t('gallery.filterLabels') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{
          countOf(labels.n, labels.total)
        }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>

    <PhoneSectionHeader>{{ t('mobile.sky.sectionStars') }}</PhoneSectionHeader>
    <PhoneToggleRow
      :model-value="showStars"
      :title="t('display.showStars')"
      @update:model-value="display.setShowStars"
    />
    <PhoneToggleRow
      :model-value="showStarLabels"
      :title="t('display.starLabels')"
      @update:model-value="display.setShowStarLabels"
    />
    <PhoneToggleRow
      :model-value="showConstellationLines"
      :title="t('display.constellationLines')"
      @update:model-value="display.setShowConstellationLines"
    />
    <PhoneToggleRow
      :model-value="showConstellationNames"
      :title="t('display.constellationNames')"
      @update:model-value="display.setShowConstellationNames"
    />
    <div class="mob-form-row mob-form-row--field">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="
          t('mobile.format.labelValue', {
            label: t('display.constellationStyle'),
            value: styleName,
          })
        "
        @click="styleOpen = true"
      >
        <span class="mob-btn-key">{{ t('display.constellationStyle') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{ styleName }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>

    <PhoneSectionHeader>{{ t('dso.section') }}</PhoneSectionHeader>
    <PhoneToggleRow
      :model-value="showDSOs"
      :title="t('dso.showDSOs')"
      @update:model-value="display.setShowDSOs"
    />
    <PhoneToggleRow
      :model-value="showDSOLabels"
      :title="t('display.dsoLabels')"
      @update:model-value="display.setShowDSOLabels"
    />
    <div class="mob-form-row mob-form-row--field">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="countAria(t('gallery.filterTypes'), dsoTypes.length, DSO_TYPES_ALL.length)"
        @click="typesOpen = true"
      >
        <span class="mob-btn-key">{{ t('gallery.filterTypes') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{
          countOf(dsoTypes.length, DSO_TYPES_ALL.length)
        }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <div class="mob-form-row mob-form-row--field">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="
          countAria(t('gallery.filterCatalogs'), dsoCatalogs.length, DSO_CATALOGS_ALL.length)
        "
        @click="catalogsOpen = true"
      >
        <span class="mob-btn-key">{{ t('gallery.filterCatalogs') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{
          countOf(dsoCatalogs.length, DSO_CATALOGS_ALL.length)
        }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>

    <PhoneSectionHeader>{{ t('mobile.sky.sectionMap') }}</PhoneSectionHeader>
    <PhoneToggleRow
      :model-value="showGrid"
      :title="t('display.raDecGrid')"
      @update:model-value="display.setShowGrid"
    />
    <div class="mob-form-row mob-form-row--field">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="
          t('mobile.format.labelValue', { label: t('display.hemisphere'), value: hemisphereName })
        "
        @click="hemisphereOpen = true"
      >
        <span class="mob-btn-key">{{ t('display.hemisphere') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{ hemisphereName }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <div class="mob-form-row mob-form-row--field">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="
          t('mobile.format.labelValue', { label: t('display.fisheye'), value: projectionName })
        "
        @click="projectionOpen = true"
      >
        <span class="mob-btn-key">{{ t('display.fisheye') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{ projectionName }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <PhoneSliderRow
      v-model="latitude"
      :label="t('display.borderLatDeg')"
      :info="t('display.borderLatTooltip')"
      :min="0"
      :max="90"
      :display="`${latitude}°`"
    />
    <PhoneSliderRow
      v-model="skyOp"
      stack
      :label="t('display.skyOpacity')"
      :min="0"
      :max="1"
      :step="0.05"
      :display="skyOp.toFixed(2)"
    />
    <PhoneSliderRow
      v-model="backgroundOp"
      stack
      :label="t('display.backgroundGradient')"
      :min="0"
      :max="1"
      :step="0.05"
      :display="backgroundOp.toFixed(2)"
    />

    <PhoneSectionHeader>{{ t('performance.section') }}</PhoneSectionHeader>
    <PhoneSliderRow
      v-model="starDensity"
      stack
      :label="t('display.maxStarCount')"
      :min="0"
      :max="SLIDER_STEPS"
      :disabled="autoStarDensity"
    />
    <PhoneToggleRow
      :model-value="autoStarDensity"
      :title="t('display.autoDensity')"
      @update:model-value="display.setAutoStarDensity"
    />
    <PhoneSliderRow
      v-model="dsoDensity"
      stack
      :label="t('display.maxDSOCount')"
      :min="0"
      :max="SLIDER_STEPS"
      :disabled="autoDSODensity"
    />
    <PhoneToggleRow
      :model-value="autoDSODensity"
      :title="t('display.autoDensity')"
      @update:model-value="display.setAutoDSODensity"
    />
    <PhoneToggleRow
      :model-value="reduceDetailWhileMoving"
      :title="t('performance.smoothMotion')"
      @update:model-value="display.setReduceDetailWhileMoving"
    />

    <SkyCheckSheet
      v-model:open="poisOpen"
      :title="t('gallery.filterPoi')"
      :options="poiOptions"
      :groups="poiGroups"
      v-model:selected="poisShown"
    />
    <SkyCheckSheet
      v-model:open="labelsOpen"
      :title="t('gallery.filterLabels')"
      :options="labelOptions"
      v-model:selected="labelsShown"
    />
    <SkyCheckSheet
      v-model:open="typesOpen"
      :title="t('gallery.filterTypes')"
      :options="typeOptions"
      :selected="dsoTypes"
      @update:selected="display.setDsoTypes"
    />
    <SkyCheckSheet
      v-model:open="catalogsOpen"
      :title="t('gallery.filterCatalogs')"
      :options="catalogOptions"
      :selected="dsoCatalogs"
      @update:selected="display.setDsoCatalogs"
    />
    <PhoneRadioSheet
      v-model:open="styleOpen"
      :title="t('display.constellationStyle')"
      :options="styleOptions"
      :value="constellationStyle"
      @update:value="(v) => v && display.setConstellationStyle(v)"
    />
    <PhoneRadioSheet
      v-model:open="hemisphereOpen"
      :title="t('display.hemisphere')"
      :options="hemisphereOptions"
      :value="hemisphere"
      @update:value="(v) => v && display.setHemisphere(v)"
    />
    <PhoneRadioSheet
      v-model:open="projectionOpen"
      :title="t('display.fisheye')"
      :options="projectionOptions"
      v-model:value="projection"
    />
  </PhoneSheet>
</template>
