<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '@myastrosky/core/i18n/index';
import { DSO_TYPES_ALL } from '@myastrosky/core/display-settings';
import { DSO_CATALOGS_ALL } from '@myastrosky/core/catalog/dso-registry';
import {
  budgetToSliderPos,
  DSO_DENSITY_MAX,
  SLIDER_STEPS,
  sliderPosToBudget,
  STAR_DENSITY_MAX,
} from '@myastrosky/core/density-slider';
import { useDisplayStore } from '@myastrosky/app-state/stores/display';
import { useFisheyeStore } from '@myastrosky/app-state/stores/fisheye';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import PhoneToggleRow from '../../components/PhoneToggleRow.vue';
import PhoneSliderRow from '../../components/PhoneSliderRow.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import AppIcon from '../../components/AppIcon.vue';
import caretIcon from '../../icons/chevron-down.svg?raw';

// The board "Ciel, affichage": the map's display settings of the desktop's side panel. Every change applies at once.
// The pickers behind the field buttons (points of interest, labels, drawing style, types, catalogues, hemisphere,
// projection) have no board yet: the fields show the current value only.
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

const countAria = (label: string, n: number, total: number) =>
  t('mobile.targets.countAria', { label, n, total });
const countOf = (n: number, total: number) => t('mobile.targets.countOf', { n, total });
const count = (flags: Record<string, boolean>) => {
  const keys = Object.keys(flags);
  return { n: keys.filter((k) => flags[k] !== false).length, total: keys.length };
};
const poi = computed(() => count(visiblePois.value));
const labels = computed(() => count(visibleLabels.value));
const styleName = computed(() => {
  const style = constellationStyle.value;
  return t(`display.constellationStyle${style.charAt(0).toUpperCase()}${style.slice(1)}`);
});
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
  <PhoneSheet v-model:open="open" :title="t('display.section')" closable tall>
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
        :aria-label="`${t('display.constellationStyle')} : ${styleName}`"
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
        :aria-label="`${t('display.hemisphere')} : ${hemisphereName}`"
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
        :aria-label="`${t('display.fisheye')} : ${projectionName}`"
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
  </PhoneSheet>
</template>
