<script setup lang="ts">
import PhoneButton from './PhoneButton.vue';
import AppIcon from './AppIcon.vue';
import minusIcon from '../icons/minus.svg?raw';
import plusIcon from '@icons/plus.svg?raw';

// A stepper row (`.mob-stepper-row`): label | minus | value | plus, the three right columns the same in every stepper
// row. A tap steps the value by `step`, within `min` and `max` (the button at the end is greyed).
const props = withDefaults(
  defineProps<{
    label: string;
    /** The accessible names of the two buttons ("Moins de lignes", "Plus de lignes"). */
    lessLabel: string;
    moreLabel: string;
    min?: number;
    max?: number;
    step?: number;
  }>(),
  { min: -Infinity, max: Infinity, step: 1 },
);
const model = defineModel<number>({ required: true });
const stepBy = (n: number) => {
  model.value = Math.min(props.max, Math.max(props.min, model.value + n));
};
</script>

<template>
  <div class="mob-stepper-row" role="group" :aria-label="label">
    <span class="mob-stepper-label m-body">{{ label }}</span>
    <PhoneButton :aria-label="lessLabel" :disabled="model <= min" @click="stepBy(-step)"
      ><AppIcon :svg="minusIcon"
    /></PhoneButton>
    <span class="mob-stepper-value m-mono" aria-live="polite">{{ model }}</span>
    <PhoneButton :aria-label="moreLabel" :disabled="model >= max" @click="stepBy(step)"
      ><AppIcon :svg="plusIcon"
    /></PhoneButton>
  </div>
</template>
