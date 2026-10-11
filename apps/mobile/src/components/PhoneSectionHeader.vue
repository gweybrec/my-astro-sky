<script setup lang="ts">
import { IonListHeader } from '@ionic/vue';

// A section title (`.mob-section-header`) on Ionic's list header; with the `trail` slot the title is followed, at the
// right end, by a 48 px button (the "i" that opens the explanation).
defineProps<{ bar?: boolean }>();
</script>

<template>
  <IonListHeader class="mob-section-header m-secondary" :class="{ 'mob-section-header--bar': bar }">
    <div v-if="bar" class="mob-section-header-line">
      <span><slot /></span>
      <slot name="trail" />
    </div>
    <slot v-else />
  </IonListHeader>
</template>
