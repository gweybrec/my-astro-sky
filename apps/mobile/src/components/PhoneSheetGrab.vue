<script setup lang="ts">
// The handle at the top of a sheet or a panel (`.mob-sheet-grab`): a tap target as wide as the sheet with the short bar
// in its middle. The sheet decides what a tap does (close it, fold it) and passes its drag handlers on.
defineProps<{ label: string }>();
const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <button type="button" class="mob-sheet-grab" :aria-label="label" @click="emit('click')">
    <span class="mob-sheet-handle" />
  </button>
</template>
