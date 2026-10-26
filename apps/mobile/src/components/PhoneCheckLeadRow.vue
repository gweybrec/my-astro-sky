<script setup lang="ts">
import { IonCheckbox } from '@ionic/vue';

// A row with a tick box at its start, in the round holder of a row's lead (`.mob-row-lead`), and its title and lines
// beside it: the tick box and the text are two targets (the board "Ciel, contours de champ": the tick box shows a
// frame on the map, the text centres it). Without `button` the text is not a target and the whole row ticks.
// `current` highlights the row (the comet a tap on the photo moves); the `badges` slot goes between the title and the
// lines, the `actions` slot under the text (`.mob-row-actions`: text buttons).
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
    current?: boolean;
  }>(),
  { subs: () => [] },
);
const emit = defineEmits<{ open: [] }>();
const model = defineModel<boolean>({ default: false });
</script>

<template>
  <div class="mob-row mob-check-lead-row" :class="{ 'mob-row--current': current }">
    <span class="mob-row-lead">
      <IonCheckbox
        class="mob-lead-check"
        :aria-label="checkLabel ?? title"
        :checked="model"
        :indeterminate="indeterminate"
        @ion-change="model = $event.detail.checked"
      />
    </span>
    <!-- With actions under the text, the text and the actions are one column. -->
    <span v-if="button && $slots.actions" class="mob-row-body">
      <button type="button" class="mob-row-text" @click="emit('open')">
        <span class="mob-row-title mob-row-title--wrap m-body">{{ title }}</span>
        <span v-if="$slots.badges" class="mob-row-badges"><slot name="badges" /></span>
        <span v-for="line in subs" :key="line" class="mob-row-sub mob-row-sub--wrap m-secondary">{{
          line
        }}</span>
      </button>
      <span class="mob-row-actions"><slot name="actions" /></span>
    </span>
    <button
      v-else-if="button"
      type="button"
      class="mob-row-body mob-check-lead-text"
      @click="emit('open')"
    >
      <span class="mob-row-title m-body">{{ title }}</span>
      <span v-if="$slots.badges" class="mob-row-badges"><slot name="badges" /></span>
      <span v-for="line in subs" :key="line" class="mob-row-sub m-secondary">{{ line }}</span>
    </button>
    <span v-else class="mob-row-body" @click="model = !model">
      <span class="mob-row-title m-body">{{ title }}</span>
      <span v-for="line in subs" :key="line" class="mob-row-sub m-secondary">{{ line }}</span>
    </span>
  </div>
</template>
