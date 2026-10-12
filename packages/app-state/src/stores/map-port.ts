import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type { PhotoOverlayPort, SkyMapPort } from '@myastrosky/core/map-ports';

/** The sky map (and the desktop's photo layer) the shared display and time stores drive. Each app sets it once its map exists. */
export const useMapPortStore = defineStore('map-port', () => {
  const skyMap = shallowRef<SkyMapPort | null>(null);
  const overlay = shallowRef<PhotoOverlayPort | null>(null);
  return { skyMap, overlay };
});
