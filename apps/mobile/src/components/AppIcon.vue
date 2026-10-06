<script setup lang="ts">
// An SVG file of the icon set, inlined so that `currentColor` takes the colour of the button that holds it
// (an <img> would draw it black). The same markup the boards use: aria-hidden, no focus.
const props = defineProps<{ svg: string }>();
const markup = props.svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
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
