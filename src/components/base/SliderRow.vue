<template>
  <div class="display-controls-mag-row" :style="wrapperStyle">
    <label class="display-controls-mag-label">{{ label }} </label>
    <input
      type="range"
      class="display-controls-mag-slider"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :disabled="disabled"
      @input="onInput"
    />
    <span class="display-controls-mag-value">{{ displayValue }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    label: string;
    min: number;
    max: number;
    step: number;
    modelValue: number;
    formatValue?: (v: number) => string;
    disabled?: boolean;
  }>(),
  {
    disabled: false,
  },
);

const emit = defineEmits<{ 'update:modelValue': [value: number] }>();

const displayValue = computed(() =>
  props.formatValue ? props.formatValue(props.modelValue) : props.modelValue.toFixed(2),
);

const wrapperStyle = computed(() => (props.disabled ? { opacity: '0.4' } : {}));

function onInput(e: Event) {
  emit('update:modelValue', parseFloat((e.target as HTMLInputElement).value));
}
</script>
