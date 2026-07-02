<template>
  <div
    v-if="uiStore.skyTooltipHtml"
    id="tooltip"
    :style="{ display: 'block', left: (uiStore.skyTooltipX + SKY_TOOLTIP_OFFSET) + 'px', top: (uiStore.skyTooltipY + SKY_TOOLTIP_OFFSET) + 'px' }"
    @mousedown="onSelectStart"
    @wheel="onWheel"
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

// Wheel over the tooltip should zoom the map, not sit dead on the overlay. Forward
// the gesture to the canvas, whose handler dismisses the tooltip and anchors the
// zoom to the cursor (clientX/clientY), so it behaves as if the tooltip weren't there.
function onWheel(e: WheelEvent) {
  const canvas = canvasStore.skyMap?.getCanvas();
  if (!canvas) return;
  e.preventDefault();
  canvas.dispatchEvent(new WheelEvent('wheel', {
    deltaX: e.deltaX,
    deltaY: e.deltaY,
    deltaMode: e.deltaMode,
    clientX: e.clientX,
    clientY: e.clientY,
    bubbles: false,
    cancelable: true,
  }));
}

function onEdit() {
  const dso = uiStore.skyTooltipDSO;
  if (!dso) return;
  uiStore.hideSkyTooltipNow();
  openDSOEditModal(dso, () => { canvasStore.skyMap?.render(); });
}
</script>
