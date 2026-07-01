<template>
  <button
    type="button"
    :title="title"
    :aria-label="title"
    @click="onClick"
    v-html="visible ? eyeSvg : eyeOffSvg"
  ></button>
</template>

<script setup lang="ts">
import eyeSvg from '../../icons/eye.svg?raw';
import eyeOffSvg from '../../icons/eye-off.svg?raw';

const props = withDefaults(defineProps<{
  visible: boolean;
  title: string;
  // Most callers nest this inside a larger clickable row and need to stop the
  // click from also triggering the row (see PhotoItem.vue). Overlay buttons
  // (e.g. FOVRibbon) intentionally let the click bubble to document, which
  // other open popups rely on to close themselves (see DropdownPanel.vue).
  stopPropagation?: boolean;
}>(), { stopPropagation: false });

const emit = defineEmits<{ toggle: [] }>();

function onClick(e: MouseEvent) {
  if (props.stopPropagation) e.stopPropagation();
  emit('toggle');
}
</script>
