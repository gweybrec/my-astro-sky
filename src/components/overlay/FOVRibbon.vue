<template>
  <div :class="['fov-ribbon', { 'fov-ribbon--collapsed': !ribbonOpen }]">
    <!-- Telescope button (FOV popup trigger) -->
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

    <!-- Rotation step buttons -->
    <button
      v-for="step in ROTATION_STEPS"
      :key="step.deg"
      type="button"
      class="sky-rotation-btn fov-rotate-btn"
      :title="step.deg === 0 ? t('display.rotateReset') : `${t('fovOverlay.rotateFrame')} ${step.label}`"
      :aria-label="step.deg === 0 ? t('display.rotateReset') : `${t('fovOverlay.rotateFrame')} ${step.label}`"
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
import { ref, onMounted, onUnmounted } from 'vue';
import { t } from '../../i18n';
import { useCanvasStore } from '../../stores/canvas';
import { loadFovUiState, saveFovUiState, buildFovFrameSpecs, buildFovPopup } from '../../fov-overlay';
import { getGearSetups } from '../../api';
import { positionPopup } from '../../ui';
import { useUiStore } from '../../stores/ui';
import telescopeSvg from '../../icons/telescope.svg?raw';
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
const uiStore = useUiStore();

const fovUiState = loadFovUiState();
const ribbonOpen = ref(fovUiState.ribbonOpen);

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

function applyRotation(stepDeg: number) {
  let n = stepDeg === 0 ? 0 : fovUiState.frameRotationDeg + stepDeg;
  n = n % 360;
  if (n > 180) n -= 360;
  if (n < -180) n += 360;
  fovUiState.frameRotationDeg = n;
  saveFovUiState(fovUiState);
  canvasStore.skyMap?.setFovRotationDeg(n);
}

function closeFovPopup() {
  fovPopupEl?.remove();
  fovPopupEl = null;
}

function togglePopup(e: MouseEvent) {
  if (fovPopupEl) { closeFovPopup(); return; }
  const refreshFrames = (setups: Parameters<typeof buildFovFrameSpecs>[0]) => {
    buildFovFrameSpecs(setups).then(specs => canvasStore.skyMap?.setFovFrames(specs));
  };
  fovPopupEl = buildFovPopup(canvasStore.skyMap!, refreshFrames, closeFovPopup, () => {
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

function onDocClick(e: MouseEvent) {
  if (fovPopupEl && !fovPopupEl.contains(e.target as Node) && e.target !== telescopeBtnEl) {
    closeFovPopup();
  }
}

function suppress(v: boolean) {
  uiStore.setForceSuppressTooltip(v);
}

onMounted(() => {
  telescopeBtnEl = document.querySelector('.fov-telescope-btn');
  document.addEventListener('click', onDocClick);
  // Initial frame setup
  canvasStore.skyMap?.setFovRotationDeg(fovUiState.frameRotationDeg);
  const override = canvasStore.pendingFovOverride;
  if (override) {
    canvasStore.pendingFovOverride = null;
    canvasStore.skyMap?.setFovFrames(override);
  } else {
    getGearSetups().then(setups => buildFovFrameSpecs(setups)).then(specs => canvasStore.skyMap?.setFovFrames(specs));
  }
});

onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  closeFovPopup();
});
</script>
