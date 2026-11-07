<script setup lang="ts">
import { IonChip } from '@ionic/vue';

// A filter chip (`.mob-chip`, 48 px tall) on Ionic's chip; `pressed` is the selected state. Chips wrap, they never
// scroll sideways. `compact` is the 32 px chip with smaller text (a photo's objects on the map). `still` is a chip that
// only shows something: not a button, not focusable, no press, and a touch passes through to what is under it (a pager
// it is swiped in).
const props = defineProps<{ pressed?: boolean; compact?: boolean; still?: boolean }>();
const emit = defineEmits<{ click: [event: Event] }>();
</script>

<template>
  <IonChip
    class="mob-chip"
    :class="[compact ? 'mob-chip--compact m-secondary' : 'm-body', { 'mob-chip--still': still }]"
    :role="still ? undefined : 'button'"
    :tabindex="still ? undefined : 0"
    :aria-pressed="pressed === undefined || still ? undefined : String(pressed)"
    @click="!props.still && emit('click', $event)"
    @keydown.enter.prevent="!props.still && emit('click', $event)"
  >
    <slot />
  </IonChip>
</template>
