<script setup lang="ts">
import { provide } from 'vue';
import { MAP_SHEET_HOST, slideSheetIn, slideSheetOut } from './map-sheet';

// Where a page draws its map sheets (PhoneMapSheet): one sheet at a time (a `v-if` / `v-else-if` chain). A sheet slides
// up when it appears, down when it goes, and the two cross when one replaces another, at Ionic's sheet speed. Vue can
// only animate a removal from the parent's side, so this is the one place holding that transition; a PhoneMapSheet
// refuses to be drawn anywhere else. The slide is played in script, not by CSS classes: a sheet added while its page is
// still hidden (an object picked on the search page, while the map page comes back) waits until it is on screen.
provide(MAP_SHEET_HOST, true);
</script>

<template>
  <Transition :css="false" @enter="slideSheetIn" @leave="slideSheetOut">
    <slot />
  </Transition>
</template>
