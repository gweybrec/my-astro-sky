<script setup lang="ts">
import { useId } from 'vue';
import { IonModal } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import PhoneIconButton from './PhoneIconButton.vue';
import AppIcon from './AppIcon.vue';
import closeIcon from '@icons/close-x.svg?raw';

// A bottom sheet (`.mob-sheet`) on Ionic's modal. It takes the height of its content (60 % of the screen at most, 70 %
// with `tall`), the body scrolls past that. The Android back button and a tap on the backdrop close it (Ionic's
// overlay handling), and so does dragging it down from its header or handle (Ionic's sheet gesture: breakpoints 0 and 1,
// the content's height as the 1; the body is a scroll host, so it scrolls first). A sheet without a footer applies its changes at once and has the close button in its header.
defineProps<{
  open: boolean;
  title: string;
  /** A line under the title (`.mob-meta`): what the sheet is about. */
  subtitle?: string;
  closable?: boolean;
  tall?: boolean;
}>();
const emit = defineEmits<{ 'update:open': [open: boolean] }>();
const titleId = useId();
</script>

<template>
  <IonModal
    class="mob-sheet-modal"
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
      <div class="mob-sheet-header" :class="{ 'mob-sheet-header--bar': closable }">
        <h2 :id="titleId" class="mob-sheet-title m-title">{{ title }}</h2>
        <div v-if="subtitle" class="mob-meta m-secondary">
          <span>{{ subtitle }}</span>
        </div>
        <slot name="header-trail" />
        <PhoneIconButton
          v-if="closable"
          :label="t('modal.close')"
          @click="emit('update:open', false)"
        >
          <AppIcon :svg="closeIcon" />
        </PhoneIconButton>
        <slot name="header-extra" />
      </div>
      <div class="mob-sheet-body mob-scroll ion-content-scroll-host"><slot /></div>
      <div v-if="$slots.footer" class="mob-sheet-footer"><slot name="footer" /></div>
    </section>
  </IonModal>
</template>
