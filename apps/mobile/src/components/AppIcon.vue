<script setup lang="ts">
// An SVG file of the icon set, inlined so that `currentColor` takes the colour of the button that holds it
// (an <img> would draw it black). The same markup the boards use: aria-hidden, no focus. `cls` adds the design
// system's icon classes (`mob-icon--sm`, `mob-icon--dir`) the boards put on the svg.
const props = defineProps<{ svg: string; cls?: string }>();
const markup = props.svg.replace(
  '<svg ',
  `<svg aria-hidden="true" focusable="false"${props.cls ? ` class="${props.cls}"` : ''} `,
);
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- the markup is one of our own SVG files, never user text -->
  <span class="mob-icon-holder" v-html="markup" />
</template>

<style>
.mob-icon-holder {
  display: contents;
}
</style>
