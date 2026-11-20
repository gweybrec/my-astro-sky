<script setup lang="ts">
import { IonBadge } from '@ionic/vue';

// The object type badge and the constellation badge of a target (`.mob-badge--type`, `.mob-badge--const`), a badge in
// the warning colour (`.mob-badge--warn`: a plan whose night has passed) and one in the success colour
// (`.mob-badge--success`: an object of a catalogue already photographed).
defineProps<{ kind: 'type' | 'const' | 'warn' | 'success' }>();
</script>

<template>
  <IonBadge
    class="mob-badge m-caption"
    :class="{
      'mob-badge--type': kind === 'type',
      'mob-badge--const': kind === 'const',
      'mob-badge--warn': kind === 'warn',
      'mob-badge--success': kind === 'success',
    }"
    ><slot
  /></IonBadge>
</template>
