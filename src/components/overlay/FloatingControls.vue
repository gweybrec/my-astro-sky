<template>
  <Teleport to="#app">
    <template v-if="viewMode === 'skymap'">
      <MapRotationControls />
      <FOVRibbon />
      <SkyTimeControl />
      <MapExportButton />
    </template>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '../../stores/ui';
import MapRotationControls from './MapRotationControls.vue';
import FOVRibbon from './FOVRibbon.vue';
import SkyTimeControl from './SkyTimeControl.vue';
import MapExportButton from './MapExportButton.vue';

const uiStore = useUiStore();
const viewMode = computed(() => uiStore.currentViewMode);
</script>
