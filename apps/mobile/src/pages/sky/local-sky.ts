import { onBeforeUnmount, onMounted } from 'vue';
import type { SkyMap } from '@myastrosky/render/sky-map';

/** How many drawn frames the map may take to be on screen once a mode asks for it (it is behind the page that asked). */
const SHOWN_FRAMES = 60;

/**
 * The map in local sky (the sky around the zenith) while the calling component is mounted, as the desktop's region
 * drawing and "Voir" do (`SkyMap.setLocalSkyMode` directly: the time store's own switch is for the date mode only).
 * Turning it on frames the whole sky at the map's size, so it waits until the map is on screen and has measured itself
 * in the mode's layout; `ready` runs then. The map's previous state comes back when the component goes.
 */
export function useLocalSkyWhileMounted(map: SkyMap, ready: () => void) {
  let before: boolean | null = null;
  let frame = 0;

  function start(frames: number) {
    frame = 0;
    map.resize();
    if (map.getView().width === 0 && frames > 0) {
      frame = requestAnimationFrame(() => start(frames - 1));
      return;
    }
    before = map.getLocalSkyMode();
    if (!before) map.setLocalSkyMode(true);
    ready();
  }

  onMounted(() => start(SHOWN_FRAMES));
  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame);
    if (before === false) map.setLocalSkyMode(false);
  });
}
