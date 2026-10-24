<script setup lang="ts">
import { inject, useId } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { useSheetDrag, useSheetExpand } from '../composables/useSheetDrag';
import { MAP_SHEET_HOST } from './map-sheet';

// A sheet of the map (`.mob-map-sheet`: the object, photo and frame sheets): drawn in the page over the bottom of the
// map, not in an overlay, so the map stays in view and can be touched. Its slide up and down comes from the
// PhoneMapSheetHost it must sit in (outside one it is not drawn: an error in development and in the tests). It closes by
// dragging it down from its handle or header and with its handle (`close`); the page closes it for a tap on an empty
// spot of the map and for the back button. Its rows have no dividers (the boards of the map's sheets). Its content scrolls
// under the handle and the title when the sheet reaches its height (a third of the map in portrait); a drag up from the
// handle or header takes it to two thirds, and a drag down from there back to a third.
defineProps<{
  title: string;
  /** Only the handle and the title are shown (a frame being dragged: board "Ciel, déplacer le cadre"). */
  collapsed?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
if (!inject(MAP_SHEET_HOST, false)) {
  throw new Error(
    'PhoneMapSheet is drawn outside a PhoneMapSheetHost: it would neither slide in nor out.',
  );
}
const titleId = useId();
const { expanded, grow } = useSheetExpand();
const drag = useSheetDrag(() => {
  if (expanded.value) expanded.value = false;
  else emit('close');
}, grow);
function tapHandle() {
  if (!drag.wasDragged()) emit('close');
}
</script>

<template>
  <section
    class="mob-sheet mob-sheet--auto mob-map-sheet"
    :class="{ 'mob-sheet--expanded': expanded }"
    :aria-labelledby="titleId"
  >
    <div class="mob-sheet-drag" v-on="drag.handlers">
      <button
        type="button"
        class="mob-sheet-grab"
        :aria-label="t('mobile.sky.closeSheet')"
        @click="tapHandle"
      >
        <span class="mob-sheet-handle" />
      </button>
      <div class="mob-sheet-header">
        <h2 :id="titleId" class="mob-sheet-title m-title">{{ title }}</h2>
        <!-- The line under the title (`.mob-meta`). -->
        <slot name="meta" />
      </div>
    </div>
    <div v-show="!collapsed" class="mob-sheet-body mob-scroll">
      <slot />
    </div>
  </section>
</template>
