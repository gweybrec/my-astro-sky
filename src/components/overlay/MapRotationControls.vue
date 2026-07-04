<template>
  <div class="sky-rotation-controls">
    <button
      type="button"
      class="sky-rotation-btn"
      :title="t('display.rotateLeft')"
      :aria-label="t('display.rotateLeft')"
      @click="rotate(-STEP)"
      @mouseenter="suppress(true)"
      @mouseleave="suppress(false)"
      @focus="suppress(true)"
      @blur="suppress(false)"
    >
      ↺
    </button>
    <button
      type="button"
      class="sky-rotation-btn sky-rotation-btn-reset"
      :title="t('display.rotateReset')"
      :aria-label="t('display.rotateReset')"
      @click="rotate(0)"
      @mouseenter="suppress(true)"
      @mouseleave="suppress(false)"
      @focus="suppress(true)"
      @blur="suppress(false)"
      v-html="rotationResetSvg"
    ></button>
    <button
      type="button"
      class="sky-rotation-btn"
      :title="t('display.rotateRight')"
      :aria-label="t('display.rotateRight')"
      @click="rotate(STEP)"
      @mouseenter="suppress(true)"
      @mouseleave="suppress(false)"
      @focus="suppress(true)"
      @blur="suppress(false)"
    >
      ↻
    </button>
  </div>
</template>

<script setup lang="ts">
import { t } from '../../i18n';
import { useDisplayStore } from '../../stores/display';
import { useUiStore } from '../../stores/ui';
import rotationResetSvg from '../../icons/rotation-reset.svg?raw';

const STEP = 5;
const displayStore = useDisplayStore();
const uiStore = useUiStore();

function rotate(absoluteOrDelta: number) {
  if (absoluteOrDelta === 0) {
    displayStore.setMapRotationDeg(0);
  } else {
    displayStore.setMapRotationDeg(displayStore.mapRotationDeg + absoluteOrDelta);
  }
}

function suppress(v: boolean) {
  uiStore.setForceSuppressTooltip(v);
}
</script>
