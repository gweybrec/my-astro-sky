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
  </div>
</template>

<script setup lang="ts">
import { t } from '../../i18n';
import { useUiStore } from '../../stores/ui';
import { useFovFramesStore } from '../../stores/fov-frames';
import { useCanvasStore } from '../../stores/canvas';
import { openFramePicker } from '../../fov-overlay';
import addFrameSvg from '../../icons/add-frame.svg?raw';
import addMosaicSvg from '../../icons/add-mosaic.svg?raw';

// A star is added as a custom-location frame (dsoId null) at its coords — anchoring
// stays DSO-only, and the frame then displays as the nearest named star (i.e. itself).
// `pinsTooltip` is set when these actions live inside the floating sky tooltip.
const props = defineProps<{
  star: { hip: number; ra: number; dec: number };
  pinsTooltip?: boolean;
}>();

const uiStore = useUiStore();
const fovStore = useFovFramesStore();
const canvasStore = useCanvasStore();

function revealOnMap() {
  if (props.pinsTooltip) uiStore.hideSkyTooltipNow();
  fovStore.setFramesVisible(true);
  uiStore.switchView('skymap');
  const sm = canvasStore.skyMap;
  if (sm) sm.navigateTo(props.star.ra, props.star.dec, Math.max(sm.getView().scale, 1200));
  fovStore.requestPopupOpen();
}

function target() {
  return { id: `star:${props.star.hip}`, ra: props.star.ra, dec: props.star.dec };
}

function onAddFrame() {
  openFramePicker(
    'frame',
    target(),
    (setupId) => {
      fovStore.addAdhocFrameAtSky(setupId, props.star.ra, props.star.dec, null);
      revealOnMap();
    },
    revealOnMap,
    true,
  );
}

function onAddMosaic() {
  openFramePicker(
    'mosaic',
    target(),
    (setupId) => {
      fovStore.addAdhocMosaic(setupId, props.star.ra, props.star.dec, null);
      revealOnMap();
    },
    revealOnMap,
    true,
  );
}
</script>
