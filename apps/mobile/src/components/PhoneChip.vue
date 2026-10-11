<script setup lang="ts">
import { IonChip } from '@ionic/vue';

// A filter chip (`.mob-chip`, 48 px tall) on Ionic's chip; `pressed` is the selected state. Chips wrap, they never
// scroll sideways.
defineProps<{ pressed?: boolean }>();
const emit = defineEmits<{ click: [event: Event] }>();
</script>

<template>
  <IonChip
    class="mob-chip m-body"
    role="button"
    tabindex="0"
    :aria-pressed="pressed === undefined ? undefined : String(pressed)"
    @click="emit('click', $event)"
    @keydown.enter.prevent="emit('click', $event)"
  >
    <slot />
  </IonChip>
</template>
