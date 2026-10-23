<script setup lang="ts">
import { IonButton } from '@ionic/vue';
import { useLongPressLabel } from '../composables/useLongPressLabel';

// The design system's icon-only button (`.mob-icon-btn`, 48 x 48) on Ionic's button. It has no printed label: the
// name (`label`) is the accessible name and shows beside the button on a long press.
// The root is the button and the long-press label beside it: the attributes (a class) belong to the button.
defineOptions({ inheritAttrs: false });
const props = defineProps<{
  label: string;
  /** A toggle that is on (the selected fill). */
  pressed?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Waits for a screen that is not built yet: drawn as the board draws it, without a tap. */
  waiting?: boolean;
  /** The round button that floats over the map (`.mob-icon-btn--float`). */
  float?: boolean;
  /** The button opens a popup that is open now (`aria-expanded`). */
  expanded?: boolean;
  /** Why the button cannot be used now: it is drawn disabled, takes no tap, and its long press names it and says why. */
  unavailable?: string;
}>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();

const { style, start, end, consumeTap } = useLongPressLabel();

function onClick(event: MouseEvent) {
  if (consumeTap() || props.unavailable) return;
  emit('click', event);
}
</script>

<template>
  <IonButton
    v-bind="$attrs"
    fill="clear"
    class="mob-icon-btn"
    :class="{
      'mob-icon-btn--pressed': pressed,
      'mob-icon-btn--danger': danger,
      'mob-icon-btn--float': float,
      'mob-icon-btn--unavailable': unavailable,
      'mob-waiting': waiting,
      'mob-icon-btn--held': style !== null,
    }"
    :aria-label="label"
    :aria-pressed="pressed === undefined ? undefined : String(pressed)"
    :aria-expanded="expanded === undefined ? undefined : String(expanded)"
    :disabled="disabled"
    :aria-disabled="waiting || unavailable ? 'true' : undefined"
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
      <span v-if="unavailable" class="mob-longpress-reason m-secondary">{{ unavailable }}</span>
    </div>
  </Teleport>
</template>
