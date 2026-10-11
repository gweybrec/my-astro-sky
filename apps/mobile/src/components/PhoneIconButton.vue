<script setup lang="ts">
import { IonButton } from '@ionic/vue';
import { useLongPressLabel } from '../composables/useLongPressLabel';

// The design system's icon-only button (`.mob-icon-btn`, 48 x 48) on Ionic's button. It has no printed label: the
// name (`label`) is the accessible name and shows beside the button on a long press.
defineProps<{
  label: string;
  /** A toggle that is on (the selected fill). */
  pressed?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Waits for a screen that is not built yet: drawn as the board draws it, without a tap. */
  waiting?: boolean;
}>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();

const { style, start, end, consumeTap } = useLongPressLabel();

function onClick(event: MouseEvent) {
  if (consumeTap()) return;
  emit('click', event);
}
</script>

<template>
  <IonButton
    fill="clear"
    class="mob-icon-btn"
    :class="{
      'mob-icon-btn--danger': danger,
      'mob-waiting': waiting,
      'mob-icon-btn--held': style !== null,
    }"
    :aria-label="label"
    :aria-pressed="pressed === undefined ? undefined : String(pressed)"
    :disabled="disabled"
    :aria-disabled="waiting ? 'true' : undefined"
    @pointerdown="start"
    @pointerup="end"
    @pointercancel="end"
    @pointerleave="end"
    @contextmenu.prevent
    @click="onClick"
  >
    <slot />
  </IonButton>
  <Teleport to="body">
    <div v-if="style" class="mob-longpress-label m-body" role="tooltip" :style="style">
      {{ label }}
    </div>
  </Teleport>
</template>
