<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import type { SkyRegionData } from '@myastrosky/core/domain/regions';
import type { SkyMap } from '@myastrosky/render/sky-map';
import { useLocalSkyWhileMounted } from './local-sky';

// The board "Voir une région", as the desktop's "Voir" of a saved region does it: the map in local sky with the region
// drawn in its colour. Nothing else: the title bar names it and its back arrow returns to the regions.
const props = defineProps<{ map: SkyMap; region: SkyRegionData }>();

useLocalSkyWhileMounted(props.map, () =>
  props.map.setActiveRegionOverlay({ color: props.region.color, points: props.region.points }),
);
onBeforeUnmount(() => props.map.setActiveRegionOverlay(null));
</script>

<template>
  <span hidden />
</template>
