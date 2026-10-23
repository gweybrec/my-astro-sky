<script setup lang="ts">
import { useId } from 'vue';
import { IonModal } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import AppIcon from './AppIcon.vue';
import PhoneIconButton from './PhoneIconButton.vue';
import backIcon from '../icons/arrow-left.svg?raw';

// A bottom sheet (`.mob-sheet`) on Ionic's modal. It takes the height of its content (60 % of the screen at most, 70 %
// with `tall`), the body scrolls past that. The Android back button and a tap on the backdrop close it (Ionic's
// overlay handling), and so does dragging it down from its header or handle (Ionic's sheet gesture: breakpoints 0 and 1,
// the content's height as the 1; the body is a scroll host, so it scrolls first). A sheet has no close button: a sheet
// without a footer applies its changes at once. With `back`, the header starts with a back arrow (`back` event): the
// sheet replaced another, which the arrow opens again (board "Photo, choisir une identification"). With `third`, in
// portrait, it is at most a third of the screen under the top bar (board "Photo, informations"): its body scrolls.
defineProps<{
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
</script>

<template>
  <IonModal
    class="mob-sheet-modal"
    :class="{ 'mob-sheet-modal--third': third }"
    :is-open="open"
    :breakpoints="[0, 1]"
    :initial-breakpoint="1"
    :handle="false"
    @did-dismiss="emit('update:open', false)"
  >
    <section
      class="mob-sheet"
      :class="tall ? 'mob-sheet--auto-lg' : 'mob-sheet--auto'"
      :aria-labelledby="titleId"
    >
      <button
        type="button"
        class="mob-sheet-grab"
        :aria-label="t('modal.close')"
        @click="emit('update:open', false)"
      >
        <span class="mob-sheet-handle" />
      </button>
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
