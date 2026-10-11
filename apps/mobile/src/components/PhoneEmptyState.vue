<script setup lang="ts">
import PhoneButton from './PhoneButton.vue';
import AppIcon from './AppIcon.vue';

// A screen with nothing to show: one line of text and the one button that adds what is missing.
defineProps<{ text: string; buttonLabel: string; buttonIcon?: string; disabled?: boolean }>();
const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <div class="mob-empty">
    <p class="mob-empty-text m-body">{{ text }}</p>
    <PhoneButton variant="action" size="lg" :disabled="disabled" @click="emit('action')">
      <AppIcon v-if="buttonIcon" :svg="buttonIcon" />{{ buttonLabel }}
    </PhoneButton>
  </div>
</template>
