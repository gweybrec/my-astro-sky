<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { IonModal } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import AppIcon from './AppIcon.vue';
import PhoneIconButton from './PhoneIconButton.vue';
import PhoneSheetGrab from './PhoneSheetGrab.vue';
import { useSheetStops } from '../composables/useSheetStops';
import backIcon from '../icons/arrow-left.svg?raw';

// A bottom sheet (`.mob-sheet`) on Ionic's modal. It takes the height of its content (60 % of the screen at most, 70 %
// with `tall`), the body scrolls past that. The Android back button and a tap on the backdrop close it (Ionic's
// overlay handling), and so does dragging it down (Ionic's sheet gesture, which follows the finger: breakpoints 0 and 1,
// the content's height as the 1; the body is a scroll host, so it scrolls first). A sheet has no close button: a sheet
// without a footer applies its changes at once. With `back`, the header starts with a back arrow (`back` event): the
// sheet replaced another, which the arrow opens again (board "Photo, choisir une identification"). With `third`, its
// stops are measured before it opens (board "Photo, informations"): where its content marks them (`data-sheet-stop`,
// under a line or above a row) it opens at the first mark, stops at each, then shows everything the screen under the
// top bar holds; without marks, in portrait, it opens at most a third of that room and goes up to two thirds.
const props = defineProps<{
  open: boolean;
  title: string;
  /** A line under the title (`.mob-meta`): what the sheet is about. */
  subtitle?: string;
  tall?: boolean;
  /** The footer is hidden, not removed (a search's results take its place above the keyboard). */
  footerHidden?: boolean;
  back?: boolean;
  third?: boolean;
}>();
const emit = defineEmits<{ 'update:open': [open: boolean]; back: [] }>();
const titleId = useId();

const room = ref<HTMLElement>();
const sheet = ref<HTMLElement>();
const { stops, measure } = useSheetStops(
  () => room.value,
  () => sheet.value,
  () => props.third,
  () => 0,
  true,
);
// A sheet held to a third is measured, its content mounted while closed, before it opens at the stops found.
const measured = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!props.third) return;
    measured.value = false;
    if (open)
      void nextTick(() => {
        measure();
        measured.value = true;
      });
  },
  { immediate: true },
);
const shown = computed(() => props.open && (!props.third || measured.value));
const modalStyle = computed(() =>
  props.third && stops.value?.height ? { '--height': `${stops.value.height}px` } : undefined,
);
const sheetStyle = computed(() =>
  props.third && stops.value?.max ? { '--sheet-stop-max': `${stops.value.max}px` } : undefined,
);
function dismissed() {
  emit('update:open', false);
}
</script>

<template>
  <IonModal
    class="mob-sheet-modal"
    :class="{ 'mob-sheet-modal--third': third }"
    :is-open="shown"
    :breakpoints="(third && stops?.breakpoints) || [0, 1]"
    :initial-breakpoint="(third && stops?.initial) || 1"
    :handle="false"
    :expand-to-scroll="!third"
    :keep-contents-mounted="third"
    :style="modalStyle"
    @did-dismiss="dismissed"
  >
    <section
      ref="sheet"
      class="mob-sheet"
      :class="[
        tall ? 'mob-sheet--auto-lg' : 'mob-sheet--auto',
        { 'mob-sheet--fixed': third && stops?.height },
      ]"
      :style="sheetStyle"
      :aria-labelledby="titleId"
    >
      <div v-if="third" ref="room" class="mob-sheet-room" aria-hidden="true" />
      <PhoneSheetGrab :label="t('modal.close')" @click="emit('update:open', false)" />
      <div class="mob-sheet-header" :class="{ 'mob-sheet-header--bar': back }">
        <PhoneIconButton v-if="back" :label="t('mobile.nav.back')" @click="emit('back')">
          <AppIcon :svg="backIcon" />
        </PhoneIconButton>
        <h2 :id="titleId" class="mob-sheet-title m-title">{{ title }}</h2>
        <div v-if="subtitle" class="mob-meta m-secondary">
          <span>{{ subtitle }}</span>
        </div>
        <slot name="header-trail" />
        <slot name="header-extra" />
      </div>
      <div class="mob-sheet-body mob-scroll ion-content-scroll-host"><slot /></div>
      <div v-if="$slots.footer" v-show="!footerHidden" class="mob-sheet-footer">
        <slot name="footer" />
      </div>
    </section>
  </IonModal>
</template>
