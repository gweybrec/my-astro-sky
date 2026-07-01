<template>
  <div class="fov-ribbon">
    <!-- Telescope button (frame manager popup trigger) -->
    <button
      type="button"
      class="sky-rotation-btn fov-telescope-btn"
      :title="t('fovOverlay.btnTitle')"
      :aria-label="t('fovOverlay.btnTitle')"
      @click.stop="togglePopup"
      @mouseenter="suppress(true)" @mouseleave="suppress(false)"
      @focus="suppress(true)" @blur="suppress(false)"
      v-html="telescopeSvg"
    ></button>

    <!-- Master show/hide-frames toggle (hides all frames regardless of mode) -->
    <EyeToggleButton
      class="sky-rotation-btn fov-visibility-btn"
      :visible="fovStore.framesVisible"
      :title="fovStore.framesVisible ? t('fovOverlay.hideFrames') : t('fovOverlay.showFrames')"
      @toggle="toggleFramesVisibility"
      @mouseenter="suppress(true)" @mouseleave="suppress(false)"
      @focus="suppress(true)" @blur="suppress(false)"
    />
  </div>
</template>

<script setup lang="ts">
import { watch, onMounted, onUnmounted } from 'vue';
import { t } from '../../i18n';
import { useCanvasStore } from '../../stores/canvas';
import { useFovFramesStore } from '../../stores/fov-frames';
import { usePlansStore } from '../../stores/plans';
import { buildFovPopup } from '../../fov-overlay';
import { positionPopup } from '../../ui';
import { useUiStore } from '../../stores/ui';
import EyeToggleButton from '../base/EyeToggleButton.vue';
import telescopeSvg from '../../icons/telescope.svg?raw';

const canvasStore = useCanvasStore();
const fovStore = useFovFramesStore();
const plansStore = usePlansStore();
const uiStore = useUiStore();

let telescopeBtnEl: HTMLElement | null = null;
let fovPopupEl: HTMLElement | null = null;

function toggleFramesVisibility() {
  // When hiding, lock any floating (screen-anchored) frames to the sky first so
  // panning/zooming the bare sky can't drift them — nothing moves while hidden.
  if (fovStore.framesVisible) canvasStore.skyMap?.pinAllFloatingFrames();
  fovStore.toggleFramesVisible();
  // The frame manager is only useful alongside visible frames: open it when
  // showing frames, close it when hiding them.
  if (fovStore.framesVisible) openFovPopup();
  else closeFovPopup();
}

function closeFovPopup() {
  (fovPopupEl as (HTMLElement & { __cleanup?: () => void }) | null)?.__cleanup?.();
  fovPopupEl?.remove();
  fovPopupEl = null;
}

function openFovPopup() {
  if (fovPopupEl) return;
  fovPopupEl = buildFovPopup(closeFovPopup, () => {
    if (fovPopupEl && telescopeBtnEl) {
      positionPopup(fovPopupEl, telescopeBtnEl.getBoundingClientRect());
    }
  });
}

function togglePopup() {
  if (fovPopupEl) { closeFovPopup(); return; }
  openFovPopup();
}

function suppress(v: boolean) {
  uiStore.setForceSuppressTooltip(v);
}

onMounted(() => {
  telescopeBtnEl = document.querySelector('.fov-telescope-btn');
  // The frame manager stays open while you select / pin / rotate frames on the
  // map — it only closes via its × button or the telescope toggle (no
  // click-outside-to-close, which would dismiss it on every map interaction).

  const sm = canvasStore.skyMap;

  // Legacy one-shot centred preview (e.g. a target opened with a specific setup).
  const override = canvasStore.pendingFovOverride;
  if (override) {
    canvasStore.pendingFovOverride = null;
    sm?.setFovFrames(override);
  }

  // Interactive frame system: wire canvas interactions to the store and push
  // the resolved frames to the map whenever plans / ad-hoc frames change.
  if (sm) {
    sm.setOnFovInstanceSelect(id => fovStore.setActive(id));
    sm.setOnFovInstanceChange((id, change) => fovStore.applyChange(id, change));
    sm.setOnFovFrameResize((id, region) => fovStore.applyResize(id, region));
    sm.setOnMosaicTileRemove(tileId => fovStore.removeMosaicTile(tileId));
    sm.setOnMosaicTileAdd((ra, dec) => fovStore.addMosaicTile(ra, dec));
    sm.setOnFrameMerge((movedId, targetId) => fovStore.mergeOnDrop(movedId, targetId));
  }
  plansStore.ensureLoaded();
  fovStore.loadSpecs();
  // Refresh gear specs when a plan's setup changes (a new setup may need sizing).
  watch(() => plansStore.plans.map(p => p.setupId).join(','), () => fovStore.loadSpecs());
  // Push the resolved frames to the map, gated by the master visibility toggle:
  // when frames are hidden we push an empty set (selection/renderables are kept
  // intact so the popup list stays editable and toggling back restores them).
  watch(
    [() => fovStore.renderables, () => fovStore.framesVisible],
    () => sm?.setFovInstances(fovStore.framesVisible ? fovStore.renderables : []),
    { deep: true, immediate: true },
  );
  // Push the selected mosaic's add-tile ("+") candidate positions to the map.
  watch(
    () => fovStore.activeMosaicAddCandidates,
    () => sm?.setMosaicAddCandidates(fovStore.framesVisible ? fovStore.activeMosaicAddCandidates : []),
    { deep: true, immediate: true },
  );
  // Open the frame manager on request (e.g. jumping here from a plan's details).
  // The ribbon is only mounted while the sky map is shown, so the request can
  // arrive while it's unmounted (set just after switchView('skymap')): consume
  // the pending flag on mount, and keep a watcher for the already-mounted case.
  const consumePopupOpen = () => {
    if (!fovStore.pendingPopupOpen) return;
    fovStore.pendingPopupOpen = false;
    fovStore.setFramesVisible(true);
    openFovPopup();
  };
  watch(() => fovStore.pendingPopupOpen, () => consumePopupOpen());
  consumePopupOpen();
});

onUnmounted(() => {
  closeFovPopup();
});
</script>
