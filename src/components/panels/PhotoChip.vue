<template>
  <span
    :class="['tag-chip', 'photo-chip-action', isLabel ? 'label-chip' : '']"
    @click.stop="$emit('click')"
  >{{ text }}</span>
</template>

<script setup lang="ts">
defineProps<{ text: string; isLabel?: boolean }>();
defineEmits<{ click: [] }>();
</script>
