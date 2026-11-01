import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { createTargetPreview } from '../../src/target-preview';

/** "Afficher sur la carte" of a target on the desktop: its frame is a preview. */
describe('the preview frame of a target shown on the map', () => {
  beforeEach(() => {
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
  });

  /** The frames as the user left them: a plan's frames, hidden, and one free frame of their own. */
  function framesBefore() {
    const fov = useFovFramesStore();
    fov.adhoc.push({
      id: 'mine',
      setupId: 's1',
      anchor: { kind: 'sky', ra: 1, dec: 2, dsoId: null },
      rotationDeg: 0,
    });
    fov.setSelection({ kind: 'plan', planId: 'p1' });
    fov.setFramesVisible(false);
    return fov;
  }

  it('puts a free frame on the target and shows the frames', () => {
    const fov = framesBefore();
    createTargetPreview(fov).show('s1', 314, 44);
    expect(fov.adhoc).toHaveLength(2);
    expect(fov.adhoc[1].anchor).toMatchObject({ kind: 'sky', ra: 314, dec: 44 });
    expect(fov.framesVisible).toBe(true);
    expect(fov.selection).toEqual({ kind: 'free' });
  });

  it('removes it once the target leaves the screen, and puts the frames back as they were', () => {
    const fov = framesBefore();
    const preview = createTargetPreview(fov);
    preview.show('s1', 314, 44);
    preview.end();
    expect(fov.adhoc.map((f) => f.id)).toEqual(['mine']);
    expect(fov.framesVisible).toBe(false);
    expect(fov.selection).toEqual({ kind: 'plan', planId: 'p1' });
    // nothing more to end
    preview.end();
    expect(fov.adhoc.map((f) => f.id)).toEqual(['mine']);
  });

  it('keeps a single preview when targets are shown one after another', () => {
    const fov = framesBefore();
    const preview = createTargetPreview(fov);
    preview.show('s1', 314, 44);
    preview.show('s1', 10, 41);
    expect(fov.adhoc).toHaveLength(2);
    expect(fov.adhoc[1].anchor).toMatchObject({ ra: 10, dec: 41 });
    preview.end();
    // back to the frames from before the first target
    expect(fov.adhoc.map((f) => f.id)).toEqual(['mine']);
    expect(fov.framesVisible).toBe(false);
    expect(fov.selection).toEqual({ kind: 'plan', planId: 'p1' });
  });
});
