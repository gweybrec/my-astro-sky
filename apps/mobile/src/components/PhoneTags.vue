<script setup lang="ts">
import { ref } from 'vue';
import { useTagRows } from '../composables/useTagRows';
import type { PhotoTag } from '../photo-tags';
import AppIcon from './AppIcon.vue';

// A photo's chips (`.mob-tags`, the desktop's tag colours), as the gallery card shows them: on two rows at most, the
// chips that do not fit counted in a last one ("+3"), a chip wider than its place cut with an ellipsis.
const props = defineProps<{ tags: PhotoTag[] }>();

const box = ref<HTMLElement | null>(null);
const { shown } = useTagRows(box, () => props.tags.length);
</script>

<template>
  <span ref="box" class="mob-tags">
    <span
      v-for="(tag, n) in tags.slice(0, shown)"
      :key="n"
      class="mob-tag m-caption"
      :class="[`mob-tag--${tag.kind}`, { 'mob-tag--dot': tag.kind === 'poi' && !tag.icon }]"
      :style="tag.color ? { '--poi-color': tag.color } : undefined"
      ><AppIcon v-if="tag.icon" :svg="tag.icon" /><span class="mob-tag-text">{{
        tag.text
      }}</span></span
    >
    <span v-if="shown < tags.length" class="mob-tag mob-tag--more m-caption"
      ><span class="mob-tag-text">+{{ tags.length - shown }}</span></span
    >
  </span>
</template>
