<script setup lang="ts">
import { IonRange } from '@ionic/vue';

// A slider row (`.mob-slider-row`): label | slider | value. The change applies at once.
defineProps<{
  label: string;
  /** The value as printed (the desktop's format); without it the slider takes the whole width. */
  display?: string;
  min: number;
  max: number;
  step?: number;
  /** The label on a line of its own (a long setting name). */
  stack?: boolean;
  disabled?: boolean;
}>();
const model = defineModel<number>({ required: true });
</script>

<template>
  <div class="mob-slider-row" :class="{ 'mob-slider-row--stack': stack }">
    <span class="mob-slider-label m-body">{{ label }}</span>
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
