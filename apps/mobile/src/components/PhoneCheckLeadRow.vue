<script setup lang="ts">
import { IonCheckbox } from '@ionic/vue';

// A row with a tick box at its start, in the round holder of a row's lead (`.mob-row-lead`), and its title and lines
// beside it: the tick box and the text are two targets (the board "Ciel, contours de champ": the tick box shows a
// frame on the map, the text centres it). The tick box's target is the whole strip before the text (the row's start,
// its height and the gap), never the text. Without `button` the text is not a target and the whole row ticks.
// `current` highlights the row (the result a tap on the photo moves); `subs` are the lines under the title and `warn`
// the ones in the warning colour; the `badges` slot goes between the title and the lines, the `actions` slot under the
// text (`.mob-row-actions`: text buttons).
withDefaults(
  defineProps<{
    title: string;
    subs?: string[];
    warn?: string[];
    /** The tick box stands for several others that are not all ticked ("Tout sélectionner"). */
    indeterminate?: boolean;
    /** The text is a tap target of its own (it emits `open`). */
    button?: boolean;
    /** The tick box's name for a screen reader. */
    checkLabel?: string;
    current?: boolean;
  }>(),
  { subs: () => [], warn: () => [] },
);
const emit = defineEmits<{ open: [] }>();
const model = defineModel<boolean>({ default: false });

/** A tap in the strip around the tick box ticks it; one on the box itself is the box's own. */
function onStripClick(e: MouseEvent) {
  if ((e.target as Element | null)?.closest('.mob-lead-check')) return;
  model.value = !model.value;
}
</script>

<template>
  <div class="mob-row mob-check-lead-row" :class="{ 'mob-row--current': current }">
    <span class="mob-check-lead-hit" @click="onStripClick">
      <span class="mob-row-lead">
        <IonCheckbox
          class="mob-lead-check"
          :aria-label="checkLabel ?? title"
          :checked="model"
          :indeterminate="indeterminate"
          @ion-change="model = $event.detail.checked"
        />
      </span>
    </span>
    <!-- With actions under the text, the text and the actions are one column. -->
    <span v-if="button && $slots.actions" class="mob-row-body">
      <button type="button" class="mob-row-text" @click="emit('open')">
        <span class="mob-row-title mob-row-title--wrap m-body">{{ title }}</span>
        <span v-if="$slots.badges" class="mob-row-badges"><slot name="badges" /></span>
        <span v-for="line in subs" :key="line" class="mob-row-sub mob-row-sub--wrap m-secondary">{{
          line
        }}</span>
        <span
          v-for="line in warn"
          :key="line"
          class="mob-row-sub mob-row-sub--wrap mob-status--warn m-secondary"
          >{{ line }}</span
        >
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
      <span v-for="line in warn" :key="line" class="mob-row-sub mob-status--warn m-secondary">{{
        line
      }}</span>
    </button>
    <span v-else class="mob-row-body" @click="model = !model">
      <span class="mob-row-title m-body">{{ title }}</span>
      <span v-for="line in subs" :key="line" class="mob-row-sub m-secondary">{{ line }}</span>
      <span v-for="line in warn" :key="line" class="mob-row-sub mob-status--warn m-secondary">{{
        line
      }}</span>
    </span>
  </div>
</template>
