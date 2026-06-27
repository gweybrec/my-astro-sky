<template>
  <div
    v-if="uiStore.skyTooltipHtml"
    id="tooltip"
    :style="{ display: 'block', left: (uiStore.skyTooltipX + SKY_TOOLTIP_OFFSET) + 'px', top: (uiStore.skyTooltipY + SKY_TOOLTIP_OFFSET) + 'px' }"
    @mousedown="onSelectStart"
  >
    <div v-html="uiStore.skyTooltipHtml"></div>
    <DSOActions v-if="uiStore.skyTooltipDSO" :dso="uiStore.skyTooltipDSO" pins-tooltip @edit="onEdit" />
  </div>
</template>

<script setup lang="ts">
import { useUiStore, SKY_TOOLTIP_OFFSET } from '../../stores/ui';
import { useCanvasStore } from '../../stores/canvas';
import { openDSOEditModal } from '../../dso-editor';
import DSOActions from '../panels/DSOActions.vue';

const uiStore = useUiStore();
const canvasStore = useCanvasStore();

// A text-selection drag that starts in the tooltip must stay contained to it. While
// it's active we (1) keep the tooltip mounted so the node isn't removed mid-drag, and
// (2) add `tooltip-selecting` to <body> so everything outside the tooltip becomes
// non-selectable — dragging the cursor out no longer highlights the whole page.
function onSelectStart() {
  uiStore.setSkyTooltipSelecting(true);
  document.body.classList.add('tooltip-selecting');
  window.addEventListener('mouseup', endSelect, { once: true });
}

function endSelect() {
  uiStore.setSkyTooltipSelecting(false);
  document.body.classList.remove('tooltip-selecting');
}

function onEdit() {
  const dso = uiStore.skyTooltipDSO;
  if (!dso) return;
  uiStore.hideSkyTooltipNow();
  openDSOEditModal(dso, () => { canvasStore.skyMap?.render(); });
}
</script>
