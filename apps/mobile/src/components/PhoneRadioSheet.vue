<script setup lang="ts" generic="V extends string">
import PhoneSheet from './PhoneSheet.vue';
import PhoneRadioGroup from './PhoneRadioGroup.vue';

// A choice of one value among a list, in a sheet: one row per value with a radio mark at its end. A tap on a row applies
// its value and closes the sheet, the current value's row too (it changes nothing, so the group reports no change).
// The sheet is as tall as its rows, up to the whole screen, so that as many choices as possible show at once.
defineProps<{ title: string; options: readonly { value: V; label: string }[] }>();
const open = defineModel<boolean>('open', { required: true });
const value = defineModel<V | undefined>('value', { required: true });
</script>

<template>
  <PhoneSheet v-model:open="open" :title="title" full>
    <PhoneRadioGroup v-model="value" :options="options" :label="title" @pick="open = false" />
  </PhoneSheet>
</template>
