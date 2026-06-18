<template>
  <div :class="['fov-ribbon', { 'fov-ribbon--collapsed': !ribbonOpen }]">
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
    <button
      type="button"
      class="sky-rotation-btn fov-visibility-btn"
      :title="fovStore.framesVisible ? t('fovOverlay.hideFrames') : t('fovOverlay.showFrames')"
      :aria-label="fovStore.framesVisible ? t('fovOverlay.hideFrames') : t('fovOverlay.showFrames')"
      @click="toggleFramesVisibility"
      @mouseenter="suppress(true)" @mouseleave="suppress(false)"
      @focus="suppress(true)" @blur="suppress(false)"
      v-html="fovStore.framesVisible ? eyeSvg : eyeOffSvg"
    ></button>

    <!-- Rotation step buttons (act on the active frame) -->
    <button
      v-for="step in ROTATION_STEPS"
      :key="step.deg"
      type="button"
      class="sky-rotation-btn fov-rotate-btn"
      :class="{ 'opacity-40 pointer-events-none': !hasActive || !fovStore.framesVisible }"
      :title="step.deg === 0 ? t('fovOverlay.resetFrameRotation') : `${t('fovOverlay.rotateFrame')} ${step.label}`"
      :aria-label="step.deg === 0 ? t('fovOverlay.resetFrameRotation') : `${t('fovOverlay.rotateFrame')} ${step.label}`"
      @click="applyRotation(step.deg)"
      @mouseenter="suppress(true)" @mouseleave="suppress(false)"
      @focus="suppress(true)" @blur="suppress(false)"
      v-html="step.svg"
    ></button>

    <!-- Toggle collapse/expand -->
    <button
      type="button"
      class="fov-ribbon-toggle"
      :title="ribbonOpen ? t('fovOverlay.collapseRibbon') : t('fovOverlay.expandRibbon')"
      :aria-label="ribbonOpen ? t('fovOverlay.collapseRibbon') : t('fovOverlay.expandRibbon')"
      @click="toggleRibbon"
      @mouseenter="suppress(true)" @mouseleave="suppress(false)"
      @focus="suppress(true)" @blur="suppress(false)"
    >{{ ribbonOpen ? '◀' : '▶' }}</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { t } from '../../i18n';
import { useCanvasStore } from '../../stores/canvas';
import { useFovFramesStore } from '../../stores/fov-frames';
import { usePlansStore } from '../../stores/plans';
import { loadFovUiState, saveFovUiState, buildFovPopup } from '../../fov-overlay';
import { positionPopup } from '../../ui';
import { useUiStore } from '../../stores/ui';
import telescopeSvg from '../../icons/telescope.svg?raw';
import eyeSvg from '../../icons/eye.svg?raw';
import eyeOffSvg from '../../icons/eye-off.svg?raw';
import rotateResetSvg from '../../icons/rotate-reset.svg?raw';
import rotateM45Svg from '../../icons/rotate-m45.svg?raw';
import rotateM15Svg from '../../icons/rotate-m15.svg?raw';
import rotateM5Svg from '../../icons/rotate-m5.svg?raw';
import rotateM1Svg from '../../icons/rotate-m1.svg?raw';
import rotateP1Svg from '../../icons/rotate-p1.svg?raw';
import rotateP5Svg from '../../icons/rotate-p5.svg?raw';
import rotateP15Svg from '../../icons/rotate-p15.svg?raw';
import rotateP45Svg from '../../icons/rotate-p45.svg?raw';

const canvasStore = useCanvasStore();
const fovStore = useFovFramesStore();
const plansStore = usePlansStore();
const uiStore = useUiStore();

const fovUiState = loadFovUiState();
const ribbonOpen = ref(fovUiState.ribbonOpen);
const hasActive = computed(() => !!fovStore.activeId);

const ROTATION_STEPS = [
  { deg: -45, label: '-45°', svg: rotateM45Svg },
  { deg: -15, label: '-15°', svg: rotateM15Svg },
  { deg:  -5, label:  '-5°', svg: rotateM5Svg  },
  { deg:  -1, label:  '-1°', svg: rotateM1Svg  },
  { deg:   0, label:   '0°', svg: rotateResetSvg },
  { deg:   1, label:  '+1°', svg: rotateP1Svg  },
  { deg:   5, label:  '+5°', svg: rotateP5Svg  },
  { deg:  15, label: '+15°', svg: rotateP15Svg },
  { deg:  45, label: '+45°', svg: rotateP45Svg },
];

let telescopeBtnEl: HTMLElement | null = null;
let fovPopupEl: HTMLElement | null = null;

function toggleFramesVisibility() {
  // When hiding, lock any floating (screen-anchored) frames to the sky first so
  // panning/zooming the bare sky can't drift them — nothing moves while hidden.
  if (fovStore.framesVisible) canvasStore.skyMap?.pinAllFloatingFrames();
  fovStore.toggleFramesVisible();
}

function applyRotation(stepDeg: number) {
  const id = fovStore.activeId;
  if (!id) return;
  if (stepDeg === 0) fovStore.resetRotation(id);
  else fovStore.nudgeRotation(id, stepDeg);
}

function closeFovPopup() {
  (fovPopupEl as (HTMLElement & { __cleanup?: () => void }) | null)?.__cleanup?.();
  fovPopupEl?.remove();
  fovPopupEl = null;
}

function togglePopup() {
  if (fovPopupEl) { closeFovPopup(); return; }
  fovPopupEl = buildFovPopup(closeFovPopup, () => {
    if (fovPopupEl && telescopeBtnEl) {
      positionPopup(fovPopupEl, telescopeBtnEl.getBoundingClientRect());
    }
  });
}

function toggleRibbon() {
  ribbonOpen.value = !ribbonOpen.value;
  fovUiState.ribbonOpen = ribbonOpen.value;
  saveFovUiState(fovUiState);
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
});

onUnmounted(() => {
  closeFovPopup();
});
</script>
