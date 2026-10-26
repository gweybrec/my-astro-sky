<script setup lang="ts">
import { provide, toRef } from 'vue';
import { MAP_SHEET_HOST, slideSheetOut } from './map-sheet';

// Where a page draws its map sheets (PhoneMapSheet): one sheet at a time (a `v-if` / `v-else-if` chain). A sheet is
// Ionic's sheet modal, which slides in by itself; Vue removes a sheet at once, so this holds it until Ionic has slid it
// out (the two cross when one replaces another). `shown` is whether the page is on screen: a sheet opens only then.
// A PhoneMapSheet refuses to be drawn anywhere else.
const props = defineProps<{ shown: boolean }>();
provide(MAP_SHEET_HOST, toRef(props, 'shown'));
</script>

<template>
  <Transition :css="false" @leave="slideSheetOut">
    <slot />
  </Transition>
</template>
