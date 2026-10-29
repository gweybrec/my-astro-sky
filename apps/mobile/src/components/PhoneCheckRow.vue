<script setup lang="ts">
import { IonCheckbox } from '@ionic/vue';

// A row with a tick box at its right end (`.mob-row` + `.mob-check`) on Ionic's checkbox: the whole row is the tap
// target. The title wraps; `subs` are the lines under it and `warn` the ones in the warning colour. The `badges` slot
// goes between the title and the lines (`.mob-row-badges`), the `actions` slot under them (`.mob-row-actions`: text
// buttons, which stop their tap so that it does not tick the row), the `trail` slot between the lines and the box (an icon
// button, the bin of a custom telescope, which stops its tap too). A group's row ("Ciel, affichage, points d'intérêt":
// a type of point of interest) has its colour dot at the start and a bold title, and is half ticked when only some of
// its names are.
withDefaults(
  defineProps<{
    title: string;
    subs?: string[];
    warn?: string[];
    disabled?: boolean;
    /** A colour dot before the title (any CSS colour). */
    swatch?: string;
    /** The title in the strong weight (a group's row). */
    strong?: boolean;
    /** The tick box stands for several others that are not all ticked. */
    indeterminate?: boolean;
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
    :indeterminate="indeterminate"
    :disabled="disabled"
    @ion-change="model = $event.detail.checked"
  >
    <span v-if="swatch" class="mob-row-lead"
      ><span class="mob-swatch" :style="{ background: swatch }"
    /></span>
    <span class="mob-row-body">
      <span
        class="mob-row-title mob-row-title--wrap"
        :class="strong ? 'm-body-strong' : 'm-body'"
        >{{ title }}</span
      >
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
      <span v-if="$slots.actions" class="mob-row-actions" @click.stop><slot name="actions" /></span>
    </span>
    <span v-if="$slots.trail" class="mob-row-trail" @click.stop><slot name="trail" /></span>
  </IonCheckbox>
</template>
