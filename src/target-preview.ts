import type { FovSelection, useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';

type FovStore = Pick<
  ReturnType<typeof useFovFramesStore>,
  | 'adhoc'
  | 'framesVisible'
  | 'selection'
  | 'addAdhocFrameAtSky'
  | 'setFramesVisible'
  | 'setSelection'
  | 'removeFrame'
>;

/**
 * "Afficher sur la carte" of a target (the targets list, a plan): the setup's frame put on it is a preview. `end()`
 * removes it and puts the frames back as they were (shown or not, and which set); the app calls it once the target
 * leaves the screen (another view, the targets panel over the map), and showing another target ends the last one.
 */
export function createTargetPreview(fov: FovStore) {
  let shown: { frameId: string; visible: boolean; selection: FovSelection } | null = null;

  function end(): void {
    if (!shown) return;
    const { frameId, visible, selection } = shown;
    shown = null;
    // A preview moved into a plan is no longer a free frame: removing it does nothing.
    fov.removeFrame(frameId);
    if (JSON.stringify(fov.selection) !== JSON.stringify(selection)) fov.setSelection(selection);
    fov.setFramesVisible(visible);
  }

  function show(setupId: string, ra: number, dec: number): void {
    end();
    const before = { visible: fov.framesVisible, selection: { ...fov.selection } };
    fov.addAdhocFrameAtSky(setupId, ra, dec);
    const frameId = fov.adhoc[fov.adhoc.length - 1]?.id;
    fov.setFramesVisible(true);
    shown = frameId ? { frameId, ...before } : null;
  }

  return { show, end };
}
