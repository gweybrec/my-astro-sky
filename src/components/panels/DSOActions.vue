<template>
  <div class="flex gap-2 mt-4">
    <button
      class="btn-icon flex-1 flex items-center justify-center"
      :title="t('fovOverlay.addFrame')"
      :aria-label="t('fovOverlay.addFrame')"
      @click.stop="onAddFrame"
      v-html="addFrameSvg"
    ></button>
    <button
      class="btn-icon flex-1 flex items-center justify-center"
      :title="t('fovOverlay.addMosaic')"
      :aria-label="t('fovOverlay.addMosaic')"
      @click.stop="onAddMosaic"
      v-html="addMosaicSvg"
    ></button>
    <button
      class="btn-icon flex-1 flex items-center justify-center"
      :title="t('dso.edit')"
      :aria-label="t('dso.edit')"
      @click.stop="$emit('edit')"
      v-html="penSvg"
    ></button>
  </div>
</template>

<script setup lang="ts">
import { t } from '../../i18n';
import type { DSO } from '../../types';
import { useUiStore } from '../../stores/ui';
import { useFovFramesStore } from '../../stores/fov-frames';
import { useCanvasStore } from '../../stores/canvas';
import { openFramePicker } from '../../fov-overlay';
import penSvg from '../../icons/pen.svg?raw';
import addFrameSvg from '../../icons/add-frame.svg?raw';
import addMosaicSvg from '../../icons/add-mosaic.svg?raw';

// `pinsTooltip` is set when these actions live inside the floating sky tooltip:
// `revealOnMap` hides it before switching to the sky map.
const props = defineProps<{ dso: DSO; pinsTooltip?: boolean }>();
defineEmits<{ edit: [] }>();

const uiStore = useUiStore();
const fovStore = useFovFramesStore();
const canvasStore = useCanvasStore();

// Switch to the sky map, reveal frames, centre on the DSO, and open the frame
// manager — the shared tail of "add frame"/"add mosaic" (mirrors the Targets
// "show on map" flow).
function revealOnMap() {
  if (props.pinsTooltip) uiStore.hideSkyTooltipNow();
  fovStore.setFramesVisible(true);
  uiStore.switchView('skymap');
  const sm = canvasStore.skyMap;
  if (sm) sm.navigateTo(props.dso.ra, props.dso.dec, Math.max(sm.getView().scale, 1200));
  fovStore.requestPopupOpen();
}

function onAddFrame() {
  openFramePicker('frame', props.dso, (setupId) => {
    fovStore.addAdhocFrameAtSky(setupId, props.dso.ra, props.dso.dec, props.dso.id);
    revealOnMap();
  }, revealOnMap);
}

function onAddMosaic() {
  openFramePicker('mosaic', props.dso, (setupId) => {
    fovStore.addAdhocMosaic(setupId, props.dso.ra, props.dso.dec, props.dso.id);
    revealOnMap();
  }, revealOnMap);
}
</script>
