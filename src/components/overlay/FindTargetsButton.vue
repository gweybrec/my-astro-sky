<template>
  <div class="find-targets-control">
    <button
      type="button"
      class="sky-rotation-btn"
      :title="t('targets.findTargets')"
      :aria-label="t('targets.findTargets')"
      @click="open"
      @mouseenter="suppress(true)"
      @mouseleave="suppress(false)"
      @focus="suppress(true)"
      @blur="suppress(false)"
      v-html="targetSvg"
    ></button>
  </div>
</template>

<script setup lang="ts">
import { t } from '../../i18n';
import { useUiStore } from '../../stores/ui';
import targetSvg from '../../icons/target.svg?raw';

const uiStore = useUiStore();

function suppress(v: boolean) {
  uiStore.setForceSuppressTooltip(v);
}

function open() {
  uiStore.openTargetsOverlay(null);
}
</script>
