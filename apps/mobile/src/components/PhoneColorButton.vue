<script setup lang="ts">
import { ref } from 'vue';
import AppIcon from './AppIcon.vue';
import PhoneButton from './PhoneButton.vue';
import caretIcon from '../icons/chevron-down.svg?raw';

// A colour that opens the phone's own colour picker: the desktop's colour input. Two looks: a swatch alone
// (`.mob-swatch-btn`, the types of points of interest, board "Types de points d'intérêt"), or, with `field`, a field
// button whose name is `field` and whose value is the swatch (board "Dessiner une région"). The input takes no room, as
// the date pickers'.
defineProps<{ label: string; field?: string }>();
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
  <PhoneButton
    v-if="field"
    variant="field"
    text-style="body"
    block
    :aria-label="label"
    @click="open"
  >
    <span class="mob-btn-key">{{ field }}</span>
    <span class="mob-btn-value mob-btn-value--swatch"
      ><span class="mob-swatch" :style="{ background: color }"
    /></span>
    <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
  </PhoneButton>
  <button v-else type="button" class="mob-swatch-btn" :aria-label="label" @click="open">
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
