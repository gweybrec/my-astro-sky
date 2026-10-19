<script setup lang="ts">
import { ref } from 'vue';

// A colour shown as a swatch (`.mob-swatch-btn`) that opens the phone's own colour picker: the desktop's colour input
// (the types of points of interest, board "Types de points d'intérêt"). The input takes no room, as the date pickers'.
defineProps<{ label: string }>();
const color = defineModel<string>({ required: true });
const input = ref<HTMLInputElement | null>(null);

function open() {
  const el = input.value;
  if (!el) return;
  try {
    el.showPicker();
  } catch {
    el.click();
  }
}
</script>

<template>
  <button type="button" class="mob-swatch-btn" :aria-label="label" @click="open">
    <span class="mob-swatch" :style="{ background: color }" />
  </button>
  <span class="mob-picker-inputs">
    <input
      ref="input"
      type="color"
      tabindex="-1"
      aria-hidden="true"
      :value="color"
      @input="color = ($event.target as HTMLInputElement).value"
    />
  </span>
</template>
