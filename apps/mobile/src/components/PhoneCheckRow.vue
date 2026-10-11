<script setup lang="ts">
import { IonCheckbox } from '@ionic/vue';

// A row with a tick box at its right end (`.mob-row` + `.mob-check`) on Ionic's checkbox: the whole row is the tap
// target. The title wraps; `subs` are the lines under it and `warn` the ones in the warning colour.
withDefaults(
  defineProps<{
    title: string;
    subs?: string[];
    warn?: string[];
    disabled?: boolean;
  }>(),
  { subs: () => [], warn: () => [] },
);
const model = defineModel<boolean>({ default: false });
</script>

<template>
  <IonCheckbox
    class="mob-row mob-check-row"
    justify="space-between"
    label-placement="start"
    :checked="model"
    :disabled="disabled"
    @ion-change="model = $event.detail.checked"
  >
    <span class="mob-row-body">
      <span class="mob-row-title mob-row-title--wrap m-body">{{ title }}</span>
      <span v-for="line in subs" :key="line" class="mob-row-sub mob-row-sub--wrap m-secondary">{{
        line
      }}</span>
      <span
        v-for="line in warn"
        :key="line"
        class="mob-row-sub mob-row-sub--wrap mob-status--warn m-secondary"
        >{{ line }}</span
      >
    </span>
  </IonCheckbox>
</template>
