<script setup lang="ts">
import { IonChip } from '@ionic/vue';

// A filter chip (`.mob-chip`, 48 px tall) on Ionic's chip; `pressed` is the selected state. Chips wrap, they never
// scroll sideways. `compact` is the 32 px chip with smaller text (a photo's objects on the map).
defineProps<{ pressed?: boolean; compact?: boolean }>();
const emit = defineEmits<{ click: [event: Event] }>();
</script>

<template>
  <IonChip
    class="mob-chip"
    :class="compact ? 'mob-chip--compact m-secondary' : 'm-body'"
    role="button"
    tabindex="0"
    :aria-pressed="pressed === undefined ? undefined : String(pressed)"
    @click="emit('click', $event)"
    @keydown.enter.prevent="emit('click', $event)"
  >
    <slot />
  </IonChip>
</template>
