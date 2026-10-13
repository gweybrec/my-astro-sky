<script setup lang="ts">
import { IonItem } from '@ionic/vue';
import AppIcon from './AppIcon.vue';
import PhoneBusy from './PhoneBusy.vue';
import chevronIcon from '../icons/chevron-right.svg?raw';

// A list row (`.mob-row`) on Ionic's item: title, up to a few lines under it, a leading icon, a trailing value,
// a chevron, or anything in the `trail` slot (a switch, a button). A row with `button` is a tap target.
withDefaults(
  defineProps<{
    title: string;
    /** Lines under the title (the secondary text). */
    subs?: string[];
    /** The value before the chevron. */
    value?: string;
    /** The value and the lines under the title are figures (times, counts): drawn in the mono face. */
    mono?: boolean;
    /** A colour dot instead of the leading icon (an observation window's colour; any CSS colour). */
    swatch?: string;
    chevron?: boolean;
    /** SVG markup of a leading icon in a round tinted holder. */
    lead?: string;
    /** SVG markup of a picture placeholder in a square holder (a file in a list). */
    thumb?: string;
    /** How the line under the title reads: a finished state (green), a running operation (spinner and accent), or a failure (red). */
    status?: 'success' | 'busy' | 'danger';
    /** The delete row: lead and title in the danger colour. */
    danger?: boolean;
    /** Three-line rows take more room above and below. */
    roomy?: boolean;
    /** The title may wrap onto a second line (a long desktop label). */
    wrap?: boolean;
    disabled?: boolean;
    /** Waits for a screen that is not built yet: drawn as the board draws the row, without a tap. */
    inert?: boolean;
    /** A tap target (a button); without it the row is only text. */
    button?: boolean;
  }>(),
  { subs: () => [] },
);
const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <IonItem
    class="mob-row"
    :class="{
      'mob-row--danger': danger,
      'mob-row--roomy': roomy,
      'mob-row--disabled': disabled,
      'mob-row--inert': inert,
    }"
    lines="none"
    :button="button && !disabled && !inert"
    :aria-disabled="inert ? 'true' : undefined"
    :detail="false"
    @click="emit('click', $event)"
  >
    <div class="mob-row-line">
      <span v-if="swatch" class="mob-row-lead"
        ><span class="mob-swatch" :style="{ background: swatch }"
      /></span>
      <span v-else-if="lead" class="mob-row-lead"><AppIcon :svg="lead" /></span>
      <span v-else-if="thumb" class="mob-row-thumb"><AppIcon :svg="thumb" /></span>
      <span class="mob-row-body">
        <span class="mob-row-title m-body" :class="{ 'mob-row-title--wrap': wrap }">{{
          title
        }}</span>
        <span
          v-for="line in subs"
          :key="line"
          class="mob-row-sub mob-row-sub--wrap m-secondary"
          :class="{
            'mob-status--success': status === 'success',
            'mob-status--danger': status === 'danger',
            'mob-row-sub--busy': status === 'busy',
          }"
          ><PhoneBusy v-if="status === 'busy'" :label="line" /><span
            v-else-if="mono"
            class="m-mono"
            >{{ line }}</span
          ><template v-else>{{ line }}</template></span
        >
      </span>
      <span v-if="value || chevron || $slots.trail" class="mob-row-trail m-secondary">
        <span v-if="value" :class="{ 'm-mono': mono }">{{ value }}</span>
        <slot name="trail" />
        <span v-if="chevron" class="mob-row-chevron" aria-hidden="true"
          ><AppIcon :svg="chevronIcon"
        /></span>
      </span>
    </div>
  </IonItem>
</template>
