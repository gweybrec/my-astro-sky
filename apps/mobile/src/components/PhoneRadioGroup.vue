<script setup lang="ts" generic="V extends string">
import { IonRadio, IonRadioGroup } from '@ionic/vue';

// A group of choice rows (`.mob-row` with the design system's `.mob-radio` at the right end) on Ionic's radio group:
// the whole row is the tap target, and a tap reports `pick` even on the row already chosen. Nothing is chosen while
// `modelValue` is undefined.
defineProps<{
  options: readonly { value: V; label: string }[];
  /** The accessible name of the group (the item the choice is about). */
  label?: string;
}>();
const model = defineModel<V | undefined>();
const emit = defineEmits<{ pick: [value: V] }>();
</script>

<template>
  <IonRadioGroup
    class="mob-radio-group"
    :value="model"
    :aria-label="label"
    @ion-change="model = $event.detail.value"
  >
    <IonRadio
      v-for="o in options"
      :key="o.value"
      class="mob-row mob-radio-row"
      :value="o.value"
      justify="space-between"
      label-placement="start"
      @click="emit('pick', o.value)"
    >
      <span class="mob-row-body">
        <span class="mob-row-title mob-row-title--wrap m-body">{{ o.label }}</span>
      </span>
    </IonRadio>
  </IonRadioGroup>
</template>
