<template>
  <CollapsibleSection :title="t('performance.section')" :default-open="true">
    <!-- Star density -->
    <div class="display-controls-mag-row">
      <label class="display-controls-mag-label">{{ t('display.maxStarCount') }} </label>
      <input
        type="range"
        class="display-controls-mag-slider"
        :class="{ 'opacity-40': displayStore.autoStarDensity }"
        min="0"
        :max="SLIDER_STEPS"
        step="1"
        :disabled="displayStore.autoStarDensity"
        :value="budgetToSliderPos(displayStore.maxStarCount, STAR_DENSITY_MAX)"
        @input="(e) => displayStore.setMaxStarCount(sliderPosToBudget(parseInt((e.target as HTMLInputElement).value), STAR_DENSITY_MAX))"
      />
    </div>
    <CheckRow
      :label="t('display.autoDensity')"
      :model-value="displayStore.autoStarDensity"
      @update:model-value="displayStore.setAutoStarDensity"
    />

    <!-- DSO density -->
    <div class="display-controls-mag-row">
      <label class="display-controls-mag-label">{{ t('display.maxDSOCount') }} </label>
      <input
        type="range"
        class="display-controls-mag-slider"
        :class="{ 'opacity-40': displayStore.autoDSODensity }"
        min="0"
        :max="SLIDER_STEPS"
        step="1"
        :disabled="displayStore.autoDSODensity"
        :value="budgetToSliderPos(displayStore.maxDSOCount, DSO_DENSITY_MAX)"
        @input="(e) => displayStore.setMaxDSOCount(sliderPosToBudget(parseInt((e.target as HTMLInputElement).value), DSO_DENSITY_MAX))"
      />
    </div>
    <CheckRow
      :label="t('display.autoDensity')"
      :model-value="displayStore.autoDSODensity"
      @update:model-value="displayStore.setAutoDSODensity"
    />

    <!-- Motion level-of-detail. Checked = reduce detail for smooth pan/zoom (default);
         uncheck to keep full detail while moving (no flicker, heavier). -->
    <CheckRow
      :label="t('performance.smoothMotion')"
      :model-value="displayStore.reduceDetailWhileMoving"
      @update:model-value="displayStore.setReduceDetailWhileMoving"
    />
  </CollapsibleSection>
</template>

<script setup lang="ts">
import CollapsibleSection from '../base/CollapsibleSection.vue';
import CheckRow from '../base/CheckRow.vue';
import { useDisplayStore } from '../../stores/display';
import { useI18n } from '../../composables/useI18n';
import {
  sliderPosToBudget, budgetToSliderPos,
  STAR_DENSITY_MAX, DSO_DENSITY_MAX, SLIDER_STEPS,
} from '../../density-slider';

const { t } = useI18n();
const displayStore = useDisplayStore();
</script>
