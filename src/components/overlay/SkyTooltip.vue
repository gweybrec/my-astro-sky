<template>
  <div
    v-if="uiStore.skyTooltipHtml"
    id="tooltip"
    :style="{ display: 'block', left: (uiStore.skyTooltipX + 15) + 'px', top: (uiStore.skyTooltipY + 15) + 'px' }"
    v-html="uiStore.skyTooltipHtml"
    @mouseenter="uiStore.keepSkyTooltipAlive"
    @mouseleave="uiStore.requestHideSkyTooltip"
  />
</template>

<script setup lang="ts">
import { useUiStore } from '../../stores/ui';
const uiStore = useUiStore();
</script>
