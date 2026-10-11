<script setup lang="ts">
import { IonSpinner } from '@ionic/vue';

// A running operation ("Résolution…"): Ionic's spinner and the label. `page` is the large spinner of a screen that is
// loading; the default is the small one beside a row's or a tile's text.
defineProps<{ label?: string; page?: boolean }>();
</script>

<template>
  <span class="mob-busy" :class="{ 'mob-busy--page': page }" role="status">
    <IonSpinner name="crescent" class="mob-spinner" />
    <span v-if="label" class="mob-busy-label">{{ label }}</span>
  </span>
</template>
