<script setup lang="ts">
import { IonRange } from '@ionic/vue';
import PhoneInfoButton from './PhoneInfoButton.vue';

// A slider row (`.mob-slider-row`): label | slider | value. The change applies at once. With `info` the label is
// followed by the "i" button (its explanation opens in the small dialog); the row is then stacked.
defineProps<{
  label: string;
  /** The value as printed (the desktop's format); without it the slider takes the whole width. */
  display?: string;
  min: number;
  max: number;
  step?: number;
  /** The label on a line of its own (a long setting name). */
  stack?: boolean;
  /** The explanation behind an "i" button after the label. */
  info?: string;
  disabled?: boolean;
}>();
const model = defineModel<number>({ required: true });
</script>

<template>
  <div
    class="mob-slider-row"
    :class="{ 'mob-slider-row--stack': stack || info, 'mob-slider-row--info': info }"
  >
    <span class="mob-slider-label m-body">{{ label }}</span>
    <PhoneInfoButton v-if="info" :title="label" :message="info" />
    <IonRange
      class="mob-slider"
      :aria-label="label"
      :min="min"
      :max="max"
      :step="step ?? 1"
      :value="model"
      :disabled="disabled"
      @ion-input="model = $event.detail.value as number"
    />
    <span v-if="display !== undefined" class="mob-slider-value m-mono">{{ display }}</span>
  </div>
</template>
