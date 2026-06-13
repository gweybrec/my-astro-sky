<template>
  <Teleport to="#app">
    <template v-if="viewMode === 'skymap'">
      <MapRotationControls />
      <FOVRibbon />
    </template>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '../../stores/ui';
import MapRotationControls from './MapRotationControls.vue';
import FOVRibbon from './FOVRibbon.vue';

const uiStore = useUiStore();
const viewMode = computed(() => uiStore.currentViewMode);
</script>
