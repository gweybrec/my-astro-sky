/**
 * The frames (fields of view) on the Ciel map, as the desktop's frame ribbon wires them (FOVRibbon.vue): the shared
 * frame store gives the frames to draw, the map reports a tap, a drag, a rotation and a pin back to the store. A
 * finger moves the selected frame and turns it by its dot; pinning, the anchor and deleting are in the frame's sheet.
 */
import { shallowRef, watch } from 'vue';
import type { SkyMap } from '@myastrosky/render/sky-map';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { reportError } from '@myastrosky/core/platform/error-hook';

/** A frame is being dragged on the map: its sheet shrinks to its title (board "Ciel, déplacer le cadre"). */
export const frameDragging = shallowRef(false);

/** The "Contours de champ" sheet is open (the telescope button, or a plan picked in "Créer un cadre"). */
export const framesSheetOpen = shallowRef(false);

/** Connects the map to the frame store; returns the function that disconnects it. */
export function connectFrames(map: SkyMap): () => void {
  const fov = useFovFramesStore();
  const plans = usePlansStore();

  map.setOnFovInstanceSelect((id) => fov.setActive(id));
  map.setOnFovInstanceChange((id, change) => fov.applyChange(id, change));
  map.setOnFovFrameResize((id, region) => void fov.applyResize(id, region));
  map.setOnMosaicTileRemove((tileId) => fov.removeMosaicTile(tileId));
  map.setOnMosaicTileAdd((ra, dec) => fov.addMosaicTile(ra, dec));
  map.setOnFrameMerge((movedId, targetId) => void fov.mergeOnDrop(movedId, targetId));
  map.setOnFrameDragChange((dragging) => (frameDragging.value = dragging));

  plans.ensureLoaded().catch((error) => reportError('SkyFrames.plans', error));
  void fov.loadSpecs();
  // A plan's setup sizes its frames: a new one needs its size read.
  const stopSetups = watch(
    () => plans.plans.map((p) => p.setupId).join(','),
    () => void fov.loadSpecs(),
  );
  // The frames to draw; none while they are hidden (the list keeps them).
  const stopFrames = watch(
    [() => fov.renderables, () => fov.framesVisible],
    () => map.setFovInstances(fov.framesVisible ? fov.renderables : []),
    { deep: true, immediate: true },
  );
  // The "+" spots around the selected mosaic.
  const stopCandidates = watch(
    () => fov.activeMosaicAddCandidates,
    () => map.setMosaicAddCandidates(fov.framesVisible ? fov.activeMosaicAddCandidates : []),
    { deep: true, immediate: true },
  );

  return () => {
    stopSetups();
    stopFrames();
    stopCandidates();
    frameDragging.value = false;
  };
}
