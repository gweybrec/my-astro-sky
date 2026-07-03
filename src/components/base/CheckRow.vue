<template>
  <label class="dso-toggle-label" :style="disabled ? { opacity: '0.4' } : {}">
    <input type="checkbox" :checked="modelValue" :disabled="disabled" @change="onChange" />
    {{ ' ' + label }}
  </label>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label: string;
    modelValue: boolean;
    disabled?: boolean;
  }>(),
  {
    disabled: false,
  },
);

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

function onChange(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).checked);
}
</script>
