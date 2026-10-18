<script setup lang="ts">
import { IonCheckbox } from '@ionic/vue';

// A row with a tick box at its start, in the round holder of a row's lead (`.mob-row-lead`), and its title and lines
// beside it: the tick box and the text are two targets (the board "Ciel, contours de champ": the tick box shows a
// frame on the map, the text centres it). Without `button` the text is not a target and the whole row ticks.
withDefaults(
  defineProps<{
    title: string;
    subs?: string[];
    /** The tick box stands for several others that are not all ticked ("Tout sélectionner"). */
    indeterminate?: boolean;
    /** The text is a tap target of its own (it emits `open`). */
    button?: boolean;
    /** The tick box's name for a screen reader. */
    checkLabel?: string;
  }>(),
  { subs: () => [] },
);
const emit = defineEmits<{ open: [] }>();
const model = defineModel<boolean>({ default: false });
</script>

<template>
  <div class="mob-row mob-check-lead-row">
    <span class="mob-row-lead">
      <IonCheckbox
        class="mob-lead-check"
        :aria-label="checkLabel ?? title"
        :checked="model"
        :indeterminate="indeterminate"
        @ion-change="model = $event.detail.checked"
      />
    </span>
    <button
      v-if="button"
      type="button"
      class="mob-row-body mob-check-lead-text"
      @click="emit('open')"
    >
      <span class="mob-row-title m-body">{{ title }}</span>
      <span v-for="line in subs" :key="line" class="mob-row-sub m-secondary">{{ line }}</span>
    </button>
    <span v-else class="mob-row-body" @click="model = !model">
      <span class="mob-row-title m-body">{{ title }}</span>
      <span v-for="line in subs" :key="line" class="mob-row-sub m-secondary">{{ line }}</span>
    </span>
  </div>
</template>
