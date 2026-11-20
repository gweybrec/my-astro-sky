<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import chevronIcon from '../icons/chevron-right.svg?raw';

// A completion row (`.mob-progress-row`): the label in full with the count on its baseline, then a full-width bar in
// an outlined track, so the remaining gap and 100 % read at a glance (Réglages, statistiques: one row per DSO catalog
// family). With `button` the row opens what it counts: a chevron follows the count.
defineProps<{
  title: string;
  /** The "N / M" text beside the label. */
  value: string;
  /** 0-100. */
  percent: number;
  /** A tap target, with a chevron (a catalogue opens its objects). */
  button?: boolean;
  /** The button's accessible name, when the title alone does not say what it opens. */
  label?: string;
}>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <component
    :is="button ? 'button' : 'div'"
    class="mob-progress-row"
    :class="{ 'phone-progress-button': button }"
    :type="button ? 'button' : undefined"
    :aria-label="button ? label : undefined"
    @click="button && emit('click', $event)"
  >
    <div class="mob-progress-head">
      <span class="mob-progress-label m-body">{{ title }}</span>
      <span class="mob-progress-value m-mono">{{ value }}</span>
      <span v-if="button" class="mob-row-chevron phone-progress-chevron" aria-hidden="true"
        ><AppIcon :svg="chevronIcon"
      /></span>
    </div>
    <div class="mob-progress-track">
      <div class="mob-progress-fill" :style="{ width: percent + '%' }" />
    </div>
  </component>
</template>
