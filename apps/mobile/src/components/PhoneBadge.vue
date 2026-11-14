<script setup lang="ts">
import { IonBadge } from '@ionic/vue';

// The object type badge and the constellation badge of a target (`.mob-badge--type`, `.mob-badge--const`), and a
// badge in the warning colour (`.mob-badge--warn`: a plan whose night has passed).
defineProps<{ kind: 'type' | 'const' | 'warn' }>();
</script>

<template>
  <IonBadge class="mob-badge m-caption" :class="`mob-badge--${kind}`"><slot /></IonBadge>
</template>
