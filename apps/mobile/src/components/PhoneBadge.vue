<script setup lang="ts">
import { IonBadge } from '@ionic/vue';

// The object type badge and the constellation badge of a target (`.mob-badge--type`, `.mob-badge--const`).
defineProps<{ kind: 'type' | 'const' }>();
</script>

<template>
  <IonBadge class="mob-badge m-caption" :class="`mob-badge--${kind}`"><slot /></IonBadge>
</template>
