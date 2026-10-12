import { defineStore } from 'pinia';
import { ref } from 'vue';
import { setProjectionMode } from '@myastrosky/core/projection';
import { useMapPortStore } from './map-port';
import { useDisplayStore } from './display';

/**
 * Fisheye projection toggle. This is a pure map projection (orthographic,
 * pole-centred) — it needs no observer location or time. A future
 * Stellarium-style local-sky view (date + position) will be a separate feature.
 */
export const useFisheyeStore = defineStore('fisheye', () => {
  const canvasStore = useMapPortStore();

  const active = ref(false);

  function setActive(v: boolean) {
    active.value = v;

    const displayStore = useDisplayStore();
    const sm = canvasStore.skyMap;
    const ov = canvasStore.overlay;

    setProjectionMode(v ? 'fisheye' : 'stereo');
    sm?.setFisheyeMode(v);
    ov?.setBorderParams(displayStore.hemisphere, displayStore.borderLatDeg);
    ov?.updateTransforms();
  }

  return {
    active,
    setActive,
  };
});
